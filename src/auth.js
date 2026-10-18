// -----------------------------------------------------------------------------
// Google OAuth 2.0 for a web server application, with the user's own client.
//
// https://developers.google.com/identity/protocols/oauth2/web-server
//   - authorization: https://accounts.google.com/o/oauth2/v2/auth with
//     `access_type=offline` (a refresh token) and `prompt=consent` (Google
//     only returns a refresh token on a consent screen), the minimal scope
//     `https://www.googleapis.com/auth/spreadsheets`, a random `state` and PKCE S256;
//   - token: POST https://oauth2.googleapis.com/token, `authorization_code`
//     then `refresh_token` grants. The refresh answer carries no new refresh
//     token: the first one is kept;
//   - revoke: POST https://oauth2.googleapis.com/revoke (on "Disconnect").
//
// The redirect URI is the one Gladys hands over (its HTTPS redirect page
// https://my.gladysassistant.com/redirect/oauth, or the instance itself when
// reached over HTTPS): it must be sent unchanged with the code exchange.
//
// `invalid_grant` on a refresh (revoked access, 7-day expiry of an app left
// in "Testing", 6 months unused, password change…) is final: the manager
// stops there (AuthError with `reauth`) instead of hammering the endpoint.
// -----------------------------------------------------------------------------

import { createHash, randomBytes } from 'node:crypto';

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const REQUEST_TIMEOUT_MS = 15000;
// Refresh the access token (1 h) this long before it expires.
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

/** An authorization error; `reauth` = the user must click Connect again. */
class AuthError extends Error {
  /**
   * @param {string} message - The message (never a token).
   * @param {object} [options] - `{ code, reauth, status }`.
   */
  constructor(message, { code = '', reauth = false, status = 0 } = {}) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
    this.reauth = reauth;
    this.status = status;
  }
}

const base64url = (buffer) =>
  buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/**
 * @description A new anti-CSRF state and PKCE pair.
 * @returns {{ state: string, verifier: string, challenge: string }} The values.
 * @example
 * const { state, verifier, challenge } = createPkce();
 */
function createPkce() {
  const verifier = base64url(randomBytes(48));
  return {
    state: base64url(randomBytes(24)),
    verifier,
    challenge: base64url(createHash('sha256').update(verifier).digest()),
  };
}

/**
 * @description The Google authorization URL.
 * @param {object} params - `{ clientId, redirectUri, state, challenge }`.
 * @returns {string} The URL to open.
 * @example
 * buildAuthorizeUrl({ clientId: 'x.apps.googleusercontent.com', redirectUri, state, challenge });
 */
function buildAuthorizeUrl({ clientId, redirectUri, state, challenge }) {
  const url = new URL(AUTHORIZE_URL);
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  }).toString();
  return url.toString();
}

/**
 * @description POST a form with a timeout, parse the JSON answer.
 * @param {Function} fetchImpl - fetch.
 * @param {string} url - The URL.
 * @param {object} form - The form fields.
 * @returns {Promise<{ status: number, body: object }>} The answer.
 */
async function postForm(fetchImpl, url, form) {
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw new AuthError(`Google unreachable: ${err.message}`, { code: 'network' });
  }
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body: body ?? {} };
}

/**
 * @description Turn an error answer of the token endpoint into an AuthError.
 * @param {number} status - The HTTP status.
 * @param {object} body - The JSON body.
 * @param {boolean} refreshing - A refresh grant (invalid_grant is final).
 * @returns {AuthError} The error.
 */
function tokenError(status, body, refreshing) {
  const code = String(body.error ?? `http_${status}`);
  const detail = body.error_description ? ` (${String(body.error_description).slice(0, 120)})` : '';
  // invalid_client / unauthorized_client: wrong or deleted client, or a
  // secret regenerated in the console. Final too: nothing works until the
  // user fixes the configuration.
  const reauth =
    refreshing && ['invalid_grant', 'invalid_client', 'unauthorized_client'].includes(code);
  return new AuthError(`Google token endpoint refused: ${code}${detail}`, {
    code,
    reauth,
    status,
  });
}

/**
 * @description Read the tokens of a successful answer.
 * @param {object} body - The JSON body.
 * @param {number} now - Now, in ms.
 * @param {string} [previousRefreshToken] - Kept when the answer has none.
 * @returns {{ accessToken: string, refreshToken: string, expiresAt: number, scope: string }} The tokens.
 */
function readTokens(body, now, previousRefreshToken = '') {
  const expiresIn = Number(body.expires_in);
  return {
    accessToken: String(body.access_token ?? ''),
    refreshToken: String(body.refresh_token || previousRefreshToken || ''),
    expiresAt: now + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600) * 1000,
    scope: String(body.scope ?? ''),
  };
}

/**
 * @description Exchange the authorization code for the tokens.
 * @param {object} params - `{ clientId, clientSecret, code, verifier, redirectUri, fetchImpl, now }`.
 * @returns {Promise<object>} The tokens (readTokens).
 */
async function exchangeCode({
  clientId,
  clientSecret,
  code,
  verifier,
  redirectUri,
  fetchImpl,
  now,
}) {
  const { status, body } = await postForm(fetchImpl, TOKEN_URL, {
    client_id: clientId,
    client_secret: clientSecret,
    code,
    code_verifier: verifier,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
  });
  if (status !== 200 || !body.access_token) {
    throw tokenError(status, body, false);
  }
  const tokens = readTokens(body, now());
  if (!tokens.refreshToken) {
    throw new AuthError('Google returned no refresh token', { code: 'no_refresh_token' });
  }
  // Granular consent: the user may untick the Sheets permission.
  if (tokens.scope && !tokens.scope.split(' ').includes(SCOPE)) {
    throw new AuthError('The Google Sheets permission was not granted', { code: 'scope_denied' });
  }
  return tokens;
}

/**
 * @description Revoke a token (best effort).
 * @param {string} token - The refresh (or access) token.
 * @param {Function} fetchImpl - fetch.
 * @returns {Promise<boolean>} True when Google confirmed.
 */
async function revokeToken(token, fetchImpl) {
  if (!token) {
    return false;
  }
  try {
    const { status } = await postForm(fetchImpl, REVOKE_URL, { token });
    return status === 200;
  } catch {
    return false;
  }
}

/**
 * @description The access token manager: refresh before expiry, one refresh
 * at a time, final stop on invalid_grant.
 * @param {object} options - `{ fetchImpl, now, getClient, saveTokens }`.
 * @returns {object} The manager.
 */
function createTokenManager({ fetchImpl, now, getClient, saveTokens }) {
  let tokens = { accessToken: '', refreshToken: '', expiresAt: 0, clientId: '' };
  let refreshing = null;
  let lost = false;

  /**
   * @description Refresh the access token (shared by concurrent callers).
   * @returns {Promise<string>} The new access token.
   */
  function refresh() {
    if (lost) {
      return Promise.reject(new AuthError('Google access lost', { reauth: true }));
    }
    if (!refreshing) {
      refreshing = (async () => {
        const { clientId, clientSecret } = getClient();
        if (!tokens.refreshToken) {
          throw new AuthError('Not connected to Google', { code: 'no_grant', reauth: true });
        }
        const { status, body } = await postForm(fetchImpl, TOKEN_URL, {
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: 'refresh_token',
          refresh_token: tokens.refreshToken,
        });
        if (status !== 200 || !body.access_token) {
          const error = tokenError(status, body, true);
          if (error.reauth) {
            lost = true;
          }
          throw error;
        }
        const next = readTokens(body, now(), tokens.refreshToken);
        tokens = { ...tokens, ...next, clientId };
        await saveTokens(tokens);
        return tokens.accessToken;
      })().finally(() => {
        refreshing = null;
      });
    }
    return refreshing;
  }

  return {
    get tokens() {
      return { ...tokens };
    },
    get lost() {
      return lost;
    },
    /** @param {object} next - Stored tokens. */
    setTokens(next) {
      tokens = { ...tokens, ...next };
    },
    /**
     * @description Adopt the tokens of a new connection.
     * @param {object} next - The tokens.
     * @returns {Promise<void>}
     */
    async adopt(next) {
      tokens = { ...next };
      lost = false;
      await saveTokens(tokens);
    },
    hasGrant: () => Boolean(tokens.refreshToken),
    refresh,
    /**
     * @description A valid access token, refreshed when needed.
     * @param {boolean} [force] - Refresh even if not expired (after a 401).
     * @returns {Promise<string>} The token.
     */
    async getAccessToken(force = false) {
      if (!force && tokens.accessToken && tokens.expiresAt - REFRESH_MARGIN_MS > now()) {
        return tokens.accessToken;
      }
      return refresh();
    },
    /**
     * @description Forget everything (disconnect).
     * @returns {Promise<void>}
     */
    async clear() {
      tokens = { accessToken: '', refreshToken: '', expiresAt: 0, clientId: '' };
      lost = false;
      await saveTokens(tokens);
    },
  };
}

export {
  AUTHORIZE_URL,
  TOKEN_URL,
  REVOKE_URL,
  SCOPE,
  AuthError,
  createPkce,
  buildAuthorizeUrl,
  exchangeCode,
  revokeToken,
  createTokenManager,
};
