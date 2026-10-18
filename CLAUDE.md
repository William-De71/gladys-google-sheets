# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration** for **Google Sheets**: a Node.js
service (Node 22+, ESM, no build step) in its own sandboxed Docker container,
talking to Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js)
and to Google through the official Google Sheets API v4 and OAuth 2.0 (the
user's own Google Cloud client). Only dependency: the SDK (`fetch` is native).
Transport: cloud only.

## Commands

```bash
npm install
npm test                                  # node --test, never touches the network
node --test test/app.test.js              # one file
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npx github:GladysAssistant/integration-store . --skip-image-check
scripts/build-cover.sh                    # cover.jpg from docs/assets/cover.svg
docs/illustrations/render.sh              # docs/assets/widgets.<lang>.png
node .github/scripts/release.mjs next     # the version the next release would get
```

## Architecture

```
index.js           SDK wiring only (new GladysIntegration + createApp)
src/app.js         every handler, registered before connect(): OAuth, start, polling
                   timer, publishing, scene events, widget, scene and config actions
src/auth.js        Google OAuth 2.0 (authorize URL, PKCE, code exchange, single-flight
                   refresh, final stop on invalid_grant, revoke)
src/sheets-api.js  Sheets API v4 driver: metadata, batchGet, get, append, update,
                   clear; local limiter, backoff on 429/5xx, retry after a 401. The
                   only module that calls Google Sheets: mocked in the tests.
src/a1.js          pure helpers: spreadsheet URL/ID, A1 notation, quoted tab names
src/registry.js    the watches declared with the configuration buttons (setConfig)
src/watcher.js     the readings of the watches: cell values, new rows from the last
                   known row down, references, quiet marks for the writes of Gladys
src/device.js      one device per watch (value or row counter)
src/events.js      scene trigger keys and event data
src/widgets.js     the `rows` widget (pure builder)
src/config.js / i18n.js   configuration, runtime texts (en / fr / de / es)
```

## Google facts (from the documentation, to re-check when in doubt)

- OAuth: `https://accounts.google.com/o/oauth2/v2/auth` with `access_type=offline`
  and `prompt=consent`, scope `https://www.googleapis.com/auth/spreadsheets` only
  (sensitive, not restricted; never Drive), PKCE S256; the refresh answer carries
  no new refresh token; granular consent can drop the scope (checked).
- Refresh tokens die after 7 days for an External app left in **Testing**, after
  6 months unused, on revocation; `invalid_grant` is final: never retry it.
- Redirect URI: the one Gladys sends (`https://my.gladysassistant.com/redirect/oauth`,
  or the instance itself over HTTPS).
- Sheets API: no push for values. Quotas: 60 read and 60 write requests per minute
  per user, 300 per project, no daily cap; 429 asks for a truncated exponential
  backoff. `FORMATTED_VALUE` (default) = what the user sees, `UNFORMATTED_VALUE` =
  the real number (0.5 for "50 %"), dates as text with `dateTimeRenderOption=FORMATTED_STRING`. Trailing empty rows and columns are left out of `values`.
  `USER_ENTERED` parses numbers, dates and formulas; `RAW` keeps text. Tab names are
  always quoted in A1 (`'Jon''s log'!A1`); the spreadsheet id and the tab `gid` are
  stable across renames, names are not.

## Rules

- **External ids are forever**: `gladys.externalIds(kind, '<spreadsheetId>:<sheetId>:<B2 | A-Z>')` (kind `cell` or `rows`), feature keys, config, action, widget, widget
  action, scene trigger, variable, action and output keys. `test/structure.test.js`
  compares them to `test/fixtures/discovery.baseline.json` (0.1.0): never update the
  baseline without a documented migration.
- **Polling by an internal timer** (`poll_minutes`), never `should_poll`; every
  reading and every write go through `exclusive()` (one at a time).
- **States**: `publishChangedStates` with a one-hour heartbeat, only for the
  created features; everything again in `onDeviceCreated`, then a widget refresh.
- **Scene events** on changes only; the first reading of a watch is a reference.
  A scene or widget action never fires an event (`watcher.touch`: quiet rows, and the
  cell changes of the next reading of the same spreadsheet are absorbed).
- **Secrets**: never log a token, the Client secret, the Client ID, a spreadsheet
  id, a tab name or a cell value. Gladys passes no DEBUG variable to the container:
  the **Diagnostic** action writes the anonymized summary to the logs instead.
- **Time**: the date and time written in the rows use the `TZ` the supervisor injects.
- **The container rootfs is read-only**; this integration writes nothing to disk
  (tokens, the pending OAuth state and the watches live in the Gladys config via
  `setConfig`).
- **Four languages** everywhere (manifest, `src/i18n.js`, docs, README);
  `test/i18n.test.js` checks it.
- **Widget images**: after any change to a widget content, run
  `docs/illustrations/render.sh` again and look at the four PNG files.
- **Versions belong to the Release workflow**: never edit `version` in
  `package.json`, the lockfile or the manifest, nor the `docker_image` tag.
- **Changelog**: Ne jamais éditer CHANGELOG.md à la main, il est généré à la
  release. Écris le titre de PR comme la ligne que l'utilisateur lira.
- **Forum drafts** (`.github/forum-*.md`) are never committed.
- **Style**: Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network.
