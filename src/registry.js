// -----------------------------------------------------------------------------
// The registry of the watches the user declared with the configuration
// buttons "Watch a cell" and "Watch new rows": no JSON to type, a plain form
// checked here and in app.js (which asks Google for the tab first).
//
// A watch is either:
//   - a cell: one cell of a tab, its value becomes a device feature and its
//     changes the "cell changed" scene trigger;
//   - rows: whole columns of a tab (A:Z by default), whose new rows raise the
//     "row added" scene trigger (Google Forms answers, a shared log…), with a
//     row counter and the rows widget.
//
// Its identifier is made of the spreadsheet id, the tab id (gid, stable when
// the tab is renamed, unlike its name) and the cells (`B2`, `A-Z`): it builds
// the external ids of the device, so it is kept for ever.
//
// Stored through setConfig() under INTERNAL_KEYS.watches, a key outside the
// config_schema: the watches follow the Gladys backups (/data does not). A
// change is applied in memory only once Gladys saved it, one at a time.
// -----------------------------------------------------------------------------

import { INTERNAL_KEYS } from './config.js';

// Each watch costs reading time: a few dozen keep every reading of a
// spreadsheet to a single request per render option.
const MAX_WATCHES = 50;
const NAME_MAX = 60;
const KINDS = { CELL: 'cell', ROWS: 'rows' };
// How the value of a watched cell is shown in Gladys (device.js).
const VALUE_KINDS = ['number', 'text', 'temperature', 'euro', 'dollar', 'energy_index'];
const ID_PATTERN = /^[A-Za-z0-9_-]{20,100}:\d{1,10}:(?:[A-Z]{1,3}\d{1,8}|[A-Z]{1,3}-[A-Z]{1,3})$/;

class RegistryError extends Error {
  /**
   * @param {string} key - The i18n key of the message.
   * @param {object} [params] - Its substitutions.
   */
  constructor(key, params = {}) {
    super(key);
    this.name = 'RegistryError';
    this.key = key;
    this.params = params;
  }
}

/**
 * @description The identifier of a watch.
 * @param {{ spreadsheetId: string, sheetId: number, range: string }} watch - Its target.
 * @returns {string} `<spreadsheetId>:<sheetId>:<B2 | A-Z>`.
 * @example
 * watchId({ spreadsheetId: '1AbC…', sheetId: 0, range: 'A:Z' }); // -> '1AbC…:0:A-Z'
 */
function watchId({ spreadsheetId, sheetId, range }) {
  return `${spreadsheetId}:${sheetId}:${String(range).replace(':', '-')}`;
}

/**
 * @description Check a stored or new watch.
 * @param {object} raw - The watch.
 * @returns {object} The clean watch.
 * @throws {RegistryError} When it is not valid.
 */
function validateWatch(raw) {
  const kind = raw?.kind;
  if (![KINDS.CELL, KINDS.ROWS].includes(kind)) {
    throw new RegistryError('errorInvalid');
  }
  const watch = {
    kind,
    spreadsheetId: String(raw.spreadsheetId ?? ''),
    sheetId: Number(raw.sheetId),
    range: String(raw.range ?? ''),
    name: String(raw.name ?? '')
      .trim()
      .slice(0, NAME_MAX),
    spreadsheetTitle: String(raw.spreadsheetTitle ?? '').slice(0, 200),
    sheetTitle: String(raw.sheetTitle ?? '').slice(0, 200),
  };
  if (kind === KINDS.CELL) {
    watch.valueKind = VALUE_KINDS.includes(raw.valueKind) ? raw.valueKind : 'number';
  } else {
    watch.header = raw.header !== false;
  }
  watch.id = watchId(watch);
  if (!ID_PATTERN.test(watch.id) || !Number.isInteger(watch.sheetId) || !watch.name) {
    throw new RegistryError('errorInvalid');
  }
  if (raw.id !== undefined && raw.id !== watch.id) {
    throw new RegistryError('errorInvalid');
  }
  return watch;
}

/**
 * @description Read the stored registry, dropping what is not a valid watch.
 * @param {*} stored - The stored value (its JSON, or an array).
 * @param {object} [logger] - Logger.
 * @returns {object[]} The watches.
 */
function parseRegistry(stored, logger) {
  let list = stored;
  if (typeof stored === 'string') {
    try {
      list = stored ? JSON.parse(stored) : [];
    } catch {
      logger?.warn('The stored watches are not valid JSON: ignored');
      return [];
    }
  }
  if (!Array.isArray(list)) {
    return [];
  }
  const seen = new Set();
  const watches = [];
  for (const raw of list) {
    try {
      const watch = validateWatch(raw);
      if (seen.has(watch.id)) {
        throw new RegistryError('errorInvalid');
      }
      seen.add(watch.id);
      watches.push(watch);
    } catch {
      logger?.warn('A stored watch is not valid: ignored');
    }
  }
  return watches.slice(0, MAX_WATCHES);
}

/**
 * @description The registry of the watches.
 * @param {object} gladys - SDK client (setConfig).
 * @param {object} [options] - `{ logger }`.
 * @returns {object} The registry.
 */
function createRegistry(gladys, { logger } = {}) {
  let watches = [];
  let writing = Promise.resolve();

  // One change at a time, computed from the previous one once it is saved.
  const serial = (change) => {
    const run = writing.then(async () => {
      const { next, result } = change(watches);
      await gladys.setConfig({ [INTERNAL_KEYS.watches]: JSON.stringify(next) });
      watches = next;
      return result;
    });
    writing = run.catch(() => {});
    return run;
  };

  const registry = {
    /**
     * @param {object} config - The raw config.
     * @returns {object[]} The watches.
     */
    load(config) {
      watches = parseRegistry(config?.[INTERNAL_KEYS.watches], logger);
      return watches;
    },

    list: () => watches,

    /** @param {string} id - Identifier. @returns {object|undefined} The watch. */
    byId: (id) => watches.find((watch) => watch.id === id),

    /**
     * @description Find a watch by its number in the list (#2 or 2), its name
     * (any case) or its identifier.
     * @param {unknown} query - What the user typed.
     * @returns {object} The watch.
     * @throws {RegistryError} When none or several match.
     */
    find(query) {
      const value = String(query ?? '').trim();
      if (!value) {
        throw new RegistryError('errorTarget');
      }
      const number = /^#?(\d{1,3})$/.exec(value);
      if (number && watches[Number(number[1]) - 1]) {
        return watches[Number(number[1]) - 1];
      }
      const byId = watches.find((watch) => watch.id === value);
      if (byId) {
        return byId;
      }
      const lower = value.toLowerCase();
      const byName = watches.filter((watch) => watch.name.toLowerCase() === lower);
      if (byName.length === 1) {
        return byName[0];
      }
      if (byName.length > 1) {
        throw new RegistryError('errorAmbiguous', {
          query: value,
          numbers: byName.map((watch) => `#${watches.indexOf(watch) + 1}`).join(', '),
        });
      }
      throw new RegistryError('errorNotFound', { query: value });
    },

    /**
     * @description Add a watch.
     * @param {object} raw - The new watch (checked).
     * @returns {Promise<object>} The watch.
     */
    add(raw) {
      return serial((current) => {
        const watch = validateWatch(raw);
        if (current.some((other) => other.id === watch.id)) {
          throw new RegistryError('errorDuplicate', {
            n: current.findIndex((other) => other.id === watch.id) + 1,
          });
        }
        if (current.length >= MAX_WATCHES) {
          throw new RegistryError('errorFull', { max: MAX_WATCHES });
        }
        return { next: [...current, watch], result: watch };
      });
    },

    /**
     * @description Remove a watch.
     * @param {unknown} query - Its number, name or identifier.
     * @returns {Promise<object>} The removed watch.
     */
    remove(query) {
      return serial((current) => {
        const watch = registry.find(query);
        return { next: current.filter((other) => other.id !== watch.id), result: watch };
      });
    },
  };
  return registry;
}

export {
  MAX_WATCHES,
  NAME_MAX,
  KINDS,
  VALUE_KINDS,
  RegistryError,
  watchId,
  validateWatch,
  parseRegistry,
  createRegistry,
};
