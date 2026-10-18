// Builds the widget contents of the illustrations with the integration's own
// code: node gen.mjs <repo> <out.json> (run by render.sh)
//
// Two made-up "rows" widgets (fixed date: Sunday 18 October 2026, 10:00 in
// Paris), written in the language of each image, as a user would:
//   rows      the answers of a family Google Form, its "Add a row" form open;
//   rows_log  a temperature log filled by a scene (date and time in column A).
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const [repo, out] = process.argv.slice(2);
const load = (path) => import(pathToFileURL(`${repo}/${path}`).href);
const { buildRowsWidget } = await load('src/widgets.js');
const { validateWatch } = await load('src/registry.js');
const { LANGUAGES } = await load('src/i18n.js');
const manifest = JSON.parse(readFileSync(`${repo}/gladys-assistant-integration.json`, 'utf8'));

const NOW = Date.parse('2026-10-18T08:00:00Z');
const SPREADSHEET = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms';

const TEXTS = {
  formTab: {
    en: 'Form answers',
    fr: 'Réponses au formulaire',
    de: 'Formularantworten',
    es: 'Respuestas',
  },
  header: {
    en: ['Timestamp', 'Who', 'Request'],
    fr: ['Horodateur', 'Qui', 'Demande'],
    de: ['Zeitstempel', 'Wer', 'Anfrage'],
    es: ['Marca temporal', 'Quién', 'Petición'],
  },
  requests: {
    en: [
      ['Léa', 'Feed the cat at 6 pm'],
      ['Tom', 'Close the garage door'],
      ['Léa', 'Water the tomatoes'],
      ['Grandma', 'Turn the heating on Sunday'],
    ],
    fr: [
      ['Léa', 'Nourrir le chat à 18 h'],
      ['Tom', 'Fermer la porte du garage'],
      ['Léa', 'Arroser les tomates'],
      ['Mamie', 'Allumer le chauffage dimanche'],
    ],
    de: [
      ['Léa', 'Katze um 18 Uhr füttern'],
      ['Tom', 'Garagentor schließen'],
      ['Léa', 'Tomaten gießen'],
      ['Oma', 'Heizung am Sonntag einschalten'],
    ],
    es: [
      ['Léa', 'Dar de comer al gato a las 18 h'],
      ['Tom', 'Cerrar la puerta del garaje'],
      ['Léa', 'Regar los tomates'],
      ['Abuela', 'Encender la calefacción el domingo'],
    ],
  },
  logTab: { en: 'Temperatures', fr: 'Températures', de: 'Temperaturen', es: 'Temperaturas' },
  logHeader: {
    en: ['Date', 'Living room °C', 'Outside °C'],
    fr: ['Date', 'Salon °C', 'Extérieur °C'],
    de: ['Datum', 'Wohnzimmer °C', 'Außen °C'],
    es: ['Fecha', 'Salón °C', 'Exterior °C'],
  },
  formValues: {
    en: { column_1: 'Tom', column_2: 'Buy light bulbs' },
    fr: { column_1: 'Tom', column_2: 'Acheter des ampoules' },
    de: { column_1: 'Tom', column_2: 'Glühbirnen kaufen' },
    es: { column_1: 'Tom', column_2: 'Comprar bombillas' },
  },
};
// Dates as Google Sheets shows them in each locale.
const STAMPS = {
  en: ['10/17/2026 18:02:11', '10/17/2026 21:40:03', '10/18/2026 07:15:48', '10/18/2026 09:31:20'],
  fr: ['17/10/2026 18:02:11', '17/10/2026 21:40:03', '18/10/2026 07:15:48', '18/10/2026 09:31:20'],
  de: ['17.10.2026 18:02:11', '17.10.2026 21:40:03', '18.10.2026 07:15:48', '18.10.2026 09:31:20'],
  es: ['17/10/2026 18:02:11', '17/10/2026 21:40:03', '18/10/2026 7:15:48', '18/10/2026 9:31:20'],
};
const decimal = (value, language) =>
  new Intl.NumberFormat(language === 'en' ? 'en-US' : language, {
    minimumFractionDigits: 1,
  }).format(value);

const contents = {};
for (const language of LANGUAGES) {
  const formWatch = validateWatch({
    kind: 'rows',
    spreadsheetId: SPREADSHEET,
    sheetId: 1729,
    range: 'A:Z',
    header: true,
    name: 'Requests',
    sheetTitle: TEXTS.formTab[language],
  });
  const requests = TEXTS.requests[language].map(([who, what], index) => ({
    row: index + 2,
    values: [STAMPS[language][index], who, what],
  }));
  const logWatch = validateWatch({
    kind: 'rows',
    spreadsheetId: SPREADSHEET,
    sheetId: 42,
    range: 'A:C',
    header: true,
    name: 'Temperatures',
    sheetTitle: TEXTS.logTab[language],
  });
  const temperatures = [
    [19.8, 6.1],
    [20.4, 7.9],
    [21.1, 11.2],
    [20.9, 12.6],
    [20.2, 9.4],
  ].map(([inside, outside], index) => ({
    row: 140 + index,
    values: [
      `2026-10-18 0${5 + index}:00:00`,
      decimal(inside, language),
      decimal(outside, language),
    ],
  }));
  contents[language] = {
    rows: buildRowsWidget({
      watch: formWatch,
      state: { header: TEXTS.header[language], recent: requests, count: 4, readAt: NOW - 60000 },
      sheetTitle: TEXTS.formTab[language],
      count: 4,
      form: 'add_timestamp',
      language,
      now: NOW,
    }),
    rows_log: buildRowsWidget({
      watch: logWatch,
      state: {
        header: TEXTS.logHeader[language],
        recent: temperatures,
        count: 143,
        readAt: NOW - 2 * 60000,
      },
      sheetTitle: TEXTS.logTab[language],
      count: 5,
      form: 'none',
      language,
      now: NOW,
    }),
  };
}
const rows = manifest.widgets.find((w) => w.key === 'rows');
const widgets = {
  rows: { icon: rows.icon, label: rows.label },
  rows_log: { icon: rows.icon, label: rows.label },
};
writeFileSync(out, JSON.stringify({ now: NOW, widgets, contents, formValues: TEXTS.formValues }));
