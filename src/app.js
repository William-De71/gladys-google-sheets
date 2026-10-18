// -----------------------------------------------------------------------------
// The Google Sheets integration, wired to a Gladys client.
//
// `createApp(gladys)` registers every handler on the client it receives:
// `new GladysIntegration()` in production (index.js), the fake Gladys of the
// SDK in the tests. Nothing here connects: the caller does, once the
// handlers are registered.
//
// Data flow:
//   - the user declares watches (a cell, or the new rows of a tab) with the
//     configuration buttons (registry.js); each one is offered as a device;
//   - the watches are read every `poll_minutes` by an internal timer
//     (watcher.js), and again a few seconds after a change made from Gladys;
//     each reading publishes the states that changed, the scene events and a
//     widget refresh;
//   - the scene actions and the widget form write to any spreadsheet the
//     account can edit (append a row, write cells, read cells, clear).
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { logger as sdkLogger, DEVICE_TRANSPORTS } from '@gladysassistant/integration-sdk';
import {
  ACCOUNT_FIELD,
  AUTO_LANGUAGE,
  INTERNAL_KEYS,
  normalizeConfig,
  readLanguage,
} from './config.js';
import {
  AuthError,
  buildAuthorizeUrl,
  createPkce,
  createTokenManager,
  exchangeCode,
  revokeToken,
} from './auth.js';
import { createSheetsClient, SheetsApiError, RENDER, INPUT } from './sheets-api.js';
import {
  RefError,
  columnLetters,
  parseCell,
  parseColumns,
  parseRange,
  parseSpreadsheetRef,
  quoteSheet,
  rowsOfRange,
  splitRange,
  splitValues,
} from './a1.js';
import { KINDS, VALUE_KINDS, RegistryError, createRegistry } from './registry.js';
import { cleanRow, numberOf, resolveSheet, createWatcher } from './watcher.js';
import { idsOf, parseExternalId, buildDevice, buildState } from './device.js';
import { TRIGGERS, cellEventData, rowEventData } from './events.js';
import {
  WIDGETS,
  WIDGET_ACTIONS,
  FORMS,
  COUNT,
  FORM_FIELDS,
  messageContent,
  buildRowsWidget,
} from './widgets.js';
import { t, all, each } from './i18n.js';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const ACTIONS = {
  ADD_CELL: 'add_cell',
  ADD_ROWS: 'add_rows',
  REMOVE_WATCH: 'remove_watch',
  LIST_WATCHES: 'list_watches',
  TEST_CONNECTION: 'test_connection',
  DIAGNOSTIC: 'diagnostic',
  DISCONNECT: 'disconnect',
};
const SCENE_ACTIONS = {
  APPEND_ROW: 'append_row',
  WRITE_CELLS: 'write_cells',
  READ_CELLS: 'read_cells',
  CLEAR_RANGE: 'clear_range',
};
// Options of the scene actions.
const TIMESTAMP = { NONE: 'none', FIRST: 'first' };
const INPUT_OPTIONS = { USER_ENTERED: 'user_entered', RAW: 'raw' };

const MINUTE = 60 * 1000;
// Unchanged states again every hour, so the dashboard never shows them as outdated.
const HEARTBEAT_MS = 60 * MINUTE;
const RETRY_MS = 5 * MINUTE;
// The reading after a change made from Gladys.
const SOON_MS = 10 * 1000;
const WIDGET_REFRESH_MIN_MS = 10 * 1000;
// A scene output string is capped at 10 000 characters.
const MAX_OUTPUT = 10000;
// Cells written by one scene action (a row of a sheet has 18 278 columns at most).
const MAX_VALUES = 200;
// A cell holds 50 000 characters at most.
const MAX_CELL = 50000;

/**
 * @description "2026-10-18 14:05:00" in a time zone: Google Sheets reads it
 * as a date and time with USER_ENTERED, whatever the locale of the sheet.
 * @param {number} instant - The instant, in ms.
 * @param {string|undefined} timeZone - The zone (undefined: the system's).
 * @returns {string} The local date and time.
 */
function localTimestamp(instant, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(instant))
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

/**
 * @description A valid time zone, or undefined (the system's).
 * @param {string|undefined} zone - The TZ.
 * @returns {string|undefined} The zone.
 */
function safeTimeZone(zone) {
  if (!zone) {
    return undefined;
  }
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return zone;
  } catch {
    return undefined;
  }
}

/**
 * @description Read a boolean of a form (true, "true", 1…), with a default.
 * @param {unknown} raw - The value.
 * @param {boolean} fallback - When empty.
 * @returns {boolean} The boolean.
 */
function readFlag(raw, fallback) {
  if (raw === true || raw === 'true' || raw === 1 || raw === '1') return true;
  if (raw === false || raw === 'false' || raw === 0 || raw === '0') return false;
  return fallback;
}

/**
 * @description Register the handlers of the integration on a Gladys client.
 * @param {object} gladys - The GladysIntegration instance (or the fake one).
 * @param {object} [options] - Options (tests).
 * @param {Function} [options.fetchImpl] - fetch.
 * @param {Function} [options.now] - Clock.
 * @param {Function} [options.sleep] - Waiting (backoff, limiter).
 * @param {string} [options.timeZone] - Time zone (default: TZ).
 * @param {object} [options.logger] - Logger.
 * @returns {object} What the tests look into.
 */
export function createApp(
  gladys,
  { fetchImpl = fetch, now = Date.now, sleep, timeZone = process.env.TZ, logger = sdkLogger } = {},
) {
  const zone = safeTimeZone(timeZone);
  let config = normalizeConfig();
  let lastLanguage = 'en';
  let createdDevices = new Set();
  let createdFeatures = new Set();
  let lastStatus = null;
  let pollTimer = null;
  let soonTimer = null;
  let retryTimer = null;
  let starting = Promise.resolve();
  let queue = Promise.resolve();
  let offered = '';
  let lastError = null;
  let pendingAuth = { state: '', verifier: '' };
  const transports = new Map();
  const widgetRefreshedAt = new Map();
  // The current tab and spreadsheet names of each watch (they can be renamed).
  const titles = new Map();

  const tokens = createTokenManager({
    fetchImpl,
    now,
    getClient: () => ({ clientId: config.clientId, clientSecret: config.clientSecret }),
    saveTokens: async (next) => {
      await gladys.setConfig({
        [INTERNAL_KEYS.accessToken]: next.accessToken,
        [INTERNAL_KEYS.refreshToken]: next.refreshToken,
        [INTERNAL_KEYS.expiresAt]: next.expiresAt ? String(next.expiresAt) : '',
        [INTERNAL_KEYS.tokenClientId]: next.clientId,
      });
    },
  });
  const api = createSheetsClient({ tokens, fetchImpl, now, ...(sleep ? { sleep } : {}) });
  const registry = createRegistry(gladys, { logger });
  const watcher = createWatcher({ api, now, logger });

  // --- Helpers ---------------------------------------------------------------------

  const connected = () => tokens.hasGrant() && !tokens.lost;

  /**
   * @description Run one reading or change at a time (the states are shared).
   * @param {Function} task - `async () => value`.
   * @returns {Promise<unknown>} Its result.
   */
  function exclusive(task) {
    const run = queue.catch(() => {}).then(task);
    queue = run.catch(() => {});
    return run;
  }

  /**
   * @description The language of the texts written outside a widget request.
   * @returns {string} The language.
   */
  function textLanguage() {
    return config.language === AUTO_LANGUAGE ? lastLanguage : config.language;
  }

  /**
   * @description Remember the language of a widget request.
   * @param {string} next - The language.
   */
  function rememberLanguage(next) {
    if (typeof next !== 'string' || !/^(en|fr|de|es)$/.test(next) || next === lastLanguage) {
      return;
    }
    lastLanguage = next;
    gladys
      .setConfig({ [INTERNAL_KEYS.language]: next })
      .catch((err) => logger.warn(`Unable to store the language: ${err.message}`));
  }

  /**
   * @description Report the connection status, only when it changed.
   * @param {boolean} isConnected - Connected or not.
   * @param {object} message - The multi-language message.
   * @returns {Promise<void>}
   */
  async function reportStatus(isConnected, message) {
    const signature = JSON.stringify([isConnected, message]);
    if (signature === lastStatus) {
      return;
    }
    lastStatus = signature;
    try {
      await gladys.setConnectionStatus(isConnected, message);
    } catch (err) {
      lastStatus = null;
      logger.error('Unable to report the connection status', err);
    }
  }

  /**
   * @description Ask Gladys to refresh a widget (at most once every 10 s).
   * @param {string} key - The widget key.
   */
  function refreshWidget(key) {
    const last = widgetRefreshedAt.get(key) ?? 0;
    if (now() - last < WIDGET_REFRESH_MIN_MS) {
      return;
    }
    widgetRefreshedAt.set(key, now());
    try {
      gladys.requestWidgetRefresh(key);
    } catch (err) {
      logger.debug?.(`Widget refresh not sent: ${err.message}`);
    }
  }

  const refreshWidgets = () => Object.values(WIDGETS).forEach(refreshWidget);

  /**
   * @description Refresh the external ids of the devices the user created.
   * @returns {Promise<void>}
   */
  async function refreshCreatedDevices() {
    try {
      const devices = await gladys.getDevices();
      createdDevices = new Set(devices.map((device) => device.external_id));
      createdFeatures = new Set(
        devices.flatMap((device) => (device.features ?? []).map((feature) => feature.external_id)),
      );
    } catch (err) {
      logger.warn(`Unable to read the devices: ${err.message}`);
    }
  }

  /**
   * @description The message of an error for the user, in a language.
   * @param {Error} err - The error.
   * @param {string} language - The language.
   * @returns {string} The message.
   */
  function explain(err, language) {
    if (err instanceof RefError || err instanceof RegistryError) {
      return t(err.key, language, err.params);
    }
    if (err instanceof SheetsApiError) {
      if (err.apiDisabled) return t('statusApiDisabled', language);
      if (err.noAccess) return t('errorNoAccess', language);
      if (err.rateLimited) return t('statusQuota', language);
      if (err.badRange) return t('errorBadRange', language);
      return t('errorGoogle', language, { message: err.message });
    }
    if (err instanceof AuthError) {
      return t('statusReauth', language);
    }
    return t('errorGoogle', language, { message: err.message });
  }

  /**
   * @description Run a step of a configuration or scene action, turning its
   * errors into a message the user can read (Gladys shows `message`).
   * @param {Function} step - `async () => value`.
   * @returns {Promise<unknown>} Its result.
   */
  async function guarded(step) {
    try {
      return await step();
    } catch (err) {
      if (err instanceof AuthError && err.reauth) {
        await handleAuthLost(err);
      }
      throw new Error(explain(err, textLanguage()), { cause: err });
    }
  }

  /** @throws {RegistryError} When Google is not connected. */
  function requireConnection() {
    if (!connected()) {
      throw new RegistryError(tokens.lost ? 'statusReauth' : 'notConnected');
    }
  }

  // --- Publishing ---------------------------------------------------------------------

  /**
   * @description Offer a device per watch on the Discovery screen, when the
   * watches or their names changed (or when forced).
   * @param {boolean} [force] - Even if unchanged.
   * @returns {Promise<number>} How many devices were offered.
   */
  async function publishDiscoveredDevices(force = false) {
    const language = textLanguage();
    const devices = registry.list().map((watch) => buildDevice(gladys, watch, language));
    const signature = JSON.stringify(devices.map((device) => [device.external_id, device.name]));
    if (!force && signature === offered) {
      return devices.length;
    }
    await gladys.publishDiscoveredDevices(devices);
    offered = signature;
    return devices.length;
  }

  /**
   * @description Publish the states that changed (or are an hour old), only
   * for the created features.
   * @param {string} [onlyWatch] - One watch, everything again (device created).
   * @returns {Promise<void>}
   */
  async function publishStates(onlyWatch) {
    const states = [];
    for (const watch of registry.list()) {
      if (onlyWatch && watch.id !== onlyWatch) {
        continue;
      }
      const state = buildState(gladys, watch, watcher.stateOf(watch.id));
      if (state && createdFeatures.has(state.device_feature_external_id)) {
        states.push(state);
      }
    }
    if (onlyWatch) {
      const watch = registry.byId(onlyWatch);
      if (watch) {
        gladys.forgetPublishedStates(idsOf(gladys, watch).device);
      }
    }
    if (states.length > 0) {
      await gladys.publishChangedStates(states, { heartbeat: HEARTBEAT_MS });
    }
  }

  /**
   * @description Publish the transport badge of the created watches, on change:
   * cloud, or unreachable once the Google access is lost or the watch failed.
   * @returns {Promise<void>}
   */
  async function publishTransports() {
    const entries = [];
    for (const watch of registry.list()) {
      const externalId = idsOf(gladys, watch).device;
      const transport =
        connected() && !watcher.errorOf(watch.id)
          ? DEVICE_TRANSPORTS.CLOUD
          : DEVICE_TRANSPORTS.UNREACHABLE;
      if (createdDevices.has(externalId) && transports.get(externalId) !== transport) {
        entries.push({ external_id: externalId, transport });
      }
    }
    if (entries.length === 0) {
      return;
    }
    try {
      await gladys.publishTransports(entries);
      entries.forEach((entry) => transports.set(entry.external_id, entry.transport));
    } catch (err) {
      logger.warn(`Unable to publish the transport: ${err.message}`);
    }
  }

  /**
   * @description Publish a scene event, never failing the caller.
   * @param {string} key - The trigger.
   * @param {object} data - The data.
   */
  function fire(key, data) {
    logger.info(`Scene event ${key}`);
    gladys
      .publishSceneEvent(key, data)
      .catch((err) => logger.warn(`Unable to publish the scene event ${key}: ${err.message}`));
  }

  /**
   * @description Everything after a reading or a change: devices, states,
   * transports, widgets.
   * @returns {Promise<void>}
   */
  async function publishAll() {
    await publishDiscoveredDevices().catch((err) =>
      logger.warn(`Unable to offer the watches: ${err.message}`),
    );
    await publishStates().catch((err) =>
      logger.warn(`Unable to publish the states: ${err.message}`),
    );
    await publishTransports();
    refreshWidgets();
  }

  // --- Reading ---------------------------------------------------------------------------

  /**
   * @description Log an error and show it in the connection status.
   * @param {Error} err - The error.
   * @param {string} what - What failed.
   * @returns {Promise<void>}
   */
  async function handleError(err, what) {
    lastError = { at: now(), what, message: String(err.message).slice(0, 200) };
    if (err instanceof AuthError && err.reauth) {
      await handleAuthLost(err);
      return;
    }
    logger.warn(`${what} failed: ${err.message}`);
    if (err instanceof SheetsApiError && err.apiDisabled) {
      await reportStatus(false, all('statusApiDisabled'));
    } else if (err instanceof SheetsApiError && err.rateLimited) {
      await reportStatus(true, all('statusQuota'));
    } else {
      await reportStatus(false, all('statusUnreachable'));
    }
  }

  /**
   * @description The Google access is dead (revoked, expired): stop calling
   * Google until the user connects again.
   * @param {Error} err - The error.
   * @returns {Promise<void>}
   */
  async function handleAuthLost(err) {
    logger.error(`Google access lost: ${err.message}. Click "Connect with Google" again.`);
    stopTimers();
    await reportStatus(false, all('statusReauth'));
    await publishTransports();
    refreshWidgets();
  }

  /**
   * @description The status of the connection once the watches are read.
   * @returns {object} The multi-language message.
   */
  function connectedStatus() {
    const watches = registry.list();
    const failing = watches.filter((watch) => watcher.errorOf(watch.id)).length;
    if (watches.length === 0) {
      return all('statusNoWatch');
    }
    return failing > 0
      ? all('statusWatchErrors', { count: watches.length, failing })
      : all('statusConnected', { count: watches.length });
  }

  /**
   * @description Read the watches and publish what changed.
   * @returns {Promise<boolean>} True when the reading succeeded.
   */
  function poll() {
    return exclusive(async () => {
      if (!connected()) {
        return false;
      }
      const watches = registry.list();
      let results;
      try {
        results = await watcher.read(watches);
      } catch (err) {
        await handleError(err, 'Reading Google Sheets');
        return false;
      }
      lastError = null;
      for (const result of results) {
        if (result.error) {
          logger.warn(`Watch ${result.watch.id.slice(-12)}: ${t(result.error, 'en')}`);
          continue;
        }
        titles.set(result.watch.id, {
          spreadsheet: result.spreadsheetTitle,
          sheet: result.sheetTitle,
        });
        const context = {
          device: idsOf(gladys, result.watch).device,
          watch: result.watch,
          spreadsheetTitle: result.spreadsheetTitle,
          sheetTitle: result.sheetTitle,
        };
        if (result.change) {
          fire(TRIGGERS.CELL_CHANGED, cellEventData({ ...context, change: result.change }));
        }
        result.added.forEach((row) => fire(TRIGGERS.ROW_ADDED, rowEventData({ ...context, row })));
      }
      await reportStatus(true, connectedStatus());
      await publishAll();
      return true;
    });
  }

  /** Read again a few seconds after a change made from Gladys. */
  function pollSoon() {
    clearTimeout(soonTimer);
    soonTimer = setTimeout(() => poll().catch(() => {}), SOON_MS);
    soonTimer.unref?.();
  }

  /** Stop the timers. */
  function stopTimers() {
    clearInterval(pollTimer);
    clearTimeout(soonTimer);
    clearTimeout(retryTimer);
    pollTimer = null;
  }

  /**
   * @description Check the configuration, read, then read on a timer.
   * @returns {Promise<void>}
   */
  async function start() {
    stopTimers();
    if (!config.clientId || !config.clientSecret) {
      await reportStatus(false, all('statusNoClient'));
      return;
    }
    if (!tokens.hasGrant()) {
      await reportStatus(false, all('statusNotConnected'));
      return;
    }
    if (tokens.lost) {
      await reportStatus(false, all('statusReauth'));
      return;
    }
    const ok = await poll();
    if (!ok && tokens.lost) {
      return;
    }
    if (!ok && watcher.readAt() === 0) {
      // Never read yet (Google unreachable at boot): try again soon.
      retryTimer = setTimeout(() => startIfReady().catch(() => {}), RETRY_MS);
      retryTimer.unref?.();
    }
    pollTimer = setInterval(() => poll().catch(() => {}), config.pollMinutes * MINUTE);
    pollTimer.unref?.();
  }

  /**
   * @description Start, one at a time.
   * @returns {Promise<void>}
   */
  function startIfReady() {
    starting = starting.catch(() => {}).then(start);
    return starting;
  }

  // --- OAuth2 ---------------------------------------------------------------------------

  gladys.onOAuthAuthorizeUrl(async (key, redirectUri) => {
    if (key !== ACCOUNT_FIELD) {
      throw new Error(`Unknown account field: ${key}`);
    }
    if (!config.clientId || !config.clientSecret) {
      throw new Error(t('statusNoClient', textLanguage()));
    }
    if (!redirectUri) {
      throw new Error('Gladys gave no redirect URI: update Gladys');
    }
    const { state, verifier, challenge } = createPkce();
    pendingAuth = { state, verifier };
    // Persisted: the container may restart between "Connect" and the return
    // from Google (the memory alone would then refuse a valid answer).
    await gladys.setConfig({
      [INTERNAL_KEYS.oauthState]: state,
      [INTERNAL_KEYS.oauthVerifier]: verifier,
    });
    logger.info(`Google authorization started (redirect URI ${redirectUri})`);
    return buildAuthorizeUrl({ clientId: config.clientId, redirectUri, state, challenge });
  });

  gladys.onOAuthCallback(async (key, { code, state, redirectUri }) => {
    try {
      if (key !== ACCOUNT_FIELD) {
        throw new Error(`Unknown account field: ${key}`);
      }
      let expected = pendingAuth;
      if (!expected.state) {
        expected = normalizeConfig(await gladys.getConfig()).pendingAuth;
      }
      if (!expected.state || expected.state !== state) {
        lastStatus = null;
        await reportStatus(false, all('connectState'));
        throw new Error('OAuth state mismatch');
      }
      const next = await exchangeCode({
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        code,
        verifier: expected.verifier,
        redirectUri,
        fetchImpl,
        now,
      });
      pendingAuth = { state: '', verifier: '' };
      await gladys.setConfig({ [INTERNAL_KEYS.oauthState]: '', [INTERNAL_KEYS.oauthVerifier]: '' });
      await tokens.adopt({ ...next, clientId: config.clientId });
      logger.info('Connected to Google Sheets');
      watcher.forget();
      lastStatus = null;
      await startIfReady();
    } catch (err) {
      // The SDK turns the exception into a refused connection without
      // logging it: say why here.
      logger.error(`Google connection failed: ${err.message}`);
      if (err instanceof AuthError) {
        lastStatus = null;
        await reportStatus(
          false,
          err.code === 'scope_denied'
            ? all('connectScope')
            : all('connectFailed', { reason: err.code || 'error' }),
        );
      }
      throw err;
    }
  });

  // --- Devices --------------------------------------------------------------------------

  gladys.onSetValue(async () => {
    throw new Error('The Google Sheets values are read-only: change them in the sheet');
  });

  gladys.onScanRequest(async () => {
    if (connected()) {
      await poll();
    }
    const count = await publishDiscoveredDevices(true);
    logger.info(`Scan: ${count} watch(es) offered`);
  });

  // Gladys drops the states of a feature that does not exist yet: publish
  // them all once the device is created, and refresh the widget.
  gladys.onDeviceCreated(async (device) => {
    await refreshCreatedDevices();
    const parsed = parseExternalId(device.external_id);
    if (parsed && registry.byId(parsed.watchId)) {
      await publishStates(parsed.watchId).catch((err) =>
        logger.warn(`Unable to publish the states: ${err.message}`),
      );
      transports.delete(device.external_id);
      await publishTransports();
    }
    widgetRefreshedAt.clear();
    refreshWidgets();
  });

  gladys.onDeviceDeleted(async (device) => {
    transports.delete(device.external_id);
    await refreshCreatedDevices();
  });

  // --- Targets ---------------------------------------------------------------------------

  /**
   * @description The spreadsheet and tab a form or a scene names: its own
   * spreadsheet field or the default one; the tab from the range
   * (`Log!A1`), the sheet field, the `gid` of a pasted URL, or the first tab.
   * @param {object} fields - `{ spreadsheet, sheet }`.
   * @param {string|null} [rangeSheet] - A tab name typed in the range.
   * @returns {Promise<{ spreadsheetId: string, meta: object, sheet: object }>} The target.
   */
  async function target(fields, rangeSheet = null) {
    const ref = parseSpreadsheetRef(fields.spreadsheet) ?? parseSpreadsheetRef(config.spreadsheet);
    if (!ref) {
      throw new RefError('errorNoSpreadsheet');
    }
    const meta = await watcher.metadata(ref.spreadsheetId);
    const name = rangeSheet || String(fields.sheet ?? '').trim() || null;
    let sheet;
    try {
      sheet = resolveSheet(meta, { name, sheetId: name ? null : ref.sheetId });
    } catch {
      // Maybe a tab added or renamed since the cached titles.
      const fresh = await watcher.metadata(ref.spreadsheetId, { fresh: true });
      sheet = resolveSheet(fresh, { name, sheetId: name ? null : ref.sheetId });
      return { spreadsheetId: ref.spreadsheetId, meta: fresh, sheet };
    }
    return { spreadsheetId: ref.spreadsheetId, meta, sheet };
  }

  /**
   * @description The values typed in a scene: `|` between the columns.
   * @param {unknown} raw - The text.
   * @returns {string[]} The values.
   */
  function sceneValues(raw) {
    const values = splitValues(raw).map((value) => value.slice(0, MAX_CELL));
    if (values.length > MAX_VALUES) {
      throw new RefError('errorTooManyValues', { max: MAX_VALUES });
    }
    return values;
  }

  const inputOf = (fields) => (fields.input === INPUT_OPTIONS.RAW ? INPUT.RAW : INPUT.USER_ENTERED);

  /**
   * @description Append a row (scene action or widget form), quietly: the
   * row it adds raises no "row added" event.
   * @param {string} spreadsheetId - The spreadsheet id.
   * @param {string} range - The range searched for the table.
   * @param {string[]} values - The row.
   * @param {string} input - INPUT.USER_ENTERED or INPUT.RAW.
   * @returns {Promise<{ updatedRange: string, row: number }>} Where it went.
   */
  function appendRow(spreadsheetId, range, values, input) {
    return exclusive(async () => {
      const answer = await api.append(spreadsheetId, range, [values], input);
      const rows = rowsOfRange(answer.updatedRange);
      watcher.touch(spreadsheetId, rows);
      pollSoon();
      return { updatedRange: answer.updatedRange, row: rows?.firstRow ?? 0 };
    });
  }

  // --- Configuration screen actions -------------------------------------------------------

  /**
   * @description After a watch was added or removed: read, offer, say it.
   * @returns {Promise<void>}
   */
  async function watchesChanged() {
    await poll().catch(() => {});
    await publishDiscoveredDevices(true).catch((err) =>
      logger.warn(`Unable to offer the watches: ${err.message}`),
    );
  }

  /**
   * @description One line describing a watch.
   * @param {object} watch - The watch.
   * @param {number} index - Its position.
   * @param {string} language - The language.
   * @returns {string} The line.
   */
  function describe(watch, index, language) {
    const title = titles.get(watch.id);
    const where = `${title?.sheet ?? watch.sheetTitle}!${watch.range}`;
    const state = watcher.stateOf(watch.id);
    const error = watcher.errorOf(watch.id);
    let status;
    if (error) {
      status = t(error.key, language);
    } else if (!state) {
      status = t('notReadYet', language);
    } else if (watch.kind === KINDS.CELL) {
      status = t('describeValue', language, { value: state.value || '∅' });
    } else {
      status = t('rowCount', language, { count: state.count });
    }
    return `#${index + 1} ${watch.name} (${t(watch.kind === KINDS.CELL ? 'kindCell' : 'kindRows', language)}, ${where}) — ${status}`;
  }

  gladys.onAction(ACTIONS.ADD_CELL, async (fields = {}) => {
    const watch = await guarded(async () => {
      requireConnection();
      const typed = splitRange(fields.cell);
      const { a1 } = parseCell(typed.cells);
      const { spreadsheetId, meta, sheet } = await target(fields, typed.sheet);
      const valueKind = VALUE_KINDS.includes(fields.kind) ? fields.kind : 'number';
      return registry.add({
        kind: KINDS.CELL,
        spreadsheetId,
        sheetId: sheet.sheetId,
        range: a1,
        valueKind,
        name: String(fields.name ?? '').trim() || `${sheet.title}!${a1} (${meta.title})`,
        spreadsheetTitle: meta.title,
        sheetTitle: sheet.title,
      });
    });
    logger.info(`Cell watch …${watch.id.slice(-12)} added`);
    await watchesChanged();
    const index = registry.list().findIndex((other) => other.id === watch.id);
    return each((lang) => `${t('watchAdded', lang)} ${describe(watch, index, lang)}`);
  });

  gladys.onAction(ACTIONS.ADD_ROWS, async (fields = {}) => {
    const watch = await guarded(async () => {
      requireConnection();
      const typed = splitRange(fields.columns);
      const columns = parseColumns(typed.cells);
      const { spreadsheetId, meta, sheet } = await target(fields, typed.sheet);
      return registry.add({
        kind: KINDS.ROWS,
        spreadsheetId,
        sheetId: sheet.sheetId,
        range: columns.a1,
        header: readFlag(fields.header, true),
        name: String(fields.name ?? '').trim() || `${sheet.title} (${meta.title})`,
        spreadsheetTitle: meta.title,
        sheetTitle: sheet.title,
      });
    });
    logger.info(`Rows watch …${watch.id.slice(-12)} added`);
    await watchesChanged();
    const index = registry.list().findIndex((other) => other.id === watch.id);
    return each((lang) => `${t('watchAdded', lang)} ${describe(watch, index, lang)}`);
  });

  gladys.onAction(ACTIONS.REMOVE_WATCH, async (fields = {}) => {
    const watch = await guarded(() => registry.remove(fields.watch));
    watcher.forget(watch.id);
    titles.delete(watch.id);
    logger.info(`Watch …${watch.id.slice(-12)} removed`);
    await publishDiscoveredDevices(true).catch(() => {});
    return all('watchRemoved', { name: watch.name });
  });

  gladys.onAction(ACTIONS.LIST_WATCHES, async () => {
    const watches = registry.list();
    if (watches.length === 0) {
      return all('listEmpty');
    }
    // The result is shown in full (several lines): no 200-character cut.
    return Object.fromEntries(
      ['en', 'fr', 'de', 'es'].map((lang) => [
        lang,
        [
          t('listHeader', lang, { count: watches.length }),
          ...watches.map((watch, index) => describe(watch, index, lang)),
        ].join('\n'),
      ]),
    );
  });

  gladys.onAction(ACTIONS.TEST_CONNECTION, async () => {
    if (!config.clientId || !config.clientSecret) {
      return all('statusNoClient');
    }
    if (!tokens.hasGrant()) {
      return all('statusNotConnected');
    }
    if (tokens.lost) {
      return all('statusReauth');
    }
    let spreadsheet = '';
    if (config.spreadsheet) {
      const meta = await guarded(async () => {
        const ref = parseSpreadsheetRef(config.spreadsheet);
        return watcher.metadata(ref.spreadsheetId, { fresh: true });
      });
      spreadsheet = meta.title;
    }
    const ok = await poll();
    if (!ok) {
      if (tokens.lost) {
        return all('statusReauth');
      }
      return each((lang) => `${t('readFailed', lang)} ${lastError?.message ?? ''}`.trim());
    }
    const watches = registry.list();
    return each((lang) =>
      [
        spreadsheet ? t('testSpreadsheet', lang, { title: spreadsheet }) : t('testNoDefault', lang),
        t('testResult', lang, {
          count: watches.length,
          failing: watches.filter((watch) => watcher.errorOf(watch.id)).length,
          calls: api.calls().count,
        }),
      ].join(' '),
    );
  });

  gladys.onAction(ACTIONS.DIAGNOSTIC, async () => {
    // Gladys passes no DEBUG variable to the container: this writes an
    // anonymized summary in the logs (Settings -> Supervision) instead. No
    // token, no cell value, no spreadsheet or tab name.
    const token = tokens.tokens;
    const iso = (instant) => (instant ? new Date(instant).toISOString() : 'never');
    const calls = api.calls();
    logger.info(`[diagnostic] gladys-google-sheets ${version}, Node ${process.version}`);
    logger.info(
      `[diagnostic] client ID ${config.clientId ? `set (${config.clientId.endsWith('.apps.googleusercontent.com') ? 'Google format' : 'UNEXPECTED format'})` : 'missing'}, secret ${config.clientSecret ? 'set' : 'missing'}; connected ${connected()}, access lost ${tokens.lost}, tokens of the same client ${!token.clientId || token.clientId === config.clientId}`,
    );
    logger.info(
      `[diagnostic] access token until ${iso(token.expiresAt)}, refresh token ${token.refreshToken ? 'present' : 'absent'}, pending authorization ${Boolean(pendingAuth.state)}, default spreadsheet ${config.spreadsheet ? 'set' : 'none'}`,
    );
    logger.info(
      `[diagnostic] time zone ${zone ?? 'system'} (TZ=${process.env.TZ ?? 'unset'}), every ${config.pollMinutes} min, last reading ${iso(watcher.readAt())}, ${calls.count} API call(s) on ${calls.day || '-'} (UTC), ${calls.throttled} wait(s) for the quota; last error ${lastError ? `${lastError.what} at ${iso(lastError.at)}: ${lastError.message}` : 'none'}`,
    );
    registry.list().forEach((watch, index) => {
      const state = watcher.stateOf(watch.id);
      const error = watcher.errorOf(watch.id);
      const created = createdDevices.has(idsOf(gladys, watch).device);
      logger.info(
        `[diagnostic] watch #${index + 1} ${watch.kind} …${watch.id.slice(-10)}${watch.kind === KINDS.CELL ? ` ${watch.valueKind}, number ${state ? state.number !== null : '-'}` : `, header ${watch.header}, ${state ? `${state.count} row(s), last row ${state.lastRow}` : 'not read'}`}, created in Gladys ${created}, read ${iso(state?.readAt)}, error ${error ? error.key : 'none'}`,
      );
    });
    return all('diagnosticDone');
  });

  gladys.onAction(ACTIONS.DISCONNECT, async () => {
    stopTimers();
    const { refreshToken } = tokens.tokens;
    const revoked = await revokeToken(refreshToken, fetchImpl);
    logger.info(`Disconnected from Google (revocation ${revoked ? 'confirmed' : 'not confirmed'})`);
    await tokens.clear();
    watcher.forget();
    lastStatus = null;
    await reportStatus(false, all('statusNotConnected'));
    await publishTransports();
    refreshWidgets();
    return all('disconnected');
  });

  // --- Dashboard widget ----------------------------------------------------------------

  /**
   * @description The rows watch a widget shows: its setting, or the first one.
   * @param {unknown} deviceExternalId - The `watch` setting.
   * @returns {object|null} The watch.
   */
  function widgetWatch(deviceExternalId) {
    const parsed = parseExternalId(deviceExternalId);
    if (parsed) {
      const watch = registry.byId(parsed.watchId);
      return watch?.kind === KINDS.ROWS ? watch : null;
    }
    return registry.list().find((watch) => watch.kind === KINDS.ROWS) ?? null;
  }

  const readCount = (raw) => {
    const value = Number(raw ?? COUNT.default);
    return Number.isFinite(value) && raw !== ''
      ? Math.min(COUNT.max, Math.max(COUNT.min, Math.round(value)))
      : COUNT.default;
  };
  const readForm = (raw) => (Object.values(FORMS).includes(raw) ? raw : FORMS.ADD);

  gladys.onWidgetGet(WIDGETS.ROWS, async ({ settings = {}, language }) => {
    rememberLanguage(language);
    if (!connected()) {
      return messageContent(t('notConnected', language));
    }
    const watch = widgetWatch(settings.watch);
    if (!watch) {
      return messageContent(t('noRowsWatch', language));
    }
    const error = watcher.errorOf(watch.id);
    if (error) {
      return messageContent(t(error.key, language));
    }
    const state = watcher.stateOf(watch.id);
    if (!state) {
      return messageContent(t('notReadYet', language));
    }
    return buildRowsWidget({
      watch,
      state,
      sheetTitle: titles.get(watch.id)?.sheet ?? watch.sheetTitle,
      count: readCount(settings.count),
      form: readForm(settings.form),
      language,
      now: now(),
    });
  });

  gladys.onWidgetAction(
    WIDGETS.ROWS,
    async (actionKey, _params, { settings = {}, values } = {}) => {
      if (actionKey === WIDGET_ACTIONS.REFRESH) {
        const ok = await poll();
        return ok ? connectedStatus() : all('readFailed');
      }
      if (actionKey !== WIDGET_ACTIONS.ADD_ROW) {
        throw new Error(`Unknown action ${actionKey}`);
      }
      if (!connected()) {
        return all('notConnected');
      }
      const watch = widgetWatch(settings.watch);
      if (!watch) {
        return all('noRowsWatch');
      }
      const form = readForm(settings.form);
      const typed = Array.from({ length: FORM_FIELDS }, (_, index) =>
        String(values?.[`column_${index + 1}`] ?? '')
          .trim()
          .slice(0, MAX_CELL),
      );
      while (typed.length > 0 && typed[typed.length - 1] === '') {
        typed.pop();
      }
      if (typed.length === 0) {
        return all('valuesRequired');
      }
      const row = form === FORMS.ADD_TIMESTAMP ? [localTimestamp(now(), zone), ...typed] : typed;
      try {
        const meta = await watcher.metadata(watch.spreadsheetId);
        const sheet = resolveSheet(meta, { sheetId: watch.sheetId });
        const columns = parseColumns(watch.range);
        const range = `${quoteSheet(sheet.title)}!${columnLetters(columns.start)}:${columnLetters(columns.end)}`;
        const { row: number } = await appendRow(
          watch.spreadsheetId,
          range,
          row,
          INPUT.USER_ENTERED,
        );
        return all('rowAdded', { row: number || '?' });
      } catch (err) {
        if (err instanceof AuthError && err.reauth) {
          await handleAuthLost(err);
        }
        lastError = { at: now(), what: 'Adding a row', message: String(err.message).slice(0, 200) };
        logger.warn(`Adding a row failed: ${err.message}`);
        return each((lang) => explain(err, lang));
      }
    },
  );

  // --- Scene actions -----------------------------------------------------------------------
  // They never fire a scene event: what they write is marked quiet (watcher.js).

  gladys.onSceneAction(SCENE_ACTIONS.APPEND_ROW, async (fields = {}) =>
    guarded(async () => {
      requireConnection();
      const { spreadsheetId, sheet } = await target(fields);
      const values = sceneValues(fields.values);
      if (values.every((value) => value === '')) {
        throw new RegistryError('valuesRequired');
      }
      if (fields.timestamp === TIMESTAMP.FIRST) {
        values.unshift(localTimestamp(now(), zone));
      }
      const answer = await appendRow(
        spreadsheetId,
        quoteSheet(sheet.title),
        values,
        inputOf(fields),
      );
      return { row: answer.row, updated_range: answer.updatedRange };
    }),
  );

  gladys.onSceneAction(SCENE_ACTIONS.WRITE_CELLS, async (fields = {}) =>
    guarded(async () => {
      requireConnection();
      const range = parseRange(fields.range);
      const { spreadsheetId, sheet } = await target(fields, range.sheet);
      const values = sceneValues(fields.values);
      return exclusive(async () => {
        const answer = await api.update(
          spreadsheetId,
          `${quoteSheet(sheet.title)}!${range.cells}`,
          [values],
          inputOf(fields),
        );
        watcher.touch(spreadsheetId, rowsOfRange(answer.updatedRange));
        pollSoon();
        return { updated_range: answer.updatedRange, updated_cells: answer.updatedCells };
      });
    }),
  );

  gladys.onSceneAction(SCENE_ACTIONS.READ_CELLS, async (fields = {}) =>
    guarded(async () => {
      requireConnection();
      const range = parseRange(fields.range);
      const { spreadsheetId, sheet } = await target(fields, range.sheet);
      const a1 = `${quoteSheet(sheet.title)}!${range.cells}`;
      const formatted = await api.getValues(spreadsheetId, a1, RENDER.FORMATTED);
      const raw = await api.getValues(spreadsheetId, a1, RENDER.UNFORMATTED);
      const rows = formatted.values.map(cleanRow);
      const number = numberOf(raw.values[0]?.[0]);
      return {
        value: String(rows[0]?.[0] ?? '').slice(0, MAX_OUTPUT),
        number: number ?? 0,
        is_number: number !== null,
        values: rows
          .map((row) => row.join(' | '))
          .join('\n')
          .slice(0, MAX_OUTPUT),
        cell_count: rows.reduce((sum, row) => sum + row.filter((value) => value !== '').length, 0),
        row_count: rows.filter((row) => row.length > 0).length,
      };
    }),
  );

  gladys.onSceneAction(SCENE_ACTIONS.CLEAR_RANGE, async (fields = {}) =>
    guarded(async () => {
      requireConnection();
      const range = parseRange(fields.range);
      const { spreadsheetId, sheet } = await target(fields, range.sheet);
      return exclusive(async () => {
        const answer = await api.clear(spreadsheetId, `${quoteSheet(sheet.title)}!${range.cells}`);
        watcher.touch(spreadsheetId);
        pollSoon();
        return { cleared_range: answer.clearedRange };
      });
    }),
  );

  // --- Configuration ------------------------------------------------------------------------

  /**
   * @description Reload the whole config (internal keys included).
   * @param {object} [fallback] - Raw values to use when the read fails.
   * @returns {Promise<void>}
   */
  async function loadConfig(fallback) {
    try {
      const raw = await gladys.getConfig();
      config = normalizeConfig(raw);
      lastLanguage = readLanguage(raw, lastLanguage);
      registry.load(raw);
    } catch (err) {
      if (fallback) {
        config = { ...normalizeConfig(fallback), tokens: config.tokens };
      }
      logger.error('Unable to read the configuration', err);
    }
    tokens.setTokens(config.tokens);
    if (config.pendingAuth.state && !pendingAuth.state) {
      pendingAuth = config.pendingAuth;
    }
  }

  gladys.onConfigUpdated(async (rawConfig) => {
    const signature = () =>
      JSON.stringify([config.clientId, config.clientSecret, config.pollMinutes]);
    const before = signature();
    const clientBefore = config.clientId;
    await loadConfig(rawConfig);
    if (clientBefore && clientBefore !== config.clientId && tokens.hasGrant()) {
      // The tokens belong to the previous OAuth client.
      logger.info('Client ID changed: connect again');
      await tokens.clear();
      watcher.forget();
    }
    if (before !== signature()) {
      lastStatus = null;
      await startIfReady();
    }
  });

  // --- Connection lifecycle -----------------------------------------------------------------

  gladys.on('connected', async () => {
    await loadConfig();
    const { clientId } = tokens.tokens;
    if (clientId && config.clientId && clientId !== config.clientId) {
      logger.info('The stored tokens belong to another Client ID: connect again');
      await tokens.clear();
    }
    await refreshCreatedDevices();
    lastStatus = null;
    await startIfReady();
  });

  gladys.handleShutdown((signal) => {
    logger.info(`Received ${signal} -> graceful shutdown`);
    stopTimers();
  });

  return {
    registry,
    watcher,
    tokens,
    api,
    poll,
    stop: stopTimers,
    idle: () => queue,
  };
}

export { ACTIONS, SCENE_ACTIONS, TIMESTAMP, INPUT_OPTIONS, localTimestamp };
