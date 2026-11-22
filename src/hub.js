// -----------------------------------------------------------------------------
// The hub: the link to one Outline and everything Gladys sees of it — the
// device, its states, the connection status, the scene events, and the
// documents written from scenes.
//
// Outline pushes nothing to a client without a public address: the container
// reads it every `refresh_minutes` (15 by default) on its own timer
// (should_poll: false). A read is two requests — the 25 documents changed
// last with the number of documents, and the collections — plus the version
// once: far below the rate limits of Outline (100 a minute for documents.list).
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { buildWikiDevice, buildWikiStates, isWikiDevice, wikiIds } from './devices.js';
import { OutlineClient, OutlineError, WINDOW } from './outline/client.js';
import {
  findCollection,
  lineToAppend,
  nameKey,
  parseDocumentRef,
  plainContext,
  stamp,
  summarizeDocument,
} from './outline/model.js';
import { MemoryStore } from './store.js';
import { STATUS_TEXT, TEST_TEXT, commandMessage } from './texts.js';

const logger = createLogger({ name: 'outline-hub' });

export const WIDGET_KEY = 'documents';
export const TRIGGERS = { changed: 'document_changed' };

export const DEFAULT_TIMINGS = {
  // requestWidgetRefresh is dropped by the core beyond one call per 10 s.
  widgetGap: 10_500,
  // An unchanged value is sent again before Gladys calls it stale (48 h).
  heartbeat: 6 * 3_600_000,
  requestTimeout: 15_000,
};

// Past that many changes between two reads (the whole window read: an
// import, a collection moved), it is a burst: the ten oldest read are
// announced and the rest is recorded as seen.
export const BURST = WINDOW;
// Below a burst, the changes past ten wait for the next read.
export const MAX_EVENTS_PER_READ = 10;
// The documents written by the integration itself are never announced (a
// scene bound to "Document changed" that writes a document would loop).
const MAX_OWN = 200;
// Reads after which a change whose event Gladys keeps refusing is given up.
export const MAX_TRIES = 3;
// Outline refuses a longer document title (DocumentValidation.maxTitleLength).
export const MAX_TITLE = 100;

/**
 * A failed action: Gladys shows its message in red. The message is the
 * multi-language object, as the core expects it.
 */
export class CommandError extends Error {
  constructor(code, values) {
    const messages = commandMessage(code, values);
    super(messages.en);
    this.code = code;
    this.message = messages;
  }
}

const linkOf = (config) => JSON.stringify([config.url, config.apiKey]);
const timeOf = (iso) => Date.parse(iso);
const ownKey = (document) => `${document.id}@${timeOf(document.updated)}`;
const ownTime = (key) => Number(key.slice(key.lastIndexOf('@') + 1));
const isId = (value) => typeof value === 'string' && value !== '';

/** The newest change seen: its time and the documents changed at that very millisecond. */
function advance(mark, document) {
  const at = timeOf(document.updated);
  if (!Number.isFinite(at)) {
    return mark;
  }
  if (!mark || at > mark.at) {
    return { at, ids: [document.id] };
  }
  if (at === mark.at && !mark.ids.includes(document.id)) {
    return { at, ids: [...mark.ids, document.id] };
  }
  return mark;
}

const seenBy = (mark, document) => {
  const at = timeOf(document.updated);
  return !Number.isFinite(at) || at < mark.at || (at === mark.at && mark.ids.includes(document.id));
};

const byNewest = (a, b) =>
  timeOf(b.updated) - timeOf(a.updated) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

export class Hub {
  constructor({ gladys, fetch, timings, now = Date.now, store }) {
    this.gladys = gladys;
    this.fetch = fetch;
    this.timings = { ...DEFAULT_TIMINGS, ...timings };
    this.now = now;
    this.store = store ?? new MemoryStore();
    this.config = { url: null, urlInvalid: false, apiKey: '', refreshMinutes: 15, language: 'fr' };
    this.client = null;
    this.version = '';
    /** the documents changed last, summarized, the newest first; null before the first read */
    this.documents = null;
    /** every collection the key may read: { id, name, urlId } */
    this.collections = [];
    /** { documents, collections } */
    this.counters = null;
    /** null (fine), or the kind of the last failure */
    this.failure = null;
    this.announced = false;
    this.lastStatus = '';
    this.saved = '';
    /** what the triggers already saw: { instance, at, ids, since } */
    this.seen = null;
    /** `<document id>@<time>` of the changes written by the integration */
    this.own = new Set();
    /** ids announced "created" since `seen.since`: never "created" twice */
    this.createdIds = new Set();
    /** `<document id>@<time>` -> { tries, sent, created }: events Gladys refused */
    this.retries = new Map();
    this.eventFailing = false;
    this.devicesFailing = false;
    this.publishFailing = false;
    this.configuring = Promise.resolve();
    this.writing = Promise.resolve();
    this.refreshTimer = null;
    this.refreshing = null;
    this.refreshAgain = false;
    this.widgetRefreshAt = 0;
    this.widgetTimer = null;
    this.stopped = false;
  }

  get language() {
    return this.config.language;
  }

  /** Where documents open: the address Outline answers at (https once redirected). */
  get baseUrl() {
    return this.client?.url ?? this.config.url ?? '';
  }

  get loaded() {
    return this.counters !== null;
  }

  async start(config) {
    const saved = await this.store.load();
    // A damaged file is a new baseline, not a crash on every read.
    this.seen =
      typeof saved.instance === 'string' &&
      Number.isFinite(saved.at) &&
      Array.isArray(saved.ids) &&
      saved.ids.every(isId)
        ? {
            instance: saved.instance,
            at: saved.at,
            ids: saved.ids,
            since: Number.isFinite(saved.since) ? saved.since : saved.at,
          }
        : null;
    // The documents written from Gladys but not read back yet: never
    // announced, even after a restart.
    if (Array.isArray(saved.own)) {
      this.own = new Set(saved.own.filter((k) => typeof k === 'string').slice(-MAX_OWN));
    }
    if (this.seen && Array.isArray(saved.created)) {
      this.createdIds = new Set(saved.created.filter(isId));
    }
    await this.reconfigure(config);
  }

  /** One configuration change at a time: a second one waits for the first. */
  reconfigure(config) {
    const run = this.configuring.then(() => this.#reconfigure(config));
    this.configuring = run.catch(() => {});
    return run;
  }

  async #reconfigure(config) {
    const previous = this.config;
    this.config = config;
    const linkChanged = linkOf(previous) !== linkOf(config) || !this.client;
    if (linkChanged || previous.refreshMinutes !== config.refreshMinutes) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (linkChanged) {
      this.client = null;
      this.version = '';
      this.documents = null;
      this.collections = [];
      this.counters = null;
      this.failure = null;
      this.announced = false;
      if (config.url && config.apiKey) {
        this.client = new OutlineClient({
          url: config.url,
          apiKey: config.apiKey,
          fetch: this.fetch,
          timeout: this.timings.requestTimeout,
        });
      }
    }
    if (this.client && !this.refreshTimer) {
      this.refreshTimer = setInterval(
        () => this.refresh().catch((err) => logger.error('Read failed', err)),
        config.refreshMinutes * 60_000,
      );
      this.refreshTimer.unref?.();
    }
    if (linkChanged) {
      await this.refresh();
    } else {
      // Language or interval only: same data, new names and texts.
      this.gladys.forgetPublishedStates?.();
      await this.#update();
    }
    await this.updateConnectionStatus();
  }

  /** Gladys reconnected (it may have restarted): send everything again. */
  async resync(config) {
    this.gladys.forgetPublishedStates?.();
    this.lastStatus = '';
    await this.reconfigure(config);
  }

  async stop() {
    this.stopped = true;
    clearInterval(this.refreshTimer);
    clearTimeout(this.widgetTimer);
    this.refreshTimer = null;
    // A read announcing events, or a write: its mark must reach the disk.
    await this.refreshing?.catch(() => {});
    await this.writing;
    await this.store.flush();
  }

  // --- Reading Outline ------------------------------------------------------

  /** Read Outline (one read at a time; a request during it runs once after). */
  refresh() {
    if (this.refreshing) {
      this.refreshAgain = true;
      return this.refreshing;
    }
    this.refreshing = (async () => {
      do {
        this.refreshAgain = false;
        try {
          await this.#refreshOnce();
        } catch (err) {
          // Never ends the loop: a read queued meanwhile (new address) still runs.
          logger.error('Read failed', err);
        }
      } while (this.refreshAgain && !this.stopped);
    })().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  /** The key of the wiki for the triggers: a new address is a new baseline. */
  get #instance() {
    return this.config.url ?? '';
  }

  #known(instance) {
    return this.seen?.instance === instance ? this.seen : null;
  }

  #collectionNames() {
    return new Map(this.collections.map((c) => [c.id, c.name]));
  }

  async #refreshOnce() {
    const client = this.client;
    // The wiki this read is about, even if the address changes meanwhile.
    const instance = this.#instance;
    if (this.stopped) {
      return;
    }
    if (!client) {
      await this.publishDevices();
      return;
    }
    let recent;
    let collections;
    let version = this.version;
    try {
      recent = await client.recentDocuments();
      collections = await client.collections();
      if (!this.announced) {
        version = await client.version();
      }
    } catch (err) {
      if (client !== this.client) {
        return;
      }
      this.#fail(err);
      // The device says Outline does not answer (reachable 0).
      await this.publishStates();
      await this.updateConnectionStatus();
      return;
    }
    if (client !== this.client || this.stopped) {
      return;
    }
    this.version = version;
    this.collections = collections.collections.map((c) => ({
      id: c.id,
      name: String(c.name).trim(),
      urlId: typeof c.urlId === 'string' ? c.urlId : '',
    }));
    const names = this.#collectionNames();
    this.documents = recent.documents
      .map((d) => summarizeDocument(d, this.baseUrl, names))
      .sort(byNewest);
    this.counters = { documents: recent.total, collections: collections.total };
    this.#recover();
    await this.#update();
    if (client !== this.client || this.stopped) {
      return; // the configuration changed meanwhile
    }
    // A scene write in progress: its document must be known as ours first.
    await this.writing;
    if (client !== this.client || this.stopped) {
      return; // reconfigured or stopped while a write finished
    }
    await this.#announce(this.documents, instance, recent.total);
    await this.updateConnectionStatus();
  }

  /** Device, states and widget from the last read. */
  async #update() {
    await this.publishDevices();
    await this.publishStates();
    this.refreshWidget();
  }

  #fail(err) {
    const kind = err instanceof OutlineError ? err.kind : 'unreachable';
    if (this.failure === null) {
      logger.warn(`Outline: ${err.message}`);
      this.refreshWidget(); // the widget shows that Outline does not answer
    } else {
      logger.debug(`Outline still failing: ${err.message}`);
    }
    this.failure = kind;
  }

  #recover() {
    const count = this.counters.documents;
    if (this.failure !== null) {
      logger.info(`Outline answers again (${count} documents)`);
    } else if (!this.announced) {
      const version = this.version ? ` ${this.version}` : '';
      logger.info(`Connected to Outline${version} (${count} documents)`);
    }
    this.announced = true;
    this.failure = null;
  }

  // --- Scene events ---------------------------------------------------------

  /**
   * Fire the documents created or changed since the last read, the oldest
   * first. The first read of a wiki is a silent baseline: installing the
   * integration announces nothing already there.
   * @param {object[]} documents the documents changed last, the newest first
   * @param {string} instance the address the documents were read at
   * @param {number} total how many documents there are in all
   */
  async #announce(documents, instance, total) {
    const known = this.#known(instance);
    let mark = known ? { at: known.at, ids: known.ids } : null;
    // The end of the last read that went through all its changes: a document
    // created after it is "created", even when its event waited a read.
    let since = known?.since ?? 0;
    if (!known) {
      // Baseline: the newest change of the wiki (an empty wiki: any document to come).
      for (const document of documents) {
        mark = advance(mark, document);
      }
      mark ??= { at: 0, ids: [] };
      since = mark.at;
    } else {
      const changes = documents.filter((d) => !seenBy(known, d)).reverse();
      const fresh = changes.filter((d) => !this.#isOwn(d));
      const pending = fresh.slice(0, MAX_EVENTS_PER_READ);
      // Every document read changed, and there are more: some may be unread.
      const burst = changes.length >= BURST && total > documents.length;
      if (burst) {
        logger.info(`${fresh.length}+ documents changed at once: ${pending.length} announced`);
      }
      // The oldest first; the mark follows each document Gladys took.
      let stopped = false;
      let deferred = false;
      for (const document of changes) {
        if (this.#isOwn(document)) {
          mark = advance(mark, document);
          continue;
        }
        if (!pending.includes(document)) {
          deferred = true;
          break; // past ten: the next read
        }
        if ((await this.#fire(document, since)) === 'retry') {
          stopped = true;
          break;
        }
        mark = advance(mark, document);
      }
      if (burst && !stopped) {
        // The rest of a burst is seen: the mark jumps to the newest change.
        for (const document of changes) {
          mark = advance(mark, document);
        }
      }
      if (!stopped && (burst || !deferred)) {
        since = mark.at;
      }
    }
    for (const key of this.own) {
      if (ownTime(key) <= mark.at) {
        this.own.delete(key);
      }
    }
    for (const key of this.retries.keys()) {
      if (ownTime(key) <= mark.at) {
        this.retries.delete(key); // seen meanwhile (changed again, a burst)
      }
    }
    if (since !== known?.since) {
      this.createdIds.clear();
    }
    this.seen = { instance, at: mark.at, ids: mark.ids, since };
    await this.#save();
  }

  /** The mark and the own changes on disk, when they changed. */
  async #save() {
    const data = { ...this.seen, own: [...this.own], created: [...this.createdIds] };
    const text = JSON.stringify(data);
    if (text !== this.saved) {
      this.saved = text;
      await this.store.save(data);
    }
  }

  /**
   * Fire the event of one changed document.
   * @returns {Promise<'done' | 'retry'>}
   */
  async #fire(document, since) {
    const key = ownKey(document);
    const attempt = this.retries.get(key) ?? { tries: 0 };
    // Created after the last complete read, and not announced as such yet (a
    // document created, announced, then saved again while events wait).
    // Decided once per change: a retry sends the same event.
    attempt.created ??= timeOf(document.created) > since && !this.createdIds.has(document.id);
    const data = this.#eventData(document, attempt.created);
    logger.debug(`${TRIGGERS.changed}: ${document.id}`);
    try {
      await this.gladys.publishSceneEvent(TRIGGERS.changed, data);
      if (this.eventFailing) {
        logger.info('Scene events accepted again');
      }
      this.eventFailing = false;
    } catch (err) {
      if (this.eventFailing) {
        logger.debug(`Cannot fire ${TRIGGERS.changed}: ${err.message}`);
      } else {
        logger.warn(`Cannot fire ${TRIGGERS.changed}: ${err.message}`);
      }
      this.eventFailing = true;
      // A refusal for good (4xx but 429) is not retried: it would be refused
      // at every read. Otherwise (Gladys restarting), this change and the
      // next ones are fired again at the next read.
      const status = err?.status;
      const final = Number.isInteger(status) && status >= 400 && status < 500 && status !== 429;
      if (!final) {
        const tries = attempt.tries + 1;
        if (tries < MAX_TRIES) {
          this.retries.set(key, { ...attempt, tries });
          return 'retry';
        }
        // A change Gladys keeps refusing would hold back every later one.
        logger.warn(`Document ${document.id} not announced: Gladys refused it ${tries} times`);
      }
      this.retries.delete(key);
      return 'done';
    }
    this.retries.delete(key);
    if (attempt.created) {
      this.createdIds.add(document.id);
    }
    return 'done';
  }

  /**
   * A change written by the integration (or an earlier state of it: a read
   * may answer a time a little before the one the write answered).
   */
  #isOwn(document) {
    const at = timeOf(document.updated);
    for (const key of this.own) {
      if (key.startsWith(`${document.id}@`) && at <= ownTime(key)) {
        return true;
      }
    }
    return false;
  }

  #eventData(document, created) {
    return {
      title: document.title.slice(0, 1000),
      collection: document.collection.slice(0, 1000),
      change: created ? 'created' : 'updated',
      url: document.url.slice(0, 1000),
      updated_by: document.author.slice(0, 1000),
      document_id: document.id,
    };
  }

  // --- Device and states ----------------------------------------------------

  #isCreated(externalId) {
    return (this.gladys.devices ?? []).some((device) => device.external_id === externalId);
  }

  buildDevices() {
    if (!this.loaded) {
      return [];
    }
    return [buildWikiDevice(this.gladys, this.language, this.baseUrl, this.version)];
  }

  async publishDevices() {
    if (this.stopped) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(this.buildDevices());
    } catch (err) {
      if (this.devicesFailing) {
        logger.debug(`Cannot publish the devices: ${err.message}`);
      } else {
        logger.warn(`Cannot publish the devices: ${err.message}`);
      }
      this.devicesFailing = true;
      return;
    }
    this.devicesFailing = false;
  }

  /**
   * The states of the device, once the user added it (Gladys drops the others).
   * @param {string} [justCreated] the external id of a device just added
   */
  async publishStates(justCreated) {
    if (!this.loaded || this.stopped) {
      return;
    }
    const device = wikiIds(this.gladys).device;
    if (device !== justCreated && !this.#isCreated(device)) {
      return;
    }
    const states = buildWikiStates(
      this.gladys,
      {
        // Outline answers a refused key or a rate limit: it is reachable.
        reachable: !['unreachable', 'timeout', 'invalid', 'redirected'].includes(this.failure),
        counters: this.counters,
        latest: this.documents[0],
      },
      this.language,
    );
    try {
      await this.gladys.publishChangedStates(states, { heartbeat: this.timings.heartbeat });
    } catch (err) {
      if (this.publishFailing) {
        logger.debug(`Cannot publish the states: ${err.message}`);
      } else {
        logger.warn(`Cannot publish the states: ${err.message}`);
      }
      this.publishFailing = true;
      return;
    }
    if (this.publishFailing) {
      logger.info('States published again');
    }
    this.publishFailing = false;
  }

  /** The user added a device: states sent before were dropped by Gladys. */
  async onDeviceCreated(device) {
    if (!isWikiDevice(this.gladys, device?.external_id)) {
      return;
    }
    this.gladys.forgetPublishedStates?.(device.external_id);
    await this.publishStates(device.external_id);
    this.refreshWidget();
  }

  /** The user renamed or deleted the device: the widget follows. */
  onDeviceChanged(device) {
    if (isWikiDevice(this.gladys, device?.external_id)) {
      this.refreshWidget();
    }
  }

  /** onPoll (the device is not polled: the container reads on its timer). */
  async poll(device) {
    if (isWikiDevice(this.gladys, device?.external_id)) {
      await this.publishStates(device.external_id);
    }
  }

  // --- Widget ---------------------------------------------------------------

  /** Nudge the open dashboards, with a trailing call inside the core's 10 s gap. */
  refreshWidget() {
    if (this.stopped) {
      return;
    }
    const wait = this.widgetRefreshAt + this.timings.widgetGap - this.now();
    if (wait <= 0) {
      this.widgetRefreshAt = this.now();
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
      return;
    }
    if (!this.widgetTimer) {
      this.widgetTimer = setTimeout(() => {
        this.widgetTimer = null;
        this.refreshWidget();
      }, wait);
      this.widgetTimer.unref?.();
    }
  }

  /**
   * The documents of one collection changed last, and how many it holds: a
   * request of its own (the read only keeps the 25 changed last overall).
   * @returns {Promise<{ collection: object, documents: object[], total: number } | null>}
   */
  async collectionDocuments(name, limit) {
    const collection = findCollection(this.collections, name);
    if (!collection || !this.client) {
      return null;
    }
    const recent = await this.client.recentDocuments({ collectionId: collection.id, limit });
    const names = this.#collectionNames();
    return {
      collection,
      documents: recent.documents
        .map((d) => summarizeDocument(d, this.baseUrl, names))
        .sort(byNewest),
      total: recent.total,
    };
  }

  // --- Connection status ----------------------------------------------------

  statusKey() {
    if (this.config.urlInvalid) {
      return 'invalid';
    }
    if (!this.config.url) {
      return 'none';
    }
    if (!this.config.apiKey) {
      return 'key';
    }
    if (this.failure) {
      return (
        {
          unauthorized: 'unauthorized',
          forbidden: 'forbidden',
          rate_limited: 'rate_limited',
          redirected: 'redirected',
          invalid: 'invalid_answer',
          http: 'error',
          not_found: 'invalid_answer',
          rejected: 'error',
        }[this.failure] ?? 'unreachable'
      );
    }
    return null;
  }

  statusMessage() {
    const key = this.statusKey();
    return key ? this.#statusOf(key) : null;
  }

  #statusOf(key) {
    return Object.fromEntries(
      Object.entries(STATUS_TEXT).map(([language, table]) => [language, table[key]]),
    );
  }

  async updateConnectionStatus() {
    if (this.stopped) {
      return;
    }
    // Nothing to say before the first answer or failure.
    if (this.client && !this.loaded && this.failure === null) {
      return;
    }
    const message = this.statusMessage();
    const connected = Boolean(this.client) && this.loaded && this.failure === null;
    const fingerprint = JSON.stringify({ connected, message });
    if (fingerprint === this.lastStatus) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(connected, message ?? undefined);
      // Recorded once Gladys took it: a failed call is sent again next time.
      this.lastStatus = fingerprint;
    } catch (err) {
      logger.warn(`Cannot set the connection status: ${err.message}`);
    }
  }

  // --- Actions --------------------------------------------------------------

  /** "Test the connection": a fresh read, then its outcome (red when it fails). */
  async testReport() {
    const failure = (message) => {
      const error = new Error(message.en);
      error.message = message;
      return error;
    };
    if (!this.client) {
      throw failure(this.statusMessage());
    }
    await this.refresh();
    const message = this.statusMessage();
    if (message) {
      throw failure(message);
    }
    if (!this.loaded) {
      // The configuration changed during the test: nothing read yet.
      throw failure(this.#statusOf('unreachable'));
    }
    return Object.fromEntries(
      Object.entries(TEST_TEXT).map(([language, render]) => [
        language,
        render(this.counters.documents, this.counters.collections),
      ]),
    );
  }

  #clientOrFail() {
    if (!this.client) {
      throw new CommandError('unreachable');
    }
    return this.client;
  }

  /** Writes one at a time: two lines added at once both land in the document. */
  #serialize(fn) {
    const run = this.writing.then(fn);
    this.writing = run.catch(() => {});
    return run;
  }

  /** The collections to look a name up in: the last read, else a fresh one. */
  async #knownCollections(client, wanted) {
    if (client === this.client && findCollection(this.collections, wanted)) {
      return this.collections;
    }
    // A collection created since the last read.
    return (await client.collections()).collections;
  }

  async #collection(client, raw) {
    const name = typeof raw === 'string' ? raw.trim() : '';
    if (!name) {
      throw new CommandError('collection_missing');
    }
    const collection = findCollection(await this.#knownCollections(client, name), name);
    if (!collection) {
      throw new CommandError('collection', { name: name.slice(0, 100) });
    }
    return collection;
  }

  /**
   * Create a published document in a collection.
   * @param {{ collection: unknown, title: unknown, text?: unknown }} request
   */
  createDocument({ collection: rawCollection, title: rawTitle, text }) {
    return this.#serialize(async () => {
      const title = typeof rawTitle === 'string' ? rawTitle.trim().slice(0, MAX_TITLE) : '';
      if (!title) {
        throw new CommandError('title');
      }
      const client = this.#clientOrFail();
      let document;
      try {
        const collection = await this.#collection(client, rawCollection);
        document = await client.createDocument({
          collectionId: collection.id,
          title,
          text: typeof text === 'string' ? text.trim() : '',
        });
      } catch (err) {
        throw this.#commandError(err);
      }
      this.#remember(document);
      logger.info('Document created');
      this.refresh().catch(() => {});
      return this.#written(document);
    });
  }

  /** The document named by the user: by address or id, else by its exact title. */
  async #findDocument(client, raw, collectionName) {
    const ref = parseDocumentRef(raw);
    if (ref.id) {
      return client.document(ref.id);
    }
    if (!ref.title) {
      return null; // an address that is not a document
    }
    const wanted = nameKey(ref.title);
    const exact = (d) => nameKey(d.title) === wanted;
    const matches = (await client.searchTitles(ref.title, { accept: exact })).filter(exact);
    if (matches.length <= 1 || !collectionName) {
      return matches[0] ?? null;
    }
    // Two documents with that title: the one of the collection given, if any.
    const collection = findCollection(this.collections, collectionName);
    return matches.find((d) => d.collectionId === collection?.id) ?? matches[0];
  }

  /**
   * Add a line at the end of a document (a journal), created in the
   * collection given when no document has that title.
   * @param {{ document: unknown, line: unknown, addTime?: unknown, collection?: unknown }} request
   */
  appendToDocument({ document: rawDocument, line, addTime, collection: rawCollection }) {
    return this.#serialize(async () => {
      const typedRef = parseDocumentRef(rawDocument);
      if (!typedRef.id && !typedRef.title && !typedRef.link) {
        throw new CommandError('document_missing');
      }
      const typed = typeof line === 'string' ? line.trim().slice(0, 5000) : '';
      if (!typed) {
        throw new CommandError('line');
      }
      const text =
        addTime === false || addTime === 'false' ? typed : `${stamp(this.now())} — ${typed}`;
      const client = this.#clientOrFail();
      const collectionName = typeof rawCollection === 'string' ? rawCollection.trim() : '';
      let written;
      let created = false;
      try {
        const existing = await this.#findDocument(client, rawDocument, collectionName);
        if (existing) {
          written = await client.appendText(existing.id, lineToAppend(existing.text, text));
        } else {
          const ref = parseDocumentRef(rawDocument);
          if (!ref.title || !collectionName) {
            throw new CommandError('document', { name: String(rawDocument).trim().slice(0, 100) });
          }
          const collection = await this.#collection(client, collectionName);
          written = await client.createDocument({
            collectionId: collection.id,
            title: ref.title,
            text,
          });
          created = true;
        }
      } catch (err) {
        throw this.#commandError(err);
      }
      this.#remember(written);
      logger.info(created ? 'Journal document created' : 'Line added to a document');
      this.refresh().catch(() => {});
      return { ...this.#written(written), created };
    });
  }

  /**
   * Full-text search: the best match, and how many documents match.
   * @param {{ query: unknown, collection?: unknown }} request
   */
  async search({ query: rawQuery, collection: rawCollection }) {
    const query = typeof rawQuery === 'string' ? rawQuery.trim().slice(0, 500) : '';
    if (!query) {
      throw new CommandError('query');
    }
    const client = this.#clientOrFail();
    let answer;
    try {
      const name = typeof rawCollection === 'string' ? rawCollection.trim() : '';
      const collection = name ? await this.#collection(client, name) : null;
      answer = await client.search(query, { collectionId: collection?.id, limit: 1 });
    } catch (err) {
      throw this.#commandError(err);
    }
    const best = answer.results[0];
    if (!best) {
      throw new CommandError('no_result', { name: query.slice(0, 100) });
    }
    const document = summarizeDocument(best.document, this.baseUrl, this.#collectionNames());
    return {
      count: answer.total,
      title: document.title,
      url: document.url,
      excerpt: plainContext(best.context).slice(0, 1000),
      collection: document.collection,
      document_id: document.id,
    };
  }

  #written(document) {
    return {
      document_id: document.id,
      title: String(document.title ?? ''),
      url: summarizeDocument(document, this.baseUrl).url,
    };
  }

  #remember(document) {
    if (!document?.updatedAt) {
      return;
    }
    this.own.add(ownKey({ id: document.id, updated: document.updatedAt }));
    if (this.own.size > MAX_OWN) {
      this.own.delete(this.own.values().next().value);
    }
    // Kept on disk: a restart before the next read must not announce it.
    if (this.seen) {
      this.#save().catch(() => {});
    }
  }

  #commandError(err) {
    if (err instanceof CommandError) {
      return err;
    }
    const kind = err instanceof OutlineError ? err.kind : 'unreachable';
    const detail = String(err.message);
    if (
      [
        'unauthorized',
        'forbidden',
        'rate_limited',
        'timeout',
        'unreachable',
        'redirected',
      ].includes(kind)
    ) {
      // A timeout: the request may have reached Outline, the document may be written.
      return new CommandError(kind);
    }
    if (kind === 'rejected') {
      return new CommandError('rejected', { detail });
    }
    return new CommandError('http', { detail });
  }
}
