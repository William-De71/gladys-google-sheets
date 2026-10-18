// The pure A1 helpers and the Sheets API client (backoff, limiter, errors),
// against the fake Google: no network.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
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
  splitValues,
} from '../src/a1.js';
import { createSheetsClient, RENDER, INPUT, LIMIT_PER_MINUTE } from '../src/sheets-api.js';
import { fakeGoogle, SHEET_ID, SHEET_URL } from './helpers/fakes.js';

test('a pasted URL or a bare ID gives the spreadsheet and the tab', () => {
  assert.deepEqual(parseSpreadsheetRef(SHEET_URL), { spreadsheetId: SHEET_ID, sheetId: 0 });
  assert.deepEqual(
    parseSpreadsheetRef(`https://docs.google.com/spreadsheets/u/1/d/${SHEET_ID}/edit#gid=1729`),
    { spreadsheetId: SHEET_ID, sheetId: 1729 },
  );
  assert.deepEqual(parseSpreadsheetRef(` ${SHEET_ID} `), {
    spreadsheetId: SHEET_ID,
    sheetId: null,
  });
  assert.equal(parseSpreadsheetRef(''), null);
  assert.throws(() => parseSpreadsheetRef('my budget'), RefError);
  assert.throws(
    () =>
      parseSpreadsheetRef(
        'https://docs.google.com/spreadsheets/d/e/2PACX-1vQabcdefghijklmnopqrstuv/pubhtml',
      ),
    (err) => err.key === 'errorPublishedUrl',
  );
});

test('A1 notation: quoted tab names, columns, cells, ranges', () => {
  assert.equal(quoteSheet("Jon's log"), "'Jon''s log'");
  assert.equal(quoteSheet('A1'), "'A1'");
  assert.equal(columnLetters(0), 'A');
  assert.equal(columnLetters(25), 'Z');
  assert.equal(columnLetters(26), 'AA');
  assert.equal(columnLetters(701), 'ZZ');
  for (const index of [0, 25, 26, 51, 701, 702, 18277]) {
    assert.equal(columnIndex(columnLetters(index)), index);
  }
  assert.deepEqual(splitRange("'Jon''s log'!b$2"), { sheet: "Jon's log", cells: 'B2' });
  assert.deepEqual(splitRange('Data!A1'), { sheet: 'Data', cells: 'A1' });
  assert.deepEqual(parseCell('$c$12'), { column: 2, row: 12, a1: 'C12' });
  assert.throws(
    () => parseCell('B2:C3'),
    (err) => err.key === 'errorCell',
  );
  assert.throws(() => parseCell('B0'), RefError);
  assert.deepEqual(parseColumns(''), { start: 0, end: 25, a1: 'A:Z' });
  assert.deepEqual(parseColumns('b:f'), { start: 1, end: 5, a1: 'B:F' });
  assert.deepEqual(parseColumns('C'), { start: 2, end: 2, a1: 'C:C' });
  assert.throws(() => parseColumns('F:B'), RefError);
  assert.throws(() => parseColumns('A:ZZ'), RefError, 'more than 52 columns');
  for (const ok of ['B2', 'B2:D5', 'A:C', 'A2:C', '3:5', "'Log'!A2:D"]) {
    assert.doesNotThrow(() => parseRange(ok), ok);
  }
  for (const bad of ['', 'hello world', 'B2:', '=A1']) {
    assert.throws(() => parseRange(bad), RefError, bad);
  }
  assert.deepEqual(rowsOfRange("'Log'!A15:C16"), { sheet: 'Log', firstRow: 15, lastRow: 16 });
  assert.deepEqual(rowsOfRange("'Jon''s log'!B7"), { sheet: "Jon's log", firstRow: 7, lastRow: 7 });
  assert.equal(rowsOfRange(''), null);
  assert.deepEqual(splitValues(' 21.5 | living room |'), ['21.5', 'living room', '']);
});

/**
 * @description A client on the fake Google, with a virtual clock.
 * @returns {object} `{ api, google, clock, slept }`.
 */
function client() {
  const google = fakeGoogle();
  const clock = { now: Date.parse('2026-10-18T08:00:00Z') };
  const slept = [];
  let token = 0;
  const tokens = {
    async getAccessToken(force) {
      if (force || token === 0) {
        token += 1;
        google.state.accessCount = token;
      }
      return `access-${token}`;
    },
  };
  const api = createSheetsClient({
    tokens,
    fetchImpl: google,
    now: () => clock.now,
    sleep: async (ms) => {
      slept.push(ms);
      clock.now += ms;
    },
    random: () => 0.5,
  });
  return { api, google, clock, slept, tokens };
}

test('reads formatted and unformatted values, trailing empties left out', async () => {
  const { api, google } = client();
  const meta = await api.getMetadata(SHEET_ID);
  assert.equal(meta.title, 'Home');
  assert.deepEqual(
    meta.sheets.map((sheet) => [sheet.sheetId, sheet.title]),
    [
      [0, 'Dashboard'],
      [1729, 'Form answers'],
      [42, "Jon's log"],
    ],
  );
  const shown = await api.batchGet(
    SHEET_ID,
    ["'Dashboard'!B3", "'Dashboard'!A2:Z"],
    RENDER.FORMATTED,
  );
  assert.deepEqual(shown[0], [['50%']]);
  assert.deepEqual(shown[1], [
    ['Pellet bags', '12'],
    ['Fill level', '50%'],
    ['Status', 'Waiting'],
  ]);
  const raw = await api.batchGet(SHEET_ID, ["'Dashboard'!B3"], RENDER.UNFORMATTED);
  assert.deepEqual(raw[0], [[0.5]]);
  const calls = google.apiCalls();
  assert.match(
    calls.at(-1),
    /valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING/,
  );
  assert.match(calls.at(-2), /ranges='Dashboard'!B3&ranges='Dashboard'!A2:Z/);
  assert.deepEqual(await api.batchGet(SHEET_ID, []), [], 'no request for nothing');
});

test('writes: append after the table, update, clear; USER_ENTERED by default', async () => {
  const { api, google } = client();
  const appended = await api.append(SHEET_ID, "'Jon''s log'", [['2026-10-18', '21.5']]);
  assert.equal(appended.updatedRange, "'Jon''s log'!A2:B2");
  assert.equal(google.sheet("Jon's log").rows[1][1], 21.5, 'interpreted as a number');
  assert.match(
    google.apiCalls().at(-1),
    /:append\?valueInputOption=USER_ENTERED&insertDataOption=OVERWRITE/,
  );
  await api.update(SHEET_ID, "'Dashboard'!B4", [['Done']], INPUT.RAW);
  assert.equal(google.sheet('Dashboard').rows[3][1], 'Done');
  const cleared = await api.clear(SHEET_ID, "'Dashboard'!B2:B3");
  assert.equal(cleared.clearedRange, "'Dashboard'!B2:B3");
  assert.equal(google.sheet('Dashboard').rows[1][1], '');
});

test('HTTP 429: truncated exponential backoff, then the error', async () => {
  const { api, google, slept } = client();
  google.state.rateLimit = 2;
  const meta = await api.getMetadata(SHEET_ID);
  assert.equal(meta.title, 'Home');
  assert.deepEqual(slept, [1500, 2500], '2^n s + jitter');
  google.state.rateLimit = 10;
  await assert.rejects(api.getMetadata(SHEET_ID), (err) => err.rateLimited && err.status === 429);
  assert.deepEqual(slept.slice(2), [1500, 2500, 4500], 'three new tries at most');
});

test('the local limiter waits under 60 requests a minute, then refuses', async () => {
  const { api, slept, clock } = client();
  for (let index = 0; index < LIMIT_PER_MINUTE; index += 1) {
    await api.getValues(SHEET_ID, "'Dashboard'!A1");
    clock.now += 1000;
  }
  assert.deepEqual(slept, []);
  await api.getValues(SHEET_ID, "'Dashboard'!A1");
  assert.equal(slept.length, 1, 'waited for the oldest call to leave the minute');
  assert.ok(slept[0] > 9000 && slept[0] < 11000, String(slept[0]));
  // Writes have their own quota.
  await api.update(SHEET_ID, "'Dashboard'!C1", [['x']]);
  assert.equal(slept.length, 1);
  // A burst: the wait would be too long for a scene, so it is refused.
  const burst = client();
  for (let index = 0; index < LIMIT_PER_MINUTE; index += 1) {
    await burst.api.getValues(SHEET_ID, "'Dashboard'!A1");
  }
  await assert.rejects(
    burst.api.getValues(SHEET_ID, "'Dashboard'!A1"),
    (err) => err.rateLimited && err.local,
  );
  assert.equal(burst.api.calls().throttled, 1);
});

test('errors: 401 retried once with a fresh token, 404, bad range, API disabled', async () => {
  const { api, google } = client();
  const expired = client();
  // A token Google no longer accepts: one refresh, then success.
  let first = true;
  const tokens = {
    async getAccessToken(force) {
      if (first && !force) {
        first = false;
        return 'stale';
      }
      return 'access-1';
    },
  };
  const retried = createSheetsClient({ tokens, fetchImpl: expired.google, sleep: async () => {} });
  assert.equal((await retried.getMetadata(SHEET_ID)).title, 'Home');
  await assert.rejects(
    api.getMetadata('1NoSuchSpreadsheet_abcdefghijklmnop'),
    (err) => err.noAccess,
  );
  await assert.rejects(api.getValues(SHEET_ID, "'Nope'!A1"), (err) => err.badRange);
  google.state.apiDisabled = true;
  await assert.rejects(api.getMetadata(SHEET_ID), (err) => err.apiDisabled && !err.noAccess);
});
