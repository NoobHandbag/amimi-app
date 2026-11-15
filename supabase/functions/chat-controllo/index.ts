// chat-controllo ctl-1 (2026-11-15): il controllo giornaliero in sola lettura dell'HTML della home, chat del sito Fase 1
// pezzo 8 (docs/PROPOSTA_chat_sito.md 4.6 punto 2, 8.10 riga 12, 13.4 test 19, 13.5). Edge nuova (Regola 19): push-eventi
// non fa fetch diretti per contratto (test 78 di tests/push_eventi_core.mjs) e chat-api e' l'endpoint pubblico; qui si
// legge una pagina e si scrive UNA riga di salute, la push la manda push-eventi (chat_salute `embed:<giorno>`) leggendo
// quella riga, come sistema_cs_sync_fermo legge la riga di cs-sync.
//
// Le quattro verifiche, sulla pagina scelta da app_flags.chat_controllo_home:
//   (1) c'e' il marcatore del nostro embed (id fisso di blocks/chat-embed.liquid);
//   (2) "Modalita' prova" come atteso: ACCESA sulla copia di prova (per scelta, fino al go-live), SPENTA su amimi.it;
//   (3) non c'e' l'embed di Inbox (`shopify-chat-app-embed-data`): sulla copia Inbox e' spento, come su amimi.it dopo il
//       go-live;
//   (4) amimi.it/apps/chat/config risponde con firma valida (una invocazione di chat-api al giorno): vale per tutte e due,
//       perche' il proxy e' del negozio e non del tema.
// Valori di chat_controllo_home: `copia` (fino al go-live: la copia "PROVA chat, non pubblicare" dal link d'anteprima per
// i visitatori in chat_controllo_anteprima, valore NON pubblico, mai nel repo), `amimi.it` (dal go-live: il passaggio e'
// questo solo valore, checklist del go-live), `spento` (o chiave assente: nessun controllo, nessuna riga).
// Niente falsi allarmi prima del go-live: si controlla la copia e mai amimi.it, dove l'embed e' spento per scelta; un link
// d'anteprima scaduto (Shopify lo tiene 2 giorni, poi 410) o assente lascia la copia "non controllata" in una riga `ok`
// senza push; un link che non apre la copia (tema pubblicato, rete) e' un `warn` senza push. Con una pagina davvero
// controllata ogni verifica mancata, e su amimi.it anche la home non leggibile, e' un `error` e diventa la push. La (4)
// non dipende dal link: se manca e' sempre un `error`.
//
// Chiamate (POST JSON, verify_jwt = false in supabase/config.toml):
//   controlla {pin}            cron ogni giorno alle 08:07 UTC (migr 0196), PIN neutro come tutti i cron: una volta al
//                              giorno, se la riga di oggi c'e' gia' risponde `fatto_oggi` senza nessuna chiamata fuori.
//   controlla {forza: true}    solo con la chiave di servizio: rifa il controllo e riscrive la riga di oggi (il giorno del
//                              go-live, o dopo aver rinnovato il link).
//   anteprima {}               solo con la chiave di servizio: il controllo senza scrivere niente, con l'esito per verifica.
// Scrive SOLO la propria riga health_log `chat_controllo` (una per giorno UTC, dopo il refresh delle 06:00 UTC). Legge
// app_flags (le sole due chiavi qui sotto) e app_config.pin_hash. Nessuna scrittura in tabelle di dati, nessun change_log.
// Risposte, log e label: solo esiti e cause scritte nel codice; mai il link d'anteprima, mai pezzi dell'HTML o del corpo di
// config. La label e' leggibile da anon (pagina Salute): solo testo fisso.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

// ==== PURE:chat-controllo BEGIN ====
const VERSIONE = 'ctl-1';
const K_SALUTE = 'chat_controllo';
const FLAG_MODO = 'chat_controllo_home';
const FLAG_ANTEPRIMA = 'chat_controllo_anteprima';
const URL_AMIMI = 'https://amimi.it/';
const URL_CONFIG = 'https://amimi.it/apps/chat/config';
// il link per i visitatori di Shopify: https://<token>-<id del negozio>.shopifypreview.com, niente percorso ne' query
const ANTEPRIMA_RE = /^https:\/\/[a-z0-9]{6,40}-[0-9]{6,15}\.shopifypreview\.com\/?$/;
const MARCATORE = 'id="amimi-chat-embed"';
const INBOX = 'shopify-chat-app-embed-data';
const HTML_MAX = 4 * 1024 * 1024;
const CONFIG_MAX = 65536;
const TIMEOUT_MS = 10000;
const RITENTA_MS = 2000;
const CORPO_MAX_BYTE = 2048;
const UA = 'Amimi-ControlloHome/1 (+https://amimi.it)';
type Modo = 'copia' | 'amimi.it';
const ATTESE: Record<Modo, { prova: 'true' | 'false' }> = { copia: { prova: 'true' }, 'amimi.it': { prova: 'false' } };
const MODO_TESTO: Record<Modo, string> = { copia: 'copia di prova del tema', 'amimi.it': 'home di amimi.it' };
const PAGINA_TESTO: Record<string, string> = {
  senza_link: 'pagina non controllata (nessun link d\'anteprima)',
  link_non_valido: 'pagina non controllata (link d\'anteprima non valido)',
  scaduta: 'pagina non controllata (link d\'anteprima scaduto)',
  non_raggiungibile: 'pagina non controllata (anteprima non raggiungibile)',
  non_e_la_copia: 'pagina non controllata (il link non apre la copia di prova)',
};
// pagine "non controllate" che sono attese prima del go-live (il link vale 2 giorni e si rinnova solo per le prove): ok
const PAGINA_ATTESA = ['senza_link', 'scaduta'];

type Scaricato = { stato: number | null; testo: string | null };
type Analisi = { ruolo: string | null; marcatore: boolean; prova: 'true' | 'false' | null; inbox: boolean };
type Esito = {
  modo: Modo; pagina: string; http: number | null; ruolo: string | null; marcatore: boolean | null; prova: string | null;
  inbox: boolean | null; config: string; mancano: string[]; severity: 'ok' | 'warn' | 'error'; label: string; n: number;
};

class ErroreDb extends Error {
  causa: string;
  constructor(causa: string) { super(causa); this.causa = causa; }
}

const HEADER: Record<string, string> = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: HEADER });
const giornoUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const esadecimale = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
async function sha256hex(s: string): Promise<string> {
  return esadecimale(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))));
}
// come push-api e chat-send: nessun ritorno dentro il ciclo, stessa durata a lunghezze diverse
function ugualeCostante(a: string, b: string): boolean {
  const x = new TextEncoder().encode(String(a ?? '')), y = new TextEncoder().encode(String(b ?? ''));
  const n = Math.max(x.length, y.length);
  let d = x.length ^ y.length;
  for (let i = 0; i < n; i++) d |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return n > 0 && d === 0;
}

// il valore del flag: solo i due modi noti; tutto il resto (assente, 'spento', storto) = nessun controllo
function modoDi(v: unknown): Modo | null {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return s === 'copia' || s === 'amimi.it' ? s : null;
}

// Cosa dice l'HTML. Il ruolo del tema da `Shopify.theme = {...}` (main = pubblicato, unpublished = una copia): una copia
// scaduta che finisse sul tema pubblicato non passa per la copia. Il marcatore e' l'id fisso del blocco; "Modalita' prova"
// e' data-prova del SUO tag (true/false scritto da Liquid). Inbox: il JSON dei dati del suo embed.
function analizza(html: string): Analisi {
  const t = html.indexOf('Shopify.theme');
  const m = t >= 0 ? /"role"\s*:\s*"([a-z_]{1,20})"/.exec(html.slice(t, t + 800)) : null;
  const i = html.indexOf(MARCATORE);
  let prova: 'true' | 'false' | null = null;
  if (i >= 0) {
    const a = html.lastIndexOf('<', i), b = html.indexOf('>', i);
    const tag = a >= 0 && b > i ? html.slice(a, b) : '';
    const p = /\sdata-prova="(true|false)"/.exec(tag);
    prova = p ? (p[1] as 'true' | 'false') : null;
  }
  return { ruolo: m ? m[1] : null, marcatore: i >= 0, prova, inbox: html.includes(INBOX) };
}

// La risposta di config attraverso il proxy: 200 JSON {ok: true, versione: 'api-N', attiva: bool} solo con la firma di
// Shopify accettata da chat-api. 200 {ok: false, state: 'needs_secret'} = secret del proxy assente; 401 = firma
// rifiutata; un 5xx della edge il proxy lo trasforma in una pagina 500 HTML (spike 13.3).
function esitoConfig(r: Scaricato): string {
  if (r.stato === null || r.testo === null) return 'senza_risposta';
  if (r.stato === 401) return 'firma_rifiutata';
  if (r.stato !== 200) return `http_${r.stato}`;
  let d: unknown;
  try { d = JSON.parse(r.testo); } catch { return 'risposta_non_valida'; }
  const o = d !== null && typeof d === 'object' && !Array.isArray(d) ? d as Record<string, unknown> : {};
  if (o.ok === false && o.state === 'needs_secret') return 'secret_mancante';
  return o.ok === true && typeof o.versione === 'string' && /^api-[0-9]{1,4}$/.test(o.versione) && typeof o.attiva === 'boolean' ? 'ok' : 'risposta_non_valida';
}
const CONFIG_TESTO: Record<string, string> = {
  senza_risposta: 'senza risposta', firma_rifiutata: 'firma rifiutata', secret_mancante: 'secret del proxy assente', risposta_non_valida: 'risposta non valida',
};
const configTesto = (c: string) => CONFIG_TESTO[c] ?? (/^http_[0-9]{3}$/.test(c) ? `HTTP ${c.slice(5)}` : 'errore');

// Il verdetto, PURE: dalla pagina scaricata (o dal motivo per cui non lo e'), dal modo e dall'esito di config.
function valuta(modo: Modo, pag: { motivo: string | null; r: Scaricato | null }, config: string): Esito {
  const mancano: string[] = [];
  let pagina = pag.motivo ?? 'controllata';
  let a: Analisi | null = null;
  const http = pag.r?.stato ?? null;
  if (!pag.motivo && pag.r) {
    const r = pag.r;
    if (modo === 'copia' && (r.stato === 404 || r.stato === 410)) pagina = 'scaduta';
    else if (r.stato !== 200 || r.testo === null) pagina = modo === 'copia' ? 'non_raggiungibile' : 'home_non_leggibile';
    else {
      a = analizza(r.testo);
      if (modo === 'copia' && a.ruolo !== 'unpublished') { pagina = 'non_e_la_copia'; a = null; }
    }
  }
  const parti: string[] = [];
  if (a) {
    const atteso = ATTESE[modo].prova;
    if (!a.marcatore) { mancano.push('marcatore'); parti.push('manca l\'embed della chat'); }
    else if (a.prova === null) { mancano.push('prova'); parti.push('Modalita\' prova non leggibile'); }
    else if (a.prova !== atteso) { mancano.push('prova'); parti.push(atteso === 'true' ? 'embed non in Modalita\' prova' : 'embed in Modalita\' prova'); }
    if (a.inbox) { mancano.push('inbox'); parti.push('c\'e\' la chat di Inbox'); }
    if (!mancano.length) parti.push(atteso === 'true' ? 'embed presente in Modalita\' prova, Inbox assente' : 'embed presente, Modalita\' prova spenta, Inbox assente');
  } else if (pagina === 'home_non_leggibile') {
    mancano.push('home');
    parti.push(`home non leggibile (${http === null ? 'senza risposta' : `HTTP ${http}`})`);
  } else parti.push(PAGINA_TESTO[pagina] ?? 'pagina non controllata');
  if (config === 'ok') parti.push('config con firma valida');
  else { mancano.push('config'); parti.push(`config senza firma valida (${configTesto(config)})`); }
  const severity = mancano.length ? 'error' : a || PAGINA_ATTESA.includes(pagina) ? 'ok' : 'warn';
  return { modo, pagina, http, ruolo: a?.ruolo ?? null, marcatore: a ? a.marcatore : null, prova: a ? a.prova : null, inbox: a ? a.inbox : null,
    config, mancano, severity, label: `Chat del sito, ${MODO_TESTO[modo]}: ${parti.join('; ')}`, n: mancano.length };
}

type Rete = { scarica: (url: string, accetta: string, max: number) => Promise<Scaricato>; dormi: (ms: number) => Promise<void> };
// Una lettura idempotente ritenta UNA volta (Regola 20d): senza risposta o 5xx. Un 404 o 410 e' una risposta.
async function conRitento(rete: Rete, url: string, accetta: string, max: number): Promise<Scaricato> {
  const r = await rete.scarica(url, accetta, max);
  if (r.stato !== null && r.stato < 500 && r.testo !== null) return r;
  await rete.dormi(RITENTA_MS);
  return await rete.scarica(url, accetta, max);
}

async function controllo(modo: Modo, anteprima: string, rete: Rete): Promise<Esito> {
  const link = anteprima.trim();
  const motivo = modo === 'copia' ? (!link ? 'senza_link' : !ANTEPRIMA_RE.test(link) ? 'link_non_valido' : null) : null;
  const url = modo === 'amimi.it' ? URL_AMIMI : link;
  const [pag, cfg] = await Promise.all([
    motivo ? Promise.resolve(null) : conRitento(rete, url, 'text/html', HTML_MAX),
    conRitento(rete, URL_CONFIG, 'application/json', CONFIG_MAX),
  ]);
  return valuta(modo, { motivo, r: pag }, esitoConfig(cfg));
}

type Riga = { day: string; k: string; label: string; n: number; severity: string };
interface Db {
  flags(): Promise<{ modo: string; anteprima: string }>;
  pinOk(pin: string): Promise<boolean>;
  rigaDiOggi(giorno: string): Promise<boolean>;
  scrivi(r: Riga): Promise<void>;
}
type Ambiente = { ora: number; servizio: string; db: Db; rete: Rete };

// solo i campi dell'esito: niente link, niente HTML
const pubblico = (e: Esito) => ({ modo: e.modo, pagina: e.pagina, http: e.http, ruolo: e.ruolo, marcatore: e.marcatore, prova: e.prova, inbox: e.inbox,
  config: e.config, mancano: e.mancano, severity: e.severity, n: e.n, label: e.label });

async function leggiCorpo(req: Request): Promise<Record<string, unknown> | null> {
  if (Number(req.headers.get('content-length') ?? 0) > CORPO_MAX_BYTE) return null;
  const t = await req.text();
  if (t.length > CORPO_MAX_BYTE) return null;
  try {
    const d = JSON.parse(t);
    return d !== null && typeof d === 'object' && !Array.isArray(d) ? d as Record<string, unknown> : null;
  } catch { return null; }
}

async function gestisci(req: Request, amb: Ambiente): Promise<Response> {
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);
  const d = await leggiCorpo(req);
  if (!d) return json({ ok: false, error: 'json_non_valido' }, 400);
  const authz = req.headers.get('Authorization') ?? '';
  const bearer = authz.toLowerCase().startsWith('bearer ') ? authz.slice(7).trim() : '';
  const servizio = bearer !== '' && amb.servizio !== '' && ugualeCostante(bearer, amb.servizio);
  const forza = d.forza === true;
  try {
    if (d.action === 'anteprima' || (d.action === 'controlla' && forza)) {
      if (!servizio) return json({ ok: false, error: 'non_autorizzato' }, 401);
    } else if (d.action === 'controlla') {
      if (!servizio && !(typeof d.pin === 'string' && d.pin !== '' && await amb.db.pinOk(d.pin))) return json({ ok: false, error: 'non_autorizzato' }, 401);
    } else return json({ ok: false, error: 'azione_sconosciuta' }, 400);
    const f = await amb.db.flags();
    const modo = modoDi(f.modo);
    if (!modo) return json({ ok: true, versione: VERSIONE, saltato: 'spento' });
    const giorno = giornoUtc(amb.ora);
    const scrive = d.action === 'controlla';
    // una volta al giorno: la riga di oggi c'e' gia' = nessuna chiamata fuori (il PIN e' pubblico)
    if (scrive && !forza && await amb.db.rigaDiOggi(giorno)) return json({ ok: true, versione: VERSIONE, saltato: 'fatto_oggi' });
    const e = await controllo(modo, f.anteprima, amb.rete);
    if (scrive) await amb.db.scrivi({ day: giorno, k: K_SALUTE, label: e.label, n: e.n, severity: e.severity });
    console.log(JSON.stringify({ fn: 'chat-controllo', azione: d.action, modo: e.modo, pagina: e.pagina, http: e.http, config: e.config, mancano: e.mancano, severity: e.severity }));
    return json({ ok: true, versione: VERSIONE, scritto: scrive, esito: pubblico(e) });
  } catch (x) {
    const causa = x instanceof ErroreDb ? x.causa : 'eccezione';
    console.error('chat-controllo: ' + causa);
    return json({ ok: false, error: 'riprova', causa }, 503);
  }
}
// ==== PURE:chat-controllo END ====

// ---- adattatori (service role). Letture con un ritentativo, scritture mai (Regola 20d). ----
const retryOnce = async <T extends { error: unknown }>(fn: () => PromiseLike<T>): Promise<T> => {
  const r = await fn();
  if (!r.error) return r;
  await new Promise((ok) => setTimeout(ok, 300));
  return await fn();
};
const codice = (e: unknown): string => {
  const c = (e as { code?: unknown } | null)?.code;
  return typeof c === 'string' && /^[A-Z0-9]{1,10}$/.test(c) ? c : '?';
};
const fallito = (causa: string, e: unknown): ErroreDb => {
  console.error('chat-controllo: ' + causa, codice(e));
  return new ErroreDb(causa);
};

function dbSupabase(sb: SupabaseClient): Db {
  return {
    async flags() {
      // solo le due chiavi, mai un filtro largo (app_flags contiene segreti, CONOSCENZA 31-10)
      const { data, error } = await retryOnce(() => sb.from('app_flags').select('key, value').in('key', [FLAG_MODO, FLAG_ANTEPRIMA]).limit(3));
      if (error) throw fallito('flag non letti', error);
      const v: Record<string, string> = {};
      for (const r of (data ?? []) as { key: string; value: unknown }[]) v[r.key] = typeof r.value === 'string' ? r.value : '';
      return { modo: v[FLAG_MODO] ?? '', anteprima: v[FLAG_ANTEPRIMA] ?? '' };
    },
    async pinOk(pin) {
      const { data, error } = await retryOnce(() => sb.from('app_config').select('pin_hash').eq('id', 1).limit(1));
      if (error) throw fallito('PIN non letto', error);
      const h = String(((data ?? [])[0] as { pin_hash?: unknown } | undefined)?.pin_hash ?? '');
      return h !== '' && ugualeCostante(await sha256hex(pin), h);
    },
    async rigaDiOggi(giorno) {
      const { data, error } = await retryOnce(() => sb.from('health_log').select('day').eq('day', giorno).eq('k', K_SALUTE).limit(1));
      if (error) throw fallito('riga di oggi non letta', error);
      return (data ?? []).length > 0;
    },
    async scrivi(r) {
      const { error } = await sb.from('health_log').upsert({ ...r, created_at: new Date().toISOString() }, { onConflict: 'day,k' });
      if (error) throw fallito('health_log non scritto', error);
    },
  };
}

// Il corpo si legge a pezzi e si ferma al tetto (null = troppo grande); nessun cookie, nessuna credenziale.
async function scarica(url: string, accetta: string, max: number): Promise<Scaricato> {
  try {
    const r = await fetch(url, { method: 'GET', redirect: 'follow', headers: { 'User-Agent': UA, Accept: accetta }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!r.body) return { stato: r.status, testo: '' };
    const reader = r.body.getReader();
    const pezzi: Uint8Array[] = [];
    let tot = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      tot += value.byteLength;
      if (tot > max) { await reader.cancel(); return { stato: r.status, testo: null }; }
      pezzi.push(value);
    }
    const out = new Uint8Array(tot);
    let at = 0;
    for (const p of pezzi) { out.set(p, at); at += p.byteLength; }
    return { stato: r.status, testo: new TextDecoder().decode(out) };
  } catch {
    return { stato: null, testo: null };
  }
}

const env = (k: string) => (Deno.env.get(k) ?? '').trim();
const DB = dbSupabase(createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } }));
const RETE: Rete = { scarica, dormi: (ms) => new Promise((ok) => setTimeout(ok, ms)) };

Deno.serve((req) => gestisci(req, { ora: Date.now(), servizio: env('SUPABASE_SERVICE_ROLE_KEY'), db: DB, rete: RETE }));
