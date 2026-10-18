// -----------------------------------------------------------------------------
// Google Sheets API v4 client
// (https://developers.google.com/workspace/sheets/api/reference/rest).
//
// Only the documented methods and fields are used:
//   - spreadsheets.get           GET  /v4/spreadsheets/{id}?fields=…  (titles of
//                                the spreadsheet and of its tabs, by sheetId)
//   - spreadsheets.values.batchGet GET /v4/spreadsheets/{id}/values:batchGet
//                                (ranges[], valueRenderOption, dateTimeRenderOption)
//   - spreadsheets.values.get    GET  /v4/spreadsheets/{id}/values/{range}
//   - spreadsheets.values.append POST /v4/spreadsheets/{id}/values/{range}:append
//   - spreadsheets.values.update PUT  /v4/spreadsheets/{id}/values/{range}
//   - spreadsheets.values.clear  POST /v4/spreadsheets/{id}/values/{range}:clear
//
// Facts the code depends on:
//   - values are read FORMATTED_VALUE by default (what the user sees, in the
//     locale of the spreadsheet); UNFORMATTED_VALUE gives the real number
//     (0.5 for "50 %"), with dateTimeRenderOption FORMATTED_STRING so that a
//     date stays a text instead of a serial number;
//   - empty trailing rows and columns are left out of `values`;
//   - USER_ENTERED parses what is written as if typed in the sheet (numbers,
//     dates, formulas), RAW stores the text as is;
//   - quotas: 60 read and 60 write requests per minute per user (300 per
//     project), no daily limit; a 429 asks for a truncated exponential backoff
//     (2^n s + up to 1 s of jitter).
//
// So every call goes through a local limiter (50 per minute and per kind, a
// margin for the user's other tools on the same client), retries a 429 / 5xx
// with backoff, and retries once with a fresh token after a 401.
// -----------------------------------------------------------------------------

const API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const REQUEST_TIMEOUT_MS = 20000;
const RENDER = {
  FORMATTED: 'FORMATTED_VALUE',
  UNFORMATTED: 'UNFORMATTED_VALUE',
};
const INPUT = { USER_ENTERED: 'USER_ENTERED', RAW: 'RAW' };
// Local limiter: below the 60 per minute per user of Google.
const LIMIT_PER_MINUTE = 50;
const WINDOW_MS = 60 * 1000;
// Wait for a free slot at most this long, then give up (a scene action has a timeout).
const MAX_LIMITER_WAIT_MS = 20000;
// Backoff on 429 / 500 / 503: at most 3 new tries, 16 s at most each.
const MAX_RETRIES = 3;
const MAX_BACKOFF_MS = 16000;
const METADATA_FIELDS =
  'spreadsheetId,properties(title,locale,timeZone),sheets.properties(sheetId,title,index)';

/** An error of the Sheets API. */
class SheetsApiError extends Error {
  /**
   * @param {string} message - The message (never a token).
   * @param {object} [options] - `{ status, reason, local }`.
   */
  constructor(message, { status = 0, reason = '', local = false } = {}) {
    super(message);
    this.name = 'SheetsApiError';
    this.status = status;
    this.reason = reason;
    this.local = local;
  }

  /** @returns {boolean} The per-minute quota is used up (Google's or ours). */
  get rateLimited() {
    return this.status === 429 || /RESOURCE_EXHAUSTED|rateLimit/i.test(this.reason);
  }

  /** @returns {boolean} The Sheets API is not enabled in the Cloud project. */
  get apiDisabled() {
    return this.status === 403 && /accessNotConfigured|SERVICE_DISABLED/i.test(this.reason);
  }

  /** @returns {boolean} No such spreadsheet, or the account cannot open it. */
  get noAccess() {
    return this.status === 404 || (this.status === 403 && !this.apiDisabled);
  }

  /** @returns {boolean} The range does not exist (a renamed or deleted tab). */
  get badRange() {
    return this.status === 400 && /parse range|Unable to parse/i.test(this.message);
  }
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @description The Sheets API client.
 * @param {object} options - `{ tokens, fetchImpl, now, sleep, random }`.
 * @returns {object} The client.
 */
function createSheetsClient({
  tokens,
  fetchImpl,
  now = Date.now,
  sleep = defaultSleep,
  random = Math.random,
}) {
  let calls = { day: '', count: 0, last: 0, throttled: 0 };
  const recent = { read: [], write: [] };

  /** Count a call, per UTC day. */
  function count() {
    const day = new Date(now()).toISOString().slice(0, 10);
    calls = {
      ...calls,
      day,
      count: calls.day === day ? calls.count + 1 : 1,
      last: now(),
    };
  }

  /**
   * @description Take a slot of the local limiter, waiting a little if needed.
   * @param {'read'|'write'} kind - The quota.
   * @returns {Promise<void>}
   */
  async function acquire(kind) {
    for (;;) {
      const list = recent[kind].filter((at) => now() - at < WINDOW_MS);
      recent[kind] = list;
      if (list.length < LIMIT_PER_MINUTE) {
        list.push(now());
        return;
      }
      const wait = list[0] + WINDOW_MS - now() + 50;
      if (wait > MAX_LIMITER_WAIT_MS) {
        calls.throttled += 1;
        throw new SheetsApiError(`Google Sheets: more than ${LIMIT_PER_MINUTE} ${kind}s a minute`, {
          status: 429,
          reason: 'localRateLimit',
          local: true,
        });
      }
      calls.throttled += 1;
      await sleep(wait);
    }
  }

  /**
   * @description The delay before a new try.
   * @param {number} attempt - 0 for the first retry.
   * @param {Response} response - The refused answer.
   * @returns {number} Milliseconds.
   */
  function backoff(attempt, response) {
    const retryAfter = Number(response.headers?.get?.('retry-after'));
    if (Number.isFinite(retryAfter) && retryAfter > 0) {
      return Math.min(retryAfter * 1000, MAX_BACKOFF_MS);
    }
    return Math.min(2 ** attempt * 1000 + Math.floor(random() * 1000), MAX_BACKOFF_MS);
  }

  /**
   * @description One authorized request.
   * @param {string} method - The HTTP method.
   * @param {string} path - The path after /v4/spreadsheets.
   * @param {object} [options] - `{ query, body, kind }`; a query value may be
   *   an array (repeated parameter).
   * @returns {Promise<object>} The JSON answer ({} when empty).
   */
  async function request(method, path, { query, body, kind = 'read' } = {}) {
    const url = new URL(`${API_BASE}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      for (const item of Array.isArray(value) ? value : [value]) {
        if (item !== undefined && item !== null && item !== '') {
          url.searchParams.append(key, String(item));
        }
      }
    }
    let refreshed = false;
    for (let attempt = 0; ; attempt += 1) {
      await acquire(kind);
      const accessToken = await tokens.getAccessToken();
      count();
      let response;
      try {
        response = await fetchImpl(url.toString(), {
          method,
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
            ...(body ? { 'Content-Type': 'application/json' } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (err) {
        throw new SheetsApiError(`Google Sheets unreachable: ${err.message}`);
      }
      if (response.status === 401 && !refreshed) {
        refreshed = true;
        await tokens.getAccessToken(true);
        continue;
      }
      if ([429, 500, 503].includes(response.status) && attempt < MAX_RETRIES) {
        await sleep(backoff(attempt, response));
        continue;
      }
      const text = await response.text().catch(() => '');
      let json;
      try {
        json = text ? JSON.parse(text) : {};
      } catch {
        json = {};
      }
      if (response.ok) {
        return json ?? {};
      }
      const error = json?.error ?? {};
      const reason = [
        error.status,
        ...(Array.isArray(error.errors) ? error.errors.map((e) => e?.reason) : []),
        ...(Array.isArray(error.details) ? error.details.map((d) => d?.reason) : []),
      ]
        .filter(Boolean)
        .join(',');
      // The spreadsheet id is not secret, but the range carries tab names: keep it out.
      throw new SheetsApiError(
        `Google Sheets ${method} ${path.split('/')[2] ?? ''}: HTTP ${response.status}${
          error.message ? ` (${String(error.message).slice(0, 160)})` : ''
        }`,
        { status: response.status, reason },
      );
    }
  }

  const valuesPath = (spreadsheetId, range, suffix = '') =>
    `/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}${suffix}`;

  const renderQuery = (render) => ({
    valueRenderOption: render,
    ...(render === RENDER.UNFORMATTED ? { dateTimeRenderOption: 'FORMATTED_STRING' } : {}),
  });

  return {
    /** @returns {{ day: string, count: number, last: number, throttled: number }} The calls. */
    calls: () => ({ ...calls }),

    /**
     * @description The titles of a spreadsheet and of its tabs.
     * @param {string} spreadsheetId - The spreadsheet id.
     * @returns {Promise<{ id: string, title: string, timeZone: string,
     *   sheets: Array<{ sheetId: number, title: string, index: number }> }>} The metadata.
     */
    async getMetadata(spreadsheetId) {
      const answer = await request('GET', `/${encodeURIComponent(spreadsheetId)}`, {
        query: { fields: METADATA_FIELDS },
      });
      const sheets = (Array.isArray(answer.sheets) ? answer.sheets : [])
        .map((sheet) => sheet?.properties ?? {})
        .filter((p) => Number.isInteger(p.sheetId) && typeof p.title === 'string')
        .map((p) => ({ sheetId: p.sheetId, title: p.title, index: Number(p.index ?? 0) }))
        .sort((a, b) => a.index - b.index);
      return {
        id: String(answer.spreadsheetId ?? spreadsheetId),
        title: String(answer.properties?.title ?? ''),
        timeZone: String(answer.properties?.timeZone ?? ''),
        sheets,
      };
    },

    /**
     * @description Read several ranges at once (one request).
     * @param {string} spreadsheetId - The spreadsheet id.
     * @param {string[]} ranges - A1 ranges, sheet names quoted.
     * @param {string} [render] - RENDER.FORMATTED or RENDER.UNFORMATTED.
     * @returns {Promise<Array<Array<Array<unknown>>>>} The values of each range,
     *   in the order asked (rows of cells, trailing empties left out).
     */
    async batchGet(spreadsheetId, ranges, render = RENDER.FORMATTED) {
      if (ranges.length === 0) {
        return [];
      }
      const answer = await request('GET', `/${encodeURIComponent(spreadsheetId)}/values:batchGet`, {
        query: { ranges, majorDimension: 'ROWS', ...renderQuery(render) },
      });
      const valueRanges = Array.isArray(answer.valueRanges) ? answer.valueRanges : [];
      return ranges.map((_, index) =>
        Array.isArray(valueRanges[index]?.values) ? valueRanges[index].values : [],
      );
    },

    /**
     * @description Read one range.
     * @param {string} spreadsheetId - The spreadsheet id.
     * @param {string} range - A1 range.
     * @param {string} [render] - RENDER.FORMATTED or RENDER.UNFORMATTED.
     * @returns {Promise<{ range: string, values: Array<Array<unknown>> }>} The values.
     */
    async getValues(spreadsheetId, range, render = RENDER.FORMATTED) {
      const answer = await request('GET', valuesPath(spreadsheetId, range), {
        query: { majorDimension: 'ROWS', ...renderQuery(render) },
      });
      return {
        range: String(answer.range ?? range),
        values: Array.isArray(answer.values) ? answer.values : [],
      };
    },

    /**
     * @description Add rows after the table found in the range.
     * @param {string} spreadsheetId - The spreadsheet id.
     * @param {string} range - The range searched for the table (a quoted tab name).
     * @param {Array<Array<string|number|boolean>>} values - The rows.
     * @param {string} [input] - INPUT.USER_ENTERED or INPUT.RAW.
     * @returns {Promise<{ updatedRange: string, updatedCells: number }>} What changed.
     */
    async append(spreadsheetId, range, values, input = INPUT.USER_ENTERED) {
      const answer = await request('POST', valuesPath(spreadsheetId, range, ':append'), {
        kind: 'write',
        query: { valueInputOption: input, insertDataOption: 'OVERWRITE' },
        body: { majorDimension: 'ROWS', values },
      });
      return {
        updatedRange: String(answer.updates?.updatedRange ?? ''),
        updatedCells: Number(answer.updates?.updatedCells ?? 0),
      };
    },

    /**
     * @description Write cells.
     * @param {string} spreadsheetId - The spreadsheet id.
     * @param {string} range - The A1 range (its top-left cell is enough).
     * @param {Array<Array<string|number|boolean>>} values - The rows.
     * @param {string} [input] - INPUT.USER_ENTERED or INPUT.RAW.
     * @returns {Promise<{ updatedRange: string, updatedCells: number }>} What changed.
     */
    async update(spreadsheetId, range, values, input = INPUT.USER_ENTERED) {
      const answer = await request('PUT', valuesPath(spreadsheetId, range), {
        kind: 'write',
        query: { valueInputOption: input },
        body: { range, majorDimension: 'ROWS', values },
      });
      return {
        updatedRange: String(answer.updatedRange ?? ''),
        updatedCells: Number(answer.updatedCells ?? 0),
      };
    },

    /**
     * @description Empty the values of a range (formats are kept).
     * @param {string} spreadsheetId - The spreadsheet id.
     * @param {string} range - The A1 range.
     * @returns {Promise<{ clearedRange: string }>} The range emptied.
     */
    async clear(spreadsheetId, range) {
      const answer = await request('POST', valuesPath(spreadsheetId, range, ':clear'), {
        kind: 'write',
        body: {},
      });
      return { clearedRange: String(answer.clearedRange ?? '') };
    },
  };
}

export { API_BASE, RENDER, INPUT, LIMIT_PER_MINUTE, SheetsApiError, createSheetsClient };
