// -----------------------------------------------------------------------------
// Scene triggers: one event per change seen between two readings, never a
// periodic snapshot.
//
//   cell_changed  the value of a watched cell changed (typed by someone, a
//                 formula, IMPORTRANGE…);
//   row_added     a new row appeared under a watched tab (a Google Forms
//                 answer, a line typed on the phone…).
//
// `watch` carries the device external id: the `watch` filter of the
// triggers (source "devices") is an equality on it. The first reading of a
// watch is a reference, and the changes made by Gladys itself never raise an
// event (watcher.js).
// -----------------------------------------------------------------------------

import { columnLetters, parseCell, parseColumns } from './a1.js';

const TRIGGERS = { CELL_CHANGED: 'cell_changed', ROW_ADDED: 'row_added' };
// Columns exposed one by one in a row_added event (the others are in `values`).
const EVENT_COLUMNS = 10;
// Scalars of at most 1 000 characters (limit of a scene event value).
const MAX_VALUE = 1000;
const cut = (text) => String(text ?? '').slice(0, MAX_VALUE);

/**
 * @description The data of a cell_changed event, flat and bounded.
 * @param {object} context - `{ device, watch, spreadsheetTitle, sheetTitle, change }`.
 * @returns {object} The event data.
 */
function cellEventData({ device, watch, spreadsheetTitle, sheetTitle, change }) {
  return {
    watch: device,
    watch_name: cut(watch.name),
    spreadsheet_name: cut(spreadsheetTitle),
    sheet_name: cut(sheetTitle),
    cell: parseCell(watch.range).a1,
    value: cut(change.value),
    previous_value: cut(change.previous),
    is_number: change.number !== null,
    number: change.number ?? 0,
    previous_number: change.previousNumber ?? 0,
  };
}

/**
 * @description The data of a row_added event, flat and bounded.
 * @param {object} context - `{ device, watch, spreadsheetTitle, sheetTitle, row }`.
 * @returns {object} The event data.
 */
function rowEventData({ device, watch, spreadsheetTitle, sheetTitle, row }) {
  const columns = parseColumns(watch.range);
  const data = {
    watch: device,
    watch_name: cut(watch.name),
    spreadsheet_name: cut(spreadsheetTitle),
    sheet_name: cut(sheetTitle),
    row: row.row,
    first_column: columnLetters(columns.start),
    values: cut(row.values.join(' | ')),
  };
  for (let index = 0; index < EVENT_COLUMNS; index += 1) {
    data[`column_${index + 1}`] = cut(row.values[index] ?? '');
  }
  return data;
}

export { TRIGGERS, EVENT_COLUMNS, cellEventData, rowEventData };
