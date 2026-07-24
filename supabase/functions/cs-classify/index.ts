// cs-classify — tool assistenza clienti, FASE 2: auto-categorizzazione + urgenza.
// Design: Cowork12/projects/Servizio_Clienti_2026-06/DESIGN_Tool_Assistenza_Amimi_V1_2026-07-20.md (6.2, 6.4).
//
// DECOUPLED dall'ingest (cs-sync): se Gemini e' giu' l'ingest continua, le card restano "da classificare".
// Azioni (PIN-gated, verify_jwt=false, come le altre edge; service_role scrive cs_conversations):
//   - classify (default): pesca fino a MAX_PER_RUN conversazioni MAI TENTATE (categoria IS NULL AND
//       categoria_source IS NULL) e canale != 'rumore' (parse_failed escluse). Gemini flash-lite, JSON,
//       temp 0, + REGOLE deterministiche di urgenza. Sotto soglia / vuota -> categoria NULL, source='ai_low'
//       ("da confermare", NON piu' ripescata: si corregge a mano via cs-api). Errore Gemini = la salta.
//   - classify_text: classifica un TESTO grezzo, SENZA scrivere. Serve al benchmark.
//   - dryRun=true su classify: classifica ma NON scrive (anteprima, senza id/PII).
import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
async function sha256hex(s: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const MODEL = 'gemini-flash-lite-latest';
const MAX_PER_RUN = 10;          // sotto la quota free 15 RPM; il cron drena il backlog in pochi giri
const CONF_THRESHOLD = 0.6;      // sotto = "da confermare" (categoria NULL, source ai_low)
const TEXT_MAX = 2400;

// Tassonomia (design 6.2). Il valore memorizzato in cs_conversations.categoria e' una di queste.
// 14a categoria "Modifica / correzione indirizzo" aggiunta il 2026-07-23 (OK owner): era il gap noto
// nella ricerca (indirizzi errati/incompleti finivano in Cambio/Spedizione/Altro).
const CANON = [
  'Spedizione e stato ordine',
  'Restock e disponibilita',
  'Ritiro, negozio, appuntamenti',
  'Codice sconto',
  'Personalizzazione e cerimonia',
  'Gift card e account',
  'Altro / richiesta varia',
  'Reso e rimborso',
  'Cambio e prodotto errato',
  'Modifica / correzione indirizzo',
  'Info prodotto',
  'Riparazione',
  'Pagamento',
  'Collaborazioni e B2B',
];
// normalizza per il match (accenti/apostrofi/punteggiatura/spazi via): la label Gemini torna alla canonica.
const stripMarks = (s: string): string => [...s.normalize('NFD')].filter((ch) => { const c = ch.codePointAt(0)!; return c < 0x300 || c > 0x36f; }).join('');
const norm = (s: string): string => stripMarks((s || '').toLowerCase()).replace(/['`]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const CANON_BY_NORM = new Map(CANON.map((c) => [norm(c), c]));
function toCanon(raw: unknown): string {
  const n = norm(String(raw ?? ''));
  if (!n) return '';
  if (CANON_BY_NORM.has(n)) return CANON_BY_NORM.get(n)!;
  // match tollerante: la prima canonica il cui insieme di parole e' contenuto o contiene (per varianti brevi)
  for (const [cn, orig] of CANON_BY_NORM) { if (cn.includes(n) || n.includes(cn)) return orig; }
  return '';
}

const PROMPT = `Sei il classificatore del servizio clienti di "Amimi'" (borse artigianali, Milano; vende online su Shopify e in negozio/pop-up). Classifichi UN messaggio di un cliente in UNA delle 14 categorie. Rispondi SOLO con JSON valido, niente altro testo.

Categorie (usa ESATTAMENTE una di queste etichette in "categoria"):
- "Spedizione e stato ordine": dov'e' il mio ordine, tracking, tempi di consegna, corriere, ordine non arrivato.
- "Restock e disponibilita": un prodotto/colore esaurito tornera' disponibile? e' disponibile? quando?
- "Ritiro, negozio, appuntamenti": orari negozio, siete aperti, ritiro in sede, appuntamento in showroom, indirizzo/dove siete.
- "Codice sconto": codice promo non funziona, newsletter/sconto primo acquisto non arriva, richiesta di uno sconto.
- "Personalizzazione e cerimonia": borse su misura/personalizzate, O QUALSIASI richiesta legata a un evento/cerimonia (matrimonio, sposa, damigelle, laurea, battesimo) come occasione della borsa - anche se cita un modello o chiede disponibilita'. Include le richieste che arrivano dal FORM EVENTO del sito.
- "Gift card e account": gift card / buono regalo, area riservata / account.
- "Reso e rimborso": voglio rendere, ho spedito un reso, chiedo il rimborso.
- "Cambio e prodotto errato": voglio cambiare taglia/colore/modello, ho ricevuto il prodotto sbagliato/difettoso appena arrivato.
- "Modifica / correzione indirizzo": indirizzo di spedizione errato o incompleto, o cambio dell'indirizzo di consegna di un ordine (manca il civico, CAP sbagliato, cambio destinazione). NON e' un cambio di prodotto.
- "Info prodotto": domande sul prodotto (misure, materiale, ci sta il telefono, esiste in un altro colore) senza un ordine in corso.
- "Riparazione": prodotto rovinato/usurato da riparare, sostituzione catena/manico.
- "Pagamento": problema col pagamento (PayPal/carta), non so se l'ordine e' andato a buon fine.
- "Collaborazioni e B2B": proposte di collaborazione/partnership/influencer, wholesale/rivenditori, agenzie, spam SEO/marketing, messaggi automatici o bot, elogi generici del negozio con offerta vaga ("bel negozio, posso aiutarti a vendere di piu'?", "is this store live?"). NON e' un cliente che vuole comprare.
- "Altro / richiesta varia": tutto cio' che non rientra sopra, richieste generiche o non commerciali.

Esempi (testo cliente -> categoria):
"Agata floral pink embroidery tornera' disponibile?" -> Restock e disponibilita
"mai ricevuto il tracking, con quale corriere avete spedito?" -> Spedizione e stato ordine
"siete aperti oggi? posso ritirare in Plinio?" -> Ritiro, negozio, appuntamenti
"il codice AMIMILANO10 non e' valido dopo l'iscrizione alla newsletter" -> Codice sconto
"vorrei una borsa su misura per un matrimonio" -> Personalizzazione e cerimonia
"ho ordinato la nude ma vorrei cambiarla con un'altra" -> Cambio e prodotto errato
"ho sbagliato l'indirizzo, manca il numero civico: potete correggerlo?" -> Modifica / correzione indirizzo
"ho inviato un reso, quando arriva il rimborso?" -> Reso e rimborso
"la Annie esiste in argento? ci sta un iPhone 17 Pro Max?" -> Info prodotto
"la catena e' da sostituire, posso venire in showroom?" -> Riparazione
"PayPal mi da' errore, il pagamento risulta sospeso" -> Pagamento
"come funziona la gift card?" -> Gift card e account
"proposta di collaborazione per aumentare il vostro traffico SEO" -> Collaborazioni e B2B
"bel negozio! posso aiutarti ad aumentare le vendite?" -> Collaborazioni e B2B
"is this store live?" -> Collaborazioni e B2B
"cerco una borsa per il mio matrimonio a settembre, per me e le damigelle" -> Personalizzazione e cerimonia
"la Lea rossa e' ancora disponibile? mi servirebbe per un matrimonio" -> Restock e disponibilita
"vorrei ritirare in negozio invece della spedizione" -> Ritiro, negozio, appuntamenti
"volevo solo sapere una cosa generica" -> Altro / richiesta varia

Regole:
- "categoria_confidence": numero tra 0 e 1 (quanto sei sicuro).
- Se sei incerto tra piu' categorie o il testo e' troppo vago/vuoto, metti "categoria": "" con confidence bassa. NON inventare una categoria con sicurezza finta.
- Evento/cerimonia: se il cliente vuole una borsa SU MISURA o una borsa per un evento SENZA un prodotto preciso -> "Personalizzazione e cerimonia". MA se chiede la DISPONIBILITA' di un prodotto SPECIFICO gia' esistente (anche se lo vuole per un evento) -> "Restock e disponibilita"; se e' spedizione/reso/cambio di un ordine gia' fatto -> quelle categorie.
- "quando torna / e' ancora disponibile" un prodotto -> Restock; "esiste in X colore / che misure ha / ci sta Y" -> Info prodotto. Ritiro in negozio/showroom -> Ritiro; consegna a casa/tracking/corriere -> Spedizione.
- "lingua": "it" o "en".
- "urgente": true SOLO se il testo indica un evento con DATA vicina (matrimonio/cerimonia/laurea con data esplicita) OPPURE un tono chiaramente arrabbiato/esasperato. Altrimenti false.
- "urgenza_motivo": se urgente=true, frase breve col perche' (es. "matrimonio 27-07", "tono arrabbiato"); "" se urgente=false.
- "flags": lista, sottoinsieme di ["chiusura","reclamo_assistenza"]. "chiusura" = solo un ringraziamento/conferma senza richiesta (es. "arrivata, grazie"). "reclamo_assistenza" = lamentela sul servizio/assistenza ("nessuno risponde"). [] se nessuno.

Formato ESATTO della risposta:
{"categoria":"","categoria_confidence":0.0,"lingua":"it","urgente":false,"urgenza_motivo":"","flags":[]}

Testo del cliente:
`;

type Row = Record<string, unknown>;
type AiOut = { categoria: string; categoria_confidence: number; lingua: string; urgente: boolean; urgenza_motivo: string; flags: string[] };

function cleanJson(t: string): string {
  return (t || '').trim().replace(/^```(json)?/i, '').replace(/```$/, '').trim();
}

async function geminiJson(prompt: string, key: string): Promise<string> {
  const g = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0, maxOutputTokens: 400, responseMimeType: 'application/json' } }),
  });
  const gj = await g.json();
  if (!g.ok) throw new Error('Gemini ' + g.status + ': ' + JSON.stringify(gj).slice(0, 200));
  return String(gj?.candidates?.[0]?.content?.parts?.[0]?.text ?? '');
}

// Solo lo strato AI: categoria (validata sulla tassonomia) + urgenza AI + flags AI. Nessuna regola, nessun DB.
async function classifyText(text: string, key: string): Promise<AiOut> {
  const raw = await geminiJson(PROMPT + text.slice(0, TEXT_MAX), key);
  let p: Row = {};
  try { p = JSON.parse(cleanJson(raw)) as Row; } catch { p = {}; }
  const conf = Number(p.categoria_confidence);
  const flagsIn = Array.isArray(p.flags) ? p.flags.map((x) => String(x)) : [];
  const flags = flagsIn.filter((f) => f === 'chiusura' || f === 'reclamo_assistenza');
  return {
    categoria: toCanon(p.categoria),
    categoria_confidence: Number.isFinite(conf) ? Math.max(0, Math.min(1, conf)) : 0,
    lingua: p.lingua === 'en' ? 'en' : 'it',
    urgente: p.urgente === true,
    urgenza_motivo: String(p.urgenza_motivo ?? '').slice(0, 200),
    flags,
  };
}

// --- Regole deterministiche di urgenza (design 6.4): certe, sul testo/metadati, non AI ---
const RE_DISPUTA = /chargeback|contestazion|\bdisputa\b|rimborso non (ancora )?ricevut|non ho (mai |ancora |piu' )?ricevuto (il |alcun )?rimbors|mi rivolg[oò] alla banca|segnal(o|er[oò]) alla banca|contest(o|azione) (il )?pagament|apert[oa] una (contestazione|disputa)|pratica paypal/i;
const RE_INLOCO = /sono (qui|qua) (fuori|davanti|sotto)|sono al portone|sono davanti (al|allo) (negozio|showroom)|sono in negozio|vi aspetto (qui|fuori|sotto)|sono sotto (il |al )?(negozio|showroom|casa)/i;

type RuleUrg = { urgente: boolean; motivo: string; flags: string[] };
function ruleUrgency(fullText: string, opts: { inboundCount: number; outboundCount: number; stato: string; lastDir: string | null; lastAt: string | null; statoAt: string | null }): RuleUrg {
  const flags = new Set<string>();
  let urgente = false; let motivo = '';
  const set = (m: string) => { urgente = true; if (!motivo) motivo = m; };
  if (RE_DISPUTA.test(fullText)) { set('rischio disputa'); flags.add('reclamo_assistenza'); }
  if (RE_INLOCO.test(fullText)) { set('cliente in loco'); }
  const reopened = opts.stato === 'fatto' && opts.lastDir === 'in' && !!opts.lastAt && (!opts.statoAt || opts.lastAt > opts.statoAt);
  if (reopened) { set('thread riaperto (sollecito)'); flags.add('sollecito'); }
  else if (opts.inboundCount >= 2 && opts.outboundCount === 0) { set('2+ messaggi senza nostra risposta'); flags.add('sollecito'); }
  return { urgente, motivo, flags: [...flags] };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const body = await req.json().catch(() => ({}));
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const { data: cfg } = await sb.from('app_config').select('pin_hash').eq('id', 1).single();
  if (!cfg?.pin_hash || !body.pin || (await sha256hex(String(body.pin))) !== cfg.pin_hash) return json({ error: 'PIN errato' }, 401);

  const flags: Record<string, string> = {};
  const { data: frows } = await sb.from('app_flags').select('key,value').in('key', ['gemini_api_key', 'cs_enabled']);
  for (const r of frows ?? []) flags[r.key] = r.value ?? '';
  const key = flags.gemini_api_key;
  if (!key) return json({ ok: false, needs_key: true, error: 'Gemini non configurato (app_flags.gemini_api_key).' });

  const action = String(body.action || 'classify');
  // da cron, se il tool e' spento (go-live owner) non si spende Gemini: la coda resta com'e'.
  if (action === 'classify' && String(body.source || 'manual') === 'cron' && flags.cs_enabled !== 'true') return json({ ok: true, skipped: 'disabled' });

  // --- classify_text: benchmark, nessuna scrittura ---
  if (action === 'classify_text') {
    const text = String(body.text || '').trim();
    if (!text) return json({ error: 'testo mancante' }, 422);
    try { return json({ ok: true, ...(await classifyText(text, key)) }); }
    catch (e) { return json({ ok: false, error: (e as Error).message }, 502); }
  }
  if (action !== 'classify') return json({ error: 'azione sconosciuta: ' + action }, 422);

  const dryRun = body.dryRun === true;
  const limit = Math.min(Number(body.limit) || MAX_PER_RUN, MAX_PER_RUN);

  // Coda da classificare: categoria mancante, non rumore, testo disponibile (parse_failed escluse).
  const { data: convs, error: qe } = await sb.from('cs_conversations')
    .select('id,canale,subject,snippet,lingua,stato,stato_at,last_direction,last_msg_at')
    .is('categoria', null).is('categoria_source', null).neq('canale', 'rumore').eq('parse_failed', false)
    .order('last_msg_at', { ascending: true, nullsFirst: true }).limit(limit);
  if (qe) return json({ ok: false, error: qe.message }, 500);
  if (!convs || convs.length === 0) return json({ ok: true, classified: 0, low: 0, remaining: 0 });

  let classified = 0, low = 0, failed = 0;
  const preview: Row[] = [];

  for (const c of convs) {
    // messaggi del thread: testo (per la classificazione) + conteggi direzione (per le regole)
    const { data: msgs } = await sb.from('cs_messages')
      .select('direction,body_text,sent_at,form_fields').eq('conversation_id', c.id as string)
      .order('sent_at', { ascending: true, nullsFirst: true });
    const inbound = (msgs ?? []).filter((m) => m.direction === 'in');
    const outboundCount = (msgs ?? []).filter((m) => m.direction === 'out').length;
    const lastIn = inbound.length ? inbound[inbound.length - 1] : null;
    const formTxt = lastIn?.form_fields ? Object.entries(lastIn.form_fields as Record<string, string>).map(([k, v]) => `${k}: ${v}`).join('\n') : '';
    const fullInbound = inbound.map((m) => String(m.body_text ?? '')).join('\n');
    const text = [c.subject ?? '', lastIn?.body_text ?? c.snippet ?? '', formTxt].filter(Boolean).join('\n').trim();

    let ai: AiOut;
    try { ai = await classifyText(text || String(c.subject ?? ''), key); }
    catch { failed++; continue; }   // Gemini giu' su questa: la salta, resta da classificare

    // Prior di canale (solo produzione, non nel benchmark): un form EVENTO e' per definizione una
    // richiesta di cerimonia; se l'AI non l'ha capito (vuoto o "Altro") lo instradiamo la' con confidence media.
    if (c.canale === 'form_evento' && (ai.categoria === '' || ai.categoria === 'Altro / richiesta varia')) {
      ai = { ...ai, categoria: 'Personalizzazione e cerimonia', categoria_confidence: Math.max(ai.categoria_confidence, 0.7) };
    }

    const rule = ruleUrgency([c.subject ?? '', fullInbound].join('\n'), {
      inboundCount: inbound.length, outboundCount, stato: String(c.stato ?? 'da_fare'),
      lastDir: (c.last_direction as string) ?? null, lastAt: (c.last_msg_at as string) ?? null, statoAt: (c.stato_at as string) ?? null,
    });

    const urgente = ai.urgente || rule.urgente;
    const urgenza_motivo = rule.motivo || (ai.urgente ? ai.urgenza_motivo : '');
    const flags = [...new Set([...ai.flags, ...rule.flags])];
    const hasCat = ai.categoria !== '' && ai.categoria_confidence >= CONF_THRESHOLD;
    const categoria = hasCat ? ai.categoria : null;
    const source = hasCat ? 'ai' : 'ai_low';
    if (!hasCat) low++; else classified++;

    if (dryRun) { preview.push({ categoria, source, conf: ai.categoria_confidence, urgente, flags }); continue; }   // no id/urgenza_motivo (no leak UUID/PII dietro PIN pubblico)

    const upd: Row = {
      categoria, categoria_source: source, categoria_confidence: ai.categoria_confidence,
      urgente, urgenza_motivo: urgente ? urgenza_motivo : null, flags,
    };
    if (!c.lingua) upd.lingua = ai.lingua;
    // guard anti-race: scrive SOLO se ancora non categorizzata. Una correzione manuale via cs-api
    // (categoria!=null, source='manuale') arrivata mentre Gemini girava NON deve essere sovrascritta.
    const { data: upRows, error: ue } = await sb.from('cs_conversations').update(upd).eq('id', c.id as string).is('categoria', null).select('id');
    if (ue) { failed++; continue; }
    if (!upRows || upRows.length === 0) continue;   // gia' corretta a mano nel frattempo: non toccare
    await sb.from('cs_events').insert({ conversation_id: c.id, azione: 'classify', chi: 'cs-classify', dettaglio: { categoria, source, confidence: ai.categoria_confidence, urgente, flags } });
  }

  // quante restano ancora da classificare (per sapere se il cron deve continuare a drenare)
  const { count: remaining } = await sb.from('cs_conversations')
    .select('id', { count: 'exact', head: true })
    .is('categoria', null).is('categoria_source', null).neq('canale', 'rumore').eq('parse_failed', false);

  return json({ ok: true, classified, low, failed, remaining: remaining ?? 0, ...(dryRun ? { dryRun: true, preview } : {}) });
});
