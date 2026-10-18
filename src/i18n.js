// -----------------------------------------------------------------------------
// Texts of the integration, in English, French, German and Spanish (English
// fallback), the four languages of the Gladys interface.
//
// The manifest carries its own labels; these are the texts the code writes at
// runtime: feature names, widget contents, toasts, messages of the
// Configuration screen and of the scene actions.
// -----------------------------------------------------------------------------

const LANGUAGES = ['en', 'fr', 'de', 'es'];

const TEXTS = {
  // features
  featureValue: { en: 'Value', fr: 'Valeur', de: 'Wert', es: 'Valor' },
  featureRows: { en: 'Rows', fr: 'Lignes', de: 'Zeilen', es: 'Filas' },

  // connection status (Configuration screen)
  statusNoClient: {
    en: 'Enter the Client ID and Client secret of your Google Cloud OAuth client, save, then click Connect.',
    fr: 'Saisissez le Client ID et le Client secret de votre client OAuth Google Cloud, enregistrez, puis cliquez sur Connecter.',
    de: 'Gib Client-ID und Clientschlüssel deines Google-Cloud-OAuth-Clients ein, speichere und klicke dann auf Verbinden.',
    es: 'Introduce el Client ID y el Client secret de tu cliente OAuth de Google Cloud, guarda y pulsa Conectar.',
  },
  statusNotConnected: {
    en: 'Not connected: click "Connect with Google".',
    fr: 'Non connecté : cliquez sur « Se connecter avec Google ».',
    de: 'Nicht verbunden: Klicke auf „Mit Google verbinden“.',
    es: 'Sin conectar: pulsa «Conectar con Google».',
  },
  statusNoWatch: {
    en: 'Connected to Google Sheets. No watch yet: the scene actions work, add a watch for the triggers.',
    fr: 'Connecté à Google Sheets. Aucune surveillance : les actions de scène fonctionnent, ajoutez une surveillance pour les déclencheurs.',
    de: 'Mit Google Sheets verbunden. Noch keine Überwachung: Die Szenenaktionen funktionieren, füge eine Überwachung für die Auslöser hinzu.',
    es: 'Conectado a Google Sheets. Sin vigilancias: las acciones de escena funcionan, añade una vigilancia para los activadores.',
  },
  statusConnected: {
    en: 'Connected to Google Sheets: {count} watch(es) read.',
    fr: 'Connecté à Google Sheets : {count} surveillance(s) lue(s).',
    de: 'Mit Google Sheets verbunden: {count} Überwachung(en) gelesen.',
    es: 'Conectado a Google Sheets: {count} vigilancia(s) leída(s).',
  },
  statusWatchErrors: {
    en: 'Connected to Google Sheets, but {failing} of {count} watch(es) cannot be read: see "List the watches".',
    fr: 'Connecté à Google Sheets, mais {failing} surveillance(s) sur {count} illisible(s) : voir « Lister les surveillances ».',
    de: 'Mit Google Sheets verbunden, aber {failing} von {count} Überwachung(en) nicht lesbar: siehe „Überwachungen auflisten“.',
    es: 'Conectado a Google Sheets, pero {failing} de {count} vigilancia(s) no se pueden leer: ver «Listar las vigilancias».',
  },
  statusReauth: {
    en: 'Google revoked the access (or the app is still in "Testing": 7 days). Click "Connect with Google" again.',
    fr: 'Google a révoqué l’accès (ou l’application est encore en « Test » : 7 jours). Cliquez à nouveau sur « Se connecter avec Google ».',
    de: 'Google hat den Zugriff widerrufen (oder die App ist noch im „Test“: 7 Tage). Klicke erneut auf „Mit Google verbinden“.',
    es: 'Google revocó el acceso (o la app sigue en «Prueba»: 7 días). Vuelve a pulsar «Conectar con Google».',
  },
  statusUnreachable: {
    en: 'Google Sheets unreachable, new try in a few minutes.',
    fr: 'Google Sheets injoignable, nouvel essai dans quelques minutes.',
    de: 'Google Sheets nicht erreichbar, neuer Versuch in ein paar Minuten.',
    es: 'Google Sheets inaccesible, nuevo intento en unos minutos.',
  },
  statusApiDisabled: {
    en: 'The Google Sheets API is not enabled in your Google Cloud project: enable it, then wait a few minutes.',
    fr: 'L’API Google Sheets n’est pas activée dans votre projet Google Cloud : activez-la, puis patientez quelques minutes.',
    de: 'Die Google Sheets API ist in deinem Google-Cloud-Projekt nicht aktiviert: Aktiviere sie und warte ein paar Minuten.',
    es: 'La API de Google Sheets no está activada en tu proyecto de Google Cloud: actívala y espera unos minutos.',
  },
  statusQuota: {
    en: 'Google Sheets quota reached (60 requests a minute): the readings resume in a minute.',
    fr: 'Quota Google Sheets atteint (60 requêtes par minute) : les lectures reprennent dans une minute.',
    de: 'Google-Sheets-Kontingent erreicht (60 Anfragen pro Minute): Die Abfragen laufen in einer Minute weiter.',
    es: 'Cuota de Google Sheets alcanzada (60 solicitudes por minuto): las lecturas se reanudan en un minuto.',
  },
  connectState: {
    en: 'This Google answer does not match the last "Connect" click. Click it again, once, and keep only that tab.',
    fr: 'Cette réponse de Google ne correspond pas au dernier clic sur « Connecter ». Recliquez une seule fois et gardez uniquement cet onglet.',
    de: 'Diese Google-Antwort passt nicht zum letzten Klick auf „Verbinden“. Klicke erneut, nur einmal, und behalte nur diesen Tab.',
    es: 'Esta respuesta de Google no corresponde al último clic en «Conectar». Vuelve a pulsar una sola vez y conserva solo esa pestaña.',
  },
  connectScope: {
    en: 'The Google Sheets permission was not granted: connect again and tick the "spreadsheets" checkbox.',
    fr: 'L’autorisation Google Sheets n’a pas été accordée : reconnectez-vous et cochez la case « feuilles de calcul ».',
    de: 'Die Google-Sheets-Berechtigung wurde nicht erteilt: Verbinde dich erneut und setze das Häkchen bei „Tabellen“.',
    es: 'No se concedió el permiso de Google Sheets: vuelve a conectarte y marca la casilla «hojas de cálculo».',
  },
  connectFailed: {
    en: 'Google refused the connection ({reason}). Check the Client ID, the Client secret and the redirect URI.',
    fr: 'Google a refusé la connexion ({reason}). Vérifiez le Client ID, le Client secret et l’URI de redirection.',
    de: 'Google hat die Verbindung abgelehnt ({reason}). Prüfe Client-ID, Clientschlüssel und Weiterleitungs-URI.',
    es: 'Google rechazó la conexión ({reason}). Comprueba el Client ID, el Client secret y la URI de redirección.',
  },

  // configuration actions
  watchAdded: {
    en: 'Watch added, offered in Discovery (Google Sheets):',
    fr: 'Surveillance ajoutée, proposée dans la découverte (Google Sheets) :',
    de: 'Überwachung hinzugefügt, in der Geräteerkennung angeboten (Google Sheets):',
    es: 'Vigilancia añadida, ofrecida en el descubrimiento (Google Sheets):',
  },
  watchRemoved: {
    en: 'Watch removed: {name}. If you had created its device, delete it in Gladys too.',
    fr: 'Surveillance supprimée : {name}. Si vous aviez créé son appareil, supprimez-le aussi dans Gladys.',
    de: 'Überwachung entfernt: {name}. Falls du ihr Gerät erstellt hattest, lösche es auch in Gladys.',
    es: 'Vigilancia eliminada: {name}. Si habías creado su dispositivo, bórralo también en Gladys.',
  },
  listEmpty: {
    en: 'No watch yet: use "Watch a cell" or "Watch new rows".',
    fr: 'Aucune surveillance : utilisez « Surveiller une cellule » ou « Surveiller les nouvelles lignes ».',
    de: 'Noch keine Überwachung: Nutze „Zelle überwachen“ oder „Neue Zeilen überwachen“.',
    es: 'Sin vigilancias: usa «Vigilar una celda» o «Vigilar filas nuevas».',
  },
  listHeader: {
    en: '{count} watch(es):',
    fr: '{count} surveillance(s) :',
    de: '{count} Überwachung(en):',
    es: '{count} vigilancia(s):',
  },
  kindCell: { en: 'cell', fr: 'cellule', de: 'Zelle', es: 'celda' },
  kindRows: { en: 'new rows', fr: 'nouvelles lignes', de: 'neue Zeilen', es: 'filas nuevas' },
  describeValue: {
    en: 'value: {value}',
    fr: 'valeur : {value}',
    de: 'Wert: {value}',
    es: 'valor: {value}',
  },
  notReadYet: {
    en: 'not read yet',
    fr: 'pas encore lue',
    de: 'noch nicht gelesen',
    es: 'aún no leída',
  },
  testSpreadsheet: {
    en: 'Default spreadsheet "{title}" opened.',
    fr: 'Classeur par défaut « {title} » ouvert.',
    de: 'Standardtabelle „{title}“ geöffnet.',
    es: 'Hoja de cálculo predeterminada «{title}» abierta.',
  },
  testNoDefault: {
    en: 'No default spreadsheet.',
    fr: 'Pas de classeur par défaut.',
    de: 'Keine Standardtabelle.',
    es: 'Sin hoja de cálculo predeterminada.',
  },
  testResult: {
    en: '{count} watch(es), {failing} unreadable. {calls} API call(s) today.',
    fr: '{count} surveillance(s), {failing} illisible(s). {calls} appel(s) API aujourd’hui.',
    de: '{count} Überwachung(en), {failing} nicht lesbar. {calls} API-Aufruf(e) heute.',
    es: '{count} vigilancia(s), {failing} ilegible(s). {calls} llamada(s) API hoy.',
  },
  readFailed: {
    en: 'Google Sheets could not be read.',
    fr: 'Impossible de lire Google Sheets.',
    de: 'Google Sheets konnte nicht gelesen werden.',
    es: 'No se pudo leer Google Sheets.',
  },
  diagnosticDone: {
    en: 'Diagnostic written to the logs of the integration (no token, no cell value, no sheet name).',
    fr: 'Diagnostic écrit dans les journaux de l’intégration (sans jeton, valeur de cellule ni nom de feuille).',
    de: 'Diagnose in die Protokolle der Integration geschrieben (ohne Token, Zellwerte oder Blattnamen).',
    es: 'Diagnóstico escrito en los registros de la integración (sin token, valores de celda ni nombres de hoja).',
  },
  disconnected: {
    en: 'Disconnected from Google: the access was revoked and the tokens deleted. Your watches are kept.',
    fr: 'Déconnecté de Google : l’accès a été révoqué et les jetons supprimés. Vos surveillances sont conservées.',
    de: 'Von Google getrennt: Der Zugriff wurde widerrufen und die Token gelöscht. Deine Überwachungen bleiben erhalten.',
    es: 'Desconectado de Google: se revocó el acceso y se borraron los tokens. Tus vigilancias se conservan.',
  },

  // errors (configuration buttons, scene actions, widget)
  notConnected: {
    en: 'Google Sheets is not connected: open the configuration of the integration.',
    fr: 'Google Sheets n’est pas connecté : ouvrez la configuration de l’intégration.',
    de: 'Google Sheets ist nicht verbunden: Öffne die Konfiguration der Integration.',
    es: 'Google Sheets no está conectado: abre la configuración de la integración.',
  },
  errorNoSpreadsheet: {
    en: 'No spreadsheet: paste its URL in the action, or set a default spreadsheet in the configuration.',
    fr: 'Aucun classeur : collez son URL dans l’action, ou indiquez un classeur par défaut dans la configuration.',
    de: 'Keine Tabelle: Füge ihre URL in die Aktion ein oder lege eine Standardtabelle in der Konfiguration fest.',
    es: 'Ninguna hoja de cálculo: pega su URL en la acción o define una hoja predeterminada en la configuración.',
  },
  errorSpreadsheetRef: {
    en: 'This is neither a Google Sheets URL nor a spreadsheet ID (the part after /d/ in the URL).',
    fr: 'Ce n’est ni une URL Google Sheets ni un identifiant de classeur (la partie après /d/ dans l’URL).',
    de: 'Das ist weder eine Google-Sheets-URL noch eine Tabellen-ID (der Teil nach /d/ in der URL).',
    es: 'No es una URL de Google Sheets ni un ID de hoja de cálculo (la parte tras /d/ en la URL).',
  },
  errorPublishedUrl: {
    en: 'This is a "Publish to the web" link: use the URL shown in the address bar while editing the spreadsheet.',
    fr: 'C’est un lien « Publier sur le Web » : utilisez l’URL de la barre d’adresse pendant l’édition du classeur.',
    de: 'Das ist ein „Im Web veröffentlichen“-Link: Nutze die URL aus der Adressleiste beim Bearbeiten der Tabelle.',
    es: 'Es un enlace de «Publicar en la web»: usa la URL de la barra de direcciones al editar la hoja.',
  },
  errorSheetNotFound: {
    en: 'No tab "{sheet}" in this spreadsheet.',
    fr: 'Aucun onglet « {sheet} » dans ce classeur.',
    de: 'Kein Tabellenblatt „{sheet}“ in dieser Tabelle.',
    es: 'No hay ninguna pestaña «{sheet}» en esta hoja de cálculo.',
  },
  errorSheetMissing: {
    en: 'its tab was deleted',
    fr: 'son onglet a été supprimé',
    de: 'ihr Tabellenblatt wurde gelöscht',
    es: 'su pestaña fue eliminada',
  },
  errorNoAccess: {
    en: 'Google refuses this spreadsheet: it does not exist or your Google account cannot open it.',
    fr: 'Google refuse ce classeur : il n’existe pas ou votre compte Google ne peut pas l’ouvrir.',
    de: 'Google verweigert diese Tabelle: Sie existiert nicht oder dein Google-Konto kann sie nicht öffnen.',
    es: 'Google rechaza esta hoja de cálculo: no existe o tu cuenta de Google no puede abrirla.',
  },
  errorBadRange: {
    en: 'Google Sheets does not understand this range.',
    fr: 'Google Sheets ne comprend pas cette plage.',
    de: 'Google Sheets versteht diesen Bereich nicht.',
    es: 'Google Sheets no entiende este rango.',
  },
  errorGoogle: {
    en: 'Google Sheets refused: {message}',
    fr: 'Google Sheets a refusé : {message}',
    de: 'Google Sheets hat abgelehnt: {message}',
    es: 'Google Sheets rechazó: {message}',
  },
  errorCell: {
    en: '"{cell}" is not one cell: type it like B2.',
    fr: '« {cell} » n’est pas une cellule : saisissez-la comme B2.',
    de: '„{cell}“ ist keine einzelne Zelle: Gib sie wie B2 ein.',
    es: '«{cell}» no es una celda: escríbela como B2.',
  },
  errorColumns: {
    en: '"{columns}" is not a span of columns: type it like A:Z (52 columns at most).',
    fr: '« {columns} » n’est pas une plage de colonnes : saisissez-la comme A:Z (52 colonnes au maximum).',
    de: '„{columns}“ ist kein Spaltenbereich: Gib ihn wie A:Z ein (höchstens 52 Spalten).',
    es: '«{columns}» no es un rango de columnas: escríbelo como A:Z (52 columnas como máximo).',
  },
  errorRange: {
    en: '"{range}" is not a range: type it like B2, B2:D5 or A:C.',
    fr: '« {range} » n’est pas une plage : saisissez-la comme B2, B2:D5 ou A:C.',
    de: '„{range}“ ist kein Bereich: Gib ihn wie B2, B2:D5 oder A:C ein.',
    es: '«{range}» no es un rango: escríbelo como B2, B2:D5 o A:C.',
  },
  errorTooManyValues: {
    en: 'Too many values: {max} at most.',
    fr: 'Trop de valeurs : {max} au maximum.',
    de: 'Zu viele Werte: höchstens {max}.',
    es: 'Demasiados valores: {max} como máximo.',
  },
  valuesRequired: {
    en: 'Type at least one value.',
    fr: 'Saisissez au moins une valeur.',
    de: 'Gib mindestens einen Wert ein.',
    es: 'Escribe al menos un valor.',
  },
  errorTarget: {
    en: 'Type the number of the watch (#2), its name or its identifier.',
    fr: 'Saisissez le numéro de la surveillance (#2), son nom ou son identifiant.',
    de: 'Gib die Nummer der Überwachung (#2), ihren Namen oder ihre Kennung ein.',
    es: 'Escribe el número de la vigilancia (#2), su nombre o su identificador.',
  },
  errorNotFound: {
    en: 'No watch "{query}": see "List the watches".',
    fr: 'Aucune surveillance « {query} » : voir « Lister les surveillances ».',
    de: 'Keine Überwachung „{query}“: siehe „Überwachungen auflisten“.',
    es: 'Ninguna vigilancia «{query}»: ver «Listar las vigilancias».',
  },
  errorAmbiguous: {
    en: 'Several watches are named "{query}" ({numbers}): use the number.',
    fr: 'Plusieurs surveillances s’appellent « {query} » ({numbers}) : utilisez le numéro.',
    de: 'Mehrere Überwachungen heißen „{query}“ ({numbers}): Nutze die Nummer.',
    es: 'Varias vigilancias se llaman «{query}» ({numbers}): usa el número.',
  },
  errorDuplicate: {
    en: 'This cell or tab is already watched (#{n}).',
    fr: 'Cette cellule ou cet onglet est déjà surveillé (#{n}).',
    de: 'Diese Zelle oder dieses Tabellenblatt wird bereits überwacht (#{n}).',
    es: 'Esta celda o pestaña ya está vigilada (#{n}).',
  },
  errorFull: {
    en: '{max} watches at most: remove one first.',
    fr: '{max} surveillances au maximum : supprimez-en une d’abord.',
    de: 'Höchstens {max} Überwachungen: Entferne zuerst eine.',
    es: '{max} vigilancias como máximo: elimina una primero.',
  },
  errorInvalid: {
    en: 'This watch is not valid.',
    fr: 'Cette surveillance n’est pas valide.',
    de: 'Diese Überwachung ist ungültig.',
    es: 'Esta vigilancia no es válida.',
  },

  // widget
  noRowsWatch: {
    en: 'Choose a "new rows" watch in the settings of this widget (Configuration: "Watch new rows").',
    fr: 'Choisissez une surveillance de nouvelles lignes dans les réglages de ce widget (Configuration : « Surveiller les nouvelles lignes »).',
    de: 'Wähle eine Überwachung neuer Zeilen in den Einstellungen dieses Widgets (Konfiguration: „Neue Zeilen überwachen“).',
    es: 'Elige una vigilancia de filas nuevas en los ajustes de este widget (Configuración: «Vigilar filas nuevas»).',
  },
  noRows: {
    en: 'No row yet.',
    fr: 'Aucune ligne pour l’instant.',
    de: 'Noch keine Zeile.',
    es: 'Todavía no hay filas.',
  },
  rowCount: {
    en: '{count} row(s)',
    fr: '{count} ligne(s)',
    de: '{count} Zeile(n)',
    es: '{count} fila(s)',
  },
  rowNumber: { en: 'Row {row}', fr: 'Ligne {row}', de: 'Zeile {row}', es: 'Fila {row}' },
  columnLetter: {
    en: 'Column {letter}',
    fr: 'Colonne {letter}',
    de: 'Spalte {letter}',
    es: 'Columna {letter}',
  },
  rowAdded: {
    en: 'Row added (row {row}).',
    fr: 'Ligne ajoutée (ligne {row}).',
    de: 'Zeile hinzugefügt (Zeile {row}).',
    es: 'Fila añadida (fila {row}).',
  },
  buttonAddRow: {
    en: 'Add a row',
    fr: 'Ajouter une ligne',
    de: 'Zeile hinzufügen',
    es: 'Añadir una fila',
  },
  buttonOpen: {
    en: 'Open the sheet',
    fr: 'Ouvrir la feuille',
    de: 'Blatt öffnen',
    es: 'Abrir la hoja',
  },
  buttonRefresh: { en: 'Refresh', fr: 'Actualiser', de: 'Aktualisieren', es: 'Actualizar' },
  ago_now: { en: 'just now', fr: 'à l’instant', de: 'gerade eben', es: 'ahora mismo' },
  ago_minutes: {
    en: '{n} min ago',
    fr: 'il y a {n} min',
    de: 'vor {n} Min.',
    es: 'hace {n} min',
  },
  ago_hours: { en: '{n} h ago', fr: 'il y a {n} h', de: 'vor {n} Std.', es: 'hace {n} h' },
};

/**
 * @description A text in a language, with `{name}` substitutions.
 * @param {string} key - The TEXTS key.
 * @param {string} language - The language.
 * @param {object} [values] - The substitutions.
 * @returns {string} The text.
 * @example
 * t('watchRemoved', 'fr', { name: 'Stock' }); // -> 'Surveillance supprimée : Stock. …'
 */
function t(key, language, values = {}) {
  const entry = TEXTS[key];
  if (!entry) {
    return key;
  }
  const text = entry[language] ?? entry.en;
  return text.replace(/\{(\w+)\}/g, (match, name) =>
    values[name] === undefined || values[name] === null ? match : String(values[name]),
  );
}

/**
 * @description A text built per language, at most 200 characters (toasts and
 * connection messages are cut there by Gladys).
 * @param {Function} build - `(language) => string`.
 * @returns {{ en: string, fr: string, de: string, es: string }} The message.
 */
function each(build) {
  return Object.fromEntries(
    LANGUAGES.map((language) => {
      const text = build(language);
      return [language, text.length > 200 ? `${text.slice(0, 199)}…` : text];
    }),
  );
}

/**
 * @description The text of a key in every language.
 * @param {string} key - The TEXTS key.
 * @param {object} [values] - The substitutions.
 * @returns {{ en: string, fr: string, de: string, es: string }} The message.
 */
function all(key, values = {}) {
  return each((language) => t(key, language, values));
}

/**
 * @description "12 min ago" for an instant.
 * @param {number} instant - The instant, in ms.
 * @param {number} now - Now, in ms.
 * @param {string} language - The language.
 * @returns {string} The relative time.
 */
function ago(instant, now, language) {
  const minutes = Math.max(0, Math.floor((now - instant) / 60000));
  if (minutes < 1) {
    return t('ago_now', language);
  }
  if (minutes < 120) {
    return t('ago_minutes', language, { n: minutes });
  }
  return t('ago_hours', language, { n: Math.floor(minutes / 60) });
}

export { LANGUAGES, TEXTS, t, all, each, ago };
