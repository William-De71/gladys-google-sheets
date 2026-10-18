// Fakes for the tests: Google (OAuth token endpoint + Sheets API v4) behind a
// `fetch`, following the documented requests and answers: values without
// their trailing empty rows and columns, FORMATTED_VALUE vs UNFORMATTED_VALUE,
// "Unable to parse range" for an unknown tab, 404 for an unknown spreadsheet,
// 429 when asked. Tests never touch the network.

import { TOKEN_URL, REVOKE_URL, SCOPE } from '../../src/auth.js';
import { API_BASE } from '../../src/sheets-api.js';
import { columnIndex, columnLetters, quoteSheet, splitRange } from '../../src/a1.js';

// Sunday 18 October 2026, 10:00 in Paris (08:00 UTC).
const NOW = Date.parse('2026-10-18T08:00:00Z');
const TZ = 'Europe/Paris';
const CLIENT_ID = '123456789012-abcdefghij.apps.googleusercontent.com';
const CLIENT_SECRET = 'GOCSPX-test-secret';
const SHEET_ID = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms';
const OTHER_ID = '1OtherSpreadsheetIdForTheTests_abcdefghij';
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit?gid=0#gid=0`;

const silent = { info() {}, warn() {}, error() {}, debug() {} };

/**
 * @description A cell shown differently from its value ("50 %" for 0.5).
 * @param {unknown} raw - The value.
 * @param {string} shown - What the sheet shows.
 * @returns {{ raw: unknown, shown: string }} The cell.
 */
const formatted = (raw, shown) => ({ raw, shown });

/**
 * @description A fake Google, as a `fetch`.
 * @returns {Function} The fetch, with `state` and helpers.
 */
function fakeGoogle() {
  const state = {
    spreadsheets: new Map([
      [
        SHEET_ID,
        {
          title: 'Home',
          sheets: [
            {
              sheetId: 0,
              title: 'Dashboard',
              rows: [
                ['Item', 'Value'],
                ['Pellet bags', 12],
                ['Fill level', formatted(0.5, '50%')],
                ['Status', 'Waiting'],
              ],
            },
            {
              sheetId: 1729,
              title: 'Form answers',
              rows: [
                ['Timestamp', 'Name', 'Request'],
                ['17/10/2026 18:00:00', 'Alice', 'Open the garage'],
                ['17/10/2026 19:30:00', 'Bob', 'Water the garden'],
              ],
            },
            { sheetId: 42, title: "Jon's log", rows: [['Date', 'Temperature']] },
          ],
        },
      ],
      [OTHER_ID, { title: 'Other', sheets: [{ sheetId: 0, title: 'Sheet1', rows: [] }] }],
    ]),
    revoked: false,
    apiDisabled: false,
    rateLimit: 0,
    calls: [],
    accessCount: 0,
  };

  const json = (status, body, headers = {}) =>
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json', ...headers },
    });
  const apiError = (status, message, extra = {}) =>
    json(status, { error: { code: status, message, ...extra } });

  /**
   * @description Read an A1 range against a spreadsheet.
   * @param {object} book - The spreadsheet.
   * @param {string} range - The range.
   * @returns {object|null} `{ sheet, r1, r2, c1, c2 }` (1-based rows, 0-based columns).
   */
  function locate(book, range) {
    const { sheet: name, cells } = splitRange(range);
    const title = name ?? (range.startsWith("'") ? range.slice(1, -1).replace(/''/g, "'") : range);
    const sheet = book.sheets.find((candidate) => candidate.title === (name ?? title));
    if (!sheet) {
      return null;
    }
    if (!name) {
      return { sheet, r1: 1, r2: Infinity, c1: 0, c2: Infinity };
    }
    const match = /^([A-Z]*)(\d*)(?::([A-Z]*)(\d*))?$/.exec(cells);
    const [, colA, rowA, colB, rowB] = match;
    const single = match[3] === undefined;
    return {
      sheet,
      r1: rowA ? Number(rowA) : 1,
      r2: single ? Number(rowA) : rowB ? Number(rowB) : Infinity,
      c1: colA ? columnIndex(colA) : 0,
      c2: single ? columnIndex(colA) : colB ? columnIndex(colB) : Infinity,
    };
  }

  const shown = (cell) =>
    cell && typeof cell === 'object'
      ? cell.shown
      : cell === undefined || cell === null
        ? ''
        : String(cell);
  const raw = (cell) =>
    cell && typeof cell === 'object' ? cell.raw : cell === undefined ? '' : cell;

  /**
   * @description The values of a located range, trailing empties left out.
   * @param {object} where - The located range.
   * @param {boolean} unformatted - UNFORMATTED_VALUE.
   * @returns {unknown[][]} The values.
   */
  function valuesOf(where, unformatted) {
    const rows = [];
    const last = Math.min(where.r2, where.sheet.rows.length);
    for (let r = where.r1; r <= last; r += 1) {
      const source = where.sheet.rows[r - 1] ?? [];
      const row = [];
      const end = Math.min(where.c2, source.length - 1);
      for (let c = where.c1; c <= end; c += 1) {
        row.push(unformatted ? raw(source[c]) : shown(source[c]));
      }
      while (row.length > 0 && (row[row.length - 1] === '' || row[row.length - 1] === undefined)) {
        row.pop();
      }
      rows.push(row);
    }
    while (rows.length > 0 && rows[rows.length - 1].length === 0) {
      rows.pop();
    }
    return rows;
  }

  // USER_ENTERED: a number typed is a number.
  const entered = (value, input) =>
    input === 'USER_ENTERED' && typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value)
      ? Number(value)
      : value;

  function write(sheet, row, column, values, input) {
    values.forEach((rowValues, i) => {
      const target = (sheet.rows[row - 1 + i] ??= []);
      rowValues.forEach((value, j) => {
        while (target.length < column + j) target.push('');
        target[column + j] = entered(value, input);
      });
    });
    for (let index = 0; index < sheet.rows.length; index += 1) {
      sheet.rows[index] ??= [];
    }
  }

  const a1Of = (sheet, row, c1, c2, row2 = row) =>
    `${quoteSheet(sheet.title)}!${columnLetters(c1)}${row}:${columnLetters(c2)}${row2}`;

  const fetchImpl = async (url, options = {}) => {
    const method = options.method ?? 'GET';
    const parsed = new URL(url);
    state.calls.push(
      `${method} ${decodeURIComponent(parsed.pathname)}${decodeURIComponent(parsed.search.replace(/\+/g, ' '))}`,
    );
    if (url === TOKEN_URL) {
      const form = new URLSearchParams(options.body);
      if (form.get('client_secret') !== CLIENT_SECRET) {
        return json(401, { error: 'invalid_client', error_description: 'Unauthorized' });
      }
      if (form.get('grant_type') === 'authorization_code') {
        if (form.get('code') !== 'good-code' || !form.get('code_verifier')) {
          return json(400, { error: 'invalid_grant', error_description: 'Bad Request' });
        }
        state.accessCount += 1;
        return json(200, {
          access_token: `access-${state.accessCount}`,
          expires_in: 3599,
          refresh_token: 'refresh-1',
          scope: form.get('code') === 'good-code' ? (state.grantedScope ?? SCOPE) : '',
          token_type: 'Bearer',
        });
      }
      if (state.revoked) {
        return json(400, {
          error: 'invalid_grant',
          error_description: 'Token has been expired or revoked.',
        });
      }
      state.accessCount += 1;
      return json(200, {
        access_token: `access-${state.accessCount}`,
        expires_in: 3599,
        scope: SCOPE,
      });
    }
    if (url === REVOKE_URL) {
      return json(200, {});
    }
    if (!url.startsWith(API_BASE)) {
      throw new Error(`Unexpected URL ${url}`);
    }
    if (!/^Bearer access-\d+$/.test(options.headers?.Authorization ?? '')) {
      return apiError(401, 'Request had invalid authentication credentials.', {
        status: 'UNAUTHENTICATED',
      });
    }
    if (state.apiDisabled) {
      return apiError(
        403,
        'Google Sheets API has not been used in project 1 before or it is disabled.',
        {
          status: 'PERMISSION_DENIED',
          details: [{ reason: 'SERVICE_DISABLED' }],
        },
      );
    }
    if (state.rateLimit > 0) {
      state.rateLimit -= 1;
      return apiError(429, "Quota exceeded for quota metric 'Read requests'", {
        status: 'RESOURCE_EXHAUSTED',
      });
    }
    const path = decodeURIComponent(parsed.pathname.slice(new URL(API_BASE).pathname.length));
    const match = /^\/([^/]+)(?:\/values(?::batchGet|\/(.+?)(:append|:clear)?))?$/.exec(path);
    if (!match) {
      return apiError(404, 'Not Found');
    }
    const book = state.spreadsheets.get(match[1]);
    if (!book) {
      return apiError(404, 'Requested entity was not found.', { status: 'NOT_FOUND' });
    }
    const query = parsed.searchParams;
    const unformatted = query.get('valueRenderOption') === 'UNFORMATTED_VALUE';
    if (method === 'GET' && !path.includes('/values')) {
      return json(200, {
        spreadsheetId: match[1],
        properties: { title: book.title, locale: 'fr_FR', timeZone: 'Europe/Paris' },
        sheets: book.sheets.map((sheet, index) => ({
          properties: { sheetId: sheet.sheetId, title: sheet.title, index },
        })),
      });
    }
    if (method === 'GET' && path.endsWith('values:batchGet')) {
      const valueRanges = [];
      for (const range of query.getAll('ranges')) {
        const where = locate(book, range);
        if (!where) {
          return apiError(400, `Unable to parse range: ${range}`, { status: 'INVALID_ARGUMENT' });
        }
        const values = valuesOf(where, unformatted);
        valueRanges.push({ range, majorDimension: 'ROWS', ...(values.length ? { values } : {}) });
      }
      return json(200, { spreadsheetId: match[1], valueRanges });
    }
    const range = match[2];
    const where = locate(book, range);
    if (!where) {
      return apiError(400, `Unable to parse range: ${range}`, { status: 'INVALID_ARGUMENT' });
    }
    if (method === 'GET') {
      const values = valuesOf(where, unformatted);
      return json(200, { range, majorDimension: 'ROWS', ...(values.length ? { values } : {}) });
    }
    const body = options.body ? JSON.parse(options.body) : {};
    const input = query.get('valueInputOption');
    if (method === 'POST' && match[3] === ':append') {
      const rows = where.sheet.rows;
      let last = rows.length;
      while (last > 0 && (rows[last - 1] ?? []).every((cell) => shown(cell) === '')) last -= 1;
      const row = last + 1;
      const c1 = Number.isFinite(where.c1) ? where.c1 : 0;
      write(where.sheet, row, c1, body.values, input);
      const width = Math.max(...body.values.map((v) => v.length));
      return json(200, {
        spreadsheetId: match[1],
        tableRange: a1Of(where.sheet, 1, c1, c1 + width - 1, last),
        updates: {
          spreadsheetId: match[1],
          updatedRange: a1Of(where.sheet, row, c1, c1 + width - 1, row + body.values.length - 1),
          updatedRows: body.values.length,
          updatedColumns: width,
          updatedCells: body.values.reduce((sum, v) => sum + v.length, 0),
        },
      });
    }
    if (method === 'PUT') {
      const width = Math.max(...body.values.map((v) => v.length));
      if (Number.isFinite(where.c2) && where.c2 !== where.c1 && where.c1 + width - 1 > where.c2) {
        return apiError(
          400,
          `Requested writing within range [${range}], but tried writing to column`,
        );
      }
      write(where.sheet, where.r1, where.c1, body.values, input);
      return json(200, {
        spreadsheetId: match[1],
        updatedRange: a1Of(
          where.sheet,
          where.r1,
          where.c1,
          where.c1 + width - 1,
          where.r1 + body.values.length - 1,
        ),
        updatedRows: body.values.length,
        updatedColumns: width,
        updatedCells: body.values.reduce((sum, v) => sum + v.length, 0),
      });
    }
    if (method === 'POST' && match[3] === ':clear') {
      const last = Math.min(where.r2, where.sheet.rows.length);
      for (let r = where.r1; r <= last; r += 1) {
        const row = where.sheet.rows[r - 1] ?? [];
        for (let c = where.c1; c <= Math.min(where.c2, row.length - 1); c += 1) row[c] = '';
      }
      return json(200, { spreadsheetId: match[1], clearedRange: range });
    }
    return apiError(405, 'Method Not Allowed');
  };

  Object.assign(fetchImpl, {
    state,
    /** A tab of the main spreadsheet. */
    sheet: (title, id = SHEET_ID) =>
      state.spreadsheets.get(id).sheets.find((s) => s.title === title),
    /** Type a value in a cell, as a user would. */
    setCell(title, a1, value, id = SHEET_ID) {
      const { column, row } = (() => {
        const m = /^([A-Z]+)(\d+)$/.exec(a1);
        return { column: columnIndex(m[1]), row: Number(m[2]) };
      })();
      write(fetchImpl.sheet(title, id), row, column, [[value]], 'RAW');
    },
    /** Add a row at the bottom, as Google Forms does. */
    addRow(title, values, id = SHEET_ID) {
      fetchImpl.sheet(title, id).rows.push(values);
    },
    apiCalls: () => state.calls.filter((call) => call.includes('/v4/spreadsheets')),
  });
  return fetchImpl;
}

export {
  NOW,
  TZ,
  CLIENT_ID,
  CLIENT_SECRET,
  SHEET_ID,
  OTHER_ID,
  SHEET_URL,
  silent,
  formatted,
  fakeGoogle,
};
