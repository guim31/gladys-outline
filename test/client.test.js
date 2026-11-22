// -----------------------------------------------------------------------------
// The Outline client on the answers recorded on a real Outline 1.13.0
// (test/fixtures/outline/1.13.0/), the configuration and the model helpers.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig, normalizeUrl } from '../src/config.js';
import { OutlineClient, OutlineError } from '../src/outline/client.js';
import {
  findCollection,
  lineToAppend,
  parseDocumentRef,
  plainContext,
  summarizeDocument,
} from '../src/outline/model.js';
import { HOST, fixture } from './helpers/fakeOutline.js';

/** A client whose every request gets one recorded answer. */
function replay(name) {
  const recorded = fixture(name);
  const sent = [];
  const client = new OutlineClient({
    url: HOST,
    apiKey: 'ol_api_x',
    fetch: async (url, init) => {
      sent.push({ url, body: JSON.parse(init.body), headers: init.headers });
      return new Response(JSON.stringify(recorded.body), {
        status: recorded.status,
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  return { client, sent, recorded };
}

async function kindOf(promise) {
  try {
    await promise;
  } catch (err) {
    assert.ok(err instanceof OutlineError, err);
    return [err.kind, err.message];
  }
  throw new Error('no error');
}

test('documents.list: the 25 changed last and the total, newest first', async () => {
  const { client, sent } = replay('documents-list-after');
  const { documents, total } = await client.recentDocuments();
  assert.equal(total, 3);
  assert.equal(documents[0].title, 'Journal chaudière');
  assert.equal(sent[0].url, `${HOST}/api/documents.list`);
  assert.deepEqual(sent[0].body, { sort: 'updatedAt', direction: 'DESC', limit: 25 });
  assert.equal(sent[0].headers.Authorization, 'Bearer ol_api_x');
});

test('collections, search, version, info, create and append on recorded answers', async () => {
  const collections = await replay('collections-list').client.collections();
  assert.equal(collections.total, 2);
  assert.deepEqual(
    collections.collections.map((c) => c.name),
    ['Jardin', 'Maison'],
  );
  const search = await replay('documents-search').client.search('chaudière');
  assert.equal(search.total, 2);
  assert.match(search.results[0].context, /<b>chaudière<\/b>/);
  assert.equal(await replay('installation-info').client.version(), '1.13.0');
  assert.equal(await replay('auth-info-bad-key').client.version(), '');
  const info = await replay('documents-info-uuid').client.document('x');
  assert.equal(info.urlId, 'wWtvmGFB7F');
  assert.equal(await replay('documents-info-missing').client.document('zzzzzzzzzz'), null);
  const created = await replay('documents-create').client.createDocument({
    collectionId: 'c',
    title: 'Journal chaudière',
    text: 'Premier jour.',
  });
  assert.equal(created.text, 'Premier jour.');
  const append = replay('documents-update-append-newline');
  const appended = await append.client.appendText('id', '\n\nx');
  assert.match(appended.text, /\n\n2026-11-22 12:05 — Deuxième ligne\.$/);
  assert.deepEqual(append.sent[0].body, { id: 'id', text: '\n\nx', append: true });
});

test('errors: a wrong key, a read-only key, an unknown collection, 429, HTML, down', async () => {
  assert.deepEqual(await kindOf(replay('auth-info-bad-key').client.recentDocuments()), [
    'unauthorized',
    'Unable to decode token',
  ]);
  assert.deepEqual(
    await kindOf(
      replay('ro-documents-create').client.createDocument({ collectionId: 'c', title: 'X' }),
    ),
    ['forbidden', 'API key does not have access to this resource'],
  );
  assert.deepEqual(await kindOf(replay('documents-create-bad-collection').client.collections()), [
    'forbidden',
    'Authorization error',
  ]);
  const answer = (response) =>
    new OutlineClient({ url: HOST, apiKey: 'k', fetch: async () => response });
  assert.equal(
    (
      await kindOf(
        answer(
          new Response(JSON.stringify({ ok: false, error: 'rate_limit_exceeded', status: 429 }), {
            status: 429,
          }),
        ).recentDocuments(),
      )
    )[0],
    'rate_limited',
  );
  assert.equal(
    (await kindOf(answer(new Response('<html>', { status: 200 })).recentDocuments()))[0],
    'invalid',
  );
  const down = new OutlineClient({
    url: HOST,
    apiKey: 'k',
    fetch: async () => {
      throw new TypeError('fetch failed', { cause: { code: 'EHOSTUNREACH' } });
    },
  });
  assert.deepEqual(await kindOf(down.recentDocuments()), [
    'unreachable',
    'Outline unreachable (EHOSTUNREACH)',
  ]);
});

test('the address: http by default, a reverse proxy path kept, a pasted page dropped', () => {
  assert.equal(normalizeUrl('192.0.2.10:3000'), 'http://192.0.2.10:3000');
  assert.equal(normalizeUrl(' https://example.org/wiki/ '), 'https://example.org/wiki');
  assert.equal(
    normalizeUrl('https://team.getoutline.com/doc/journal-wWtvmGFB7F'),
    'https://team.getoutline.com',
  );
  assert.equal(normalizeUrl('http://192.0.2.10:3000/api/auth.info'), 'http://192.0.2.10:3000');
  assert.equal(
    normalizeUrl('https://example.org/wiki/collection/maison-PYCr0f9oiY'),
    'https://example.org/wiki',
  );
  assert.equal(normalizeUrl('ftp://x'), null);
  assert.equal(normalizeUrl('http://user:pass@x'), null);
  const config = normalizeConfig({ url: 'x', api_key: ' Bearer ol_api_k ', refresh_minutes: '7' });
  assert.equal(config.apiKey, 'ol_api_k');
  assert.equal(config.refreshMinutes, 15);
  assert.equal(config.language, 'fr');
});

test('a document named by its address, its id or its title', () => {
  assert.deepEqual(parseDocumentRef('https://wiki.example/doc/journal-chaudiere-wWtvmGFB7F'), {
    id: 'wWtvmGFB7F',
  });
  assert.deepEqual(parseDocumentRef('http://x/doc/wWtvmGFB7F#h'), { id: 'wWtvmGFB7F' });
  assert.deepEqual(parseDocumentRef('f7258c5c-bdc7-49b0-bd03-61d65bbf1407'), {
    id: 'f7258c5c-bdc7-49b0-bd03-61d65bbf1407',
  });
  assert.deepEqual(parseDocumentRef(' Journal chaudière '), { title: 'Journal chaudière' });
  assert.deepEqual(parseDocumentRef(''), {});
  const collections = fixture('collections-list').body.data;
  assert.equal(findCollection(collections, ' MAISON ').name, 'Maison');
  assert.equal(
    findCollection(collections, 'https://x/collection/jardin-jBq1bhQFYc').name,
    'Jardin',
  );
  assert.equal(findCollection(collections, 'Grenier'), undefined);
});

test('model: a summary with the collection name, lines glued as paragraphs, plain excerpts', () => {
  const [document] = fixture('documents-list-after').body.data;
  const names = new Map([[document.collectionId, 'Jardin']]);
  assert.deepEqual(summarizeDocument(document, HOST, names), {
    id: 'f7258c5c-bdc7-49b0-bd03-61d65bbf1407',
    title: 'Journal chaudière',
    collectionId: '04ec56b8-04ee-4e7c-97ce-8d7434dd9023',
    collection: 'Jardin',
    author: 'Alice Martin',
    created: '2026-11-22T11:28:22.745Z',
    updated: '2026-11-22T11:28:24.261Z',
    url: `${HOST}/doc/journal-chaudiere-wWtvmGFB7F`,
  });
  assert.equal(lineToAppend('', 'a'), 'a');
  assert.equal(lineToAppend('Premier jour.', 'a'), '\n\na');
  assert.equal(
    plainContext('Entretien de la <b>chaudière</b> &amp; co'),
    'Entretien de la chaudière & co',
  );
});
