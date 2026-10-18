// -----------------------------------------------------------------------------
// The reading of the watched cells and rows, and what changed since the
// previous reading.
//
// Google Sheets pushes nothing (its push notifications go through Drive, with
// a public webhook and a wider scope): the watches are read on a timer. One
// reading of a spreadsheet costs:
//   - spreadsheets.get, cached 10 minutes: the titles of the tabs by sheetId,
//     so a renamed tab keeps working (the ranges need the current name);
//   - one values:batchGet FORMATTED_VALUE for every watch of the spreadsheet
//     (the cells as shown, the header and the new rows of the row watches);
//   - one values:batchGet UNFORMATTED_VALUE for the numeric cells (0.5 for
//     "50 %", 1234.5 for "1 234,50 €").
//
// New rows: a row watch remembers its last non-empty row and that row's
// values; the next reading asks from that row down, so only the new rows
// travel. When the remembered row changed (rows deleted, sorted, the last
// answer edited), the tab is read again in full and becomes the new
// reference, without events.
//
// The first reading of a watch is a reference (no event). A change made by
// Gladys itself (scene action, widget form) never raises an event: the rows
// it appended are marked quiet, and the cell changes seen in the first
// reading after a write to the same spreadsheet are absorbed silently, a
// formula depending on the written cells included (a scene must not start
// scenes in turn).
// -----------------------------------------------------------------------------

import { columnLetters, parseCell, parseColumns, quoteSheet, RefError } from './a1.js';
import { RENDER } from './sheets-api.js';
import { KINDS } from './registry.js';

const METADATA_TTL_MS = 10 * 60 * 1000;
const QUIET_TTL_MS = 10 * 60 * 1000;
// The rows kept for the widget (a card list shows 8 at most).
const RECENT_ROWS = 8;
// New rows raising an event per watch and per reading (300 events a minute
// for the whole integration).
const MAX_EVENTS_PER_WATCH = 50;

/**
 * @description The values of a row as texts, trailing empty cells left out.
 * @param {unknown[]} row - The cells.
 * @returns {string[]} The texts.
 */
function cleanRow(row) {
  const values = (Array.isArray(row) ? row : []).map((value) =>
    value === null || value === undefined ? '' : String(value),
  );
  while (values.length > 0 && values[values.length - 1] === '') {
    values.pop();
  }
  return values;
}

const signatureOf = (row) => JSON.stringify(cleanRow(row));

/**
 * @description The number of an unformatted cell, null when it is not one.
 * @param {unknown} raw - The cell.
 * @returns {number|null} The number.
 */
function numberOf(raw) {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw;
  }
  if (typeof raw === 'boolean') {
    return raw ? 1 : 0;
  }
  return null;
}

/**
 * @description The tab a reference points at.
 * @param {object} meta - The metadata of the spreadsheet.
 * @param {object} [target] - `{ name, sheetId }`: a name wins, then the id;
 *   neither = the first tab.
 * @returns {{ sheetId: number, title: string }} The tab.
 * @throws {RefError} When it does not exist.
 */
function resolveSheet(meta, { name = null, sheetId = null } = {}) {
  const sheets = meta.sheets ?? [];
  if (name) {
    const exact = sheets.find((sheet) => sheet.title === name);
    const loose = sheets.find((sheet) => sheet.title.toLowerCase() === name.toLowerCase());
    if (exact ?? loose) {
      return exact ?? loose;
    }
    throw new RefError('errorSheetNotFound', { sheet: name.slice(0, 60) });
  }
  if (sheetId !== null && sheetId !== undefined) {
    const byId = sheets.find((sheet) => sheet.sheetId === sheetId);
    if (byId) {
      return byId;
    }
    throw new RefError('errorSheetNotFound', { sheet: `gid=${sheetId}` });
  }
  if (sheets.length === 0) {
    throw new RefError('errorSheetNotFound', { sheet: '?' });
  }
  return sheets[0];
}

/**
 * @description The watcher.
 * @param {object} options - `{ api, now, logger }`.
 * @returns {object} The watcher.
 */
function createWatcher({ api, now = Date.now, logger }) {
  const metadataCache = new Map();
  const states = new Map();
  const errors = new Map();
  const quiet = new Map();
  let readAt = 0;

  /**
   * @description The metadata of a spreadsheet, from the cache when recent.
   * @param {string} spreadsheetId - The spreadsheet id.
   * @param {object} [options] - `{ fresh }`: skip the cache.
   * @returns {Promise<object>} The metadata.
   */
  async function metadata(spreadsheetId, { fresh = false } = {}) {
    const cached = metadataCache.get(spreadsheetId);
    if (!fresh && cached && now() - cached.at < METADATA_TTL_MS) {
      return cached.meta;
    }
    const meta = await api.getMetadata(spreadsheetId);
    metadataCache.set(spreadsheetId, { meta, at: now() });
    return meta;
  }

  /**
   * @description The quiet marks of a spreadsheet.
   * @param {string} spreadsheetId - The spreadsheet id.
   * @returns {{ touched: boolean, rows: Map<string, Map<number, number>> }} The marks.
   */
  function quietOf(spreadsheetId) {
    if (!quiet.has(spreadsheetId)) {
      quiet.set(spreadsheetId, { touched: false, rows: new Map() });
    }
    return quiet.get(spreadsheetId);
  }

  /**
   * @description Gladys wrote to a spreadsheet: the changes it caused must not
   * raise events.
   * @param {string} spreadsheetId - The spreadsheet id.
   * @param {object} [rows] - `{ sheet, firstRow, lastRow }` the rows written.
   */
  function touch(spreadsheetId, rows = null) {
    const marks = quietOf(spreadsheetId);
    marks.touched = true;
    if (rows?.sheet && rows.firstRow > 0) {
      const key = rows.sheet.toLowerCase();
      const sheetMarks = marks.rows.get(key) ?? new Map();
      const last = Math.min(rows.lastRow, rows.firstRow + 999);
      for (let row = rows.firstRow; row <= last; row += 1) {
        sheetMarks.set(row, now() + QUIET_TTL_MS);
      }
      marks.rows.set(key, sheetMarks);
    }
  }

  /**
   * @description Whether a new row was written by Gladys (the mark is used up).
   * @param {string} spreadsheetId - The spreadsheet id.
   * @param {string} sheet - The tab name.
   * @param {number} row - The row number.
   * @returns {boolean} Quiet.
   */
  function isQuietRow(spreadsheetId, sheet, row) {
    const sheetMarks = quiet.get(spreadsheetId)?.rows.get(sheet.toLowerCase());
    const until = sheetMarks?.get(row);
    if (until === undefined) {
      return false;
    }
    sheetMarks.delete(row);
    return until >= now();
  }

  /** Drop the outdated row marks. */
  function expireQuiet() {
    for (const marks of quiet.values()) {
      for (const sheetMarks of marks.rows.values()) {
        for (const [row, until] of sheetMarks) {
          if (until < now()) {
            sheetMarks.delete(row);
          }
        }
      }
    }
  }

  /**
   * @description The ranges a watch reads.
   * @param {object} watch - The watch.
   * @param {string} title - The current tab name.
   * @param {object} [state] - Its state (rows: from the last row on).
   * @returns {{ main: string, header: string|null, value: string|null }} The ranges.
   */
  function rangesOf(watch, title, state) {
    const sheet = quoteSheet(title);
    if (watch.kind === KINDS.CELL) {
      const { a1 } = parseCell(watch.range);
      return { main: `${sheet}!${a1}`, header: null };
    }
    const columns = parseColumns(watch.range);
    const first = columnLetters(columns.start);
    const last = columnLetters(columns.end);
    const from = state && state.lastRow > 0 ? state.lastRow : 1;
    return {
      main: `${sheet}!${first}${from}:${last}`,
      full: `${sheet}!${first}1:${last}`,
      header: watch.header ? `${sheet}!${first}1:${last}1` : null,
    };
  }

  /**
   * @description A row watch's reference from the full reading of its columns.
   * @param {object} watch - The watch.
   * @param {unknown[][]} rows - Every row from row 1.
   * @param {string[]} header - The header.
   * @returns {object} The state.
   */
  function rowsBaseline(watch, rows, header) {
    const lastRow = rows.length;
    const firstData = watch.header ? 2 : 1;
    const recent = [];
    for (
      let index = rows.length - 1;
      index >= firstData - 1 && recent.length < RECENT_ROWS;
      index -= 1
    ) {
      const values = cleanRow(rows[index]);
      if (values.length > 0) {
        recent.unshift({ row: index + 1, values });
      }
    }
    return {
      lastRow,
      signature: signatureOf(rows[lastRow - 1]),
      header,
      recent,
      count: Math.max(0, lastRow - (watch.header ? 1 : 0)),
    };
  }

  /**
   * @description Read one spreadsheet's watches.
   * @param {string} spreadsheetId - The spreadsheet id.
   * @param {object[]} watches - Its watches.
   * @param {boolean} [retried] - A second try after a renamed tab.
   * @returns {Promise<object[]>} One result per watch.
   */
  async function readSpreadsheet(spreadsheetId, watches, retried = false) {
    let meta;
    try {
      meta = await metadata(spreadsheetId, { fresh: retried });
    } catch (err) {
      if (err.noAccess) {
        return watches.map((watch) => failed(watch, 'errorNoAccess'));
      }
      throw err;
    }
    const results = [];
    const readable = [];
    for (const watch of watches) {
      const sheet = meta.sheets.find((candidate) => candidate.sheetId === watch.sheetId);
      if (!sheet) {
        results.push(failed(watch, 'errorSheetMissing'));
        continue;
      }
      readable.push({
        watch,
        sheet,
        ranges: rangesOf(watch, sheet.title, states.get(watch.id)),
      });
    }
    const formattedRanges = [];
    for (const item of readable) {
      item.mainIndex = formattedRanges.push(item.ranges.main) - 1;
      if (item.ranges.header) {
        item.headerIndex = formattedRanges.push(item.ranges.header) - 1;
      }
    }
    const numeric = readable.filter(
      (item) => item.watch.kind === KINDS.CELL && item.watch.valueKind !== 'text',
    );
    let formatted;
    let unformatted;
    try {
      formatted = await api.batchGet(spreadsheetId, formattedRanges, RENDER.FORMATTED);
      unformatted = await api.batchGet(
        spreadsheetId,
        numeric.map((item) => item.ranges.main),
        RENDER.UNFORMATTED,
      );
    } catch (err) {
      if (err.badRange && !retried) {
        // A tab renamed since the cached titles: read them again, once.
        return readSpreadsheet(spreadsheetId, watches, true);
      }
      if (err.noAccess) {
        return [...results, ...readable.map((item) => failed(item.watch, 'errorNoAccess'))];
      }
      throw err;
    }
    const marks = quietOf(spreadsheetId);
    for (const item of readable) {
      const { watch, sheet } = item;
      errors.delete(watch.id);
      const context = {
        watch,
        spreadsheetTitle: meta.title,
        sheetTitle: sheet.title,
        added: [],
        change: null,
      };
      if (watch.kind === KINDS.CELL) {
        const value = cleanRow(formatted[item.mainIndex]?.[0])[0] ?? '';
        const numericIndex = numeric.indexOf(item);
        const number = numericIndex >= 0 ? numberOf(unformatted[numericIndex]?.[0]?.[0]) : null;
        const before = states.get(watch.id);
        states.set(watch.id, { value, number, readAt: now() });
        if (before && (before.value !== value || before.number !== number)) {
          if (marks.touched) {
            logger?.debug?.(`Watch ${watch.id}: change made by Gladys, no event`);
          } else {
            context.change = {
              previous: before.value,
              value,
              previousNumber: before.number,
              number,
            };
          }
        }
        results.push(context);
        continue;
      }
      const header =
        item.headerIndex === undefined ? [] : cleanRow(formatted[item.headerIndex]?.[0]);
      const rows = formatted[item.mainIndex] ?? [];
      const before = states.get(watch.id);
      if (!before) {
        states.set(watch.id, { ...rowsBaseline(watch, rows, header), readAt: now() });
        results.push(context);
        continue;
      }
      const from = before.lastRow > 0 ? before.lastRow : 1;
      if (before.lastRow > 0 && signatureOf(rows[0]) !== before.signature) {
        // Rows deleted, sorted, or the last one edited: a new reference.
        const full = await api.batchGet(spreadsheetId, [item.ranges.full], RENDER.FORMATTED);
        logger?.info(`Watch ${watch.id}: the tab changed above its last row, new reference`);
        states.set(watch.id, { ...rowsBaseline(watch, full[0] ?? [], header), readAt: now() });
        results.push(context);
        continue;
      }
      const fresh = before.lastRow > 0 ? rows.slice(1) : rows;
      const firstNew = before.lastRow > 0 ? from + 1 : 1;
      const firstData = watch.header ? 2 : 1;
      const recent = [...before.recent];
      for (let index = 0; index < fresh.length; index += 1) {
        const row = firstNew + index;
        const values = cleanRow(fresh[index]);
        if (values.length === 0 || row < firstData) {
          continue;
        }
        recent.push({ row, values });
        if (isQuietRow(spreadsheetId, sheet.title, row)) {
          continue;
        }
        if (context.added.length < MAX_EVENTS_PER_WATCH) {
          context.added.push({ row, values });
        } else {
          logger?.warn(
            `Watch ${watch.id}: more than ${MAX_EVENTS_PER_WATCH} new rows, no event for row ${row}`,
          );
        }
      }
      const lastRow = rows.length > 0 ? from + rows.length - 1 : before.lastRow;
      states.set(watch.id, {
        lastRow,
        signature: rows.length > 0 ? signatureOf(rows[rows.length - 1]) : before.signature,
        header,
        recent: recent.slice(-RECENT_ROWS),
        count: Math.max(0, lastRow - (watch.header ? 1 : 0)),
        readAt: now(),
      });
      results.push(context);
    }
    marks.touched = false;
    return results;
  }

  /**
   * @description A watch that could not be read.
   * @param {object} watch - The watch.
   * @param {string} key - The i18n key of the reason.
   * @returns {object} The result.
   */
  function failed(watch, key) {
    errors.set(watch.id, { key, at: now() });
    return { watch, error: key, added: [], change: null };
  }

  return {
    metadata,
    touch,
    /** @param {string} id - Watch id. @returns {object|undefined} Its last state. */
    stateOf: (id) => states.get(id),
    /** @param {string} id - Watch id. @returns {object|undefined} Its last error. */
    errorOf: (id) => errors.get(id),
    readAt: () => readAt,

    /**
     * @description Read every watch, one spreadsheet after the other.
     * @param {object[]} watches - The watches.
     * @returns {Promise<object[]>} One result per watch.
     */
    async read(watches) {
      expireQuiet();
      const bySpreadsheet = new Map();
      for (const watch of watches) {
        bySpreadsheet.set(watch.spreadsheetId, [
          ...(bySpreadsheet.get(watch.spreadsheetId) ?? []),
          watch,
        ]);
      }
      const results = [];
      for (const [spreadsheetId, group] of bySpreadsheet) {
        results.push(...(await readSpreadsheet(spreadsheetId, group)));
      }
      readAt = now();
      return results;
    },

    /**
     * @description Forget a watch (removed), or everything (disconnected).
     * @param {string} [id] - The watch id.
     */
    forget(id) {
      if (id) {
        states.delete(id);
        errors.delete(id);
        return;
      }
      states.clear();
      errors.clear();
      metadataCache.clear();
      quiet.clear();
      readAt = 0;
    },
  };
}

export { RECENT_ROWS, MAX_EVENTS_PER_WATCH, cleanRow, numberOf, resolveSheet, createWatcher };
