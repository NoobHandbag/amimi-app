// mat-api v1 (2026-09-23, brief materie prime Fase 2): le SCRITTURE del modulo mat_* dalla PWA.
// Fotocopia della postura di cs-api: l'Authorization porta l'access token di un utente Supabase Auth reale
// (getUser lato server: la anon key NON e' un utente), l'email deve finire in @amimi.it, poi scrive un client
// service_role. `chi` = selettore persona (Benny/Ginni/Ale), come in cs-api: l'identita' che firma e' il selettore.
// Ogni scrittura lascia una riga in mat_events (before/after). Flag app_flags.mat_write_enabled (default OFF):
// a flag spento ogni azione risponde {state:'off'} e non scrive nulla (rollback della Regola 19).
//
// Azioni (idempotenti sulle chiavi naturali UNIQUE della 0140; 23505 = gia' presente, mai un doppione):
//   supplier_upsert  crea o aggiorna il fornitore per lower(nome)
//   item_upsert      UNA chiamata, N righe mat_items (una per colore, decisione D3); risposta con gli id
//   offer_add        offerta/listino su un item (per id o per fornitore+materiale+colore)
//   asset_add        registra in mat_assets un file GIA' caricato dal client sotto inbox/ (verifica che esista nel bucket)
//   item_set_attivo  attiva/disattiva un item (mai DELETE)
//   ai_scarta        la proposta dell'AI e' stata scartata dall'utente (solo il log, per misurare quanto aiuta)
//   order_add        Fase 3: firma prevista, risponde 501
// Ogni azione accetta `ai_log_id` (+ `ai_modificato`): a scrittura riuscita il log dell'AI passa a confermato/modificato.
//
// Regola 20: ogni lettura che decide cosa si scrive destruttura `error` e si ferma (503, mai un default vuoto);
// un solo retryOnce sulle letture, mai sulle scritture. Guardie di input come write-api: numeri validati, check
// della 0140 replicati qui (categoria, unita, tipo), stringhe troncate, colonne generate mai scritte.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const retryOnce = async <T extends { error: unknown }>(fn: () => PromiseLike<T>): Promise<T> => {
  const r = await fn();
  if (!r.error) return r;
  await sleep(1500);
  return await fn();
};
class ReadError extends Error {}

// ==== PURE:mat-api-guard BEGIN ====
// Validazione dell'input, pura e testata in tests/mat_guardie.mjs. Gli stessi check della migr 0140.
const CATEGORIE = ['Tessuto', 'Tessuto velluto', 'Animalier', 'Cocco', 'Vitello stampato', 'Pelle vitello', 'Vernice', 'Crosta/Velour', 'Nappa', 'Nastri', 'Accessori metallici'];
const UNITA = ['mq', 'ml', 'mt', 'pz'];
const TIPI_OFFERTA = ['offerta', 'listino'];
const TIPI_ASSET = ['foto', 'scheda_tecnica', 'proforma', 'documento', 'campione'];
const IDENT: Record<string, string> = { B: 'Benedetta', G: 'Ginevra', A: 'Ale' };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// stringa ripulita e troncata; vuota = null (mai '' a DB)
const str = (v: unknown, max = 200): string | null => { const t = String(v ?? '').replace(/\u0000/g, '').trim(); return t ? t.slice(0, max) : null; };
// numero da input umano ("48,44", "1.000,00", "1.000", 48.44); assente = null; non numerico = NaN (chi chiama rifiuta).
// "1.000" senza decimali e' un migliaio italiano, non 1: il punto seguito da esattamente 3 cifre e' un separatore.
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  let t = String(v).trim().replace(/\s|€|eur/gi, '');
  if (/,\d{1,4}$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  else t = t.replace(/,/g, '');
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
};
const chiDa = (v: unknown): string => { const t = str(v, 40) ?? ''; return IDENT[t.slice(0, 1).toUpperCase()] && t.length <= 10 ? IDENT[t.slice(0, 1).toUpperCase()] : (t || 'ignoto'); };
const dataOk = (v: unknown): string | null => { const t = str(v, 10); if (!t) return null; return DATE_RE.test(t) && !Number.isNaN(Date.parse(t)) ? t : 'INVALIDA'; };
// escape per ilike: `_` e `%` sono jolly (un fornitore "M_M" non deve trovare "MLM"); PostgREST traduce `*` in `%`, quindi via
const ilikeEsc = (t: string) => t.replace(/\*/g, '').replace(/[\\%_]/g, '\\$&');
const mimeDaNome = (n: string): string => /\.pdf$/i.test(n) ? 'application/pdf' : /\.png$/i.test(n) ? 'image/png' : /\.webp$/i.test(n) ? 'image/webp' : /\.hei[cf]$/i.test(n) ? 'image/heic' : /\.odt$/i.test(n) ? 'application/vnd.oasis.opendocument.text' : 'image/jpeg';
// ==== PURE:mat-api-guard END ====

type Row = Record<string, unknown>;

Deno.serve(async (req) => {
  try { return await handle(req); } catch (e) {
    if (e instanceof ReadError) return json({ error: e.message }, 503);
    throw e;
  }
});

async function handle(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const svc = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  // 1) autorizzazione: utente reale @amimi.it (postura cs-api)
  const authz = req.headers.get('Authorization') || '';
  const token = authz.toLowerCase().startsWith('bearer ') ? authz.slice(7).trim() : '';
  if (!token) return json({ error: 'non autenticato' }, 401);
  const { data: ures, error: uerr } = await createClient(url, anon).auth.getUser(token);
  if (uerr || !ures?.user) return json({ error: 'sessione non valida' }, 401);
  const email = (ures.user.email || '').toLowerCase();
  if (!email.endsWith('@amimi.it')) return json({ error: 'dominio non ammesso' }, 403);

  const body = await req.json().catch(() => ({})) as Row;
  const action = String(body.action || '');
  const chi = chiDa(body.chi);
  const sb = createClient(url, svc);

  // 2) flag del modulo: letto con errore controllato (Regola 20a); spento = nessuna scrittura
  const { data: fl, error: flErr } = await retryOnce(() => sb.from('app_flags').select('value').eq('key', 'mat_write_enabled').maybeSingle());
  if (flErr) throw new ReadError('flag non leggibile, riprova: ' + flErr.message);
  if (String(fl?.value ?? '').trim().toLowerCase() !== 'true') return json({ state: 'off', error: 'Scritture materie prime spente (app_flags.mat_write_enabled = false).' }, 403);

  const audit = async (azione: string, tabella: string | null, riga_id: string | null, before: unknown, after: unknown, note: string | null = null) => {
    const { error } = await sb.from('mat_events').insert({ chi, azione, tabella, riga_id, before, after, note: note ?? `by ${email}` });
    if (error) console.error('mat_events non scritto:', error.message);   // l'audit non fa fallire una scrittura gia' riuscita
  };
  // esito umano sul log dell'AI: passa da 'proposta' a confermato/modificato UNA volta sola
  const esitoAi = async (esito: 'confermato' | 'modificato' | 'scartato', ref_tabella: string | null, ref_id: string | null) => {
    const id = str(body.ai_log_id, 40);
    if (!id || !UUID_RE.test(id)) return;
    const { error } = await sb.from('ai_compila_log').update({ esito, ref_tabella, ref_id, esito_at: new Date().toISOString() }).eq('id', id).eq('esito', 'proposta');
    if (error) console.error('ai_compila_log non aggiornato:', error.message);
  };
  const esitoScrittura = body.ai_modificato === true ? 'modificato' : 'confermato';

  // fornitore per id o per nome (esatto, case-insensitive); null = non trovato
  const trovaFornitore = async (ref: unknown): Promise<{ id: string; nome: string } | null> => {
    const t = str(ref, 120);
    if (!t) return null;
    const q = UUID_RE.test(t) ? sb.from('mat_suppliers').select('id,nome').eq('id', t).maybeSingle() : sb.from('mat_suppliers').select('id,nome').ilike('nome', ilikeEsc(t)).maybeSingle();
    const { data, error } = await retryOnce(() => q);
    if (error) throw new ReadError('lettura fornitore fallita, riprova: ' + error.message);
    return (data as { id: string; nome: string } | null) ?? null;
  };

  // ------------------------------------------------------------------------------------ supplier_upsert
  if (action === 'supplier_upsert') {
    const nome = str(body.nome, 120);
    if (!nome) return json({ error: 'nome obbligatorio' }, 422);
    const campi: Row = {};
    for (const k of ['ragione_sociale', 'categoria_principale', 'email', 'telefono', 'referente', 'indirizzo', 'piva_vat', 'deposito_luogo', 'condizioni_pagamento', 'note']) {
      if (k in body) campi[k] = str(body[k], k === 'note' || k === 'indirizzo' ? 1000 : 200);
    }
    if (campi.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+(\s*[;,]\s*[^\s@]+@[^\s@]+\.[^\s@]+)*$/.test(String(campi.email))) return json({ error: 'email non valida' }, 422);
    const ex = await trovaFornitore(nome);
    if (ex) {
      const { data: before, error: bErr } = await retryOnce(() => sb.from('mat_suppliers').select('*').eq('id', ex.id).single());
      if (bErr) throw new ReadError('lettura fornitore fallita, riprova: ' + bErr.message);
      // aggiorna SOLO i campi mandati e non vuoti: un form parziale non cancella dati esistenti
      const upd: Row = {};
      for (const [k, v] of Object.entries(campi)) if (v !== null) upd[k] = v;
      if (Object.keys(upd).length) {
        const { data: after, error } = await sb.from('mat_suppliers').update({ ...upd, chi }).eq('id', ex.id).select('*').single();
        if (error) return json({ error: 'aggiornamento fallito: ' + error.message }, 500);
        await audit('supplier_update', 'mat_suppliers', ex.id, before, after);
      }
      await esitoAi(esitoScrittura, 'mat_suppliers', ex.id);
      return json({ ok: true, supplier_id: ex.id, nome: ex.nome, creato: false });
    }
    const { data: ins, error } = await sb.from('mat_suppliers').insert({ nome, ...campi, chi }).select('*').single();
    if (error) {
      if (error.code === '23505') { const again = await trovaFornitore(nome); if (again) return json({ ok: true, supplier_id: again.id, nome: again.nome, creato: false }); }
      return json({ error: 'creazione fornitore fallita: ' + error.message }, 500);
    }
    await audit('supplier_insert', 'mat_suppliers', ins.id, null, ins);
    await esitoAi(esitoScrittura, 'mat_suppliers', ins.id);
    return json({ ok: true, supplier_id: ins.id, nome: ins.nome, creato: true });
  }

  // ---------------------------------------------------------------------------------------- item_upsert
  if (action === 'item_upsert') {
    const forn = await trovaFornitore(body.supplier ?? body.supplier_id);
    if (!forn) return json({ error: 'fornitore non trovato: crealo prima con supplier_upsert' }, 404);
    const categoria = str(body.categoria, 40);
    if (!categoria || !CATEGORIE.includes(categoria)) return json({ error: 'categoria non valida', categorie: CATEGORIE }, 422);
    const materiale = str(body.materiale, 200);
    if (!materiale) return json({ error: 'materiale obbligatorio' }, 422);
    const unita = str(body.unita, 4);
    if (unita && !UNITA.includes(unita)) return json({ error: 'unita non valida (mq, ml, mt, pz)' }, 422);
    const articolo = str(body.articolo_fornitore, 120);
    const note = str(body.note, 1000);
    const coloriRaw = Array.isArray(body.colori) ? body.colori : (body.colore !== undefined ? [body.colore] : []);
    const colori = [...new Set(coloriRaw.map((c) => str(c, 80)).filter((c): c is string => !!c))].slice(0, 20);
    const lista: (string | null)[] = colori.length ? colori : [null];
    const items: { item_id: string; colore: string | null; creato: boolean }[] = [];
    for (const colore of lista) {
      const { data: ins, error } = await sb.from('mat_items').insert({ supplier_id: forn.id, categoria, materiale, articolo_fornitore: articolo, colore, unita, note, chi }).select('id').single();
      if (!error) { items.push({ item_id: ins.id, colore, creato: true }); await audit('item_insert', 'mat_items', ins.id, null, { supplier_id: forn.id, categoria, materiale, colore, unita, articolo_fornitore: articolo }); continue; }
      if (error.code !== '23505') return json({ error: 'creazione materiale fallita: ' + error.message, items }, 500);
      // gia' presente (UNIQUE fornitore + materiale + colore): si riusa, non si duplica
      const { data: ex, error: exErr } = await retryOnce(() => sb.from('mat_items').select('id').eq('supplier_id', forn.id).ilike('materiale', ilikeEsc(materiale)).ilike('colore', ilikeEsc(colore ?? '')).maybeSingle());
      if (exErr) throw new ReadError('lettura materiale fallita, riprova: ' + exErr.message);
      if (ex) items.push({ item_id: ex.id, colore, creato: false });
      else if (colore === null) {
        const { data: ex2, error: ex2Err } = await retryOnce(() => sb.from('mat_items').select('id').eq('supplier_id', forn.id).ilike('materiale', ilikeEsc(materiale)).is('colore', null).maybeSingle());
        if (ex2Err) throw new ReadError('lettura materiale fallita, riprova: ' + ex2Err.message);
        if (ex2) items.push({ item_id: ex2.id, colore, creato: false });
      }
    }
    // nessuna riga ne' creata ne' ritrovata = qualcosa non torna (Gate 2, C3): errore esplicito, mai un ok vuoto
    if (!items.length) return json({ error: 'materiale non creato e non ritrovato: riprova o controlla il catalogo' }, 500);
    await esitoAi(esitoScrittura, 'mat_items', items[0].item_id);
    return json({ ok: true, supplier_id: forn.id, items });
  }

  // ------------------------------------------------------------------------------------------ offer_add
  if (action === 'offer_add') {
    let itemId = str(body.item_id, 40);
    if (itemId && !UUID_RE.test(itemId)) return json({ error: 'item_id non valido' }, 422);
    if (!itemId) {
      const forn = await trovaFornitore(body.supplier ?? body.supplier_id);
      const materiale = str(body.materiale, 200);
      if (!forn || !materiale) return json({ error: 'serve item_id oppure fornitore + materiale (+ colore)' }, 422);
      const colore = str(body.colore, 80);
      const q = colore ? sb.from('mat_items').select('id').eq('supplier_id', forn.id).ilike('materiale', ilikeEsc(materiale)).ilike('colore', ilikeEsc(colore)).maybeSingle()
        : sb.from('mat_items').select('id').eq('supplier_id', forn.id).ilike('materiale', ilikeEsc(materiale)).is('colore', null).maybeSingle();
      const { data: it, error } = await retryOnce(() => q);
      if (error) throw new ReadError('lettura materiale fallita, riprova: ' + error.message);
      if (!it) return json({ error: 'materiale non trovato: crealo prima con item_upsert' }, 404);
      itemId = it.id;
    }
    const tipo = str(body.tipo, 20) ?? 'offerta';
    if (!TIPI_OFFERTA.includes(tipo)) return json({ error: 'tipo non valido (offerta, listino)' }, 422);
    const prezzo = num(body.prezzo);
    if (Number.isNaN(prezzo) || (prezzo !== null && prezzo < 0)) return json({ error: 'prezzo non valido' }, 422);
    const prezzo_text = str(body.prezzo_text, 200);
    if (prezzo === null && !prezzo_text) return json({ error: 'serve un prezzo (numero) o un prezzo_text (range, scaglioni)' }, 422);
    const unita = str(body.unita, 4);
    if (unita && !UNITA.includes(unita)) return json({ error: 'unita non valida (mq, ml, mt, pz)' }, 422);
    const data = dataOk(body.data);
    if (data === 'INVALIDA') return json({ error: 'data non valida (YYYY-MM-DD)' }, 422);
    const riga = { item_id: itemId, tipo, prezzo, prezzo_text, valuta: str(body.valuta, 3) ?? 'EUR', unita, disponibilita: str(body.disponibilita, 120), min_ordine: str(body.min_ordine, 120), lead_time: str(body.lead_time, 120), data, documento_fonte: str(body.documento_fonte, 200), note: str(body.note, 1000), chi };
    const { data: ins, error } = await sb.from('mat_offers').insert(riga).select('id').single();
    if (error) return error.code === '23505' ? json({ error: 'offerta gia\' registrata per questo materiale, data e fonte' }, 409) : json({ error: 'offerta non salvata: ' + error.message }, 500);
    await audit('offer_insert', 'mat_offers', ins.id, null, riga);
    await esitoAi(esitoScrittura, 'mat_offers', ins.id);
    return json({ ok: true, offer_id: ins.id, item_id: itemId });
  }

  // ------------------------------------------------------------------------------------------ asset_add
  if (action === 'asset_add') {
    const path = str(body.path, 400);
    if (!path || !path.startsWith('inbox/') || path.includes('..')) return json({ error: 'path non valido: si registrano solo file caricati sotto inbox/' }, 422);
    const tipo = str(body.tipo, 20) ?? 'foto';
    if (!TIPI_ASSET.includes(tipo)) return json({ error: 'tipo non valido', tipi: TIPI_ASSET }, 422);
    const forn = await trovaFornitore(body.supplier ?? body.supplier_id);
    if (!forn) return json({ error: 'fornitore non trovato' }, 404);
    const itemId = str(body.item_id, 40); if (itemId && !UUID_RE.test(itemId)) return json({ error: 'item_id non valido' }, 422);
    const orderId = str(body.order_id, 40); if (orderId && !UUID_RE.test(orderId)) return json({ error: 'order_id non valido' }, 422);
    // il file deve esistere davvero nel bucket (lettura controllata): un path inventato non diventa un asset
    const dir = path.slice(0, path.lastIndexOf('/')); const nome = path.slice(path.lastIndexOf('/') + 1);
    const { data: obj, error: oErr } = await retryOnce(() => sb.storage.from('mat-assets').list(dir, { search: nome, limit: 5 }));
    if (oErr) throw new ReadError('verifica del file nel bucket fallita, riprova: ' + oErr.message);
    const found = (obj ?? []).find((o: { name: string }) => o.name === nome);
    if (!found) return json({ error: 'file non trovato nel bucket: ricarica la foto' }, 422);
    // mime: quello dichiarato dal client, altrimenti quello del bucket, ma mai application/octet-stream (File senza type): estensione
    const mimeBucket = (found as { metadata?: { mimetype?: string } }).metadata?.mimetype;
    const mime = str(body.mime, 80) ?? (mimeBucket && mimeBucket !== 'application/octet-stream' ? mimeBucket : mimeDaNome(nome));
    const riga = { supplier_id: forn.id, item_id: itemId, materiale: str(body.materiale, 200), order_id: orderId, path, tipo, titolo: str(body.titolo, 200) ?? nome, mime, bytes: num(body.bytes) || (found as { metadata?: { size?: number } }).metadata?.size || null, fonte: str(body.fonte, 200) ?? `app ${new Date().toISOString().slice(0, 10)} ${chi}`, chi };
    const { data: ins, error } = await sb.from('mat_assets').insert(riga).select('id').single();
    if (error) return error.code === '23505' ? json({ error: 'file gia\' registrato' }, 409) : json({ error: 'asset non salvato: ' + error.message }, 500);
    await audit('asset_insert', 'mat_assets', ins.id, null, riga);
    return json({ ok: true, asset_id: ins.id, path });
  }

  // ------------------------------------------------------------------------------------- item_set_attivo
  if (action === 'item_set_attivo') {
    const itemId = str(body.item_id, 40);
    if (!itemId || !UUID_RE.test(itemId)) return json({ error: 'item_id non valido' }, 422);
    const attivo = body.attivo === true || body.attivo === 'true';
    const { data: before, error: bErr } = await retryOnce(() => sb.from('mat_items').select('id,attivo,materiale,colore').eq('id', itemId).maybeSingle());
    if (bErr) throw new ReadError('lettura materiale fallita, riprova: ' + bErr.message);
    if (!before) return json({ error: 'materiale non trovato' }, 404);
    const { error } = await sb.from('mat_items').update({ attivo, chi }).eq('id', itemId);
    if (error) return json({ error: 'aggiornamento fallito: ' + error.message }, 500);
    await audit('item_set_attivo', 'mat_items', itemId, before, { ...before, attivo });
    return json({ ok: true, item_id: itemId, attivo });
  }

  // ------------------------------------------------------------------------------------------ ai_scarta
  if (action === 'ai_scarta') {
    await esitoAi('scartato', null, null);
    return json({ ok: true });
  }

  if (action === 'order_add') return json({ error: 'order_add e\' Fase 3: non ancora disponibile' }, 501);
  return json({ error: 'azione sconosciuta' }, 422);
}
