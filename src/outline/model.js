// -----------------------------------------------------------------------------
// Outline answers -> plain values, and what users type in scenes (a
// collection, a document, a line for a journal) -> what the API wants.
// -----------------------------------------------------------------------------

const clean = (value) => (typeof value === 'string' ? value.trim() : '');

/** `Maison`, ` maison ` and `MAISON` name the same collection. */
export const nameKey = (value) =>
  clean(typeof value === 'number' ? String(value) : value)
    .normalize('NFC')
    .toLocaleLowerCase();

/** The absolute address of a document or collection (Outline answers `/doc/...`). */
export function absoluteUrl(baseUrl, relative) {
  const path = clean(relative);
  if (/^https?:\/\//i.test(path)) {
    return path;
  }
  return path.startsWith('/') ? `${baseUrl}${path}` : '';
}

/**
 * A document of the API as the integration keeps it.
 * @param {object} document
 * @param {string} baseUrl
 * @param {Map<string, string>} collectionNames id -> name
 */
export function summarizeDocument(document, baseUrl, collectionNames = new Map()) {
  return {
    id: document.id,
    title: clean(document.title) || '—',
    collectionId: typeof document.collectionId === 'string' ? document.collectionId : '',
    collection: collectionNames.get(document.collectionId) ?? '',
    author: clean(document.updatedBy?.name) || clean(document.createdBy?.name),
    created: document.createdAt,
    updated: document.updatedAt,
    url: absoluteUrl(baseUrl, document.url),
  };
}

/**
 * What the user typed to name a document: its address (`.../doc/slug-AbCdE12345`),
 * its UUID or its urlId give an id; anything else is a title.
 * @param {unknown} raw
 * @returns {{ id?: string, title?: string }}
 */
export function parseDocumentRef(raw) {
  const text = clean(typeof raw === 'number' ? String(raw) : raw).slice(0, 2000);
  if (text === '') {
    return {};
  }
  const uuid = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  const fromUrl = text.match(/\/doc\/(?:[^/?#]*-)?([A-Za-z0-9]{10})(?:[/?#]|$)/);
  if (fromUrl) {
    return { id: fromUrl[1] };
  }
  if (uuid && uuid[0].length === text.length) {
    return { id: uuid[0] };
  }
  return { title: text.slice(0, 255) };
}

/**
 * The collection named by the user, by name (case and spaces aside), id or
 * address; undefined when none matches.
 */
export function findCollection(collections, raw) {
  const wanted = nameKey(raw);
  if (wanted === '') {
    return undefined;
  }
  return (
    collections.find((c) => nameKey(c.name) === wanted) ??
    collections.find(
      (c) =>
        c.id === clean(raw) ||
        (typeof c.urlId === 'string' && clean(raw).includes(c.urlId) && c.urlId.length >= 8),
    )
  );
}

/** `2026-10-30 08:15`, in the time zone of Gladys (TZ, set by its supervisor). */
export function stamp(time) {
  const date = new Date(time);
  const two = (n) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ` +
    `${two(date.getHours())}:${two(date.getMinutes())}`
  );
}

/** A date for the "latest change" feature and the widget, short and localized. */
export function shortDate(iso, language) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleString(
    { en: 'en-GB', fr: 'fr-FR', de: 'de-DE', es: 'es-ES' }[language] ?? 'en-GB',
    { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' },
  );
}

/**
 * The text to append for one more line: Outline glues it to the end as is,
 * so a paragraph break goes first (none in an empty document).
 */
export function lineToAppend(currentText, line) {
  return clean(currentText) === '' ? line : `\n\n${line}`;
}

/** Search excerpts come with `<b>` around the words found: plain text for Gladys. */
export function plainContext(context) {
  return clean(
    String(context ?? '')
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' '),
  );
}
