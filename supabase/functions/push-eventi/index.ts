// push-eventi v1 (2026-10-18): gli eventi che esistono gia' nei dati diventano notifiche native per profilo.
// v2 (2026-10-19): le push su una cliente dicono chi e' (nome, o email senza nome), decisione di Dan del 19-10 (Privacy, sotto).
// v3 (2026-10-21, OK di Dan in chat): spedizione_eccezione solo sugli stati del corriere che sono un problema vero
// (statoProblema: la classe della vista prendeva anche il transito normale); evento nuovo attivita_team (migr 0168, tema
// attivita): ordini, arrivi e conte di Benny e Ginni da change_log, UNA push per persona e tipo per giro (eseguiGruppi),
// con supplier_orders letto per i codici degli ordini. Anche change_log e supplier_orders si LEGGONO soltanto.
// v4 (2026-10-31, CASI_APERTI 53, blocco di Supabase del 30-31 ottobre): alla ripartenza dopo uno stallo si salta solo il
// pregresso vecchio, un evento delle ultime 2 ore parte (frescoRipartenzaMs, in pe-registro).
// v5 (2026-11-03, decisione di Dan del 03-11, CONOSCENZA sez. 1 "Notifiche dell'Area Membri", migr 0183): premia_da_approvare
// (tema premia, di Ginni che modera) una push per ogni look o recensione che entra in moderazione; premia_salute (tema
// sistema) loyalty_orders in errore, riscatto pending oltre 15 minuti, pool di codici sotto loyalty_pool_min; nel riepilogo
// di Ale le nuove iscritte del giorno, in quello di Ginni i contenuti da approvare. loyalty_ugc, loyalty_redemptions,
// loyalty_visits e v_loyalty_pool si LEGGONO soltanto.
// v6 (2026-11-06, decisione D-1 di Dan sulla chat del sito, PROPOSTA_chat_sito 8.1, migr 0185): sistema_senza_iscritti (tema
// sistema, evento di stato) una push al giorno per ogni tema di un evento acceso che non arriva a nessun telefono (nessun
// telefono lo ha, o e' spento in push_temi). Il 06-11 cs_urgente aveva 13 push `nessun_iscritto` e nessuna consegnata.
// push_subscriptions (solo conteggi) e push_temi si LEGGONO soltanto.
// v7 (2026-11-08, chat del sito Fase 1 pezzo 4, PROPOSTA_chat_sito 8.3-8.6 e 8.10, decisioni D-1, D-8, D-9 e D-12 di Dan,
// migr 0188): chat_sollecito (tema assistenza) a una chat senza risposta del team dopo il primo passo di
// chat_sollecito_ore (24 ore contate solo nei giorni lavorativi di chat_orari, consegnato solo dentro l'orario), e il
// nuovo tentativo della push di passaggio di chat-api rimasta `fallito` o `prenotato` (istanza morta, C7 del pezzo 2);
// chat_sollecito_scala (tema assistenza_scala, di Ale) al secondo passo (48 ore); chat_salute (tema sistema, evento di
// stato) sui guasti della chat (push di passaggio a nessuno o non partita, email di risposta non partita, email in coda,
// chat-api in errore, tetto delle chat del giorno, oltre 5.000 richieste, errori del widget). Testi dei solleciti col nome
// o l'email della cliente (D-9, solo da nomeCliente), mai il testo della chat; chat_salute solo conteggi e cause.
// chat_sessioni, chat_eventi, chat_messaggi e chat_contatori si LEGGONO soltanto.
// v8 (2026-11-09, decisione di Dan in chat, migr 0191): il riepilogo serale parte alle 22:00 di Roma invece che alle 18:30
// (ORA_RIEPILOGO_MIN; finestra 22:00-23:59, lunedi'-sabato come prima). Nient'altro cambia.
// v10 (2026-11-13, chat del sito Fase 1 pezzo 6, docs/PROPOSTA_chat_sito.md 7.6 punti 20-21 e D-11): le chat del sito
// proiettate in Assistenza (canale `chat_sito`, migr 0193). cs_urgente salta `chat_sito` (la push di una chat la manda
// chat-api al passaggio, un evento urgente arrivato comunque ne darebbe due); il riepilogo serale non conta le chat di
// prova (flag `prova`) ne' quelle gestite solo dalle risposte fisse (stato_by `bot`, D-11 "Concluse, fuori riepilogo").
// B4 del pezzo 4 deciso nel pezzo 6: una cliente che riscrive dopo una risposta del team apre in chat-api un passaggio
// nuovo, quindi i solleciti qui sotto ripartono da soli (una chiave per passaggio), senza codice nuovo.
// v9 (2026-11-09, chiesta da Dan in chat, migr 0192): stock_fermo (tema magazzino, di Benny e Ginni) quando un prodotto
// entra fra i pezzi a magazzino non in vendita sul sito (v_stock_fermo, migr 0190: pezzi disponibili, nessuna pagina
// Shopify attiva, fermi da almeno 3 giorni). Una push per giro con i prodotti nuovi (eseguiGruppi, un gruppo solo), dalle
// 9 di Roma, lunedi'-sabato; ogni lotto fermo (codice e data del pezzo piu' vecchio) avvisa una volta, poi resta la scheda
// della Home. Tema magazzino senza Topic (push-api v5): una push non ne sostituisce un'altra non ancora letta.
// Limiti accettati (Gate 2): se escono i pezzi piu' vecchi la data avanza e lo stesso prodotto avvisa di nuovo; un prodotto
// rimesso offline con la stessa data non avvisa piu' (resta la scheda della Home).
// Evento di stato: all'accensione i prodotti gia' fermi partono nella prima push. v_stock_fermo si LEGGE soltanto.
// Brief:Cowork12/_CLAUDE_CODE_INBOX/2026-10-18_BRIEF_push_eventi_per_profilo.md (decisioni di Dan del 18-10). Modulo push_*
// (Regola 19, migr 0166): scrive SOLO push_eventi_inviati (il registro), push_eventi (ultimo_giro_at, baseline_at) e la sua
// riga di telemetria in health_log (k = 'push_eventi', una per giorno UTC: Gate 3 del 18-10, un giro che fallisce deve
// vedersi, Regola 20a; la Regola 19 ammette la telemetria propria di una edge nuova). Tutto il resto (lead_*, cs_*, la riga
// cs_sync di health_log, shipping_status, ordini, cassa, prodotti) lo LEGGE soltanto. Le edge vive non si toccano: la
// spedizione passa da push-api con inviaPush di _shared/push.ts, mai dall'helper col ripiego, perche' finche' Benny e Ginni
// non hanno un telefono iscritto ogni push dell'Assistenza finirebbe su un canale non cifrato.
//
// Chiamata: POST {pin, action}. PIN = app_config.pin_hash come sales-guard. Il PIN dell'app e' pubblico ('x' nel web e nei
// cron, verificato il 18-10), quindi vale come cancello solo per `run`, che e' idempotente; `anteprima` restituisce chiavi e
// testi (numeri d'ordine, LDV, nomi dei negozi, dal 19-10 nomi o email delle clienti, id delle conversazioni) e vuole in
// piu' il Bearer della chiave di servizio.
//   run        (cron ogni 5 minuti) NO-OP se push_eventi_enabled o push_enabled non valgono 'true' (nessuna lettura degli
//              eventi, nessuna scrittura, neanche health_log); legge SOLO gli eventi con attivo = true. Risposta e log:
//              conteggi ed errori per evento, mai chiavi o testi delle push.
//   anteprima  nessun invio e nessuna scrittura: per ogni evento, acceso o no, cosa partirebbe adesso (chiavi, testi,
//              tema e persona) e perche' il resto no. `forza_riepilogo: true` calcola il riepilogo anche fuori orario.
//
// Ogni evento: candidati letti con .limit() ed error destrutturato (Regola 20), registro letto con .in() sulle sole chiavi,
// piano PURE (pianifica), poi per ogni invio: prenotazione su UNIQUE (evento, chiave) (chi non prenota salta), inviaPush,
// esito sulla riga. "Nessun iscritto" e' un esito finale, non un errore da ritentare. Prima accensione e ripartenza dopo
// uno stallo (ultimo giro oltre 2 ore fa): il pregresso si segna `saltato` senza inviare (motivo 'baseline' alla prima
// accensione, 'stallo' alla ripartenza: quelle sono push perse e la salute lo dice per 24 ore); dalla v4 alla ripartenza un
// evento delle ultime 2 ore non e' pregresso e parte come in un giro normale. Un candidato con l'evento piu' vecchio di 6
// ore non diventa una push. Tetto: 20 invii per giro, un invio parte solo nei primi 15 secondi del giro e
// un evento si comincia solo nei primi 30. Alla fine del giro UNA riga health_log (ok, warn, error) con soli nomi di eventi,
// conteggi e la causa scritta nel codice (mai il messaggio di PostgREST, che puo' citare valori di una riga); nello stesso
// giorno UTC la gravita' non scende mai, e la label tiene il primo problema del giorno. La freschezza del giro (edge ferma,
// cron spento) la controlla la funzione SQL push_eventi_salute della 0166, perche' una edge ferma non scrive niente.
// Privacy (vincolante). Decisione di Dan del 19-10, "RIMUOVI QUESTO. ANZI, DEVE DIRLO!!": rovescia la regola del 18-10
// (nessuna notifica con nome o email di una cliente). Le push su una cliente DEVONO dire chi e': cs_urgente e
// cs_cliente_ha_riscritto col nome (customer_name) o, senza nome, l'email (customer_email); spedizione_eccezione col nome
// (la vista non ha l'email). Passano solo da nomeCliente. Restano fuori: oggetto, snippet, riassunto e testo dei messaggi,
// il motivo d'urgenza scritto dall'AI, stato_by, il referente di un negozio, la label di cs_sync; le select non chiedono
// nemmeno quelle colonne. Ammessi anche: categoria, numero d'ordine, stato del corriere, conteggi, importi, nome
// commerciale del negozio B2B. Il riepilogo serale non porta dati delle clienti. Risposta del run, log, registro e
// health_log restano senza testi: il nome sta solo nella push (e nell'anteprima, che vuole la chiave di servizio).
// Blocchi PURE (base, tempo di Roma, candidati e messaggi, registro, giro, salute): `node tests/push_eventi_core.mjs`, che
// guida anche il resto della edge (letture, giro, run) con un client finto.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { inviaPush } from '../_shared/push.ts';
import type { EsitoPush } from '../_shared/push.ts';

// ==== PURE:pe-base BEGIN ====
const APP_URL = 'https://noobhandbag.github.io/amimi-app/';
const LINK_ASSISTENZA = APP_URL + '#assistenza';
const LINK_SALUTE = APP_URL + '#salute';
// v5 (03-11): la moderazione dell'Area Membri (scheda Recensioni, visibile anche a Ginni) e la dashboard Premia (di Ale)
const LINK_RECENSIONI = APP_URL + '#recensioni';
const LINK_PREMIA = APP_URL + '#premia';
// chiavi di PEOPLE del web, come il check di push_subscriptions (migr 0163) e CHI_AMMESSI di push-api
const CHI_PERSONE = ['Ale', 'Bene', 'Ginevra'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TEMA_RE = /^[a-z_]{2,32}$/;
// tema di ogni evento (righe di push_eventi della 0166); la riga a DB vince se e' una chiave valida
// (attivita_team dalla 0168 del 21-10, premia_da_approvare e premia_salute dalla 0183 del 03-11, sistema_senza_iscritti
// dalla 0185 del 06-11, i tre della chat del sito dalla 0188 dell'08-11, stock_fermo dalla 0192 del 09-11)
const TEMA_EVENTO: Record<string, string> = {
  b2b_risposta_negozio: 'negozi', cs_urgente: 'assistenza', cs_cliente_ha_riscritto: 'assistenza',
  spedizione_eccezione: 'spedizioni', sistema_cs_sync_fermo: 'sistema', riepilogo: 'riepilogo', attivita_team: 'attivita',
  premia_da_approvare: 'premia', premia_salute: 'sistema', sistema_senza_iscritti: 'sistema',
  chat_sollecito: 'assistenza', chat_sollecito_scala: 'assistenza_scala', chat_salute: 'sistema',
  stock_fermo: 'magazzino',
};
function temaDi(daDb: unknown, evento: string): string {
  return typeof daDb === 'string' && TEMA_RE.test(daDb) ? daDb : (TEMA_EVENTO[evento] ?? '');
}
// la scheda del negozio (Negozi.tsx, rotta #negozi/outreach/<id>), ad app chiusa e, dal Gate 3 del 18-10, anche ad app
// aperta (PushKeeper mette la rotta nell'URL); id non uuid = la pipeline
function linkNegozio(id: unknown): string {
  return typeof id === 'string' && UUID_RE.test(id) ? APP_URL + '#negozi/outreach/' + id.toLowerCase() : APP_URL + '#negozi/outreach';
}
// PIN contro pin_hash: nessun ritorno dentro il ciclo, stessa durata a lunghezze diverse (come push-api)
function ugualeCostante(a: string, b: string): boolean {
  const x = new TextEncoder().encode(String(a ?? '')), y = new TextEncoder().encode(String(b ?? ''));
  const n = Math.max(x.length, y.length);
  let d = x.length ^ y.length;
  for (let i = 0; i < n; i++) d |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return n > 0 && d === 0;
}
// acceso SOLO con la stringa 'true' (maiuscole e spazi tollerati), come flagVero di push-api: tutto il resto e' spento
function flagVero(v: unknown): boolean {
  return typeof v === 'string' && v.trim().toLowerCase() === 'true';
}
// testo che arriva dai dati (nome del negozio, categoria): controlli e a capo tolti, spazi compressi, taglio per punti di
// codice (un'emoji non si spezza). Non stringa = vuoto.
function pulisci(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  const s = Array.from(v, (c) => { const k = c.codePointAt(0) ?? 0; return k < 32 || (k >= 127 && k <= 159) || k === 8232 || k === 8233 ? ' ' : c; }).join('').replace(/\s+/g, ' ').trim();
  const cp = Array.from(s);
  return cp.length > max ? cp.slice(0, max).join('').trimEnd() : s;
}
function plurale(n: number, uno: string, tanti: string): string {
  return `${n} ${n === 1 ? uno : tanti}`;
}
// euro interi col punto delle migliaia (1.013); un valore non numerico vale 0
function euro(v: unknown): string {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return '0';
  return (n < 0 ? '-' : '') + String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}
// soglie di push_eventi.soglie (jsonb): un numero nell'intervallo, altrimenti il default (mai un valore assurdo dal DB)
function soglia(soglie: unknown, chiave: string, def: number, min: number, max: number): number {
  const o = soglie && typeof soglie === 'object' && !Array.isArray(soglie) ? soglie as Record<string, unknown> : {};
  const v = o[chiave];
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : def;
}
// numero d'ordine Shopify: solo cifre (col # davanti), altrimenti vuoto
function numeroOrdine(v: unknown): string {
  const s = typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '';
  return /^#?\d{1,9}$/.test(s) ? '#' + s.replace(/^#/, '') : '';
}
// stato TWS ('INDIRIZZO ERRATO', 'N. CIVICO MANCANTE/ERRATO'): lettere, cifre e poca punteggiatura, al massimo 40;
// qualunque altra cosa = vuoto (il testo dice allora solo "un problema")
function statoCorriere(v: unknown): string {
  const s = pulisci(v, 40).toUpperCase();
  return /^[\p{L}\p{N} ./'()-]+$/u.test(s) ? s : '';
}
// Chi e' la cliente, per le push che la riguardano (decisione di Dan del 19-10, Privacy in testa): il nome ripulito come
// gli altri testi dei dati e tagliato a 60 punti di codice; senza nome l'email, solo se ha la forma di un'email
// (minuscola, al massimo 80: un'email tagliata non e' piu' un'email e resta fuori); altrimenti vuoto, e il testo dice "Una
// cliente". Il nome lo sceglie chi scrive (il mittente di Gmail, il modulo del sito): via anche i caratteri di formato
// (\p{Cf}: direzione del testo, larghezza zero), che sul telefono rovescerebbero o nasconderebbero il resto del titolo.
// Un nome che e' un'email (il mittente senza nome: 3 urgenti su 19 negli ultimi 30 giorni, misurato il 19-10) segue le
// regole dell'email, non quelle del nome: minuscola, mai tagliata a 60; se non le passa vale l'email della cliente.
const EMAIL_CLIENTE_RE = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;
function emailCliente(v: unknown): string {
  const e = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return e.length <= 80 && EMAIL_CLIENTE_RE.test(e) && !/\p{C}/u.test(e) ? e : '';
}
function nomeCliente(nome: unknown, email: unknown): string {
  const grezzo = typeof nome === 'string' ? nome.replace(/\p{Cf}/gu, '') : nome;
  if (typeof grezzo === 'string' && EMAIL_CLIENTE_RE.test(grezzo.trim())) return emailCliente(grezzo) || emailCliente(email);
  return pulisci(grezzo, 60) || emailCliente(email);
}
// ==== PURE:pe-base END ====

// ==== PURE:pe-tempo BEGIN ====
// Ora di Roma con Intl (ora legale compresa: il 25-10-2026 alle 03:00 si torna alle 02:00). Il riepilogo parte dalle
// 22:00 (dal 09-11, prima 18:30), da lunedi' a sabato; "oggi" = dalla mezzanotte di Roma.
const FUSO = 'Europe/Rome';
const ORA_RIEPILOGO_MIN = 22 * 60;
let fmtRoma: Intl.DateTimeFormat | null = null;
function partiRoma(ms: number): { y: number; m: number; d: number; h: number; mi: number; s: number; wd: string } {
  fmtRoma ??= new Intl.DateTimeFormat('en-US', { timeZone: FUSO, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short' });
  const p: Record<string, string> = {};
  for (const x of fmtRoma.formatToParts(new Date(ms))) p[x.type] = x.value;
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), h: Number(p.hour) % 24, mi: Number(p.minute), s: Number(p.second), wd: p.weekday ?? '' };
}
// minuti di anticipo di Roma su UTC in quell'istante (60 d'inverno, 120 d'estate)
function offsetRomaMin(ms: number): number {
  const p = partiRoma(ms);
  return Math.round((Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000) / 60000);
}
const due = (n: number) => String(n).padStart(2, '0');
function dataRoma(ms: number): string {
  const p = partiRoma(ms);
  return `${p.y}-${due(p.m)}-${due(p.d)}`;
}
// mezzanotte di Roma del giorno di `ms`, in ms UTC. L'offset si prende alla mezzanotte stessa (seconda passata): nei due
// giorni del cambio d'ora quello delle 22:00 e quello delle 00:00 sono diversi.
function mezzanotteRoma(ms: number): number {
  const p = partiRoma(ms);
  const base = Date.UTC(p.y, p.m - 1, p.d);
  return base - offsetRomaMin(base - offsetRomaMin(ms) * 60000) * 60000;
}
// aperta dalle 22:00 alle 23:59 di Roma, da lunedi' a sabato; ts = le 22:00 di quel giorno (eta' del riepilogo)
function finestraRiepilogo(ms: number): { aperta: boolean; data: string; ts: number } {
  const p = partiRoma(ms);
  const data = `${p.y}-${due(p.m)}-${due(p.d)}`;
  const ts = Date.UTC(p.y, p.m - 1, p.d, 0, ORA_RIEPILOGO_MIN) - offsetRomaMin(ms) * 60000;
  return { aperta: p.wd !== 'Sun' && p.h * 60 + p.mi >= ORA_RIEPILOGO_MIN, data, ts };
}
// giorni da lunedi' a venerdi' strettamente dopo `da` e fino ad `a` compreso (date 'YYYY-MM-DD' di Roma). Ordine di
// lunedi', oggi venerdi': 4. Nessuna festivita'. Date illeggibili o a <= da: 0.
function giorniLavorativiDopo(da: string, a: string): number {
  const g = (s: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : NaN; };
  const t0 = g(da), t1 = g(a);
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 <= t0) return 0;
  let n = 0;
  for (let t = t0 + 86400000, i = 0; t <= t1 && i < 400; t += 86400000, i++) { const wd = new Date(t).getUTCDay(); if (wd !== 0 && wd !== 6) n++; }
  return n;
}
// Chat del sito (v7, 08-11). chat_orari di app_flags (scheda Chat): fuso, giorni ISO (1 = lunedi'), dalle-alle, chiusure
// 'YYYY-MM-DD'; stesso schema di orariFlag di chat-api. Illeggibile, senza giorni, con dalle >= alle o un fuso che Intl
// non conosce = il default (lunedi'-venerdi' 9-18 di Roma), come soglia(): un valore storto non deve spegnere i solleciti
// in silenzio. Divergenza dichiarata (Gate 2, C7): con lo stesso flag storto chat-api vale "sempre fuori orario" (testo
// fuori orario alla cliente, push di passaggio non urgente), qui valgono gli orari di default; la scheda Chat (pezzo 6)
// deve rifiutare un valore storto.
type OrariChat = { tz: string; giorni: number[]; dalle: string; alle: string; chiusure: string[] };
const ORARI_CHAT_DEFAULT: OrariChat = { tz: FUSO, giorni: [1, 2, 3, 4, 5], dalle: '09:00', alle: '18:00', chiusure: [] };
const ORA_HHMM_RE = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
function orariChat(v: unknown): OrariChat {
  let o: Record<string, unknown> = {};
  try { const x = typeof v === 'string' ? JSON.parse(v) : null; if (x && typeof x === 'object' && !Array.isArray(x)) o = x as Record<string, unknown>; } catch { return ORARI_CHAT_DEFAULT; }
  const giorni = Array.isArray(o.giorni) ? [...new Set(o.giorni.filter((g: unknown): g is number => typeof g === 'number' && Number.isInteger(g) && g >= 1 && g <= 7))] : [];
  const chiusure = Array.isArray(o.chiusure) ? o.chiusure.filter((c: unknown): c is string => typeof c === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(c)).slice(0, 400) : [];
  const dalle = typeof o.dalle === 'string' && ORA_HHMM_RE.test(o.dalle) ? o.dalle : '', alle = typeof o.alle === 'string' && ORA_HHMM_RE.test(o.alle) ? o.alle : '';
  if (typeof o.tz !== 'string' || !/^[A-Za-z_]+\/[A-Za-z_]+$/.test(o.tz) || !dalle || !alle || dalle >= alle || !giorni.length) return ORARI_CHAT_DEFAULT;
  try { new Intl.DateTimeFormat('en-US', { timeZone: o.tz }); } catch { return ORARI_CHAT_DEFAULT; }
  return { tz: o.tz, giorni, dalle, alle, chiusure };
}
// chat_sollecito_ore = "24,48" (D-8): le ore dei due passi. Due numeri crescenti fra 0,05 (3 minuti, per le prove con un
// valore basso, test 6 di 13.4) e 240; altrimenti il default.
const ORE_SOLLECITO_DEFAULT: [number, number] = [24, 48];
function oreSollecito(v: unknown): [number, number] {
  const p = typeof v === 'string' ? v.split(',').map((x) => x.trim()) : [];
  const n = p.map((x) => (/^\d{1,3}(?:\.\d{1,3})?$/.test(x) ? Number(x) : NaN));
  return n.length === 2 && n.every((x) => Number.isFinite(x) && x >= 0.05 && x <= 240) && n[0] < n[1] ? [n[0], n[1]] : ORE_SOLLECITO_DEFAULT;
}
const fmtTz = new Map<string, Intl.DateTimeFormat>();
function partiTz(ms: number, tz: string): { y: number; m: number; d: number; h: number; mi: number; s: number; wd: string } {
  let f = fmtTz.get(tz);
  if (!f) { f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short' }); fmtTz.set(tz, f); }
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(new Date(ms))) p[x.type] = x.value;
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), h: Number(p.hour) % 24, mi: Number(p.minute), s: Number(p.second), wd: p.weekday ?? '' };
}
// mezzanotte del giorno di `ms` nel fuso, come mezzanotteRoma (offset preso alla mezzanotte stessa, seconda passata)
function mezzanotteTz(ms: number, tz: string): number {
  const off = (x: number) => { const p = partiTz(x, tz); return Math.round((Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(x / 1000) * 1000) / 60000); };
  const p = partiTz(ms, tz);
  const base = Date.UTC(p.y, p.m - 1, p.d);
  return base - off(base - off(ms) * 60000) * 60000;
}
const GIORNI_ISO: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
// giorno lavorativo = un giorno di `giorni` che non e' fra le chiusure
function giornoLavorativo(ms: number, o: OrariChat): boolean {
  const p = partiTz(ms, o.tz);
  return o.giorni.includes(GIORNI_ISO[p.wd] ?? 0) && !o.chiusure.includes(`${p.y}-${due(p.m)}-${due(p.d)}`);
}
// dentro l'orario: giorno lavorativo e dalle <= ora < alle (come inOrario di chat-api)
function inOrarioChat(ms: number, o: OrariChat): boolean {
  const p = partiTz(ms, o.tz);
  return giornoLavorativo(ms, o) && `${due(p.h)}:${due(p.mi)}` >= o.dalle && `${due(p.h)}:${due(p.mi)}` < o.alle;
}
// Istante in cui, da `da`, sono passate `ore` ore contate SOLO nei giorni lavorativi, a giorno intero (D-8: "24 ore
// contate nei giorni lavorativi", cioe' 24 ore = un giorno lavorativo, 48 = due, come la promessa alla cliente "di solito
// entro 2 giorni lavorativi"). Un passaggio di sabato comincia a contare lunedi' a mezzanotte. Nessun giorno lavorativo nei
// prossimi 120 giorni, o un istante illeggibile: null (nessun sollecito, mai un errore a ogni giro).
function dovutoDopo(da: number, ore: number, o: OrariChat): number | null {
  if (!Number.isFinite(da) || !(ore > 0)) return null;
  const serve = ore * 3600000;
  let acc = 0;
  let g = mezzanotteTz(da, o.tz);
  for (let i = 0; i < 120; i++) {
    const fine = mezzanotteTz(g + 36 * 3600000, o.tz);
    if (!(fine > g)) return null;
    if (giornoLavorativo(g, o)) {
      const s = Math.max(g, da), lun = fine - s;
      if (lun > 0) { if (acc + lun >= serve) return s + (serve - acc); acc += lun; }
    }
    g = fine;
  }
  return null;
}
// giorno UTC (chiavi della chat: contatori ed eventi di chat-api sono per giorno UTC)
const giornoUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);
// ==== PURE:pe-tempo END ====

// ==== PURE:pe-messaggi BEGIN ====
// Due passi per ogni evento: i CANDIDATI (chiave del registro, istante dell'evento, riferimenti) escono dalle righe
// sorgente; i MESSAGGI si compongono solo per i candidati che partono davvero (o per l'anteprima), cosi' i conteggi del
// testo non si rileggono a ogni giro. Le funzioni copiano solo i campi ammessi: una riga con altri campi (oggetto,
// snippet, riassunto, telefono, indirizzo) non li fa arrivare nel testo. Nome ed email della cliente entrano solo nei
// titoli dei tre eventi che la riguardano, e solo da nomeCliente (decisione di Dan del 19-10).
type Cand = { chiave: string; ts: number; rif: Record<string, string> };
type Msg = { chiave: string; titolo: string; testo: string; url: string; tema: string; chi?: string; urgente?: boolean };
type Riga = Record<string, unknown>;
const msDi = (v: unknown): number => (typeof v === 'string' && v ? Date.parse(v) : NaN);
// ordine per istante con un confronto totale: un istante illeggibile (NaN) vale "il piu' vecchio", la chiave decide i pari
function perIstante(x: Cand, y: Cand): number {
  const a = Number.isFinite(x.ts) ? x.ts : -Infinity, b = Number.isFinite(y.ts) ? y.ts : -Infinity;
  return a !== b ? (a < b ? -1 : 1) : x.chiave < y.chiave ? -1 : x.chiave > y.chiave ? 1 : 0;
}
const ordinaRecenti = (a: Cand[]) => a.sort((x, y) => perIstante(y, x));

// b2b_risposta_negozio: un tocco `in` scritto dal giro automatico (chi = 'auto') senza esito (non bounce, non risposta
// automatica, non opt-out), oppure con 'opt_out_da_verificare' (un negozio gia' avanti nella pipeline che sembra chiedere
// di non essere ricontattato: lead-outreach lo mette da leggere oggi, C7 del 18-10). Chiave = id del tocco.
// Gate 3 del 18-10 (B1): un tocco scritto da una persona (portaConversazione, primo contatto 'nuovo_negozio', righe vecchie
// senza chi) non e' una notizia per chi l'ha appena scritto, e spesso porta l'`at` vecchio del messaggio. L'eta' si misura
// da quando l'app ha visto la risposta (created_at) se il ritardo sul messaggio (at, data di Gmail) e' entro 72 ore, la
// finestra con cui lead-outreach recupera i propri giri saltati: una risposta letta in ritardo parte lo stesso, un
// recupero di messaggi vecchi resta `saltato` (vecchio). Per negozio conta solo il tocco piu' recente del giro: un thread
// agganciato con piu' risposte fa una push sola.
const RITARDO_LETTURA_MAX_MS = 72 * 3600000;
function candB2b(righe: Riga[]): Cand[] {
  const per = new Map<string, Cand>();
  for (const r of righe ?? []) {
    if (r?.direzione !== 'in' || r.chi !== 'auto' || typeof r.id !== 'string' || !UUID_RE.test(r.id)) continue;
    if (r.esito != null && r.esito !== 'opt_out_da_verificare') continue;
    const at = msDi(r.at), visto = msDi(r.created_at);
    const ts = Number.isFinite(at) && Number.isFinite(visto) && visto >= at && visto - at <= RITARDO_LETTURA_MAX_MS ? visto : at;
    const negozio = typeof r.account_id === 'string' && UUID_RE.test(r.account_id) ? r.account_id.toLowerCase() : '';
    const c = { chiave: r.id.toLowerCase(), ts, rif: { negozio, tipo: r.esito === 'opt_out_da_verificare' ? 'opt_out' : 'risposta' } };
    const k = negozio || c.chiave;
    const prima = per.get(k);
    if (!prima || perIstante(c, prima) > 0) per.set(k, c);
  }
  return ordinaRecenti([...per.values()]);
}
function msgB2b(cands: Cand[], nomi: Record<string, unknown>, daGestire: number): Msg[] {
  return cands.map((c) => {
    const nome = pulisci(nomi[c.rif.negozio], 60) || 'Un negozio';
    const base = { chiave: c.chiave, tema: TEMA_EVENTO.b2b_risposta_negozio, url: linkNegozio(c.rif.negozio) };
    if (c.rif.tipo === 'opt_out') return { ...base, titolo: `${nome}: messaggio da leggere`, testo: 'Forse chiede di non essere ricontattato: leggilo in Negozi B2B.' };
    return { ...base, titolo: `${nome} ha risposto`,
      testo: daGestire > 0 ? `In Negozi B2B: ${plurale(daGestire, 'risposta da gestire', 'risposte da gestire')}.` : 'Apri la scheda del negozio in Negozi B2B.' };
  });
}

// cs_urgente: `classify` con urgente, o `urgenza_ricalcolo` che accende urgente. Chiave = conversazione + ':urgente' (una
// push per conversazione che diventa urgente); a parita' resta l'evento piu' recente.
function candCsUrgente(righe: Riga[]): Cand[] {
  const per = new Map<string, Cand>();
  for (const r of righe ?? []) {
    const u = r?.urgente;
    if ((r?.azione !== 'classify' && r?.azione !== 'urgenza_ricalcolo') || (u !== true && u !== 'true')) continue;
    if (typeof r.conversation_id !== 'string' || !UUID_RE.test(r.conversation_id)) continue;
    const conv = r.conversation_id.toLowerCase();
    const c = { chiave: conv + ':urgente', ts: msDi(r.at), rif: { conv } };
    const prima = per.get(c.chiave);
    if (!prima || c.ts > prima.ts) per.set(c.chiave, c);
  }
  return ordinaRecenti([...per.values()]);
}
// Motivi FISSI delle regole (cs-classify ruleUrgency, cs-sync recomputeUrgency), confronto esatto. Quello dell'AI e'
// testo libero ricavato dal messaggio della cliente ("matrimonio 27-07"): non ha una voce qui e non entra mai.
const SOLLECITO_DOPO_CHIUSURA = 'thread riaperto (sollecito)';
const PIU_MESSAGGI = '2+ messaggi senza nostra risposta';
const MOTIVI_FISSI: Record<string, string> = {
  'rischio disputa': 'Rischio di contestazione del pagamento',
  'cliente in loco': 'La cliente e\' davanti al negozio',
  // la conversazione resta 'fatto' (chiusa da una persona) e la scheda Assistenza apre su "Da iniziare": il testo dice
  // dove trovarla (filtro "Concluse")
  [SOLLECITO_DOPO_CHIUSURA]: 'Sollecito: ha riscritto dopo la chiusura (in Concluse)',
  [PIU_MESSAGGI]: 'Sollecito: due o piu\' messaggi senza risposta',
};
function motivoFisso(v: unknown): string {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(MOTIVI_FISSI, v) ? MOTIVI_FISSI[v] : '';
}
// La conversazione deve essere ANCORA urgente e fuori dal rumore. Chiusa ('fatto') = nessun messaggio, tranne il caso
// che esiste SOLO su una conversazione chiusa (B2, Gate 3 del 18-10): chiusa da una persona e riaperta da un nuovo
// messaggio della cliente. recomputeUrgency mette 'thread riaperto (sollecito)' solo con stato 'fatto', e setStatoAuto non
// riapre una chiusura fatta a mano: senza questa eccezione il sollecito piu' difficile da vedere non arrivava mai.
// stato_by 'auto' o vuoto con quel motivo = una chiusura giudicata da cs_reopen_skip_closure (un "grazie"): niente push.
// stato_by e' il nome di chi del team ha chiuso, non entra mai nel testo.
// C2 (18-10): '2+ messaggi' su una chat_notifica e' una raffica di pochi minuti, non un sollecito: il motivo non si scrive.
// 19-10 (decisione di Dan): il titolo dice da chi viene ("Richiesta urgente da Maria Rossi"), la categoria passa in testa
// al testo, prima del motivo fisso e delle urgenti aperte. Senza nome ne' email titolo e testo restano quelli del 18-10
// (categoria nel titolo): la decisione chiede il nome, non un'altra impaginazione.
function msgCsUrgente(cands: Cand[], conv: Record<string, Riga>, aperte: number): Msg[] {
  const out: Msg[] = [];
  for (const c of cands) {
    const v = conv[c.rif.conv];
    // v10 (punto 20): mai una chat del sito, la sua push la manda chat-api al passaggio
    if (!v || v.urgente !== true || v.canale === 'rumore' || v.canale === 'chat_sito') continue;
    const riapertaDopoChiusuraAMano = v.stato === 'fatto' && v.urgenza_motivo === SOLLECITO_DOPO_CHIUSURA
      && typeof v.stato_by === 'string' && v.stato_by.trim() !== '' && v.stato_by !== 'auto';
    if (v.stato === 'fatto' && !riapertaDopoChiusuraAMano) continue;
    const cat = pulisci(v.categoria, 40);
    const cliente = nomeCliente(v.customer_name, v.customer_email);
    const motivo = v.urgenza_motivo === PIU_MESSAGGI && v.canale === 'chat_notifica' ? '' : motivoFisso(v.urgenza_motivo);
    const parti = [cliente ? cat : '', motivo, aperte > 0 ? plurale(aperte, 'urgente aperta', 'urgenti aperte') : ''].filter(Boolean);
    out.push({ chiave: c.chiave, tema: TEMA_EVENTO.cs_urgente, url: LINK_ASSISTENZA, urgente: true,
      titolo: cliente ? `Richiesta urgente da ${cliente}` : cat ? `Richiesta urgente: ${cat}` : 'Richiesta urgente',
      testo: parti.length ? parti.join('. ') + '.' : 'Apri l\'Assistenza.' });
  }
  return out;
}

// cs_cliente_ha_riscritto: `stato_auto` verso da_fare (la conversazione chiusa da sola si riapre). C3 (18-10): una chiave
// per conversazione e finestra di 2 ore (UTC), non per evento: una cliente che riscrive tre volte in pochi minuti fa una
// push sola (nel retro-test una conversazione ne prendeva 2 in 4 minuti). Evento senza istante: nessun candidato.
const FINESTRA_RISCRITTO_MS = 2 * 3600000;
function candCsRiscritto(righe: Riga[]): Cand[] {
  const per = new Map<string, Cand>();
  for (const r of righe ?? []) {
    if (r?.a !== 'da_fare' || typeof r.conversation_id !== 'string' || !UUID_RE.test(r.conversation_id)) continue;
    const ts = msDi(r.at);
    if (!Number.isFinite(ts)) continue;
    const conv = r.conversation_id.toLowerCase();
    const c = { chiave: `${conv}:${new Date(Math.floor(ts / FINESTRA_RISCRITTO_MS) * FINESTRA_RISCRITTO_MS).toISOString()}`, ts, rif: { conv } };
    const prima = per.get(c.chiave);
    if (!prima || c.ts > prima.ts) per.set(c.chiave, c);
  }
  return ordinaRecenti([...per.values()]);
}
// 19-10 (decisione di Dan): "Maria Rossi ha riscritto", la categoria in testa al testo; senza nome ne' email il titolo e
// il testo del 18-10 ("Una cliente ha riscritto: Reso"), come in msgCsUrgente
function msgCsRiscritto(cands: Cand[], conv: Record<string, Riga>, inAttesa: number): Msg[] {
  const out: Msg[] = [];
  for (const c of cands) {
    const v = conv[c.rif.conv];
    if (!v || v.canale === 'rumore' || v.stato === 'fatto') continue;
    const cat = pulisci(v.categoria, 40);
    const cliente = nomeCliente(v.customer_name, v.customer_email);
    const parti = [cliente ? cat : '', inAttesa > 0 ? `${plurale(inAttesa, 'richiesta aspetta', 'richieste aspettano')} una risposta` : ''].filter(Boolean);
    out.push({ chiave: c.chiave, tema: TEMA_EVENTO.cs_cliente_ha_riscritto, url: LINK_ASSISTENZA,
      titolo: cliente ? `${cliente} ha riscritto` : cat ? `Una cliente ha riscritto: ${cat}` : 'Una cliente ha riscritto',
      testo: parti.length ? parti.join('. ') + '.' : 'Apri l\'Assistenza.' });
  }
  return out;
}

// spedizione_eccezione: righe classe 'eccezione' nuove o cambiate. Chiave = LDV + stato, cosi' un cambio di stato
// (da INDIRIZZO ERRATO a DESTINATARIO ASSENTE) e' una push nuova. LDV fuori forma: nessun candidato.
// 21-10 (OK di Dan in chat): la vista v_spedizioni_eccezioni (core, la usa anche cs-assist: non si tocca) mette in classe
// 'eccezione' ogni stato fuori da una lista corta, quindi anche il transito normale. In 3 giorni 20 candidati: 'IN
// CONSEGNA MATT.' 8, 'IN CONSEGNA' 4, 'RITIRATA' 4, 'IN CONSEGNA POM.' 2 e solo 2 veri ('DESTINATARIO ASSENTE'). Ora una
// riga diventa candidato solo se lo stato del corriere e' un problema vero (statoProblema): un pezzo di parola di
// PROBLEMI_CORRIERE all'inizio di una parola dello stato ripulito, cosi' RESO non prende PRESO ed ERRAT prende anche N.
// CIVICO MANCANTE/ERRATO. Gli stati normali (IN CONSEGNA*, RITIRATA, IN TRANSITO, PARTITA, NUOVA, CONSEGNATA, FERIE,
// IN ATTESA DI AFFIDO, IN PARTENZA TWS, RM - CONSEGNATA) e uno stato illeggibile non diventano mai una push.
// Gate 2 del 21-10: ai 12 pezzi del brief (che diceva "almeno") si aggiungono le diciture comuni di una consegna non
// riuscita o di un rientro, nessuna delle quali prende uno dei 16 stati visti: MANCATA o TENTATA CONSEGNA, CONSEGNA
// FALLITA, NON CONSEGNABILE, IN RESTITUZIONE, RIENTRO o RITORNO AL MITTENTE, IN ATTESA ISTRUZIONI, INDIRIZZO INCOMPLETO o
// INSUFFICIENTE, DESTINATARIO o ESERCIZIO CHIUSO. CHIUSO al maschile e non CHIUS: "SPEDIZIONE CHIUSA" o "PRATICA CHIUSA"
// possono essere la fine normale di una spedizione.
const LDV_RE = /^[A-Za-z0-9_./-]{1,64}$/;
const PROBLEMI_CORRIERE = ['ASSENTE', 'ERRAT', 'MANCANT', 'RIFIUT', 'GIACENZA', 'SMARRIT', 'DANNEGG', 'RESPINT', 'RESO', 'IRREPERIBIL', 'INESISTENT', 'SCONOSCIUT',
  'MANCAT', 'TENTAT', 'FALLIT', 'NON CONSEGN', 'RESTITU', 'RIENTR', 'RITORN', 'ISTRUZION', 'INCOMPLET', 'INSUFFICIENT', 'CHIUSO'];
const PROBLEMA_RE = new RegExp(`(?:^|[^\\p{L}])(?:${PROBLEMI_CORRIERE.join('|')})`, 'u');
function statoProblema(v: unknown): boolean {
  const s = statoCorriere(v);
  return s !== '' && PROBLEMA_RE.test(s);
}
function candSpedizione(righe: Riga[]): Cand[] {
  const out: Cand[] = [];
  for (const r of righe ?? []) {
    if (r?.classe !== 'eccezione' || typeof r.ldv !== 'string' || !LDV_RE.test(r.ldv) || !statoProblema(r.stato_tws)) continue;
    const stato = statoCorriere(r.stato_tws);
    // nella chiave lo stato senza spazi ne' punteggiatura: la chiave passa da un filtro .in() di PostgREST. Il nome della
    // cliente (19-10) sta solo in rif, per il titolo: mai nella chiave, che finisce nel registro
    out.push({ chiave: `${r.ldv}:${stato.replace(/[^\p{L}\p{N}]+/gu, '_')}`, ts: msDi(r.updated_at),
      rif: { ordine: numeroOrdine(r.order_name), stato, cliente: nomeCliente(r.customer_name, null) } });
  }
  return ordinaRecenti(out);
}
// il totale dei 7 giorni nel testo conta le sole spedizioni con un problema vero (21-10): contate dalla classe della vista
// sarebbero state 20 in 3 giorni invece di 2
function contaProblemi(righe: Riga[]): number {
  return (righe ?? []).filter((r) => r?.classe === 'eccezione' && statoProblema(r.stato_tws)).length;
}
// push-api taglia il titolo a 120 punti di codice (TITOLO_MAX, stesso numero pinnato dal test): qui si accorcia il nome
// della cliente, non lo stato del corriere, che e' la notizia. Con ordine e stato lunghi al massimo restano 54 caratteri.
const TITOLO_MAX_PUSH = 120;
// 19-10 (decisione di Dan): "Spedizione #1890: INDIRIZZO ERRATO (Maria Rossi)"; senza nome niente parentesi. La notizia
// sta davanti al nome: sul telefono chiuso il titolo e' una riga sola, e il pezzo che si perde e' la coda (misurato il
// 19-10 sulle 18 eccezioni dei 90 giorni: col nome in mezzo i titoli arrivavano a 73 caratteri e lo stato partiva fino
// al 48esimo).
function msgSpedizione(cands: Cand[], settimana: number): Msg[] {
  return cands.map((c) => {
    const notizia = `Spedizione${c.rif.ordine ? ' ' + c.rif.ordine : ''}: ${c.rif.stato || 'problema del corriere'}`;
    const cliente = c.rif.cliente ? pulisci(c.rif.cliente, TITOLO_MAX_PUSH - Array.from(`${notizia} ()`).length) : '';
    return {
      chiave: c.chiave, tema: TEMA_EVENTO.spedizione_eccezione, url: APP_URL,
      titolo: cliente ? `${notizia} (${cliente})` : notizia,
      testo: settimana > 1 ? `Il corriere segnala un problema. ${plurale(settimana, 'spedizione', 'spedizioni')} con un problema negli ultimi 7 giorni.` : 'Il corriere segnala un problema su questa spedizione.',
    };
  });
}

// sistema_cs_sync_fermo: la riga cs_sync di health_log (riscritta da cs-sync a ogni giro). FERMA = la riga piu' recente
// ha piu' di `minuti` minuti: chiave sull'istante di quella riga, quindi uno stallo lungo fa UNA push e uno stallo nuovo,
// anche lo stesso giorno, un'altra. IN ERRORE (giro che gira ma severity error, per esempio fermo su un messaggio da oltre
// un'ora): la riga si riscrive a ogni giro e l'inizio dell'episodio non si legge senza la label (che puo' contenere un
// oggetto o un mittente e non si chiede mai), quindi una push al giorno di Roma finche' dura. Una riga piu' recente di
// `ora` (letta un attimo dopo l'inizio del giro) non e' mai ferma.
function candCsSync(riga: Riga | null, ora: number, minuti: number): Cand[] {
  const t = msDi(riga?.created_at);
  if (!riga || !Number.isFinite(t)) return [];
  if (ora - t >= minuti * 60000) {
    return [{ chiave: `cs_sync:fermo:${new Date(t).toISOString()}`, ts: t + minuti * 60000, rif: { tipo: 'fermo', minuti: String(Math.floor((ora - t) / 60000)) } }];
  }
  if (riga.severity === 'error') return [{ chiave: `cs_sync:errore:${dataRoma(ora)}`, ts: t, rif: { tipo: 'errore', minuti: '' } }];
  return [];
}
function durata(minuti: number): string {
  if (minuti < 120) return plurale(minuti, 'minuto', 'minuti');
  if (minuti < 2880) return plurale(Math.floor(minuti / 60), 'ora', 'ore');
  return plurale(Math.floor(minuti / 1440), 'giorno', 'giorni');
}
function msgCsSync(cands: Cand[]): Msg[] {
  return cands.map((c) => c.rif.tipo === 'fermo'
    ? { chiave: c.chiave, tema: TEMA_EVENTO.sistema_cs_sync_fermo, url: LINK_SALUTE, urgente: true, titolo: 'Posta clienti ferma',
      testo: `Posta clienti ferma da ${durata(Number(c.rif.minuti) || 0)}: i messaggi nuovi non entrano in Assistenza.` }
    : { chiave: c.chiave, tema: TEMA_EVENTO.sistema_cs_sync_fermo, url: LINK_SALUTE, urgente: true, titolo: 'Posta clienti in errore',
      testo: 'La lettura della posta clienti e\' in errore: i messaggi nuovi potrebbero non entrare in Assistenza.' });
}

// premia_da_approvare (03-11, decisione di Dan): ogni look o recensione che entra in moderazione (loyalty_ugc in_revisione)
// e' una push a se', a Ginni che modera. Chiave = ugc:<id>, istante = created_at. Un contenuto deciso prima del giro non e'
// piu' fra i candidati (la lettura chiede solo in_revisione) e non parte. Nel testo solo il tipo e il codice della borsa:
// mai titolo, testo, firma o foto della cliente (le select non li chiedono nemmeno).
const KIND_UGC = ['look', 'recensione'];
function candPremia(righe: Riga[]): Cand[] {
  const out: Cand[] = [];
  for (const r of righe ?? []) {
    const id = intero(r?.id);
    if (!id || Number(id) <= 0 || r?.status !== 'in_revisione' || typeof r.kind !== 'string' || !KIND_UGC.includes(r.kind)) continue;
    out.push({ chiave: 'ugc:' + id, ts: msDi(r.created_at), rif: { kind: r.kind, codice: codiceProdotto(r.codice) } });
  }
  return ordinaRecenti(out);
}
function msgPremia(cands: Cand[], inRevisione: number): Msg[] {
  return cands.map((c) => ({
    chiave: c.chiave, tema: TEMA_EVENTO.premia_da_approvare, url: LINK_RECENSIONI,
    titolo: c.rif.kind === 'look' ? 'Nuovo look da approvare' : 'Nuova recensione da approvare',
    testo: [c.rif.codice ? `Borsa ${c.rif.codice}` : '', inRevisione > 1 ? `In Recensioni: ${plurale(inRevisione, 'contenuto da approvare', 'contenuti da approvare')}` : 'Apri Recensioni per approvarlo']
      .filter(Boolean).join('. ') + '.',
  }));
}

// premia_salute (03-11, tema sistema): tre guasti del modulo Premia, ognuno una push sua.
//  - loyalty_orders in errore: la riga piu' recente di health_log k loyalty_orders (riscritta dal giro ogni 15 minuti) ha
//    severity error. Come cs_sync in errore: una push al giorno di Roma finche' dura, istante = quella riga.
//  - riscatto pending oltre `minuti` minuti (15): una push per riscatto, chiave riscatto:<id>, istante = adesso (Gate 2 del
//    03-11: con l'istante del superamento della soglia un riscatto fermo da oltre 6 ore all'accensione, o dopo una pausa
//    del giro, finiva `saltato` vecchio e non avvisava mai). La cliente ha speso i punti e aspetta il codice.
//  - pool sotto soglia: un premio attivo con meno codici liberi di loyalty_pool_min. Una push al giorno di Roma per premio,
//    istante = adesso (e' uno stato, non un fatto con una data).
// Evento di stato (EVENTI_DI_STATO): un guasto gia' in corso all'accensione e' una notizia di adesso, non pregresso.
const REWARD_RE = /^[a-z0-9_]{1,40}$/;
function candPremiaSalute(o: { orders: Riga | null; pending: Riga[]; pool: Riga[]; poolMin: number; ora: number; minuti: number }): Cand[] {
  const out: Cand[] = [];
  const t = msDi(o.orders?.created_at);
  if (o.orders?.severity === 'error' && Number.isFinite(t)) out.push({ chiave: `orders:errore:${dataRoma(o.ora)}`, ts: t, rif: { tipo: 'orders' } });
  for (const r of o.pending ?? []) {
    const id = intero(r?.id), c = msDi(r?.created_at);
    if (!id || r?.status !== 'pending' || !Number.isFinite(c) || o.ora - c < o.minuti * 60000) continue;
    out.push({ chiave: 'riscatto:' + id, ts: o.ora, rif: { tipo: 'pending', minuti: String(Math.floor((o.ora - c) / 60000)) } });
  }
  for (const r of o.pool ?? []) {
    const k = typeof r?.reward === 'string' && REWARD_RE.test(r.reward) ? r.reward : '';
    const liberi = Number(r?.codici_liberi);
    if (!k || r?.active !== true || !Number.isFinite(liberi) || liberi >= o.poolMin) continue;
    out.push({ chiave: `pool:${k}:${dataRoma(o.ora)}`, ts: o.ora, rif: { tipo: 'pool', label: pulisci(r.label, 60) || k, liberi: String(Math.max(0, Math.floor(liberi))), soglia: String(o.poolMin) } });
  }
  return ordinaRecenti(out);
}
function msgPremiaSalute(cands: Cand[]): Msg[] {
  return cands.map((c) => {
    const base = { chiave: c.chiave, tema: TEMA_EVENTO.premia_salute, url: LINK_PREMIA };
    if (c.rif.tipo === 'orders') return { ...base, urgente: true, titolo: 'Premia: accredito acquisti in errore', testo: 'Il giro loyalty-orders e\' in errore: i punti degli acquisti potrebbero non arrivare.' };
    if (c.rif.tipo === 'pending') return { ...base, urgente: true, titolo: 'Premia: riscatto fermo', testo: `Una cliente aspetta il codice da ${durata(Number(c.rif.minuti) || 0)}: il riscatto e' ancora in attesa.` };
    return { ...base, titolo: 'Premia: codici quasi finiti', testo: `${c.rif.label}: ${plurale(Number(c.rif.liberi) || 0, 'codice libero', 'codici liberi')}, sotto la soglia di ${c.rif.soglia}.` };
  });
}
// sistema_senza_iscritti (06-11, D-1 di Dan, tema sistema): un tema di un evento acceso che non arriva a nessun telefono,
// perche' nessun telefono lo ha fra i suoi temi (`iscritti` = 0, conteggio di push_subscriptions) o perche' e' spento in
// push_temi (push-api risponde tema_spento). Le sue push finiscono `nessun_iscritto` e nessuno lo vede: il 06-11
// cs_urgente aveva 13 push cosi' e nessuna consegnata. Una push al giorno di Roma per tema, chiave iscritti:<tema>:<data>,
// istante = adesso (e' uno stato), solo dalle `oraDa` di Roma (9): un promemoria di stato non suona a mezzanotte. Evento di
// stato (EVENTI_DI_STATO). `perse` = righe `nessun_iscritto` delle ultime 24 ore degli eventi accesi di quel tema. Le push
// per UNA persona (il riepilogo) non fanno candidati qui: un tema con telefoni ma senza quello di chi riceve lo dice la
// riga push_iscritti di Salute (push_eventi_salute, migr 0185). Nel testo solo il nome del tema e i conteggi.
function candSenzaIscritti(o: { eventi: Riga[]; temi: Riga[]; iscritti: Record<string, number>; perse: Riga[]; ora: number; oraDa: number }): Cand[] {
  if (partiRoma(o.ora).h < o.oraDa) return [];
  const temaDiEvento = new Map<string, string>();
  for (const e of o.eventi ?? []) {
    const ev = typeof e?.evento === 'string' ? e.evento : '';
    const tema = ev ? temaDi(e.tema, ev) : '';
    if (e?.attivo === true && tema) temaDiEvento.set(ev, tema);
  }
  const righeTemi = new Map<string, Riga>();
  for (const t of o.temi ?? []) if (typeof t?.key === 'string') righeTemi.set(t.key, t);
  const perse = new Map<string, number>();
  for (const r of o.perse ?? []) { const t = temaDiEvento.get(String(r?.evento ?? '')); if (t) perse.set(t, (perse.get(t) ?? 0) + 1); }
  const data = dataRoma(o.ora);
  const out: Cand[] = [];
  for (const tema of [...new Set(temaDiEvento.values())]) {
    const riga = righeTemi.get(tema);
    const spento = riga?.attivo !== true;
    if (!spento && o.iscritti?.[tema] !== 0) continue;
    out.push({ chiave: `iscritti:${tema}:${data}`, ts: o.ora, rif: { tema, etichetta: pulisci(riga?.etichetta, 40) || tema, motivo: spento ? 'spento' : 'senza_telefoni', perse: String(perse.get(tema) ?? 0) } });
  }
  return ordinaRecenti(out);
}
function msgSenzaIscritti(cands: Cand[]): Msg[] {
  return cands.map((c) => {
    const nome = c.rif.etichetta || c.rif.tema;
    const n = Number(c.rif.perse) || 0;
    const coda = n > 0 ? `: ${plurale(n, 'push persa', 'push perse')} nelle ultime 24 ore` : '';
    return { chiave: c.chiave, tema: TEMA_EVENTO.sistema_senza_iscritti, url: LINK_SALUTE, titolo: `Notifiche senza telefono: ${nome}`,
      testo: c.rif.motivo === 'spento'
        ? `Il tema ${nome} e' spento, quindi le sue notifiche non arrivano a nessuno${coda}.`
        : `Nessun telefono e' iscritto al tema ${nome}, quindi le sue notifiche non arrivano a nessuno${coda}. Si iscrive dalla scheda Notifiche.` };
  });
}
// nuove iscritte del giorno (riepilogo di Ale, 03-11): clienti la cui PRIMA apertura dell'Area Membri (loyalty_visits,
// first_at) e' di oggi, cioe' con una visita da oggi e nessuna prima. Stessa definizione delle 28 iscritte dal 26-10.
function contaIscritte(oggi: Riga[], conVisitePrima: Riga[]): number {
  const prima = new Set((conVisitePrima ?? []).map((r) => String(r?.shopify_customer_id ?? '')).filter(Boolean));
  return new Set((oggi ?? []).map((r) => String(r?.shopify_customer_id ?? '')).filter((x) => x && !prima.has(x))).size;
}

// riepilogo: uno a testa, chiave riepilogo:<chi>:<data di Roma>, solo a finestra aperta
function candRiepilogo(f: { aperta: boolean; data: string; ts: number }): Cand[] {
  if (!f.aperta) return [];
  return CHI_PERSONE.map((chi) => ({ chiave: `riepilogo:${chi}:${f.data}`, ts: f.ts, rif: { chi } }));
}
// b2bScadute e followUpPronti: le stesse definizioni delle sezioni "Azioni scadute" e "Follow-up pronti da rivedere" della
// Coda di Negozi B2B (Outreach.tsx), cosi' il numero del riepilogo e' quello che si vede nell'app (B4, Gate 3 del 18-10)
type ContiRiepilogo = {
  ordini: number; incasso: number; scontrini: number; incassoCassa: number; arrivi: number; ordiniFornitore: number; premia: number;
  csFerme: number; b2bScadute: number; daCompletare: number; daPulire: number; daCollegare: number; followUpPronti: number;
  daSpedire: string[]; affido: number; csNuove: number; iscritte: number;
};
const pos = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
const unisci = (testa: string, parti: string[]) => { const p = parti.filter(Boolean); return p.length ? `${testa}: ${p.join(', ')}` : ''; };
// al massimo 4 righe di soli numeri, codici e numeri d'ordine; una riga c'e' solo se ha qualcosa diverso da zero.
// Ale: vendite del giorno, fornitori, Premia, team. Benny: prodotti, B2B. Ginni: spedizioni, affido, Assistenza (decisione
// 1 di Dan: l'Assistenza e' sua). I rimborsi del giorno non ci sono: shopify_orders non ha la data del rimborso.
// 03-11 (decisione di Dan): nella riga Premia di Ale anche le nuove iscritte del giorno (solo qui, mai una push); Ginni,
// che modera, ha la sua riga Premia coi contenuti ancora da approvare.
const rigaDaApprovare = (c: ContiRiepilogo) => (pos(c.premia) ? plurale(pos(c.premia), 'contenuto da approvare', 'contenuti da approvare') : '');
function righeRiepilogo(chi: string, c: ContiRiepilogo, giorni: number, oreAffido: number): string[] {
  const r: string[] = [];
  if (chi === 'Ale') {
    r.push(unisci('Vendite', [pos(c.ordini) ? `${plurale(pos(c.ordini), 'ordine', 'ordini')} sul sito (${euro(c.incasso)} EUR)` : '',
      pos(c.scontrini) ? `${plurale(pos(c.scontrini), 'scontrino', 'scontrini')} in cassa (${euro(c.incassoCassa)} EUR)` : '']));
    r.push(unisci('Fornitori', [pos(c.arrivi) ? plurale(pos(c.arrivi), 'arrivo registrato', 'arrivi registrati') : '',
      pos(c.ordiniFornitore) ? plurale(pos(c.ordiniFornitore), 'ordine registrato', 'ordini registrati') : '']));
    r.push(unisci('Premia', [pos(c.iscritte) ? plurale(pos(c.iscritte), 'nuova iscritta', 'nuove iscritte') : '', rigaDaApprovare(c)]));
    r.push(unisci('Team', [pos(c.csFerme) ? `${plurale(pos(c.csFerme), 'richiesta ferma', 'richieste ferme')} da oltre 24 ore` : '',
      pos(c.b2bScadute) ? plurale(pos(c.b2bScadute), 'azione B2B scaduta', 'azioni B2B scadute') : '']));
  } else if (chi === 'Bene') {
    r.push(unisci('Prodotti', [pos(c.daCompletare) ? `${pos(c.daCompletare)} da completare` : '', pos(c.daPulire) ? `${pos(c.daPulire)} da pulire` : '']));
    r.push(unisci('B2B', [pos(c.daCollegare) ? plurale(pos(c.daCollegare), 'messaggio da collegare', 'messaggi da collegare') : '',
      pos(c.b2bScadute) ? plurale(pos(c.b2bScadute), 'azione scaduta', 'azioni scadute') : '',
      pos(c.followUpPronti) ? plurale(pos(c.followUpPronti), 'follow-up pronto da rivedere', 'follow-up pronti da rivedere') : '']));
  } else if (chi === 'Ginevra') {
    const n = Array.isArray(c.daSpedire) ? c.daSpedire.filter((x) => numeroOrdine(x)).map(numeroOrdine) : [];
    if (n.length) r.push(`Da spedire da oltre ${giorni} giorni lavorativi: ${plurale(n.length, 'ordine', 'ordini')} (${n.slice(0, 3).join(', ')}${n.length > 3 ? ` e altri ${n.length - 3}` : ''})`);
    if (pos(c.affido)) r.push(`In attesa di affido da oltre ${oreAffido} ore: ${plurale(pos(c.affido), 'spedizione', 'spedizioni')}`);
    r.push(unisci('Assistenza', [pos(c.csNuove) ? plurale(pos(c.csNuove), 'richiesta nuova oggi', 'richieste nuove oggi') : '',
      pos(c.csFerme) ? `${plurale(pos(c.csFerme), 'ferma', 'ferme')} da oltre 24 ore` : '']));
    r.push(unisci('Premia', [rigaDaApprovare(c)]));
  }
  return r.filter(Boolean).slice(0, 4);
}
function msgRiepilogo(cands: Cand[], c: ContiRiepilogo, giorni: number, oreAffido: number): Msg[] {
  const out: Msg[] = [];
  for (const k of cands) {
    if (!CHI_PERSONE.includes(k.rif.chi)) continue;
    const righe = righeRiepilogo(k.rif.chi, c, giorni, oreAffido);
    if (!righe.length) continue;
    out.push({ chiave: k.chiave, tema: TEMA_EVENTO.riepilogo, chi: k.rif.chi, url: APP_URL, titolo: 'Riepilogo di oggi', testo: righe.join('\n') });
  }
  return out;
}
// righe lette per il riepilogo: ordini del giorno (importo lordo), scontrini di cassa (prezzo = totale della riga,
// CONOSCENZA 06-07), ordini pagati non evasi oltre `giorni` lavorativi
function sommaOrdini(righe: Riga[]): { n: number; incasso: number } {
  let incasso = 0;
  for (const r of righe ?? []) { const v = Number(r?.gross_total); if (Number.isFinite(v)) incasso += v; }
  return { n: (righe ?? []).length, incasso };
}
function sommaCassa(righe: Riga[]): { scontrini: number; incasso: number } {
  const ord = new Set<string>();
  let incasso = 0;
  for (const r of righe ?? []) {
    if (r?.order_id != null && String(r.order_id)) ord.add(String(r.order_id));
    const v = Number(r?.prezzo); if (Number.isFinite(v)) incasso += v;
  }
  return { scontrini: ord.size, incasso };
}
function ordiniInRitardo(righe: Riga[], oggi: string, giorni: number): string[] {
  const out: string[] = [];
  for (const r of righe ?? []) {
    const t = msDi(r?.created_at_shop), n = numeroOrdine(r?.order_number);
    if (!n || !Number.isFinite(t)) continue;
    if (giorniLavorativiDopo(dataRoma(t), oggi) > giorni) out.push(n);
  }
  return out;
}
// arrivi del giorno = righe d'ordine fornitore con un arrivo NETTO positivo oggi (B3, Gate 3 del 18-10). write-api scrive
// arrival_set a ogni salvataggio con delta = target - attuale, anche 0 (risalvataggio, solo costo) o negativo (correzione,
// storno): contare le righe di change_log gonfiava il numero (02-10: 5 contro i 2 veri). Si somma per riga d'ordine
// (row_id); le righe legacy 'arrival' hanno qty e non delta. Una riga senza ne' l'uno ne' l'altro, o senza row_id, non conta.
function contaArrivi(righe: Riga[]): number {
  const netto = new Map<string, number>();
  for (const r of righe ?? []) {
    const grezzo = r?.delta ?? r?.qty;
    if (r?.row_id == null || String(r.row_id) === '' || grezzo == null || grezzo === '') continue;
    const v = Number(grezzo);
    if (!Number.isFinite(v)) continue;
    netto.set(String(r.row_id), (netto.get(String(r.row_id)) ?? 0) + v);
  }
  let n = 0;
  for (const v of netto.values()) if (v > 0) n++;
  return n;
}

// attivita_team (21-10, OK di Dan in chat: "vorrei anche esser notificato quando le ragazze fanno operazioni tipo
// registra ordine, pezzi arrivati, e conta fisica"). Sorgente: change_log (core, sola lettura), le righe che write-api
// scrive con order_multi, arrival_set e count_apply. Solo quelle di Benny e Ginni (chi 'Bene' e 'Ginevra', chiavi di
// PEOPLE): mai quelle di Ale, di Claude-Code o dei giri automatici. Un candidato per riga di change_log (chiave
// cl:<id>): il registro copre ogni riga una volta sola, e il giro le raggruppa per persona e tipo (eseguiGruppi), UNA
// push per gruppo. Un arrivo a delta 0 (risalvataggio, solo il costo: 10 su 109 nei 120 giorni) non muove pezzi e non e'
// un candidato; uno negativo (correzione o storno) si'. Nel testo solo codici prodotto, nomi dei fornitori e numeri.
const OP_ATTIVITA = ['order_multi', 'arrival_set', 'count_apply'];
const PERSONA_TEAM: Record<string, string> = { Bene: 'Benny', Ginevra: 'Ginni' };
const persona = (chi: unknown): string => (typeof chi === 'string' && Object.prototype.hasOwnProperty.call(PERSONA_TEAM, chi) ? PERSONA_TEAM[chi] : '');
const CODICE_RE = /^[A-Za-z0-9_.-]{1,60}$/;
const codiceProdotto = (v: unknown): string => { const s = typeof v === 'string' ? v.trim() : ''; return CODICE_RE.test(s) ? s : ''; };
// intero da un numero o dal testo di after->>campo; altrimenti vuoto
const intero = (v: unknown): string => {
  const n = typeof v === 'number' || (typeof v === 'string' && v.trim() !== '') ? Number(v) : NaN;
  return Number.isSafeInteger(n) ? String(n) : '';
};
function candAttivita(righe: Riga[]): Cand[] {
  const out: Cand[] = [];
  for (const r of righe ?? []) {
    const id = intero(r?.id), chi = typeof r?.chi === 'string' && persona(r.chi) ? r.chi : '';
    const op = typeof r?.op === 'string' && OP_ATTIVITA.includes(r.op) ? r.op : '';
    if (!id || Number(id) <= 0 || !chi || !op) continue;
    const delta = intero(r.delta);
    if (op === 'arrival_set' && (delta === '' || delta === '0')) continue;
    out.push({ chiave: 'cl:' + id, ts: msDi(r.ts), rif: { id, chi, op, gruppo: `${chi}:${op}`, codice: codiceProdotto(r.codice), delta,
      contati: intero(r.contati), prima: intero(r.giac_prima), fornitore: pulisci(r.fornitore, 40), righe: intero(r.righe),
      ordine: typeof r.gruppo === 'string' && UUID_RE.test(r.gruppo) ? r.gruppo.toLowerCase() : '' } });
  }
  return ordinaRecenti(out);
}
const VOCI_MAX = 4;
const primeVoci = (voci: string[], sep: string, altri: (n: number) => string) => voci.slice(0, VOCI_MAX).join(sep) + (voci.length > VOCI_MAX ? sep + altri(voci.length - VOCI_MAX) : '');
const eAltri = (n: number) => (n === 1 ? 'e un altro' : `e altri ${n}`);
// un ordine: "<fornitore>: N righe (CODICE x20, CODICE e altri N)". Codici e quantita' dalle righe dell'ordine
// (supplier_orders per gruppo); una riga WIP (quantita' ancora da definire) senza quantita'. Un ordine cancellato dopo
// non ha righe: restano fornitore e numero di righe.
function rigaOrdine(c: Cand, ordini: Record<string, Riga[]>): string {
  const f = c.rif.fornitore || 'Fornitore';
  const lette = (ordini?.[c.rif.ordine] ?? []).map((r) => {
    const k = codiceProdotto(r?.codice), q = intero(r?.qty_ordered);
    return k ? (r?.wip !== true && Number(q) > 0 ? `${k} x${q}` : k) : '';
  }).filter(Boolean).sort();
  const n = Number(c.rif.righe) > 0 ? Number(c.rif.righe) : lette.length;
  const codici = lette.length ? ` (${lette.slice(0, 3).join(', ')}${lette.length > 3 ? ' ' + eAltri(lette.length - 3) : ''})` : '';
  return n > 0 ? `${f}: ${plurale(n, 'riga', 'righe')}${codici}` : f + codici;
}
// UNA push per un gruppo (stessa persona, stesso tipo), con le sole righe passate: il giro le passa dopo averle
// prenotate, quindi il testo dice esattamente le righe che questa push copre. Righe di persone o tipi diversi = nessun
// messaggio (non e' un gruppo).
function msgGruppoAttivita(cands: Cand[], ordini: Record<string, Riga[]>): Msg | null {
  const cs = (cands ?? []).filter((c) => c?.rif && persona(c.rif.chi) && OP_ATTIVITA.includes(c.rif.op)).sort((a, b) => Number(a.rif.id) - Number(b.rif.id));
  if (!cs.length || cs.length !== (cands ?? []).length) return null;
  const { chi, op } = cs[0].rif;
  if (cs.some((c) => c.rif.chi !== chi || c.rif.op !== op)) return null;
  const p = persona(chi);
  const base = { chiave: `${chi}:${op}`, tema: TEMA_EVENTO.attivita_team, url: APP_URL };
  if (op === 'order_multi') {
    return { ...base, titolo: cs.length === 1 ? `${p} ha registrato un ordine` : `${p} ha registrato ${cs.length} ordini`,
      testo: primeVoci(cs.map((c) => rigaOrdine(c, ordini)), '\n', (n) => (n === 1 ? 'e un altro ordine' : `e altri ${n} ordini`)) };
  }
  if (op === 'arrival_set') {
    // al netto per codice: un +10 e un -10 sullo stesso codice nello stesso gruppo non sono pezzi arrivati
    const netto = new Map<string, number>();
    for (const c of cs) { const k = c.rif.codice || 'codice illeggibile'; netto.set(k, (netto.get(k) ?? 0) + (Number(c.rif.delta) || 0)); }
    const voci = [...netto].filter(([, v]) => v !== 0).map(([k, v]) => `${k} ${v > 0 ? '+' : ''}${v}`);
    const totale = [...netto.values()].reduce((s, v) => s + v, 0);
    return { ...base, titolo: totale > 0 ? `${p}: pezzi arrivati` : `${p}: arrivi corretti`,
      testo: voci.length ? primeVoci(voci, ', ', eAltri) + (voci.length > 1 && totale > 0 ? `. In tutto ${plurale(totale, 'pezzo', 'pezzi')}` : '')
        : 'Arrivi corretti, nessun pezzo in piu\' o in meno.' };
  }
  const voci = cs.map((c) => `${c.rif.codice || 'codice illeggibile'}: ${c.rif.contati !== '' ? c.rif.contati + (c.rif.prima !== '' ? ` (prima ${c.rif.prima})` : '') : 'contato'}`);
  return { ...base, titolo: cs.length === 1 ? `${p} ha fatto una conta` : `${p} ha fatto ${cs.length} conte`, testo: primeVoci(voci, ', ', eAltri) };
}
// i gruppi di un elenco di candidati (anteprima e componi): uno per persona e tipo, nell'ordine del primo candidato
function msgAttivita(cands: Cand[], ordini: Record<string, Riga[]>): Msg[] {
  const per = new Map<string, Cand[]>();
  for (const c of cands ?? []) {
    const g = c?.rif?.gruppo;
    if (typeof g !== 'string' || !g) continue;
    const l = per.get(g);
    if (l) l.push(c); else per.set(g, [c]);
  }
  const out: Msg[] = [];
  for (const cs of per.values()) { const m = msgGruppoAttivita(cs, ordini); if (m) out.push(m); }
  return out;
}

// ---- chat del sito (v7, 08-11, PROPOSTA_chat_sito 8.3-8.6 e 8.10) ----
// Una chat aspetta il team quando e' `attesa_persona` (la cliente ha chiesto una persona) o `aperta` (presa da qualcuno)
// e il team non ha risposto DOPO l'ultimo passaggio (ultima_risposta_staff_at vuota o prima di passaggio_at). Il sollecito
// si ferma da solo quando lo staff risponde, la chat si chiude o torna al bot (8.5): sono tutti stati letti a ogni giro.
// Come nella proposta (8.3: una chiave per passaggio e per passo) il sollecito segue il PASSAGGIO. B4 (Gate 2 del pezzo 4,
// deciso nel pezzo 6, CASI_APERTI n.54 k): una cliente che riscrive con testo libero dopo una risposta del team apre un
// passaggio nuovo in chat-api api-3 (avviso, push immediata), quindi anche i solleciti ripartono, da quel passaggio.
// preso_da usa i nomi del selettore (Benedetta, Ginevra, Ale): nel testo i nomi di casa. Le push vanno al tema
// dell'evento, mai con `chi`, quindi la mappa Benedetta -> Bene di push-api qui non serve (8.5).
const PRESO_DA: Record<string, string> = { Benedetta: 'Benny', Ginevra: 'Ginni', Ale: 'Ale' };
const presoDa = (v: unknown): string => (typeof v === 'string' && Object.prototype.hasOwnProperty.call(PRESO_DA, v) ? PRESO_DA[v] : '');
// una push di passaggio ferma su `prenotato` da 10 minuti e' di un'istanza morta (inviaPush smette a 40 s): si ritenta
const PASSAGGIO_FERMO_MS = 10 * 60000;
const PASSAGGIO_CHIAVE_RE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):passaggio:([1-9][0-9]{0,5})$/;
type AttesaChat = { id: string; n: number; da: number; aspetta: boolean };
function attesaChat(r: Riga): AttesaChat | null {
  const id = typeof r?.id === 'string' && UUID_RE.test(r.id) ? r.id.toLowerCase() : '';
  const n = Number(r?.passaggi), da = msDi(r?.passaggio_at);
  if (!id || !Number.isSafeInteger(n) || n < 1 || !Number.isFinite(da) || (r.stato !== 'attesa_persona' && r.stato !== 'aperta')) return null;
  const risposta = msDi(r.ultima_risposta_staff_at);
  return { id, n, da, aspetta: !(Number.isFinite(risposta) && risposta >= da) };
}
// chi e' la cliente: solo da nomeCliente (D-9), una volta sola nel codice
const clienteChat = (r: Riga): string => nomeCliente(r.customer_name, r.customer_email);
// le chiavi di chat_eventi delle push di passaggio ancora da guardare: una per chat in attesa_persona, il passaggio corrente
function chiaviPassaggio(sessioni: Riga[]): string[] {
  const out: string[] = [];
  for (const r of sessioni ?? []) { const a = r?.stato === 'attesa_persona' ? attesaChat(r) : null; if (a?.aspetta) out.push(`${a.id}:passaggio:${a.n}`); }
  return [...new Set(out)];
}
// Esito della push di passaggio scritto da chat-api in chat_eventi (esitoDaSalvare: `status` e `errore`, niente `prova`,
// Gate 2 B1). Gate 2, B2: un `fallito` SENZA status (nessuna risposta di push-api: timeout di inviaPush a 40 s o rete) e'
// un esito ignoto, perche' push-api va avanti fino a 100 s e puo' aver consegnato: non si ritenta (un doppione e' peggio
// di una push persa e visibile, come chiusura() per gli eventi di push-eventi, RF-3) e chat_salute lo dice. Un `fallito`
// con lo status (push-api ha risposto con un errore, o push_enabled spento) si ritenta; un `prenotato` fermo da 10
// minuti (istanza morta prima di scrivere l'esito) si ritenta come un `fallito` (C7 del pezzo 2).
function esitoPassaggio(e: Riga | undefined, ora: number): '' | 'nessun_iscritto' | 'fallito' | 'ignoto' | 'fermo' {
  if (!e) return '';
  if (e.esito === 'nessun_iscritto') return 'nessun_iscritto';
  if (e.esito === 'fallito') return typeof e.status === 'string' && /^\d{3}$/.test(e.status) ? 'fallito' : 'ignoto';
  const at = msDi(e.at);
  return e.esito === 'prenotato' && Number.isFinite(at) && ora - at >= PASSAGGIO_FERMO_MS ? 'fermo' : '';
}
// chat_sollecito, parte 1: il nuovo tentativo della push di passaggio (8.4, C7 del pezzo 2) finche' la chat e'
// `attesa_persona`. Chiave = quella di chat_eventi (`<sessione>:passaggio:<n>`), nel registro di push-eventi: dopo
// l'invio e' finale, un `fallito` si ritenta fino a 3 volte. `nessun_iscritto` resta finale (non si ritenta: lo dice
// chat_salute), e cosi' l'esito ignoto (B2). Senza riga in chat_eventi da 10 minuti (chat-api caduta fra il passaggio e la
// prenotazione) = come fermo. Istante = adesso (e' uno stato). urgente come chat-api: solo dentro l'orario.
function candChatPassaggio(o: { sessioni: Riga[]; eventi: Riga[]; orari: OrariChat; ora: number }): Cand[] {
  const ev = new Map<string, Riga>();
  for (const e of o.eventi ?? []) if (typeof e?.chiave === 'string') ev.set(e.chiave.toLowerCase(), e);
  const out: Cand[] = [];
  for (const r of o.sessioni ?? []) {
    const a = r?.stato === 'attesa_persona' ? attesaChat(r) : null;
    if (!a?.aspetta) continue;
    const chiave = `${a.id}:passaggio:${a.n}`;
    const e = ev.get(chiave), esito = esitoPassaggio(e, o.ora);
    const motivo = !e ? (o.ora - a.da >= PASSAGGIO_FERMO_MS ? 'mancante' : '') : esito === 'fallito' || esito === 'fermo' ? esito : '';
    if (!motivo) continue;
    out.push({ chiave, ts: o.ora, rif: { tipo: 'passaggio', motivo, prova: r.prova === true ? '1' : '', cliente: clienteChat(r), urgente: inOrarioChat(o.ora, o.orari) ? '1' : '' } });
  }
  return ordinaRecenti(out);
}
// chat_sollecito (passo 1) e chat_sollecito_scala (passo 2): una chat che aspetta il team da `ore[passo - 1]` ore contate
// nei giorni lavorativi (dovutoDopo). Candidato solo DENTRO l'orario di chat_orari (8.5: di notte non si sveglia
// nessuno): un passo dovuto alle 23 parte alle 9 del giorno lavorativo dopo. Chiave `<sessione>:<passaggio>:sollecito:<passo>`,
// una per passaggio e per passo, ricavata dai dati e stabile se cambia chat_sollecito_ore; istante = adesso (8.5: con
// l'istante del passo dovuto un passo scaduto in una pausa diventerebbe `saltato` vecchio). Nome, presa in carico e ore
// stanno in rif: componi non rilegge niente (8.8, la chiave non si brucia).
function candChatSollecito(o: { sessioni: Riga[]; ore: [number, number]; orari: OrariChat; ora: number; passo: 1 | 2 }): Cand[] {
  if (!inOrarioChat(o.ora, o.orari)) return [];
  const ore = o.ore[o.passo - 1];
  const out: Cand[] = [];
  for (const r of o.sessioni ?? []) {
    const a = attesaChat(r);
    if (!a?.aspetta) continue;
    const dovuto = dovutoDopo(a.da, ore, o.orari);
    if (dovuto === null || o.ora < dovuto) continue;
    out.push({ chiave: `${a.id}:${a.n}:sollecito:${o.passo}`, ts: o.ora, rif: { tipo: 'sollecito', passo: String(o.passo), ore: String(ore), ore1: String(o.ore[0]),
      prova: r.prova === true ? '1' : '', cliente: clienteChat(r), preso: r.stato === 'aperta' ? presoDa(r.preso_da) : '' } });
  }
  return ordinaRecenti(out);
}
// "1 giorno lavorativo", "2 giorni lavorativi", "6 ore lavorative", "3 minuti" (un valore di prova)
function oreTesto(h: number): string {
  if (!(h > 0)) return 'qualche ora';
  if (h % 24 === 0) return plurale(h / 24, 'giorno lavorativo', 'giorni lavorativi');
  if (h >= 1 && Number.isInteger(h)) return plurale(h, 'ora lavorativa', 'ore lavorative');
  return plurale(Math.max(1, Math.round(h * 60)), 'minuto', 'minuti');
}
// Testi (D-9, 8.7): chi e' la cliente (nome o email, da nomeCliente), mai il testo della chat; "PROVA " in testa per una
// sessione di prova (13.1). Il nuovo tentativo del passaggio ha il titolo e il testo di chat-api (messaggioPush), cosi' sul
// telefono e' la stessa notifica. Un nome si accorcia per stare nei 120 punti di codice del titolo di push-api; un'email
// no (Gate 2, C5: un'email tagliata non e' piu' un'email, come in nomeCliente): se non ci sta, "Una cliente".
function msgChatSollecito(cands: Cand[]): Msg[] {
  return cands.map((c) => {
    const p = c.rif.prova ? 'PROVA ' : '';
    const chi = c.rif.cliente || 'Una cliente';
    if (c.rif.tipo === 'passaggio') {
      return { chiave: c.chiave, tema: TEMA_EVENTO.chat_sollecito, url: LINK_ASSISTENZA, urgente: c.rif.urgente === '1', titolo: `${p}Chat del sito: ${chi} chiede una persona`, testo: 'Apri Assistenza.' };
    }
    const scala = c.rif.passo === '2';
    const testa = `${p}${scala ? 'Chat senza risposta' : 'Chat in attesa'} da ${oreTesto(Number(c.rif.ore))}: `;
    const posto = TITOLO_MAX_PUSH - Array.from(testa).length;
    const nome = Array.from(chi).length <= posto ? chi : chi.includes('@') ? 'Una cliente' : pulisci(chi, posto);
    const presa = c.rif.preso ? `Presa da ${c.rif.preso}, ancora` : 'Ancora';
    // Gate 2, C2: il passo 1 puo' non essere partito (evento spento, nessun telefono): il testo dice quando era previsto
    return { chiave: c.chiave, tema: scala ? TEMA_EVENTO.chat_sollecito_scala : TEMA_EVENTO.chat_sollecito, url: LINK_ASSISTENZA, urgente: true, titolo: testa + nome,
      testo: scala ? `${presa} senza risposta: il primo promemoria era previsto dopo ${oreTesto(Number(c.rif.ore1))}. Apri Assistenza.` : `${presa} senza risposta del team. Apri Assistenza.` };
  });
}
// chat_salute (tema sistema, evento di stato, 8.6 e 8.10): un candidato per guasto, solo conteggi e cause scritte nel
// codice, MAI dati della cliente (`sistema` non va per forza a chi segue le clienti). Chiavi che riguardano una chat in
// testa con l'id della sessione (`<sessione>:...`), cosi' cancella_dati e la pulizia a 12 mesi le tolgono con lei (11.6
// punto 4); le altre per giorno UTC, come i contatori e gli eventi di chat-api (scostamento dichiarato da 8.6, che dice
// il giorno di Roma: una chiave per giorno di Roma su un contatore per giorno UTC darebbe due push per lo stesso guasto).
// "PROVA" in testa per una sessione di prova, letto da chat_sessioni (Gate 2, B1: chat-api, scrivendo l'esito, sostituisce
// il dettaglio della riga e il flag prova si perde). Righe di 8.10:
//   4  push di passaggio a nessuno (`nessun_iscritto`), non partita (`fallito` con risposta di push-api), con esito
//      ignoto (`fallito` senza risposta, B2) o ferma (`prenotato` da 10 minuti): `<s>:<n>:passaggio`
//   6  email di risposta in `errore` nelle 24 ore: "non partita: ..." (si puo' rimandare) e "esito ignoto: ..." (no), una
//      push per messaggio, `<s>:email:<m>`; le cause di destinatario (indirizzo non valido, riservato, del team su una
//      chat vera; Gate 2, B3) una per chat, non urgente, `<s>:destinatario`, e mai per una chat di prova (che per regola
//      scrive solo al team: un rifiuto e' atteso)
//   8  risposte dello staff senza email da oltre 10 minuti, o prenotate da oltre 20 (chat-send fermo, Gmail giu'): `invio:<g>`
//   7  chat-api con richieste in errore nel giorno (contatore glob:sev_error, che sopravvive al refresh di health_log): `api:<g>`
//   11 tetto delle chat nuove del giorno raggiunto (evento `limite:<g>` di chat-api): `limite:<g>`
//   16 richieste a chat-api oltre la soglia (5.000, D-12; contatore glob:richieste): `quota:<g>`
//   13 errori del widget oltre la soglia (20; contatore glob:errore, al tetto di 100 il beacon tace): `widget:<g>`
// I contatori si leggono per oggi e ieri (UTC): un guasto delle 23:58 non si perde al cambio di giorno, e quello di ieri
// gia' mandato e' `inviato` nel registro. Nel testo la data, non "oggi" (Gate 2, C4: fra mezzanotte e le 2 di Roma il
// giorno UTC e' ancora quello prima).
const ERRORI_BEACON_TETTO = 100;
function sessioniDaChiavi(passaggi: Riga[]): string[] {
  const out: string[] = [];
  for (const e of passaggi ?? []) { const m = typeof e?.chiave === 'string' ? PASSAGGIO_CHIAVE_RE.exec(e.chiave.toLowerCase()) : null; if (m) out.push(m[1]); }
  return out;
}
function candChatSalute(o: { passaggi: Riga[]; email: Riga[]; prova: Record<string, boolean>; coda: number; contatori: Riga[]; limiti: Riga[]; ora: number; sogliaRichieste: number; sogliaWidget: number }): Cand[] {
  const out: Cand[] = [];
  const oggi = giornoUtc(o.ora);
  const prova = (sid: string) => (o.prova?.[sid] === true ? '1' : '');
  for (const e of o.passaggi ?? []) {
    const m = typeof e?.chiave === 'string' ? PASSAGGIO_CHIAVE_RE.exec(e.chiave.toLowerCase()) : null;
    if (!m) continue;
    const motivo = esitoPassaggio(e, o.ora);
    if (motivo) out.push({ chiave: `${m[1]}:${m[2]}:passaggio`, ts: o.ora, rif: { tipo: 'passaggio', motivo, prova: prova(m[1]) } });
  }
  const destinatario = new Set<string>();
  for (const r of o.email ?? []) {
    const id = typeof r?.id === 'string' && UUID_RE.test(r.id) ? r.id.toLowerCase() : '';
    const sid = typeof r?.sessione_id === 'string' && UUID_RE.test(r.sessione_id) ? r.sessione_id.toLowerCase() : '';
    if (!id || !sid) continue;
    const causa = typeof r.email_errore === 'string' ? r.email_errore : '';
    const motivo = /^esito ignoto\b/.test(causa) ? 'ignoto' : /^non partita: /.test(causa) ? 'non_partita' : 'destinatario';
    if (motivo !== 'destinatario') out.push({ chiave: `${sid}:email:${id}`, ts: o.ora, rif: { tipo: 'email', motivo, prova: prova(sid) } });
    else if (!prova(sid) && !destinatario.has(sid)) { destinatario.add(sid); out.push({ chiave: `${sid}:destinatario`, ts: o.ora, rif: { tipo: 'email', motivo } }); }
  }
  if (Number.isSafeInteger(o.coda) && o.coda > 0) out.push({ chiave: `invio:${oggi}`, ts: o.ora, rif: { tipo: 'invio', n: String(o.coda) } });
  for (const r of o.contatori ?? []) {
    const f = msDi(r?.finestra), n = Number(r?.n);
    if (!Number.isFinite(f) || f % 86400000 !== 0 || !Number.isSafeInteger(n) || n <= 0) continue;
    const g = giornoUtc(f);
    if (r.chiave === 'glob:sev_error') out.push({ chiave: `api:${g}`, ts: o.ora, rif: { tipo: 'api', n: String(n), giorno: g } });
    else if (r.chiave === 'glob:richieste' && n >= o.sogliaRichieste) out.push({ chiave: `quota:${g}`, ts: o.ora, rif: { tipo: 'quota', n: String(n), soglia: String(o.sogliaRichieste), giorno: g } });
    else if (r.chiave === 'glob:errore' && n >= o.sogliaWidget) out.push({ chiave: `widget:${g}`, ts: o.ora, rif: { tipo: 'widget', n: String(n), soglia: String(o.sogliaWidget), tetto: n > ERRORI_BEACON_TETTO ? '1' : '', giorno: g } });
  }
  for (const r of o.limiti ?? []) {
    const m = typeof r?.chiave === 'string' ? /^limite:(\d{4}-\d{2}-\d{2})$/.exec(r.chiave) : null;
    if (m) out.push({ chiave: `limite:${m[1]}`, ts: o.ora, rif: { tipo: 'limite', giorno: m[1], oggi: m[1] === oggi ? '1' : '' } });
  }
  return ordinaRecenti(out);
}
// la data di un giorno UTC nei testi: "9 novembre (UTC)"
const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
const giornoTesto = (g: unknown): string => { const m = typeof g === 'string' ? /^\d{4}-(\d{2})-(\d{2})$/.exec(g) : null; return m && MESI[Number(m[1]) - 1] ? `${Number(m[2])} ${MESI[Number(m[1]) - 1]} (UTC)` : 'giorno non leggibile'; };
const TESTI_PASSAGGIO: Record<string, [string, string]> = {
  nessun_iscritto: ['richiesta senza notifica', 'Una cliente ha chiesto una persona, ma la notifica non e\' arrivata a nessuno: nessun telefono riceve il tema Assistenza (nessuno iscritto o tema spento). La chat aspetta una risposta.'],
  fallito: ['notifica di richiesta non partita', 'La notifica "chiede una persona" non e\' partita (push-api in errore): chat_sollecito la ritenta, al massimo tre volte, finche\' la chat aspetta.'],
  ignoto: ['notifica di richiesta senza esito', 'La notifica "chiede una persona" non ha avuto risposta da push-api: forse e\' arrivata, forse no, e non si ritenta. Controlla la chat in Assistenza.'],
  fermo: ['notifica di richiesta senza esito', 'La notifica "chiede una persona" e\' rimasta a meta\' (chat-api interrotta): chat_sollecito la ritenta finche\' la chat aspetta.'],
};
function msgChatSalute(cands: Cand[]): Msg[] {
  const out: Msg[] = [];
  for (const c of cands) {
    const p = c.rif.prova ? 'PROVA ' : '';
    const base = { chiave: c.chiave, tema: TEMA_EVENTO.chat_salute, url: LINK_SALUTE };
    const n = Number(c.rif.n) || 0, quando = giornoTesto(c.rif.giorno);
    if (c.rif.tipo === 'passaggio') {
      const tp = TESTI_PASSAGGIO[c.rif.motivo];
      if (tp) out.push({ ...base, urgente: true, titolo: `${p}Chat del sito: ${tp[0]}`, testo: tp[1] });
    } else if (c.rif.tipo === 'email') {
      if (c.rif.motivo === 'non_partita') out.push({ ...base, urgente: true, titolo: `${p}Chat del sito: email di risposta non partita`, testo: 'Gmail ha rifiutato l\'email con una risposta del team: si puo\' rimandare dalla chat.' });
      else if (c.rif.motivo === 'ignoto') out.push({ ...base, urgente: true, titolo: `${p}Chat del sito: email di risposta con esito ignoto`, testo: 'Gmail non ha confermato l\'invio di una risposta del team: controlla in info@ se e\' partita, non si rimanda da sola.' });
      else out.push({ ...base, titolo: 'Chat del sito: email della cliente non utilizzabile', testo: 'Le risposte del team a una chat restano nella chat ma non partono per email: l\'indirizzo lasciato dalla cliente non e\' utilizzabile (non valido, riservato o del team).' });
    } else if (c.rif.tipo === 'invio') {
      out.push({ ...base, urgente: true, titolo: 'Chat del sito: email in coda', testo: `${plurale(n, 'risposta del team aspetta', 'risposte del team aspettano')} l'email da oltre 10 minuti: chat-send fermo o Gmail non disponibile.` });
    } else if (c.rif.tipo === 'api') {
      out.push({ ...base, urgente: true, titolo: 'Chat del sito in errore', testo: `chat-api: ${plurale(n, 'richiesta', 'richieste')} in errore nel giorno ${quando}. Dettagli in Salute.` });
    } else if (c.rif.tipo === 'limite') {
      out.push({ ...base, urgente: true, titolo: 'Chat del sito: tetto delle chat nuove raggiunto', testo: `Raggiunto il tetto delle chat nuove del giorno ${quando}${c.rif.oggi ? ': fino a mezzanotte UTC nessun\'altra cliente puo\' aprirne una' : ''}. Se e' un abuso, spegni l'embed della chat.` });
    } else if (c.rif.tipo === 'quota') {
      out.push({ ...base, titolo: 'Chat del sito: troppe richieste', testo: `${euro(n)} richieste a chat-api nel giorno ${quando}, soglia ${euro(Number(c.rif.soglia))}: possibile abuso. Se lo e', spegni l'embed della chat.` });
    } else if (c.rif.tipo === 'widget') {
      out.push({ ...base, titolo: 'Chat del sito: errori del widget', testo: c.rif.tetto
        ? `Tetto del beacon raggiunto nel giorno ${quando}: possibile abuso, gli errori veri del giorno non si vedono.`
        : `${plurale(n, 'errore', 'errori')} del widget nel giorno ${quando}, soglia ${Number(c.rif.soglia) || 0}.` });
    }
  }
  return out;
}

// stock_fermo (09-11, v9, tema magazzino, chiesta da Dan): un prodotto con pezzi a magazzino da almeno 3 giorni e nessuna
// pagina attiva sul sito (v_stock_fermo, migr 0190). Il 09-11 erano 107 pezzi su 13 codici, e la stessa sera la scheda
// della Home li mostrava gia' a tutti: la push porta la notizia a chi li mette in vendita (Benny e Ginni) anche ad app
// chiusa. Chiave fermo:<codice>:<fermo_dal> (la data del pezzo piu' vecchio ancora a magazzino, o senza_arrivi): un lotto
// fermo avvisa UNA volta; se escono pezzi vecchi e la data avanza e' un lotto nuovo. Istante = adesso (e' uno stato), solo
// dalle `oraDa` di Roma (9): un prodotto che diventa fermo a mezzanotte avvisa al mattino. Evento di stato
// (EVENTI_DI_STATO): all'accensione i prodotti gia' fermi partono nella prima push, non si saltano. Nel testo solo nome e
// codice del prodotto, pezzi, giorni e stato della pagina: mai prezzi o valore (le select non li chiedono nemmeno).
const DATA_RE = /^\d{4}-\d{2}-\d{2}$/;
function statoPagina(v: unknown): string {
  const s = typeof v === 'string' ? v : '';
  return s === 'assente' ? 'senza pagina' : /(^|,)draft(,|$)/.test(s) ? 'in bozza' : /(^|,)archived(,|$)/.test(s) ? 'archiviata' : 'non attiva';
}
// Gate 2 del 09-11: mai di domenica (come il riepilogo, lunedi'-sabato): un lotto fermo dal sabato avvisa il lunedi'.
function candStockFermo(righe: Riga[], ora: number, oraDa: number): Cand[] {
  const r0 = partiRoma(ora);
  if (r0.wd === 'Sun' || r0.h < oraDa) return [];
  const out: Cand[] = [];
  for (const r of righe ?? []) {
    const codice = codiceProdotto(r?.codice), pezzi = intero(r?.pezzi);
    if (!codice || !pezzi || Number(pezzi) <= 0) continue;
    const dal = typeof r.fermo_dal === 'string' && DATA_RE.test(r.fermo_dal) ? r.fermo_dal : 'senza_arrivi';
    const nome = pulisci([r.item, r.variant].filter((x) => typeof x === 'string' && x.trim()).join(' '), 50);
    out.push({ chiave: `fermo:${codice}:${dal}`, ts: ora, rif: { codice, nome: nome || codice, pezzi, giorni: intero(r.giorni), stato: statoPagina(r.stato_shopify) } });
  }
  return ordinaRecenti(out);
}
// UNA push per giro con tutti i prodotti nuovi (un gruppo solo), dal piu' grosso. Link alla Home, dove sta l'elenco intero.
function msgGruppoStockFermo(cands: Cand[]): Msg | null {
  const cs = (cands ?? []).filter((c) => c && c.rif && Number(c.rif.pezzi) > 0)
    .sort((a, b) => Number(b.rif.pezzi) - Number(a.rif.pezzi) || (a.chiave < b.chiave ? -1 : a.chiave > b.chiave ? 1 : 0));
  if (!cs.length) return null;
  const base = { chiave: cs[0].chiave, tema: TEMA_EVENTO.stock_fermo, url: APP_URL };
  if (cs.length === 1) {
    const c = cs[0].rif;
    const da = Number(c.giorni) > 0 ? ` da ${plurale(Number(c.giorni), 'giorno', 'giorni')}` : '';
    return { ...base, titolo: `Pezzi fermi: ${c.nome}`.slice(0, TITOLO_MAX_PUSH),
      testo: `${plurale(Number(c.pezzi), 'pezzo', 'pezzi')} a magazzino${da}, non in vendita sul sito (${c.stato}). Codice ${c.codice}. Elenco nella Home dell'app.` };
  }
  const tot = cs.reduce((s, c) => s + Number(c.rif.pezzi), 0);
  const voci = cs.map((c) => `${c.rif.nome} ${c.rif.pezzi} pz (${c.rif.stato})`);
  return { ...base, titolo: `Pezzi fermi: ${plurale(cs.length, 'prodotto', 'prodotti')}, ${plurale(tot, 'pezzo', 'pezzi')}`,
    testo: `Non in vendita sul sito: ${primeVoci(voci, '; ', eAltri)}. Elenco nella Home dell'app.` };
}
// ==== PURE:pe-messaggi END ====

// ==== PURE:pe-registro BEGIN ====
// Registro push_eventi_inviati (UNIQUE evento, chiave). Stati finali: inviato, saltato, nessun_iscritto. Si riprova (al
// massimo 3 tentativi in tutto) un `fallito`, o un `prenotato` fermo da 15 minuti (la edge e' caduta fra prenotazione e
// invio), purche' l'evento abbia meno di `eta` ore.
const STALLO_MS = 2 * 3600000;
const PRENOTATO_SCADUTO_MS = 15 * 60000;
const MAX_TENTATIVI = 3;
const TETTO_INVII = 20;
const FINALI = ['inviato', 'saltato', 'nessun_iscritto'];
// eventi che descrivono uno STATO di adesso, non un fatto passato: non seminano il pregresso (RF-4, Gate 3 del 18-10). Uno
// stallo di cs-sync gia' in corso quando l'evento si accende, o quando push-eventi riparte dopo una pausa, e' una notizia
// di adesso: con la baseline la sua chiave (l'istante dell'ultima riga, che non cambia finche' lo stallo dura) restava
// `saltato` e lo stallo non arrivava mai.
// premia_salute (03-11) e' dello stesso tipo: un guasto di Premia gia' in corso all'accensione si deve vedere. Cosi' anche
// sistema_senza_iscritti (06-11): un tema gia' senza telefoni all'accensione e' proprio il guasto da vedere. E chat_salute
// (08-11, 8.6). I due solleciti della chat no: si accendono prima di chat_sito_enabled, nessun arretrato (8.3).
// stock_fermo (09-11, v9): i prodotti gia' fermi all'accensione sono proprio la notizia (il 09-11 erano 11).
const EVENTI_DI_STATO = ['sistema_cs_sync_fermo', 'premia_salute', 'sistema_senza_iscritti', 'chat_salute', 'stock_fermo'];
type Reg = { id: number | string; chiave: string; stato: string; tentativi: number; updated_at: string };
type Decisione = { cand: Cand; azione: 'nuovo' | 'ritenta' | 'salta' | 'fermo'; motivo: string; reg?: Reg };
// prima accensione (baseline_at vuoto) o ripartenza: ultimo giro assente o di oltre 2 ore fa (evento spento e riacceso,
// flag spento, edge ferma). Allora quello che esiste gia' si segna `saltato` e non parte niente (alla ripartenza solo cio'
// che non e' fresco: frescoRipartenzaMs, sotto).
function serveBaseline(ev: { baseline_at?: unknown; ultimo_giro_at?: unknown }, ora: number): boolean {
  const b = msDi(ev?.baseline_at), u = msDi(ev?.ultimo_giro_at);
  return !Number.isFinite(b) || !Number.isFinite(u) || ora - u > STALLO_MS;
}
// seme: il giro scrive baseline_at (sempre, anche per gli eventi di stato). baseline: pianifica salta il pregresso.
// ripartenza: baseline con baseline_at gia' scritto, cioe' non la prima accensione: quello che si salta e' stato perso
// nella pausa e si registra col motivo 'stallo' (la salute lo conta per 24 ore), non 'baseline'.
function baselineDi(ev: { evento?: unknown; baseline_at?: unknown; ultimo_giro_at?: unknown }, ora: number): { seme: boolean; baseline: boolean; ripartenza: boolean } {
  const seme = serveBaseline(ev, ora);
  const baseline = seme && !EVENTI_DI_STATO.includes(String(ev?.evento));
  return { seme, baseline, ripartenza: baseline && Number.isFinite(msDi(ev?.baseline_at)) };
}
// v4 (31-10, CASI_APERTI 53: Supabase bloccato 14 ore per la quota Free). Fino alla v3 la ripartenza saltava TUTTO, anche
// cio' che era nato dopo la fine del blocco: cs-sync ha recuperato la posta alle 12:58, cs-classify l'ha classificata alle
// 13:00 e push-eventi e' ripartito alle 13:01, quindi un'urgente arrivata durante il blocco avrebbe perso la sua push (un
// classify di un minuto prima, segnato `saltato` stallo). Ora alla ripartenza un candidato senza riga di registro con
// l'evento entro FRESCO_RIPARTENZA_MS (e comunque entro eta_max_ore) parte come in un giro normale; il resto (piu' vecchio, o
// senza istante) resta `saltato` 'stallo' e la salute lo conta come prima. 2 ore come lo stallo: una pausa di poco meno di
// 2 ore non e' una ripartenza e manda gia' tutto quello che e' nato nel frattempo, quindi una ripartenza non manda mai piu'
// di una pausa normale (nessuna valanga nuova; resta il tetto di 20 invii per giro, il resto parte al giro dopo).
// L'istante di ogni evento e' quello in cui il fatto e' entrato nei dati: cs_events.at (default now() all'insert, per
// cs_urgente e cs_cliente_ha_riscritto), lead_touches.created_at (o at, oltre 72 ore di ritardo), shipping_status.updated_at
// (riscritto da shipping-status-sync solo a un cambio di stato), change_log.ts (default now()); un fatto recuperato dopo un
// blocco ha l'istante del recupero ed e' fresco. Un istante illeggibile non e' mai fresco. Fa eccezione il riepilogo: il suo
// istante (le 22:00 di Roma, dal 09-11) e' quello in cui diventa dovuto, non un fatto, e i numeri si calcolano all'invio; resta fresco
// per tutta l'eta' massima, cioe' finche' la sua finestra e' aperta (una push a testa al giorno). sistema_cs_sync_fermo non
// salta mai il pregresso (EVENTI_DI_STATO) e qui non entra, come premia_salute dal 03-11. premia_da_approvare ha l'istante
// in cui la cliente ha mandato il contenuto (loyalty_ugc.created_at, default now()).
const FRESCO_RIPARTENZA_MS = STALLO_MS;
function frescoRipartenzaMs(evento: unknown): number {
  return evento === 'riepilogo' ? Infinity : FRESCO_RIPARTENZA_MS;
}
// frescoMs vale solo alla ripartenza (motivoBaseline 'stallo'), mai oltre etaMaxMs; senza, si salta tutto come nella v3
function pianifica(cands: Cand[], registro: Map<string, Reg>, o: { ora: number; baseline: boolean; etaMaxMs: number; motivoBaseline?: string; frescoMs?: number }): Decisione[] {
  const visti = new Set<string>();
  const out: Decisione[] = [];
  const motivoBaseline = o.motivoBaseline === 'stallo' ? 'stallo' : 'baseline';
  const finestraFresca = motivoBaseline === 'stallo' && typeof o.frescoMs === 'number' && o.frescoMs > 0 ? Math.min(o.frescoMs, o.etaMaxMs) : null;
  for (const cand of cands) {
    if (!cand || typeof cand.chiave !== 'string' || !cand.chiave || visti.has(cand.chiave)) continue;
    visti.add(cand.chiave);
    const eta = o.ora - cand.ts;
    const giovane = Number.isFinite(eta) && eta <= o.etaMaxMs;
    const fresco = finestraFresca !== null && Number.isFinite(eta) && eta <= finestraFresca;
    const r = registro.get(cand.chiave);
    if (!r) {
      if (o.baseline && !fresco) out.push({ cand, azione: 'salta', motivo: motivoBaseline });
      else if (!giovane) out.push({ cand, azione: 'salta', motivo: 'vecchio' });
      else out.push({ cand, azione: 'nuovo', motivo: '' });
      continue;
    }
    const tent = Number.isInteger(r.tentativi) ? r.tentativi : MAX_TENTATIVI;
    const agg = msDi(r.updated_at);
    if (FINALI.includes(r.stato)) out.push({ cand, azione: 'fermo', motivo: r.stato, reg: r });
    else if (r.stato !== 'prenotato' && r.stato !== 'fallito') out.push({ cand, azione: 'fermo', motivo: 'stato_sconosciuto', reg: r });
    else if (r.stato === 'prenotato' && Number.isFinite(agg) && o.ora - agg < PRENOTATO_SCADUTO_MS) out.push({ cand, azione: 'fermo', motivo: 'in_corso', reg: r });
    else if (tent >= MAX_TENTATIVI) out.push({ cand, azione: 'fermo', motivo: 'tentativi_esauriti', reg: r });
    else if (o.baseline) out.push({ cand, azione: 'fermo', motivo: 'baseline', reg: r });
    else if (!giovane) out.push({ cand, azione: 'fermo', motivo: 'vecchio', reg: r });
    else out.push({ cand, azione: 'ritenta', motivo: '', reg: r });
  }
  // si spedisce dal piu' vecchio: col telefono spento resta l'ultima push di un tema (Topic), cioe' la piu' recente
  return out.sort((a, b) => perIstante(a.cand, b.cand));
}
// esito di inviaPush -> stato della riga. ok = almeno un telefono raggiunto. Nessun telefono iscritto (destinatari 0) o
// tema spento: nessun_iscritto, finale. push_enabled spento nel frattempo, errore di push-api o di rete: fallito, si riprova.
function statoDaEsito(e: EsitoPush): 'inviato' | 'nessun_iscritto' | 'fallito' {
  if (e?.ok === true) return 'inviato';
  const ok2xx = typeof e?.status === 'number' && e.status >= 200 && e.status < 300;
  if (ok2xx && !e.errore && e.dryRun !== true && (e.skipped === 'tema_spento' || (!e.skipped && e.destinatari === 0))) return 'nessun_iscritto';
  return 'fallito';
}
// sulla riga solo conteggi e codici, mai testi
function esitoDaSalvare(e: EsitoPush): Record<string, unknown> {
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return { inviati: n(e?.inviati), falliti: n(e?.falliti), destinatari: n(e?.destinatari), status: n(e?.status),
    ...(typeof e?.skipped === 'string' ? { skipped: e.skipped.slice(0, 40) } : {}), ...(e?.errore ? { errore: true } : {}) };
}
// Come si chiude la riga dopo l'invio. Due casi la chiudono `fallito` SENZA altri tentativi (definitivo: tentativi al
// massimo, e la riga conta fra le push perse della salute per 24 ore), Gate 3 del 18-10:
//  - chi ignorato (RF-7, C6): il messaggio era per una persona ma la risposta di push-api non rimanda lo stesso chi (una
//    push-api v1, che ignora chi, l'ha mandato a TUTTI gli iscritti al tema): ritentare lo rimanderebbe a tutti;
//  - timeout del client (RF-3): inviaPush smette di aspettare a 40 s ma push-api va avanti fino a 100 s e puo' aver
//    consegnato: ritentare puo' far arrivare la stessa push due volte. Meglio una persa e visibile che un doppione.
// Un errore di rete o una risposta di errore di push-api resta un fallito normale, che si riprova.
function chiusura(e: EsitoPush, m: { chi?: string }): { stato: 'inviato' | 'nessun_iscritto' | 'fallito'; definitivo: boolean; esito: Record<string, unknown> } {
  const esito = esitoDaSalvare(e);
  if (typeof m?.chi === 'string' && m.chi && e?.ok === true && e.chi !== m.chi) return { stato: 'fallito', definitivo: true, esito: { ...esito, chi_ignorato: true } };
  if (e?.status == null && typeof e?.errore === 'string' && /^(TimeoutError|AbortError)\b/.test(e.errore)) return { stato: 'fallito', definitivo: true, esito: { ...esito, timeout: true } };
  return { stato: statoDaEsito(e), definitivo: false, esito };
}
// ==== PURE:pe-registro END ====

// ==== PURE:pe-giro BEGIN ====
// Il giro di un evento con le scritture e l'invio passati da fuori (i test lo guidano con dei finti). Ordine: prima i
// `saltato` in blocco (se la scrittura fallisce lancia e non parte niente), poi un invio alla volta: tetto e tempo, la
// prenotazione (nuovo) o la ripresa con confronto su stato e tentativi (ritenta), l'invio, l'esito sulla riga.
type Budget = { invii: number; scade: number };
type Resoconto = { candidati: number; inviati: number; nessun_iscritto: number; falliti: number; esauriti: number; saltati: number; rimandati: number; gia_gestiti: number; presi_da_altri: number; scritture_fallite: number };
type DepGiro = {
  salta: (righe: { chiave: string; motivo: string }[]) => Promise<void>;
  prenota: (chiave: string) => Promise<{ id: number | string } | null>;
  riprendi: (r: Reg) => Promise<boolean>;
  invia: (m: Msg) => Promise<EsitoPush>;
  chiudi: (id: number | string, tentativi: number, stato: string, esito: Record<string, unknown>, definitivo: boolean) => Promise<boolean>;
  adesso: () => number;
};
async function eseguiPiano(piano: Decisione[], msgs: Map<string, Msg>, budget: Budget, d: DepGiro): Promise<Resoconto> {
  const r: Resoconto = { candidati: piano.length, inviati: 0, nessun_iscritto: 0, falliti: 0, esauriti: 0, saltati: 0, rimandati: 0, gia_gestiti: 0, presi_da_altri: 0, scritture_fallite: 0 };
  // un candidato nuovo senza messaggio (la conversazione non e' piu' urgente, il riepilogo e' tutto a zero) si chiude
  // come saltato: non si ricompone a ogni giro
  const salti = piano.filter((p) => p.azione === 'salta' || (p.azione === 'nuovo' && !msgs.has(p.cand.chiave)))
    .map((p) => ({ chiave: p.cand.chiave, motivo: p.azione === 'salta' ? p.motivo : 'niente_da_dire' }));
  if (salti.length) { await d.salta(salti); r.saltati = salti.length; }
  for (const p of piano) {
    if (p.azione === 'fermo' || p.azione === 'salta') {
      if (p.azione === 'fermo') r.gia_gestiti++;
      // una push persa dopo l'ultimo tentativo resta nella finestra dei candidati per 24 ore: ogni giro la riconta (RF-2)
      if (p.azione === 'fermo' && p.motivo === 'tentativi_esauriti') r.esauriti++;
      continue;
    }
    const m = msgs.get(p.cand.chiave);
    if (!m) { if (p.azione === 'ritenta') r.gia_gestiti++; continue; }
    if (budget.invii <= 0 || d.adesso() > budget.scade) { r.rimandati++; continue; }
    let id: number | string;
    let tent: number;
    if (p.azione === 'nuovo') {
      const pr = await d.prenota(p.cand.chiave);
      if (!pr) { r.presi_da_altri++; continue; }
      id = pr.id; tent = 1;
    } else {
      if (!p.reg || !(await d.riprendi(p.reg))) { r.presi_da_altri++; continue; }
      id = p.reg.id; tent = p.reg.tentativi + 1;
    }
    budget.invii--;
    let e: EsitoPush;
    try { e = await d.invia(m); } catch { e = { ok: false, inviati: 0, falliti: 0, destinatari: null, status: null, errore: 'invio non riuscito' }; }
    const c = chiusura(e, m);
    if (c.stato === 'inviato') r.inviati++; else if (c.stato === 'nessun_iscritto') r.nessun_iscritto++; else r.falliti++;
    if (c.definitivo) r.esauriti++;
    if (!(await d.chiudi(id, tent, c.stato, c.esito, c.definitivo))) r.scritture_fallite++;
  }
  return r;
}
// Il giro di un evento A GRUPPI (attivita_team, 21-10): UNA push per gruppo (persona e tipo di operazione) e per giro,
// e ogni riga sorgente coperta una volta sola. Il registro resta quello degli altri eventi, una riga per candidato (per
// attivita_team la riga di change_log, chiave cl:<id>, UNIQUE evento + chiave): pianifica decide riga per riga (nuovo,
// ritenta, salta per baseline o eta', fermo) con le stesse regole, e qui per ogni gruppo:
//  1. si prenotano le righe nuove (prenota: chi non la inserisce non la prende, la ha un altro giro) e si riprendono
//     quelle da ritentare (riprendi: confronto su stato e tentativi);
//  2. il testo si compone SOLO con le righe prese (componi), quindi dice esattamente cosa la push copre;
//  3. un invio, e lo stesso esito su ognuna delle righe prese, ciascuna coi suoi tentativi.
// Cosi' una riga non parte due volte (la prende un giro solo, e una volta inviata e' finale) e non si perde: una riga che
// arriva dopo un giro e' nuova al giro dopo e parte in una push sua; una non presa per tetto o tempo resta senza riga di
// registro e la prende il giro dopo; un invio fallito lascia le sue righe `fallito` e il giro dopo le rimanda insieme
// alle nuove dello stesso gruppo (al massimo 3 tentativi, entro 6 ore, poi push persa e la salute lo dice). Una prenotazione
// interrotta (la edge cade) lascia righe `prenotato` che dopo 15 minuti si riprendono come negli altri eventi.
// Conteggi: inviati, falliti, nessun_iscritto ed esauriti per push; presi_da_altri, rimandati, saltati e
// scritture_fallite per riga.
async function eseguiGruppi(piano: Decisione[], gruppoDi: (c: Cand) => string, componi: (cs: Cand[]) => Msg | null, budget: Budget, d: DepGiro): Promise<Resoconto> {
  const r: Resoconto = { candidati: piano.length, inviati: 0, nessun_iscritto: 0, falliti: 0, esauriti: 0, saltati: 0, rimandati: 0, gia_gestiti: 0, presi_da_altri: 0, scritture_fallite: 0 };
  const gruppi = new Map<string, Decisione[]>();
  const salti: { chiave: string; motivo: string }[] = [];
  for (const p of piano) {
    if (p.azione === 'salta') { salti.push({ chiave: p.cand.chiave, motivo: p.motivo }); continue; }
    if (p.azione === 'fermo') { r.gia_gestiti++; if (p.motivo === 'tentativi_esauriti') r.esauriti++; continue; }
    const g = gruppoDi(p.cand);
    // senza gruppo non c'e' un messaggio: una riga nuova si chiude saltata, una da ritentare resta com'e'
    if (!g) { if (p.azione === 'nuovo') salti.push({ chiave: p.cand.chiave, motivo: 'niente_da_dire' }); else r.gia_gestiti++; continue; }
    const l = gruppi.get(g);
    if (l) l.push(p); else gruppi.set(g, [p]);
  }
  if (salti.length) { await d.salta(salti); r.saltati = salti.length; }
  for (const membri of gruppi.values()) {
    if (budget.invii <= 0 || d.adesso() > budget.scade) { r.rimandati += membri.length; continue; }
    const presi: { cand: Cand; id: number | string; tent: number }[] = [];
    for (const p of membri) {
      if (p.azione === 'nuovo') {
        const pr = await d.prenota(p.cand.chiave);
        if (pr) presi.push({ cand: p.cand, id: pr.id, tent: 1 }); else r.presi_da_altri++;
      } else if (p.reg && (await d.riprendi(p.reg))) presi.push({ cand: p.cand, id: p.reg.id, tent: p.reg.tentativi + 1 });
      else r.presi_da_altri++;
    }
    if (!presi.length) continue;
    const m = componi(presi.map((x) => x.cand));
    if (!m) {
      // nessun testo per righe gia' prese: si chiudono saltate (finale), mai lasciate prenotate
      for (const x of presi) if (!(await d.chiudi(x.id, x.tent, 'saltato', { motivo: 'niente_da_dire' }, false))) r.scritture_fallite++;
      r.saltati += presi.length;
      continue;
    }
    budget.invii--;
    let e: EsitoPush;
    try { e = await d.invia(m); } catch { e = { ok: false, inviati: 0, falliti: 0, destinatari: null, status: null, errore: 'invio non riuscito' }; }
    const c = chiusura(e, m);
    if (c.stato === 'inviato') r.inviati++; else if (c.stato === 'nessun_iscritto') r.nessun_iscritto++; else r.falliti++;
    if (c.definitivo) r.esauriti++;
    for (const x of presi) if (!(await d.chiudi(x.id, x.tent, c.stato, c.esito, c.definitivo))) r.scritture_fallite++;
  }
  return r;
}
// ==== PURE:pe-giro END ====

// ==== PURE:pe-salute BEGIN ====
// La riga health_log del giro (k = 'push_eventi', K1 e RF-2/B6/MIG-B1 del Gate 3, 18-10). health_log si legge da anon:
// nella label solo nomi di eventi (vincolo della 0166: minuscole, cifre, trattino basso), numeri e la causa scritta nel
// codice ('lettura cs_events urgenti'), mai il testo di un errore di PostgREST o di push-api.
// error: un evento fermo in questo giro (lettura o scrittura fallita, evento sconosciuto), un esito non registrato (la riga
//        resta prenotata: possibile doppione fra 15 minuti), o invii falliti senza nessun invio riuscito (push-api giu').
// warn:  invii falliti con altri riusciti, push perse dopo l'ultimo tentativo, pregresso saltato a una ripartenza dopo una
//        pausa, eventi rimandati per tempo, push perse nelle ultime 24 ore secondo il registro (o registro non leggibile).
//        Le ultime due tengono la riga in warn per un giorno anche quando il giro dopo e' pulito: senza, il giro che
//        trasforma un guasto in un `saltato` silenzioso tornava verde.
type EsitoEvento = { inviati?: number; falliti?: number; esauriti?: number; scritture_fallite?: number; nessun_iscritto?: number; persi_stallo?: number; errore?: string; causa?: string; rimandato?: string };
type Salute = { severity: 'ok' | 'warn' | 'error'; label: string; n: number; problema: string };
const SEVERITA = ['ok', 'warn', 'error'];
const FERMO_DA_MS = 30 * 60000;
const SEP_PRIMO = ' | primo problema di oggi: ';
const NOME_EVENTO_RE = /^[a-z][a-z0-9_]{1,47}$/;
function causaSicura(v: unknown): string {
  const s = pulisci(v, 60);
  return /^[a-z0-9 _.,'-]+$/i.test(s) ? s : 'errore imprevisto';
}
function saluteGiro(esiti: Record<string, EsitoEvento>, ultimoGiro: Record<string, unknown>, ora: number, perse24h: number | null, nAttivi: number): Salute {
  const nomi = Object.keys(esiti ?? {}).filter((n) => NOME_EVENTO_RE.test(n));
  const somma = (k: keyof EsitoEvento) => nomi.reduce((s, n) => s + pos(esiti[n]?.[k]), 0);
  const inviati = somma('inviati'), falliti = somma('falliti'), esauriti = somma('esauriti'), scritture = somma('scritture_fallite');
  const senzaIscritti = somma('nessun_iscritto'), stallo = somma('persi_stallo');
  const conErrore = nomi.filter((n) => esiti[n]?.errore);
  // fermo da oltre 30 minuti: l'ultimo giro riuscito (letto all'inizio del run) e' vecchio, o non c'e' mai stato
  const fermi = conErrore.filter((n) => { const u = msDi(ultimoGiro?.[n]); return !Number.isFinite(u) || ora - u > FERMO_DA_MS; });
  const rimandati = nomi.filter((n) => esiti[n]?.rimandato);
  const ripartiti = nomi.filter((n) => pos(esiti[n]?.persi_stallo) > 0);
  const perse = typeof perse24h === 'number' && Number.isFinite(perse24h) ? pos(perse24h) : null;
  const errore = conErrore.length > 0 || scritture > 0 || (falliti > 0 && inviati === 0);
  const avviso = falliti > 0 || esauriti > 0 || stallo > 0 || rimandati.length > 0 || perse === null || perse > 0;
  const problemi = [
    conErrore.length ? `in errore: ${conErrore.map((n) => `${n} (${causaSicura(esiti[n]?.causa)})`).join(', ')}` : '',
    fermi.length ? `fermi da oltre 30 minuti: ${fermi.join(', ')}` : '',
    scritture ? `${plurale(scritture, 'esito non registrato', 'esiti non registrati')} (possibile doppione fra 15 minuti)` : '',
    falliti ? `${plurale(falliti, 'invio fallito', 'invii falliti')}${inviati === 0 ? ', nessuno riuscito' : ''}` : '',
    esauriti && perse === null ? `${plurale(esauriti, 'push persa', 'push perse')} dopo l'ultimo tentativo` : '',
    ripartiti.length ? `ripartiti dopo una pausa di oltre 2 ore: ${ripartiti.map((n) => `${n} (${plurale(pos(esiti[n]?.persi_stallo), 'push non inviata', 'push non inviate')})`).join(', ')}` : '',
    rimandati.length ? `rimandati per tempo: ${rimandati.join(', ')}` : '',
    perse === null ? 'registro delle ultime 24 ore non leggibile' : perse > 0 ? `${plurale(perse, 'push persa', 'push perse')} nelle ultime 24 ore` : '',
  ].filter(Boolean);
  const stato = `${plurale(nAttivi, 'evento acceso', 'eventi accesi')}, ${plurale(inviati, 'push inviata', 'push inviate')}${senzaIscritti ? `, ${senzaIscritti} senza telefoni iscritti` : ''}`;
  return { severity: errore ? 'error' : avviso ? 'warn' : 'ok', label: [stato, ...problemi].join('; '),
    n: conErrore.length + scritture + falliti + stallo + rimandati.length + (perse ?? 0), problema: problemi[0] ?? '' };
}
// Nello stesso giorno UTC la gravita' non scende mai (B6): un guasto delle 08:05 resta in vista anche se il giro delle
// 08:10 e' pulito. La label dice lo stato di adesso e, dopo il separatore, il primo problema del giorno con l'ora UTC
// (quello della riga di prima, se c'era). La riga di oggi la cancella refresh_health_log alle 06:00 UTC: da li' si riparte.
function conPrecedente(s: Salute, prec: { severity?: unknown; label?: unknown } | null, ora: number): { severity: string; label: string; n: number } {
  const rango = (v: unknown) => Math.max(0, SEVERITA.indexOf(String(v)));
  const severity = SEVERITA[Math.max(rango(s.severity), prec ? rango(prec.severity) : 0)];
  const vecchio = prec && typeof prec.label === 'string' && prec.label.includes(SEP_PRIMO) ? pulisci(prec.label.split(SEP_PRIMO)[1], 200) : '';
  const primo = vecchio || (s.severity !== 'ok' && s.problema ? pulisci(`${new Date(ora).toISOString().slice(11, 16)} UTC ${s.problema}`, 200) : '');
  const adesso = severity !== 'ok' && s.severity === 'ok' ? `adesso a posto; ${s.label}` : s.label;
  const coda = primo ? SEP_PRIMO + primo : '';
  return { severity, label: adesso.slice(0, Math.max(0, 500 - coda.length)) + coda, n: s.n };
}
// ==== PURE:pe-salute END ====

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
async function sha256hex(s: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
// PostgREST risponde 504 anche su letture banali (CONOSCENZA 13-09): una lettura ritenta UNA volta dopo 1,5 s, le
// scritture mai (Regola 20d)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const retryOnce = async <T extends { error: unknown }>(fn: () => PromiseLike<T>): Promise<T> => {
  const r = await fn(); if (!r.error) return r; await sleep(1500); return await fn();
};
const errTesto = (e: unknown) => String((e as { message?: unknown })?.message ?? e).replace(/[\u0000-\u001f\u007f]+/g, ' ').slice(0, 200);
// lettura fallita anche dopo il ritentativo: l'evento si ferma (nessuna scrittura, nessun invio) e l'errore va in risposta
// e nel log; mai un default vuoto al suo posto (Regola 20a). `cosa` e' testo del codice: e' l'unica parte che arriva nella
// label di health_log (causaDi), il dettaglio di PostgREST resta nella risposta e nel log.
class LetturaFallita extends Error {
  cosa: string;
  constructor(cosa: string, dettaglio: unknown) { super(cosa + ': ' + errTesto(dettaglio)); this.cosa = cosa; }
}
class ScritturaFallita extends Error {
  cosa: string;
  constructor(cosa: string, dettaglio: unknown) { super(cosa + ': ' + errTesto(dettaglio)); this.cosa = cosa; }
}
const causaDi = (e: unknown) => e instanceof LetturaFallita ? 'lettura ' + e.cosa : e instanceof ScritturaFallita ? 'scrittura ' + e.cosa : 'errore imprevisto';

// client senza tipi dello schema (come le altre edge): ReturnType<typeof createClient> fa diventare never le righe da scrivere
type Sb = SupabaseClient;
type RigaEvento = { evento: string; tema: unknown; attivo: unknown; soglie: unknown; baseline_at: unknown; ultimo_giro_at: unknown };
type Ctx = { ora: number; flags: Record<string, string>; finestra: { aperta: boolean; data: string; ts: number } };
// gruppi (attivita_team, 21-10): l'evento manda una push per gruppo di candidati (eseguiGruppi). dettagli legge PRIMA di
// ogni prenotazione quello che serve ai testi, messaggio compone il testo delle sole righe prese
type Gruppi = { dettagli: (sb: Sb, ctx: Ctx, ev: RigaEvento, cands: Cand[]) => Promise<Record<string, Riga[]>>; gruppoDi: (c: Cand) => string; messaggio: (cs: Cand[], d: Record<string, Riga[]>) => Msg | null };
type DefEvento = { candidati: (sb: Sb, ctx: Ctx, ev: RigaEvento) => Promise<Cand[]>; componi: (sb: Sb, ctx: Ctx, ev: RigaEvento, cands: Cand[]) => Promise<Msg[]>; gruppi?: Gruppi };

// finestra dei candidati: 24 ore sull'istante in cui la riga e' nata o cambiata. Quelli con l'evento oltre le 6 ore
// entrano lo stesso e si segnano `saltato` (vecchio): restano nel registro come traccia.
const FINESTRA_MS = 24 * 3600000;
const LIMITE = 50;
// nessun invio NUOVO dopo 15 s dall'inizio del giro, e nessun evento cominciato dopo 30 s (RF-5, Gate 3 del 18-10): con i
// 40 s al massimo di inviaPush e le letture dell'ultimo evento il giro resta sotto i 60 s del timeout del cron (migr
// 0166). Di solito un invio prende meno di un secondo; quelli rimasti, e gli eventi rimandati, partono al giro dopo.
const SCADENZA_INVII_MS = 15000;
const TEMPO_EVENTI_MS = 30000;
// cs-sync riscrive la sua riga di health_log con un delete e poi un insert (due chiamate, 45-985 ms fra le due, misurato
// il 18-10): una lettura che cade in mezzo vede l'ultima riga di IERI e sembra uno stallo di ore (RF-1). Se la prima
// lettura dice "ferma" si rilegge dopo 3 s e decide la seconda: uno stallo vero resta, il buco no. Limite noto: un insert
// di cs-sync fallito dopo il delete lascia il buco fino al suo giro dopo (2 minuti) e la rilettura non basta; la
// correzione vera e' un upsert in cs-sync, edge viva fuori da questo lotto (Regola 19).
const RILETTURA_CS_SYNC_MS = 3000;
const dalle = (ctx: Ctx, ms: number) => new Date(ctx.ora - ms).toISOString();

async function conta(q: PromiseLike<{ count: number | null; error: unknown }>, cosa: string): Promise<number> {
  const { count, error } = await q;
  if (error || count == null) throw new LetturaFallita(cosa, error ?? 'conteggio assente');
  return count;
}
// conversazioni dell'Assistenza: SOLO stato (e chi l'ha messo), canale, categoria, urgenza e, dal 19-10 (decisione di Dan),
// nome ed email della cliente per il titolo (nomeCliente); mai oggetto, snippet o riassunto. stato_by e' il nome di chi
// del team ha chiuso: serve a msgCsUrgente, non entra nel testo.
async function leggiConversazioni(sb: Sb, ids: string[]): Promise<Record<string, Riga>> {
  const out: Record<string, Riga> = {};
  if (!ids.length) return out;
  const { data, error } = await retryOnce(() => sb.from('cs_conversations').select('id, canale, categoria, urgente, urgenza_motivo, stato, stato_by, customer_name, customer_email').in('id', ids).limit(ids.length + 1));
  if (error) throw new LetturaFallita('cs_conversations', error);
  for (const r of (data ?? []) as Riga[]) out[String(r.id).toLowerCase()] = r;
  return out;
}

// attivita_team: le righe degli ordini (supplier_orders, core, sola lettura) per i codici nel testo. Solo gruppo, codice,
// quantita' e wip, con .in() sui soli gruppi dei candidati, a blocchi di 50 (Regola 20b); oltre il limite la lettura e'
// troncata e l'evento si ferma (massimo misurato il 21-10: 8 righe per ordine).
const RIGHE_ORDINE_MAX = 500;
async function leggiRigheOrdini(sb: Sb, cands: Cand[]): Promise<Record<string, Riga[]>> {
  const out: Record<string, Riga[]> = {};
  const gruppi = [...new Set(cands.filter((c) => c.rif.op === 'order_multi' && UUID_RE.test(c.rif.ordine ?? '')).map((c) => c.rif.ordine))];
  for (let i = 0; i < gruppi.length; i += 50) {
    const blocco = gruppi.slice(i, i + 50);
    const { data, error } = await retryOnce(() => sb.from('supplier_orders').select('gruppo, codice, qty_ordered, wip').in('gruppo', blocco).limit(RIGHE_ORDINE_MAX + 1));
    if (error || (data ?? []).length > RIGHE_ORDINE_MAX) throw new LetturaFallita('righe degli ordini', error ?? `oltre ${RIGHE_ORDINE_MAX} righe`);
    for (const r of (data ?? []) as Riga[]) { const k = String(r.gruppo).toLowerCase(); (out[k] ??= []).push(r); }
  }
  return out;
}
// change_log delle attivita': nel massimo misurato (120 giorni fino al 21-10) 15 righe in 24 ore e 9 in 5 minuti. Una
// lettura piena fino al limite e' troncata (righe piu' vecchie non viste): l'evento si ferma con un errore visibile
// invece di saltarle in silenzio (Regola 20b).
const LIMITE_ATTIVITA = 200;

// Chat del sito (v7, 08-11): le chat che aspettano il team, lette per i due solleciti (una lettura per evento, la stessa).
// Nome ed email della cliente SOLO qui e solo per nomeCliente (D-9). Finestra di 30 giorni sul passaggio (il secondo passo,
// al massimo 240 ore lavorative, cade prima salvo chiusure lunghe); 500 righe al massimo: oltre, la lettura e' troncata e
// l'evento si ferma con un errore visibile (Regola 20b; con 50 chat nuove al giorno, D-12, succede solo dopo 10 giorni di
// chat mai chiuse, e allora lo dicono anche limite e quota di chat_salute).
const FINESTRA_CHAT_MS = 30 * 86400000;
const LIMITE_CHAT = 500;
async function leggiChatInAttesa(sb: Sb, ctx: Ctx): Promise<Riga[]> {
  const { data, error } = await retryOnce(() => sb.from('chat_sessioni').select('id, stato, passaggi, passaggio_at, ultima_risposta_staff_at, preso_da, prova, customer_name, customer_email').in('stato', ['attesa_persona', 'aperta']).gte('passaggio_at', dalle(ctx, FINESTRA_CHAT_MS)).order('passaggio_at', { ascending: true }).limit(LIMITE_CHAT + 1));
  if (error || (data ?? []).length > LIMITE_CHAT) throw new LetturaFallita('chat in attesa', error ?? `oltre ${LIMITE_CHAT} righe`);
  return (data ?? []) as Riga[];
}
// le prenotazioni delle push di passaggio (chat_eventi) delle sole chiavi da guardare, a blocchi di 100 (Regola 20b)
async function leggiPassaggi(sb: Sb, chiavi: string[]): Promise<Riga[]> {
  const out: Riga[] = [];
  for (let i = 0; i < chiavi.length; i += 100) {
    const blocco = chiavi.slice(i, i + 100);
    const { data, error } = await retryOnce(() => sb.from('chat_eventi').select('chiave, esito, at, status:dettaglio->>status').eq('tipo', 'push_passaggio').in('chiave', blocco).limit(blocco.length + 1));
    if (error) throw new LetturaFallita('push di passaggio', error);
    out.push(...((data ?? []) as Riga[]));
  }
  return out;
}
// chat_salute: risposte dello staff ancora senza email da oltre 10 minuti (il giro di chat-send le manda dopo 2) e
// prenotazioni ferme da oltre 20 (chat-send le chiude a 15 come esito ignoto: oltre, chat-send non gira)
const CODA_EMAIL_MS = 10 * 60000;
const PRENOTATA_FERMA_MS = 20 * 60000;
const LIMITE_SALUTE_CHAT = 200;
const CONTATORI_SALUTE = ['glob:sev_error', 'glob:richieste', 'glob:errore'];

const EVENTI: Record<string, DefEvento> = {
  sistema_cs_sync_fermo: {
    candidati: async (sb, ctx, ev) => {
      const minuti = soglia(ev.soglie, 'minuti_fermo', 15, 5, 1440);
      // severity e istante, mai la label: con uno stallo contiene l'errore grezzo, che puo' citare oggetto o mittente
      const leggi = async (): Promise<Riga | null> => {
        const { data, error } = await retryOnce(() => sb.from('health_log').select('severity, created_at').eq('k', 'cs_sync').order('created_at', { ascending: false }).limit(1));
        if (error) throw new LetturaFallita('health_log cs_sync', error);
        return ((data ?? []) as Riga[])[0] ?? null;
      };
      let riga = await leggi();
      if (candCsSync(riga, ctx.ora, minuti).some((c) => c.rif.tipo === 'fermo')) {
        await sleep(RILETTURA_CS_SYNC_MS);
        riga = await leggi();
      }
      return candCsSync(riga, ctx.ora, minuti);
    },
    componi: async (_sb, _ctx, _ev, cands) => msgCsSync(cands),
  },
  cs_urgente: {
    candidati: async (sb, ctx) => {
      const { data, error } = await retryOnce(() => sb.from('cs_events').select('id, conversation_id, azione, at, urgente:dettaglio->>urgente').in('azione', ['classify', 'urgenza_ricalcolo']).eq('dettaglio->>urgente', 'true').gte('at', dalle(ctx, FINESTRA_MS)).order('at', { ascending: false }).limit(LIMITE));
      if (error) throw new LetturaFallita('cs_events urgenti', error);
      return candCsUrgente((data ?? []) as Riga[]);
    },
    componi: async (sb, _ctx, _ev, cands) => {
      const conv = await leggiConversazioni(sb, [...new Set(cands.map((c) => c.rif.conv))]);
      const aperte = await conta(retryOnce(() => sb.from('cs_conversations').select('id', { count: 'exact', head: true }).eq('urgente', true).neq('canale', 'rumore').not('flags', 'cs', '["prova"]').neq('stato', 'fatto')), 'urgenti aperte');
      return msgCsUrgente(cands, conv, aperte);
    },
  },
  spedizione_eccezione: {
    candidati: async (sb, ctx) => {
      // customer_name per il titolo (decisione di Dan del 19-10; la vista non ha l'email); le altre colonne della vista no
      const { data, error } = await retryOnce(() => sb.from('v_spedizioni_eccezioni').select('ldv, order_name, stato_tws, updated_at, classe, customer_name').eq('classe', 'eccezione').gte('updated_at', dalle(ctx, FINESTRA_MS)).order('updated_at', { ascending: false }).limit(LIMITE));
      if (error) throw new LetturaFallita('v_spedizioni_eccezioni', error);
      return candSpedizione((data ?? []) as Riga[]);
    },
    componi: async (sb, ctx, _ev, cands) => {
      // 21-10: le righe della settimana (solo LDV, stato e classe) e non un conteggio della classe, per contare i soli
      // problemi veri (contaProblemi); un elenco pieno fino al limite e' troncato e ferma l'evento (Regola 20b)
      const { data, error } = await retryOnce(() => sb.from('v_spedizioni_eccezioni').select('ldv, stato_tws, classe').eq('classe', 'eccezione').gte('updated_at', dalle(ctx, 7 * 86400000)).limit(501));
      if (error || (data ?? []).length > 500) throw new LetturaFallita('eccezioni della settimana', error ?? 'oltre 500 righe');
      return msgSpedizione(cands, contaProblemi((data ?? []) as Riga[]));
    },
  },
  b2b_risposta_negozio: {
    candidati: async (sb, ctx) => {
      // mai body_clean ne' subject: il testo della risposta e il referente restano nell'app. Solo i tocchi del giro
      // automatico (chi 'auto') anche nella lettura: un'importazione a mano di 50 messaggi non spinge fuori dal limite una
      // risposta vera dello stesso giorno (B1, Gate 3 del 18-10)
      const { data, error } = await retryOnce(() => sb.from('lead_touches').select('id, account_id, direzione, esito, chi, at, created_at').eq('direzione', 'in').eq('chi', 'auto').or('esito.is.null,esito.eq.opt_out_da_verificare').gte('created_at', dalle(ctx, FINESTRA_MS)).order('created_at', { ascending: false }).limit(LIMITE));
      if (error) throw new LetturaFallita('lead_touches', error);
      return candB2b((data ?? []) as Riga[]);
    },
    componi: async (sb, _ctx, _ev, cands) => {
      const ids = [...new Set(cands.map((c) => c.rif.negozio).filter((x) => UUID_RE.test(x)))];
      const nomi: Record<string, unknown> = {};
      if (ids.length) {
        const { data, error } = await retryOnce(() => sb.from('lead_accounts').select('id, nome').in('id', ids).limit(ids.length + 1));
        if (error) throw new LetturaFallita('lead_accounts', error);
        for (const r of (data ?? []) as Riga[]) nomi[String(r.id).toLowerCase()] = r.nome;
      }
      const daGestire = await conta(retryOnce(() => sb.from('v_lead_outreach').select('id', { count: 'exact', head: true }).eq('da_gestire', true)), 'risposte da gestire');
      return msgB2b(cands, nomi, daGestire);
    },
  },
  cs_cliente_ha_riscritto: {
    candidati: async (sb, ctx) => {
      const { data, error } = await retryOnce(() => sb.from('cs_events').select('conversation_id, at, a:dettaglio->>a').eq('azione', 'stato_auto').eq('dettaglio->>a', 'da_fare').gte('at', dalle(ctx, FINESTRA_MS)).order('at', { ascending: false }).limit(LIMITE));
      if (error) throw new LetturaFallita('cs_events riaperture', error);
      return candCsRiscritto((data ?? []) as Riga[]);
    },
    componi: async (sb, _ctx, _ev, cands) => {
      const conv = await leggiConversazioni(sb, [...new Set(cands.map((c) => c.rif.conv))]);
      const inAttesa = await conta(retryOnce(() => sb.from('cs_conversations').select('id', { count: 'exact', head: true }).eq('stato', 'da_fare').eq('last_direction', 'in').neq('canale', 'rumore').not('flags', 'cs', '["prova"]')), 'richieste in attesa');
      return msgCsRiscritto(cands, conv, inAttesa);
    },
  },
  attivita_team: {
    candidati: async (sb, ctx) => {
      // solo id, istante, azione, chi e i campi di `after` che finiscono nel testo (mai ctx, purchase_id o costo); le
      // azioni e le persone filtrate gia' nella lettura, cosi' le righe di Ale e dei giri automatici non occupano il limite
      const { data, error } = await retryOnce(() => sb.from('change_log').select('id, ts, op, chi, codice:after->>codice, delta:after->>delta, contati:after->>contati, giac_prima:after->>giac_prima, fornitore:after->>fornitore, righe:after->>righe, gruppo:after->>gruppo').in('op', OP_ATTIVITA).in('chi', Object.keys(PERSONA_TEAM)).gte('ts', dalle(ctx, FINESTRA_MS)).order('id', { ascending: false }).limit(LIMITE_ATTIVITA + 1));
      if (error || (data ?? []).length > LIMITE_ATTIVITA) throw new LetturaFallita('change_log attivita', error ?? `oltre ${LIMITE_ATTIVITA} righe`);
      return candAttivita((data ?? []) as Riga[]);
    },
    // anteprima: i gruppi di tutti i candidati passati
    componi: async (sb, _ctx, _ev, cands) => msgAttivita(cands, await leggiRigheOrdini(sb, cands)),
    gruppi: { dettagli: (sb, _ctx, _ev, cands) => leggiRigheOrdini(sb, cands), gruppoDi: (c) => c.rif.gruppo ?? '', messaggio: (cs, d) => msgGruppoAttivita(cs, d) },
  },
  premia_da_approvare: {
    candidati: async (sb, ctx) => {
      // solo id, tipo, codice, stato e istante: mai titolo, testo, firma, foto o cliente
      const { data, error } = await retryOnce(() => sb.from('loyalty_ugc').select('id, kind, codice, status, created_at').eq('status', 'in_revisione').gte('created_at', dalle(ctx, FINESTRA_MS)).order('created_at', { ascending: false }).limit(LIMITE + 1));
      // Gate 2 del 03-11: una lettura piena oltre il limite e' troncata e ferma l'evento (Regola 20b), mai un contenuto perso
      if (error || (data ?? []).length > LIMITE) throw new LetturaFallita('loyalty_ugc', error ?? `oltre ${LIMITE} righe`);
      return candPremia((data ?? []) as Riga[]);
    },
    componi: async (sb, _ctx, _ev, cands) => {
      const inRevisione = await conta(retryOnce(() => sb.from('loyalty_ugc').select('id', { count: 'exact', head: true }).eq('status', 'in_revisione')), 'contenuti da approvare');
      return msgPremia(cands, inRevisione);
    },
  },
  premia_salute: {
    candidati: async (sb, ctx, ev) => {
      const minuti = soglia(ev.soglie, 'minuti_pending', 15, 5, 1440);
      // loyalty_pool_min come loyalty_health_check (0137): un valore illeggibile vale 20
      const poolMin = Number.isInteger(Number(ctx.flags.loyalty_pool_min)) && Number(ctx.flags.loyalty_pool_min) >= 0 ? Number(ctx.flags.loyalty_pool_min) : 20;
      // severity e istante, mai la label; i riscatti pending degli ultimi 7 giorni senza codice ne' cliente
      const { data: ord, error: oErr } = await retryOnce(() => sb.from('health_log').select('severity, created_at').eq('k', 'loyalty_orders').gte('created_at', dalle(ctx, FINESTRA_MS)).order('created_at', { ascending: false }).limit(1));
      if (oErr) throw new LetturaFallita('health_log loyalty_orders', oErr);
      const { data: pend, error: pErr } = await retryOnce(() => sb.from('loyalty_redemptions').select('id, status, created_at').eq('status', 'pending').gte('created_at', dalle(ctx, 7 * 86400000)).lt('created_at', dalle(ctx, minuti * 60000)).order('created_at', { ascending: true }).limit(LIMITE + 1));
      if (pErr || (pend ?? []).length > LIMITE) throw new LetturaFallita('riscatti in attesa', pErr ?? `oltre ${LIMITE} righe`);
      const { data: pool, error: qErr } = await retryOnce(() => sb.from('v_loyalty_pool').select('reward, label, active, codici_liberi').eq('active', true).limit(LIMITE + 1));
      if (qErr || (pool ?? []).length > LIMITE) throw new LetturaFallita('v_loyalty_pool', qErr ?? `oltre ${LIMITE} righe`);
      return candPremiaSalute({ orders: ((ord ?? []) as Riga[])[0] ?? null, pending: (pend ?? []) as Riga[], pool: (pool ?? []) as Riga[], poolMin, ora: ctx.ora, minuti });
    },
    componi: async (_sb, _ctx, _ev, cands) => msgPremiaSalute(cands),
  },
  sistema_senza_iscritti: {
    candidati: async (sb, ctx, ev) => {
      const oraDa = soglia(ev.soglie, 'ora_da', 9, 0, 23);
      // prima di oraDa candSenzaIscritti non darebbe niente: qui si evitano anche le letture dei giri di notte
      if (partiRoma(ctx.ora).h < oraDa) return [];
      // gli eventi accesi (evento e tema) e i loro temi in push_temi (chiave, etichetta, attivo); dei telefoni SOLO il
      // conteggio per tema, mai endpoint, chiavi, persone o etichette; del registro solo il nome dell'evento
      const { data: evs, error: eErr } = await retryOnce(() => sb.from('push_eventi').select('evento, tema, attivo').eq('attivo', true).limit(LIMITE + 1));
      if (eErr || (evs ?? []).length > LIMITE) throw new LetturaFallita('eventi accesi', eErr ?? `oltre ${LIMITE} righe`);
      const eventi = (evs ?? []) as Riga[];
      const temi = [...new Set(eventi.map((e) => (typeof e.evento === 'string' ? temaDi(e.tema, e.evento) : '')).filter(Boolean))];
      if (!temi.length) return [];
      const { data: tr, error: tErr } = await retryOnce(() => sb.from('push_temi').select('key, etichetta, attivo').in('key', temi).limit(temi.length + 1));
      if (tErr) throw new LetturaFallita('push_temi', tErr);
      const conti = await Promise.all(temi.map((t) =>
        conta(retryOnce(() => sb.from('push_subscriptions').select('id', { count: 'exact', head: true }).contains('temi', [t])), 'telefoni del tema')));
      const iscritti = Object.fromEntries(temi.map((t, i) => [t, conti[i]]));
      // registro: righe nessun_iscritto delle 24 ore (al 06-11 erano 21 in tutto); una lettura piena oltre il limite e'
      // troncata e ferma l'evento (Regola 20b)
      const { data: pr, error: pErr } = await retryOnce(() => sb.from('push_eventi_inviati').select('evento').eq('stato', 'nessun_iscritto').gte('updated_at', dalle(ctx, FINESTRA_MS)).limit(501));
      if (pErr || (pr ?? []).length > 500) throw new LetturaFallita('push senza destinatari', pErr ?? 'oltre 500 righe');
      return candSenzaIscritti({ eventi, temi: (tr ?? []) as Riga[], iscritti, perse: (pr ?? []) as Riga[], ora: ctx.ora, oraDa });
    },
    componi: async (_sb, _ctx, _ev, cands) => msgSenzaIscritti(cands),
  },
  stock_fermo: {
    candidati: async (sb, ctx, ev) => {
      const oraDa = soglia(ev.soglie, 'ora_da', 9, 0, 23);
      // prima di oraDa e di domenica candStockFermo non darebbe niente: qui si evita anche la lettura
      const pr = partiRoma(ctx.ora);
      if (pr.wd === 'Sun' || pr.h < oraDa) return [];
      // la vista fa tutto il calcolo (migr 0190); solo codice, nomi del prodotto, pezzi, data e stato della pagina, mai
      // prezzo o valore. Una lettura piena oltre il limite e' troncata e ferma l'evento (Regola 20b), mai un prodotto perso
      const { data, error } = await retryOnce(() => sb.from('v_stock_fermo').select('codice, item, variant, pezzi, fermo_dal, giorni, stato_shopify').order('pezzi', { ascending: false }).limit(LIMITE_FERMI + 1));
      if (error || (data ?? []).length > LIMITE_FERMI) throw new LetturaFallita('v_stock_fermo', error ?? `oltre ${LIMITE_FERMI} righe`);
      return candStockFermo((data ?? []) as Riga[], ctx.ora, oraDa);
    },
    // anteprima: la push di tutti i candidati passati
    componi: async (_sb, _ctx, _ev, cands) => { const m = msgGruppoStockFermo(cands); return m ? [m] : []; },
    gruppi: { dettagli: async () => ({}), gruppoDi: () => 'stock_fermo', messaggio: (cs) => msgGruppoStockFermo(cs) },
  },
  chat_sollecito: {
    candidati: async (sb, ctx) => {
      const orari = orariChat(ctx.flags.chat_orari);
      const sessioni = await leggiChatInAttesa(sb, ctx);
      const eventi = await leggiPassaggi(sb, chiaviPassaggio(sessioni));
      return ordinaRecenti([...candChatPassaggio({ sessioni, eventi, orari, ora: ctx.ora }),
        ...candChatSollecito({ sessioni, ore: oreSollecito(ctx.flags.chat_sollecito_ore), orari, ora: ctx.ora, passo: 1 })]);
    },
    componi: async (_sb, _ctx, _ev, cands) => msgChatSollecito(cands),
  },
  chat_sollecito_scala: {
    candidati: async (sb, ctx) => {
      const orari = orariChat(ctx.flags.chat_orari);
      // fuori orario nessun candidato (candChatSollecito): qui si evita anche la lettura dei giri di notte
      if (!inOrarioChat(ctx.ora, orari)) return [];
      return candChatSollecito({ sessioni: await leggiChatInAttesa(sb, ctx), ore: oreSollecito(ctx.flags.chat_sollecito_ore), orari, ora: ctx.ora, passo: 2 });
    },
    componi: async (_sb, _ctx, _ev, cands) => msgChatSollecito(cands),
  },
  chat_salute: {
    candidati: async (sb, ctx, ev) => {
      const t24 = dalle(ctx, FINESTRA_MS);
      // delle push di passaggio solo chiave, esito, istante e lo status della risposta di push-api (B2); dei messaggi dello
      // staff solo id, sessione, istante e la causa dell'errore (testo fisso di chat-send, senza @): mai testi, email o nomi
      const { data: pas, error: aErr } = await retryOnce(() => sb.from('chat_eventi').select('chiave, esito, at, status:dettaglio->>status').eq('tipo', 'push_passaggio').in('esito', ['nessun_iscritto', 'fallito', 'prenotato']).gte('at', t24).order('at', { ascending: false }).limit(LIMITE_SALUTE_CHAT + 1));
      if (aErr || (pas ?? []).length > LIMITE_SALUTE_CHAT) throw new LetturaFallita('push di passaggio non arrivate', aErr ?? `oltre ${LIMITE_SALUTE_CHAT} righe`);
      const { data: em, error: mErr } = await retryOnce(() => sb.from('chat_messaggi').select('id, sessione_id, email_errore, email_at').eq('autore', 'staff').eq('email_stato', 'errore').gte('email_at', t24).order('email_at', { ascending: false }).limit(LIMITE_SALUTE_CHAT + 1));
      if (mErr || (em ?? []).length > LIMITE_SALUTE_CHAT) throw new LetturaFallita('email non partite', mErr ?? `oltre ${LIMITE_SALUTE_CHAT} righe`);
      // il flag prova delle chat dei guasti (B1: dal dettaglio di chat_eventi si perde quando chat-api scrive l'esito)
      const ids = [...new Set([...sessioniDaChiavi((pas ?? []) as Riga[]), ...((em ?? []) as Riga[]).map((r) => String(r.sessione_id ?? '').toLowerCase())].filter((x) => UUID_RE.test(x)))];
      const prova: Record<string, boolean> = {};
      if (ids.length) {
        const { data: ss, error: sErr } = await retryOnce(() => sb.from('chat_sessioni').select('id, prova').in('id', ids).limit(ids.length + 1));
        if (sErr) throw new LetturaFallita('chat dei guasti', sErr);
        for (const r of (ss ?? []) as Riga[]) prova[String(r.id).toLowerCase()] = r.prova === true;
      }
      const [coda, ferme] = await Promise.all([
        conta(retryOnce(() => sb.from('chat_messaggi').select('id', { count: 'exact', head: true }).eq('autore', 'staff').is('email_stato', null).lt('created_at', dalle(ctx, CODA_EMAIL_MS))), 'email in coda'),
        conta(retryOnce(() => sb.from('chat_messaggi').select('id', { count: 'exact', head: true }).eq('autore', 'staff').eq('email_stato', 'prenotata').lt('email_at', dalle(ctx, PRENOTATA_FERMA_MS))), 'email prenotate ferme'),
      ]);
      const oggi = giornoUtc(ctx.ora), ieri = giornoUtc(ctx.ora - 86400000);
      const { data: cont, error: cErr } = await retryOnce(() => sb.from('chat_contatori').select('chiave, finestra, n').in('chiave', CONTATORI_SALUTE).in('finestra', [`${ieri}T00:00:00Z`, `${oggi}T00:00:00Z`]).limit(CONTATORI_SALUTE.length * 2 + 1));
      if (cErr) throw new LetturaFallita('contatori della chat', cErr);
      const { data: lim, error: lErr } = await retryOnce(() => sb.from('chat_eventi').select('chiave').in('chiave', [`limite:${ieri}`, `limite:${oggi}`]).limit(3));
      if (lErr) throw new LetturaFallita('tetto delle chat', lErr);
      return candChatSalute({ passaggi: (pas ?? []) as Riga[], email: (em ?? []) as Riga[], prova, coda: coda + ferme, contatori: (cont ?? []) as Riga[], limiti: (lim ?? []) as Riga[],
        ora: ctx.ora, sogliaRichieste: soglia(ev.soglie, 'richieste_giorno', 5000, 100, 1000000), sogliaWidget: soglia(ev.soglie, 'errori_widget', 20, 1, 100) });
    },
    componi: async (_sb, _ctx, _ev, cands) => msgChatSalute(cands),
  },
  riepilogo: {
    candidati: async (_sb, ctx) => candRiepilogo(ctx.finestra),
    componi: async (sb, ctx, ev, cands) => {
      const giorni = soglia(ev.soglie, 'giorni_spedire', 4, 1, 20);
      const oreAffido = soglia(ev.soglie, 'ore_affido', 48, 12, 720);
      // B5 (Gate 3 del 18-10): l'affido guarda le sole etichette degli ultimi 30 giorni, come "da spedire". Le dieci righe
      // di luglio-settembre ferme su IN ATTESA DI AFFIDO sono uscite dal feed TWS (ultime 250 spedizioni) e non cambieranno
      // piu': senza limite inferiore il riepilogo di Ginni le ripeteva ogni sera.
      const giorniAffido = soglia(ev.soglie, 'giorni_affido_max', 30, 1, 365);
      const t0 = new Date(mezzanotteRoma(ctx.ora)).toISOString();
      const oggi = dataRoma(ctx.ora);
      const ieri = dalle(ctx, 24 * 3600000);
      // un elenco pieno fino al limite e' troncato: meglio nessun riepilogo che un numero falso (Regola 20b)
      const { data: ord, error: oErr } = await retryOnce(() => sb.from('shopify_orders').select('gross_total').gte('created_at_shop', t0).limit(501));
      if (oErr || (ord ?? []).length > 500) throw new LetturaFallita('ordini del giorno', oErr ?? 'oltre 500 righe');
      const { data: cassa, error: cErr } = await retryOnce(() => sb.from('qromo_sales').select('order_id, prezzo').eq('data', oggi).limit(1001));
      if (cErr || (cassa ?? []).length > 1000) throw new LetturaFallita('cassa del giorno', cErr ?? 'oltre 1000 righe');
      // C5 (18-10): shopify-sync scrive fulfilled_at solo nei mesi aperti, fulfillment_status sempre: un ordine evaso dopo
      // la chiusura del mese ha fulfilled_at vuoto e 'fulfilled', e non e' da spedire
      const { data: ritardo, error: rErr } = await retryOnce(() => sb.from('shopify_orders').select('order_number, created_at_shop').is('fulfilled_at', null).or('fulfillment_status.is.null,fulfillment_status.neq.fulfilled').eq('financial_status', 'paid').gte('created_at_shop', dalle(ctx, 30 * 86400000)).lt('created_at_shop', dalle(ctx, giorni * 86400000)).order('created_at_shop', { ascending: true }).limit(201));
      if (rErr || (ritardo ?? []).length > 200) throw new LetturaFallita('ordini da spedire', rErr ?? 'oltre 200 righe');
      // B3 (18-10): le righe degli arrivi del giorno, contate al netto per riga d'ordine (contaArrivi), non un conteggio
      const { data: arr, error: aErr } = await retryOnce(() => sb.from('change_log').select('row_id, delta:after->>delta, qty:after->>qty').in('op', ['arrival', 'arrival_set']).gte('ts', t0).limit(501));
      if (aErr || (arr ?? []).length > 500) throw new LetturaFallita('arrivi del giorno', aErr ?? 'oltre 500 righe');
      // i messaggi da collegare si vedono in Coda solo con lead_outreach_ai_enabled acceso (come il badge del web)
      const collegare = flagVero(ctx.flags.lead_outreach_ai_enabled);
      // B4 (18-10): "Azioni scadute" e "Follow-up pronti da rivedere" con le definizioni della Coda di Negozi B2B
      // (Outreach.tsx). Prima si contavano le lead_drafts in 'proposta', che non scadono mai: 4 nel riepilogo, 0 nell'app.
      const [ordiniFornitore, premia, csFerme, b2bScadute, daCompletare, daPulire, daCollegare, followUpPronti, affido, csNuove] = await Promise.all([
        conta(retryOnce(() => sb.from('change_log').select('id', { count: 'exact', head: true }).in('op', ['order', 'order_multi']).gte('ts', t0)), 'ordini fornitore'),
        conta(retryOnce(() => sb.from('loyalty_ugc').select('id', { count: 'exact', head: true }).eq('status', 'in_revisione')), 'Premia'),
        conta(retryOnce(() => sb.from('cs_conversations').select('id', { count: 'exact', head: true }).eq('stato', 'da_fare').eq('last_direction', 'in').lt('last_msg_at', ieri).neq('canale', 'rumore').not('flags', 'cs', '["prova"]')), 'richieste ferme'),
        conta(retryOnce(() => sb.from('v_lead_outreach').select('id', { count: 'exact', head: true }).eq('scaduta', true).eq('da_gestire', false).is('bozza_auto_tocco', null)), 'azioni B2B scadute'),
        conta(retryOnce(() => sb.from('v_products_todo').select('codice', { count: 'exact', head: true }).in('bucket', ['nuovo', 'costo_ricavo'])), 'prodotti da completare'),
        conta(retryOnce(() => sb.from('v_products_todo').select('codice', { count: 'exact', head: true }).eq('bucket', 'pulizia')), 'prodotti da pulire'),
        collegare ? conta(retryOnce(() => sb.from('v_lead_inbound').select('conv_id', { count: 'exact', head: true })), 'messaggi da collegare') : Promise.resolve(0),
        conta(retryOnce(() => sb.from('v_lead_outreach').select('id', { count: 'exact', head: true }).not('bozza_auto_tocco', 'is', null).eq('da_gestire', false)), 'follow-up pronti'),
        conta(retryOnce(() => sb.from('shipping_status').select('ldv', { count: 'exact', head: true }).eq('stato_tws', 'IN ATTESA DI AFFIDO').lt('updated_at', dalle(ctx, oreAffido * 3600000)).gte('shipped_date', dataRoma(ctx.ora - giorniAffido * 86400000))), 'in attesa di affido'),
        conta(retryOnce(() => sb.from('cs_conversations').select('id', { count: 'exact', head: true }).gte('created_at', t0).neq('canale', 'rumore').not('flags', 'cs', '["prova"]').or('stato_by.is.null,stato_by.neq.bot')), 'richieste nuove'),
      ]);
      // 03-11: nuove iscritte = prima apertura dell'Area Membri oggi (contaIscritte). Le clienti viste oggi, poi quali di
      // loro avevano gia' una visita prima: solo l'id della cliente, a blocchi di 100 (Regola 20b)
      const { data: vis, error: vErr } = await retryOnce(() => sb.from('loyalty_visits').select('shopify_customer_id').gte('first_at', t0).limit(1001));
      if (vErr || (vis ?? []).length > 1000) throw new LetturaFallita('visite del giorno', vErr ?? 'oltre 1000 righe');
      const idsOggi = [...new Set(((vis ?? []) as Riga[]).map((r) => String(r.shopify_customer_id ?? '')).filter(Boolean))];
      const giaViste: Riga[] = [];
      for (let i = 0; i < idsOggi.length; i += 100) {
        const blocco = idsOggi.slice(i, i + 100);
        const { data: pv, error: pErr } = await retryOnce(() => sb.from('loyalty_visits').select('shopify_customer_id').in('shopify_customer_id', blocco).lt('first_at', t0).limit(10000));
        if (pErr || (pv ?? []).length >= 10000) throw new LetturaFallita('visite precedenti', pErr ?? 'troppe righe');
        giaViste.push(...((pv ?? []) as Riga[]));
      }
      const o = sommaOrdini((ord ?? []) as Riga[]), k = sommaCassa((cassa ?? []) as Riga[]);
      const c: ContiRiepilogo = { ordini: o.n, incasso: o.incasso, scontrini: k.scontrini, incassoCassa: k.incasso, arrivi: contaArrivi((arr ?? []) as Riga[]), ordiniFornitore,
        premia, csFerme, b2bScadute, daCompletare, daPulire, daCollegare, followUpPronti, daSpedire: ordiniInRitardo((ritardo ?? []) as Riga[], oggi, giorni), affido, csNuove,
        iscritte: contaIscritte((vis ?? []) as Riga[], giaViste) };
      return msgRiepilogo(cands, c, giorni, oreAffido);
    },
  },
};
// priorita' nel tetto di 20 invii: prima il sistema e l'urgente, l'attivita' del team (informazione per Ale, 21-10)
// prima del riepilogo, il riepilogo per ultimo. 03-11: premia_salute col sistema, premia_da_approvare dopo l'Assistenza.
// 06-11: sistema_senza_iscritti prima del riepilogo, dopo gli eventi che portano una notizia (e' un promemoria di stato
// al giorno, e le sue letture, tre piu' un conteggio per tema, non devono ritardare cs_urgente)
// 08-11 (chat del sito): chat_sollecito (che porta anche il nuovo tentativo della push "chiede una persona") subito dopo
// cs_urgente, la scala dopo, chat_salute dopo i solleciti (Gate 2, C6: con molti guasti in fila consumerebbe il tetto dei
// 20 invii prima delle notizie per le clienti)
// 09-11 (v9): stock_fermo dopo l'attivita' del team e prima dei promemoria di sistema (una push al giorno al massimo di
// solito, e una sola lettura)
const ORDINE = ['sistema_cs_sync_fermo', 'premia_salute', 'cs_urgente', 'chat_sollecito', 'chat_sollecito_scala', 'chat_salute', 'spedizione_eccezione', 'b2b_risposta_negozio', 'cs_cliente_ha_riscritto', 'premia_da_approvare', 'attivita_team', 'stock_fermo', 'sistema_senza_iscritti', 'riepilogo'];
// pezzi fermi: il 09-11 erano 13 codici; oltre 200 la lettura ferma l'evento invece di tagliare l'elenco
const LIMITE_FERMI = 200;

// registro: .in() sulle sole chiavi dei candidati, a blocchi di 100 (Regola 20b), mai la tabella intera
async function leggiRegistro(sb: Sb, evento: string, chiavi: string[]): Promise<Map<string, Reg>> {
  const m = new Map<string, Reg>();
  const uniche = [...new Set(chiavi)];
  for (let i = 0; i < uniche.length; i += 100) {
    const blocco = uniche.slice(i, i + 100);
    const { data, error } = await retryOnce(() => sb.from('push_eventi_inviati').select('id, chiave, stato, tentativi, updated_at').eq('evento', evento).in('chiave', blocco).limit(blocco.length + 1));
    if (error) throw new LetturaFallita('registro', error);
    for (const r of (data ?? []) as Reg[]) m.set(String(r.chiave), r);
  }
  return m;
}

// le scritture del registro, mai ritentate. prenota e salta lavorano sul vincolo UNIQUE (evento, chiave): una riga che
// c'e' gia' non si tocca e chi non prenota non invia; riprendi e chiudi confrontano stato e tentativi, cosi' due giri
// sovrapposti non rimandano la stessa push e un esito non finisce su una ripresa altrui. chiudi restituisce la riga
// aggiornata (RF-6): zero righe vuol dire che il confronto non ha trovato la ripresa, ed e' un esito non registrato.
function depGiro(sb: Sb, evento: string, tema: string, adesso: () => number): DepGiro {
  const ora = () => new Date().toISOString();
  return {
    salta: async (righe) => {
      const { error } = await sb.from('push_eventi_inviati').upsert(righe.map((x) => ({ evento, chiave: x.chiave, stato: 'saltato', tentativi: 0, esito: { motivo: x.motivo }, updated_at: ora() })), { onConflict: 'evento,chiave', ignoreDuplicates: true });
      if (error) throw new ScritturaFallita('registro saltati', error);
    },
    prenota: async (chiave) => {
      const { data, error } = await sb.from('push_eventi_inviati').upsert({ evento, chiave, stato: 'prenotato', tentativi: 1, updated_at: ora() }, { onConflict: 'evento,chiave', ignoreDuplicates: true }).select('id');
      if (error) throw new ScritturaFallita('registro prenotazione', error);
      const r = ((data ?? []) as { id: number | string }[])[0];
      return r ? { id: r.id } : null;
    },
    riprendi: async (r) => {
      const { data, error } = await sb.from('push_eventi_inviati').update({ stato: 'prenotato', tentativi: r.tentativi + 1, updated_at: ora() }).eq('id', r.id).eq('stato', r.stato).eq('tentativi', r.tentativi).select('id');
      if (error) throw new ScritturaFallita('registro ripresa', error);
      return (data ?? []).length > 0;
    },
    invia: (m) => inviaPush({ tema, titolo: m.titolo, testo: m.testo, url: m.url, urgente: m.urgente === true, ...(m.chi ? { chi: m.chi } : {}) }),
    chiudi: async (id, tentativi, stato, esito, definitivo) => {
      const { data, error } = await sb.from('push_eventi_inviati').update({ stato, esito, updated_at: ora(), ...(definitivo ? { tentativi: MAX_TENTATIVI } : {}) }).eq('id', id).eq('tentativi', tentativi).select('id');
      if (error) console.error('push-eventi: esito non registrato', evento, String(id), errTesto(error));
      return !error && (data ?? []).length > 0;
    },
    adesso,
  };
}

async function giroEvento(sb: Sb, ev: RigaEvento, ctx: Ctx, budget: Budget, adesso: () => number): Promise<Resoconto & { baseline: boolean; persi_stallo: number; errore?: string; causa?: string }> {
  const def = EVENTI[ev.evento];
  const tema = temaDi(ev.tema, ev.evento);
  const { seme, baseline, ripartenza } = baselineDi(ev, ctx.ora);
  const cands = await def.candidati(sb, ctx, ev);
  const registro = await leggiRegistro(sb, ev.evento, cands.map((c) => c.chiave));
  const piano = pianifica(cands, registro, { ora: ctx.ora, baseline, etaMaxMs: soglia(ev.soglie, 'eta_max_ore', 6, 1, 48) * 3600000, motivoBaseline: ripartenza ? 'stallo' : 'baseline', frescoMs: frescoRipartenzaMs(ev.evento) });
  const daComporre = piano.filter((p) => p.azione === 'nuovo' || p.azione === 'ritenta').map((p) => p.cand);
  const dep = depGiro(sb, ev.evento, tema, adesso);
  let r: Resoconto;
  const g = def.gruppi;
  if (g) {
    // attivita_team (21-10): le letture per i testi prima di ogni prenotazione; poi una push per gruppo, col testo delle
    // sole righe prese (eseguiGruppi)
    const dettagli = daComporre.length ? await g.dettagli(sb, ctx, ev, daComporre) : {};
    r = await eseguiGruppi(piano, g.gruppoDi, (cs) => { const m = g.messaggio(cs, dettagli); return m && { ...m, tema }; }, budget, dep);
  } else {
    const msgs = new Map<string, Msg>();
    if (daComporre.length) for (const m of await def.componi(sb, ctx, ev, daComporre)) msgs.set(m.chiave, { ...m, tema });
    r = await eseguiPiano(piano, msgs, budget, dep);
  }
  const persi_stallo = piano.filter((p) => p.azione === 'salta' && p.motivo === 'stallo').length;
  // fine del giro dell'evento: ultimo_giro_at sempre, baseline_at quando si e' seminato
  const fine = new Date().toISOString();
  const { error } = await sb.from('push_eventi').update(seme ? { ultimo_giro_at: fine, baseline_at: fine } : { ultimo_giro_at: fine }).eq('evento', ev.evento);
  return { ...r, baseline, persi_stallo, ...(error ? { errore: 'push_eventi non aggiornato: ' + errTesto(error), causa: 'scrittura push_eventi' } : {}) };
}

// push perse nelle ultime 24 ore, dal registro: chiuse dopo l'ultimo tentativo (anche per timeout o chi ignorato) e
// pregresso saltato a una ripartenza dopo una pausa. Tengono la salute almeno in warn per un giorno (RF-2). Lettura
// fallita = null (la salute lo scrive come warn), mai zero.
async function contaPerse24h(sb: Sb, ctx: Ctx): Promise<number | null> {
  const da = dalle(ctx, 24 * 3600000);
  try {
    const [esaurite, stallo] = await Promise.all([
      conta(retryOnce(() => sb.from('push_eventi_inviati').select('id', { count: 'exact', head: true }).eq('stato', 'fallito').gte('tentativi', MAX_TENTATIVI).gte('updated_at', da)), 'push perse'),
      conta(retryOnce(() => sb.from('push_eventi_inviati').select('id', { count: 'exact', head: true }).eq('stato', 'saltato').eq('esito->>motivo', 'stallo').gte('updated_at', da)), 'pregresso saltato'),
    ]);
    return esaurite + stallo;
  } catch (e) {
    if (e instanceof LetturaFallita) return null;
    throw e;
  }
}

// La riga di salute del giro: UNA upsert su (day, k), giorno UTC come le altre edge (Salute mostra solo il giorno piu'
// recente: un giorno di Roma nasconderebbe le altre righe fra le 22 e le 24 UTC), error destrutturato, mai ritentata
// (Regola 20d). La riga di oggi si legge prima: la gravita' non scende nello stesso giorno. Se quella lettura fallisce si
// scrive solo un error (piu' in alto non si va) e altrimenti niente: un ok non deve coprire un errore che non si vede.
async function scriviSalute(sb: Sb, ora: number, s: Salute): Promise<{ severity: string; scritta: boolean; errore?: string }> {
  const day = new Date(ora).toISOString().slice(0, 10);
  const { data, error: pErr } = await retryOnce(() => sb.from('health_log').select('severity, label').eq('day', day).eq('k', 'push_eventi').limit(1));
  if (pErr && s.severity !== 'error') return { severity: s.severity, scritta: false, errore: 'salute di oggi non leggibile: riga non riscritta' };
  const r = conPrecedente(s, pErr ? null : ((data ?? []) as Riga[])[0] ?? null, ora);
  const { error } = await sb.from('health_log').upsert({ day, k: 'push_eventi', label: r.label, n: r.n, severity: r.severity, created_at: new Date().toISOString() }, { onConflict: 'day,k' });
  if (error) console.error('push-eventi: health_log non scritto', errTesto(error));
  return { severity: r.severity, scritta: !error, ...(error ? { errore: 'health_log non scritto' } : {}) };
}

// Il giro `run` dopo il PIN e i flag (Deno.serve lo chiama solo a modulo acceso). `adesso` e' l'orologio dei tetti di
// tempo (i test lo fanno correre); ctx.ora resta l'istante logico del giro (finestre, eta', giorno della salute).
async function eseguiRun(sb: Sb, ctx: Ctx, adesso: () => number = Date.now): Promise<Response> {
  const inizio = adesso();
  const { data: righe, error: eErr } = await retryOnce(() => sb.from('push_eventi').select('evento, tema, attivo, soglie, baseline_at, ultimo_giro_at').eq('attivo', true).limit(50));
  if (eErr) {
    const salute = await scriviSalute(sb, ctx.ora, { severity: 'error', label: 'eventi non leggibili: nessun evento e\' girato', n: 1, problema: 'eventi non leggibili' });
    return json({ ok: false, error: 'eventi non leggibili, riprova', salute: salute.severity }, 503);
  }
  const attivi = new Map(((righe ?? []) as RigaEvento[]).filter((r) => r.attivo === true).map((r) => [r.evento, r]));
  const budget: Budget = { invii: TETTO_INVII, scade: inizio + SCADENZA_INVII_MS };
  const esiti: Record<string, EsitoEvento & Record<string, unknown>> = {};
  let inviati = 0;
  for (const nome of ORDINE) {
    const ev = attivi.get(nome);
    if (!ev) continue;
    if (adesso() - inizio > TEMPO_EVENTI_MS) { esiti[nome] = { rimandato: 'tempo' }; continue; }
    try {
      const r = await giroEvento(sb, ev, ctx, budget, adesso);
      esiti[nome] = r;
      inviati += r.inviati;
    } catch (e) {
      esiti[nome] = { errore: errTesto(e), causa: causaDi(e) };
    }
  }
  for (const nome of attivi.keys()) if (!EVENTI[nome]) esiti[nome] = { errore: 'evento sconosciuto a questa versione', causa: 'evento sconosciuto' };
  const perse24h = await contaPerse24h(sb, ctx);
  const ultimoGiro = Object.fromEntries([...attivi].map(([n, r]) => [n, r.ultimo_giro_at]));
  const delGiro = saluteGiro(esiti, ultimoGiro, ctx.ora, perse24h, attivi.size);
  const salute = await scriviSalute(sb, ctx.ora, delGiro);
  const errori = Object.values(esiti).filter((r) => r.errore).length;
  const durata_ms = adesso() - inizio;
  console.log(JSON.stringify({ fn: 'push-eventi', azione: 'run', eventi: esiti, inviati, errori, salute: salute.severity, durata_ms }));
  return json({ ok: delGiro.severity === 'ok' && salute.scritta, eventi: esiti, inviati, salute: salute.severity, ...(salute.errore ? { errore_salute: salute.errore } : {}), durata_ms });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const raw = await req.json().catch(() => null);
  const body: Record<string, unknown> = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const svc = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, svc);

  // 1) PIN, prima di ogni azione. Config non leggibile = 503, mai un cancello aperto.
  const { data: cfg, error: cfgErr } = await retryOnce(() => sb.from('app_config').select('pin_hash').eq('id', 1).limit(1));
  if (cfgErr) return json({ error: 'configurazione non leggibile, riprova' }, 503);
  const pinHash = String(((cfg ?? []) as { pin_hash?: unknown }[])[0]?.pin_hash ?? '');
  if (!pinHash || typeof body.pin !== 'string' || !body.pin || !ugualeCostante(await sha256hex(body.pin), pinHash)) return json({ error: 'PIN errato' }, 401);
  const action = typeof body.action === 'string' && body.action ? body.action : 'run';
  if (action !== 'run' && action !== 'anteprima') return json({ error: 'azione sconosciuta' }, 422);
  if (action === 'anteprima') {
    const authz = req.headers.get('Authorization') || '';
    const token = authz.toLowerCase().startsWith('bearer ') ? authz.slice(7).trim() : '';
    if (!svc || !ugualeCostante(token, svc)) return json({ error: 'anteprima solo con la chiave di servizio' }, 403);
  }

  // 2) flag: whitelist esplicita (CONOSCENZA 02-08), lettura controllata
  const { data: frows, error: fErr } = await retryOnce(() => sb.from('app_flags').select('key, value').in('key', ['push_eventi_enabled', 'push_enabled', 'lead_outreach_ai_enabled', 'loyalty_pool_min', 'chat_sollecito_ore', 'chat_orari']).limit(10));
  if (fErr) return json({ ok: false, error: 'flag non leggibili, riprova' }, 503);
  const flags: Record<string, string> = {};
  for (const r of (frows ?? []) as { key: string; value: unknown }[]) flags[r.key] = typeof r.value === 'string' ? r.value : '';
  const ora = Date.now();
  const ctx: Ctx = { ora, flags, finestra: finestraRiepilogo(ora) };

  if (action === 'anteprima') return await anteprima(sb, ctx, body.forza_riepilogo === true);

  // 3) run: rollback = spegnere il flag. A modulo spento (o con push_enabled spento) nessuna lettura degli eventi, nessuna
  //    scrittura (neanche health_log): alla riaccensione oltre le 2 ore ogni evento riparte dalla baseline (dalla v4
  //    partono solo gli eventi freschi, frescoRipartenzaMs; il resto e' `saltato` stallo).
  if (!flagVero(flags.push_eventi_enabled) || !flagVero(flags.push_enabled)) return json({ ok: true, skipped: 'disabled' });
  return await eseguiRun(sb, ctx);
});

// Anteprima: SOLO letture. Per ogni evento conosciuto, acceso o no: candidati, decisione del registro (con la baseline che
// scatterebbe adesso) e, per i primi 20, chiave, testo e destinatari. Mai prenota, salta, chiudi, inviaPush o health_log.
async function anteprima(sb: Sb, ctx: Ctx, forzaRiepilogo: boolean): Promise<Response> {
  const { data: righe, error } = await retryOnce(() => sb.from('push_eventi').select('evento, tema, attivo, soglie, baseline_at, ultimo_giro_at').limit(50));
  if (error) return json({ ok: false, error: 'eventi non leggibili, riprova' }, 503);
  const perNome = new Map(((righe ?? []) as RigaEvento[]).map((r) => [r.evento, r]));
  const c: Ctx = forzaRiepilogo ? { ...ctx, finestra: { ...ctx.finestra, aperta: true } } : ctx;
  const eventi: Record<string, unknown>[] = [];
  for (const nome of ORDINE) {
    const ev: RigaEvento = perNome.get(nome) ?? { evento: nome, tema: null, attivo: false, soglie: {}, baseline_at: null, ultimo_giro_at: null };
    const tema = temaDi(ev.tema, nome);
    const { baseline, ripartenza } = baselineDi(ev, c.ora);
    try {
      const cands = await EVENTI[nome].candidati(sb, c, ev);
      const registro = await leggiRegistro(sb, nome, cands.map((x) => x.chiave));
      const piano = pianifica(cands, registro, { ora: c.ora, baseline, etaMaxMs: soglia(ev.soglie, 'eta_max_ore', 6, 1, 48) * 3600000, motivoBaseline: ripartenza ? 'stallo' : 'baseline', frescoMs: frescoRipartenzaMs(ev.evento) });
      // a gruppi (attivita_team, 21-10): il testo di un gruppo si compone dalle sole righe che partirebbero, e ogni riga
      // mostra quello del suo gruppo; partirebbe conta le push, non le righe
      const g = EVENTI[nome].gruppi;
      const parte = (p: Decisione) => p.azione === 'nuovo' || p.azione === 'ritenta';
      const daComporre = g ? piano.filter(parte).map((p) => p.cand) : cands;
      const chiaveMsg = (x: Cand) => (g ? g.gruppoDi(x) : x.chiave);
      const msgs = new Map<string, Msg>();
      if (daComporre.length) for (const m of await EVENTI[nome].componi(sb, c, ev, daComporre)) msgs.set(m.chiave, { ...m, tema });
      // Gate 2 del 21-10 (C2): a gruppi, anche le righe che NON partirebbero (baseline alla prima accensione, vecchie, gia'
      // gestite) mostrano un testo, quello del loro gruppo composto dalle sole righe ferme, segnato non_partirebbe: senza,
      // l'anteprima prima dell'accensione di attivita_team non faceva vedere nessun titolo ne' testo vero
      const ferme = new Map<string, Msg>();
      const resto = g ? piano.filter((p) => !parte(p)).map((p) => p.cand) : [];
      if (resto.length) for (const m of await EVENTI[nome].componi(sb, c, ev, resto)) ferme.set(m.chiave, { ...m, tema });
      const partirebbe = new Set(piano.filter((p) => parte(p) && msgs.has(chiaveMsg(p.cand))).map((p) => chiaveMsg(p.cand))).size;
      eventi.push({ evento: nome, tema, attivo: ev.attivo === true, riga_a_db: perNome.has(nome), baseline, candidati: cands.length, partirebbe,
        messaggi: piano.slice(0, 20).map((p) => {
          const m = !g || parte(p) ? msgs.get(chiaveMsg(p.cand)) : ferme.get(chiaveMsg(p.cand));
          return { chiave: p.cand.chiave, decisione: p.azione, ...(p.motivo ? { motivo: p.motivo } : {}),
            ...(m ? { titolo: m.titolo, testo: m.testo, url: m.url, tema: m.tema, chi: m.chi ?? 'tutti gli iscritti al tema', urgente: m.urgente === true } : {}),
            ...(m && g && !parte(p) ? { non_partirebbe: true } : {}) };
        }) });
    } catch (e) {
      eventi.push({ evento: nome, tema, attivo: ev.attivo === true, riga_a_db: perNome.has(nome), baseline, errore: errTesto(e) });
    }
  }
  return json({ ok: true, anteprima: true, push_eventi_enabled: flagVero(ctx.flags.push_eventi_enabled), push_enabled: flagVero(ctx.flags.push_enabled),
    ora_roma: dataRoma(ctx.ora), riepilogo_aperto: c.finestra.aperta, tetto_invii: TETTO_INVII, eventi });
}
