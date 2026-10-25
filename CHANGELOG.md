# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions
follow [Semantic Versioning](https://semver.org/). This file is generated at
each release from the Conventional Commits: do not edit it by hand.

## [0.2.0] - 2026-10-25

### Added

- require Gladys 5.3 and declare catalog keywords ([7a2e626](https://github.com/William-De71/gladys-google-sheets/commit/7a2e6260c66c7a73d9a8923998f29aa097b40dae))

## [0.1.1] - 2026-10-24

### Security

- **security:** build the image on Node.js 24.22.1 or later ([0e8e33d](https://github.com/William-De71/gladys-google-sheets/commit/0e8e33dc08e469cf31a885dca309da680b6053fd))

## [0.1.0] - 2026-10-18

### Added

- Connection with Google OAuth 2.0 and the user's own Google Cloud client (Client ID and Client secret, never shipped with the image): Connect button, the `spreadsheets` scope only (no Drive access), PKCE, state kept across a container restart, tokens refreshed automatically, a revoked access reported without hammering Google.
- Scene actions: add a row (with the date and time in the first column if wanted), write cells, read cells (value as shown, number, every value of a range) and clear cells, on any spreadsheet the account can edit; values interpreted as if typed, or kept as raw text.
- Watches declared from the configuration screen, without JSON: a cell (shown in Gladys as a number, a text, a temperature, an amount or an energy index) or the new rows of a tab; a spreadsheet URL is enough, its ID and tab are read from it.
- One device per watch: the value of a watched cell or the number of rows of a watched tab, for tiles, history and scene conditions.
- Scene triggers: cell changed (filter by watch and by new value) and row added (Google Forms answers, a log typed on the phone), never raised by the changes Gladys makes itself.
- Dashboard widget: the last rows of a watched tab, with an "Add a row" form whose fields are named after the header (Gladys 5.2.0 or later).
- Reading by an internal timer (every 2 minutes by default), with a local limit under the 60 requests a minute of Google and an exponential backoff on HTTP 429.
- English, French, German and Spanish everywhere: settings, devices, widgets, scenes and documentation.

[0.2.0]: https://github.com/William-De71/gladys-google-sheets/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/William-De71/gladys-google-sheets/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/William-De71/gladys-google-sheets/releases/tag/v0.1.0
