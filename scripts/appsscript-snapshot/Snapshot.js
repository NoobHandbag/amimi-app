// Amimi App Snapshot — snapshot GIORNALIERO del DB Supabase (amimi-app) su Google Drive.
// Un Google Sheet datato al giorno (una tab per tabella + tab RIEPILOGO) nella cartella
// "Amimi App Snapshots" di info@amimi.it. Lettura via chiave PUBBLICA read-only (nessun segreto).
// Complementare al backup JSON su GitHub Actions (db-backup.yml, artifact 90gg, per il restore):
// questo e' lo snapshot SFOGLIABILE, ospitato su Drive. Retention: 30 giorni, poi nel cestino.
// In caso di errore: mail a info@amimi.it. Setup una tantum: eseguire setup().

const SB_URL = 'https://imszbjeyplaiovylhkgl.supabase.co';
const SB_KEY = 'sb_publishable_DP66FFObEGagJknhGOz8xw_8KO8WIgD'; // publishable, sola lettura by-grant
const FOLDER_NAME = 'Amimi App Snapshots';
const RETENTION_DAYS = 30;
const MAX_ROWS = 20000; // cap per tabella (change_log crescera'): teniamo le piu' recenti
const ALERT_TO = 'info@amimi.it';
const PAGE = 1000;

// Stesse tabelle del backup GitHub + viste utili alla lettura umana.
const SOURCES = [
  'products', 'product_aliases', 'suppliers', 'negozi', 'purchases', 'qromo_sales',
  'shopify_orders', 'shopify_line_items', 'gifts_offline', 'b2b_movements', 'expenses',
  'meta_ads_daily', 'counts', 'returns', 'stock_adjustments', 'supplier_orders',
  'shopify_stock', 'change_log', 'ce_totale_monthly', 'ce_totale_manual', 'health_log',
  'v_inventory', 'v_ce_amimi_summary', 'v_ce_totale',
];
// shopify_orders: escludiamo la colonna raw (payload JSON enorme, gia' nel backup GitHub)
const SELECT = {
  shopify_orders: 'id,order_id,order_number,created_at_shop,customer_name,email,financial_status,fulfillment_status,gross_total,net_total,discount_total,shipping_total,payment_fees,refund_amount,free_shipping,currency,year,month,synced_at,vendor,free_shipping_amt,fulfilled_at,discount_codes',
};
// ordinamento per paginazione stabile; il default 'id' non esiste ovunque
const ORDER = {
  change_log: 'ts.desc', health_log: 'day.desc',
  shopify_stock: 'codice', ce_totale_monthly: 'year,month', ce_totale_manual: 'year,month',
  v_inventory: 'codice', v_ce_amimi_summary: 'year.desc,month.desc', v_ce_totale: 'year.desc,month.desc',
};

function snapshotDaily() {
  try {
    ensureTrigger_(); // auto-installante: se il trigger giornaliero manca, lo crea (self-healing)
    run_();
  } catch (e) {
    MailApp.sendEmail(ALERT_TO, '[Amimi] Snapshot Drive FALLITO ' + new Date().toISOString().slice(0, 10),
      'Lo snapshot giornaliero su Drive e\' fallito:\n\n' + (e && e.stack ? e.stack : String(e)) +
      '\n\nRiprova manuale: apri lo script "Amimi App Snapshot Drive" ed esegui snapshotDaily().');
    throw e;
  }
}

function run_() {
  const day = Utilities.formatDate(new Date(), 'Europe/Rome', 'yyyy-MM-dd');
  const folder = getFolder_();
  // idempotente: se il file di oggi esiste gia' (rilancio manuale), lo rimpiazza
  const dup = folder.getFilesByName('Amimi_App_Snapshot_' + day);
  while (dup.hasNext()) dup.next().setTrashed(true);

  const ss = SpreadsheetApp.create('Amimi_App_Snapshot_' + day);
  const summary = [['tabella', 'righe', 'note']];

  for (let i = 0; i < SOURCES.length; i++) {
    const t = SOURCES[i];
    try {
      const rows = fetchAll_(t);
      writeSheet_(ss, t, rows);
      summary.push([t, rows.length, rows.length >= MAX_ROWS ? 'CAP ' + MAX_ROWS + ' (piu recenti)' : '']);
    } catch (e) {
      summary.push([t, -1, 'ERRORE: ' + String(e).slice(0, 300)]);
    }
  }

  // tab RIEPILOGO in prima posizione
  const sh = ss.insertSheet('RIEPILOGO', 0);
  sh.getRange(1, 1, summary.length, 3).setValues(summary);
  sh.getRange(1, 1, 1, 3).setFontWeight('bold');
  const def = ss.getSheetByName('Sheet1') || ss.getSheetByName('Foglio1');
  if (def) ss.deleteSheet(def);

  // sposta nella cartella e applica la retention
  DriveApp.getFileById(ss.getId()).moveTo(folder);
  cleanupOld_(folder, day);

  // se qualche tabella e' fallita, avvisa comunque (lo snapshot parziale resta su Drive)
  const failed = summary.filter(function (r) { return r[1] === -1; });
  if (failed.length) {
    MailApp.sendEmail(ALERT_TO, '[Amimi] Snapshot Drive PARZIALE ' + day,
      'Snapshot creato ma ' + failed.length + ' tabelle sono fallite:\n' +
      failed.map(function (r) { return r[0] + ': ' + r[2]; }).join('\n') + '\n\n' + ss.getUrl());
  }
}

function fetchAll_(t) {
  const sel = SELECT[t] || '*';
  const order = ORDER[t] || 'id';
  const rows = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const r = UrlFetchApp.fetch(
      SB_URL + '/rest/v1/' + t + '?select=' + encodeURIComponent(sel) + '&order=' + encodeURIComponent(order),
      { headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, Range: from + '-' + (from + PAGE - 1) }, muteHttpExceptions: true }
    );
    if (r.getResponseCode() >= 300) {
      if (from === 0) throw new Error('HTTP ' + r.getResponseCode() + ' ' + r.getContentText().slice(0, 200));
      break;
    }
    const batch = JSON.parse(r.getContentText());
    for (let i = 0; i < batch.length; i++) rows.push(batch[i]);
    if (batch.length < PAGE) break;
  }
  return rows;
}

function writeSheet_(ss, name, rows) {
  const sh = ss.insertSheet(name.slice(0, 90));
  if (!rows.length) { sh.getRange(1, 1).setValue('(vuota)'); return; }
  const cols = Object.keys(rows[0]);
  const values = [cols];
  for (let i = 0; i < rows.length; i++) {
    const row = [];
    for (let c = 0; c < cols.length; c++) {
      let v = rows[i][cols[c]];
      if (v === null || v === undefined) v = '';
      else if (typeof v === 'object') v = JSON.stringify(v);
      if (typeof v === 'string' && v.length > 45000) v = v.slice(0, 45000) + '…[troncato]';
      row.push(v);
    }
    values.push(row);
  }
  // scrittura a blocchi (setValues su decine di migliaia di righe in un colpo puo' fallire)
  const CHUNK = 5000;
  for (let start = 0; start < values.length; start += CHUNK) {
    const block = values.slice(start, start + CHUNK);
    sh.getRange(start + 1, 1, block.length, cols.length).setValues(block);
  }
  sh.setFrozenRows(1);
}

function getFolder_() {
  const it = DriveApp.getFoldersByName(FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(FOLDER_NAME);
}

function cleanupOld_(folder, today) {
  const cutoff = new Date(new Date(today).getTime() - RETENTION_DAYS * 86400000);
  const files = folder.getFiles();
  while (files.hasNext()) {
    const f = files.next();
    const m = f.getName().match(/^Amimi_App_Snapshot_(\d{4}-\d{2}-\d{2})/);
    if (m && new Date(m[1]) < cutoff) f.setTrashed(true);
  }
}

// Trigger giornaliero (05:00-06:00 Roma, dopo il backup GitHub delle 03:17 UTC).
// Chiamata da snapshotDaily a ogni run: crea il trigger solo se manca (idempotente).
function ensureTrigger_() {
  const trg = ScriptApp.getProjectTriggers();
  for (let i = 0; i < trg.length; i++) {
    if (trg[i].getHandlerFunction() === 'snapshotDaily') return;
  }
  ScriptApp.newTrigger('snapshotDaily').timeBased().everyDays(1).atHour(5).create();
}

// Setup UNA TANTUM (equivalente a eseguire snapshotDaily: trigger + primo snapshot).
function setup() { snapshotDaily(); }

// Trigger manuale via HTTP (/exec?k=TOKEN): stesso effetto di snapshotDaily dal menu.
// Serve per il setup/rilanci senza passare dall'editor (UI instabile via automazione).
const RUN_TOKEN = 'snap-8f3e51c9a7d24b06';
function doGet(e) {
  const out = ContentService.createTextOutput().setMimeType(ContentService.MimeType.JSON);
  if (!e || !e.parameter || e.parameter.k !== RUN_TOKEN) return out.setContent(JSON.stringify({ ok: false, error: 'auth' }));
  try { snapshotDaily(); return out.setContent(JSON.stringify({ ok: true, triggers: ScriptApp.getProjectTriggers().length })); }
  catch (err) { return out.setContent(JSON.stringify({ ok: false, error: String(err).slice(0, 300) })); }
}
