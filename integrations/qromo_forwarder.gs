/**
 * qromo_forwarder.gs — ponte Qromo (Foglio) -> app Amimì (Supabase).
 *
 * NON modifica SyncImportToDBQromo. È una funzione INDIPENDENTE: legge DB_QROMO per intestazione,
 * inoltra le righe nuove a write-api (azione 'qromo_sale'). L'app deduplica per sale_id, quindi
 * re-inviare è innocuo; un watermark su Script Properties evita di ri-mandare tutto ogni volta.
 *
 * INSTALLAZIONE (Claude Code, dopo OK di Alessandro):
 *  1. clasp push di questo file nel progetto Apps Script Operations (1w67…).
 *  2. Crea un trigger a tempo: forwardQromoSalesToApp_ ogni ora (dopo SyncImportToDBQromo),
 *     oppure chiamala in coda a SyncImportToDBQromo.
 *  3. Niente da ri-puntare su Qromo: il webhook resta com'è; il Foglio continua a funzionare.
 *
 * Sicurezza: write-api è PIN-gated (pin 'x', posture rilassata). Nessun segreto qui.
 */
var QROMO_FWD = {
  MASTER_ID: '1zYXsXuWZb-bBrh8K-4O9V44uqsuPF014gFfdmmC-xhg',
  TAB: 'DB_QROMO',
  WRITE_API: 'https://imszbjeyplaiovylhkgl.supabase.co/functions/v1/write-api',
  ANON: 'sb_publishable_DP66FFObEGagJknhGOz8xw_8KO8WIgD',
  PIN: 'x',
  PROP_LAST_ROW: 'qromo_fwd_last_row' // watermark: ultima riga (1-based) già inoltrata
};

/** mappa header DB_QROMO -> campo payload. Match case-insensitive "contiene". */
function qfwdHeaderMap_(headers) {
  var want = {
    sale_id: ['sale_id', 'saleid', 'id_vendita', 'sale id'],
    order_id: ['order_id', 'orderid', 'order id'],
    data: ['data', 'date'],
    codice: ['codice_amiimi', 'codice', 'codice amiimi'],
    item: ['item', 'modello', 'prodotto'],
    variant: ['variant', 'variante'],
    quantita: ['quantita', 'qta', 'qty', 'quantità'],
    prezzo: ['prezzo', 'price', 'importo', 'paid'],
    nome: ['nome', 'name'],
    cognome: ['cognome', 'surname'],
    payment_method: ['payment', 'pagamento', 'metodo'],
    resolver_status: ['resolver', 'status', 'stato']
  };
  var idx = {};
  for (var field in want) {
    for (var c = 0; c < headers.length; c++) {
      var h = String(headers[c] || '').trim().toLowerCase();
      if (want[field].some(function (k) { return h.indexOf(k) !== -1; })) { idx[field] = c; break; }
    }
  }
  return idx;
}

function forwardQromoSalesToApp_() {
  var sh = SpreadsheetApp.openById(QROMO_FWD.MASTER_ID).getSheetByName(QROMO_FWD.TAB);
  if (!sh) { Logger.log('DB_QROMO non trovato'); return; }
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return;
  var idx = qfwdHeaderMap_(values[0]);
  if (idx.codice == null || idx.quantita == null) { Logger.log('header codice/quantita non mappati'); return; }

  var props = PropertiesService.getScriptProperties();
  var lastRow = Number(props.getProperty(QROMO_FWD.PROP_LAST_ROW) || 1); // 1 = solo header inoltrato
  var startRow = Math.max(lastRow, 1);

  var sent = 0, skipped = 0, errors = 0, maxRow = startRow;
  for (var r = startRow; r < values.length; r++) { // r è 0-based nell'array; riga foglio = r+1
    var row = values[r];
    var codice = String(row[idx.codice] || '').trim();
    var qty = Number(row[idx.quantita]);
    if (!codice || !(qty > 0)) { maxRow = r + 1; continue; }

    var payload = {
      sale_id: idx.sale_id != null ? String(row[idx.sale_id] || '') : ('row_' + (r + 1)),
      order_id: idx.order_id != null ? String(row[idx.order_id] || '') : null,
      data: idx.data != null ? qfwdDate_(row[idx.data]) : null,
      codice: codice,
      item: idx.item != null ? row[idx.item] : null,
      variant: idx.variant != null ? row[idx.variant] : null,
      quantita: qty,
      prezzo: idx.prezzo != null ? Number(row[idx.prezzo]) || null : null,
      nome: idx.nome != null ? row[idx.nome] : null,
      cognome: idx.cognome != null ? row[idx.cognome] : null,
      payment_method: idx.payment_method != null ? row[idx.payment_method] : null,
      resolver_status: idx.resolver_status != null ? row[idx.resolver_status] : null
    };
    try {
      var res = UrlFetchApp.fetch(QROMO_FWD.WRITE_API, {
        method: 'post', contentType: 'application/json', muteHttpExceptions: true,
        headers: { apikey: QROMO_FWD.ANON, authorization: 'Bearer ' + QROMO_FWD.ANON },
        payload: JSON.stringify({ action: 'qromo_sale', payload: payload, pin: QROMO_FWD.PIN, chi: 'qromo-forward' })
      });
      var body = JSON.parse(res.getContentText() || '{}');
      if (res.getResponseCode() === 200 && body.skipped) skipped++;
      else if (res.getResponseCode() === 200) sent++;
      else errors++;
    } catch (e) { errors++; }
    maxRow = r + 1;
  }
  props.setProperty(QROMO_FWD.PROP_LAST_ROW, String(maxRow));
  Logger.log('Qromo->app: inviati=' + sent + ' skip=' + skipped + ' errori=' + errors + ' (fino a riga ' + maxRow + ')');
}

/** normalizza una data (Date o stringa) in YYYY-MM-DD per l'app */
function qfwdDate_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, 'Europe/Rome', 'yyyy-MM-dd');
  var s = String(v || '').trim();
  return s ? s.slice(0, 10) : null;
}

/** Reset watermark se serve re-inoltrare tutto (l'app dedup-a comunque per sale_id). */
function resetQromoForwardWatermark_() {
  PropertiesService.getScriptProperties().deleteProperty(QROMO_FWD.PROP_LAST_ROW);
}
