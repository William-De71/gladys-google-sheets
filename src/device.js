// -----------------------------------------------------------------------------
// The devices: one per watch the user declared.
//
// Why devices, and not only scene triggers and widgets:
//   - a watched cell becomes a feature like any sensor: dashboard tile,
//     history chart, and scene conditions with thresholds ("when the stock
//     typed in the sheet goes below 5"), which a trigger cannot express (its
//     filters are equalities);
//   - the scene triggers, the widget and the configuration filter by device:
//     `source: "devices"` lists the watches by name.
//
// Features (read-only, the sheet stays the place to edit):
//   - cell watch: `value`, its category/type/unit from the kind chosen when
//     declaring it (generic number, text, temperature, currency, energy index);
//   - rows watch: `rows`, the number of data rows (counter-sensor/integer).
//
// External ids: ext:<selector>:cell:<spreadsheetId>:<sheetId>:<B2>[:value]
//               ext:<selector>:rows:<spreadsheetId>:<sheetId>:<A-Z>[:rows]
// The spreadsheet and tab ids never change when they are renamed.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CATEGORIES,
  DEVICE_FEATURE_TYPES as TYPES,
  DEVICE_FEATURE_UNITS as UNITS,
} from '@gladysassistant/integration-sdk';
import { KINDS } from './registry.js';
import { t } from './i18n.js';

const FEATURE_KEYS = { VALUE: 'value', ROWS: 'rows' };
// A text state longer than this is cut (a cell holds up to 50 000 characters).
const MAX_TEXT = 500;
const BIG = 1000000000;

// Category, type, unit and bounds of a watched cell, by the kind chosen.
const VALUE_FEATURES = {
  number: { category: CATEGORIES.UNKNOWN, type: TYPES.UNKNOWN.UNKNOWN, min: -BIG, max: BIG },
  text: { category: CATEGORIES.TEXT, type: TYPES.TEXT.TEXT, min: 0, max: 0 },
  temperature: {
    category: CATEGORIES.TEMPERATURE_SENSOR,
    type: TYPES.SENSOR.DECIMAL,
    unit: UNITS.CELSIUS,
    min: -100,
    max: 200,
  },
  euro: {
    category: CATEGORIES.CURRENCY,
    type: TYPES.CURRENCY.DECIMAL,
    unit: UNITS.EURO,
    min: -BIG,
    max: BIG,
  },
  dollar: {
    category: CATEGORIES.CURRENCY,
    type: TYPES.CURRENCY.DECIMAL,
    unit: UNITS.DOLLAR,
    min: -BIG,
    max: BIG,
  },
  energy_index: {
    category: CATEGORIES.ENERGY_SENSOR,
    type: TYPES.ENERGY_SENSOR.INDEX,
    unit: UNITS.KILOWATT_HOUR,
    min: 0,
    max: BIG,
  },
};
// 10 million cells per spreadsheet at most.
const ROWS_FEATURE = {
  category: CATEGORIES.COUNTER_SENSOR,
  type: TYPES.SENSOR.INTEGER,
  min: 0,
  max: 10000000,
};

/**
 * @description The external ids of a watch.
 * @param {object} gladys - The GladysIntegration instance.
 * @param {{ kind: string, id: string }} watch - The watch.
 * @returns {{ device: string, feature: Function }} The ids.
 */
const idsOf = (gladys, watch) => gladys.externalIds(watch.kind, watch.id);

/**
 * @description The watch id an external id stands for.
 * @param {unknown} externalId - A device or feature external id.
 * @returns {{ kind: string, watchId: string, feature: string|null }|null} Its parts.
 * @example
 * parseExternalId('ext:google-sheets:cell:1AbC…:0:B2:value');
 */
function parseExternalId(externalId) {
  const match =
    /:(cell|rows):([A-Za-z0-9_-]{20,100}:\d{1,10}:(?:[A-Z]{1,3}\d{1,8}|[A-Z]{1,3}-[A-Z]{1,3}))(?::(value|rows))?$/.exec(
      String(externalId ?? ''),
    );
  return match ? { kind: match[1], watchId: match[2], feature: match[3] ?? null } : null;
}

/**
 * @description The feature of a watch.
 * @param {object} watch - The watch.
 * @returns {object} Its category, type, unit and bounds.
 */
function featureOf(watch) {
  return watch.kind === KINDS.CELL
    ? (VALUE_FEATURES[watch.valueKind] ?? VALUE_FEATURES.number)
    : ROWS_FEATURE;
}

/**
 * @description Build the device of a watch.
 * @param {object} gladys - The GladysIntegration instance.
 * @param {object} watch - The watch.
 * @param {string} language - The language of the feature name.
 * @returns {object} The discovered device.
 */
function buildDevice(gladys, watch, language) {
  const ids = idsOf(gladys, watch);
  const isCell = watch.kind === KINDS.CELL;
  const text = isCell && watch.valueKind === 'text';
  return {
    name: watch.name.slice(0, 80),
    external_id: ids.device,
    should_poll: false,
    params: [
      { name: 'SPREADSHEET_ID', value: watch.spreadsheetId },
      { name: 'SHEET_ID', value: String(watch.sheetId) },
      { name: 'RANGE', value: watch.range },
    ],
    features: [
      {
        name: t(isCell ? 'featureValue' : 'featureRows', language),
        external_id: ids.feature(isCell ? FEATURE_KEYS.VALUE : FEATURE_KEYS.ROWS),
        read_only: true,
        has_feedback: false,
        keep_history: !text,
        ...featureOf(watch),
      },
    ],
  };
}

/**
 * @description The state of a watch, null when there is nothing to publish
 * (a numeric kind on a cell that holds no number).
 * @param {object} gladys - The GladysIntegration instance.
 * @param {object} watch - The watch.
 * @param {object} [state] - Its watcher state.
 * @returns {object|null} The state.
 */
function buildState(gladys, watch, state) {
  if (!state) {
    return null;
  }
  const ids = idsOf(gladys, watch);
  if (watch.kind === KINDS.ROWS) {
    return { device_feature_external_id: ids.feature(FEATURE_KEYS.ROWS), state: state.count };
  }
  const external = ids.feature(FEATURE_KEYS.VALUE);
  if (watch.valueKind === 'text') {
    return { device_feature_external_id: external, text: state.value.slice(0, MAX_TEXT) };
  }
  return state.number === null
    ? null
    : { device_feature_external_id: external, state: state.number };
}

export {
  FEATURE_KEYS,
  VALUE_FEATURES,
  ROWS_FEATURE,
  idsOf,
  parseExternalId,
  featureOf,
  buildDevice,
  buildState,
};
