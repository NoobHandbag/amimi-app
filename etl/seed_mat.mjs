// etl/seed_mat.mjs: seed UNA TANTUM del modulo mat_* (migr 0140) dai CSV del brief Cowork del 17-09
// e dagli allegati fornitori estratti da Gmail il 22-09 (Cowork12/_CLAUDE_CODE_INBOX/mat_assets + INDEX.csv).
//
//   node etl/seed_mat.mjs                       -> DRY-RUN: stampa il piano (conteggi, righe, asset), non scrive nulla
//   node etl/seed_mat.mjs --apply               -> scrive (service_role) e carica gli asset nel bucket mat-assets
//   node etl/seed_mat.mjs --apply --inbox <dir> -> cartella diversa da quella di default
//
// Canale di scrittura dichiarato del modulo in Fase 1 (brief catalogo §4.5): service_role letta a runtime dalla
// Management API con SUPABASE_ACCESS_TOKEN (come workers/lead/lib.mjs), audit in mat_events, chi='Claude Code'.
// Idempotente: ogni entita' e' cercata per chiave naturale (le stesse dell'UNIQUE a DB, Regola 20) e inserita solo se
// manca; un 23505 (corsa persa) viene trattato come "gia' presente". Rilanciare = 0 righe nuove.
// Regola 1: prezzo numerico SOLO da un valore singolo e certo; range/scaglioni restano in prezzo_text; n/d = NULL.
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';

const PROJECT_REF = 'imszbjeyplaiovylhkgl';
const SUPABASE_URL = `https://${PROJECT_REF}.supabase.co`;
const BUCKET = 'mat-assets';
const CHI = 'Claude Code';
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const INBOX = args.includes('--inbox') ? args[args.indexOf('--inbox') + 1] : 'C:/Users/super/dev/gestionale-ami/Cowork12/_CLAUDE_CODE_INBOX';

// ---------------------------------------------------------------------------
// CSV (RFC 4180 minimo: virgolette, virgole e a-capo dentro le virgolette)
// ---------------------------------------------------------------------------
function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  const s = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  const head = rows.shift().map((h) => h.trim());
  return rows.filter((r) => r.some((v) => v.trim() !== '')).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
}
const nz = (v) => (v === '' || v == null || /^n\/d$/i.test(v) ? null : v);
const numIt = (v) => { const t = nz(v); if (t == null) return null; const m = String(t).replace(/\./g, '').replace(',', '.'); return /^-?\d+(\.\d+)?$/.test(m) ? Number(m) : null; };
const numEn = (v) => { const t = nz(v); if (t == null) return null; return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null; };
// "11/06/2026" -> 2026-06-11; "07-08/09/2026" (intervallo) -> primo giorno; altro -> null
const dateIt = (v) => { const t = nz(v); if (!t) return null; const m = t.match(/^(\d{1,2})(?:-\d{1,2})?\/(\d{1,2})\/(\d{4})$/); return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null; };
// prezzo: numero singolo ("24,00", "0,656 (sconto 3%)" -> 0.656 + sconto) oppure testo fedele
function prezzo(v) {
  const t = nz(v); if (t == null) return { prezzo: null, prezzo_text: null, sconto_text: null };
  const m = t.match(/^(\d+(?:[.,]\d+)?)\s*(?:\(sconto ([^)]+)\))?$/);
  if (m) return { prezzo: Number(m[1].replace(',', '.')), prezzo_text: null, sconto_text: m[2] ? `sconto ${m[2]}` : null };
  return { prezzo: null, prezzo_text: t, sconto_text: null };
}
const unita = (v) => { const t = nz(v); return t && ['mq', 'ml', 'mt', 'pz'].includes(t.toLowerCase()) ? t.toLowerCase() : null; };
const slug = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const MIME = { '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.odt': 'application/vnd.oasis.opendocument.text' };

// ---------------------------------------------------------------------------
// Testate ordine: totali VERIFICATI (brief Cowork §5; il 22-09 riletti dai PDF per Vicenza Pelli, Angelo Valera,
// MLM Mazzola e Albert Guegain; Fada e Alpaca restano sui numeri del brief perche' i documenti non sono nella casella).
// Chiave: fornitore + numero_documento come compare nel CSV (Angelo Valera: numero preso dal PDF "197 FATTURA PROFORMA").
// ---------------------------------------------------------------------------
const ORDINI = {
  'Fada Tessuti|Fattura 386/F': { numero: 'Fattura 386/F', tipo: 'fattura', imp: 120.00, iva: 26.40, tot: 146.40, verifica: 'brief Cowork 17-09 (PDF non in casella)' },
  'MLM Mazzola|Fattura Proforma 150/2026': { numero: 'Fattura Proforma 150/2026', tipo: 'fattura_proforma', imp: 60.00, iva: 13.20, tot: 73.20, verifica: 'PDF PF 150 del 11-09-2026' },
  'Vicenza Pelli|Fattura Proforma 496 (PO 1916)': { numero: 'Fattura Proforma 496 (PO 1916)', tipo: 'fattura_proforma', imp: 815.10, iva: 179.32, tot: 994.42, verifica: 'PDF FP 496 del 09-07-2026' },
  'Albert Guegain|Proforma OD7 5020': { numero: 'Proforma OD7 5020', tipo: 'fattura_proforma', imp: 2833.20, iva: 0, tot: 2833.20, verifica: 'PDF proforma del 16-07-2026 (4 articoli, IVA 0 intra-UE)' },
  'Angelo Valera|Fattura proforma (n. da fattura)': { numero: 'Proforma 197', tipo: 'fattura_proforma', imp: 279.98, iva: 61.60, tot: 341.58, verifica: 'PDF 197 FATTURA PROFORMA del 10-09-2026' },
  'Alpaca|Fattura Proforma 2': { numero: 'Fattura Proforma 2', tipo: 'fattura_proforma', imp: 660.80, iva: 145.38, tot: 806.18, verifica: 'brief Cowork 17-09 (PDF non in casella)' },
};
const SOMMA_IMPONIBILI_ATTESA = 4769.08;

// Asset: file in mat_assets/ -> aggancio (materiale+colore = item; materiale = tutti i colori; ordine = proforma; niente = fornitore)
const ASSET_MAP = {
  'Ego_Vernice_scheda_tecnica.pdf': { forn: 'Ego', materiale: 'Vernice', tipo: 'scheda_tecnica', titolo: 'Scheda tecnica VERNICE 25' },
  'Damapel_Crushed_su_vitello_scheda_tecnica.odt': { forn: 'Damapel', materiale: 'Art Crushed su vitello', tipo: 'scheda_tecnica', titolo: 'Crushed data sheet (odt)' },
  'Damapel_Cavallino_animalier_LEO_scheda_tecnica.odt': { forn: 'Damapel', materiale: 'Cavallino animalier su capra (art. LEO)', tipo: 'scheda_tecnica', titolo: 'Scheda tecnica capra pelo art. LEO (odt)' },
  'Damapel_Cocco_stampato_nero_foto.jpeg': { forn: 'Damapel', materiale: 'Cocco stampato lucido tipo fotografie', colore: 'Nero', tipo: 'foto', titolo: 'Cocco nero in stock (foto Damapel 10-09)' },
  'VicenzaPelli_Horsy_scheda_tecnica.pdf': { forn: 'Vicenza Pelli', tipo: 'scheda_tecnica', titolo: 'Scheda tecnica Horsy (tutte le stampe su mezze pelli bovine)' },
  'VicenzaPelli_Manuale_ispezione_hair_on.pdf': { forn: 'Vicenza Pelli', tipo: 'documento', titolo: 'Manuale ispezione hair-on leather' },
  'VicenzaPelli_Politica_RSL.pdf': { forn: 'Vicenza Pelli', tipo: 'documento', titolo: 'Politica RSL Conceria San Biagio' },
  'VicenzaPelli_Mucca_zigrinata_tmoro_foto_catalogo.png': { forn: 'Vicenza Pelli', materiale: 'Mucca Zigrinata (Horsy 9017 White)', colore: 'T.Moro (Dark Brown)', tipo: 'foto', titolo: 'Mucca Zigrinata, immagine catalogo Vicenza Pelli' },
  'VicenzaPelli_Mucca_grande_black_foto_catalogo.png': { forn: 'Vicenza Pelli', materiale: 'Mucca Grande (Horsy 9017 White)', tipo: 'foto', titolo: 'Mucca Grande Black, immagine catalogo (ordine del 09-09, non ancora nel Notion)' },
  'VicenzaPelli_proforma_FP496_2026-07-09.pdf': { forn: 'Vicenza Pelli', ordine: 'Fattura Proforma 496 (PO 1916)', tipo: 'proforma', titolo: 'Proforma FP 496 del 09-07-2026' },
  'AngeloValera_proforma_197_2026-09-10.pdf': { forn: 'Angelo Valera', ordine: 'Proforma 197', tipo: 'proforma', titolo: 'Proforma 197 del 10-09-2026' },
  'MLMMazzola_proforma_PF150_2026-09-11.pdf': { forn: 'MLM Mazzola', ordine: 'Fattura Proforma 150/2026', tipo: 'proforma', titolo: 'Proforma PF 150 del 11-09-2026 (solo bottoni)' },
  'AlbertGuegain_proforma_2026-07-16.pdf': { forn: 'Albert Guegain', ordine: 'Proforma OD7 5020', tipo: 'proforma', titolo: 'Proforma del 16-07-2026 (versione definitiva, 4 articoli)' },
  'AlbertGuegain_proforma_2026-07-10.pdf': { forn: 'Albert Guegain', ordine: 'Proforma OD7 5020', tipo: 'proforma', titolo: 'Proforma del 10-07-2026 (prima versione, 9 articoli, sostituita)' },
};
for (let n = 1; n <= 9; n++) ASSET_MAP[`VicenzaPelli_Cerbiatto_castagno_foto_${n}.jpg`] = { forn: 'Vicenza Pelli', materiale: 'Cerbiatto (Horsy 9017 White)', colore: 'Castagno', tipo: 'foto', titolo: `Cerbiatto castagno, foto ${n} di 9 (Vicenza Pelli, 11-06)` };

// ---------------------------------------------------------------------------
// Piano (dal CSV)
// ---------------------------------------------------------------------------
const fornRows = parseCsv(readFileSync(join(INBOX, 'seed_fornitori.csv'), 'utf8'));
const matRows = parseCsv(readFileSync(join(INBOX, 'seed_materiali_flat.csv'), 'utf8'));
const idxRows = existsSync(join(INBOX, 'mat_assets', 'INDEX.csv')) ? parseCsv(readFileSync(join(INBOX, 'mat_assets', 'INDEX.csv'), 'utf8')) : [];

const suppliers = fornRows.map((r) => ({
  nome: r.nome, ragione_sociale: nz(r.ragione_sociale), categoria_principale: nz(r.categoria_principale), email: nz(r.email), telefono: nz(r.telefono),
  referente: nz(r.referente), indirizzo: nz(r.indirizzo), piva_vat: nz(r.piva_vat), note: nz(r.note),
  deposito_luogo: nz(matRows.find((m) => m.fornitore === r.nome && nz(m.deposito_luogo))?.deposito_luogo),
  condizioni_pagamento: nz(matRows.find((m) => m.fornitore === r.nome && nz(m.condizioni_pagamento))?.condizioni_pagamento),
  attivo: !/da verificare/i.test(r.ragione_sociale || ''), chi: CHI,
}));
const itemKey = (f, m, c) => `${f}|${m.toLowerCase()}|${(c ?? '').toLowerCase()}`;
const items = new Map();
for (const r of matRows) {
  const k = itemKey(r.fornitore, r.materiale, nz(r.colore));
  if (!items.has(k)) items.set(k, { fornitore: r.fornitore, categoria: r.categoria, materiale: r.materiale, colore: nz(r.colore), unita: unita(r.unita), chi: CHI });
}
const offers = matRows.filter((r) => r.tipo === 'Offerta').map((r) => {
  const p = prezzo(r.prezzo_text);
  return { key: itemKey(r.fornitore, r.materiale, nz(r.colore)), tipo: /listino/i.test(r.numero_documento) ? 'listino' : 'offerta', prezzo: p.prezzo, prezzo_text: p.prezzo_text,
    unita: unita(r.unita), disponibilita: nz(r.disponibilita_offerta), data: dateIt(r.data), documento_fonte: nz(r.numero_documento), note: nz(r.note), chi: CHI };
});
const orders = new Map();
const lines = [];
for (const r of matRows.filter((x) => x.tipo === 'Acquistato')) {
  const ok = `${r.fornitore}|${r.numero_documento}`;
  const spec = ORDINI[ok];
  if (!spec) throw new Error(`STOP: testata non prevista: ${ok}`);
  if (!orders.has(ok)) orders.set(ok, { fornitore: r.fornitore, tipo_documento: spec.tipo, numero_documento: spec.numero, data_documento: dateIt(r.data), totale_imponibile: spec.imp, totale_iva: spec.iva, totale_documento: spec.tot,
    condizioni_pagamento: nz(r.condizioni_pagamento), deposito_luogo: nz(r.deposito_luogo), stato: 'ordinato', note: `Totali: ${spec.verifica}. Stato non tracciato in Fase 1.`, chi: CHI });
  const p = prezzo(r.prezzo_text);
  lines.push({ okey: ok, key: itemKey(r.fornitore, r.materiale, nz(r.colore)), quantita: numEn(r.quantita_acquistata), unita: unita(r.unita), prezzo_unitario: p.prezzo, sconto_text: p.sconto_text,
    importo: numEn(r.importo_riga), iva_percent: spec.iva > 0 ? 22 : 0, note: [nz(r.note), p.prezzo_text ? `prezzo: ${p.prezzo_text}` : null].filter(Boolean).join('. ') || null });
}
const assets = idxRows.map((r) => {
  const m = ASSET_MAP[r.file];
  if (!m) throw new Error(`STOP: file in INDEX.csv senza aggancio in ASSET_MAP: ${r.file}`);
  return { file: r.file, ...m, mime: MIME[extname(r.file).toLowerCase()] ?? 'application/octet-stream', bytes: Number(r.bytes) || null,
    fonte: `${r.mittente} · ${r.email_data} · ${r.oggetto} · gmail ${r.message_id} · file originale ${r.nome_originale}`, path: `${slug(m.forn)}/${r.file}` };
});

const sommaRighe = Math.round(lines.reduce((s, l) => s + (l.importo ?? 0), 0) * 100) / 100;
const sommaTestate = Math.round([...orders.values()].reduce((s, o) => s + o.totale_imponibile, 0) * 100) / 100;
console.log(`PIANO: ${suppliers.length} fornitori, ${items.size} materiali+colore, ${offers.length} offerte, ${orders.size} testate, ${lines.length} righe acquisto, ${assets.length} asset`);
console.log(`  somma imponibili righe ${sommaRighe.toFixed(2)} | testate ${sommaTestate.toFixed(2)} | attesa ${SOMMA_IMPONIBILI_ATTESA.toFixed(2)}`);
if (sommaRighe !== SOMMA_IMPONIBILI_ATTESA || sommaTestate !== SOMMA_IMPONIBILI_ATTESA) { console.error('STOP: le somme non tornano con il brief Cowork §5'); process.exit(2); }
for (const a of assets) if (!existsSync(join(INBOX, 'mat_assets', a.file))) { console.error(`STOP: manca il file ${a.file}`); process.exit(2); }
if (!APPLY) {
  for (const s of suppliers) console.log(`  forn  ${s.nome}${s.attivo ? '' : ' (non attivo)'}  ${s.email ?? '-'}  ${s.deposito_luogo ?? ''}`);
  for (const [k, i] of items) console.log(`  item  ${i.categoria.padEnd(18)} ${i.fornitore.padEnd(15)} ${i.materiale} / ${i.colore ?? '-'} [${i.unita ?? '-'}]`);
  for (const o of offers) console.log(`  off   ${o.key.padEnd(70)} ${o.prezzo ?? o.prezzo_text} ${o.data ?? ''}`);
  for (const [k, o] of orders) console.log(`  ord   ${o.fornitore.padEnd(15)} ${o.numero_documento.padEnd(32)} ${o.data_documento} imp ${o.totale_imponibile}`);
  for (const l of lines) console.log(`  riga  ${l.key.padEnd(70)} q ${l.quantita} ${l.unita ?? ''} x ${l.prezzo_unitario} = ${l.importo}`);
  for (const a of assets) console.log(`  asset ${a.tipo.padEnd(14)} ${a.path}`);
  console.log('\nDRY-RUN: nessuna scrittura. Rilancia con --apply per scrivere.');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// APPLY
// ---------------------------------------------------------------------------
async function serviceKey() {
  const tok = (process.env.SUPABASE_ACCESS_TOKEN || '').trim();
  if (!tok) throw new Error('STOP: manca SUPABASE_ACCESS_TOKEN (variabile utente Windows, la stessa della CLI).');
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${tok}` } });
  if (!r.ok) throw new Error(`Management API ${r.status}: impossibile leggere le chiavi`);
  const k = (await r.json()).find((x) => x.name === 'service_role')?.api_key;
  if (!k) throw new Error('service_role non trovata fra le api keys');
  return k;
}
const sb = createClient(SUPABASE_URL, await serviceKey(), { auth: { persistSession: false } });
const stat = { nuovi: {}, esistenti: {} };
const conta = (t, nuovo) => { const b = nuovo ? stat.nuovi : stat.esistenti; b[t] = (b[t] ?? 0) + 1; };
// Regola 20a: ogni lettura con error destrutturato; su errore ci si ferma, mai un default vuoto.
async function findOrInsert(table, find, row) {
  const q = sb.from(table).select('id');
  for (const [col, op, val] of find) q.filter(col, op, val);
  const { data: found, error: e1 } = await q.limit(1);
  if (e1) throw new Error(`lettura ${table}: ${e1.message}`);
  if (found?.length) { conta(table, false); return found[0].id; }
  const { data: ins, error: e2 } = await sb.from(table).insert(row).select('id').single();
  if (e2 && e2.code === '23505') {          // corsa persa: e' gia' dentro, rileggo
    const { data: again, error: e3 } = await q.limit(1);
    if (e3 || !again?.length) throw new Error(`rilettura ${table}: ${e3?.message ?? 'vuota'}`);
    conta(table, false); return again[0].id;
  }
  if (e2) throw new Error(`insert ${table}: ${e2.message}`);
  conta(table, true); return ins.id;
}
const supId = new Map();
for (const s of suppliers) supId.set(s.nome, await findOrInsert('mat_suppliers', [['nome', 'ilike', s.nome]], s));
const itemId = new Map();
for (const [k, i] of items) {
  const sid = supId.get(i.fornitore); if (!sid) throw new Error(`fornitore senza anagrafica: ${i.fornitore}`);
  const find = [['supplier_id', 'eq', sid], ['materiale', 'ilike', i.materiale]];
  find.push(i.colore ? ['colore', 'ilike', i.colore] : ['colore', 'is', null]);
  itemId.set(k, await findOrInsert('mat_items', find, { supplier_id: sid, categoria: i.categoria, materiale: i.materiale, colore: i.colore, unita: i.unita, chi: CHI }));
}
for (const o of offers) {
  const iid = itemId.get(o.key);
  const find = [['item_id', 'eq', iid], o.data ? ['data', 'eq', o.data] : ['data', 'is', null], o.documento_fonte ? ['documento_fonte', 'ilike', o.documento_fonte] : ['documento_fonte', 'is', null]];
  const { key, ...row } = o;
  await findOrInsert('mat_offers', find, { item_id: iid, ...row });
}
const orderId = new Map();
for (const [k, o] of orders) {
  const sid = supId.get(o.fornitore);
  const { fornitore, ...row } = o;
  orderId.set(k, await findOrInsert('mat_orders', [['supplier_id', 'eq', sid], ['numero_documento', 'ilike', o.numero_documento]], { supplier_id: sid, ...row }));
}
for (const l of lines) {
  const oid = orderId.get(l.okey), iid = itemId.get(l.key);
  const { okey, key, ...row } = l;
  await findOrInsert('mat_order_lines', [['order_id', 'eq', oid], ['item_id', 'eq', iid]], { order_id: oid, item_id: iid, ...row });
}
const byNumero = new Map([...orders.entries()].map(([k, o]) => [`${o.fornitore}|${o.numero_documento}`, orderId.get(k)]));
for (const a of assets) {
  const sid = supId.get(a.forn); if (!sid) throw new Error(`asset senza fornitore: ${a.file}`);
  const iid = a.materiale && a.colore ? itemId.get(itemKey(a.forn, a.materiale, a.colore)) : null;
  if (a.materiale && a.colore && !iid) throw new Error(`asset ${a.file}: item non trovato (${a.materiale} / ${a.colore})`);
  const oid = a.ordine ? byNumero.get(`${a.forn}|${a.ordine}`) : null;
  if (a.ordine && !oid) throw new Error(`asset ${a.file}: ordine non trovato (${a.ordine})`);
  const { error: eu } = await sb.storage.from(BUCKET).upload(a.path, readFileSync(join(INBOX, 'mat_assets', a.file)), { contentType: a.mime, upsert: true });
  if (eu) throw new Error(`upload ${a.path}: ${eu.message}`);
  await findOrInsert('mat_assets', [['path', 'eq', a.path]], { supplier_id: sid, item_id: iid, materiale: iid ? null : (a.materiale ?? null), order_id: oid, path: a.path, tipo: a.tipo, titolo: a.titolo, mime: a.mime, bytes: a.bytes, fonte: a.fonte, chi: CHI });
}

// Verifica finale (letture controllate) e audit
const count = async (t) => { const { count: n, error } = await sb.from(t).select('*', { count: 'exact', head: true }); if (error) throw new Error(`count ${t}: ${error.message}`); return n; };
const finale = {};
for (const t of ['mat_suppliers', 'mat_items', 'mat_offers', 'mat_orders', 'mat_order_lines', 'mat_assets']) finale[t] = await count(t);
const { data: somme, error: es } = await sb.from('mat_order_lines').select('importo');
if (es) throw new Error(`somma righe: ${es.message}`);
finale.somma_imponibili_righe = Math.round(somme.reduce((s, r) => s + Number(r.importo ?? 0), 0) * 100) / 100;
const { error: ev } = await sb.from('mat_events').insert({ chi: CHI, azione: 'seed', tabella: 'mat_*', after: { nuovi: stat.nuovi, esistenti: stat.esistenti, finale }, note: `seed_mat.mjs --apply da ${INBOX}` });
if (ev) throw new Error(`audit mat_events: ${ev.message}`);
console.log('NUOVI    ', JSON.stringify(stat.nuovi));
console.log('ESISTENTI', JSON.stringify(stat.esistenti));
console.log('FINALE   ', JSON.stringify(finale));
if (finale.somma_imponibili_righe !== SOMMA_IMPONIBILI_ATTESA) { console.error('ATTENZIONE: somma imponibili a DB diversa dall\'attesa'); process.exit(3); }
