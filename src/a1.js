// -----------------------------------------------------------------------------
// A1 notation and spreadsheet references (pure helpers, no network).
//
// https://developers.google.com/workspace/sheets/api/guides/concepts
//   - a spreadsheet URL looks like
//     https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>/edit?gid=<SHEET_ID>#gid=<SHEET_ID>;
//     both ids are stable when the spreadsheet or the tab is renamed;
//   - a range is `<sheet name>!<cells>`; the sheet name must be in single
//     quotes when it has spaces or special characters, a quote inside it is
//     doubled (`'Jon''s data'!A1`). Quoting every name is always valid, and
//     tells the tab "A1" apart from the cell A1, so this module always quotes.
// -----------------------------------------------------------------------------

// Spreadsheet ids are long base64url-like strings (44 characters today).
const ID_PATTERN = /^[A-Za-z0-9_-]{20,100}$/;
const MAX_COLUMN = 18278; // ZZZ
const MAX_ROW = 10000000; // 10 million cells per spreadsheet

/** A reference or range the user typed that cannot be used. */
class RefError extends Error {
  /**
   * @param {string} key - The i18n key of the message.
   * @param {object} [params] - Its substitutions.
   */
  constructor(key, params = {}) {
    super(key);
    this.name = 'RefError';
    this.key = key;
    this.params = params;
  }
}

/**
 * @description Read the spreadsheet id (and the tab id, when the URL has
 * one) from a pasted URL or a bare id.
 * @param {unknown} input - URL or id.
 * @returns {{ spreadsheetId: string, sheetId: number|null }|null} The ids,
 *   null when the input is empty.
 * @throws {RefError} When the input is neither.
 * @example
 * parseSpreadsheetRef('https://docs.google.com/spreadsheets/d/1AbC…/edit#gid=42');
 * // -> { spreadsheetId: '1AbC…', sheetId: 42 }
 */
function parseSpreadsheetRef(input) {
  const text = String(input ?? '').trim();
  if (!text) {
    return null;
  }
  // "Publish to the web" links (/d/e/2PACX-…) carry another id, unusable by the API.
  if (/\/spreadsheets\/d\/e\//.test(text)) {
    throw new RefError('errorPublishedUrl');
  }
  const fromUrl = /\/spreadsheets\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]+)/.exec(text);
  const spreadsheetId = fromUrl ? fromUrl[1] : text;
  if (!ID_PATTERN.test(spreadsheetId)) {
    throw new RefError('errorSpreadsheetRef');
  }
  const gid = /[#?&]gid=(\d{1,10})/.exec(text);
  return { spreadsheetId, sheetId: gid ? Number(gid[1]) : null };
}

/**
 * @description Quote a sheet name for A1 notation.
 * @param {string} title - The tab name.
 * @returns {string} `'title'`, inner quotes doubled.
 * @example
 * quoteSheet("Jon's data"); // -> "'Jon''s data'"
 */
function quoteSheet(title) {
  return `'${String(title).replace(/'/g, "''")}'`;
}

/**
 * @description The column letters of a 0-based index.
 * @param {number} index - 0 for A.
 * @returns {string} The letters.
 * @example
 * columnLetters(27); // -> 'AB'
 */
function columnLetters(index) {
  let n = index + 1;
  let letters = '';
  while (n > 0) {
    const rest = (n - 1) % 26;
    letters = String.fromCharCode(65 + rest) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

/**
 * @description The 0-based index of column letters.
 * @param {string} letters - 'A' to 'ZZZ'.
 * @returns {number} The index.
 * @example
 * columnIndex('AB'); // -> 27
 */
function columnIndex(letters) {
  return (
    [...String(letters).toUpperCase()].reduce(
      (sum, letter) => sum * 26 + letter.charCodeAt(0) - 64,
      0,
    ) - 1
  );
}

/**
 * @description Split an optional sheet name off a range the user typed:
 * `B2`, `Sheet1!B2`, `'My tab'!B2:D4`.
 * @param {unknown} input - The text.
 * @returns {{ sheet: string|null, cells: string }} The parts (cells upper case, no `$`).
 * @example
 * splitRange("'My tab'!b$2"); // -> { sheet: 'My tab', cells: 'B2' }
 */
function splitRange(input) {
  const text = String(input ?? '').trim();
  const bang = text.lastIndexOf('!');
  let sheet = null;
  let cells = text;
  if (bang >= 0) {
    sheet = text.slice(0, bang).trim();
    cells = text.slice(bang + 1);
    if (/^'.*'$/.test(sheet)) {
      sheet = sheet.slice(1, -1).replace(/''/g, "'");
    }
  }
  return {
    sheet: sheet || null,
    cells: cells.replace(/\$/g, '').replace(/\s+/g, '').toUpperCase(),
  };
}

/**
 * @description Read one cell (`B2`).
 * @param {unknown} input - The text (a `$` or lower case is accepted).
 * @returns {{ column: number, row: number, a1: string }} 0-based column, 1-based row.
 * @throws {RefError} When it is not one cell.
 * @example
 * parseCell('$b$2'); // -> { column: 1, row: 2, a1: 'B2' }
 */
function parseCell(input) {
  const { cells } = splitRange(input);
  const match = /^([A-Z]{1,3})([1-9]\d{0,7})$/.exec(cells);
  const column = match ? columnIndex(match[1]) : -1;
  const row = match ? Number(match[2]) : 0;
  if (!match || column >= MAX_COLUMN || row > MAX_ROW) {
    throw new RefError('errorCell', { cell: String(input ?? '').slice(0, 20) });
  }
  return { column, row, a1: `${match[1]}${row}` };
}

/**
 * @description Read a span of whole columns (`A:Z`, or `C` for one column).
 * @param {unknown} input - The text; empty = `A:Z`.
 * @param {number} [maxWidth] - The widest span accepted.
 * @returns {{ start: number, end: number, a1: string }} 0-based columns.
 * @throws {RefError} When it is not a column span.
 * @example
 * parseColumns('b:f'); // -> { start: 1, end: 5, a1: 'B:F' }
 */
function parseColumns(input, maxWidth = 52) {
  const { cells } = splitRange(input);
  const text = cells || 'A:Z';
  const match = /^([A-Z]{1,3})(?::([A-Z]{1,3}))?$/.exec(text);
  if (!match) {
    throw new RefError('errorColumns', { columns: String(input ?? '').slice(0, 20) });
  }
  const start = columnIndex(match[1]);
  const end = columnIndex(match[2] ?? match[1]);
  if (end < start || end - start + 1 > maxWidth) {
    throw new RefError('errorColumns', { columns: text });
  }
  return { start, end, a1: `${columnLetters(start)}:${columnLetters(end)}` };
}

/**
 * @description Check a range typed in a scene action (`B2`, `B2:D5`, `A:C`,
 * `A2:C`, `3:5`), sheet name allowed in front.
 * @param {unknown} input - The text.
 * @returns {{ sheet: string|null, cells: string }} The parts.
 * @throws {RefError} When it is not an A1 range.
 * @example
 * parseRange('Log!a2:c'); // -> { sheet: 'Log', cells: 'A2:C' }
 */
function parseRange(input) {
  const parts = splitRange(input);
  const end = '(?:[A-Z]{1,3}\\d{0,8}|\\d{1,8})';
  if (!new RegExp(`^${end}(?::${end})?$`).test(parts.cells)) {
    throw new RefError('errorRange', { range: String(input ?? '').slice(0, 40) });
  }
  return parts;
}

/**
 * @description Read the rows of a range Google returns (`'Log'!A15:C16`).
 * @param {unknown} range - The A1 range of an answer.
 * @returns {{ sheet: string|null, firstRow: number, lastRow: number }|null} The rows.
 * @example
 * rowsOfRange("'Log'!A15:C16"); // -> { sheet: 'Log', firstRow: 15, lastRow: 16 }
 */
function rowsOfRange(range) {
  const { sheet, cells } = splitRange(range);
  const match = /^[A-Z]{0,3}(\d+)(?::[A-Z]{0,3}(\d+))?$/.exec(cells);
  if (!match) {
    return null;
  }
  const firstRow = Number(match[1]);
  return { sheet, firstRow, lastRow: Number(match[2] ?? match[1]) };
}

/**
 * @description The link that opens a tab in Google Sheets.
 * @param {string} spreadsheetId - The spreadsheet id.
 * @param {number|null} [sheetId] - The tab id.
 * @returns {string} The URL.
 */
function sheetUrl(spreadsheetId, sheetId = null) {
  const base = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
  return sheetId === null || sheetId === undefined ? base : `${base}#gid=${sheetId}`;
}

/**
 * @description Split the values a scene typed: columns separated by `|`.
 * @param {unknown} input - The text.
 * @returns {string[]} The values, trimmed.
 * @example
 * splitValues('21.5 | living room'); // -> ['21.5', 'living room']
 */
function splitValues(input) {
  return String(input ?? '')
    .split('|')
    .map((value) => value.trim());
}

export {
  RefError,
  parseSpreadsheetRef,
  quoteSheet,
  columnLetters,
  columnIndex,
  splitRange,
  parseCell,
  parseColumns,
  parseRange,
  rowsOfRange,
  sheetUrl,
  splitValues,
};
