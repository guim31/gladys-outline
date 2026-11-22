// -----------------------------------------------------------------------------
// A fake Outline behind a `fetch` function: it starts from the bodies recorded
// on a real Outline 1.13.0 (test/fixtures/outline/1.13.0/), keeps documents
// and collections in memory, and answers the errors the real server answers
// (401 for a wrong key, 403 for a read-only key that writes or an unknown
// collection, 404, 429, an HTML page elsewhere).
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

export const HOST = 'http://192.0.2.50:3000';
export const API_KEY = 'ol_api_TestKeyForTheFakeOutline0000000000';
export const READ_ONLY_KEY = 'ol_api_ReadOnlyKeyForTheFakeOutline00000';
// Half an hour after the fixtures were recorded (11:28 UTC).
export const NOW = Date.parse('2026-11-22T12:00:00.000Z');

export const fixture = (name) =>
  JSON.parse(
    readFileSync(new URL(`../fixtures/outline/1.13.0/${name}.json`, import.meta.url), 'utf8'),
  );

export const settle = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

const urlIdChars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

export function createOutline() {
  const recorded = fixture('documents-list-after').body.data;
  const collections = fixture('collections-list').body.data;
  const author = recorded[0].updatedBy;
  const state = {
    documents: structuredClone(recorded),
    collections: structuredClone(collections),
    down: false,
    html: false,
    rateLimited: false,
    /** 'https': http is redirected to https (FORCE_HTTPS); 'elsewhere': to another host */
    redirect: null,
    /** an HTML error page of a reverse proxy, e.g. 502 */
    proxyError: null,
    requests: [],
    clock: Date.parse('2026-11-22T11:30:00.000Z'),
    counter: 0,
  };
  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  const failure = (status, error, message) => json({ ok: false, error, status, message }, status);
  const tick = () => {
    state.clock += 60_000;
    return new Date(state.clock).toISOString();
  };
  const newUrlId = () => {
    state.counter += 1;
    return `Fake${String(state.counter).padStart(6, '0')}`.slice(0, 10);
  };
  const newId = () => {
    state.counter += 1;
    return `00000000-0000-4000-8000-${String(state.counter).padStart(12, '0')}`;
  };
  const slug = (title) =>
    title
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  const findDocument = (id) => state.documents.find((d) => d.id === id || d.urlId === id);
  const byNewest = (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
  const page = (items, limit, offset, path) =>
    json({
      pagination: {
        limit,
        offset,
        nextPath: `/api/${path}?limit=${limit}&offset=${offset + limit}`,
        total: items.length,
      },
      data: items.slice(offset, offset + limit),
      policies: [],
      status: 200,
      ok: true,
    });
  const one = (data) => json({ data, policies: [], status: 200, ok: true });

  const routes = {
    'installation.info': () => one(fixture('installation-info').body.data),
    'documents.list': (body) => {
      const limit = Math.min(Number(body.limit ?? 25), 100);
      const offset = Number(body.offset ?? 0);
      if (body.collectionId && !state.collections.some((c) => c.id === body.collectionId)) {
        return failure(403, 'authorization_error', 'Authorization error');
      }
      const items = state.documents
        .filter((d) => !body.collectionId || d.collectionId === body.collectionId)
        .sort(byNewest);
      return page(items, limit, offset, 'documents.list');
    },
    'collections.list': (body) => {
      const limit = Math.min(Number(body.limit ?? 25), 100);
      return page(state.collections, limit, Number(body.offset ?? 0), 'collections.list');
    },
    'documents.info': (body) => {
      const document = findDocument(body.id);
      if (!document) {
        return failure(404, 'not_found', 'Resource not found');
      }
      return one(structuredClone(document));
    },
    'documents.search_titles': (body) => {
      // Like Outline: the newest first, `limit` per page, no total.
      const query = String(body.query).toLowerCase();
      const limit = Math.min(Number(body.limit ?? 25), 100);
      const offset = Number(body.offset ?? 0);
      const items = state.documents
        .filter((d) => d.title.toLowerCase().includes(query))
        .sort(byNewest);
      return json({
        pagination: { limit, offset },
        data: items.slice(offset, offset + limit),
        policies: [],
        ok: true,
      });
    },
    'documents.search': (body) => {
      const query = String(body.query).toLowerCase();
      const items = state.documents
        .filter((d) => !body.collectionId || d.collectionId === body.collectionId)
        .filter((d) => `${d.title} ${d.text}`.toLowerCase().includes(query))
        .map((document) => ({
          ranking: 0.6,
          context: document.text.replace(new RegExp(query, 'ig'), (m) => `<b>${m}</b>`),
          document,
        }));
      return page(items, Number(body.limit ?? 25), 0, 'documents.search');
    },
    'documents.create': (body, key) => {
      if (key === READ_ONLY_KEY) {
        return failure(403, 'authorization_error', 'API key does not have access to this resource');
      }
      const collection = state.collections.find((c) => c.id === body.collectionId);
      if (!collection) {
        return failure(403, 'authorization_error', 'Authorization error');
      }
      const at = tick();
      const urlId = newUrlId();
      const document = {
        ...structuredClone(recorded[0]),
        id: newId(),
        urlId,
        url: `/doc/${slug(body.title)}-${urlId}`,
        path: `/doc/${slug(body.title)}-${urlId}`,
        title: body.title,
        text: body.text ?? '',
        collectionId: collection.id,
        createdAt: at,
        updatedAt: at,
        publishedAt: at,
        createdBy: author,
        updatedBy: author,
      };
      state.documents.push(document);
      return one(structuredClone(document));
    },
    'documents.update': (body, key) => {
      if (key === READ_ONLY_KEY) {
        return failure(403, 'authorization_error', 'API key does not have access to this resource');
      }
      const document = findDocument(body.id);
      if (!document) {
        return failure(404, 'not_found', 'Resource not found');
      }
      document.text = body.append ? `${document.text}${body.text}` : body.text;
      document.updatedAt = tick();
      return one(structuredClone(document));
    },
  };

  async function fetch(url, init = {}) {
    if (state.down) {
      throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
    }
    const target = new URL(url);
    const method = target.pathname.replace(/^\/api\//, '');
    const body = JSON.parse(init.body ?? '{}');
    const key = String(init.headers?.Authorization ?? '').replace(/^Bearer /, '');
    state.requests.push({ method, body, url: target.href, key });
    if (state.redirect && target.protocol === 'http:') {
      const location =
        state.redirect === 'https'
          ? `https://${target.host}${target.pathname}`
          : `https://login.example.org/sso`;
      return new Response('', { status: 308, headers: { location } });
    }
    if (state.proxyError) {
      return new Response('<html><body>Bad Gateway</body></html>', {
        status: state.proxyError,
        headers: { 'content-type': 'text/html' },
      });
    }
    if (state.html || !target.pathname.startsWith('/api/')) {
      return new Response('<!doctype html><html><body>Not here</body></html>', {
        status: 404,
        headers: { 'content-type': 'text/html' },
      });
    }
    if (key !== API_KEY && key !== READ_ONLY_KEY) {
      return json(fixture('auth-info-bad-key').body, 401);
    }
    if (state.rateLimited) {
      return failure(429, 'rate_limit_exceeded', 'Rate limit exceeded for this operation');
    }
    const route = routes[method];
    if (!route) {
      return failure(404, 'not_found', 'Resource not found');
    }
    return route(body, key);
  }

  return {
    fetch,
    state,
    goDown: () => {
      state.down = true;
    },
    goUp: () => {
      state.down = false;
    },
    /** A document created or saved in Outline by someone (not the integration). */
    edit(title, { collection = 'Maison', text = 'Texte.', by = 'Bob Durand' } = {}) {
      const at = tick();
      const existing = state.documents.find((d) => d.title === title);
      const user = { ...author, id: 'b0b00000-0000-4000-8000-000000000000', name: by };
      if (existing) {
        existing.updatedAt = at;
        existing.updatedBy = user;
        return existing;
      }
      const urlId = Array.from(
        { length: 10 },
        (_, i) => urlIdChars[(state.counter * 7 + i * 13) % urlIdChars.length],
      ).join('');
      state.counter += 1;
      const document = {
        ...structuredClone(recorded[0]),
        id: newId(),
        urlId,
        url: `/doc/${slug(title)}-${urlId}`,
        path: `/doc/${slug(title)}-${urlId}`,
        title,
        text,
        collectionId: state.collections.find((c) => c.name === collection).id,
        createdAt: at,
        updatedAt: at,
        publishedAt: at,
        createdBy: user,
        updatedBy: user,
      };
      state.documents.push(document);
      return document;
    },
  };
}
