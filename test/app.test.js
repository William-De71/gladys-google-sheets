// The whole integration against the fake Gladys of the SDK (which checks the
// discovered devices and the states like the host API does) and a fake Google.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';

import { createApp, ACTIONS, SCENE_ACTIONS, localTimestamp } from '../src/app.js';
import { WIDGETS, WIDGET_ACTIONS } from '../src/widgets.js';
import { TRIGGERS } from '../src/events.js';
import { SCOPE } from '../src/auth.js';
import {
  fakeGoogle,
  silent,
  NOW,
  TZ,
  CLIENT_ID,
  CLIENT_SECRET,
  SHEET_ID,
  OTHER_ID,
  SHEET_URL,
} from './helpers/fakes.js';

const PREFIX = 'ext:test-integration';
const CELL = `${PREFIX}:cell:${SHEET_ID}:0:B2`;
const STATUS = `${PREFIX}:cell:${SHEET_ID}:0:B4`;
const ROWS = `${PREFIX}:rows:${SHEET_ID}:1729:A-Z`;
const REDIRECT = 'https://my.gladysassistant.com/redirect/oauth';
const CLIENT = { client_id: CLIENT_ID, client_secret: CLIENT_SECRET };
const CONNECTED = {
  ...CLIENT,
  spreadsheet: SHEET_URL,
  access_token: 'access-0',
  refresh_token: 'refresh-1',
  token_expires_at: String(NOW + 3600000),
  token_client_id: CLIENT_ID,
};
const FORM_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit#gid=1729`;

/**
 * @description The integration on a fake Gladys and a fake Google.
 * @param {object} [options] - `{ config, google, clock, logger }`.
 * @returns {Promise<object>} `{ gladys, app, google, clock }`.
 */
async function startApp({
  config = CONNECTED,
  clock = { now: NOW },
  google,
  logger = silent,
} = {}) {
  const fetchImpl = google ?? fakeGoogle();
  const gladys = createFakeGladys({ config: { ...config } });
  const app = createApp(gladys, {
    fetchImpl,
    now: () => clock.now,
    sleep: async (ms) => {
      clock.now += ms;
    },
    timeZone: TZ,
    logger,
  });
  await gladys.connect();
  await app.idle();
  return { gladys, app, google: fetchImpl, clock };
}

const create = async (gladys, externalId) => {
  const device = gladys.fake.discoveredDevices.find((d) => d.external_id === externalId);
  assert.ok(device, `${externalId} is offered`);
  await gladys.fake.deviceCreated(device);
  return device;
};
const eventsOf = (gladys, key) => gladys.fake.sceneEvents.filter((event) => event.key === key);
const assertValid = (content) => assert.deepEqual(validateWidgetContent(content), []);

/** Declare the two usual watches: Dashboard!B2 (number) and the form answers. */
async function watchBoth(gladys) {
  const cell = await gladys.fake.action(ACTIONS.ADD_CELL, { cell: 'B2', name: 'Pellet stock' });
  assert.equal(cell.success, true, JSON.stringify(cell));
  const rows = await gladys.fake.action(ACTIONS.ADD_ROWS, {
    spreadsheet: FORM_URL,
    header: true,
    name: 'Requests',
  });
  assert.equal(rows.success, true, JSON.stringify(rows));
  return { cell, rows };
}

test('without a client, then without a connection: says what to do', async (t) => {
  const first = await startApp({ config: {} });
  t.after(() => first.gladys.fake.shutdown());
  assert.equal(first.gladys.fake.connectionStatus.connected, false);
  assert.match(first.gladys.fake.connectionStatus.message.fr, /Client ID/);
  const second = await startApp({ config: CLIENT });
  t.after(() => second.gladys.fake.shutdown());
  assert.match(second.gladys.fake.connectionStatus.message.en, /Connect with Google/);
  assert.equal(second.google.state.calls.length, 0, 'no call without tokens');
  const refused = await second.gladys.fake.action(ACTIONS.ADD_CELL, { cell: 'B2' });
  assert.equal(refused.success, false);
});

test('OAuth: spreadsheets scope only, persisted state, PKCE exchange', async (t) => {
  const { gladys, google } = await startApp({ config: CLIENT });
  t.after(() => gladys.fake.shutdown());
  const ack = await gladys.fake.oauthAuthorizeUrl('google_account', REDIRECT);
  const url = new URL(ack.data.authorize_url);
  const query = Object.fromEntries(url.searchParams);
  assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(query.scope, 'https://www.googleapis.com/auth/spreadsheets');
  assert.equal(query.scope, SCOPE);
  assert.equal(query.redirect_uri, REDIRECT);
  assert.equal(query.access_type, 'offline');
  assert.equal(query.code_challenge_method, 'S256');
  assert.equal(gladys.fake.config.oauth_state, query.state);

  const refused = await gladys.fake.oauthCallback('google_account', {
    code: 'good-code',
    state: 'forged',
    redirectUri: REDIRECT,
  });
  assert.equal(refused.success, false);
  const accepted = await gladys.fake.oauthCallback('google_account', {
    code: 'good-code',
    state: query.state,
    redirectUri: REDIRECT,
  });
  assert.equal(accepted.success, true);
  assert.ok(google.state.calls.some((call) => call.startsWith('POST /token')));
  assert.equal(gladys.fake.config.refresh_token, 'refresh-1');
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.match(gladys.fake.connectionStatus.message.en, /No watch yet/);
});

test('OAuth: a consent without the Sheets permission is refused', async (t) => {
  const google = fakeGoogle();
  google.state.grantedScope = 'openid';
  const { gladys } = await startApp({ config: CLIENT, google });
  t.after(() => gladys.fake.shutdown());
  const ack = await gladys.fake.oauthAuthorizeUrl('google_account', REDIRECT);
  const state = new URL(ack.data.authorize_url).searchParams.get('state');
  const result = await gladys.fake.oauthCallback('google_account', {
    code: 'good-code',
    state,
    redirectUri: REDIRECT,
  });
  assert.equal(result.success, false);
  assert.match(gladys.fake.connectionStatus.message.fr, /feuilles de calcul/);
});

test('watch a cell: device, state once created, cell_changed on change only', async (t) => {
  const { gladys, app, google } = await startApp();
  t.after(() => gladys.fake.shutdown());
  const added = await gladys.fake.action(ACTIONS.ADD_CELL, { cell: "'Dashboard'!b2" });
  assert.equal(added.success, true);
  assert.match(
    added.data.message.en,
    /#1 Dashboard!B2 \(Home\) \(cell, Dashboard!B2\) — value: 12/,
  );
  assert.deepEqual(JSON.parse(gladys.fake.config.watches)[0].id, `${SHEET_ID}:0:B2`);
  const device = await create(gladys, CELL);
  assert.equal(device.features[0].category, 'unknown');
  assert.equal(gladys.fake.lastState(`${CELL}:value`), 12, 'published once created');
  assert.equal(
    eventsOf(gladys, TRIGGERS.CELL_CHANGED).length,
    0,
    'the first reading is a reference',
  );

  google.setCell('Dashboard', 'B2', 9);
  await app.poll();
  const [event] = eventsOf(gladys, TRIGGERS.CELL_CHANGED);
  assert.deepEqual(event.data, {
    watch: CELL,
    watch_name: 'Dashboard!B2 (Home)',
    spreadsheet_name: 'Home',
    sheet_name: 'Dashboard',
    cell: 'B2',
    value: '9',
    previous_value: '12',
    is_number: true,
    number: 9,
    previous_number: 12,
  });
  assert.equal(gladys.fake.lastState(`${CELL}:value`), 9);
  await app.poll();
  assert.equal(eventsOf(gladys, TRIGGERS.CELL_CHANGED).length, 1, 'no change, no event');

  const duplicate = await gladys.fake.action(ACTIONS.ADD_CELL, { cell: 'B2' });
  assert.equal(duplicate.success, false);
  const bad = await gladys.fake.action(ACTIONS.ADD_CELL, { cell: 'B2:C3' });
  assert.equal(bad.success, false);
});

test('a text cell: text feature and state; formatted vs unformatted numbers', async (t) => {
  const { gladys, app, google } = await startApp();
  t.after(() => gladys.fake.shutdown());
  await gladys.fake.action(ACTIONS.ADD_CELL, { cell: 'B4', kind: 'text', name: 'Status' });
  await gladys.fake.action(ACTIONS.ADD_CELL, { cell: 'B3', kind: 'number', name: 'Fill' });
  const status = await create(gladys, STATUS);
  assert.equal(status.features[0].category, 'text');
  await create(gladys, `${PREFIX}:cell:${SHEET_ID}:0:B3`);
  assert.equal(gladys.fake.lastState(`${STATUS}:value`), 'Waiting');
  assert.equal(gladys.fake.lastState(`${PREFIX}:cell:${SHEET_ID}:0:B3:value`), 0.5, '50 % is 0.5');
  google.setCell('Dashboard', 'B4', 'Done');
  await app.poll();
  const [event] = eventsOf(gladys, TRIGGERS.CELL_CHANGED);
  assert.equal(event.data.value, 'Done');
  assert.equal(event.data.is_number, false);
  assert.equal(event.data.number, 0);
});

test('watch new rows: counter, row_added per new row, rows widget with a header form', async (t) => {
  const { gladys, app, google } = await startApp();
  t.after(() => gladys.fake.shutdown());
  await watchBoth(gladys);
  await create(gladys, ROWS);
  assert.equal(gladys.fake.lastState(`${ROWS}:rows`), 2, 'two answers, the header not counted');

  google.addRow('Form answers', ['18/10/2026 09:12:00', 'Carol', 'Feed the cat']);
  google.addRow('Form answers', ['18/10/2026 09:13:00', 'Dave', 'Close the shutters']);
  await app.poll();
  const events = eventsOf(gladys, TRIGGERS.ROW_ADDED);
  assert.equal(events.length, 2);
  assert.equal(events[0].data.watch, ROWS);
  assert.equal(events[0].data.row, 4);
  assert.equal(events[0].data.column_2, 'Carol');
  assert.equal(events[0].data.column_3, 'Feed the cat');
  assert.equal(events[0].data.column_10, '');
  assert.equal(events[0].data.values, '18/10/2026 09:12:00 | Carol | Feed the cat');
  assert.equal(events[0].data.first_column, 'A');
  assert.ok(Object.keys(events[0].data).length <= 30);
  assert.equal(gladys.fake.lastState(`${ROWS}:rows`), 4);
  // Only the new rows travel: from the last known row down.
  assert.ok(google.apiCalls().some((call) => call.includes("ranges='Form answers'!A3:Z&")));

  const ack = await gladys.fake.widgetGet(WIDGETS.ROWS, {
    settings: { watch: ROWS },
    language: 'fr',
  });
  const content = ack.data.content;
  assertValid(content);
  const list = content.components.find((c) => c.type === 'card-list');
  assert.deepEqual(
    list.items.map((item) => [item.title, item.badge.text]),
    [
      ['18/10/2026 09:13:00', '#5'],
      ['18/10/2026 09:12:00', '#4'],
      ['17/10/2026 19:30:00', '#3'],
      ['17/10/2026 18:00:00', '#2'],
    ],
  );
  assert.equal(
    list.items[0].description,
    'Timestamp: 18/10/2026 09:13:00\nName: Dave\nRequest: Close the shutters',
  );
  const add = content.components.find((c) => c.action?.key === WIDGET_ACTIONS.ADD_ROW);
  assert.deepEqual(
    add.action.fields.map((field) => field.label.fr),
    ['Timestamp', 'Name', 'Request'],
  );
  const open = content.components.find((c) => c.link);
  assert.equal(open.link.url, `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit#gid=1729`);
});

test('the widget form and the scene actions never raise events', async (t) => {
  const { gladys, app, google } = await startApp();
  t.after(() => gladys.fake.shutdown());
  await watchBoth(gladys);
  const ack = await gladys.fake.widgetGet(WIDGETS.ROWS, {
    settings: { watch: ROWS, form: 'add_timestamp' },
    language: 'en',
  });
  const add = ack.data.content.components.find((c) => c.action?.key === WIDGET_ACTIONS.ADD_ROW);
  assert.deepEqual(
    add.action.fields.map((field) => field.key),
    ['column_1', 'column_2'],
    'the first column takes the date and time',
  );
  const done = await gladys.fake.widgetAction(
    WIDGETS.ROWS,
    WIDGET_ACTIONS.ADD_ROW,
    {},
    {
      settings: { watch: ROWS, form: 'add_timestamp' },
      values: { column_1: 'Eve', column_2: 'Lights off' },
    },
  );
  assert.equal(done.data.message.en, 'Row added (row 4).');
  assert.deepEqual(google.sheet('Form answers').rows[3], [
    '2026-10-18 10:00:00',
    'Eve',
    'Lights off',
  ]);

  const write = await gladys.fake.sceneAction(SCENE_ACTIONS.WRITE_CELLS, {
    range: 'Dashboard!B2',
    values: '40',
  });
  assert.equal(write.success, true);
  assert.deepEqual(write.data.outputs, { updated_range: "'Dashboard'!B2:B2", updated_cells: 1 });
  await app.poll();
  assert.equal(eventsOf(gladys, TRIGGERS.ROW_ADDED).length, 0, 'the row of the widget');
  assert.equal(eventsOf(gladys, TRIGGERS.CELL_CHANGED).length, 0, 'the cell of the scene');
  assert.equal(app.watcher.stateOf(`${SHEET_ID}:0:B2`).number, 40, 'but the state follows');

  // A user change after that is seen again.
  google.addRow('Form answers', ['18/10/2026 11:00:00', 'Frank', 'Heat the bathroom']);
  await app.poll();
  assert.equal(eventsOf(gladys, TRIGGERS.ROW_ADDED).length, 1);
});

test('scene actions: append with time stamp, read, clear; only the declared outputs', async (t) => {
  const { gladys, google } = await startApp();
  t.after(() => gladys.fake.shutdown());
  const append = await gladys.fake.sceneAction(SCENE_ACTIONS.APPEND_ROW, {
    sheet: "Jon's log",
    values: '21.5 | living room',
    timestamp: 'first',
  });
  assert.equal(append.success, true, JSON.stringify(append));
  assert.deepEqual(append.data.outputs, { row: 2, updated_range: "'Jon''s log'!A2:C2" });
  assert.deepEqual(google.sheet("Jon's log").rows[1], ['2026-10-18 10:00:00', 21.5, 'living room']);
  const raw = await gladys.fake.sceneAction(SCENE_ACTIONS.APPEND_ROW, {
    spreadsheet: OTHER_ID,
    values: '=1+1 | 007',
    input: 'raw',
  });
  assert.equal(raw.success, true);
  assert.deepEqual(google.sheet('Sheet1', OTHER_ID).rows[0], ['=1+1', '007'], 'RAW keeps the text');

  const read = await gladys.fake.sceneAction(SCENE_ACTIONS.READ_CELLS, { range: 'B2:B4' });
  assert.deepEqual(read.data.outputs, {
    value: '12',
    number: 12,
    is_number: true,
    values: '12\n50%\nWaiting',
    cell_count: 3,
    row_count: 3,
  });
  const percent = await gladys.fake.sceneAction(SCENE_ACTIONS.READ_CELLS, { range: 'B3' });
  assert.equal(percent.data.outputs.value, '50%');
  assert.equal(percent.data.outputs.number, 0.5);

  const clear = await gladys.fake.sceneAction(SCENE_ACTIONS.CLEAR_RANGE, {
    range: "'Jon''s log'!A2:C",
  });
  assert.deepEqual(clear.data.outputs, { cleared_range: "'Jon''s log'!A2:C" });
  assert.deepEqual(google.sheet("Jon's log").rows[1], ['', '', '']);
  assert.equal(gladys.fake.sceneEvents.length, 0);
});

test('scene actions: clear errors, never a crash', async (t) => {
  const { gladys } = await startApp({ config: { ...CONNECTED, spreadsheet: '' } });
  t.after(() => gladys.fake.shutdown());
  const none = await gladys.fake.sceneAction(SCENE_ACTIONS.APPEND_ROW, { values: 'x' });
  assert.equal(none.success, false);
  assert.match(none.error ?? JSON.stringify(none), /No spreadsheet/);
  const tab = await gladys.fake.sceneAction(SCENE_ACTIONS.READ_CELLS, {
    spreadsheet: SHEET_URL,
    sheet: 'Nope',
    range: 'A1',
  });
  assert.match(tab.error ?? JSON.stringify(tab), /No tab "Nope"/);
  const range = await gladys.fake.sceneAction(SCENE_ACTIONS.WRITE_CELLS, {
    spreadsheet: SHEET_ID,
    range: 'hello',
    values: '1',
  });
  assert.match(range.error ?? JSON.stringify(range), /is not a range/);
  const access = await gladys.fake.sceneAction(SCENE_ACTIONS.READ_CELLS, {
    spreadsheet: '1NoSuchSpreadsheetForTheTests_abcdefghij',
    range: 'A1',
  });
  assert.match(access.error ?? JSON.stringify(access), /cannot open it/);
  const empty = await gladys.fake.sceneAction(SCENE_ACTIONS.APPEND_ROW, {
    spreadsheet: SHEET_ID,
    values: ' | ',
    timestamp: 'first',
  });
  assert.match(empty.error ?? JSON.stringify(empty), /at least one value/);
});

test('a renamed tab keeps working; deleted rows give a new reference without events', async (t) => {
  const { gladys, app, google, clock } = await startApp();
  t.after(() => gladys.fake.shutdown());
  await watchBoth(gladys);
  google.sheet('Form answers').title = 'Answers 2026';
  google.addRow('Answers 2026', ['18/10/2026 12:00:00', 'Gina', 'Open the gate']);
  clock.now += 60000;
  assert.equal(await app.poll(), true);
  const [event] = eventsOf(gladys, TRIGGERS.ROW_ADDED);
  assert.equal(event.data.sheet_name, 'Answers 2026');

  google.sheet('Answers 2026').rows.splice(1, 3);
  await app.poll();
  assert.equal(eventsOf(gladys, TRIGGERS.ROW_ADDED).length, 1, 'no event for a reference');
  assert.equal(app.watcher.stateOf(`${SHEET_ID}:1729:A-Z`).count, 0);
  google.addRow('Answers 2026', ['18/10/2026 13:00:00', 'Hugo', 'Start the robot']);
  await app.poll();
  assert.equal(eventsOf(gladys, TRIGGERS.ROW_ADDED).at(-1).data.row, 2);
});

test('a deleted tab or a lost spreadsheet: the watch reports it, the others go on', async (t) => {
  const { gladys, app, google } = await startApp();
  t.after(() => gladys.fake.shutdown());
  await watchBoth(gladys);
  await create(gladys, CELL);
  await gladys.fake.action(ACTIONS.ADD_CELL, { spreadsheet: OTHER_ID, cell: 'A1', name: 'Other' });
  google.state.spreadsheets.get(SHEET_ID).sheets.splice(1, 1);
  google.state.spreadsheets.delete(OTHER_ID);
  google.setCell('Dashboard', 'B2', 3);
  await app.poll();
  assert.equal(gladys.fake.lastState(`${CELL}:value`), 3, 'the readable watch goes on');
  assert.match(gladys.fake.connectionStatus.message.en, /2 of 3 watch\(es\) cannot be read/);
  const list = await gladys.fake.action(ACTIONS.LIST_WATCHES);
  assert.match(
    list.data.message.en,
    /#2 Requests \(new rows, Form answers!A:Z\) — its tab was deleted/,
  );
  assert.match(list.data.message.fr, /#3 Other .*n’existe pas/);
  const removed = await gladys.fake.action(ACTIONS.REMOVE_WATCH, { watch: 'requests' });
  assert.equal(removed.success, true);
  const gone = await gladys.fake.action(ACTIONS.REMOVE_WATCH, { watch: '#9' });
  assert.equal(gone.success, false);
  assert.equal(JSON.parse(gladys.fake.config.watches).length, 2);
  assert.ok(!gladys.fake.discoveredDevices.some((device) => device.external_id === ROWS));
});

test('quota: a 429 on a reading keeps the connection, says it, and the next reading works', async (t) => {
  const { gladys, app, google } = await startApp();
  t.after(() => gladys.fake.shutdown());
  await watchBoth(gladys);
  // The first try and three new ones, all refused.
  google.state.rateLimit = 4;
  assert.equal(await app.poll(), false);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.match(gladys.fake.connectionStatus.message.en, /quota/);
  assert.equal(await app.poll(), true);
});

test('the access revoked at Google stops the readings until a new connection', async (t) => {
  const { gladys, app, google } = await startApp({
    config: { ...CONNECTED, token_expires_at: String(NOW - 1000) },
  });
  t.after(() => gladys.fake.shutdown());
  google.state.revoked = true;
  const result = await gladys.fake.action(ACTIONS.ADD_CELL, { cell: 'B2' });
  assert.equal(result.success, false);
  assert.equal(app.tokens.lost, true);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /Connect with Google/);
});

test('configuration actions: test, diagnostic without secrets, disconnect', async (t) => {
  const lines = [];
  const logger = { ...silent, info: (line) => lines.push(String(line)) };
  const { gladys, google } = await startApp({ logger });
  t.after(() => gladys.fake.shutdown());
  await watchBoth(gladys);
  const tested = await gladys.fake.action(ACTIONS.TEST_CONNECTION);
  assert.match(
    tested.data.message.en,
    /Default spreadsheet "Home" opened\. 2 watch\(es\), 0 unreadable/,
  );
  await gladys.fake.action(ACTIONS.DIAGNOSTIC);
  const diagnostic = lines.filter((line) => line.startsWith('[diagnostic]')).join('\n');
  assert.match(diagnostic, /watch #2 rows/);
  for (const secret of [
    CLIENT_SECRET,
    'refresh-1',
    'access-',
    CLIENT_ID,
    SHEET_ID,
    'Dashboard',
    'Alice',
    'Home',
  ]) {
    assert.ok(!diagnostic.includes(secret), secret);
  }
  const bye = await gladys.fake.action(ACTIONS.DISCONNECT);
  assert.match(bye.data.message.en, /Disconnected/);
  assert.ok(google.state.calls.some((call) => call.startsWith('POST /revoke')));
  assert.equal(gladys.fake.config.refresh_token, '');
  assert.equal(JSON.parse(gladys.fake.config.watches).length, 2, 'the watches are kept');
});

test('the tokens of another Client ID are dropped; the watches survive a restart', async (t) => {
  const first = await startApp();
  await watchBoth(first.gladys);
  const saved = { ...first.gladys.fake.config };
  await first.gladys.fake.shutdown();
  const second = await startApp({ config: saved });
  t.after(() => second.gladys.fake.shutdown());
  assert.equal(second.app.registry.list().length, 2);
  assert.equal(second.gladys.fake.discoveredDevices.length, 2);
  const other = await startApp({
    config: { ...saved, client_id: 'other.apps.googleusercontent.com' },
  });
  t.after(() => other.gladys.fake.shutdown());
  assert.equal(other.google.apiCalls().length, 0);
  assert.equal(other.gladys.fake.config.refresh_token, '');
});

test('the date and time written follow the time zone of Gladys', () => {
  assert.equal(localTimestamp(NOW, 'Europe/Paris'), '2026-10-18 10:00:00');
  assert.equal(localTimestamp(NOW, 'America/New_York'), '2026-10-18 04:00:00');
});
