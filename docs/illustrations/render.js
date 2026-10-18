// Renders integration widget contents the way the Gladys front does
// (front/src/components/boxs/external-widget: ExternalWidgetBox +
// WidgetComponents, and the area chart of boxs/chart), in plain DOM, with the
// same slots, order, class names and ApexCharts options.
// Query: ?lang=fr&cards=rows,rows_log&form=rows:add_row
/* global ApexCharts, DATA */
const params = new URLSearchParams(location.search);
const LANG = params.get('lang') || 'en';
const CARDS = (params.get('cards') || 'rows').split(',');
// `<card>:<action key>`: the form open on that card only, e.g. rows:add_row
const [FORM_CARD, FORM] = (params.get('form') || ':').split(':');
// dashboard.boxes.external-widget.actionFormClose / actionFormSend of the front.
const FORM_BUTTONS = {
  en: ['Close', 'Send'],
  fr: ['Fermer', 'Envoyer'],
  de: ['Schließen', 'Senden'],
  es: ['Cerrar', 'Enviar'],
};

// The "now" of the contents: the chart axis matches it.
const realNow = Date.now;
Date.now = () => DATA.now;

const text = (value) =>
  value && typeof value === 'object' ? (value[LANG] ?? value.en ?? '') : (value ?? '');
const formatNumber = (value) =>
  typeof value === 'number'
    ? new Intl.NumberFormat(LANG, { maximumFractionDigits: 2 }).format(value)
    : (value ?? '');
const COLOR = {
  neutral: 'colorNeutral',
  primary: 'colorPrimary',
  success: 'colorSuccess',
  warning: 'colorWarning',
  danger: 'colorDanger',
  info: 'colorInfo',
};
const BADGE_COLOR = {
  primary: 'badgeColorPrimary',
  success: 'badgeColorSuccess',
  warning: 'badgeColorWarning',
  danger: 'badgeColorDanger',
  info: 'badgeColorInfo',
};
const el = (tag, cls, children = []) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
};
const svg = (tag, attributes) => {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, value));
  return node;
};
const icon = (name, cls = '') => el('i', `fe fe-${name} ${cls}`);

function splitIntoSlots(components) {
  const slots = { header: [], tiles: [], focal: null, body: null, status: null, buttons: [] };
  for (const c of components) {
    if (c.type === 'text') c.variant === 'body' ? (slots.body = c) : slots.header.push(c);
    else if (c.type === 'value' || c.type === 'gauge') slots.tiles.push(c);
    else if (['chart', 'card-list', 'image'].includes(c.type)) slots.focal = c;
    else if (c.type === 'status') slots.status = c;
    else if (c.type === 'button') slots.buttons.push(c);
  }
  return slots;
}

const header = (components) =>
  el(
    'div',
    'header',
    components.map((c) => el('div', c.variant === 'heading' ? 'heading' : 'caption', text(c.text))),
  );

// The 270° arc of the Gauge component.
const GAUGE_ARC_LENGTH = (2 * Math.PI * 34 * 270) / 360;
const ARC = 'M 20 62 A 34 34 0 1 1 68 62';

function gauge(c) {
  const ratio = Math.min(1, Math.max(0, (c.value - c.min) / (c.max - c.min)));
  const drawing = svg('svg', {
    class: `gauge ${COLOR[c.color || 'primary']}`,
    viewBox: '0 0 88 66',
    'aria-hidden': 'true',
  });
  drawing.append(
    svg('path', {
      class: 'gaugeTrack',
      d: ARC,
      'stroke-dasharray': `${GAUGE_ARC_LENGTH} ${GAUGE_ARC_LENGTH}`,
    }),
    svg('path', {
      class: 'gaugeArc',
      d: ARC,
      'stroke-dasharray': `${ratio * GAUGE_ARC_LENGTH} ${GAUGE_ARC_LENGTH}`,
    }),
  );
  return el('div', 'gaugeBox', [
    drawing,
    el('div', 'tileValue gaugeValue', [
      formatNumber(c.value),
      c.unit ? el('span', 'tileUnit', text(c.unit)) : null,
    ]),
  ]);
}

const tiles = (components) =>
  el(
    'div',
    'tilesBox',
    el(
      'div',
      `tiles tilesCount${Math.min(components.length, 6)}`,
      components.map((c) =>
        el('div', 'tile', [
          c.icon && c.type === 'value' ? icon(c.icon, `tileIcon ${COLOR[c.color] || ''}`) : null,
          c.type === 'gauge'
            ? gauge(c)
            : el('span', `tileValue ${COLOR[c.color] || ''}`, [
                formatNumber(c.value),
                c.unit ? el('span', 'tileUnit', text(c.unit)) : null,
              ]),
          c.label ? el('span', 'tileLabel', text(c.label)) : null,
        ]),
      ),
    ),
  );

// yAxisFormatter of front/src/components/boxs/chart.
const yAxisFormatter = (value) => {
  if (value === null || value === undefined || Number.isNaN(value)) return value;
  if (value === 0) return '0';
  const rounded = parseFloat(value.toPrecision(4));
  if (Math.abs(rounded) < 0.001 || Math.abs(rounded) >= 1e9) return rounded.toExponential(2);
  return value.toFixed(2);
};

// getApexChartAreaOptions (or Line) of front/src/components/boxs/chart,
// display_axes on, height 200, the default colors of the chart box.
function chart(component) {
  const box = el('div', null, [
    component.title ? el('div', 'caption mb-1', text(component.title)) : null,
  ]);
  const target = el('div');
  box.append(target);
  const area = component.chart_type === 'area';
  const series = component.series.map((s, i) => ({
    name: text(s.name) || `${i + 1}`,
    data: s.points.map((p) => [new Date(p.t).getTime(), p.v]),
  }));
  const options = {
    chart: {
      locales: window.APEX_LOCALES,
      defaultLocale: LANG,
      type: area ? 'area' : 'line',
      fontFamily: 'inherit',
      height: 200,
      parentHeightOffset: 0,
      sparkline: { enabled: false },
      toolbar: { show: false },
      animations: { enabled: false },
    },
    dataLabels: { enabled: false },
    fill: area ? { opacity: 0.16, type: 'solid' } : { opacity: 1 },
    stroke: { width: 2, lineCap: 'round', curve: 'smooth' },
    series,
    grid: { strokeDashArray: 4, padding: { left: -4 } },
    xaxis: {
      labels: { padding: 0, datetimeUTC: false },
      tooltip: { enabled: false },
      axisBorder: { show: false },
      type: 'datetime',
    },
    yaxis: { labels: { padding: 4, formatter: yAxisFormatter } },
    colors: ['#316cbe', '#d63031', '#00b894', '#fdcb6e', '#6c5ce7'],
    legend: { show: true, position: 'bottom' },
  };
  requestAnimationFrame(() => {
    window.PENDING_CHARTS += 1;
    new ApexCharts(target, options).render().then(() => {
      window.PENDING_CHARTS -= 1;
    });
  });
  return box;
}

// formatDate of widgetContentUtils.js: a calendar date with the dayjs `ll`
// format ("Oct 17, 2026", "17 oct. 2026"…).
const formatDate = (value) => {
  const calendar = /^(\d{4})-(\d{2})-(\d{2})(T00:00:00(\.000)?Z)?$/.exec(value || '');
  if (!calendar) return '';
  const date = new Date(Number(calendar[1]), Number(calendar[2]) - 1, Number(calendar[3]));
  return new Intl.DateTimeFormat(LANG, { day: 'numeric', month: 'short', year: 'numeric' }).format(
    date,
  );
};

// WidgetCardList: an item with a description or links is clickable; with a
// date, the date replaces the subtitle.
const cardList = (component) =>
  el(
    'div',
    null,
    el(
      'div',
      'cardList',
      component.items.map((item) => {
        const clickable = Boolean(item.description) || (item.links && item.links.length > 0);
        const node = el('button', `cardListItem ${clickable ? 'clickable' : ''}`, [
          el('div', 'cardListText', [
            el('span', 'cardTitle', text(item.title)),
            item.date || item.subtitle
              ? el('span', 'cardMeta', item.date ? formatDate(item.date) : text(item.subtitle))
              : null,
            item.badge
              ? el('span', `wbadge ${BADGE_COLOR[item.badge.color] || ''}`, text(item.badge.text))
              : null,
          ]),
        ]);
        node.type = 'button';
        node.disabled = !clickable;
        return node;
      }),
    ),
  );

const statusList = (component) =>
  el(
    'ul',
    'statusList',
    component.items.map((item) =>
      el('li', 'statusRow', [
        item.icon
          ? icon(item.icon, `statusIcon ${COLOR[item.color || 'neutral']}`)
          : el('span', `statusDot ${COLOR[item.color || 'neutral']}`),
        el('span', 'statusLabel', text(item.label)),
        el('span', 'statusValue', formatNumber(text(item.value))),
      ]),
    ),
  );

const buttons = (components, formOpen) =>
  el(
    'div',
    'buttons',
    components.map((c) => {
      const open = formOpen && FORM && c.action && c.action.key === FORM;
      const node = el(
        'button',
        `button ${c.style === 'primary' ? 'buttonPrimary' : ''} ${c.style === 'danger' ? 'buttonDanger' : ''} ${open ? 'buttonOpen' : ''}`,
        [
          el('span', 'buttonIcon', icon(c.icon || 'play')),
          el('span', 'buttonLabel', text(c.label)),
        ],
      );
      node.type = 'button';
      return node;
    }),
  );

// WidgetActionForm: the fields rendered by the config_schema engine (Tabler
// form groups: input.form-control, select.custom-select), with the defaults
// of the content, then Close / Send.
function actionForm(component) {
  const fields = component.action.fields.map((field) => {
    const id = `f-${field.key}`;
    let input;
    if (field.type === 'select') {
      input = el(
        'select',
        'custom-select',
        field.options.map((option) => {
          const node = el('option', null, text(option.label));
          node.value = option.value;
          node.selected = option.value === field.default;
          return node;
        }),
      );
    } else {
      input = el('input', 'form-control');
      input.type = field.type === 'number' ? 'number' : 'text';
      if (field.placeholder) input.placeholder = text(field.placeholder);
      const value = ((DATA.formValues || {})[LANG] || {})[field.key];
      if (value !== undefined) input.value = value;
    }
    input.id = id;
    const label = el('label', 'form-label', [
      text(field.label),
      field.required ? el('span', 'form-required', ' *') : null,
    ]);
    label.htmlFor = id;
    return el('div', 'form-group', [
      label,
      input,
      field.description ? el('small', 'form-text text-muted', text(field.description)) : null,
    ]);
  });
  const [close, send] = FORM_BUTTONS[LANG];
  return el('form', 'actionForm', [
    el('div', 'actionFormTitle', [
      icon(component.icon || 'play'),
      el('span', null, text(component.label)),
    ]),
    ...fields,
    el('div', 'actionFormButtons', [
      el('button', 'btn btn-secondary', close),
      el('button', 'btn btn-primary', send),
    ]),
  ]);
}

// The image focal: a 16:9 frame (imageFrame), the picture contained or
// covered, as ImageFrame in WidgetComponents.jsx. The bytes come from
// DATA.images (what onWidgetGetImage would serve).
function image(c) {
  const img = document.createElement('img');
  img.src = (DATA.images || {})[c.key] || '';
  img.alt = text(c.alt || '');
  img.className = c.fit === 'cover' ? 'imageCover' : 'imageContain';
  return el('div', 'imageFrame', img);
}

function card(name) {
  const content = DATA.contents[LANG][name];
  const widget = DATA.widgets[name];
  const slots = splitIntoSlots(content.components);
  const focal = slots.focal;
  const formOpen = FORM_CARD === name;
  const formButton = formOpen && slots.buttons.find((b) => b.action && b.action.key === FORM);
  return el('div', 'card', [
    el(
      'div',
      'card-header',
      el('h3', 'card-title', [icon(widget.icon), el('span', 'm-1', text(widget.label))]),
    ),
    el(
      'div',
      'card-body',
      el('div', 'slots', [
        slots.header.length ? header(slots.header) : null,
        slots.tiles.length ? tiles(slots.tiles) : null,
        focal && focal.type === 'chart' ? chart(focal) : null,
        focal && focal.type === 'card-list' ? cardList(focal) : null,
        focal && focal.type === 'image' ? image(focal) : null,
        slots.body ? el('p', 'body', text(slots.body.text)) : null,
        slots.status ? statusList(slots.status) : null,
        slots.buttons.length ? buttons(slots.buttons, formOpen) : null,
        formButton ? actionForm(formButton) : null,
      ]),
    ),
  ]);
}

window.PENDING_CHARTS = 0;
const row = document.getElementById('row');
const columns = [el('div', 'col'), el('div', 'col')];
columns.forEach((column) => row.append(column));
CARDS.forEach((name, index) => columns[index % 2].append(card(name)));
setTimeout(() => {
  const wait = () => {
    if (window.PENDING_CHARTS === 0) {
      document.body.dataset.ready = '1';
      Date.now = realNow;
    } else setTimeout(wait, 50);
  };
  wait();
}, 100);
