// -----------------------------------------------------------------------------
// Entry point of the Google Sheets external integration.
//
// Brings the Google Sheets of a Google account into Gladys:
//   - scene actions: add a row, write cells, read cells, clear cells;
//   - watches declared on the configuration screen (src/registry.js): a cell,
//     or the new rows of a tab, each one a device (src/device.js);
//   - scene triggers: cell changed, row added (src/events.js);
//   - dashboard widget: the last rows of a watched tab, with an "Add a row"
//     form (src/widgets.js).
//
// Sign-in: OAuth 2.0 with the user's own Google Cloud client (src/auth.js).
// Data: the Google Sheets API v4 (src/sheets-api.js), the watches read every
// few minutes (src/watcher.js): Google Sheets offers no push for values.
//
// This file only wires the SDK client: the handlers are in src/app.js.
//
// Environment variables provided by the Gladys supervisor:
//   GLADYS_HOST_API_URL / GLADYS_INTEGRATION_TOKEN / GLADYS_INTEGRATION_SELECTOR
//   TZ (the time zone of Gladys: the date and time written in the rows)
// The SDK reads them automatically: `new GladysIntegration()` is enough.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { createApp } from './src/app.js';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

const gladys = new GladysIntegration();
createApp(gladys);

// --- Startup -----------------------------------------------------------------------
logger.info(`Starting the Google Sheets integration ${version}...`);
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
