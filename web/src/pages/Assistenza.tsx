import { useEffect, useRef, useState } from 'react';
import { csClient } from '../lib/csClient';
import { fetchConversations, fetchRumore, fetchMessages, csPollNow, setCategoria, setStato, addNoise, removeNoise, fetchContext, fetchCaseData, generateOptions, refineDraft, sendReply, recordRamo, getAiConfig, setAiIstruzioni, catEmoji, CS_CATEGORIES, CASE_CATS } from '../lib/csApi';
import type { CsConversation, CsMessage, Canale, CsContext, DraftOption, CaseData, Stato } from '../lib/csApi';

// email in testo semplice: preserva gli a-capo (CSS pre-wrap) e collassa i vuoti multipli (feedback 24-07)
const cleanBody = (t: string) => (t || '').replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
// notifica chat Shopify Inbox: mostra solo il messaggio del cliente, non il boilerplate della notifica
const cleanChatBody = (t: string) => {
  const s = cleanBody(t);
  const m = s.match(/new message from[^\n]*\n+([\s\S]*?)\n+\s*Sent via Inbox/i);
  return m ? m[1].trim() : s;
};
// deep-link alla conversazione esatta in Shopify Inbox: e' nel corpo di ogni notifica ("Reply in Inbox")
const inboxUrlOf = (ms: CsMessage[] | null): string | null => {
  for (const m of [...(ms ?? [])].reverse()) {
    const hit = (m.body_text || '').match(/https:\/\/inbox\.shopify\.com\/store\/[\w-]+\/conversations\/open\/[\w-]+/);
    if (hit) return hit[0];
  }
  return null;
};

// Sezione Assistenza clienti — FASE 1: SOLA LETTURA dietro login Supabase Auth.
// Login = solo cancello (@amimi.it); l'identita' che firma (Benny/Ginni) e' un selettore in-tool,
// ricordato per dispositivo (design 3.4). Niente AI, niente bozze, niente invio (Fasi 2-4).

const IDENTS: Record<string, { n: string; cls: string }> = { B: { n: 'Benedetta', cls: 'cs-b' }, G: { n: 'Ginevra', cls: 'cs-g' }, A: { n: 'Ale', cls: 'cs-a' } };
const KEY_BY_NAME: Record<string, string> = { Benedetta: 'B', Ginevra: 'G', Ale: 'A' };
// Foto profilo (rounded): file in web/public/avatars/. Se il file manca -> fallback all'iniziale colorata.
const AVATAR_SRC: Record<string, string> = { B: 'avatars/benedetta.jpg', G: 'avatars/ginevra.jpg', A: 'avatars/ale.jpg' };

function Avatar({ k, size = 30 }: { k: string; size?: number }) {
  const [err, setErr] = useState(false);
  const id = IDENTS[k];
  if (!id) return null;
  if (err || !AVATAR_SRC[k]) return <span className={'cs-av ' + id.cls} style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}>{k}</span>;
  return <img className="cs-avimg" src={import.meta.env.BASE_URL + AVATAR_SRC[k]} alt={id.n} style={{ width: size, height: size }} onError={() => setErr(true)} />;
}
const CANALI: Record<Canale, string> = { email_diretta: '✉️ email', form_contatto: '📝 form sito', form_evento: '💍 form evento', chat_notifica: '💬 chat sito', rumore: '🔕 rumore' };
const BUCKETS: [string, string][] = [['oggi', 'Oggi'], ['ieri', 'Ieri'], ['sett', 'Questa settimana'], ['vecchie', 'Piu’ vecchie']];
const TONO_LABEL: Record<string, string> = { breve: '⚡ Breve', calda: '💛 Calda', formale: '🎩 Formale', bozza: '✍️ Bozza' };
// v18: perche' il sistema NON dice entro/fuori pur avendo l'ordine sotto gli occhi.
const NON_APP_UI: Record<string, string> = {
  rimborsato: 'Ordine gia’ rimborsato per intero: il caso e’ chiuso a favore della cliente. La bozza riconosce il rimborso e non parla di finestra.',
  rimborsato_parziale: 'Ordine gia’ rimborsato in parte: la bozza riconosce il rimborso parziale senza dare per scontato a cosa si riferisce.',
  annullato: 'Ordine annullato: niente finestra da calcolare. La bozza riconosce l’annullamento.',
  pre_ritiro: 'Merce non ancora ritirata dal corriere: non c’e’ niente da rendere. La bozza non parla di reso ne’ di rientro.',
};
const SHOPIFY_INBOX = 'https://admin.shopify.com/store/amimi-10000/apps/inbox';
// Fase 4: canali con INVIO dall'app (chat = solo copia + deep-link Inbox; rumore = niente)
const CAN_SEND: Set<Canale> = new Set(['email_diretta', 'form_contatto', 'form_evento']);

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
function bucketOf(iso: string | null): string {
  if (!iso) return 'vecchie';
  const d = new Date(iso), now = new Date(), y = new Date(now); y.setDate(now.getDate() - 1);
  if (sameDay(d, now)) return 'oggi';
  if (sameDay(d, y)) return 'ieri';
  const weekAgo = new Date(now); weekAgo.setDate(now.getDate() - 7);
  return d >= weekAgo ? 'sett' : 'vecchie';
}
function fmtWhen(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso), now = new Date(), y = new Date(now); y.setDate(now.getDate() - 1);
  const hm = d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  if (sameDay(d, now)) return hm;
  if (sameDay(d, y)) return 'ieri ' + hm;
  return d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' });
}
const nmeOf = (c: CsConversation) => c.customer_name || c.customer_email || '(senza nome)';

const FLAG_LABEL: Record<string, string> = { sollecito: '⏱ sollecito', reclamo_assistenza: '⚠️ reclamo', chiusura: '✅ chiusura' };
const isUrg = (c: CsConversation) => c.urgente === true;
// La coda mette gli urgenti in cima, poi per anzianita' del messaggio (piu' recente prima) (design 6.4).
const urgSort = (a: CsConversation, b: CsConversation) => {
  if (isUrg(a) !== isUrg(b)) return isUrg(a) ? -1 : 1;
  return (b.last_msg_at || '').localeCompare(a.last_msg_at || '');
};

// Badge riga: categoria (o "da confermare"), urgenza col motivo, flag. Riusati su card e thread.
function Badges({ c }: { c: CsConversation }) {
  const daConfermare = !c.categoria && c.categoria_source === 'ai_low';
  return (
    <div className="cs-badges">
      {c.categoria && <span className="cs-badge cs-cat">{catEmoji(c.categoria)} {c.categoria}</span>}
      {daConfermare && <span className="cs-badge cs-confirm">🏷️ da confermare</span>}
      {isUrg(c) && <span className="cs-badge cs-urg">🚨 {c.urgenza_motivo || 'urgente'}</span>}
      {(c.flags ?? []).filter((f) => f !== 'urgente' && FLAG_LABEL[f]).map((f) => (
        <span key={f} className="cs-badge cs-flag">{FLAG_LABEL[f]}</span>
      ))}
    </div>
  );
}

export default function Assistenza({ onBack }: { onBack: () => void }) {
  const [session, setSession] = useState<'loading' | 'in' | 'out'>('loading');
  const [ident, setIdentS] = useState(() => localStorage.getItem('amimi_cs_ident') || '');
  const setIdent = (k: string) => { setIdentS(k); localStorage.setItem('amimi_cs_ident', k); };
  const [view, setView] = useState<'coda' | 'thread' | 'rumore'>('coda');
  const [filtro, setFiltro] = useState<'dafare' | 'incorso' | 'fatte' | 'tutte'>('dafare');
  const [savingStato, setSavingStato] = useState(false);
  // swipe sulle card (mobile): trascina a sinistra oltre soglia = conclusa
  const swipeRef = useRef<{ id: string; x0: number; dx: number } | null>(null);
  const suppressOpenRef = useRef('');
  const [swipeDx, setSwipeDx] = useState<{ id: string; dx: number } | null>(null);
  const [codaView, setCodaView] = useState<'tema' | 'tempo'>('tempo');
  const [savingCat, setSavingCat] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [ctx, setCtx] = useState<CsContext | null>(null);
  const [caso, setCaso] = useState<CaseData | null>(null);
  const [confirmDate, setConfirmDate] = useState('');
  const [casoBusy, setCasoBusy] = useState(false);
  const [options, setOptions] = useState<DraftOption[] | null>(null);
  // cs-assist v17: la generazione a 3 opzioni si e' interrotta e la edge ha ripiegato su una bozza
  // sola. Prima non lo diceva nessuno e sembrava un capriccio del tool (caso S10 del benchmark).
  const [fallbackSingola, setFallbackSingola] = useState(false);
  const [troncate, setTroncate] = useState(0);   // v19: opzioni tagliate a meta' arrivate comunque
  // v24 (schema RAMI): 'rami' = le alternative sono ESITI con un titolo, non toni. `draftId` serve a
  // registrare, dopo l'invio, quale esito e' stato scelto davvero (dataset dei casi predefiniti).
  const [schema, setSchema] = useState<'rami' | 'toni'>('toni');
  const [draftId, setDraftId] = useState<string | null>(null);
  // guardia race (audit #7): le risposte async di un thread APERTO PRIMA non devono scrivere sul corrente
  const threadRef = useRef('');
  const [selIdx, setSelIdx] = useState(0);
  const [daVer, setDaVer] = useState(0);
  // linter di aderenza: numeri/date/URL della bozza NON trovati nei dati reali (calcolato server-side)
  const [nonGrounded, setNonGrounded] = useState<string[]>([]);
  const [fonti, setFonti] = useState<string[]>([]);
  const [bozzaText, setBozzaText] = useState('');
  const [genBozza, setGenBozza] = useState(false);
  const [refineTxt, setRefineTxt] = useState('');
  const [refining, setRefining] = useState(false);
  const [copied, setCopied] = useState(false);
  // Fase 4: invio dall'app. sendKey (uuid) nasce all'apertura del dialog = anti doppio invio
  // (doppio click / retry di rete portano la stessa chiave, la edge non spedisce due volte).
  const [sendOpen, setSendOpen] = useState(false);
  const [sendKey, setSendKey] = useState('');
  const [sending, setSending] = useState(false);
  const [sendErr, setSendErr] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);   // invio riuscito per QUESTO testo (si azzera se il testo cambia)
  const [convs, setConvs] = useState<CsConversation[] | null>(null);
  const [rumore, setRumore] = useState<CsConversation[] | null>(null);
  const [current, setCurrent] = useState<CsConversation | null>(null);
  const [msgs, setMsgs] = useState<CsMessage[] | null>(null);
  const [menu, setMenu] = useState(false);
  // menu overflow "..." della testata thread (redesign 31-07: "Non e' un cliente" e' un'azione rara)
  const [moreOpen, setMoreOpen] = useState(false);
  const [err, setErr] = useState('');
  const [email, setEmail] = useState('');
  const [pwd, setPwd] = useState('');
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // toast (feedback swipe + azioni). undo opzionale.
  const [toast, setToast] = useState<{ msg: string; undo?: () => void } | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const showToast = (msg: string, undo?: () => void) => {
    setToast({ msg, undo });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 4500);
  };

  useEffect(() => {
    csClient.auth.getSession().then(({ data }) => setSession(data.session ? 'in' : 'out'));
    const { data: sub } = csClient.auth.onAuthStateChange((_e, s) => setSession(s ? 'in' : 'out'));
    return () => sub.subscription.unsubscribe();
  }, []);

  // Back del browser / swipe-back: da un thread (o dal rumore) torna alla CODA, non fuori dall'app.
  // Push di uno stato quando si apre un sotto-livello; il popstate lo consuma riportando alla coda (feedback 24-07).
  useEffect(() => {
    const onPop = () => { setMenu(false); setView((v) => (v === 'thread' || v === 'rumore') ? 'coda' : v); };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const pushSub = () => { try { if (!window.history.state?.csSub) window.history.pushState({ csSub: true }, ''); } catch { /* no-op */ } };
  const goCoda = () => { if (window.history.state?.csSub) window.history.back(); else setView('coda'); };

  useEffect(() => {
    if (session !== 'in' || !ident) return;
    setErr(''); setConvs(null);
    fetchConversations().then(setConvs).catch((e: Error) => setErr(e.message));
  }, [session, ident]);

  // "Aggiorna": forza un giro di lettura posta (come il cron) + ricarica la coda, per non aspettare i 2'.
  const doRefresh = async () => {
    setRefreshing(true); setErr('');
    await csPollNow();
    try { setConvs(await fetchConversations()); if (rumore) setRumore(await fetchRumore()); } catch (e) { setErr((e as Error).message); }
    setRefreshing(false);
  };

  const doLogin = async () => {
    setBusy(true); setErr('');
    const { error } = await csClient.auth.signInWithPassword({ email: email.trim(), password: pwd });
    setBusy(false);
    if (error) setErr('Accesso non riuscito. Controlla email e password.');
    else setPwd('');
  };
  // "Accedi con Google": redirect OAuth. `hd` suggerisce il dominio Workspace amimi.it (hint, non
  // vincolo: il vincolo vero e' la RLS @amimi.it, migr 0056). Al ritorno il client raccoglie la
  // sessione dall'URL (detectSessionInUrl) e onAuthStateChange porta dentro. Se il provider Google
  // non e' ancora attivo nel pannello Supabase, signInWithOAuth ritorna errore e resta email/password.
  const doGoogle = async () => {
    setBusy(true); setErr('');
    const { error } = await csClient.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + import.meta.env.BASE_URL, queryParams: { hd: 'amimi.it', prompt: 'select_account' } },
    });
    if (error) { setBusy(false); setErr('Google non ancora attivo (manca il setup nel pannello Supabase). Per ora accedi con email/password qui sotto.'); }
  };
  const logout = async () => { setMenu(false); await csClient.auth.signOut(); setConvs(null); setCurrent(null); setView('coda'); };
  // Motore verdetti: carica il caso (reso/cambio/indirizzo) calcolato dal sistema. Best-effort:
  // se l'edge live non ha ancora `case_data` (deploy pending) il pannello semplicemente non appare.
  const loadCaso = (tid: string, deliveredAt?: string) => {
    setCasoBusy(true);
    fetchCaseData(tid, deliveredAt)
      .then((cd) => { if (threadRef.current === tid) setCaso(cd); })
      .catch(() => { if (threadRef.current === tid) setCaso(null); })
      .finally(() => { if (threadRef.current === tid) setCasoBusy(false); });
  };
  const openThread = async (c: CsConversation) => {
    pushSub();
    threadRef.current = c.id;
    setCurrent(c); setMsgs(null); setView('thread'); setErr('');
    setCtx(null); setCaso(null); setConfirmDate(''); setOptions(null); setBozzaText(''); setFonti([]); setRefineTxt(''); setCopied(false); setNonGrounded([]); setMoreOpen(false);
    setSendOpen(false); setSending(false); setSendErr(''); setSentTo(null);
    try { const m = await fetchMessages(c.id); if (threadRef.current === c.id) setMsgs(m); }
    catch (e) { if (threadRef.current === c.id) setErr((e as Error).message); }
    // Contesto (link ordine + storico acquisti): nessuna spesa AI, best-effort (non blocca il thread).
    // Vale anche per la chat del sito (dal 26-07): se il visitatore ha lasciato l'email, storia e ordine si agganciano.
    if (c.canale !== 'rumore') {
      fetchContext(c.id).then((x) => { if (threadRef.current === c.id) setCtx(x); }).catch(() => { /* testata best-effort */ });
      if (c.categoria && CASE_CATS.has(c.categoria)) loadCaso(c.id);
    }
  };
  // Fase 3: 3 opzioni di risposta con dati reali (edge cs-assist, JWT). Recupero dati deterministico + Gemini.
  const doGenOptions = async () => {
    if (!current) return;
    const tid = current.id;
    setGenBozza(true); setErr(''); setCopied(false); setSentTo(null); setSendOpen(false);
    try {
      const r = await generateOptions(tid, ident, confirmDate || undefined);
      if (threadRef.current !== tid) return;   // thread cambiato nel frattempo: butta la risposta
      setOptions(r.options); setSelIdx(0); setBozzaText(r.options[0]?.testo ?? ''); setDaVer(r.options[0]?.da_verificare ?? 0); setNonGrounded(r.options[0]?.non_grounded ?? []); setFonti(r.fonti); setFallbackSingola(r.fallbackSingola); setTroncate(r.troncate);
      setSchema(r.schema); setDraftId(r.draftId);
      if (!ctx) setCtx({ fonti: r.fonti, order_admin_url: r.order_admin_url, storia: r.storia });
    } catch (e) { if (threadRef.current === tid) setErr((e as Error).message); }
    if (threadRef.current === tid) setGenBozza(false);
  };
  const pickOption = (i: number) => { if (!options?.[i]) return; setSelIdx(i); setBozzaText(options[i].testo); setDaVer(options[i].da_verificare); setNonGrounded(options[i].non_grounded ?? []); setCopied(false); setSentTo(null); };
  // "Chiedi una modifica": l'AI riscrive la bozza corrente applicando l'istruzione, sempre sui dati reali.
  const doRefine = async () => {
    if (!current || !bozzaText.trim() || !refineTxt.trim()) return;
    const tid = current.id;
    setRefining(true); setErr(''); setCopied(false);
    try { const r = await refineDraft(tid, ident, bozzaText, refineTxt); if (threadRef.current === tid) { setBozzaText(r.draft); setDaVer(r.da_verificare); setNonGrounded(r.non_grounded ?? []); setRefineTxt(''); setSentTo(null); } }
    catch (e) { if (threadRef.current === tid) setErr((e as Error).message); }
    if (threadRef.current === tid) setRefining(false);
  };
  // v19 (brief cs_uiux_rifiniture punto 1): la copia negli appunti puo' FALLIRE (permessi negati,
  // documento non a fuoco) e prima il tool diceva "Copiata" lo stesso: l'operatrice incollava in
  // Inbox il contenuto precedente senza saperlo. Ora l'esito e' quello vero.
  const copiaNegliAppunti = async (): Promise<boolean> => {
    try { await navigator.clipboard.writeText(bozzaText); setCopied(true); setTimeout(() => setCopied(false), 2000); return true; }
    catch { return false; }
  };
  const copiaBozza = async () => {
    if (!(await copiaNegliAppunti())) showToast('Copia non riuscita: seleziona il testo e copialo a mano.');
  };
  // Fase 4 — chat del sito: NESSUN invio dall'app (decisione owner 01-08: un'email autonoma
  // creerebbe due tracce). Copia il testo finale e apre la conversazione ESATTA in Inbox,
  // dove e' Inbox a consegnare (chat live o email al cliente).
  const copiaEApriInbox = async () => {
    const ok = await copiaNegliAppunti();
    // v24: sul canale chat l'invio non passa da qui, quindi la copia riuscita E' il gesto
    // impegnativo: e' li' che si registra il ramo scelto. Se la copia fallisce non si registra
    // nulla, perche' non e' stato usato niente.
    if (ok && schema === 'rami' && draftId) await recordRamo(draftId, options?.[selIdx]?.titolo ?? '', ident);
    // Inbox si apre comunque (il deep-link e' meta' del gesto), ma il messaggio dice la verita':
    // senza questo, si incollava in Inbox il contenuto vecchio degli appunti credendolo giusto.
    window.open(inboxUrlOf(msgs) ?? SHOPIFY_INBOX, '_blank', 'noopener');
    showToast(ok
      ? 'Copiata. Incolla in Inbox e chiudi lì la conversazione dopo la risposta.'
      : '⚠ Copia NON riuscita: gli appunti hanno ancora il contenuto di prima. Torna qui, seleziona la bozza e copiala a mano.');
  };
  // Fase 4 — apertura del dialog di conferma: OGNI invio passa da qui (mai invio automatico).
  // La send_key nasce adesso: doppio click e retry porteranno la stessa chiave (anti doppio invio).
  const openSend = () => { setSendKey(crypto.randomUUID()); setSendErr(''); setSendOpen(true); };
  const doSend = async () => {
    if (!current || sending) return;
    const tid = current.id;
    setSending(true); setSendErr('');
    try {
      const r = await sendReply(tid, ident, bozzaText, sendKey);
      if (threadRef.current !== tid) return;
      setSendOpen(false); setSentTo(r.to);
      showToast(r.already_sent ? `Era già partita: inviata a ${r.to}` : `✓ Inviata a ${r.to}`);
      // v24: il ramo si registra QUI, dopo un invio riuscito: e' la scelta impegnativa, non
      // l'anteprima. Best-effort dentro recordRamo: non deve mai far sembrare fallito un invio
      // che invece e' partito.
      if (schema === 'rami' && draftId) await recordRamo(draftId, options?.[selIdx]?.titolo ?? '', ident);
      // la contabilita' post-invio fallita NON e' silenziosa: la mail e' partita, ma va controllato
      if (r.warnings.length) setErr('Email inviata, ma da controllare: ' + r.warnings.join(' · '));
      try {
        const m = await fetchMessages(tid);
        if (threadRef.current === tid) setMsgs(m);
        const list = await fetchConversations();
        setConvs(list);
        const cur = list.find((x) => x.id === tid);
        if (cur && threadRef.current === tid) setCurrent(cur);   // stato aggiornato (fatto/auto) in testata
      } catch { /* refresh best-effort: l'invio resta riuscito */ }
    } catch (e) { if (threadRef.current === tid) setSendErr((e as Error).message); }
    if (threadRef.current === tid) setSending(false);
  };
  const openRumore = async () => {
    pushSub();
    setView('rumore'); setErr('');
    if (!rumore) { try { setRumore(await fetchRumore()); } catch (e) { setErr((e as Error).message); } }
  };
  // gesto inverso del "non e' un cliente": riporta in coda e toglie il mittente dalla denylist
  const doUnNoise = async (c: CsConversation) => {
    setSavingStato(true); setErr('');
    try {
      const r = await removeNoise(c.id, ident);
      setRumore((prev) => (prev ?? []).filter((x) => x.id !== c.id));
      setConvs(await fetchConversations());
      if (r.dominio_che_blocca) setErr(`Riportata in coda, ma il dominio ${r.dominio_che_blocca} resta in denylist (copre altri mittenti): le sue prossime mail finiranno ancora nel rumore.`);
    } catch (e) { setErr((e as Error).message); }
    setSavingStato(false);
  };
  // correzione manuale categoria (scrive via cs-api, JWT-gated); aggiorna subito la UI
  const applyCat = async (categoria: string | null) => {
    if (!current) return;
    setSavingCat(true); setErr('');
    try {
      await setCategoria(current.id, categoria, ident);
      const patch = { categoria, categoria_source: categoria ? 'manuale' : 'ai_low' } as Partial<CsConversation>;
      setCurrent({ ...current, ...patch } as CsConversation);
      setConvs((prev) => prev ? prev.map((x) => x.id === current.id ? { ...x, ...patch } as CsConversation : x) : prev);
      // correzione verso una categoria a caso (reso/cambio/indirizzo): carica subito il verdetto
      if (categoria && CASE_CATS.has(categoria)) loadCaso(current.id, confirmDate || undefined); else setCaso(null);
    } catch (e) { setErr((e as Error).message); }
    setSavingCat(false);
  };
  // workflow coda: da_fare (da iniziare) -> in_corso (chi la prende) -> fatto (conclusa)
  const patchConv = (id: string, patch: Partial<CsConversation>) => {
    setConvs((prev) => prev ? prev.map((x) => x.id === id ? { ...x, ...patch } as CsConversation : x) : prev);
    setCurrent((cur) => cur && cur.id === id ? { ...cur, ...patch } as CsConversation : cur);
  };
  const doStato = async (c: CsConversation, stato: Stato) => {
    setSavingStato(true); setErr('');
    const prev = { stato: c.stato, stato_by: c.stato_by };
    patchConv(c.id, { stato, stato_by: stato === 'da_fare' ? null : (IDENTS[ident]?.n ?? ident) });   // ottimistico
    try { await setStato(c.id, stato, ident); }
    catch (e) { patchConv(c.id, prev); setErr((e as Error).message); }
    setSavingStato(false);
  };
  // "Non e' un cliente": mittente in denylist + conversazione nel Rumore (fuori dalla coda)
  const doNoise = async (c: CsConversation) => {
    const sender = ([...(msgs ?? [])].reverse().find((m) => m.direction === 'in')?.from_email) || c.customer_email || '';
    if (!sender) { setErr('Mittente non identificabile.'); return; }
    if (!window.confirm(`Blocco "${sender}" (le prossime mail finiscono nel Rumore) e sposto questa conversazione fuori dalla coda. Confermi?`)) return;
    setSavingStato(true); setErr('');
    try {
      await addNoise(c.id, sender, ident);
      setConvs((prevC) => prevC ? prevC.filter((x) => x.id !== c.id) : prevC);
      setRumore(null);   // la vista Rumore si ricarichera'
      goCoda();
      showToast(`🚫 "${sender}" spostata nel Rumore`);
    } catch (e) { setErr((e as Error).message); }
    setSavingStato(false);
  };
  // swipe a sinistra su una card = conclusa (sparisce da "Da iniziare", la ritrovi in "Concluse") + toast con Annulla
  const doSwipeDone = (c: CsConversation) => {
    suppressOpenRef.current = c.id;
    setTimeout(() => { if (suppressOpenRef.current === c.id) suppressOpenRef.current = ''; }, 450);
    void doStato(c, 'fatto');
    showToast(`✓ "${nmeOf(c).slice(0, 22)}" tolta dalla coda`, () => doStato(c, 'da_fare'));
  };

  // ---- login gate ----
  if (session === 'loading') return <div className="screen"><div className="muted center" style={{ padding: 40 }}>Carico…</div></div>;

  if (session === 'out') return (
    <div className="screen">
      <header><button className="badge" onClick={onBack} type="button">‹ Home app</button></header>
      <div className="cs-login">
        <div className="cs-logo">amimi<span>&#8217; assistenza</span></div>
        <div className="cs-lt">Accedi con il tuo account Amimi&#8217;</div>
        <button className="cs-btn" style={{ width: '100%', background: '#fff', border: '1px solid var(--line)', color: 'var(--dark)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }} onClick={doGoogle} disabled={busy} type="button">
          <span aria-hidden="true" style={{ fontWeight: 800, fontFamily: 'Arial, sans-serif' }}><span style={{ color: '#4285F4' }}>G</span><span style={{ color: '#EA4335' }}>o</span><span style={{ color: '#FBBC05' }}>o</span><span style={{ color: '#4285F4' }}>g</span><span style={{ color: '#34A853' }}>l</span><span style={{ color: '#EA4335' }}>e</span></span>
          <span>Accedi con Google</span>
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '14px 0 4px', color: 'var(--muted)', fontSize: 12 }}>
          <span style={{ flex: 1, height: 1, background: 'var(--line)' }} /> oppure con email <span style={{ flex: 1, height: 1, background: 'var(--line)' }} />
        </div>
        <div className="cs-fld"><label>Email (@amimi.it)</label>
          <input type="email" autoCapitalize="none" autoCorrect="off" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="info@amimi.it" /></div>
        <div className="cs-fld"><label>Password</label>
          <input type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') doLogin(); }} /></div>
        {err && <div className="err" style={{ marginBottom: 8 }}>{err}</div>}
        <button className="cs-btn cs-primary" style={{ width: '100%' }} onClick={doLogin} disabled={busy} type="button">{busy ? 'Accesso…' : 'Entra'}</button>
        <div className="cs-note">Login vero (Supabase Auth), vale qualsiasi casella @amimi.it. Si fa una volta: questo dispositivo resta collegato.</div>
      </div>
    </div>
  );

  // ---- "chi sei?" ----
  if (!ident) return (
    <div className="screen">
      <header><button className="badge" onClick={onBack} type="button">‹ Home app</button><button className="badge" onClick={logout} type="button">Esci</button></header>
      <div className="cs-login">
        <div className="cs-logo" style={{ fontSize: 24 }}>Chi sei?</div>
        <div className="cs-lt">L&#8217;identita&#8217; firma le tue risposte, il login no</div>
        {(['B', 'G', 'A'] as const).map((k) => (
          <button key={k} className="cs-who" onClick={() => setIdent(k)} type="button">
            <Avatar k={k} size={42} />
            <span className="cs-whn">{IDENTS[k].n}{k === 'A' ? ' (admin)' : ''}</span>
          </button>
        ))}
        <div className="cs-note">Ricordata su questo dispositivo. La cambi quando vuoi toccando l&#8217;avatar in alto.</div>
      </div>
    </div>
  );

  // ---- thread ----
  if (view === 'thread' && current) {
    const c = current;
    const draftMode = options !== null;   // bozze generate: testata compressa, contesto lascia spazio (mockup frame 3)
    const primoNome = (nmeOf(c).split(' ')[0] || 'Cliente');
    const ordSub = ctx?.ordine ? [
      ctx.ordine.created_at_shop ? `${ctx.ordine.created_at_shop.slice(8, 10)}-${ctx.ordine.created_at_shop.slice(5, 7)}` : null,
      ctx.ordine.gross_total != null ? `${Math.round(ctx.ordine.gross_total)}€` : null,
      ctx.ordine.righe[0]?.nome ? ctx.ordine.righe[0].nome.slice(0, 26) : null,
    ].filter(Boolean).join(' · ') : '';
    return (
      <div className="screen">
        <header>
          <button className="badge" onClick={goCoda} type="button">‹ Coda</button>
          <button onClick={() => setMenu((m) => !m)} type="button" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontWeight: 700, fontSize: 13 }}>{IDENTS[ident]?.n ?? ident} ▾</button>
        </header>
        {menu && <IdentMenu ident={ident} setIdent={(k) => { setIdent(k); setMenu(false); }} logout={logout} />}
        {/* testata: compatta; in modalita' bozza si comprime a nome + ordine/categoria + urgenza */}
        <div className="card">
          <div className="cs-chead-r1">
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className={'cs-tnm' + (draftMode ? ' sm' : '')}>{nmeOf(c)}</div>
              <div className="cs-tem">{draftMode
                ? `${c.order_number ? `#${c.order_number} · ` : ''}${c.categoria ? `${catEmoji(c.categoria)} ${c.categoria}` : CANALI[c.canale]}`
                : `${c.customer_email || '—'} · ${CANALI[c.canale]}`}</div>
            </div>
            {isUrg(c) && <span className="cs-urgpill" title={c.urgenza_motivo || 'urgente'}>🚨 {c.urgenza_motivo || 'urgente'}</span>}
          </div>
          {!draftMode && c.canale !== 'rumore' && (
            <>
              <div className="cs-chiprow">
                <select className="cs-catchip" value={c.categoria ?? ''} disabled={savingCat} onChange={(e) => applyCat(e.target.value || null)} aria-label="Categoria">
                  <option value="">🏷️ da confermare</option>
                  {CS_CATEGORIES.map((k) => <option key={k.label} value={k.label}>{k.emoji} {k.label}</option>)}
                </select>
                <span className={'cs-badge cs-state' + (c.stato === 'fatto' ? ' cs-state-done' : c.stato === 'in_corso' ? ' cs-state-prog' : '')}>
                  {c.stato === 'fatto' ? (c.stato_by === 'auto' ? '✓ conclusa da sola (risposta inviata)' : `✓ conclusa${c.stato_by ? ' · ' + c.stato_by : ''}`) : c.stato === 'in_corso' ? `✋ in corso · ${c.stato_by ?? ''}` : 'da iniziare'}
                </span>
                {c.parse_failed && <span className="cs-badge cs-warn">da rivedere</span>}
                {(c.flags ?? []).filter((f) => f !== 'urgente' && FLAG_LABEL[f]).map((f) => (
                  <span key={f} className="cs-badge cs-flag">{FLAG_LABEL[f]}</span>
                ))}
                {savingCat && <span className="muted" style={{ fontSize: 12 }}>salvo…</span>}
              </div>
              <div className="cs-actions-row">
                {c.stato === 'da_fare' && <button className="cs-btn cs-ghost" disabled={savingStato} onClick={() => doStato(c, 'in_corso')} type="button">✋ Prendo io</button>}
                {c.stato !== 'fatto'
                  ? <button className="cs-btn cs-ghost cs-okbtn" disabled={savingStato} onClick={() => doStato(c, 'fatto')} type="button">✓ Conclusa</button>
                  : <button className="cs-btn cs-ghost" disabled={savingStato} onClick={() => doStato(c, 'da_fare')} type="button">↩ Riapri</button>}
                <div className="cs-more-wrap">
                  <button className="cs-btn cs-ghost cs-morebtn" onClick={() => setMoreOpen((o) => !o)} type="button" aria-label="Altre azioni" aria-expanded={moreOpen}>⋯</button>
                  {moreOpen && (
                    <div className="cs-moremenu">
                      <button type="button" disabled={savingStato} onClick={() => { setMoreOpen(false); doNoise(c); }}>🚫 Non è un cliente</button>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
          {!draftMode && c.canale === 'rumore' && (
            <div style={{ marginTop: 6 }}><span className="cs-badge cs-can">{CANALI[c.canale]}</span></div>
          )}
        </div>
        {/* strip "fatti": ordine / cliente / tracking gia' recuperati dal context, zero recuperi nuovi */}
        {!draftMode && c.canale !== 'rumore' && ctx && (ctx.ordine || ctx.order_admin_url || (ctx.storia && ctx.storia.n_ordini > 0)) && (
          <div className="cs-facts">
            {(ctx.ordine || ctx.order_admin_url) && (ctx.order_admin_url ? (
              <a className="cs-fact link" href={ctx.order_admin_url} target="_blank" rel="noreferrer">
                <span className="fl">Ordine</span>
                <span className="fv">#{ctx.ordine?.order_number ?? c.order_number ?? ''} ↗</span>
                {ordSub && <span className="fs">{ordSub}</span>}
              </a>
            ) : (
              <div className="cs-fact">
                <span className="fl">Ordine</span>
                <span className="fv">#{ctx.ordine?.order_number ?? c.order_number ?? ''}</span>
                {ordSub && <span className="fs">{ordSub}</span>}
              </div>
            ))}
            {ctx.storia && ctx.storia.n_ordini > 0 && (
              <div className="cs-fact">
                <span className="fl">Cliente</span>
                <span className="fv">{ctx.storia.n_ordini} {ctx.storia.n_ordini === 1 ? 'ordine' : 'ordini'}</span>
                <span className="fs">{ctx.storia.totale}€ totali{ctx.storia.n_ordini > 1 ? ' · abituale' : ''}</span>
              </div>
            )}
            {ctx.ordine && (ctx.tracking ? (
              <a className="cs-fact link" href={ctx.tracking.url} target="_blank" rel="noreferrer">
                <span className="fl">Tracking</span>
                <span className="fv">{ctx.tracking.corriere} ↗</span>
                <span className="fs">{ctx.tracking.numero}</span>
              </a>
            ) : (
              <div className="cs-fact warn">
                <span className="fl">Tracking</span>
                <span className="fv">⚠ non disponibile</span>
                <span className="fs">la bozza userà [DA VERIFICARE]</span>
              </div>
            ))}
          </div>
        )}
        {c.canale !== 'rumore' && ctx?.gaps && ctx.gaps.length > 0 && (
          <div className="cs-gaps">⚠️ <b>Contesto incompleto:</b> {ctx.gaps.join(' · ')}. La bozza usera&#8217; [DA VERIFICARE], mai inventare.</div>
        )}
        {/* "In breve" (riassunto AI) subito sopra la conversazione */}
        {!draftMode && c.summary && (
          <div className="ds-aisum"><div className="ds-aisum-h">📝 In breve</div><p>{c.summary}</p></div>
        )}
        {c.canale === 'chat_notifica' && !draftMode && (
          <div className="cs-banner">💬 Chat del sito (Shopify Inbox): si risponde DENTRO Inbox, non da qui (una nostra email a parte creerebbe due tracce). Genera la bozza qui sotto, poi &#8220;Copia risposta e apri in Inbox&#8221;.
            <div style={{ marginTop: 8 }}><a className="cs-btn cs-inbox" href={inboxUrlOf(msgs) ?? SHOPIFY_INBOX} target="_blank" rel="noreferrer">{inboxUrlOf(msgs) ? 'Rispondi in Inbox ↗' : 'Apri Shopify Inbox ↗'}</a></div>
          </div>
        )}
        {err && <div className="err">{err}</div>}
        {msgs !== null && msgs.length > 0 && <div className="ds-seclb" style={{ marginTop: 12 }}>Conversazione</div>}
        {msgs === null ? <div className="muted center" style={{ padding: 20 }}>Carico messaggi…</div> :
          msgs.length === 0 ? <div className="muted center" style={{ padding: 20 }}>Nessun messaggio.</div> :
            msgs.map((m) => {
              const out = m.direction === 'out';
              // bolla = body_clean (solo le parole del mittente); NULL -> grezzo come prima, senza expander
              const fallback = m.body_text ? (c.canale === 'chat_notifica' ? cleanChatBody(m.body_text) : cleanBody(m.body_text)) : '';
              const testo = m.body_clean ?? fallback;
              const showOrig = !!m.body_clean && !!m.body_text && m.body_clean.trim() !== cleanBody(m.body_text).trim();
              return (
                <div key={m.id} className={'cs-msg ' + (out ? 'out' : 'in')}>
                  <div className="cs-mh">{out ? `${fmtWhen(m.sent_at)} · ${m.sent_by || 'Amimi’'}` : `${primoNome} · ${fmtWhen(m.sent_at)}`}</div>
                  <div className="cs-mb">
                    {/* riga compatta coi campi del modulo (brief cs_pulizia_moduli_form): telefono cliccabile */}
                    {m.form_fields && Object.keys(m.form_fields).length > 0 && (
                      <div className="cs-formrow">
                        {Object.entries(m.form_fields).map(([k, v]) => {
                          const tel = /telefono|phone/i.test(k) ? String(v).replace(/[^\d+]/g, '') : '';
                          return (
                            <span key={k} className="cs-ff">
                              <b>{k}</b>{tel.length >= 6 ? <a href={'tel:' + tel}>{v}</a> : v}
                            </span>
                          );
                        })}
                      </div>
                    )}
                    <div className="cs-body">{testo || (m.form_fields ? '' : '(vuoto)')}</div>
                  </div>
                  {showOrig && (
                    <details className="cs-orig">
                      <summary><span className="cs-tri">▶</span> Email completa <span style={{ fontWeight: 400 }}>(citazioni e riepilogo)</span></summary>
                      <div className="cs-obody">{m.body_text}</div>
                      <div className="cs-ofoot">Testo originale conservato tale e quale: questa è solo una vista.</div>
                    </details>
                  )}
                </div>
              );
            })}
        {c.canale !== 'rumore' && c.categoria && CASE_CATS.has(c.categoria) && caso && (
          <div className="cs-case">
            <div className="cs-case-h">{c.categoria === 'Modifica / correzione indirizzo' ? '📍 Caso indirizzo — calcolato dal sistema' : '↩️ Caso reso — calcolato dal sistema'}</div>
            {/* stato TWS live (brief stato_tws_in_app): quando il sync spedizioni lo ha portato in app */}
            {caso.stato_tws && (
              <div className="cs-tws">🚚 Stato corriere (TWS): <b>{caso.stato_tws}</b>{caso.stato_tws_aggiornato ? <span className="muted"> · aggiornato al {caso.stato_tws_aggiornato}</span> : null}</div>
            )}
            {c.categoria === 'Modifica / correzione indirizzo' ? (
              caso.indirizzo.caso === 'correggibile' ? (
                <div className="cs-verdict cs-v-ok"><b>🚚 Non ancora ritirata dal corriere · ✅ correggibile</b><span>Chiedi l&#8217;indirizzo completo; correggi su Shopify e TWS prima del ritiro.</span></div>
              ) : caso.indirizzo.caso === 'consegnato' ? (
                <div className="cs-verdict cs-v-no"><b>📬 Risulta gia&#8217; consegnata · nulla da fare sulla spedizione</b><span>Bozza: empatia + vicini/portineria, niente promesse impossibili.</span></div>
              ) : caso.indirizzo.caso === 'verificare_tracking' ? (
                <div className="cs-verdict cs-v-warn">
                  <b>🚚 Gia&#8217; partita: in viaggio o gia&#8217; consegnata?</b>
                  <span>{caso.tracking_url ? <>Controlla dal <a href={caso.tracking_url} target="_blank" rel="noreferrer">tracking ↗</a> — se risulta consegnata, conferma qui la data.</> : 'Tracking non disponibile: la bozza resta prudente su entrambe le ipotesi.'}</span>
                  <div className="cs-case-row">
                    <input type="date" value={confirmDate} onChange={(e) => setConfirmDate(e.target.value)} aria-label="Data di consegna" />
                    <button className="cs-btn cs-ghost" type="button" disabled={!confirmDate || casoBusy} onClick={() => loadCaso(c.id, confirmDate)}>{casoBusy ? '…' : '✓ Consegnata in questa data'}</button>
                  </div>
                </div>
              ) : (
                <div className="cs-verdict cs-v-info"><b>Stato spedizione non determinabile</b><span>Ordine non agganciato con certezza alla cliente: la bozza usa [DA VERIFICARE].</span></div>
              )
            ) : (
              <>
                {caso.reso.difetto_sospetto && (
                  <div className="cs-verdict cs-v-warn"><b>⚠️ Possibile difetto segnalato</b><span>La finestra non si applica da sola (garanzia legale 24 mesi): bozza prudente, mai un rifiuto.</span></div>
                )}
                {caso.reso.verdetto === 'non_applicabile' ? (
                  <div className="cs-verdict cs-v-info">
                    <b>🧾 Ordine del {caso.reso.ordine_del} · nessun verdetto sulla finestra</b>
                    <span>{NON_APP_UI[caso.reso.non_applicabile ?? 'rimborsato']}</span>
                  </div>
                ) : caso.reso.verdetto === 'entro' ? (
                  <div className="cs-verdict cs-v-ok"><b>🧾 Ordine del {caso.reso.ordine_del} · {caso.reso.giorni} giorni fa · ✅ ENTRO i {caso.reso.finestra} (dalla data dell&#8217;ordine)</b><span>Fonte: {caso.reso.fonte}. Reso ammesso: istruzioni + rientro a carico cliente + rimborso in 14 giorni.</span></div>
                ) : caso.reso.verdetto === 'fuori' ? (
                  <div className="cs-verdict cs-v-no"><b>🧾 Ordine del {caso.reso.ordine_del} · {caso.reso.giorni} giorni fa · ⛔ FUORI dai {caso.reso.finestra} (dalla data dell&#8217;ordine)</b><span>Fonte: {caso.reso.fonte}. Rifiuto garbato con un&#8217;alternativa (salvo difetto).</span></div>
                ) : (
                  <div className="cs-verdict cs-v-info">
                    <b>Ordine non identificato con certezza</b>
                    <span>La finestra dei {caso.reso.finestra} giorni decorre dalla data dell&#8217;ordine: senza l&#8217;ordine agganciato niente verdetto, la bozza usa [DA VERIFICARE: numero ordine].</span>
                  </div>
                )}
              </>
            )}
          </div>
        )}
        {c.canale !== 'rumore' && (
          <div className="cs-draftbox">
            {!options ? (
              <button className="cs-btn cs-primary" style={{ width: '100%' }} onClick={doGenOptions} disabled={genBozza} type="button">
                {/* v24: niente "3" nel bottone. Col nuovo schema il numero di alternative dipende dal
                    caso (una sola quando i dati decidono), e la UI non sa quale schema e' attivo
                    prima di generare: promettere tre e darne una sembrerebbe un guasto. */}
                {genBozza ? 'Genero le proposte…' : '✍️ Genera le risposte con i dati reali'}
              </button>
            ) : (
              <>
                {options.length > 1 && (
                  <div className="cs-opts">
                    {options.map((o, i) => (
                      <button key={i} className={'cs-opt' + (i === selIdx ? ' on' : '')} onClick={() => pickOption(i)} type="button">
                        {/* v24: col nuovo schema l'etichetta e' l'ESITO ("Si', arriva in tempo"),
                            non il tono: la collega sceglie leggendo i titoli, non i testi. */}
                        <span className="cs-opt-t">{schema === 'rami' ? (o.titolo || `Alternativa ${i + 1}`) : (TONO_LABEL[o.tono] ?? o.tono)}</span>
                        <span className="cs-opt-p">{o.testo.slice(0, 90)}{o.testo.length > 90 ? '…' : ''}</span>
                      </button>
                    ))}
                  </div>
                )}
                {/* v24: col nuovo schema UNA sola alternativa e' un esito legittimo ("i dati
                    decidono da soli"), non un giro andato male: il ripiego si annuncia solo se e'
                    davvero un ripiego, altrimenti si allarmerebbe l'operatrice per niente. */}
                {fallbackSingola && (
                  <div className="cs-note">Una sola proposta: la generazione si è interrotta. Rigenera per riprovare.</div>
                )}
                {schema === 'rami' && !fallbackSingola && options.length === 1 && (
                  <div className="cs-note">Una sola risposta possibile: i dati bastano a decidere, non ci sono esiti alternativi da scegliere.</div>
                )}
                {troncate > 0 && (
                  <div className="cs-note">⚠ {troncate === 1 ? 'Una proposta risulta tagliata a metà' : `${troncate} proposte risultano tagliate a metà`}: la generazione si è interrotta anche al secondo tentativo. Rigenera o completa a mano prima di inviare.</div>
                )}
                <div className="cs-draft-h">
                  <span>✍️ Bozza (ritoccala o chiedi una modifica)</span>
                  {daVer > 0 && <span className="cs-badge cs-warn">{daVer} da verificare</span>}
                  {nonGrounded.length > 0 && <span className="cs-badge cs-urg">⚠ {nonGrounded.length} non nel gestionale</span>}
                </div>
                <textarea className="cs-draft-ta" value={bozzaText} onChange={(e) => { setBozzaText(e.target.value); setSentTo(null); }} rows={8} />
                {nonGrounded.length > 0 && (
                  <div className="cs-lint">⚠️ <b>Controlla questi dati</b> — l&#8217;AI li ha scritti ma NON risultano dal gestionale: {nonGrounded.map((t, i) => <span key={i} className="cs-lint-t">{t}</span>)}</div>
                )}
                <div className="cs-refine">
                  <input className="cs-refine-in" value={refineTxt} onChange={(e) => setRefineTxt(e.target.value)} placeholder="Chiedi una modifica all’AI (es. più formale, aggiungi il reso)" onKeyDown={(e) => { if (e.key === 'Enter') doRefine(); }} disabled={refining} />
                  <button className="cs-btn cs-ghost" onClick={doRefine} disabled={refining || !refineTxt.trim()} type="button">{refining ? '…' : '✨ Applica'}</button>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                  {c.canale === 'chat_notifica' ? (
                    /* Fase 4, decisione owner 01-08: la chat si risponde DENTRO Inbox (niente invio da qui) */
                    <button className="cs-btn cs-primary" onClick={copiaEApriInbox} type="button">{copied ? '✓ Copiata' : '📋 Copia risposta e apri in Inbox ↗'}</button>
                  ) : (
                    CAN_SEND.has(c.canale) && c.customer_email && (
                      <button className="cs-btn cs-primary" onClick={openSend} disabled={sending || !!sentTo || !bozzaText.trim()} type="button">{sentTo ? '✓ Inviata' : '✉️ Invia…'}</button>
                    )
                  )}
                  {c.canale !== 'chat_notifica' && <button className="cs-btn cs-ghost" onClick={copiaBozza} type="button">{copied ? '✓ Copiata' : '📋 Copia'}</button>}
                  <button className="cs-btn cs-ghost" onClick={doGenOptions} disabled={genBozza} type="button">{genBozza ? '…' : '↻ Rigenera'}</button>
                </div>
                {CAN_SEND.has(c.canale) && !c.customer_email && (
                  <div className="cs-note" style={{ textAlign: 'left', marginTop: 8 }}>Email del cliente non presente: l&#8217;invio da qui non &#232; possibile, rispondi dal thread Gmail.</div>
                )}
                {fonti.length > 0 && (
                  <div className="cs-fonti">
                    <div className="cs-fonti-h">Fonti (dati recuperati dal gestionale)</div>
                    {fonti.map((f, i) => <div key={i} className="cs-fonti-row">• {f}</div>)}
                  </div>
                )}
              </>
            )}
            <div className="cs-note">Le bozze usano SOLO i dati reali; dove manca un dato scrivono [DA VERIFICARE]. {c.canale === 'chat_notifica' ? 'Copia e rispondi dentro Shopify Inbox (la chat non si invia da qui): chiudi lì la conversazione dopo la risposta.' : 'Controlla, ritocca e premi Invia: parte da info@amimi.it solo dopo la tua conferma.'}</div>
            {/* Fase 4: dialog di conferma — destinatario, canale e warning del linter SEMPRE in vista */}
            {sendOpen && (
              <div className="cs-sendwrap" role="dialog" aria-modal="true" aria-label="Conferma invio">
                <div className="cs-sendmodal">
                  <div className="cs-send-h">✉️ Conferma invio</div>
                  <div className="cs-send-row"><span className="k">A</span><b>{c.customer_email}</b></div>
                  <div className="cs-send-row"><span className="k">Da</span><span>info@amimi.it{ident && IDENTS[ident] ? ` · firma ${IDENTS[ident].n}` : ''}</span></div>
                  <div className="cs-send-row"><span className="k">Come</span><span>{c.canale === 'email_diretta' ? 'risposta nello stesso thread Gmail' : 'email nuova al cliente (il modulo del sito non è rispondibile)'}</span></div>
                  {/* v19 (brief cs_uiux_rifiniture punto 3): risposta gia' partita? Benny e Ginni
                      condividono account e coda, e il 01-08 la stessa cliente di test ha ricevuto
                      due risposte quasi identiche a un'ora e mezza di distanza senza nessun avviso.
                      Solo warning, mai blocco (decisione owner T12). */}
                  {(() => {
                    const ts = (d: string) => (msgs ?? []).filter((m) => m.direction === d && m.sent_at).map((m) => m.sent_at as string).sort().pop();
                    const out = ts('out'), inn = ts('in');
                    if (!out || (inn && inn > out)) return null;
                    const quando = new Date(out).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
                    return (
                      <div className="cs-lint" style={{ marginTop: 10 }}>
                        ⚠️ A questa cliente risulta <b>già inviata una risposta</b> il {quando}, e da allora non ha più scritto. Se è un secondo invio voluto va bene, altrimenti annulla.
                      </div>
                    );
                  })()}
                  {(() => {
                    // v19 (punto 4): i segnaposto rimasti nel testo FINALE, elencati per esteso. Una
                    // mail con [DA VERIFICARE: numero ordine] e [link resi] nel corpo e' partita
                    // davvero il 01-08: il linter li segnalava in fase di bozza, ma al momento
                    // dell'invio nessuno li rimetteva davanti agli occhi.
                    const ph = bozzaText.match(/\[[^\]\n]{2,}\]/g) || [];
                    if (!ph.length && !nonGrounded.length) return null;
                    return (
                      <div className="cs-lint" style={{ marginTop: 10 }}>
                        {ph.length > 0 && (
                          <div>
                            ⚠️ Nel testo ci sono ancora <b>{ph.length} segnaposto</b>: {ph.map((t, i) => <span key={i} className="cs-lint-t">{t}</span>)}
                            <div style={{ marginTop: 4 }}>Completali o toglili. Invia solo se è una scelta consapevole.</div>
                          </div>
                        )}
                        {nonGrounded.length > 0 && <div style={{ marginTop: ph.length > 0 ? 6 : 0 }}>⚠️ Dati NON trovati nel gestionale (dall&#8217;ultima generazione): {nonGrounded.map((t, i) => <span key={i} className="cs-lint-t">{t}</span>)}</div>}
                      </div>
                    );
                  })()}
                  <div className="cs-send-preview">{bozzaText}</div>
                  {sendErr && <div className="err" style={{ marginTop: 10 }}>{sendErr}</div>}
                  <div className="cs-send-actions">
                    <button className="cs-btn cs-ghost" onClick={() => setSendOpen(false)} disabled={sending} type="button">Annulla</button>
                    <button className="cs-btn cs-primary" onClick={doSend} disabled={sending} type="button">{sending ? 'Invio…' : '✓ Invia adesso'}</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // ---- rumore ----
  if (view === 'rumore') return (
    <div className="screen">
      <header>
        <button className="badge" onClick={goCoda} type="button">‹ Coda</button>
        <h1 style={{ fontSize: 18 }}>Rumore</h1>
        <span style={{ width: 40 }} />
      </header>
      {err && <div className="err">{err}</div>}
      {rumore === null ? <div className="muted center" style={{ padding: 20 }}>Carico…</div> :
        rumore.length === 0 ? <div className="muted center" style={{ padding: 20 }}>Niente rumore.</div> :
          rumore.map((c) => (
            <div key={c.id} className="cs-card cs-quiet" onClick={() => openThread(c)} role="button" tabIndex={0}>
              <div className="cs-ctop"><span className="cs-emoji">🔕</span><span className="cs-cn">{c.subject || nmeOf(c)}</span><span className="cs-cora">{fmtWhen(c.last_msg_at)}</span></div>
              <div style={{ marginTop: 6 }}>
                <button className="cs-btn cs-ghost" type="button" disabled={savingStato} onClick={(e) => { e.stopPropagation(); doUnNoise(c); }}>↩ È un cliente, riporta in coda</button>
              </div>
            </div>
          ))}
      <div className="cs-note">Nascosto di default, mai passato all&#8217;AI. Serve a controllare che il filtro non abbia nascosto un cliente per errore: se succede, &#8220;È un cliente&#8221; lo riporta in coda e sblocca il mittente.</div>
    </div>
  );

  // ---- coda ----
  const passa = (c: CsConversation) => filtro === 'tutte' ? true : filtro === 'fatte' ? c.stato === 'fatto' : filtro === 'incorso' ? c.stato === 'in_corso' : c.stato === 'da_fare';
  const list = (convs ?? []).filter(passa).slice().sort(urgSort);   // urgenti in cima (design 6.4)
  const daf = (convs ?? []).filter((c) => c.stato === 'da_fare').length;
  const inc = (convs ?? []).filter((c) => c.stato === 'in_corso').length;
  const fatte = (convs ?? []).filter((c) => c.stato === 'fatto').length;
  const urg = list.filter(isUrg).length;
  const rumCount = rumore?.length;

  const card = (c: CsConversation) => (
    <button key={c.id} className={'cs-card' + (isUrg(c) ? ' cs-cardurg' : '')}
      onClick={() => { if (suppressOpenRef.current === c.id) return; openThread(c); }}
      onTouchStart={(e) => { swipeRef.current = { id: c.id, x0: e.touches[0].clientX, dx: 0 }; }}
      onTouchMove={(e) => { const s = swipeRef.current; if (!s || s.id !== c.id) return; s.dx = e.touches[0].clientX - s.x0; if (s.dx < -8) setSwipeDx({ id: c.id, dx: s.dx }); }}
      onTouchEnd={() => { const s = swipeRef.current; swipeRef.current = null; setSwipeDx(null); if (s && s.dx < -90 && c.stato !== 'fatto') doSwipeDone(c); }}
      style={swipeDx?.id === c.id ? { transform: `translateX(${Math.max(swipeDx.dx, -150)}px)`, opacity: Math.max(0.35, 1 + swipeDx.dx / 400) } : undefined}
      type="button">
      <div className="cs-ctop">
        <span className="cs-cn">{nmeOf(c)}</span>
        {c.stato_by && c.stato !== 'da_fare' && KEY_BY_NAME[c.stato_by] && <span className="cs-assignee" title={c.stato_by}><Avatar k={KEY_BY_NAME[c.stato_by]} size={20} /></span>}
        <span className="cs-cora">{fmtWhen(c.last_msg_at)}</span>
      </div>
      <div className="cs-snip">{c.snippet || c.subject || ''}</div>
      <Badges c={c} />
      <div className="cs-badges">
        <span className="cs-badge cs-can">{CANALI[c.canale]}</span>
        {c.stato === 'in_corso' && <span className="cs-badge cs-state cs-state-prog">✋ {c.stato_by}</span>}
        {/* brief stato_automatico: distinguere a colpo d'occhio chiusa-da-sola da chiusa-da-persona */}
        {c.stato === 'fatto' && <span className="cs-badge cs-state cs-state-done">{c.stato_by === 'auto' ? '✓ chiusa da sola' : `✓ ${c.stato_by ?? 'conclusa'}`}</span>}
        {c.canale === 'chat_notifica' && <span className="cs-badge cs-chat">risposta in Inbox</span>}
        {c.parse_failed && <span className="cs-badge cs-warn">da rivedere</span>}
      </div>
    </button>
  );

  // PER TEMA: le 13 categorie nell'ordine del design + "Da confermare" (ai_low/senza categoria)
  const temaGroups = [
    ...CS_CATEGORIES.map((k) => ({ key: k.label, label: k.label, emoji: k.emoji, items: list.filter((c) => c.categoria === k.label) })),
    { key: '__daconf__', label: 'Da confermare', emoji: '🏷️', items: list.filter((c) => !c.categoria) },
  ].filter((g) => g.items.length > 0);
  const toggleCat = (key: string) => setCollapsed((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });

  return (
    <div className="screen">
      <header>
        <button onClick={() => setMenu((m) => !m)} type="button" style={{ flex: 1, textAlign: 'left', background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--dark)', fontSize: 18, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 9 }}>
          <Avatar k={ident} size={30} />
          <span>Ciao {IDENTS[ident]?.n ?? ident}, aiutiamo dei clienti! <span style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 400 }}>▾</span></span>
        </button>
      </header>
      {menu && <IdentMenu ident={ident} setIdent={(k) => { setIdent(k); setMenu(false); }} logout={logout} />}

      <div className="cs-stats">
        <span className="cs-stat"><b>{daf}</b> da iniziare</span>
        {inc > 0 && <span className="cs-stat"><b>{inc}</b> in corso</span>}
        {urg > 0 && <span className="cs-stat cs-staturg"><b>{urg}</b> 🚨 urgenti</span>}
        <span className="cs-stat"><b>{fatte}</b> concluse</span>
        <button onClick={doRefresh} disabled={refreshing} type="button" style={{ marginLeft: 'auto', background: 'none', border: '1px solid var(--line)', borderRadius: 999, padding: '6px 12px', fontSize: 12.5, fontWeight: 700, color: 'var(--rose)', cursor: 'pointer', opacity: refreshing ? 0.6 : 1 }}>{refreshing ? 'Aggiorno…' : '↻ Aggiorna'}</button>
      </div>
      <div className="cs-filterbar">
        {(([['dafare', 'Da iniziare', daf], ['incorso', 'In corso', inc], ['fatte', 'Concluse', fatte], ['tutte', 'Tutte', null]]) as [typeof filtro, string, number | null][]).map(([k, l, n]) => (
          <button key={k} className={'cs-fpill' + (filtro === k ? ' on' : '')} onClick={() => setFiltro(k)} type="button">
            {l}{n != null && n > 0 ? <span className="cs-fn">{n}</span> : null}
          </button>
        ))}
      </div>
      <div className="cs-sortrow">
        <span className="cs-sortlbl">Ordina per</span>
        <div className="cs-seg">
          {([['tempo', '🕗 Data'], ['tema', '🏷️ Tema']] as const).map(([k, l]) => (
            <button key={k} className={'cs-seg-btn' + (codaView === k ? ' on' : '')} onClick={() => setCodaView(k)} type="button">{l}</button>
          ))}
        </div>
      </div>
      {err && <div className="err">{err}</div>}
      {convs === null ? <div className="muted center" style={{ padding: 24 }}>Carico la coda…</div> :
        list.length === 0 ? <div className="muted center" style={{ padding: 24 }}>Niente qui: coda pulita ✨</div> :
        codaView === 'tempo' ?
          BUCKETS.map(([bk, label]) => {
            const g = list.filter((c) => bucketOf(c.last_msg_at) === bk);
            if (!g.length) return null;
            return (
              <div key={bk}>
                <div className="cs-sect">{label} <span className="cs-cnt">{g.length}</span></div>
                {g.map(card)}
              </div>
            );
          })
        :
          temaGroups.map((grp) => {
            const isColl = collapsed.has(grp.key);
            const nurg = grp.items.filter(isUrg).length;
            return (
              <div key={grp.key}>
                <button className="cs-sect cs-secttoggle" type="button" onClick={() => toggleCat(grp.key)}>
                  <span>{grp.emoji} {grp.label}</span>
                  <span className="cs-cnt">{nurg > 0 ? `${nurg}🚨 · ` : ''}{grp.items.length} {isColl ? '▸' : '▾'}</span>
                </button>
                {!isColl && grp.items.map(card)}
              </div>
            );
          })}
      <button className="cs-rumore" onClick={openRumore} type="button">🔕 Rumore nascosto (notifiche Shopify, spam, DMARC){rumCount != null ? `: ${rumCount}` : ''} ›</button>
      {toast && (
        <div className="cs-toast" role="status">
          <span>{toast.msg}</span>
          {toast.undo && <button type="button" onClick={() => { toast.undo?.(); setToast(null); }}>Annulla</button>}
        </div>
      )}
    </div>
  );
}

function IdentMenu({ ident, setIdent, logout }: { ident: string; setIdent: (k: string) => void; logout: () => void }) {
  return (
    <div className="cs-menu">
      <div className="cs-note" style={{ marginTop: 0, marginBottom: 8 }}>Chi sono? Firma ogni azione, resta su questo dispositivo.</div>
      {(['B', 'G', 'A'] as const).map((k) => (
        <button key={k} className={'cs-srow' + (ident === k ? ' on' : '')} onClick={() => setIdent(k)} type="button">
          <Avatar k={k} size={30} />
          <span>{IDENTS[k].n}</span>{ident === k && <span className="cs-tag">attiva</span>}
        </button>
      ))}
      <AiSettings ident={ident} />
      <button className="cs-srow" onClick={logout} type="button" style={{ justifyContent: 'center', color: 'var(--muted)' }}>Esci (logout)</button>
    </div>
  );
}

// "Come deve rispondere l'AI": mostra il motore attivo (Claude/Gemini) + istruzioni del team editabili.
// Le istruzioni guidano TUTTE le bozze; non superano mai la regola anti-invenzione (lato edge).
function AiSettings({ ident }: { ident: string }) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [txt, setTxt] = useState('');
  const [cfg, setCfg] = useState<{ provider: string; model: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const expand = async () => {
    const next = !open; setOpen(next);
    if (next && !loaded) {
      try { const c = await getAiConfig(); setTxt(c.istruzioni); setCfg({ provider: c.provider, model: c.model }); } catch { /* best-effort */ }
      setLoaded(true);
    }
  };
  const save = async () => {
    setSaving(true); setMsg('');
    try { await setAiIstruzioni(txt, ident); setMsg('Salvato ✓'); } catch (e) { setMsg((e as Error).message); }
    setSaving(false);
  };
  return (
    <div className="cs-aiset">
      <button className="cs-aiset-h" type="button" onClick={expand}>⚙️ Come deve rispondere l&#8217;AI <span>{open ? '▾' : '▸'}</span></button>
      {open && (
        <div className="cs-aiset-b">
          {cfg && <div className="cs-note" style={{ marginTop: 0 }}>Motore attivo: <b>{cfg.provider === 'claude' ? 'Claude (' + cfg.model + ')' : 'Gemini (gratis)'}</b></div>}
          {!loaded ? <div className="muted" style={{ fontSize: 12 }}>Carico…</div> : (
            <>
              <textarea className="cs-aiset-ta" value={txt} onChange={(e) => setTxt(e.target.value)} rows={7} placeholder="Es. Rispondi sempre calde e gentili, ringrazia, firma Team Amimì…" />
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button className="cs-btn cs-primary" type="button" onClick={save} disabled={saving}>{saving ? 'Salvo…' : 'Salva istruzioni'}</button>
                {msg && <span className="muted" style={{ fontSize: 12 }}>{msg}</span>}
              </div>
              <div className="cs-note">Guidano tutte le bozze AI. Non superano mai la regola anti-invenzione ([DA VERIFICARE]).</div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
