// tests/chat_staff_send.mjs: le edge chat-staff staff-2 e chat-send send-1 (chat del sito, Fase 1 pezzo 3,
// docs/PROPOSTA_chat_sito.md 6.5, 7.8, 7.9, 11.5 e 11.6 con D-8) ritagliate DAL SORGENTE che va in produzione (blocchi
// PURE) e guidate in Node con Request veri, un DB finto in memoria che riproduce i vincoli della migr 0186 che contano
// qui e un Gmail finto. chat-staff chiama il vero gestisci di chat-send con la chiave di servizio. Piu' le guardie sul
// sorgente e sulla migr 0187. Nessuna rete.
//   node tests/chat_staff_send.mjs
// Perche' esiste: chat-send manda email a indirizzi scritti dalle clienti. Un'email doppia, a un destinatario sbagliato o
// con un header iniettato, un messaggio prenotato e mai chiuso, una cancellazione che lascia dati o un'azione del team
// senza controllo del dominio non si vedono finche' non succedono.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
import { createHash, randomUUID, randomBytes } from 'node:crypto';

process.removeAllListeners('warning');
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n');
const SEND = read('supabase/functions/chat-send/index.ts');
const STAFF = read('supabase/functions/chat-staff/index.ts');
const CSSEND = read('supabase/functions/cs-send/index.ts');
const CHATAPI = read('supabase/functions/chat-api/index.ts');
const CONFIG = read('supabase/config.toml');
const M0187 = read('supabase/migrations/0187_chat_invio.sql');
const M0189 = read('supabase/migrations/0189_chat_conservazione_push.sql');
const WF = read('.github/workflows/amimi-app-tests.yml');

let ok = 0, ko = 0;
const t = (n, c, extra = '') => { if (c) { ok++; console.log('  ok  ' + n); } else { ko++; console.log('  KO  ' + n + (extra !== '' ? '  <- ' + JSON.stringify(extra).slice(0, 300) : '')); } };

function blocco(src, nome) {
  const B = `// ==== PURE:${nome} BEGIN ====`, E = `// ==== PURE:${nome} END ====`;
  const a = src.indexOf(B), b = src.indexOf(E);
  if (a < 0 || b < a) { console.error(`marcatori PURE:${nome} non trovati`); process.exit(1); }
  return src.slice(a + B.length, b);
}
const S = new Function(stripTypeScriptTypes(blocco(SEND, 'chat-send-gmail') + blocco(SEND, 'chat-send'))
  + '\nreturn { gestisci, destinatario, intestazioniPulite, ultimoDelThread, componiMime, ErroreDb, GIRO_MAX, VERSIONE };')();
const F = new Function(stripTypeScriptTypes(blocco(STAFF, 'chat-staff')) + '\nreturn { gestisci, testoStaff, ErroreDb, VERSIONE };')();

// ---------- DB finto: i vincoli della 0186 che contano qui ----------
const SVC = 'chiave_di_servizio_finta';
const sha = (s) => createHash('sha256').update(s).digest('hex');
const T0 = Date.parse('2026-11-09T10:00:00Z');
const isoT = (ms) => new Date(ms).toISOString();
function nuovoStore() {
  return { ora: T0, flag: 'true', pinHash: sha('x'), sess: new Map(), msg: new Map(), token: [], eventi: [], cont: new Map(), cs: new Map(), push: [], seq: 0, salute: null,
    utenti: { 'jwt-team': 'ginni@amimi.it', 'jwt-fuori': 'qualcuno@gmail.com' }, rotto: {}, proiezioni: [],
    flags: new Map([['chat_sito_enabled', 'false'], ['chat_orari', '{"tz":"Europe/Rome","giorni":[1,2,3,4,5],"dalle":"09:00","alle":"18:00","chiusure":[]}'],
      ['chat_sollecito_ore', '24,48'], ['chat_testo_attesa', '{"it":"Attesa {email}","en":"Wait {email}"}'], ['chat_bottoni', '[{"id":"spedizioni","it":"Spedizioni","en":"Shipping","faq":7},{"id":"resi","it":"Resi","en":"Returns","faq":null}]'],
      ['cs_gmail_sa_key', 'SEGRETO-CHE-NON-DEVE-USCIRE']]),
    faq: new Map([[7, { id: 7, tipo: 'risposta_standard', titolo: 'Spedizioni', testo_it: 'Spediamo in 2 giorni.', testo_en: 'We ship in 2 days.', attiva: true }],
      [8, { id: 8, tipo: 'esempio_tono', titolo: 'Tono', testo_it: 'x', testo_en: 'x', attiva: true }]]) };
}
function sessione(st, extra = {}) {
  const id = randomUUID();
  st.sess.set(id, { id, stato: 'attesa_persona', preso_da: null, customer_email: 'cliente@gmail.com', customer_name: 'Cliente', shopify_customer_id: null, lingua: 'it',
    prova: false, passaggi: 1, gmail_thread_id: null, cs_conversation_id: null, created_at: isoT(st.ora - 3600000), ultima_attivita_at: isoT(st.ora - 3600000),
    ultima_risposta_staff_at: null, chiusa_at: null, ...extra });
  return id;
}
function inserisciMsg(st, r) {
  if (!st.sess.has(r.sessione_id)) throw new Error('23503');
  if ([...st.msg.values()].some((m) => m.send_key && m.send_key === r.send_key)) return null;
  const n = [...r.testo].length;
  if (n < 1 || n > 4000) throw new Error('23514 testo');
  if ((r.autore === 'staff') !== (r.staff_nome != null) || (r.staff_nome && !['Benedetta', 'Ginevra', 'Ale'].includes(r.staff_nome))) throw new Error('23514 staff');
  const m = { id: randomUUID(), seq: ++st.seq, client_msg_id: null, send_key: null, fonte: null, delivered_at: null, email_stato: null, email_at: null, email_gmail_id: null, email_errore: null, created_at: isoT(st.ora), ...r };
  st.msg.set(m.id, m);
  return m;
}
function controllaMsg(m) {
  if (m.email_stato !== null && !(['prenotata', 'inviata', 'errore'].includes(m.email_stato) && m.autore === 'staff' && m.email_at)) throw new Error('23514 email_stato');
  if (m.email_stato === 'inviata' && !m.email_gmail_id) throw new Error('23514 inviata');
  if (m.email_stato === 'errore' && !m.email_errore) throw new Error('23514 errore');
  if (m.email_errore && (m.email_errore.length < 1 || m.email_errore.length > 200)) throw new Error('23514 lunghezza errore');
}
function evento(st, r, chi) {
  if (!/^[a-z][a-z0-9_]{1,47}$/.test(r.tipo)) throw new Error('23514 tipo');
  if (JSON.stringify(r.dettaglio ?? {}).includes('@') || String(r.esito ?? '').includes('@') || String(chi ?? r.chi ?? '').includes('@')) throw new Error('23514 @ in chat_eventi');
  if (r.chiave != null && (!/^[a-z0-9][a-z0-9_:.-]*$/.test(r.chiave) || st.eventi.some((e) => e.chiave === r.chiave))) throw new Error('23505/23514 chiave');
  st.eventi.push({ chiave: null, ...r, chi: chi ?? r.chi, at: isoT(st.ora) });
}
const copia = (x) => (x ? structuredClone(x) : null);
function dbSend(st) {
  const rotto = (k) => { if (st.rotto[k]) throw new S.ErroreDb(k); };
  return {
    async revocata(sid) { rotto('revoca'); return st.eventi.some((e) => e.sessione_id === sid && e.tipo === 'staff_revoca'); },
    async pinOk(pin) { return sha(pin) === st.pinHash; },
    async messaggio(id) { return copia(st.msg.get(id)); },
    async inCoda(prima, lim) { rotto('coda'); return [...st.msg.values()].filter((m) => m.autore === 'staff' && m.email_stato === null && m.created_at < prima).sort((a, b) => a.created_at.localeCompare(b.created_at) || a.seq - b.seq).slice(0, lim).map(copia); },
    async prenotateScadute(prima, lim) { return [...st.msg.values()].filter((m) => m.autore === 'staff' && m.email_stato === 'prenotata' && m.email_at < prima).slice(0, lim).map(copia); },
    async sessione(id) { return copia(st.sess.get(id)); },
    async prenota(id, ora) { const m = st.msg.get(id); if (!m || m.autore !== 'staff' || m.email_stato !== null) return false; m.email_stato = 'prenotata'; m.email_at = ora; controllaMsg(m); return true; },
    async rilascia(id) { const m = st.msg.get(id); if (m && m.email_stato === 'prenotata') { m.email_stato = null; m.email_at = null; } },
    async esito(id, patch, da, emailAt) {
      const m = st.msg.get(id);
      if (!m || (da === null ? m.email_stato !== null : m.email_stato !== da) || (emailAt && m.email_at !== emailAt)) return false;
      const prova = { ...m, ...patch };
      controllaMsg(prova);
      Object.assign(m, patch);
      return true;
    },
    async riservaThread(sid, chiave) { if (st.eventi.some((e) => e.chiave === chiave)) return false; evento(st, { sessione_id: sid, tipo: 'thread_email', chiave, esito: 'prenotato', dettaglio: {} }, 'chat-send'); return true; },
    async riservaAt(chiave) { return st.eventi.find((e) => e.chiave === chiave)?.at ?? null; },
    async liberaThread(chiave) { st.eventi = st.eventi.filter((e) => !(e.chiave === chiave && e.tipo === 'thread_email' && e.esito === 'prenotato')); },
    async salvaThread(sid, tid, vecchio) {
      const s = st.sess.get(sid);
      if (!s || s.gmail_thread_id !== vecchio) return false;
      if ([...st.sess.values()].some((x) => x.gmail_thread_id === tid)) throw new Error('23505 thread');
      s.gmail_thread_id = tid;
      return true;
    },
    async creaRipresa(sid, hash, scade) { rotto('ripresa'); if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error('23514 hash'); st.token.push({ sessione_id: sid, tipo: 'ripresa', hash, scade_at: scade, revocato_at: null }); },
    async evento(r) { evento(st, { ...r, chiave: null }, 'chat-send'); },
    async conteggi(ora) {
      const t0 = Date.parse(ora);
      const v = [...st.msg.values()].filter((m) => m.autore === 'staff');
      return { errori: v.filter((m) => m.email_stato === 'errore' && Date.parse(m.email_at) > t0 - 86400000).length, coda: v.filter((m) => m.email_stato === null && Date.parse(m.created_at) < t0 - 600000).length };
    },
    async salute(g, n, sev, label) { st.salute = { g, n, sev, label }; },
  };
}
function gmailFinto() {
  const g = { chiamate: [], letture: [], status: 200, lancia: false, threads: new Map(), lettura: true, statoThread: null, n: 0 };
  g.api = {
    async thread(id) { g.letture.push(id); if (!g.lettura) return null; if (g.statoThread) return { status: g.statoThread, ultimo: null }; return { status: 200, ultimo: g.threads.get(id) ?? null }; },
    async invia(raw, threadId) {
      g.chiamate.push({ raw, threadId });
      if (g.lancia) throw new Error('rete');
      if (g.status !== 200) return { status: g.status, id: '', threadId: '' };
      if (g.senzaId) return { status: 200, id: '', threadId: '' };
      g.n++;
      const tid = threadId ?? 'a1b2c3d4e5f6' + g.n.toString(16).padStart(4, '0');
      g.threads.set(tid, { messageId: `<msg${g.n}@mail.gmail.com>`, references: '' });
      return { status: 200, id: '18f0' + g.n, threadId: tid };
    },
  };
  return g;
}
const casuale = (n) => new Uint8Array(randomBytes(n));
function ambSend(st, g, extra = {}) { return { ora: st.ora, servizio: SVC, db: dbSend(st), apriGmail: async () => { if (g.rotto) throw new Error('google'); return g.api; }, casuale, ...extra }; }
const reqSend = (body, bearer = SVC) => new Request('https://x.supabase.co/functions/v1/chat-send', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: 'Bearer ' + bearer } : {}) }, body: JSON.stringify(body) });
const callSend = async (st, g, body, bearer) => { const r = await S.gestisci(reqSend(body, bearer), ambSend(st, g)); return { status: r.status, j: await r.json() }; };
const decodifica = (raw) => {
  const mime = Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  const [testa, corpo] = mime.split('\r\n\r\n');
  return { testa, corpo: Buffer.from(corpo.replace(/\r\n/g, ''), 'base64').toString('utf8').replace(/\r\n/g, '\n') };
};
function staffMsg(st, sid, testo = 'Ciao, ecco la risposta.', extra = {}) { return inserisciMsg(st, { sessione_id: sid, autore: 'staff', staff_nome: 'Ginevra', testo, send_key: randomUUID(), ...extra }); }

// ================= chat-send =================
console.log('chat-send');
{
  const st = nuovoStore(), g = gmailFinto();
  const sid = sessione(st);
  const m = staffMsg(st, sid);
  t('S1 invia senza chiave = 401', (await callSend(st, g, { action: 'invia', messaggio_id: m.id }, null)).status === 401);
  t('S2 invia con una chiave sbagliata = 401', (await callSend(st, g, { action: 'invia', messaggio_id: m.id }, SVC + 'x')).status === 401);
  t('S3 invia col PIN e senza chiave = 401 (il PIN vale solo per il giro)', (await callSend(st, g, { action: 'invia', messaggio_id: m.id, pin: 'x' }, null)).status === 401);
  t('S4 giro con un PIN sbagliato = 401', (await callSend(st, g, { action: 'giro', pin: 'y' }, null)).status === 401);
  t('S5 azione sconosciuta = 400, messaggio_id non uuid = 422', (await callSend(st, g, { action: 'boh' })).status === 400 && (await callSend(st, g, { action: 'invia', messaggio_id: 'x' })).status === 422);
  t('S6 nessuna email partita dai rifiuti', g.chiamate.length === 0 && st.msg.get(m.id).email_stato === null);

  const r1 = await callSend(st, g, { action: 'invia', messaggio_id: m.id });
  const mm = st.msg.get(m.id);
  t('S7 invia: una email, messaggio `inviata` con l\'id Gmail', r1.j.esito === 'inviata' && g.chiamate.length === 1 && mm.email_stato === 'inviata' && mm.email_gmail_id === '18f01', r1);
  t('S8 prima email: nessun threadId, thread salvato sulla sessione', g.chiamate[0].threadId === null && st.sess.get(sid).gmail_thread_id === 'a1b2c3d4e5f60001');
  const { testa, corpo } = decodifica(g.chiamate[0].raw);
  t('S9 destinatario solo l\'email della sessione, nessun nome negli header', /^To: <cliente@gmail\.com>$/m.test(testa) && !/Cliente/.test(testa) && (testa.match(/^To:/gm) ?? []).length === 1 && !/^(Cc|Bcc):/mi.test(testa));
  t('S10 oggetto della chat (UTF-8 codificato), senza Re: alla prima', /^Subject: =\?UTF-8\?B\?/m.test(testa) && Buffer.from(/Subject: =\?UTF-8\?B\?([^?]+)\?=/.exec(testa)[1], 'base64').toString() === 'La tua richiesta in chat - Amimì');
  const tok = /https:\/\/amimi\.it\/apps\/chat\/riprendi#t=([A-Za-z0-9_-]+)$/m.exec(corpo)?.[1] ?? '';
  const rip = st.token.find((x) => x.hash === sha(tok));
  t('S11 link "Continua la chat" col token dopo il #, 43 caratteri, nel DB solo lo SHA-256 (tipo ripresa, 30 giorni)', /^[A-Za-z0-9_-]{43}$/.test(tok) && rip?.tipo === 'ripresa' && Date.parse(rip.scade_at) === st.ora + 30 * 86400000 && !JSON.stringify(st.token).includes(tok));
  t('S12 il token di ripresa passa il TOKEN_RE di chat-api', new RegExp(/const TOKEN_RE = (\/.+\/);/.exec(CHATAPI)[1].slice(1, -1)).test(tok));
  t('S13 nel corpo il testo dello staff, il piede e nessun messaggio della cliente', corpo.startsWith('Ciao, ecco la risposta.\n\n--\nPuoi rispondere') && corpo.includes('Amimì Milano') && !corpo.includes('&prova=1'));
  t('S14 evento `email` inviata senza email ne\' testi', st.eventi.some((e) => e.tipo === 'email' && e.esito === 'inviata' && e.dettaglio.nuovo_thread === true));

  const r2 = await callSend(st, g, { action: 'invia', messaggio_id: m.id });
  t('S15 seconda chiamata sullo stesso messaggio: nessuna seconda email', r2.j.esito === 'gia_gestito' && g.chiamate.length === 1);

  const m2 = staffMsg(st, sid, 'Seconda risposta');
  g.threads.set('a1b2c3d4e5f60001', { messageId: '<cliente-risposta@gmail.com>', references: '<msg1@mail.gmail.com>' });
  await callSend(st, g, { action: 'invia', messaggio_id: m2.id });
  const d2 = decodifica(g.chiamate[1].raw);
  t('S16 seconda risposta nello stesso thread, con Re:, In-Reply-To e References dell\'ultimo messaggio', g.chiamate[1].threadId === 'a1b2c3d4e5f60001'
    && /^In-Reply-To: <cliente-risposta@gmail\.com>$/m.test(d2.testa) && /^References: <msg1@mail\.gmail\.com> <cliente-risposta@gmail\.com>$/m.test(d2.testa)
    && Buffer.from(/Subject: =\?UTF-8\?B\?([^?]+)\?=/.exec(d2.testa)[1], 'base64').toString() === 'Re: La tua richiesta in chat - Amimì');
  t('S17 ogni email ha un token di ripresa nuovo', st.token.length === 2 && st.token[0].hash !== st.token[1].hash);

  const m3 = staffMsg(st, sid, 'Terza');
  g.threads.set('a1b2c3d4e5f60001', { messageId: '<x@y>\r\nBcc: spia@evil.com', references: '<a@b> <c@d>\r\nBcc: x@evil.com bad' });
  await callSend(st, g, { action: 'invia', messaggio_id: m3.id });
  const d3 = decodifica(g.chiamate[2].raw);
  t('S18 header del thread con a capo o forma sbagliata: scartati, nessun Bcc', !/Bcc/i.test(d3.testa) && !/^In-Reply-To/m.test(d3.testa) && !/evil/.test(d3.testa));
  t('S19 intestazioniPulite tiene solo gli id validi', JSON.stringify(S.intestazioniPulite({ messageId: '<ok@x>', references: '<a@b> rotto <c@d>\nBcc:' })) === JSON.stringify({ inReplyTo: '<ok@x>', references: '<a@b> <c@d> <ok@x>' }));

  g.statoThread = 404;
  const m4 = staffMsg(st, sid, 'Quarta');
  await callSend(st, g, { action: 'invia', messaggio_id: m4.id });
  t('S20 thread cancellato in Gmail (404): se ne apre uno nuovo e la sessione lo salva al posto del vecchio', g.chiamate[3].threadId === null && st.sess.get(sid).gmail_thread_id === 'a1b2c3d4e5f60004');
  g.statoThread = 500;
  const m5 = staffMsg(st, sid, 'Quinta');
  const r5 = await callSend(st, g, { action: 'invia', messaggio_id: m5.id });
  t('S21 thread non leggibile (500): nessuna email, messaggio ancora in coda', r5.j.esito === 'thread_non_leggibile' && g.chiamate.length === 4 && st.msg.get(m5.id).email_stato === null);
  g.statoThread = null; g.lettura = false;
  await callSend(st, g, { action: 'invia', messaggio_id: m5.id });
  const d5 = decodifica(g.chiamate[4].raw);
  t('S22 senza scope di lettura: risposta nel thread senza In-Reply-To', g.chiamate[4].threadId === 'a1b2c3d4e5f60004' && !/In-Reply-To/.test(d5.testa));
}
{
  // destinatari
  const st = nuovoStore(), g = gmailFinto();
  const casi = [
    ['prova-chat@example.com', true, 'destinatario su un dominio riservato'],
    ['x@test', false, 'destinatario non valido'],
    ['x@sito.test', false, 'destinatario su un dominio riservato'],
    ['cliente@gmail.com', true, 'chat di prova: solo indirizzi del team'],
    ['info@amimi.it', false, 'destinatario del team su una chat vera'],
    ['a@b.it,c@d.it', false, 'destinatario non valido'],
    ['a@b.it\nBcc: c@d.it', false, 'destinatario non valido'],
    ['info@amimi.it(x)', false, 'destinatario non valido'],
    ['cliente@gmail.com(info@amimi.it)', true, 'destinatario non valido'],
  ];
  for (const [email, prova, causa] of casi) {
    const sid = sessione(st, { customer_email: email, prova });
    const m = staffMsg(st, sid);
    const r = await callSend(st, g, { action: 'invia', messaggio_id: m.id });
    const mm = st.msg.get(m.id);
    t(`S23 ${JSON.stringify(email)} prova=${prova}: errore "${causa}" senza Gmail`, r.j.esito === 'errore' && mm.email_stato === 'errore' && mm.email_errore === causa && g.chiamate.length === 0, mm);
  }
  const sid = sessione(st, { customer_email: 'info@amimi.it', prova: true, lingua: 'en' });
  const m = staffMsg(st, sid);
  await callSend(st, g, { action: 'invia', messaggio_id: m.id });
  const d = decodifica(g.chiamate[0].raw);
  t('S24 chat di prova verso info@amimi.it: parte, in inglese, link con &prova=1', g.chiamate.length === 1 && /^To: <info@amimi\.it>$/m.test(d.testa) && d.corpo.includes('You can reply') && /#t=[A-Za-z0-9_-]{43}&prova=1$/m.test(d.corpo));
  t('S25 nessuna @ nei messaggi d\'errore salvati', [...st.msg.values()].every((x) => !String(x.email_errore ?? '').includes('@')));
}
{
  // Gmail che rifiuta, rete, Google irraggiungibile, prenotazione del thread
  const st = nuovoStore(), g = gmailFinto();
  const sid = sessione(st);
  const m = staffMsg(st, sid);
  g.status = 500;
  const r = await callSend(st, g, { action: 'invia', messaggio_id: m.id });
  t('S26 Gmail 500: errore "non partita: gmail 500", prenotazione del thread liberata', r.j.esito === 'errore' && st.msg.get(m.id).email_errore === 'non partita: gmail 500' && !st.eventi.some((e) => e.tipo === 'thread_email'));
  const m2 = staffMsg(st, sid);
  g.status = 200; g.lancia = true;
  await callSend(st, g, { action: 'invia', messaggio_id: m2.id });
  t('S27 Gmail senza risposta: "esito ignoto", mai rimandata', st.msg.get(m2.id).email_errore === 'esito ignoto: Gmail non ha risposto');
  g.lancia = false; g.rotto = true;
  const m3 = staffMsg(st, sid);
  const r3 = await callSend(st, g, { action: 'invia', messaggio_id: m3.id });
  t('S28 token Google non ottenuto: messaggio non toccato (resta in coda)', r3.j.esito === 'gmail_non_disponibile' && st.msg.get(m3.id).email_stato === null);
  g.rotto = false;
  // dopo un esito ignoto la prenotazione del thread resta (Gmail potrebbe averlo aperto): gli altri aspettano 15 minuti
  t('S28b esito ignoto: la prenotazione del thread resta', st.eventi.some((e) => e.chiave === `${sid}:thread:primo`));
  const r4 = await callSend(st, g, { action: 'invia', messaggio_id: m3.id });
  t('S29 thread prenotato da un altro invio da meno di 15 minuti: nessuna email, prenotazione del messaggio rilasciata', r4.j.esito === 'in_attesa_thread' && st.msg.get(m3.id).email_stato === null && g.chiamate.length === 2);
  st.ora += 16 * 60000;
  const r5 = await callSend(st, g, { action: 'invia', messaggio_id: m3.id });
  t('S30 prenotazione del thread ferma da oltre 15 minuti: si apre lo stesso', r5.j.esito === 'inviata' && st.sess.get(sid).gmail_thread_id !== null);
  st.rotto.ripresa = true;
  const m6 = staffMsg(st, sid);
  const r6 = await callSend(st, g, { action: 'invia', messaggio_id: m6.id });
  t('S31 token di ripresa non salvato: riprova, messaggio rilasciato, nessuna email', r6.j.esito === 'riprova' && st.msg.get(m6.id).email_stato === null && g.chiamate.length === 3);
  st.rotto.ripresa = false;
}
{
  // giro
  const st = nuovoStore(), g = gmailFinto();
  const sid = sessione(st);
  const m = staffMsg(st, sid);
  st.ora += 3 * 60000;
  t('S32 il giro non legge chat_sito_enabled: gira anche a chat spenta (finisce consegne avviate da una persona, Gate 2 B3)', !/chat_sito_enabled'/.test(SEND.replace(/^\s*\/\/.*$/gm, '')));
  const giovane = staffMsg(st, sid, 'appena scritto');
  const vecchia = staffMsg(st, sid, 'prenotata e persa');
  st.msg.get(vecchia.id).email_stato = 'prenotata'; st.msg.get(vecchia.id).email_at = isoT(st.ora - 16 * 60000);
  const r1 = await callSend(st, g, { action: 'giro', pin: 'x' }, null);
  t('S33 giro: manda il messaggio fermo da oltre 2 minuti, lascia quello appena scritto', r1.j.inviata === 1 && st.msg.get(m.id).email_stato === 'inviata' && st.msg.get(giovane.id).email_stato === null, r1.j);
  t('S34 giro: prenotata da oltre 15 minuti = errore "esito ignoto", mai rimandata', st.msg.get(vecchia.id).email_errore === 'esito ignoto: prenotazione scaduta' && g.chiamate.length === 1);
  t('S35 giro: riga health_log chat_send in errore (una email non partita nelle 24 ore), solo conteggi', st.salute?.sev === 'error' && /^chat-send send-1: 1 inviate/.test(st.salute.label) && !/@/.test(st.salute.label), st.salute);
  for (let i = 0; i < S.GIRO_MAX + 3; i++) staffMsg(st, sid, 'm' + i);
  st.ora += 3 * 60000;
  const r2 = await callSend(st, g, { action: 'giro' });
  t(`S36 giro: al massimo ${S.GIRO_MAX} email, oltre = avviso (anche con la chiave di servizio)`, r2.j.inviata === S.GIRO_MAX && /coda oltre 20/.test(st.salute.label), r2.j);
  st.rotto.coda = true;
  const prima = g.chiamate.length;
  t('S37 coda illeggibile: 503, nessuna email', (await callSend(st, g, { action: 'giro', pin: 'x' }, null)).status === 503 && g.chiamate.length === prima);
}

// ================= chat-staff =================
console.log('chat-staff');
function dbStaff(st) {
  const rotto = (k) => { if (st.rotto[k]) throw new F.ErroreDb(k); };
  const sessPub = (s) => s && ({ id: s.id, stato: s.stato, preso_da: s.preso_da, customer_email: s.customer_email, shopify_customer_id: s.shopify_customer_id, prova: s.prova,
    gmail_thread_id: s.gmail_thread_id, cs_conversation_id: s.cs_conversation_id, created_at: s.created_at, ultima_attivita_at: s.ultima_attivita_at });
  const msgPub = (m) => m && ({ id: m.id, sessione_id: m.sessione_id, seq: m.seq, autore: m.autore, email_stato: m.email_stato, email_errore: m.email_errore });
  return {
    async utente(tok) { return st.utenti[tok] ?? null; },
    async sessione(id) { rotto('sessione'); return copia(sessPub(st.sess.get(id))); },
    async sessioniPerEmail(e, lim) { return [...st.sess.values()].filter((s) => s.customer_email === e).slice(0, lim).map(sessPub); },
    async inserisciStaff(r) { return msgPub(inserisciMsg(st, r)); },
    async messaggioPerSendKey(k) { return copia(msgPub([...st.msg.values()].find((m) => m.send_key === k))); },
    async messaggio(id) { return copia(msgPub(st.msg.get(id))); },
    async aggiornaSessione(id, patch) {
      const s = st.sess.get(id);
      if (!s || s.stato === 'chiusa') return null;
      const n = { ...s, ...patch };
      if (n.stato === 'aperta' && !n.preso_da) throw new Error('23514 aperta');
      if ((n.stato === 'chiusa') !== (n.chiusa_at != null)) throw new Error('23514 chiusa');
      Object.assign(s, patch);
      return sessPub(s);
    },
    async rimettiInCoda(id, err) { const m = st.msg.get(id); if (!m || m.email_stato !== 'errore' || m.email_errore !== err) return false; Object.assign(m, { email_stato: null, email_at: null, email_errore: null }); return true; },
    async revocaToken(sid, ora) { let n = 0; for (const x of st.token) if (x.sessione_id === sid && !x.revocato_at) { x.revocato_at = ora; n++; } return n; },
    async contaMessaggi(sid) { return [...st.msg.values()].filter((m) => m.sessione_id === sid).length; },
    async proiezioni(s) { return [...new Set([...[...st.cs.values()].filter((c) => c.gmail_thread_id === `chat:${s.id}`).map((c) => c.id), ...(s.cs_conversation_id ? [s.cs_conversation_id] : [])])]; },
    async cardEmail(tid) { return [...st.cs.values()].find((c) => c.gmail_thread_id === tid)?.id ?? null; },
    // staff-3 (Gate 2 del pezzo 6, B1): come l'RPC chat_cancella_sessione, tutto o niente in una transazione
    async cancellaTutto(id, card) {
      rotto('cs'); rotto('push');
      const s = st.sess.get(id);
      if (!s) return { esito: 'assente', messaggi: 0, proiezioni: 0, card_email: 0, contatori: 0, eventi: 0, push: 0 };
      const r = { esito: 'cancellata', messaggi: [...st.msg.values()].filter((m) => m.sessione_id === id).length, proiezioni: 0, card_email: 0, contatori: 0, eventi: 0, push: 0 };
      for (const [k, c] of [...st.cs]) if (c.id === s.cs_conversation_id || c.gmail_thread_id === `chat:${id}`) { st.cs.delete(k); r.proiezioni++; }
      if (card && s.gmail_thread_id) for (const [k, c] of [...st.cs]) if (c.id === card && c.gmail_thread_id === s.gmail_thread_id) { st.cs.delete(k); r.card_email++; }
      for (const k of [...st.cont.keys()]) if (k.startsWith(`sess:${id}:`)) { st.cont.delete(k); r.contatori++; }
      const ne = st.eventi.length; st.eventi = st.eventi.filter((e) => !(e.chiave && e.chiave.startsWith(id + ':'))); r.eventi = ne - st.eventi.length;
      const np = st.push.length; st.push = st.push.filter((x) => !(['chat_sollecito', 'chat_sollecito_scala', 'chat_salute'].includes(x.evento) && x.chiave.startsWith(id + ':'))); r.push = np - st.push.length;
      st.sess.delete(id);
      for (const [k, m] of st.msg) if (m.sessione_id === id) st.msg.delete(k);
      st.token = st.token.filter((x) => x.sessione_id !== id);
      for (const e of st.eventi) if (e.sessione_id === id) e.sessione_id = null;
      return r;
    },
    async evento(r) { evento(st, r); },
    // staff-3: proiezione (RPC chat_proietta), scheda Chat e conoscenza dei bottoni
    async proietta(sid) { rotto('proietta'); st.proiezioni.push(sid); },
    async flag(chiavi) { rotto('flag'); return Object.fromEntries(chiavi.filter((k) => st.flags.has(k)).map((k) => [k, st.flags.get(k)])); },
    async scriviFlag(k, v) { rotto('scriviFlag'); if (!st.flags.has(k)) return false; st.flags.set(k, v); return true; },
    async faqRighe(ids) { return ids.filter((i) => st.faq.has(i)).map((i) => copia(st.faq.get(i))); },
    async aggiornaFaq(id, patch) { const f = st.faq.get(id); if (!f || !['faq', 'risposta_standard', 'risposta_chat'].includes(f.tipo)) return false; Object.assign(f, patch); return true; },
  };
}
function ambStaff(st, g) {
  return { ora: st.ora, db: dbStaff(st), invio: async (id) => { st.invii = (st.invii ?? 0) + 1; const r = await S.gestisci(reqSend({ action: 'invia', messaggio_id: id }), ambSend(st, g)); return (await r.json()).esito ?? 'in_coda'; } };
}
const reqStaff = (body, bearer = 'jwt-team') => new Request('https://x.supabase.co/functions/v1/chat-staff', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: 'Bearer ' + bearer } : {}) }, body: JSON.stringify(body) });
const callStaff = async (st, g, body, bearer) => { const r = await F.gestisci(reqStaff(body, bearer), ambStaff(st, g)); return { status: r.status, j: await r.json(), h: r.headers }; };
{
  const st = nuovoStore(), g = gmailFinto();
  const sid = sessione(st);
  const corpo = { action: 'rispondi', sessione_id: sid, testo: 'Buongiorno, ecco.', chi: 'G', send_key: randomUUID() };
  t('F1 senza Bearer = 401', (await callStaff(st, g, corpo, null)).status === 401);
  t('F2 token non valido (getUser fallisce) = 401', (await callStaff(st, g, corpo, 'jwt-falso')).status === 401);
  t('F3 utente fuori dal team = 403', (await callStaff(st, g, corpo, 'jwt-fuori')).status === 403);
  t('F4 chi sconosciuto = 422', (await callStaff(st, g, { ...corpo, chi: 'X' })).status === 422);
  t('F5 campo sconosciuto = 422, azione sconosciuta = 400', (await callStaff(st, g, { ...corpo, altro: 1 })).status === 422 && (await callStaff(st, g, { action: 'cs' })).status === 400);
  t('F6 testo vuoto o oltre 4000 = 422', (await callStaff(st, g, { ...corpo, testo: '  ' })).status === 422 && (await callStaff(st, g, { ...corpo, testo: 'a'.repeat(4001) })).status === 422);
  t('F7 nessuna scrittura dai rifiuti', st.msg.size === 0 && g.chiamate.length === 0);
  const r = await callStaff(st, g, corpo);
  const s = st.sess.get(sid);
  t('F8 rispondi: messaggio staff, chat aperta presa da Ginevra, ultima risposta e attivita\' aggiornate', r.j.ok && r.j.stato === 'aperta' && s.stato === 'aperta' && s.preso_da === 'Ginevra'
    && s.ultima_risposta_staff_at === isoT(st.ora) && s.ultima_attivita_at === isoT(st.ora) && [...st.msg.values()][0].staff_nome === 'Ginevra', r.j);
  t('F9 rispondi manda SUBITO l\'email (D-8) e la risposta lo dice', r.j.email === 'inviata' && g.chiamate.length === 1);
  t('F10 email non verificata (nessuna cliente Shopify loggata) segnalata al compositore', r.j.email_verificata === false);
  t('F11 CORS per la PWA e no-store', r.h.get('access-control-allow-origin') === '*' && r.h.get('cache-control') === 'no-store');
  const r2 = await callStaff(st, g, corpo);
  t('F12 stesso send_key: nessun messaggio ne\' email in piu\'', r2.j.ripetuta === true && st.msg.size === 1 && g.chiamate.length === 1 && r2.j.email === 'inviata');
  const altra = sessione(st);
  t('F13 send_key gia\' usato su un\'altra chat = 409', (await callStaff(st, g, { ...corpo, sessione_id: altra })).status === 409);
  t('F14 audit in chat_eventi senza testi ne\' email', st.eventi.some((e) => e.tipo === 'staff_rispondi' && e.chi === 'Ginevra' && e.esito === 'inviata') && !JSON.stringify(st.eventi).includes('Buongiorno'));
  t('F15 prendo_io: aperta, preso_da = chi', (await callStaff(st, g, { action: 'prendo_io', sessione_id: altra, chi: 'b' })).j.stato === 'aperta' && st.sess.get(altra).preso_da === 'Benedetta');
  const c1 = await callStaff(st, g, { action: 'chiudi', sessione_id: sid, chi: 'A' });
  t('F16 chiudi: chiusa con chiusa_at; di nuovo = gia\' chiusa', c1.j.stato === 'chiusa' && st.sess.get(sid).chiusa_at === isoT(st.ora) && (await callStaff(st, g, { action: 'chiudi', sessione_id: sid, chi: 'A' })).j.gia_chiusa === true);
  t('F17 rispondi su una chat chiusa = 409, prendo_io pure', (await callStaff(st, g, { ...corpo, send_key: randomUUID() })).status === 409 && (await callStaff(st, g, { action: 'prendo_io', sessione_id: sid, chi: 'A' })).status === 409);
  st.token.push({ sessione_id: sid, tipo: 'chat', hash: sha('a'), revocato_at: null }, { sessione_id: sid, tipo: 'ripresa', hash: sha('b'), revocato_at: null });
  t('F18 revoca_accessi: tutti i token della sessione revocati', (await callStaff(st, g, { action: 'revoca_accessi', sessione_id: sid, chi: 'A' })).j.revocati === 3 && st.token.filter((x) => x.sessione_id === sid).every((x) => x.revocato_at));
  t('F19 sessione inesistente = 404; DB in errore = 503', (await callStaff(st, g, { action: 'chiudi', sessione_id: randomUUID(), chi: 'A' })).status === 404
    && await (async () => { st.rotto.sessione = true; const x = (await callStaff(st, g, { action: 'chiudi', sessione_id: sid, chi: 'A' })).status; st.rotto.sessione = false; return x === 503; })());
}
{
  // staff-3 (pezzo 6): proiezione in Assistenza dopo le azioni del team
  const st = nuovoStore(), g = gmailFinto();
  const sid = sessione(st);
  const r = await callStaff(st, g, { action: 'rispondi', sessione_id: sid, testo: 'Ciao', chi: 'G', send_key: randomUUID() });
  t('F33 rispondi proietta la chat in Assistenza dopo l\'email, e lo dice', r.j.ok && r.j.proiezione === true && st.proiezioni.length === 1 && st.proiezioni[0] === sid);
  const altra = sessione(st);
  const p = await callStaff(st, g, { action: 'prendo_io', sessione_id: altra, chi: 'B' });
  const c = await callStaff(st, g, { action: 'chiudi', sessione_id: altra, chi: 'A' });
  t('F34 prendo_io e chiudi proiettano; la chat chiusa e\' di chi l\'ha chiusa (7.8, Gate 2 C2)', p.j.proiezione === true && c.j.proiezione === true && st.proiezioni.length === 3 && st.sess.get(altra).preso_da === 'Ale');
  const terza = sessione(st);
  await callStaff(st, g, { action: 'chiudi', sessione_id: terza, chi: 'G' });
  t('F35 chiudi una chat di nessuno: preso_da = chi la chiude (la card chiusa dice chi)', st.sess.get(terza).preso_da === 'Ginevra' && st.sess.get(terza).stato === 'chiusa');
  st.rotto.proietta = true;
  const quarta = sessione(st);
  const r2 = await callStaff(st, g, { action: 'rispondi', sessione_id: quarta, testo: 'Ciao', chi: 'G', send_key: randomUUID() });
  st.rotto.proietta = false;
  t('F36 proiezione fallita: la risposta resta salvata e mandata, ok con proiezione false (la riprova il cron)', r2.status === 200 && r2.j.ok && r2.j.proiezione === false && r2.j.email === 'inviata'
    && [...st.msg.values()].some((m) => m.sessione_id === quarta));
  t('F37 chiudi gia\' chiusa e revoca non proiettano', await (async () => { const n = st.proiezioni.length; await callStaff(st, g, { action: 'chiudi', sessione_id: terza, chi: 'G' });
    await callStaff(st, g, { action: 'revoca_accessi', sessione_id: terza, chi: 'G' }); return st.proiezioni.length === n; })());
}
{
  // staff-3: la scheda Chat (sez. 10)
  const st = nuovoStore(), g = gmailFinto();
  const i = await callStaff(st, g, { action: 'impostazioni', chi: 'G' });
  t('F38 impostazioni: solo le chiavi della scheda (mai un segreto) e le righe di cs_faq dei bottoni', i.j.ok && i.j.valori.chat_sollecito_ore === '24,48' && !('cs_gmail_sa_key' in i.j.valori)
    && !JSON.stringify(i.j).includes('SEGRETO') && i.j.faq.length === 1 && i.j.faq[0].id === 7 && i.j.scrivibili.includes('chat_orari') && !i.j.scrivibili.includes('chat_sito_enabled'));
  const imp = (chiave, valore) => callStaff(st, g, { action: 'imposta', chiave, valore, chi: 'G' });
  const o = await imp('chat_orari', { tz: 'Europe/Rome', giorni: [5, 1, 2, 2], dalle: '09:30', alle: '17:00', chiusure: ['2026-12-25', '2026-12-24'] });
  t('F39 orari validi salvati in forma canonica (giorni ordinati e unici, chiusure ordinate)', o.j.ok && st.flags.get('chat_orari') === '{"tz":"Europe/Rome","giorni":[1,2,5],"dalle":"09:30","alle":"17:00","chiusure":["2026-12-24","2026-12-25"]}', o.j);
  const salvato = st.flags.get('chat_orari');
  const storti = [
    { tz: 'Europe/London', giorni: [1], dalle: '09:00', alle: '18:00', chiusure: [] }, { tz: 'Europe/Rome', giorni: [], dalle: '09:00', alle: '18:00', chiusure: [] },
    { tz: 'Europe/Rome', giorni: [8], dalle: '09:00', alle: '18:00', chiusure: [] }, { tz: 'Europe/Rome', giorni: [1.5], dalle: '09:00', alle: '18:00', chiusure: [] },
    { tz: 'Europe/Rome', giorni: [1], dalle: '18:00', alle: '09:00', chiusure: [] }, { tz: 'Europe/Rome', giorni: [1], dalle: '9:00', alle: '18:00', chiusure: [] },
    { tz: 'Europe/Rome', giorni: [1], dalle: '09:00', alle: '24:00', chiusure: [] }, { tz: 'Europe/Rome', giorni: [1], dalle: '09:00', alle: '18:00', chiusure: ['2026-02-30'] },
    { tz: 'Europe/Rome', giorni: [1], dalle: '09:00', alle: '18:00', chiusure: [], altro: 1 }, '{"tz":"Europe/Rome"}', null, [1, 2],
  ];
  let tuttiRifiutati = true;
  for (const v of storti) { const x = await imp('chat_orari', v); if (x.status !== 422) tuttiRifiutati = false; }
  t('F40 orari storti rifiutati (fuso, giorni, ore, dalle >= alle, data inesistente, campo in piu\', stringa, array) senza scrivere (C7 del pezzo 4)', tuttiRifiutati && st.flags.get('chat_orari') === salvato);
  const s1 = await imp('chat_sollecito_ore', [24, 48]), s2 = await imp('chat_sollecito_ore', [0.05, 0.1]);
  t('F41 solleciti: due numeri crescenti fra 0,05 e 240, salvati come "a,b"', s1.j.invariato === true && s2.j.ok && st.flags.get('chat_sollecito_ore') === '0.05,0.1');
  let solleciti = true;
  for (const v of [[48, 24], [24, 24], [0.01, 1], [1, 241], [1.2345, 2], [1e-7, 2], ['24', '48'], [24], [1, 2, 3], '24,48', { a: 1 }]) { if ((await imp('chat_sollecito_ore', v)).status !== 422) solleciti = false; }
  t('F42 solleciti storti rifiutati (decrescenti, uguali, fuori intervallo, troppi decimali, stringhe, quantita\')', solleciti && st.flags.get('chat_sollecito_ore') === '0.05,0.1');
  const tx = await imp('chat_testo_attesa', { it: '  Ciao\r\n{email}\u202E ', en: 'Hi {email}' });
  t('F43 testo: pulito (a capo normalizzati, caratteri di direzione tolti) e salvato come {it, en}', tx.j.ok && st.flags.get('chat_testo_attesa') === '{"it":"Ciao\\n{email}","en":"Hi {email}"}', st.flags.get('chat_testo_attesa'));
  let testi = true;
  for (const v of [{ it: 'x' }, { it: 'x', en: '' }, { it: 'x'.repeat(1001), en: 'y' }, { it: 'x', en: 'y', fr: 'z' }, { it: 1, en: 'y' }, 'testo']) { if ((await imp('chat_testo_saluto', v)).status !== 422) testi = false; }
  t('F44 testi storti rifiutati (lingua mancante, vuoto, oltre 1000, lingua in piu\', tipo)', testi);
  const nonAmmesse = await Promise.all(['chat_sito_enabled', 'cs_gmail_sa_key', 'chat_bottoni', 'chat_testo_informativa', 'chat_limite_chat_giorno'].map((k) => imp(k, { it: 'x', en: 'y' })));
  t('F45 chiavi fuori dalla scheda (interruttore, segreti, bottoni, informativa, tetti) = 422 e nessuna scrittura', nonAmmesse.every((x) => x.status === 422 && x.j.error === 'chiave_non_ammessa')
    && st.flags.get('chat_sito_enabled') === 'false' && st.flags.get('cs_gmail_sa_key') === 'SEGRETO-CHE-NON-DEVE-USCIRE');
  t('F46 audit staff_imposta con le impronte, mai il testo', st.eventi.filter((e) => e.tipo === 'staff_imposta').length === 3 && !JSON.stringify(st.eventi).includes('Ciao')
    && st.eventi.filter((e) => e.tipo === 'staff_imposta').every((e) => /^[0-9a-f]{12}$/.test(e.dettaglio.prima) && /^[0-9a-f]{12}$/.test(e.dettaglio.dopo) && e.chi === 'Ginevra'));
  const k1 = await callStaff(st, g, { action: 'conoscenza_testo', faq_id: 7, testo_it: 'Spediamo in 1 giorno.', attiva: false, chi: 'G' });
  t('F47 conoscenza_testo: riga di un bottone aggiornata, audit coi soli campi', k1.j.ok && st.faq.get(7).testo_it === 'Spediamo in 1 giorno.' && st.faq.get(7).attiva === false && st.faq.get(7).testo_en === 'We ship in 2 days.'
    && st.eventi.some((e) => e.tipo === 'staff_conoscenza' && e.dettaglio.faq_id === 7 && JSON.stringify(e.dettaglio.campi) === '["attiva","testo_it"]'));
  const k2 = await callStaff(st, g, { action: 'conoscenza_testo', faq_id: 8, testo_it: 'x', chi: 'G' });
  const k3 = await callStaff(st, g, { action: 'conoscenza_testo', faq_id: 7, chi: 'G' });
  const k4 = await callStaff(st, g, { action: 'conoscenza_testo', faq_id: '7', testo_it: 'x', chi: 'G' });
  const k5 = await callStaff(st, g, { action: 'conoscenza_testo', faq_id: 7, testo_en: 'x'.repeat(4001), chi: 'G' });
  t('F48 conoscenza_testo rifiuta righe fuori dai bottoni, nessun campo, id non intero, testo oltre 4000', k2.status === 422 && k2.j.error === 'faq_non_dei_bottoni' && k3.status === 422 && k4.status === 422 && k5.status === 422
    && st.faq.get(8).testo_it === 'x' && st.faq.get(7).testo_en === 'We ship in 2 days.');
  st.flags.set('chat_bottoni', '[{"id":"tono","it":"T","en":"T","faq":8}]');
  const k6 = await callStaff(st, g, { action: 'conoscenza_testo', faq_id: 8, testo_it: 'y', chi: 'G' });
  t('F49 una riga di esempio di tono puntata per errore da un bottone non si scrive (404, come la legge chat-api)', k6.status === 404 && st.faq.get(8).testo_it === 'x');
  // staff-4 (pezzo 7, migr 0195): i bottoni puntano alle voci della sola chat (`risposta_chat`), e la scheda le cambia
  st.faq.set(30, { id: 30, tipo: 'risposta_chat', titolo: 'faq-costi-e-tempi-spedizione: Quanto costa?', testo_it: 'Italia 3,90 EUR', testo_en: 'Italy EUR 3.90', attiva: true });
  st.flags.set('chat_bottoni', '[{"id":"spedizioni","it":"Spedizioni","en":"Shipping","faq":30}]');
  const imp30 = await callStaff(st, g, { action: 'impostazioni', chi: 'G' });
  const k7 = await callStaff(st, g, { action: 'conoscenza_testo', faq_id: 30, testo_en: 'Italy EUR 3.90, free over EUR 100', chi: 'G' });
  t('F49b una voce della sola chat puntata da un bottone: la scheda la mostra col suo tipo e conoscenza_testo la cambia (staff-4)', imp30.j.ok
    && imp30.j.faq.length === 1 && imp30.j.faq[0].id === 30 && imp30.j.faq[0].tipo === 'risposta_chat' && k7.j.ok && st.faq.get(30).testo_en === 'Italy EUR 3.90, free over EUR 100'
    && st.faq.get(30).testo_it === 'Italia 3,90 EUR' && st.faq.get(7).testo_en === 'We ship in 2 days.');
  t('F49c sul sorgente: l\'update di conoscenza_testo vale per faq, risposta_standard e risposta_chat, mai per esempio_tono',
    /from\('cs_faq'\)\.update\(patch\)\.eq\('id', id\)\.in\('tipo', \['faq', 'risposta_standard', 'risposta_chat'\]\)/.test(STAFF) && !/esempio_tono/.test(STAFF));
  st.rotto.flag = true;
  t('F50 impostazioni illeggibili = 503', (await callStaff(st, g, { action: 'impostazioni', chi: 'G' })).status === 503);
  st.rotto.flag = false;
}
{
  // reinvia
  const st = nuovoStore(), g = gmailFinto();
  const sid = sessione(st);
  g.status = 503;
  const r = await callStaff(st, g, { action: 'rispondi', sessione_id: sid, testo: 'x', chi: 'G', send_key: randomUUID() });
  t('F20 Gmail rifiuta: la risposta dice errore con la causa', r.j.email === 'errore' && r.j.email_errore === 'non partita: gmail 503');
  g.status = 200;
  const rr = await callStaff(st, g, { action: 'reinvia', messaggio_id: r.j.messaggio.id, chi: 'G' });
  t('F21 reinvia di una "non partita": parte', rr.j.email === 'inviata' && g.chiamate.filter((c) => c).length === 2);
  t('F22 reinvia di una gia\' inviata = 409', (await callStaff(st, g, { action: 'reinvia', messaggio_id: r.j.messaggio.id, chi: 'G' })).status === 409);
  const m = staffMsg(st, sid);
  Object.assign(st.msg.get(m.id), { email_stato: 'errore', email_errore: 'esito ignoto: Gmail non ha risposto', email_at: isoT(st.ora) });
  const ri = await callStaff(st, g, { action: 'reinvia', messaggio_id: m.id, chi: 'G' });
  t('F23 reinvia di un "esito ignoto" = 409, nessuna email', ri.status === 409 && ri.j.error === 'non_reinviabile' && g.chiamate.length === 2);
}
{
  // cancella_dati (test 21)
  const st = nuovoStore(), g = gmailFinto();
  const sid = sessione(st, { prova: true, customer_email: 'prova-chat@example.com', gmail_thread_id: 'abc123' });
  const altra = sessione(st, { customer_email: 'altra@gmail.com' });
  for (let i = 0; i < 5; i++) inserisciMsg(st, { sessione_id: sid, autore: 'cliente', testo: 'messaggio ' + i, client_msg_id: randomUUID() });
  inserisciMsg(st, { sessione_id: altra, autore: 'cliente', testo: 'resta', client_msg_id: randomUUID() });
  st.token.push({ sessione_id: sid, tipo: 'chat', hash: sha('t1'), revocato_at: null });
  st.cont.set(`sess:${sid}:msg`, 5); st.cont.set(`sess:${altra}:msg`, 1); st.cont.set('glob:chat_giorno', 2);
  evento(st, { sessione_id: sid, tipo: 'push_passaggio', chiave: `${sid}:passaggio:1`, esito: 'nessun_iscritto', dettaglio: { n: 1 } });
  st.cs.set('cs-proiezione', { id: 'cs-proiezione', gmail_thread_id: `chat:${sid}` });
  st.cs.set('cs-card', { id: 'cs-card', gmail_thread_id: 'abc123' });
  // staff-2 (pezzo 4): registro delle push della chat con la chiave della sessione, piu' righe che devono restare
  st.push.push({ evento: 'chat_sollecito', chiave: `${sid}:1:sollecito:1` }, { evento: 'chat_sollecito', chiave: `${sid}:passaggio:1` },
    { evento: 'chat_sollecito_scala', chiave: `${sid}:1:sollecito:2` }, { evento: 'chat_salute', chiave: `${sid}:1:passaggio` },
    { evento: 'chat_salute', chiave: `api:2026-11-09` }, { evento: 'chat_sollecito', chiave: `${altra}:1:sollecito:1` }, { evento: 'cs_urgente', chiave: `${sid}:urgente` });
  const a = await callStaff(st, g, { action: 'cancella_dati', sessione_id: sid, chi: 'A' });
  t('F24 senza conferma: anteprima (messaggi, proiezione, card) e nessuna cancellazione', a.j.anteprima === true && a.j.sessioni[0].messaggi === 5 && a.j.sessioni[0].proiezioni === 1 && a.j.sessioni[0].card_email === true && st.sess.has(sid) && st.cs.size === 2, a.j);
  t('F25 l\'anteprima non ripete email ne\' testi', !JSON.stringify(a.j).includes('example.com') && !JSON.stringify(a.j).includes('messaggio 0'));
  t('F26 sessione_id ed email insieme = 422; conferma non booleana = 422', (await callStaff(st, g, { action: 'cancella_dati', sessione_id: sid, email: 'a@b.it', chi: 'A' })).status === 422
    && (await callStaff(st, g, { action: 'cancella_dati', sessione_id: sid, conferma: 'si', chi: 'A' })).status === 422);
  const c = await callStaff(st, g, { action: 'cancella_dati', sessione_id: sid, conferma: true, chi: 'A' });
  t('F27 con conferma: sessione, messaggi, token, contatori della sessione e proiezione cancellati', c.j.ok && !st.sess.has(sid) && ![...st.msg.values()].some((m) => m.sessione_id === sid)
    && !st.token.some((x) => x.sessione_id === sid) && !st.cont.has(`sess:${sid}:msg`) && !st.cs.has('cs-proiezione'), c.j);
  t('F28 senza con_card_email la card email del thread resta; il resto (altra chat, contatori globali) intatto', st.cs.has('cs-card') && st.sess.has(altra) && st.cont.has(`sess:${altra}:msg`) && st.cont.has('glob:chat_giorno'));
  t('F29 nessuna riga resta con quella email in chat_; gli eventi con la chiave della sessione cancellati, gli altri senza sessione e senza @ (Gate 2, C2)', ![...st.sess.values()].some((s) => s.customer_email === 'prova-chat@example.com')
    && !st.eventi.some((e) => String(e.chiave ?? '').startsWith(sid)) && !st.eventi.some((e) => e.sessione_id === sid) && !JSON.stringify(st.eventi).includes('@') && c.j.cancellate.eventi === 1);
  t('F30 audit cancella_dati con i soli conteggi', st.eventi.some((e) => e.tipo === 'cancella_dati' && e.esito === 'fatto' && e.sessione_id === null && e.dettaglio.sessioni === 1 && e.dettaglio.messaggi === 5 && e.dettaglio.proiezioni === 1 && e.dettaglio.push === 4));
  t('F30b staff-2 (11.6 punto 4): via le 4 righe del registro delle push della chat con la chiave della sessione; restano quelle di altre chat, quelle per giorno e quelle di altri eventi',
    c.j.cancellate.push === 4 && JSON.stringify(st.push.map((r) => r.chiave).sort()) === JSON.stringify([`${altra}:1:sollecito:1`, `${sid}:urgente`, 'api:2026-11-09'].sort()), st.push);
  // per email, con la card
  const s2 = sessione(st, { customer_email: 'altra@gmail.com', gmail_thread_id: 'def456' });
  st.cs.set('cs-card2', { id: 'cs-card2', gmail_thread_id: 'def456' });
  const pe = await callStaff(st, g, { action: 'cancella_dati', email: ' Altra@Gmail.com ', conferma: true, con_card_email: true, chi: 'A' });
  t('F31 per email (normalizzata): tutte le chat di quell\'indirizzo e, se chiesto, la card email', pe.j.cancellate?.sessioni === 2 && pe.j.cancellate.card_email === 1 && !st.sess.has(s2) && !st.cs.has('cs-card2') && st.cs.has('cs-card'), pe.j);
  const s3 = sessione(st, { customer_email: 'z@gmail.com' });
  st.cs.set('cs-p3', { id: 'cs-p3', gmail_thread_id: `chat:${s3}` });
  st.rotto.cs = true;
  const rotta = await callStaff(st, g, { action: 'cancella_dati', sessione_id: s3, conferma: true, chi: 'A' });
  t('F32 cs_ non cancellabile: 503 e la sessione resta (si puo\' ripetere)', rotta.status === 503 && st.sess.has(s3) && st.eventi.some((e) => e.tipo === 'cancella_dati' && e.esito === 'parziale'));
  st.rotto.cs = false; st.rotto.push = true;
  const rottaP = await callStaff(st, g, { action: 'cancella_dati', sessione_id: s3, conferma: true, chi: 'A' });
  t('F32b staff-2: registro delle push non cancellabile: 503 e la sessione resta (si puo\' ripetere)', rottaP.status === 503 && st.sess.has(s3) && rottaP.j.causa === 'push' && rottaP.j.fatte.push === 0, rottaP.j);
}

// ---- Gate 2: B1, C5, B2 (usano anche chat-staff) ----
{
  // Gate 2, B1: Gmail risponde 2xx ma senza id leggibile = esito ignoto, mai rimandabile, thread prenotato tenuto
  const st = nuovoStore(), g = gmailFinto();
  const sid = sessione(st);
  const m = staffMsg(st, sid);
  g.senzaId = true;
  const r = await callSend(st, g, { action: 'invia', messaggio_id: m.id });
  t('S39 2xx senza id: errore "esito ignoto", prenotazione del thread tenuta', r.j.esito === 'errore' && st.msg.get(m.id).email_errore === 'esito ignoto: risposta di Gmail illeggibile'
    && st.eventi.some((e) => e.chiave === `${sid}:thread:primo`), st.msg.get(m.id));
  g.senzaId = false;
  const ri = await callStaff(st, g, { action: 'reinvia', messaggio_id: m.id, chi: 'G' });
  t('S40 2xx senza id: reinvia = 409, nessuna seconda email', ri.status === 409 && g.chiamate.length === 1);
  // Gate 2, C5: thread illeggibile per un 4xx diverso da 404 = errore reinviabile, non coda infinita
  const sid2 = sessione(st, { gmail_thread_id: 'ffff0001' });
  const m2 = staffMsg(st, sid2);
  g.statoThread = 403;
  const r2 = await callSend(st, g, { action: 'invia', messaggio_id: m2.id });
  t('S41 thread 403: errore "non partita: thread gmail 403" senza Gmail', r2.j.esito === 'errore' && st.msg.get(m2.id).email_errore === 'non partita: thread gmail 403' && g.chiamate.length === 1);
  g.statoThread = null;
  // Gate 2, B2: dopo revoca_accessi l'email parte senza link e senza token nuovo
  const sid3 = sessione(st);
  await callStaff(st, g, { action: 'revoca_accessi', sessione_id: sid3, chi: 'A' });
  const tokenPrima = st.token.length;
  const rr = await callStaff(st, g, { action: 'rispondi', sessione_id: sid3, testo: 'Dopo la revoca', chi: 'A', send_key: randomUUID() });
  const d = decodifica(g.chiamate[g.chiamate.length - 1].raw);
  t('S42 dopo revoca_accessi: email senza "Continua la chat" e nessun token di ripresa nuovo', rr.j.email === 'inviata' && !/riprendi/.test(d.corpo) && d.corpo.includes('Per rispondere scrivi a questa email.') && st.token.length === tokenPrima, d.corpo);
  st.rotto.revoca = true;
  const m4 = staffMsg(st, sid3);
  const r4 = await callSend(st, g, { action: 'invia', messaggio_id: m4.id });
  t('S43 revoca non leggibile: riprova, nessuna email, messaggio in coda', r4.j.esito === 'riprova' && st.msg.get(m4.id).email_stato === null);
}

// ================= guardie sul sorgente =================
console.log('guardie');
function corpoDi(src, nome) {
  const r = new RegExp(`^(?:async )?function ${nome}\\(|^const ${nome} = `, 'm').exec(src);
  if (!r) return null;
  const da = r.index;
  const riga = src.slice(da, src.indexOf('\n', da));
  if (riga.startsWith('const') && !riga.trimEnd().endsWith('{')) return riga;
  const fine = src.indexOf('\n}', da);
  return src.slice(da, src.indexOf('\n', fine + 1));
}
for (const n of ['b64url', 'pemToPkcs8', 'googleAccessTokenFor', 'b64', 'wrap76', 'encHdr']) {
  const a = corpoDi(blocco(SEND, 'chat-send-gmail'), n), b = corpoDi(CSSEND, n);
  t(`G1 ${n}: copia identica a cs-send (impronta)`, a !== null && a === b, [a?.slice(0, 60), b?.slice(0, 60)]);
}
for (const c of ['GMAIL_USER', 'GMAIL', 'TOKEN_URL', 'SCOPE_SEND', 'SCOPE_READ']) {
  const re = new RegExp(`^const ${c} = .*$`, 'm');
  t(`G2 ${c} uguale a cs-send`, re.exec(blocco(SEND, 'chat-send-gmail'))?.[0] === re.exec(CSSEND)?.[0]);
}
t('G3 config.toml: verify_jwt = false per chat-staff e chat-send', /\[functions\.chat-staff\]\nverify_jwt = false/.test(CONFIG) && /\[functions\.chat-send\]\nverify_jwt = false/.test(CONFIG));
for (const [nome, src] of [['chat-staff', STAFF], ['chat-send', SEND]]) {
  t(`G4 ${nome}: nessuna chiamata a write-api, nessun change_log, nessun ask_select`, !/write-api|change_log|ask_select/.test(src.replace(/^\s*\/\/.*$/gm, '')));
  const logs = [...src.matchAll(/console\.(log|error|warn|info)\(([^;]*)\);/g)].map((m) => m[2]);
  t(`G5 ${nome}: i log stampano solo cause fisse e codici (${logs.length})`, logs.every((a) => /^'chat-(staff|send): [^']*'( \+ causa, codice\(e\)|, codice\(e\))?$/.test(a.trim())), logs);
  // `causa` di fallito() e' sempre un letterale del codice: ogni chiamata passa una stringa fissa
  t(`G5b ${nome}: fallito() riceve solo cause scritte nel codice`, [...src.matchAll(/fallito\(([^,]+),/g)].every((m) => /^'[^'@]+'$/.test(m[1].trim())), [...src.matchAll(/fallito\(([^,]+),/g)].map((m) => m[1]).filter((x) => !/^'[^'@]+'$/.test(x.trim())));
  t(`G6 ${nome}: nessun innerHTML ne' eval`, !/innerHTML|\beval\(/.test(src));
}
t('G7 chat-staff: nessun PIN, nessuna chiave di servizio accettata come utente', !/pin_hash|\bpin\b/.test(STAFF.replace(/^\s*\/\/.*$/gm, '')) && /auth\.getUser\(token\)/.test(STAFF));
t('G8 chat-send legge la chiave Gmail chiave per chiave (mai app_flags largo)', /\.eq\('key', 'cs_gmail_sa_key'\)/.test(SEND) && !/from\('app_flags'\)\.select\('[^']*'\)(?!\.eq\('key')/.test(SEND));
t('G9 chat-send: destinatario solo da chat_sessioni (nessun to/email nel corpo della richiesta)', !/d\.(to|email|destinatario)\b/.test(blocco(SEND, 'chat-send')));
t('G10 chat-send: prenotazione condizionata a email_stato null PRIMA della chiamata a Gmail', (() => { const b = blocco(SEND, 'chat-send'); return b.indexOf('amb.db.prenota(') > 0 && b.indexOf('amb.db.prenota(') < b.indexOf('g.invia('); })());
t('G11 la suite e\' nella Action', /tests\/chat_staff_send\.mjs/.test(WF));
// migr 0187
const M = M0187.replace(/--.*$/gm, '');
t('G12 0187: chat_conservazione invoker con search_path, execute revocato', /create or replace function public\.chat_conservazione\(\)[\s\S]*?set search_path to 'public'/.test(M) && !/security definer/i.test(M)
  && /revoke all on function public\.chat_conservazione\(\) from public, anon, authenticated;/.test(M));
t('G13 0187: mesi da app_flags.chat_conservazione_mesi, 12 se illeggibile, 500 chat per giro', /key = 'chat_conservazione_mesi'/.test(M) && /v_mesi int := 12/.test(M) && /limit 500/.test(M));
t('G14 0187: cron chat-send col PIN neutro e azione giro, cron della pulizia giornaliero', /cron\.schedule\('chat-send', '3,8,13,18,23,28,33,38,43,48,53,58 \* \* \* \*'/.test(M) && /"action":"giro","pin":"x"/.test(M)
  && /cron\.schedule\('chat-conservazione', '47 3 \* \* \*'/.test(M));
t('G15 0187: nessuna scrittura in change_log', !/insert\s+into\s+change_log/i.test(M));
t('G16 0187: la pulizia cancella anche gli eventi con la chiave della sessione (Gate 2, C2)', /delete from chat_eventi e\s+using unnest\(v_ids\) u\(id\)\s+where e\.chiave like u\.id::text \|\| ':%'/.test(M));
// staff-3 (Gate 2 del pezzo 6, B1): la cancellazione di una chat e' UNA transazione, l'RPC chat_cancella_sessione della
// migr 0193; chat-staff non cancella piu' niente da se' (ne' cs_, ne' contatori, eventi, registro delle push, sessione)
const M0193 = read('supabase/migrations/0193_chat_proiezione.sql');
const fnCanc = (M0193.match(/create or replace function public\.chat_cancella_sessione\(p_sessione uuid, p_card uuid default null\)[\s\S]*?\$fn\$;/) ?? [''])[0];
t('G17 chat_cancella_sessione: lock della sessione PRIMA di tutto, poi eventi con la chiave della sessione e contatori della sessione', /select \* into v_s from chat_sessioni where id = p_sessione for update;[\s\S]*delete from cs_conversations/.test(fnCanc)
  && fnCanc.indexOf('for update') < fnCanc.indexOf('delete from') && /delete from chat_eventi where chiave like p_sessione::text \|\| ':%';/.test(fnCanc)
  && /delete from chat_contatori where chiave like 'sess:' \|\| p_sessione::text \|\| ':%';/.test(fnCanc)
  && /delete from cs_conversations where id = p_card and gmail_thread_id = v_s\.gmail_thread_id;/.test(fnCanc));
// staff-2 e migr 0189 (pezzo 4, 11.6 punto 4): il registro delle push della chat se ne va con la sessione, solo i tre
// eventi della chat e solo le chiavi che cominciano con l'id della sessione (dalla staff-3 dentro l'RPC)
t('G18 chat_cancella_sessione cancella il registro delle push dei soli tre eventi della chat, chiave della sessione; chat-staff solo l\'RPC',
  /delete from push_eventi_inviati where evento in \('chat_sollecito', 'chat_sollecito_scala', 'chat_salute'\) and chiave like p_sessione::text \|\| ':%';/.test(fnCanc)
  && /sb\.rpc\('chat_cancella_sessione', \{ p_sessione: id, p_card: card \}\)/.test(STAFF)
  && !/from\('(push_eventi_inviati|chat_contatori|chat_eventi|chat_sessioni|cs_conversations)'\)\.delete\(\)/.test(STAFF) && F.VERSIONE === 'staff-4');
const M9 = M0189.replace(/--.*$/gm, '');
const fn0187 = (M.match(/create or replace function public\.chat_conservazione\(\)[\s\S]*?\$fn\$;/) ?? [''])[0];
const fn0189 = (M9.match(/create or replace function public\.chat_conservazione\(\)[\s\S]*?\$fn\$;/) ?? [''])[0];
const PUSH_0189 = "    delete from push_eventi_inviati p\n     using unnest(v_ids) u(id)\n     where p.evento in ('chat_sollecito', 'chat_sollecito_scala', 'chat_salute')\n       and p.chiave like u.id::text || ':%';\n    get diagnostics v_push = row_count;\n";
// la 0189 e' la funzione della 0187 piu' il delete del registro, quello delle righe orfane (Gate 2, C1) e il conteggio
// push, e nient'altro
const norm = (x) => x.replace(/\s+/g, ' ');
const ORFANE_0189 = "delete from push_eventi_inviati where id in (select p.id from push_eventi_inviati p where p.evento in ('chat_sollecito', 'chat_sollecito_scala', 'chat_salute') and p.chiave ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:' and p.updated_at < now() - interval '1 hour' and not exists (select 1 from chat_sessioni s where s.id::text = left(p.chiave, 36)) limit 5000); get diagnostics v_n = row_count; v_push := v_push + v_n; ";
const tolto = norm(fn0189.replace(PUSH_0189, '').replace('  v_push int := 0;\n', '').replace(' + v_push > 0', ' > 0')
  .replace(", 'token', v_tok, 'push', v_push));", ", 'token', v_tok));").replace(", 'token', v_tok, 'push', v_push);", ", 'token', v_tok);")).replace(ORFANE_0189, '');
t('G19 0189: chat_conservazione = la 0187 piu\' il delete del registro delle push della chat (prima di cancellare la sessione), le righe orfane ferme da un\'ora (C1) e il conteggio push', fn0187 !== '' && fn0189.includes(PUSH_0189)
  && norm(fn0189).includes(ORFANE_0189) && fn0189.indexOf(PUSH_0189) < fn0189.indexOf('delete from chat_sessioni where id = any(v_ids);') && tolto === norm(fn0187),
  tolto.slice(0, 200));
t('G20 0189: invoker, execute revocato, nessun cron o flag toccato, in una transazione', !/security definer/i.test(M9)
  && /revoke all on function public\.chat_conservazione\(\) from public, anon, authenticated;/.test(M9) && !/cron\.(schedule|alter_job|unschedule)/.test(M9)
  && !/\b(insert into|update|delete from) app_flags\b/i.test(M9) && !/insert\s+into\s+change_log/i.test(M9) && /\nbegin;\n/.test(M0189) && M0189.trimEnd().endsWith('commit;'));

console.log(`\n${ok} ok, ${ko} KO`);
process.exit(ko ? 1 : 0);
