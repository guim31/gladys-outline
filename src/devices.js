// -----------------------------------------------------------------------------
// Outline -> Gladys device: one "Outline" device (`outline:wiki`):
//
//   reachable     input/binary     1 Outline answers, 0 otherwise
//   documents     counter-sensor   published documents the key may read
//   collections   counter-sensor   collections the key may read
//   latest        text             title of the document changed last
//   latest_by     text             who changed it
//   latest_at     text             when (short date, Gladys time zone)
//
// The integration links one Outline: its device keeps its id when the
// address changes (a new IP, a reverse proxy), history and scenes stay.
// Everything is read only: documents are written through the scene actions.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CAT,
  DEVICE_FEATURE_TYPES as TYPE,
} from '@gladysassistant/integration-sdk';
import { shortDate } from './outline/model.js';
import { NAMES, NONE, pick } from './texts.js';

export const OUTLINE_TYPE = 'outline';
export const WIKI_ID = 'wiki';
export const COUNTERS = ['documents', 'collections'];
export const TEXTS = ['latest', 'latest_by', 'latest_at'];

const MAX_COUNT = 10_000_000;

export const wikiIds = (gladys) => gladys.externalIds(OUTLINE_TYPE, WIKI_ID);

const counter = (name, externalId) => ({
  name,
  external_id: externalId,
  category: CAT.COUNTER_SENSOR,
  type: TYPE.SENSOR.INTEGER,
  read_only: true,
  has_feedback: false,
  min: 0,
  max: MAX_COUNT,
  keep_history: true,
});

const textFeature = (name, externalId) => ({
  name,
  external_id: externalId,
  category: CAT.TEXT,
  type: TYPE.TEXT.TEXT,
  read_only: true,
  has_feedback: false,
  min: 0,
  max: 0,
  keep_history: false,
});

/**
 * @param {object} gladys
 * @param {string} language
 * @param {string} url Outline base URL (a device param, shown in Gladys)
 * @param {string} version
 */
export function buildWikiDevice(gladys, language, url, version) {
  const names = pick(NAMES, language);
  const ids = wikiIds(gladys);
  return {
    name: 'Outline',
    external_id: ids.device,
    model: 'Outline',
    should_poll: false,
    features: [
      {
        name: names.reachable,
        external_id: ids.feature('reachable'),
        category: CAT.INPUT,
        type: TYPE.SENSOR.BINARY,
        read_only: true,
        has_feedback: false,
        min: 0,
        max: 1,
        keep_history: true,
      },
      ...COUNTERS.map((key) => counter(names[key], ids.feature(key))),
      ...TEXTS.map((key) => textFeature(names[key], ids.feature(key))),
    ],
    params: [
      { name: 'OUTLINE_URL', value: url },
      { name: 'OUTLINE_VERSION', value: version || '?' },
    ],
  };
}

/**
 * @param {object} gladys
 * @param {{ reachable: boolean, counters: { documents: number, collections: number }, latest?: object }} snapshot
 * @param {string} language
 */
export function buildWikiStates(gladys, { reachable, counters, latest }, language) {
  const ids = wikiIds(gladys);
  const none = pick(NONE, language);
  const text = (key, value) => ({
    device_feature_external_id: ids.feature(key),
    // A text state is never empty, or Gladys ignores it.
    text: (value || none).slice(0, 200),
  });
  return [
    { device_feature_external_id: ids.feature('reachable'), state: reachable ? 1 : 0 },
    ...COUNTERS.map((key) => ({
      device_feature_external_id: ids.feature(key),
      state: counters[key],
    })),
    text('latest', latest?.title),
    text('latest_by', latest?.author),
    text('latest_at', latest ? shortDate(latest.updated, language) : ''),
  ];
}

/** Whether a device external id is the Outline device. */
export const isWikiDevice = (gladys, externalId) => externalId === wikiIds(gladys).device;
