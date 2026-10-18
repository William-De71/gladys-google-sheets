// -----------------------------------------------------------------------------
// The dashboard widget (pure functions: the content is built from the last
// reading of a rows watch, app.js serves it and runs the buttons).
//
//   rows  the last rows of a watched tab, newest first (card list: the first
//         column as title, the other columns in the subtitle and, with the
//         header names, in the detail), an "Add a row" form whose fields are
//         named after the header (Gladys 5.2.0+), "Open in Google Sheets"
//         and "Refresh".
//
// It costs no request: the rows come from the reading of the watch. Why no
// widget for the watched cells: they are devices, the dashboard already shows
// them as tiles and charts.
// -----------------------------------------------------------------------------

import { columnLetters, parseColumns, sheetUrl } from './a1.js';
import { t, ago, LANGUAGES } from './i18n.js';

const WIDGETS = { ROWS: 'rows' };
const WIDGET_ACTIONS = { ADD_ROW: 'add_row', REFRESH: 'refresh' };
const FORMS = { NONE: 'none', ADD: 'add', ADD_TIMESTAMP: 'add_timestamp' };
const COUNT = { min: 1, max: 8, default: 5 };
// A card list shows 8 items at most ("list" display); a form 4 fields.
const FORM_FIELDS = 4;
const TTL_SECONDS = { rows: 300, message: 60 };

const clip = (text, max) => {
  const value = String(text ?? '');
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
};
const allLanguages = (key, values) =>
  Object.fromEntries(LANGUAGES.map((lang) => [lang, t(key, lang, values)]));
const sameEverywhere = (text) => Object.fromEntries(LANGUAGES.map((lang) => [lang, text]));

/**
 * @description A content with a single message.
 * @param {string} message - The text.
 * @param {number} [ttl] - Its TTL.
 * @returns {object} The content.
 */
function messageContent(message, ttl = TTL_SECONDS.message) {
  return {
    ttl_seconds: ttl,
    components: [{ type: 'text', variant: 'body', text: clip(message, 300) }],
  };
}

/**
 * @description The name of each column in use: the header text, or its letter.
 * @param {object} watch - The rows watch.
 * @param {object} state - Its state: the header and the last rows give the
 *   width in use (not the 26 columns of A:Z).
 * @param {string} language - The language.
 * @returns {string[]} The names.
 */
function columnNames(watch, state, language) {
  const { start, end } = parseColumns(watch.range);
  const header = state.header ?? [];
  const used = Math.max(
    watch.header ? header.length : 0,
    ...(state.recent ?? []).map((row) => row.values.length),
    1,
  );
  const names = [];
  for (let index = 0; index <= Math.min(end - start, used - 1); index += 1) {
    names.push(
      (watch.header && header[index]) ||
        t('columnLetter', language, { letter: columnLetters(start + index) }),
    );
  }
  return names;
}

/**
 * @description The form fields of "Add a row", named after the columns.
 * @param {string[]} names - The column names.
 * @param {boolean} timestamp - The first column receives the date and time.
 * @returns {object[]} The fields.
 */
function formFields(names, timestamp) {
  const offset = timestamp ? 1 : 0;
  return names.slice(offset, offset + FORM_FIELDS).map((name, index) => ({
    key: `column_${index + 1}`,
    type: 'string',
    label: sameEverywhere(clip(name, 40)),
    required: index === 0,
  }));
}

/**
 * @description The `rows` widget.
 * @param {object} params - `{ watch, state, sheetTitle, count, form, language, now }`.
 * @returns {object} The content.
 */
function buildRowsWidget({ watch, state, sheetTitle, count, form, language, now }) {
  const names = columnNames(watch, state, language);
  const shown = [...state.recent].reverse().slice(0, count);
  const components = [
    {
      type: 'text',
      variant: 'caption',
      text: clip(
        `${sheetTitle || watch.sheetTitle} · ${t('rowCount', language, { count: state.count })} · ${ago(
          state.readAt,
          now,
          language,
        )}`,
        80,
      ),
    },
  ];
  if (shown.length > 0) {
    components.push({
      type: 'card-list',
      display: 'list',
      items: shown.map(({ row, values }) => ({
        title: clip(values[0] || t('rowNumber', language, { row }), 60),
        ...(values.length > 1
          ? { subtitle: clip(values.slice(1).filter(Boolean).join(' · '), 120) }
          : {}),
        badge: { text: clip(`#${row}`, 16), color: 'neutral' },
        description: clip(
          values
            .map((value, index) => (value ? `${names[index] ?? ''}: ${value}` : ''))
            .filter(Boolean)
            .join('\n'),
          2000,
        ),
      })),
    });
  } else {
    components.push({ type: 'text', variant: 'body', text: t('noRows', language) });
  }
  if (form === FORMS.ADD || form === FORMS.ADD_TIMESTAMP) {
    const fields = formFields(names, form === FORMS.ADD_TIMESTAMP);
    if (fields.length > 0) {
      components.push({
        type: 'button',
        label: allLanguages('buttonAddRow'),
        icon: 'plus',
        style: 'primary',
        action: { key: WIDGET_ACTIONS.ADD_ROW, fields },
      });
    }
  }
  components.push({
    type: 'button',
    label: allLanguages('buttonOpen'),
    icon: 'external-link',
    link: { url: sheetUrl(watch.spreadsheetId, watch.sheetId) },
  });
  components.push({
    type: 'button',
    label: allLanguages('buttonRefresh'),
    icon: 'refresh-cw',
    action: { key: WIDGET_ACTIONS.REFRESH },
  });
  return { ttl_seconds: TTL_SECONDS.rows, components };
}

export {
  WIDGETS,
  WIDGET_ACTIONS,
  FORMS,
  COUNT,
  FORM_FIELDS,
  TTL_SECONDS,
  messageContent,
  columnNames,
  buildRowsWidget,
};
