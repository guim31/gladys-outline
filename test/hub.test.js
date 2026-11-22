// -----------------------------------------------------------------------------
// The hub against the SDK's fake Gladys and a fake Outline built from real
// answers: device and states, the timer, the trigger, the scene actions, the
// widget and the connection status.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { MAX_TRIES } from '../src/hub.js';
import { MemoryStore } from '../src/store.js';
import { API_KEY, HOST, READ_ONLY_KEY, createOutline, settle } from './helpers/fakeOutline.js';
import { CONFIG, createAll, createWorld, mainDevice, mainFeature } from './helpers/world.js';

const changed = (fake) => fake.sceneEvents.filter((e) => e.key === 'document_changed');

/** Run a scene action as Gladys would: its outputs, or the error it answered. */
async function run(world, key, fields) {
  const ack = await world.fake.sceneAction(key, fields);
  assert.equal(ack.success, true, JSON.stringify(ack.error));
  return ack.data.outputs;
}
async function failure(world, key, fields) {
  const ack = await world.fake.sceneAction(key, fields);
  assert.equal(ack.success, false, key);
  assert.deepEqual(Object.keys(ack.error).sort(), ['de', 'en', 'es', 'fr'], 'multi-language');
  return ack.error;
}
const journalOf = (world) =>
  world.server.state.documents.find((d) => d.title === 'Journal chaudière');

test('one Outline device, every state once added, the widget nudged', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const devices = world.fake.discoveredDevices;
  assert.deepEqual(
    devices.map((d) => [d.name, d.external_id, d.should_poll]),
    [['Outline', mainDevice, false]],
  );
  assert.equal(world.fake.states.length, 0, 'no state before the device is added');
  const nudges = world.fake.widgetRefreshes.length;
  await createAll(world.fake);
  assert.equal(world.fake.lastState(mainFeature('reachable')), 1);
  assert.equal(world.fake.lastState(mainFeature('documents')), 3);
  assert.equal(world.fake.lastState(mainFeature('collections')), 2);
  assert.equal(world.fake.lastState(mainFeature('latest')), 'Journal chaudière');
  assert.equal(world.fake.lastState(mainFeature('latest_by')), 'Alice Martin');
  assert.match(world.fake.lastState(mainFeature('latest_at')), /22 nov\./);
  assert.ok(world.fake.widgetRefreshes.length > nudges, 'widget refreshed on creation');
  assert.equal(devices[0].params.find((p) => p.name === 'OUTLINE_VERSION').value, '1.13.0');
  assert.equal(devices[0].params.find((p) => p.name === 'OUTLINE_URL').value, HOST);
  // Two requests per read, plus the version once.
  assert.deepEqual(
    world.server.state.requests.map((r) => r.method),
    ['documents.list', 'collections.list', 'installation.info'],
  );
});

test('the container reads Outline on its own timer, without onPoll', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const world = await createWorld({ config: { ...CONFIG, refresh_minutes: '5' } });
  t.after(() => world.app.stop());
  await createAll(world.fake);
  world.server.edit('Lisez-moi', { by: 'Bob Durand' });
  t.mock.timers.tick(5 * 60_000);
  await settle(20);
  assert.equal(world.fake.lastState(mainFeature('documents')), 4);
  assert.equal(world.fake.lastState(mainFeature('latest')), 'Lisez-moi');
  assert.equal(world.fake.lastState(mainFeature('latest_by')), 'Bob Durand');
});

test('Outline down: reachable 0, the counters kept, then back', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createAll(world.fake);
  world.server.goDown();
  await world.hub.refresh();
  assert.equal(world.fake.lastState(mainFeature('reachable')), 0);
  assert.equal(world.fake.lastState(mainFeature('documents')), 3);
  world.server.goUp();
  await world.hub.refresh();
  assert.equal(world.fake.lastState(mainFeature('reachable')), 1);
});

test('document changed: silent baseline, created then updated, collection, author', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  assert.equal(changed(world.fake).length, 0, 'the first read announces nothing');
  const created = world.server.edit('Arrosage', { collection: 'Jardin', by: 'Bob Durand' });
  await world.hub.refresh();
  world.server.edit('Alarme', { by: 'Carla Diaz' });
  await world.hub.refresh();
  await world.hub.refresh();
  assert.deepEqual(
    changed(world.fake).map((e) => e.data),
    [
      {
        title: 'Arrosage',
        collection: 'Jardin',
        change: 'created',
        url: `${HOST}${created.url}`,
        updated_by: 'Bob Durand',
        document_id: created.id,
      },
      {
        title: 'Alarme',
        collection: 'Maison',
        change: 'updated',
        url: `${HOST}/doc/alarme-eet1sizUeC`,
        updated_by: 'Carla Diaz',
        document_id: '5c6952de-6891-4295-9c6d-d21af29d9147',
      },
    ],
  );
});

test('more than ten changes: ten now, the rest at the next read, oldest first', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  for (let i = 0; i < 14; i += 1) {
    world.server.edit(`Note ${i}`);
  }
  await world.hub.refresh();
  assert.equal(changed(world.fake).length, 10);
  await world.hub.refresh();
  assert.deepEqual(
    changed(world.fake).map((e) => e.data.title),
    Array.from({ length: 14 }, (_, i) => `Note ${i}`),
  );
  assert.ok(changed(world.fake).every((e) => e.data.change === 'created'));
});

test('a burst (every document read changed): ten announced, the rest seen', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  for (let i = 0; i < 40; i += 1) {
    world.server.edit(`Import ${i}`);
  }
  await world.hub.refresh();
  await world.hub.refresh();
  assert.equal(changed(world.fake).length, 10);
});

test('an event Gladys did not take is fired again; one it keeps refusing is given up', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const publish = world.gladys.publishSceneEvent.bind(world.gladys);
  let refuse = 'First';
  world.gladys.publishSceneEvent = async (key, data) => {
    if (data.title === refuse) {
      throw Object.assign(new Error('Gladys restarting'), { status: 503 });
    }
    return publish(key, data);
  };
  world.server.edit('First');
  await world.hub.refresh();
  assert.equal(changed(world.fake).length, 0);
  refuse = null;
  await world.hub.refresh();
  assert.deepEqual(
    changed(world.fake).map((e) => e.data.title),
    ['First'],
  );
  refuse = 'Stuck';
  world.server.edit('Stuck');
  world.server.edit('After');
  for (let i = 0; i < MAX_TRIES; i += 1) {
    await world.hub.refresh();
  }
  assert.deepEqual(
    changed(world.fake).map((e) => e.data.title),
    ['First', 'After'],
  );
});

test('the last change seen survives a restart; a new address is a new baseline', async (t) => {
  const store = new MemoryStore();
  const server = createOutline();
  const first = await createWorld({ server, store });
  server.edit('Avant');
  await first.hub.refresh();
  await first.app.stop();
  server.edit('Pendant');
  const second = await createWorld({ server, store });
  t.after(() => second.app.stop());
  assert.deepEqual(
    changed(second.fake).map((e) => e.data.title),
    ['Pendant'],
  );
  await second.fake.configUpdated({ ...CONFIG, url: 'http://192.0.2.50:3000/wiki' });
  await settle(20);
  assert.equal(changed(second.fake).length, 1, 'nothing announced at the new address');
});

test('append_line: by title, a paragraph per line with the time; never announced', async (t) => {
  const world = await createWorld({ clock: { now: Date.parse('2026-11-22T12:05:00.000Z') } });
  t.after(() => world.app.stop());
  const before = journalOf(world).text;
  const outputs = await run(world, 'append_line', {
    document: ' journal CHAUDIÈRE ',
    line: 'Purge des radiateurs',
  });
  assert.equal(outputs.created, false);
  assert.equal(outputs.title, 'Journal chaudière');
  assert.equal(outputs.url, `${HOST}/doc/journal-chaudiere-wWtvmGFB7F`);
  const text = journalOf(world).text;
  assert.ok(text.startsWith(`${before}\n\n2026-11-22 `), text);
  assert.match(text, /\d{2}:\d{2} — Purge des radiateurs$/);
  await run(world, 'append_line', {
    document: `${HOST}/doc/journal-chaudiere-wWtvmGFB7F`,
    line: 'Sans heure',
    add_time: false,
  });
  assert.ok(journalOf(world).text.endsWith('radiateurs\n\nSans heure'));
  await world.hub.refresh();
  assert.equal(changed(world.fake).length, 0, 'own writes are not announced');
});

test('append_line: a missing journal is created in the collection given, else an error', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const error = await failure(world, 'append_line', {
    document: 'Journal piscine',
    line: 'pH 7,2',
  });
  assert.match(error.fr, /Aucun document « Journal piscine »/);
  const outputs = await run(world, 'append_line', {
    document: 'Journal piscine',
    line: 'pH 7,2',
    add_time: false,
    collection: 'jardin',
  });
  assert.equal(outputs.created, true);
  const created = world.server.state.documents.find((d) => d.title === 'Journal piscine');
  assert.equal(created.text, 'pH 7,2');
  assert.equal(created.collectionId, '04ec56b8-04ee-4e7c-97ce-8d7434dd9023');
  assert.equal(
    (await failure(world, 'append_line', { document: `${HOST}/doc/x-zzzzzzzzzz`, line: 'x' })).en,
    'No document "http://192.0.2.50:3000/doc/x-zzzzzzzzzz": enter its title, its address or a collection to create it.',
  );
});

test('two lines at once both land in the document', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await Promise.all([
    run(world, 'append_line', { document: 'Journal chaudière', line: 'A', add_time: false }),
    run(world, 'append_line', { document: 'Journal chaudière', line: 'B', add_time: false }),
  ]);
  assert.ok(journalOf(world).text.endsWith('\n\nA\n\nB'));
});

test('create_document: published in the collection, its address returned', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const outputs = await run(world, 'create_document', {
    collection: 'Maison',
    title: 'Rapport de novembre',
    text: '# Bilan\n\nTout va bien.',
  });
  const document = world.server.state.documents.find((d) => d.id === outputs.document_id);
  assert.equal(document.text, '# Bilan\n\nTout va bien.');
  assert.equal(outputs.url, `${HOST}${document.url}`);
  assert.equal(outputs.title, 'Rapport de novembre');
  await world.hub.refresh();
  assert.equal(changed(world.fake).length, 0);
});

test('scene actions: every failure is an error in four languages', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  assert.match(
    (await failure(world, 'create_document', { collection: 'Grenier', title: 'X' })).fr,
    /Aucune collection nommée « Grenier »/,
  );
  assert.match((await failure(world, 'create_document', { title: 'X' })).de, /Gib die Sammlung/);
  assert.match((await failure(world, 'create_document', { collection: 'Maison' })).es, /título/);
  assert.match((await failure(world, 'append_line', { line: 'x' })).en, /Enter the document/);
  assert.match(
    (await failure(world, 'append_line', { document: 'Alarme', line: ' ' })).en,
    /Enter the line/,
  );
  world.server.state.rateLimited = true;
  assert.match(
    (await failure(world, 'create_document', { collection: 'Maison', title: 'X' })).fr,
    /limite les requêtes/,
  );
  world.server.state.rateLimited = false;
  world.server.goDown();
  assert.match(
    (await failure(world, 'append_line', { document: 'Alarme', line: 'x' })).fr,
    /Outline ne répond pas/,
  );
});

test('a read-only key reads everything, and writing says why it cannot', async (t) => {
  const world = await createWorld({ config: { url: HOST, api_key: READ_ONLY_KEY } });
  t.after(() => world.app.stop());
  assert.equal(world.fake.connectionStatus.connected, true);
  assert.match(
    (await failure(world, 'append_line', { document: 'Alarme', line: 'x' })).fr,
    /clé d'API ne permet pas/,
  );
  assert.match(
    (await failure(world, 'create_document', { collection: 'Maison', title: 'X' })).en,
    /may not do this/,
  );
});

test('search_documents: the best match and the count, an excerpt in plain text', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const outputs = await run(world, 'search_documents', { query: 'chaudière' });
  assert.equal(outputs.count, 2);
  assert.equal(outputs.title, 'Journal chaudière');
  assert.equal(outputs.collection, 'Jardin');
  assert.doesNotMatch(outputs.excerpt, /<b>/);
  assert.match(outputs.excerpt, /chaudière|Premier jour/);
  const inHome = await run(world, 'search_documents', { query: 'chaudière', collection: 'Maison' });
  assert.equal(inHome.count, 1);
  assert.equal(inHome.title, 'Chaudière');
  assert.equal(inHome.excerpt, 'Entretien annuel de la chaudière.');
  assert.match(
    (await failure(world, 'search_documents', { query: 'piscine' })).fr,
    /Aucun document ne correspond à « piscine »/,
  );
  assert.match((await failure(world, 'search_documents', { query: '' })).en, /words to search/);
});

test('widget: counters, the documents changed last, a collection, counters hidden', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const get = async (settings, language = 'fr') => {
    const ack = await world.fake.widgetGet('documents', { settings, language });
    assert.equal(ack.success, true, JSON.stringify(ack.error));
    validateWidgetContent(ack.data.content);
    return ack.data.content.components;
  };
  const all = await get({});
  assert.deepEqual(
    all.filter((c) => c.type === 'value').map((c) => [c.label, c.value]),
    [
      ['Documents', 3],
      ['Collections', 2],
    ],
  );
  const list = all.find((c) => c.type === 'card-list');
  assert.deepEqual(
    list.items.map((i) => i.title),
    ['Journal chaudière', 'Alarme', 'Chaudière'],
  );
  assert.match(list.items[0].subtitle, /^Jardin · Alice Martin · 22 nov\./);
  assert.equal(list.items[0].links, undefined, 'no link to an http Outline');
  const garden = await get({ collection: 'jardin', hide_counters: false });
  assert.deepEqual(
    garden.filter((c) => c.type === 'value').map((c) => [c.label, c.value]),
    [['Jardin', 1]],
  );
  assert.match(garden.find((c) => c.type === 'card-list').items[0].subtitle, /^Alice Martin/);
  const hidden = await get({ hide_counters: true });
  assert.equal(hidden.filter((c) => c.type === 'value').length, 0);
  const unknown = await get({ collection: 'Grenier' }, 'en');
  assert.deepEqual(
    unknown.filter((c) => c.type === 'text').map((c) => c.text),
    ['No collection by this name: check the widget settings.', 'No document to show yet.'],
  );
  world.server.goDown();
  await world.hub.refresh();
  const down = await get({ collection: 'Jardin' }, 'de');
  assert.ok(down.some((c) => c.text === 'Outline antwortet gerade nicht.'));
  assert.equal(down.find((c) => c.type === 'card-list').items.length, 1, 'last read kept');
});

test('widget links to Outline over https; waiting before the first read', async (t) => {
  const server = createOutline();
  const https = await createWorld({
    server,
    config: { url: 'https://192.0.2.50', api_key: API_KEY },
  });
  t.after(() => https.app.stop());
  const ack = await https.fake.widgetGet('documents', { settings: {}, language: 'es' });
  const item = ack.data.content.components.find((c) => c.type === 'card-list').items[0];
  assert.deepEqual(item.links, [
    { url: 'https://192.0.2.50/doc/journal-chaudiere-wWtvmGFB7F', label: 'Abrir en Outline' },
  ]);
  const none = await createWorld({ config: {} });
  t.after(() => none.app.stop());
  const waiting = await none.fake.widgetGet('documents', { settings: {}, language: 'fr' });
  assert.match(waiting.data.content.components[0].text, /En attente d'Outline/);
});

test('connection status: missing settings, a key Outline refuses, down and back, not Outline', async (t) => {
  const statusOf = (world) => world.fake.connectionStatus;
  const none = await createWorld({ config: {} });
  t.after(() => none.app.stop());
  assert.equal(statusOf(none).connected, false);
  assert.match(statusOf(none).message.fr, /Saisissez l'adresse/);
  const noKey = await createWorld({ config: { url: HOST } });
  t.after(() => noKey.app.stop());
  assert.match(statusOf(noKey).message.en, /Enter an API key/);
  const invalid = await createWorld({ config: { url: 'ftp://x', api_key: API_KEY } });
  t.after(() => invalid.app.stop());
  assert.match(statusOf(invalid).message.en, /not valid/);
  const revoked = await createWorld({ config: { url: HOST, api_key: 'ol_api_revoked' } });
  t.after(() => revoked.app.stop());
  assert.equal(statusOf(revoked).connected, false);
  assert.match(statusOf(revoked).message.en, /did not accept the API key/);
  assert.equal(revoked.fake.discoveredDevices.length, 0);
  const world = await createWorld();
  t.after(() => world.app.stop());
  assert.equal(statusOf(world).connected, true);
  world.server.goDown();
  await world.hub.refresh();
  assert.equal(statusOf(world).connected, false);
  assert.match(statusOf(world).message.de, /antwortet nicht/);
  world.server.goUp();
  world.server.state.html = true;
  await world.hub.refresh();
  assert.match(statusOf(world).message.es, /no responde como Outline/);
  world.server.state.html = false;
  world.server.state.rateLimited = true;
  await world.hub.refresh();
  assert.match(statusOf(world).message.fr, /limite les requêtes/);
  world.server.state.rateLimited = false;
  await world.hub.refresh();
  assert.equal(statusOf(world).connected, true);
});

test('test_connection: green with the counts, red when Outline does not answer', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const ok = await world.fake.action('test_connection');
  assert.equal(ok.success, true);
  assert.match(JSON.stringify(ok.data), /3 document\(s\) dans 2 collection\(s\)/);
  world.server.goDown();
  const ko = await world.fake.action('test_connection');
  assert.equal(ko.success, false);
  assert.match(ko.error.fr, /Outline ne répond pas/);
  const none = await createWorld({ config: {} });
  t.after(() => none.app.stop());
  const missing = await none.fake.action('test_connection');
  assert.equal(missing.success, false);
  assert.match(missing.error.en, /Enter the address/);
});

test('the language changes the names, not the device', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const before = world.fake.discoveredDevices[0];
  assert.equal(before.features[1].name, 'Documents');
  assert.equal(before.features[0].name, 'Joignable');
  await world.fake.configUpdated({ ...CONFIG, language: 'de' });
  await settle(20);
  const after = world.fake.discoveredDevices[0];
  assert.equal(after.external_id, before.external_id);
  assert.equal(after.features[0].name, 'Erreichbar');
  assert.equal(after.features[1].name, 'Dokumente');
});

test('http redirected to https on the same host: followed with the key, kept', async (t) => {
  const server = createOutline();
  server.state.redirect = 'https';
  const world = await createWorld({ server });
  t.after(() => world.app.stop());
  assert.equal(world.fake.connectionStatus.connected, true);
  const last = server.state.requests.at(-1);
  assert.match(last.url, /^https:\/\/192\.0\.2\.50:3000\/api\//);
  assert.equal(last.key, API_KEY);
  const count = server.state.requests.length;
  await world.hub.refresh();
  assert.ok(
    server.state.requests.slice(count).every((r) => r.url.startsWith('https://')),
    'the https address is kept',
  );
});

test('a redirect elsewhere, or a proxy error page, is told for what it is', async (t) => {
  const server = createOutline();
  server.state.redirect = 'elsewhere';
  const world = await createWorld({ server });
  t.after(() => world.app.stop());
  assert.match(world.fake.connectionStatus.message.fr, /Outline répond à une autre adresse/);
  server.state.redirect = null;
  await world.hub.refresh();
  await createAll(world.fake);
  server.state.proxyError = 502;
  await world.hub.refresh();
  assert.match(world.fake.connectionStatus.message.en, /Outline does not answer/);
  assert.equal(world.fake.lastState(mainFeature('reachable')), 0);
});

test('a refused key or a rate limit: Outline answers, reachable stays 1', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createAll(world.fake);
  world.server.state.rateLimited = true;
  await world.hub.refresh();
  assert.equal(world.fake.connectionStatus.connected, false);
  assert.equal(world.fake.lastState(mainFeature('reachable')), 1);
});

test('a wiki of 25 documents all changed is no burst: every change announced', async (t) => {
  const server = createOutline();
  server.state.documents = [];
  const world = await createWorld({ server });
  t.after(() => world.app.stop());
  for (let i = 0; i < 25; i += 1) {
    server.edit(`Page ${i}`);
  }
  for (let i = 0; i < 3; i += 1) {
    await world.hub.refresh();
  }
  assert.equal(changed(world.fake).length, 25);
});

test('append_line finds the exact title behind many longer ones', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  for (let i = 0; i < 130; i += 1) {
    world.server.edit(`Journal chaudière ${i}`);
  }
  const outputs = await run(world, 'append_line', {
    document: 'Journal chaudière',
    line: 'x',
    collection: 'Maison',
  });
  assert.equal(outputs.created, false);
  assert.equal(outputs.document_id, 'f7258c5c-bdc7-49b0-bd03-61d65bbf1407');
});

test('append_line: an address that is not a document is never taken as a title', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const count = world.server.state.documents.length;
  const error = await failure(world, 'append_line', {
    document: `${HOST}/s/abcdef`,
    line: 'x',
    collection: 'Maison',
  });
  assert.match(error.fr, /Aucun document/);
  assert.equal(world.server.state.documents.length, count);
});
