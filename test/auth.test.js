import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { createPkce, createTokenManager, exchangeCode, AuthError } from '../src/auth.js';
import { fakeGoogle, NOW, CLIENT_ID, CLIENT_SECRET } from './helpers/fakes.js';

test('PKCE: S256 challenge of a 64-character verifier, random state', () => {
  const a = createPkce();
  const b = createPkce();
  assert.notEqual(a.state, b.state);
  assert.equal(a.verifier.length, 64);
  const expected = createHash('sha256')
    .update(a.verifier)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  assert.equal(a.challenge, expected);
});

test('code exchange: a refused code is not final, the refresh token is required', async () => {
  const google = fakeGoogle();
  await assert.rejects(
    exchangeCode({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      code: 'bad',
      verifier: 'v',
      redirectUri: 'https://my.gladysassistant.com/redirect/oauth',
      fetchImpl: google,
      now: () => NOW,
    }),
    (err) => err instanceof AuthError && err.code === 'invalid_grant' && !err.reauth,
  );
  const tokens = await exchangeCode({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    code: 'good-code',
    verifier: 'v',
    redirectUri: 'https://my.gladysassistant.com/redirect/oauth',
    fetchImpl: google,
    now: () => NOW,
  });
  assert.equal(tokens.refreshToken, 'refresh-1');
  assert.equal(tokens.expiresAt, NOW + 3599000);
});

test('token manager: one refresh for concurrent callers, keeps the refresh token, stops on invalid_grant', async () => {
  const google = fakeGoogle();
  const saved = [];
  const manager = createTokenManager({
    fetchImpl: google,
    now: () => NOW,
    getClient: () => ({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET }),
    saveTokens: async (tokens) => saved.push(tokens),
  });
  manager.setTokens({ accessToken: 'old', refreshToken: 'refresh-1', expiresAt: NOW - 1 });
  const [a, b] = await Promise.all([manager.getAccessToken(), manager.getAccessToken()]);
  assert.equal(a, b);
  assert.equal(google.state.calls.filter((call) => call.startsWith('POST /token')).length, 1);
  assert.equal(saved.at(-1).refreshToken, 'refresh-1', 'Google sends no new refresh token');
  assert.equal(await manager.getAccessToken(), a, 'still valid: no call');

  google.state.revoked = true;
  await assert.rejects(manager.getAccessToken(true), (err) => err.reauth === true);
  assert.equal(manager.lost, true);
  const calls = google.state.calls.length;
  await assert.rejects(manager.getAccessToken(true), (err) => err.reauth === true);
  assert.equal(google.state.calls.length, calls, 'the token endpoint is not hammered');
});
