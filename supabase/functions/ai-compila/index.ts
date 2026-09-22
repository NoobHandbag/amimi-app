// ai-compila v1 (2026-09-23, brief materie prime Fase 2): lo strato AI "Compila", in SOLA LETTURA.
// Ginevra fotografa la proforma, la scheda tecnica o il campione, detta due righe e tocca "Compila": questa edge
// manda foto e nota a Gemini e restituisce una PROPOSTA a schema fisso, campo per campo con valore, confidenza e
// fonte. Non scrive nulla tranne il proprio log (ai_compila_log): la conferma e' umana e la scrittura la fa mat-api
// (o write-api order_multi per gli ordini prodotti, target 'ordine_prodotti', parte B).
// Principio fisso (Regola 1): un prezzo e' un numero SOLO se nel documento c'e' un valore singolo e leggibile;
// range e scaglioni vanno in prezzo_text; niente nel documento = null, MAI una stima.
//
// Autenticazione = mat-api (JWT di un utente @amimi.it). Flag app_flags.ai_compila_enabled (default OFF): spento = 403
// e il bottone "Compila" non compare. Modello da app_flags.ai_compila_model (default gemini-flash-lite-latest, D6).
// Gemini: JSON mode via responseMimeType, temperature 0, maxOutputTokens largo (i token di ragionamento contano nel
// tetto), MAI thinkingConfig (-> 400). Timeout 25 s; errore = 503 ai_failed, mai una proposta vuota spacciata per buona.
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

const MAX_IMG = 4;
const MAX_BYTES = 4 * 1024 * 1024;
const TIMEOUT_MS = 25000;
const MAX_TOKENS = 8000;
const MIME_OK = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'];
const IDENT: Record<string, string> = { B: 'Benedetta', G: 'Ginevra', A: 'Ale' };
const chiDa = (v: unknown): string => { const t = String(v ?? '').trim().slice(0, 40); return IDENT[t.slice(0, 1).toUpperCase()] && t.length <= 10 ? IDENT[t.slice(0, 1).toUpperCase()] : (t || 'ignoto'); };

// ==== PURE:ai-compila BEGIN ====
// Prompt, schema e normalizzazione della risposta: puri, ritagliati dal sorgente in tests/mat_guardie.mjs e usati
// TALI E QUALI da tests/mat_ai_golden.mjs (golden set con i documenti reali, lanciato a mano con la chiave).
const TARGETS = ['materiale', 'fornitore', 'ordine_prodotti'];
const CATEGORIE = ['Tessuto', 'Tessuto velluto', 'Animalier', 'Cocco', 'Vitello stampato', 'Pelle vitello', 'Vernice', 'Crosta/Velour', 'Nappa', 'Nastri', 'Accessori metallici'];
const UNITA = ['mq', 'ml', 'mt', 'pz'];

type Campo = { v: unknown; c: number; f: string | null };
type Contesto = { fornitori?: { id: string; nome: string; ragione_sociale?: string | null }[]; modelli?: string[]; varianti?: { modello: string; variante: string; codice?: string }[] };

function buildPrompt(target: string, testo: string, contesto: Contesto): string {
  const campo = '{"v": valore o null, "c": confidenza 0-1, "f": "frase o zona del documento da cui viene, oppure null"}';
  const base = [
    'Sei l\'assistente di Amimì Milano, un piccolo brand di borse. Leggi i documenti allegati (foto di campioni, proforma, fatture, schede tecniche, email) e la nota dettata, e compila una PROPOSTA di dati. Rispondi SOLO con JSON valido, nello schema indicato, in italiano, senza em dash.',
    '',
    'REGOLE VINCOLANTI:',
    '1. Ogni campo e\' un oggetto ' + campo + '. Se il documento e la nota non dicono niente, v = null e c = 0. MAI una stima, MAI un valore "probabile".',
    '2. Un prezzo e\' un NUMERO solo se nel documento c\'e\' un valore singolo e leggibile per quell\'articolo. Range ("40-45"), scaglioni ("49,16 fino a 6 pelli, 46,66 da 6 a 30 mq") e sconti condizionati vanno nel campo di testo (prezzo_text), fedeli al documento, e il prezzo numerico resta null.',
    '3. I colori come compaiono nel documento, non normalizzati ("T.Moro" resta "T.Moro").',
    '4. I numeri in formato JSON (48.44, non "48,44"). Le quantita\' con la loro unita\' (mq, ml, mt, pz) come nel documento.',
    '5. La nota dettata puo\' correggere o completare il documento: se dice un prezzo, e\' un valore leggibile (fonte = "nota").',
    '6. Se un fornitore o un materiale somiglia a uno gia\' esistente nel CONTESTO, indica match_fornitore_id (o match_esistente) con quell\'id invece di proporre un doppione. Un fornitore puo\' comparire nel documento con la sua ragione sociale (es. la conceria dietro un marchio): confronta anche quella, e in "fornitore" usa il nome corto del CONTESTO quando c\'e\' il match.',
  ];
  let schema = '';
  if (target === 'materiale') {
    schema = [
      'SCHEMA (target materiale):',
      '{',
      '  "fornitore": campo (nome del fornitore come nel documento),',
      '  "match_fornitore_id": id del fornitore esistente nel CONTESTO oppure null,',
      '  "documento_tipo": campo con v in ["proforma","fattura","scheda_tecnica","foto","email","altro"],',
      '  "documento_numero": campo, "documento_data": campo (v in formato YYYY-MM-DD),',
      '  "condizioni_pagamento": campo, "deposito_luogo": campo,',
      '  "righe": [ per ogni articolo o materiale nel documento: {',
      '     "categoria": campo con v in [' + CATEGORIE.map((c) => `"${c}"`).join(', ') + '] oppure null,',
      '     "materiale": campo (nome dell\'articolo), "articolo_fornitore": campo (codice articolo),',
      '     "colore": campo, "unita": campo con v in ["mq","ml","mt","pz"] oppure null,',
      '     "quantita": campo (numero), "prezzo": campo (numero SOLO se singolo, altrimenti null),',
      '     "prezzo_text": campo (testo fedele per range, scaglioni, sconti), "sconto_text": campo,',
      '     "importo": campo (numero, imponibile della riga se presente), "disponibilita": campo, "min_ordine": campo, "lead_time": campo',
      '  } ],',
      '  "totale_imponibile": campo (numero), "totale_documento": campo (numero), "note": campo (testo breve)',
      '}',
      'Per una FOTO di un campione senza prezzi: una riga con categoria e materiale se riconoscibili, tutto il resto null.',
    ].join('\n');
  } else if (target === 'fornitore') {
    schema = [
      'SCHEMA (target fornitore):',
      '{ "nome": campo, "match_fornitore_id": id esistente oppure null, "ragione_sociale": campo, "email": campo, "telefono": campo, "referente": campo, "indirizzo": campo, "piva_vat": campo, "deposito_luogo": campo, "condizioni_pagamento": campo, "categoria_principale": campo, "note": campo }',
    ].join('\n');
  } else {
    schema = [
      'SCHEMA (target ordine_prodotti, borse finite ordinate a un fornitore o a una sarta):',
      '{ "fornitore": campo, "data_ordine": campo (YYYY-MM-DD), "righe": [ { "modello": campo, "variante": campo, "quantita": campo (numero), "costo_unitario": campo (numero solo se leggibile), "match_esistente": {"modello": ..., "variante": ...} dal CONTESTO oppure null } ], "note": campo }',
    ].join('\n');
  }
  const ctx: string[] = [];
  if (contesto.fornitori?.length) ctx.push('Fornitori esistenti: ' + contesto.fornitori.slice(0, 200).map((f) => `${f.nome} (id ${f.id}${f.ragione_sociale ? `, ragione sociale ${String(f.ragione_sociale).slice(0, 80)}` : ''})`).join('; '));
  if (contesto.modelli?.length) ctx.push('Modelli esistenti: ' + contesto.modelli.slice(0, 200).join(', '));
  if (contesto.varianti?.length) ctx.push('Varianti esistenti (modello / variante): ' + contesto.varianti.slice(0, 400).map((v) => `${v.modello} / ${v.variante}`).join('; '));
  return [...base, '', schema, '', 'CONTESTO:', ctx.length ? ctx.join('\n') : '(vuoto)', '', 'NOTA DETTATA:', testo || '(nessuna)'].join('\n');
}

// normalizza un campo {v,c,f}; `kind` = number | text | date | enum
function campo(raw: unknown, kind: 'number' | 'text' | 'date', allow?: string[]): Campo {
  const o = (raw && typeof raw === 'object' && 'v' in (raw as Row)) ? (raw as Row) : { v: raw, c: raw == null ? 0 : 0.5, f: null };
  let v: unknown = o.v ?? null;
  const c = Math.max(0, Math.min(1, Number(o.c ?? 0) || 0));
  const f = o.f == null ? null : String(o.f).slice(0, 300);
  if (kind === 'number') {
    if (typeof v === 'string') { const t = v.trim().replace(/\s|€/g, ''); const n = /^-?\d+(?:[.,]\d+)?$/.test(t) ? Number(t.replace(',', '.')) : NaN; v = Number.isFinite(n) ? n : null; }
    else if (typeof v !== 'number' || !Number.isFinite(v)) v = null;
  } else if (kind === 'date') {
    v = typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : null;
  } else {
    v = v == null ? null : String(v).trim().slice(0, 400) || null;
    if (allow && v !== null && !allow.includes(String(v))) v = null;
  }
  return { v, c: v === null ? 0 : c, f };
}
type Row = Record<string, unknown>;
// la risposta del modello, ripulita: struttura fissa per target, numeri veri, enum validi, id di contesto verificati
function normalizza(target: string, raw: Row, contesto: Contesto): Row {
  const idsForn = new Set((contesto.fornitori ?? []).map((f) => f.id));
  const matchForn = idsForn.has(String(raw.match_fornitore_id ?? '')) ? String(raw.match_fornitore_id) : null;
  if (target === 'materiale') {
    const righe = (Array.isArray(raw.righe) ? raw.righe : []).slice(0, 40).map((r) => { const x = (r ?? {}) as Row; return {
      categoria: campo(x.categoria, 'text', CATEGORIE), materiale: campo(x.materiale, 'text'), articolo_fornitore: campo(x.articolo_fornitore, 'text'),
      colore: campo(x.colore, 'text'), unita: campo(x.unita, 'text', UNITA), quantita: campo(x.quantita, 'number'),
      prezzo: campo(x.prezzo, 'number'), prezzo_text: campo(x.prezzo_text, 'text'), sconto_text: campo(x.sconto_text, 'text'),
      importo: campo(x.importo, 'number'), disponibilita: campo(x.disponibilita, 'text'), min_ordine: campo(x.min_ordine, 'text'), lead_time: campo(x.lead_time, 'text'),
    }; });
    return {
      fornitore: campo(raw.fornitore, 'text'), match_fornitore_id: matchForn,
      documento_tipo: campo(raw.documento_tipo, 'text', ['proforma', 'fattura', 'scheda_tecnica', 'foto', 'email', 'altro']),
      documento_numero: campo(raw.documento_numero, 'text'), documento_data: campo(raw.documento_data, 'date'),
      condizioni_pagamento: campo(raw.condizioni_pagamento, 'text'), deposito_luogo: campo(raw.deposito_luogo, 'text'),
      righe, totale_imponibile: campo(raw.totale_imponibile, 'number'), totale_documento: campo(raw.totale_documento, 'number'), note: campo(raw.note, 'text'),
    };
  }
  if (target === 'fornitore') {
    const out: Row = { match_fornitore_id: matchForn };
    for (const k of ['nome', 'ragione_sociale', 'email', 'telefono', 'referente', 'indirizzo', 'piva_vat', 'deposito_luogo', 'condizioni_pagamento', 'categoria_principale', 'note']) out[k] = campo(raw[k], 'text');
    return out;
  }
  const righe = (Array.isArray(raw.righe) ? raw.righe : []).slice(0, 60).map((r) => { const x = (r ?? {}) as Row; const m = (x.match_esistente ?? null) as Row | null; return {
    modello: campo(x.modello, 'text'), variante: campo(x.variante, 'text'), quantita: campo(x.quantita, 'number'), costo_unitario: campo(x.costo_unitario, 'number'),
    match_esistente: m && m.modello && m.variante ? { modello: String(m.modello).slice(0, 120), variante: String(m.variante).slice(0, 120) } : null,
  }; });
  return { fornitore: campo(raw.fornitore, 'text'), data_ordine: campo(raw.data_ordine, 'date'), righe, note: campo(raw.note, 'text') };
}
// ==== PURE:ai-compila END ====

async function sha256hex(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
// nessun segreto in un messaggio d'errore: la chiave viaggia in un header, ma un errore di rete puo' citare URL e body
const scrub = (s: string) => s.replace(/key=[^&\s)]+/gi, 'key=***').replace(/AIza[0-9A-Za-z_-]{20,}/g, '***');
function b64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function b64decode(s: string): Uint8Array {
  const bin = atob(s.replace(/^data:[^;]+;base64,/, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const mimeDaNome = (n: string): string => /\.pdf$/i.test(n) ? 'application/pdf' : /\.png$/i.test(n) ? 'image/png' : /\.webp$/i.test(n) ? 'image/webp' : /\.hei[cf]$/i.test(n) ? 'image/heic' : 'image/jpeg';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const svc = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const authz = req.headers.get('Authorization') || '';
  const token = authz.toLowerCase().startsWith('bearer ') ? authz.slice(7).trim() : '';
  if (!token) return json({ error: 'non autenticato' }, 401);
  const { data: ures, error: uerr } = await createClient(url, anon).auth.getUser(token);
  if (uerr || !ures?.user) return json({ error: 'sessione non valida' }, 401);
  const email = (ures.user.email || '').toLowerCase();
  if (!email.endsWith('@amimi.it')) return json({ error: 'dominio non ammesso' }, 403);

  const body = await req.json().catch(() => ({})) as Row;
  const chi = chiDa(body.chi);
  const sb = createClient(url, svc);
  const { data: frows, error: ferr } = await retryOnce(() => sb.from('app_flags').select('key,value').in('key', ['ai_compila_enabled', 'ai_compila_model', 'gemini_api_key']));
  if (ferr) return json({ error: 'flag non leggibili, riprova: ' + ferr.message }, 503);
  const flags: Record<string, string> = Object.fromEntries((frows ?? []).map((r: { key: string; value: string | null }) => [r.key, r.value ?? '']));
  if (body.action === 'diag') return json({ ok: true, enabled: flags.ai_compila_enabled === 'true', gemini: !!flags.gemini_api_key, modello: flags.ai_compila_model || 'gemini-flash-lite-latest' });
  if (flags.ai_compila_enabled !== 'true') return json({ state: 'off', error: 'Compila AI spento (app_flags.ai_compila_enabled = false).' }, 403);
  if (!flags.gemini_api_key) return json({ error: 'gemini_api_key assente' }, 500);
  const modello = (flags.ai_compila_model || 'gemini-flash-lite-latest').replace(/[^a-z0-9.\-]/gi, '');

  const target = String(body.target || '');
  if (!TARGETS.includes(target)) return json({ error: 'target non valido', targets: TARGETS }, 422);
  const testo = String(body.testo ?? '').replace(/\u0000/g, '').trim().slice(0, 4000);
  const contesto = (body.contesto && typeof body.contesto === 'object' ? body.contesto : {}) as Contesto;
  const immaginiIn = Array.isArray(body.immagini) ? body.immagini as Row[] : [];
  if (immaginiIn.length > MAX_IMG) return json({ error: `al massimo ${MAX_IMG} immagini` }, 422);
  if (!immaginiIn.length && !testo) return json({ error: 'serve almeno una foto o una nota' }, 422);

  // immagini: dal bucket (path caricato dal client sotto inbox/) o base64 inline; tetto 4 MB l'una, mime ammessi
  const parti: { mime: string; data: Uint8Array }[] = [];
  for (const im of immaginiIn) {
    let bytes: Uint8Array; let mime = String(im.mime || '').toLowerCase();
    if (typeof im.path === 'string' && im.path) {
      const p = im.path.trim();
      if (!p.startsWith('inbox/') || p.includes('..')) return json({ error: 'path non valido: solo file caricati sotto inbox/' }, 422);
      const { data: blob, error } = await sb.storage.from('mat-assets').download(p);
      if (error || !blob) return json({ error: 'file non leggibile dal bucket: ' + (error?.message ?? 'vuoto') }, 422);
      bytes = new Uint8Array(await blob.arrayBuffer());
      // un File senza type sale come application/octet-stream: allora fa fede l'estensione del path
      mime = mime || (blob.type && blob.type !== 'application/octet-stream' ? blob.type : mimeDaNome(p));
    } else if (typeof im.data === 'string' && im.data) {
      try { bytes = b64decode(im.data); } catch { return json({ error: 'base64 non valido' }, 422); }
      mime = mime || (im.data.startsWith('data:') ? im.data.slice(5, im.data.indexOf(';')) : 'image/jpeg');
    } else return json({ error: 'ogni immagine vuole path oppure data (base64)' }, 422);
    if (!MIME_OK.includes(mime)) return json({ error: `formato non ammesso (${mime}): jpeg, png, webp, heic, pdf` }, 422);
    if (bytes.length > MAX_BYTES) return json({ error: 'file oltre 4 MB: riducilo' }, 422);
    parti.push({ mime, data: bytes });
  }
  const hashes: string[] = [];
  for (const p of parti) hashes.push(await sha256hex(p.data));
  const inputHash = await sha256hex(new TextEncoder().encode(hashes.join('|') + '|' + testo + '|' + target));

  const prompt = buildPrompt(target, testo, contesto);
  const t0 = Date.now();
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let raw = ''; let finish = ''; let errore: string | null = null;
  try {
    // chiave nell'header x-goog-api-key, MAI nell'URL: un errore di rete di Deno cita l'URL intero nel messaggio,
    // e quel messaggio finisce nel log e sullo schermo (Gate 2 del 23-09, finding A1)
    const g = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modello}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': flags.gemini_api_key }, signal: ctrl.signal,
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }, ...parti.map((p) => ({ inlineData: { mimeType: p.mime, data: b64(p.data) } }))] }], generationConfig: { temperature: 0, maxOutputTokens: MAX_TOKENS, responseMimeType: 'application/json' } }),
    });
    const gj = await g.json();
    if (!g.ok) errore = scrub(`Gemini ${g.status}: ${JSON.stringify(gj).slice(0, 200)}`);
    else { const cand = gj?.candidates?.[0]; raw = String(cand?.content?.parts?.[0]?.text ?? '').trim(); finish = String(cand?.finishReason ?? ''); if (!raw) errore = `risposta vuota (${finish || 'n/d'})`; }
  } catch (e) {
    errore = (e as Error).name === 'AbortError' ? `timeout dopo ${TIMEOUT_MS / 1000} s` : scrub((e as Error).message.slice(0, 200));
  } finally { clearTimeout(timer); }
  const ms = Date.now() - t0;
  let proposta: Row | null = null;
  if (!errore) {
    try { proposta = normalizza(target, JSON.parse(raw) as Row, contesto); } catch { errore = `JSON non leggibile (${finish || 'n/d'})`; }
  }
  const { data: log, error: lErr } = await sb.from('ai_compila_log').insert({ chi, email, target, n_immagini: parti.length, input_hash: inputHash, testo: testo || null, output: proposta, modello, ms, esito: errore ? 'errore' : 'proposta', errore }).select('id').single();
  if (lErr) console.error('ai_compila_log non scritto:', lErr.message);
  if (errore || !proposta) return json({ error: 'ai_failed: ' + (errore ?? 'proposta vuota'), ai_log_id: log?.id ?? null }, 503);
  return json({ ok: true, ai_log_id: log?.id ?? null, target, proposta, modello, ms, n_immagini: parti.length });
});
