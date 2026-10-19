// push-eventi v1 (2026-10-18): gli eventi che esistono gia' nei dati diventano notifiche native per profilo.
// v2 (2026-10-19): le push su una cliente dicono chi e' (nome, o email senza nome), decisione di Dan del 19-10 (Privacy, sotto).
// Brief: Cowork12/_CLAUDE_CODE_INBOX/2026-10-18_BRIEF_push_eventi_per_profilo.md (decisioni di Dan del 18-10). Modulo push_*
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
// accensione, 'stallo' alla ripartenza: quelle sono push perse e la salute lo dice per 24 ore). Un candidato con l'evento
// piu' vecchio di 6 ore non diventa una push. Tetto: 20 invii per giro, un invio parte solo nei primi 15 secondi del giro e
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
// chiavi di PEOPLE del web, come il check di push_subscriptions (migr 0163) e CHI_AMMESSI di push-api
const CHI_PERSONE = ['Ale', 'Bene', 'Ginevra'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TEMA_RE = /^[a-z_]{2,32}$/;
// tema di ogni evento (righe di push_eventi della 0166); la riga a DB vince se e' una chiave valida
const TEMA_EVENTO: Record<string, string> = {
  b2b_risposta_negozio: 'negozi', cs_urgente: 'assistenza', cs_cliente_ha_riscritto: 'assistenza',
  spedizione_eccezione: 'spedizioni', sistema_cs_sync_fermo: 'sistema', riepilogo: 'riepilogo',
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
// 18:30, da lunedi' a sabato; "oggi" = dalla mezzanotte di Roma.
const FUSO = 'Europe/Rome';
const ORA_RIEPILOGO_MIN = 18 * 60 + 30;
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
// giorni del cambio d'ora quello delle 18:30 e quello delle 00:00 sono diversi.
function mezzanotteRoma(ms: number): number {
  const p = partiRoma(ms);
  const base = Date.UTC(p.y, p.m - 1, p.d);
  return base - offsetRomaMin(base - offsetRomaMin(ms) * 60000) * 60000;
}
// aperta dalle 18:30 alle 23:59 di Roma, da lunedi' a sabato; ts = le 18:30 di quel giorno (eta' del riepilogo)
function finestraRiepilogo(ms: number): { aperta: boolean; data: string; ts: number } {
  const p = partiRoma(ms);
  const data = `${p.y}-${due(p.m)}-${due(p.d)}`;
  const ts = Date.UTC(p.y, p.m - 1, p.d, 18, 30) - offsetRomaMin(ms) * 60000;
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
    if (!v || v.urgente !== true || v.canale === 'rumore') continue;
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
const LDV_RE = /^[A-Za-z0-9_./-]{1,64}$/;
function candSpedizione(righe: Riga[]): Cand[] {
  const out: Cand[] = [];
  for (const r of righe ?? []) {
    if (r?.classe !== 'eccezione' || typeof r.ldv !== 'string' || !LDV_RE.test(r.ldv)) continue;
    const stato = statoCorriere(r.stato_tws);
    // nella chiave lo stato senza spazi ne' punteggiatura: la chiave passa da un filtro .in() di PostgREST. Il nome della
    // cliente (19-10) sta solo in rif, per il titolo: mai nella chiave, che finisce nel registro
    out.push({ chiave: `${r.ldv}:${(stato || 'ALTRO').replace(/[^\p{L}\p{N}]+/gu, '_')}`, ts: msDi(r.updated_at),
      rif: { ordine: numeroOrdine(r.order_name), stato, cliente: nomeCliente(r.customer_name, null) } });
  }
  return ordinaRecenti(out);
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
  daSpedire: string[]; affido: number; csNuove: number;
};
const pos = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
const unisci = (testa: string, parti: string[]) => { const p = parti.filter(Boolean); return p.length ? `${testa}: ${p.join(', ')}` : ''; };
// al massimo 4 righe di soli numeri, codici e numeri d'ordine; una riga c'e' solo se ha qualcosa diverso da zero.
// Ale: vendite del giorno, fornitori, Premia, team. Benny: prodotti, B2B. Ginni: spedizioni, affido, Assistenza (decisione
// 1 di Dan: l'Assistenza e' sua). I rimborsi del giorno non ci sono: shopify_orders non ha la data del rimborso.
function righeRiepilogo(chi: string, c: ContiRiepilogo, giorni: number, oreAffido: number): string[] {
  const r: string[] = [];
  if (chi === 'Ale') {
    r.push(unisci('Vendite', [pos(c.ordini) ? `${plurale(pos(c.ordini), 'ordine', 'ordini')} sul sito (${euro(c.incasso)} EUR)` : '',
      pos(c.scontrini) ? `${plurale(pos(c.scontrini), 'scontrino', 'scontrini')} in cassa (${euro(c.incassoCassa)} EUR)` : '']));
    r.push(unisci('Fornitori', [pos(c.arrivi) ? plurale(pos(c.arrivi), 'arrivo registrato', 'arrivi registrati') : '',
      pos(c.ordiniFornitore) ? plurale(pos(c.ordiniFornitore), 'ordine registrato', 'ordini registrati') : '']));
    r.push(unisci('Premia', [pos(c.premia) ? plurale(pos(c.premia), 'contenuto da approvare', 'contenuti da approvare') : '']));
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
const EVENTI_DI_STATO = ['sistema_cs_sync_fermo'];
type Reg = { id: number | string; chiave: string; stato: string; tentativi: number; updated_at: string };
type Decisione = { cand: Cand; azione: 'nuovo' | 'ritenta' | 'salta' | 'fermo'; motivo: string; reg?: Reg };
// prima accensione (baseline_at vuoto) o ripartenza: ultimo giro assente o di oltre 2 ore fa (evento spento e riacceso,
// flag spento, edge ferma). Allora quello che esiste gia' si segna `saltato` e non parte niente.
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
function pianifica(cands: Cand[], registro: Map<string, Reg>, o: { ora: number; baseline: boolean; etaMaxMs: number; motivoBaseline?: string }): Decisione[] {
  const visti = new Set<string>();
  const out: Decisione[] = [];
  const motivoBaseline = o.motivoBaseline === 'stallo' ? 'stallo' : 'baseline';
  for (const cand of cands) {
    if (!cand || typeof cand.chiave !== 'string' || !cand.chiave || visti.has(cand.chiave)) continue;
    visti.add(cand.chiave);
    const eta = o.ora - cand.ts;
    const giovane = Number.isFinite(eta) && eta <= o.etaMaxMs;
    const r = registro.get(cand.chiave);
    if (!r) {
      if (o.baseline) out.push({ cand, azione: 'salta', motivo: motivoBaseline });
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
type DefEvento = { candidati: (sb: Sb, ctx: Ctx, ev: RigaEvento) => Promise<Cand[]>; componi: (sb: Sb, ctx: Ctx, ev: RigaEvento, cands: Cand[]) => Promise<Msg[]> };

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
      const aperte = await conta(retryOnce(() => sb.from('cs_conversations').select('id', { count: 'exact', head: true }).eq('urgente', true).neq('canale', 'rumore').neq('stato', 'fatto')), 'urgenti aperte');
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
      const settimana = await conta(retryOnce(() => sb.from('v_spedizioni_eccezioni').select('ldv', { count: 'exact', head: true }).eq('classe', 'eccezione').gte('updated_at', dalle(ctx, 7 * 86400000))), 'eccezioni della settimana');
      return msgSpedizione(cands, settimana);
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
      const inAttesa = await conta(retryOnce(() => sb.from('cs_conversations').select('id', { count: 'exact', head: true }).eq('stato', 'da_fare').eq('last_direction', 'in').neq('canale', 'rumore')), 'richieste in attesa');
      return msgCsRiscritto(cands, conv, inAttesa);
    },
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
        conta(retryOnce(() => sb.from('cs_conversations').select('id', { count: 'exact', head: true }).eq('stato', 'da_fare').eq('last_direction', 'in').lt('last_msg_at', ieri).neq('canale', 'rumore')), 'richieste ferme'),
        conta(retryOnce(() => sb.from('v_lead_outreach').select('id', { count: 'exact', head: true }).eq('scaduta', true).eq('da_gestire', false).is('bozza_auto_tocco', null)), 'azioni B2B scadute'),
        conta(retryOnce(() => sb.from('v_products_todo').select('codice', { count: 'exact', head: true }).in('bucket', ['nuovo', 'costo_ricavo'])), 'prodotti da completare'),
        conta(retryOnce(() => sb.from('v_products_todo').select('codice', { count: 'exact', head: true }).eq('bucket', 'pulizia')), 'prodotti da pulire'),
        collegare ? conta(retryOnce(() => sb.from('v_lead_inbound').select('conv_id', { count: 'exact', head: true })), 'messaggi da collegare') : Promise.resolve(0),
        conta(retryOnce(() => sb.from('v_lead_outreach').select('id', { count: 'exact', head: true }).not('bozza_auto_tocco', 'is', null).eq('da_gestire', false)), 'follow-up pronti'),
        conta(retryOnce(() => sb.from('shipping_status').select('ldv', { count: 'exact', head: true }).eq('stato_tws', 'IN ATTESA DI AFFIDO').lt('updated_at', dalle(ctx, oreAffido * 3600000)).gte('shipped_date', dataRoma(ctx.ora - giorniAffido * 86400000))), 'in attesa di affido'),
        conta(retryOnce(() => sb.from('cs_conversations').select('id', { count: 'exact', head: true }).gte('created_at', t0).neq('canale', 'rumore')), 'richieste nuove'),
      ]);
      const o = sommaOrdini((ord ?? []) as Riga[]), k = sommaCassa((cassa ?? []) as Riga[]);
      const c: ContiRiepilogo = { ordini: o.n, incasso: o.incasso, scontrini: k.scontrini, incassoCassa: k.incasso, arrivi: contaArrivi((arr ?? []) as Riga[]), ordiniFornitore,
        premia, csFerme, b2bScadute, daCompletare, daPulire, daCollegare, followUpPronti, daSpedire: ordiniInRitardo((ritardo ?? []) as Riga[], oggi, giorni), affido, csNuove };
      return msgRiepilogo(cands, c, giorni, oreAffido);
    },
  },
};
// priorita' nel tetto di 20 invii: prima il sistema e l'urgente, il riepilogo per ultimo
const ORDINE = ['sistema_cs_sync_fermo', 'cs_urgente', 'spedizione_eccezione', 'b2b_risposta_negozio', 'cs_cliente_ha_riscritto', 'riepilogo'];

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
  const piano = pianifica(cands, registro, { ora: ctx.ora, baseline, etaMaxMs: soglia(ev.soglie, 'eta_max_ore', 6, 1, 48) * 3600000, motivoBaseline: ripartenza ? 'stallo' : 'baseline' });
  const daComporre = piano.filter((p) => p.azione === 'nuovo' || p.azione === 'ritenta').map((p) => p.cand);
  const msgs = new Map<string, Msg>();
  if (daComporre.length) for (const m of await def.componi(sb, ctx, ev, daComporre)) msgs.set(m.chiave, { ...m, tema });
  const r = await eseguiPiano(piano, msgs, budget, depGiro(sb, ev.evento, tema, adesso));
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
  const { data: frows, error: fErr } = await retryOnce(() => sb.from('app_flags').select('key, value').in('key', ['push_eventi_enabled', 'push_enabled', 'lead_outreach_ai_enabled']).limit(10));
  if (fErr) return json({ ok: false, error: 'flag non leggibili, riprova' }, 503);
  const flags: Record<string, string> = {};
  for (const r of (frows ?? []) as { key: string; value: unknown }[]) flags[r.key] = typeof r.value === 'string' ? r.value : '';
  const ora = Date.now();
  const ctx: Ctx = { ora, flags, finestra: finestraRiepilogo(ora) };

  if (action === 'anteprima') return await anteprima(sb, ctx, body.forza_riepilogo === true);

  // 3) run: rollback = spegnere il flag. A modulo spento (o con push_enabled spento) nessuna lettura degli eventi, nessuna
  //    scrittura (neanche health_log): alla riaccensione oltre le 2 ore ogni evento riparte dalla baseline.
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
      const piano = pianifica(cands, registro, { ora: c.ora, baseline, etaMaxMs: soglia(ev.soglie, 'eta_max_ore', 6, 1, 48) * 3600000, motivoBaseline: ripartenza ? 'stallo' : 'baseline' });
      const msgs = new Map<string, Msg>();
      if (cands.length) for (const m of await EVENTI[nome].componi(sb, c, ev, cands)) msgs.set(m.chiave, { ...m, tema });
      const partirebbe = piano.filter((p) => (p.azione === 'nuovo' || p.azione === 'ritenta') && msgs.has(p.cand.chiave)).length;
      eventi.push({ evento: nome, tema, attivo: ev.attivo === true, riga_a_db: perNome.has(nome), baseline, candidati: cands.length, partirebbe,
        messaggi: piano.slice(0, 20).map((p) => {
          const m = msgs.get(p.cand.chiave);
          return { chiave: p.cand.chiave, decisione: p.azione, ...(p.motivo ? { motivo: p.motivo } : {}),
            ...(m ? { titolo: m.titolo, testo: m.testo, url: m.url, tema: m.tema, chi: m.chi ?? 'tutti gli iscritti al tema', urgente: m.urgente === true } : {}) };
        }) });
    } catch (e) {
      eventi.push({ evento: nome, tema, attivo: ev.attivo === true, riga_a_db: perNome.has(nome), baseline, errore: errTesto(e) });
    }
  }
  return json({ ok: true, anteprima: true, push_eventi_enabled: flagVero(ctx.flags.push_eventi_enabled), push_enabled: flagVero(ctx.flags.push_enabled),
    ora_roma: dataRoma(ctx.ora), riepilogo_aperto: c.finestra.aperta, tetto_invii: TETTO_INVII, eventi });
}
