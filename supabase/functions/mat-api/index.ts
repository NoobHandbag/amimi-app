// mat-api v1 (2026-09-23): scritture del modulo materie prime (mat_*) dalla UI. Brief Fase 2:
// Cowork12/docs/Codice_e_Automazione/BRIEF_materie_prime_fase2_ai_compila_2026-09-23.md
//
// Postura = cs-api: l'Authorization porta l'access_token di un utente Supabase Auth reale (getUser: la anon key non e'
// un utente), email @amimi.it; solo allora un client service_role scrive. `chi` = selettore persona (B/G/A), che firma
// la riga; il login no. Ogni azione scrive mat_events (before/after). Nessun DELETE: "non attivo" al posto di cancellare.
// Regola 19: scrive SOLO mat_* (+ l'esito in ai_compila_log). Mai core, mai write-api, mai change_log.
// Regola 20: chiavi naturali con UNIQUE gia' a DB (migr 0140): "cerco e poi inserisco" e' un'ottimizzazione, la
// garanzia e' l'indice; un 23505 e' "gia' presente" e si rilegge. Letture con error destrutturato, 503 e stop.
// Flag mat_write_enabled (default OFF): a OFF ogni azione risponde {state:'off'} senza scrivere.
//
// Azioni (POST JSON {action, chi, ...}):
//   supplier_upsert  {nome, ragione_sociale?, categoria_principale?, email?, telefono?, referente?, indirizzo?, piva_vat?,
//                     deposito_luogo?, condizioni_pagamento?, note?}                  -> {ok, id, creato}
//   item_upsert      {supplier (nome) | supplier_id, categoria, materiale, articolo_fornitore?, colori[] (almeno uno, o [null]),
//                     unita?, note?, offerta? {tipo, prezzo, prezzo_text, unita, disponibilita, min_ordine, lead_time, data,
//                     documento_fonte, note}, ai_log_id?, ai_modificato?}            -> {ok, items:[{id, colore, creato}], offerte}
//   offer_add        {item_id, tipo?, prezzo?, prezzo_text?, unita?, disponibilita?, min_ordine?, lead_time?, data?,
//                     documento_fonte?, note?}                                        -> {ok, id, creato}
//   asset_add        {path (gia' nel bucket, sotto inbox/), tipo, titolo?, supplier_id, item_id?, materiale?, order_id?, fonte?}
//                                                                                    -> {ok, id, creato}
//   item_set_attivo  {item_id, attivo}                                               -> {ok}
//   ai_esito         {ai_log_id, esito: confermato|modificato|scartato, ref_tabella?, ref_id?} -> {ok}
import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const retryOnce = async <T extends { error: unknown }>(fn: () => PromiseLike<T>): Promise<T> => {
  const r = await fn(); if (!r.error) return r; await sleep(1500); return await fn();
};
class ReadError extends Error {}
const IDENT: Record<string, string> = { B: 'Benedetta', G: 'Ginevra', A: 'Ale' };
const CATEGORIE = new Set(['Tessuto', 'Tessuto velluto', 'Animalier', 'Cocco', 'Vitello stampato', 'Pelle vitello', 'Vernice', 'Crosta/Velour', 'Nappa', 'Nastri', 'Accessori metallici']);
const UNITA = new Set(['mq', 'ml', 'mt', 'pz']);
const TIPI_ASSET = new Set(['foto', 'scheda_tecnica', 'proforma', 'documento', 'campione']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// input: stringa pulita (null se vuota) con tetto; numero >= 0 o null; data ISO o null
const str = (v: unknown, max = 500): string | null => { const s = v == null ? '' : String(v).trim(); return s ? s.slice(0, max) : null; };
// numero >= 0 o null; accetta "1000", "0,656", "0.656" e il migliaio italiano "1.000" / "1.000,50" (punto = separatore delle migliaia
// SOLO quando ha esattamente 3 cifre dopo e nessun altro punto, altrimenti "1.5" resta un decimale)
const num = (v: unknown): number | null | 'bad' => {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? v : 'bad';
  let s = String(v).trim();
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : 'bad';
};
const dateIso = (v: unknown): string | null | 'bad' => { const s = str(v, 10); if (!s) return null; return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s)) ? s : 'bad'; };

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

  // 1) autorizzazione
  const authz = req.headers.get('Authorization') || '';
  const token = authz.toLowerCase().startsWith('bearer ') ? authz.slice(7).trim() : '';
  if (!token) return json({ error: 'non autenticato' }, 401);
  const { data: ures, error: uerr } = await createClient(url, anon).auth.getUser(token);
  const user = ures?.user;
  if (uerr || !user) return json({ error: 'sessione non valida' }, 401);
  const email = (user.email || '').toLowerCase();
  if (!email.endsWith('@amimi.it')) return json({ error: 'dominio non ammesso' }, 403);

  const body = await req.json().catch(() => ({}));
  const action = String(body.action || '');
  const chi = IDENT[String(body.chi || '').toUpperCase()] || '';
  if (!chi) return json({ error: 'chi mancante (B, G o A)' }, 422);
  const sb = createClient(url, svc);

  // 2) flag: lettura controllata; a OFF nessuna scrittura
  const { data: fl, error: fErr } = await retryOnce(() => sb.from('app_flags').select('value').eq('key', 'mat_write_enabled').maybeSingle());
  if (fErr) throw new ReadError('flag non leggibile, riprova');
  if (String(fl?.value ?? 'false').trim().toLowerCase() !== 'true') return json({ state: 'off' });

  const audit = async (azione: string, tabella: string, rigaId: string | null, before: unknown, after: unknown, note?: string) => {
    const { error } = await sb.from('mat_events').insert({ chi, azione, tabella, riga_id: rigaId, before: before ?? null, after: after ?? null, note: note ?? `${email}` });
    if (error) console.error('mat-api: audit fallito', azione, error.message);
  };
  const findOne = async <T,>(q: () => PromiseLike<{ data: T | null; error: unknown }>): Promise<T | null> => {
    const { data, error } = await retryOnce(q as () => PromiseLike<{ data: T | null; error: unknown }>);
    if (error) throw new ReadError('lettura fallita, riprova');
    return data ?? null;
  };
  const supplierByName = (nome: string) => findOne<{ id: string; nome: string }>(() => sb.from('mat_suppliers').select('id, nome').ilike('nome', nome).maybeSingle());
  const aiEsito = async (logId: unknown, esito: string, refTab: string, refId: string) => {
    const id = str(logId, 40);
    if (!id || !UUID_RE.test(id)) return;
    await sb.from('ai_compila_log').update({ esito, ref_tabella: refTab, ref_id: refId, esito_at: new Date().toISOString() }).eq('id', id);
  };

  // ---------------------------------------------------------------- fornitore
  if (action === 'supplier_upsert') {
    const nome = str(body.nome, 120);
    if (!nome) return json({ error: 'nome mancante' }, 422);
    const row = {
      ragione_sociale: str(body.ragione_sociale), categoria_principale: str(body.categoria_principale, 120), email: str(body.email, 300),
      telefono: str(body.telefono, 120), referente: str(body.referente, 200), indirizzo: str(body.indirizzo), piva_vat: str(body.piva_vat, 40),
      deposito_luogo: str(body.deposito_luogo, 200), condizioni_pagamento: str(body.condizioni_pagamento), note: str(body.note, 2000),
    };
    const ex = await findOne<Record<string, unknown>>(() => sb.from('mat_suppliers').select('*').ilike('nome', nome).maybeSingle());
    if (ex) {
      // aggiorna solo i campi arrivati valorizzati: un form parziale non svuota l'anagrafica
      const patch: Record<string, unknown> = { chi };
      for (const [k, v] of Object.entries(row)) if (v != null) patch[k] = v;
      const { error } = await sb.from('mat_suppliers').update(patch).eq('id', ex.id);
      if (error) return json({ error: 'scrittura fallita: ' + error.message }, 500);
      await audit('supplier_update', 'mat_suppliers', String(ex.id), ex, patch);
      await aiEsito(body.ai_log_id, body.ai_modificato ? 'modificato' : 'confermato', 'mat_suppliers', String(ex.id));
      return json({ ok: true, id: ex.id, creato: false });
    }
    const { data: ins, error } = await sb.from('mat_suppliers').insert({ nome, ...row, chi }).select('id').single();
    if (error && error.code === '23505') { const again = await supplierByName(nome); if (again) return json({ ok: true, id: again.id, creato: false }); }
    if (error) return json({ error: 'scrittura fallita: ' + error.message }, 500);
    await audit('supplier_insert', 'mat_suppliers', String(ins.id), null, { nome, ...row });
    await aiEsito(body.ai_log_id, body.ai_modificato ? 'modificato' : 'confermato', 'mat_suppliers', String(ins.id));
    return json({ ok: true, id: ins.id, creato: true });
  }

  // ---------------------------------------------------------------- materiale (N colori) + offerta opzionale
  if (action === 'item_upsert') {
    let supplierId = str(body.supplier_id, 40);
    if (!supplierId) {
      const nome = str(body.supplier, 120);
      if (!nome) return json({ error: 'fornitore mancante' }, 422);
      const s = await supplierByName(nome);
      if (!s) return json({ error: `fornitore non trovato: ${nome} (crealo prima con supplier_upsert)` }, 422);
      supplierId = s.id;
    }
    if (!UUID_RE.test(supplierId)) return json({ error: 'supplier_id non valido' }, 422);
    const categoria = str(body.categoria, 60);
    const materiale = str(body.materiale, 200);
    if (!categoria || !CATEGORIE.has(categoria)) return json({ error: 'categoria fuori lista' }, 422);
    if (!materiale) return json({ error: 'materiale mancante' }, 422);
    const unita = str(body.unita, 4);
    if (unita && !UNITA.has(unita)) return json({ error: 'unita non valida (mq, ml, mt, pz)' }, 422);
    const coloriIn: unknown[] = Array.isArray(body.colori) && body.colori.length ? body.colori : [null];
    const colori = [...new Set(coloriIn.map((c) => str(c, 120)))].slice(0, 30);
    const articolo = str(body.articolo_fornitore, 120), note = str(body.note, 2000);

    // offerta opzionale, applicata a ogni colore
    let offerta: Record<string, unknown> | null = null;
    let offertaIgnorata = false;
    if (body.offerta && typeof body.offerta === 'object') {
      const o = body.offerta as Record<string, unknown>;
      const prezzo = num(o.prezzo); if (prezzo === 'bad') return json({ error: 'offerta.prezzo non valido' }, 422);
      // stessa guardia di offer_add: un'offerta senza prezzo, testo di prezzo o disponibilita' non e' un'offerta
      if (prezzo == null && !str(o.prezzo_text, 300) && !str(o.disponibilita, 300)) { offertaIgnorata = true; }
    }
    if (body.offerta && typeof body.offerta === 'object' && !offertaIgnorata) {
      const o = body.offerta as Record<string, unknown>;
      const prezzo = num(o.prezzo) as number | null;
      const data = dateIso(o.data); if (data === 'bad') return json({ error: 'offerta.data non valida (YYYY-MM-DD)' }, 422);
      const ou = str(o.unita, 4); if (ou && !UNITA.has(ou)) return json({ error: 'offerta.unita non valida' }, 422);
      const tipo = str(o.tipo, 10) === 'listino' ? 'listino' : 'offerta';
      offerta = { tipo, prezzo, prezzo_text: prezzo == null ? str(o.prezzo_text, 300) : null, unita: ou ?? unita, disponibilita: str(o.disponibilita, 300), min_ordine: str(o.min_ordine, 200),
        lead_time: str(o.lead_time, 200), data, documento_fonte: str(o.documento_fonte, 300), note: str(o.note, 1000), chi };
    }

    const items: Array<{ id: string; colore: string | null; creato: boolean }> = [];
    let offerte = 0;
    for (const colore of colori) {
      const q = () => { const b = sb.from('mat_items').select('id').eq('supplier_id', supplierId!).ilike('materiale', materiale); return (colore ? b.ilike('colore', colore) : b.is('colore', null)).maybeSingle(); };
      let ex = await findOne<{ id: string }>(q);
      let creato = false;
      if (!ex) {
        const row = { supplier_id: supplierId, categoria, materiale, articolo_fornitore: articolo, colore, unita, note, chi };
        const { data: ins, error } = await sb.from('mat_items').insert(row).select('id').single();
        if (error && error.code === '23505') ex = await findOne<{ id: string }>(q);
        else if (error) return json({ error: 'scrittura fallita: ' + error.message, items }, 500);
        else { ex = ins as { id: string }; creato = true; await audit('item_insert', 'mat_items', ins.id, null, row); }
      } else if (articolo || note) {
        const patch: Record<string, unknown> = { chi }; if (articolo) patch.articolo_fornitore = articolo; if (note) patch.note = note; if (unita) patch.unita = unita;
        const { error } = await sb.from('mat_items').update(patch).eq('id', ex.id);
        if (!error) await audit('item_update', 'mat_items', ex.id, null, patch);
      }
      if (!ex) return json({ error: 'materiale non rileggibile', items }, 503);
      items.push({ id: ex.id, colore, creato });
      if (offerta) {
        // stessa chiave naturale dell'UNIQUE mat_offers_uq (item, data, fonte)
        const fq = () => {
          let b = sb.from('mat_offers').select('id').eq('item_id', ex!.id);
          const d = offerta!.data as string | null, f = offerta!.documento_fonte as string | null;
          b = d ? b.eq('data', d) : b.is('data', null);
          b = f ? b.ilike('documento_fonte', f) : b.is('documento_fonte', null);
          return b.maybeSingle();
        };
        const exO = await findOne<{ id: string }>(fq);
        if (!exO) {
          const { data: oi, error } = await sb.from('mat_offers').insert({ item_id: ex.id, ...offerta }).select('id').single();
          if (error && error.code !== '23505') return json({ error: 'offerta non scritta: ' + error.message, items }, 500);
          if (!error) { offerte++; await audit('offer_insert', 'mat_offers', oi.id, null, { item_id: ex.id, ...offerta }); }
        }
      }
    }
    await aiEsito(body.ai_log_id, body.ai_modificato ? 'modificato' : 'confermato', 'mat_items', items[0]?.id ?? '');
    return json({ ok: true, items, offerte, ...(offertaIgnorata ? { nota: 'offerta ignorata: senza prezzo, testo di prezzo o disponibilita\'' } : {}) });
  }

  // ---------------------------------------------------------------- offerta su un item esistente
  if (action === 'offer_add') {
    const itemId = str(body.item_id, 40);
    if (!itemId || !UUID_RE.test(itemId)) return json({ error: 'item_id non valido' }, 422);
    const it = await findOne<{ id: string; unita: string | null }>(() => sb.from('mat_items').select('id, unita').eq('id', itemId).maybeSingle());
    if (!it) return json({ error: 'materiale inesistente' }, 404);
    const prezzo = num(body.prezzo); if (prezzo === 'bad') return json({ error: 'prezzo non valido' }, 422);
    const data = dateIso(body.data); if (data === 'bad') return json({ error: 'data non valida (YYYY-MM-DD)' }, 422);
    const unita = str(body.unita, 4); if (unita && !UNITA.has(unita)) return json({ error: 'unita non valida' }, 422);
    if (prezzo == null && !str(body.prezzo_text, 300)) return json({ error: 'serve un prezzo (numero) o un testo di prezzo' }, 422);
    const row = { item_id: itemId, tipo: str(body.tipo, 10) === 'listino' ? 'listino' : 'offerta', prezzo, prezzo_text: prezzo == null ? str(body.prezzo_text, 300) : null,
      unita: unita ?? it.unita, disponibilita: str(body.disponibilita, 300), min_ordine: str(body.min_ordine, 200), lead_time: str(body.lead_time, 200), data,
      documento_fonte: str(body.documento_fonte, 300), note: str(body.note, 1000), chi };
    const { data: ins, error } = await sb.from('mat_offers').insert(row).select('id').single();
    if (error && error.code === '23505') return json({ ok: true, id: null, creato: false, nota: 'offerta gia\' presente (stessa data e fonte)' });
    if (error) return json({ error: 'scrittura fallita: ' + error.message }, 500);
    await audit('offer_insert', 'mat_offers', ins.id, null, row);
    return json({ ok: true, id: ins.id, creato: true });
  }

  // ---------------------------------------------------------------- asset (file gia' caricato dal client sotto inbox/)
  if (action === 'asset_add') {
    const path = str(body.path, 400);
    const tipo = str(body.tipo, 20);
    const supplierId = str(body.supplier_id, 40);
    if (!path || !path.startsWith('inbox/')) return json({ error: 'path non valido: i file dell\'app stanno sotto inbox/' }, 422);
    if (!tipo || !TIPI_ASSET.has(tipo)) return json({ error: 'tipo asset non valido' }, 422);
    if (!supplierId || !UUID_RE.test(supplierId)) return json({ error: 'supplier_id non valido' }, 422);
    const itemId = str(body.item_id, 40), orderId = str(body.order_id, 40);
    if (itemId && !UUID_RE.test(itemId)) return json({ error: 'item_id non valido' }, 422);
    if (orderId && !UUID_RE.test(orderId)) return json({ error: 'order_id non valido' }, 422);
    // il file deve esistere davvero nel bucket (lettura controllata): niente righe fantasma
    const dir = path.slice(0, path.lastIndexOf('/')), base = path.slice(path.lastIndexOf('/') + 1);
    const { data: ls, error: lsErr } = await sb.storage.from('mat-assets').list(dir, { search: base, limit: 5 });
    if (lsErr) throw new ReadError('bucket non leggibile, riprova');
    const found = (ls ?? []).find((f) => f.name === base);
    if (!found) return json({ error: 'file non trovato nel bucket: carica prima il file' }, 422);
    const row = { supplier_id: supplierId, item_id: itemId, materiale: itemId ? null : str(body.materiale, 200), order_id: orderId, path, tipo, titolo: str(body.titolo, 200),
      mime: (found.metadata as { mimetype?: string } | null)?.mimetype ?? null, bytes: (found.metadata as { size?: number } | null)?.size ?? null, fonte: str(body.fonte, 300) ?? `app, ${chi}`, chi };
    const { data: ins, error } = await sb.from('mat_assets').insert(row).select('id').single();
    if (error && error.code === '23505') { const again = await findOne<{ id: string }>(() => sb.from('mat_assets').select('id').eq('path', path).maybeSingle()); return json({ ok: true, id: again?.id ?? null, creato: false }); }
    if (error) return json({ error: 'scrittura fallita: ' + error.message }, 500);
    await audit('asset_insert', 'mat_assets', ins.id, null, row);
    return json({ ok: true, id: ins.id, creato: true });
  }

  // ---------------------------------------------------------------- attivo / non attivo (mai DELETE)
  if (action === 'item_set_attivo') {
    const itemId = str(body.item_id, 40);
    if (!itemId || !UUID_RE.test(itemId)) return json({ error: 'item_id non valido' }, 422);
    const attivo = body.attivo === true;
    const ex = await findOne<{ id: string; attivo: boolean }>(() => sb.from('mat_items').select('id, attivo').eq('id', itemId).maybeSingle());
    if (!ex) return json({ error: 'materiale inesistente' }, 404);
    const { error } = await sb.from('mat_items').update({ attivo, chi }).eq('id', itemId);
    if (error) return json({ error: 'scrittura fallita: ' + error.message }, 500);
    await audit('item_set_attivo', 'mat_items', itemId, { attivo: ex.attivo }, { attivo });
    return json({ ok: true, attivo });
  }

  // ---------------------------------------------------------------- esito umano di una proposta AI (per la misura)
  if (action === 'ai_esito') {
    const esito = str(body.esito, 20);
    if (!esito || !['confermato', 'modificato', 'scartato'].includes(esito)) return json({ error: 'esito non valido' }, 422);
    await aiEsito(body.ai_log_id, esito, str(body.ref_tabella, 40) ?? '', str(body.ref_id, 80) ?? '');
    return json({ ok: true });
  }

  return json({ error: 'unknown_action', action }, 422);
}
