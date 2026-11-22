// -----------------------------------------------------------------------------
// The "Outline" dashboard widget: counters (documents, collections — or the
// documents of the collection set in the widget) and the documents changed
// last, each one opening in Outline.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { WIDGET_KEY } from './hub.js';
import { shortDate } from './outline/model.js';
import { NAMES, pick } from './texts.js';

const logger = createLogger({ name: 'outline-widget' });

// The core shows 8 items at most in a `list` card-list.
export const MAX_ITEMS = 8;

export const TEXT = {
  open: {
    en: 'Open in Outline',
    fr: 'Ouvrir dans Outline',
    de: 'In Outline öffnen',
    es: 'Abrir en Outline',
  },
  empty: {
    en: 'No document to show yet.',
    fr: 'Aucun document à afficher pour le moment.',
    de: 'Noch kein Dokument anzuzeigen.',
    es: 'Todavía no hay ningún documento que mostrar.',
  },
  unknown_collection: {
    en: 'No collection by this name: check the widget settings.',
    fr: 'Aucune collection de ce nom : vérifiez les réglages du widget.',
    de: 'Keine Sammlung mit diesem Namen: Prüfe die Widget-Einstellungen.',
    es: 'No hay ninguna colección con este nombre: compruebe los ajustes del widget.',
  },
  unavailable: {
    en: 'Outline does not answer right now.',
    fr: 'Outline ne répond pas pour le moment.',
    de: 'Outline antwortet gerade nicht.',
    es: 'Outline no responde en este momento.',
  },
  waiting: {
    en: 'Waiting for Outline: check the configuration of the integration.',
    fr: "En attente d'Outline : vérifiez la configuration de l'intégration.",
    de: 'Warte auf Outline: Prüfe die Konfiguration der Integration.',
    es: 'Esperando a Outline: compruebe la configuración de la integración.',
  },
};

const cut = (text, max) => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);
const https = (url) => typeof url === 'string' && /^https:\/\//i.test(url);

/** One row of the list: the title, then the collection, the author and the date. */
export function documentItem(document, language, { showCollection = true } = {}) {
  const item = {
    title: cut(document.title, 60),
    subtitle: cut(
      [
        showCollection ? document.collection : '',
        document.author,
        shortDate(document.updated, language),
      ]
        .filter(Boolean)
        .join(' · '),
      60,
    ),
  };
  // The links of a card must be https: an Outline on plain http is left out.
  if (https(document.url)) {
    item.links = [{ url: document.url.slice(0, 2000), label: pick(TEXT.open, language) }];
  }
  return item;
}

const truthy = (value) => value === true || value === 'true';
const text = (value) => (typeof value === 'string' ? value.trim() : '');
const message = (value, language) => ({
  type: 'text',
  variant: 'caption',
  text: pick(value, language),
});

export async function buildContent(hub, { language = 'en', settings = {} } = {}) {
  if (!hub.loaded) {
    return {
      ttl_seconds: 60,
      components: [
        {
          type: 'text',
          variant: 'body',
          text: pick(hub.failure ? TEXT.unavailable : TEXT.waiting, language),
        },
      ],
    };
  }
  const wanted = text(settings?.collection);
  const names = pick(NAMES, language);
  const components = [];
  let documents = hub.documents;
  let failed = hub.failure !== null;
  let counters = [
    { type: 'value', label: names.documents, value: hub.counters.documents, icon: 'file-text' },
    { type: 'value', label: names.collections, value: hub.counters.collections, icon: 'folder' },
  ];
  if (wanted !== '') {
    let filtered = null;
    if (!failed) {
      try {
        filtered = await hub.collectionDocuments(wanted, MAX_ITEMS);
      } catch (err) {
        logger.debug(`Widget: ${err.message}`);
        failed = true;
      }
    }
    if (filtered) {
      documents = filtered.documents;
      counters = [
        {
          type: 'value',
          label: cut(filtered.collection.name, 24),
          value: filtered.total,
          icon: 'folder',
        },
      ];
    } else {
      // Unknown collection, or Outline down: the documents of the last read.
      const collection = wanted.toLocaleLowerCase();
      documents = hub.documents.filter((d) => d.collection.toLocaleLowerCase() === collection);
      counters = [];
      if (!failed) {
        components.push(message(TEXT.unknown_collection, language));
      }
    }
  }
  if (!truthy(settings?.hide_counters)) {
    components.unshift(...counters);
  }
  if (failed) {
    components.push(message(TEXT.unavailable, language));
  }
  if (documents.length === 0) {
    components.push(message(TEXT.empty, language));
  } else {
    components.push({
      type: 'card-list',
      display: 'list',
      items: documents
        .slice(0, MAX_ITEMS)
        .map((d) => documentItem(d, language, { showCollection: wanted === '' })),
    });
  }
  // The hub nudges the widget after every read and every write.
  return { ttl_seconds: 300, components };
}

export const WIDGETS = {
  [WIDGET_KEY]: {
    get: (hub, request) => buildContent(hub, request),
  },
};
