// -----------------------------------------------------------------------------
// The RPC API of Outline (`POST <base>/api/<method>`, JSON body), the few calls
// the integration needs, authenticated by a personal API key
// (`Authorization: Bearer ol_api_...`). Outline Cloud has the same API.
//
// Facts checked on a real server, Outline 1.13.0 (outlinewiki/outline), see
// test/fixtures/outline/1.13.0/:
// - success: HTTP 200 `{ data, pagination?, policies, status, ok: true }`;
//   lists carry `pagination: { limit, offset, nextPath, total }` (`total`
//   counts every item, so one request of `limit: 25` gives the number of
//   documents and the 25 changed last); `limit` is 100 at most;
// - failure: `{ ok: false, error, status, message }` with the HTTP status:
//   401 `authentication_required` (wrong, revoked or expired key), 403
//   `authorization_error` (a key whose scopes do not allow the method, an
//   unknown collection id), 404 `not_found`, 400 `validation_error`, 429
//   when the rate limiter is on (default on a self-hosted Outline);
// - rate limits, per IP: 1000 requests a minute overall, 100 a minute for
//   documents.list/search/update, 25 a minute for documents.create;
// - `documents.update` with `append: true` glues the text to the end as is,
//   without a line break: the caller adds it;
// - document `url` is relative (`/doc/<slug>-<urlId>`); `documents.info`
//   takes the UUID or the 10-character `urlId`.
// -----------------------------------------------------------------------------

export const DEFAULT_TIMEOUT = 15_000;
/** The documents read at each refresh, the newest change first. */
export const WINDOW = 25;
const PAGE = 100;
const MAX_COLLECTION_PAGES = 10;

export class OutlineError extends Error {
  /**
   * @param {'unreachable' | 'unauthorized' | 'forbidden' | 'not_found' | 'rate_limited' | 'timeout' | 'http' | 'invalid' | 'rejected'} kind
   * @param {string} message never carries a credential
   * @param {number} [status]
   */
  constructor(kind, message, status) {
    super(message);
    this.name = 'OutlineError';
    this.kind = kind;
    this.status = status;
  }
}

const KIND_OF_STATUS = {
  400: 'rejected',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  429: 'rate_limited',
};

const oneLine = (text) =>
  String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);

export class OutlineClient {
  /**
   * @param {object} options
   * @param {string} options.url normalized base URL (see normalizeUrl)
   * @param {string} options.apiKey
   * @param {typeof fetch} [options.fetch]
   * @param {number} [options.timeout]
   */
  constructor({ url, apiKey, fetch: fetchImpl, timeout }) {
    this.url = url;
    this.authorization = `Bearer ${apiKey}`;
    this.fetch = fetchImpl ?? globalThis.fetch;
    this.timeout = timeout ?? DEFAULT_TIMEOUT;
  }

  /** One RPC call: the whole answer, `{ data, pagination }`. */
  async call(method, body = {}) {
    let response;
    let raw;
    try {
      response = await this.fetch(`${this.url}/api/${method}`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: this.authorization,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeout),
        redirect: 'follow',
      });
      raw = await response.text();
    } catch (err) {
      if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
        throw new OutlineError('timeout', `No answer from Outline within ${this.timeout} ms`);
      }
      const cause = err?.cause?.code ?? err?.cause?.message ?? err?.message ?? 'error';
      throw new OutlineError('unreachable', `Outline unreachable (${cause})`);
    }
    let answer;
    try {
      answer = JSON.parse(raw);
    } catch {
      // An HTML page (not Outline, a wrong path, a proxy login page...).
      if (response.status === 429) {
        throw new OutlineError('rate_limited', 'HTTP 429', 429);
      }
      throw new OutlineError(
        'invalid',
        `HTTP ${response.status}: the answer is not JSON (is this Outline?)`,
        response.status,
      );
    }
    if (!response.ok || answer?.ok === false) {
      const status = response.ok ? Number(answer?.status) : response.status;
      const detail = oneLine(answer?.message || answer?.error || `HTTP ${status}`);
      throw new OutlineError(KIND_OF_STATUS[status] ?? 'http', detail, status);
    }
    if (!answer || typeof answer !== 'object' || !('data' in answer)) {
      throw new OutlineError('invalid', 'The answer has no data (is this Outline?)');
    }
    return answer;
  }

  /** The version of a self-hosted Outline, or '' (Outline Cloud, an old one). */
  async version() {
    try {
      const { data } = await this.call('installation.info');
      return typeof data?.version === 'string' ? data.version.slice(0, 40) : '';
    } catch {
      return '';
    }
  }

  /**
   * The documents changed last (published ones the key may read) and how
   * many there are in all.
   * @param {{ collectionId?: string, limit?: number }} [options]
   * @returns {Promise<{ documents: object[], total: number }>}
   */
  async recentDocuments({ collectionId, limit = WINDOW } = {}) {
    const answer = await this.call('documents.list', {
      sort: 'updatedAt',
      direction: 'DESC',
      limit,
      ...(collectionId ? { collectionId } : {}),
    });
    if (!Array.isArray(answer.data)) {
      throw new OutlineError('invalid', 'Outline did not answer its documents');
    }
    const documents = answer.data.filter(isDocument);
    const total = Number(answer.pagination?.total);
    return { documents, total: Number.isInteger(total) ? total : documents.length };
  }

  /**
   * Every collection the key may read (100 per request).
   * @returns {Promise<{ collections: object[], total: number }>}
   */
  async collections() {
    const collections = [];
    let total = 0;
    for (let page = 0; page < MAX_COLLECTION_PAGES; page += 1) {
      const answer = await this.call('collections.list', { limit: PAGE, offset: page * PAGE });
      if (!Array.isArray(answer.data)) {
        throw new OutlineError('invalid', 'Outline did not answer its collections');
      }
      const items = answer.data.filter(
        (c) => typeof c?.id === 'string' && typeof c.name === 'string',
      );
      collections.push(...items);
      const counted = Number(answer.pagination?.total);
      total = Number.isInteger(counted) ? counted : collections.length;
      if (answer.data.length < PAGE || collections.length >= total) {
        break;
      }
    }
    return { collections, total: Math.max(total, collections.length) };
  }

  /** One document by its UUID or urlId; null when there is none. */
  async document(id) {
    try {
      const { data } = await this.call('documents.info', { id });
      return isDocument(data) ? data : null;
    } catch (err) {
      // An id Outline cannot parse is a 400: no such document either.
      if (err instanceof OutlineError && ['not_found', 'rejected'].includes(err.kind)) {
        return null;
      }
      throw err;
    }
  }

  /** Documents whose title matches, the best first. */
  async searchTitles(query) {
    const { data } = await this.call('documents.search_titles', { query, limit: 25 });
    return Array.isArray(data) ? data.filter(isDocument) : [];
  }

  /**
   * Full-text search.
   * @returns {Promise<{ results: { context: string, document: object }[], total: number }>}
   */
  async search(query, { collectionId, limit = 5 } = {}) {
    const answer = await this.call('documents.search', {
      query,
      limit,
      ...(collectionId ? { collectionId } : {}),
    });
    const results = (Array.isArray(answer.data) ? answer.data : []).filter((r) =>
      isDocument(r?.document),
    );
    const total = Number(answer.pagination?.total);
    return { results, total: Number.isInteger(total) ? total : results.length };
  }

  /** A new published document in a collection. */
  async createDocument({ collectionId, title, text }) {
    const { data } = await this.call('documents.create', {
      collectionId,
      title,
      text,
      publish: true,
    });
    if (!isDocument(data)) {
      throw new OutlineError('invalid', 'Outline did not answer the document');
    }
    return data;
  }

  /** Text glued at the end of a document (Outline adds no line break). */
  async appendText(id, text) {
    const { data } = await this.call('documents.update', { id, text, append: true });
    if (!isDocument(data)) {
      throw new OutlineError('invalid', 'Outline did not answer the document');
    }
    return data;
  }
}

function isDocument(document) {
  return typeof document?.id === 'string' && typeof document.updatedAt === 'string';
}
