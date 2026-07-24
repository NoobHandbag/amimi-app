import { useEffect, useRef, useState } from 'react';
import { csClient } from '../lib/csClient';
import { fetchConversations, fetchRumore, fetchMessages, csPollNow, setCategoria, setStato, addNoise, fetchContext, fetchCaseData, generateOptions, refineDraft, catEmoji, CS_CATEGORIES, CASE_CATS } from '../lib/csApi';
import type { CsConversation, CsMessage, Canale, CsContext, DraftOption, CaseData, Stato } from '../lib/csApi';

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
const SHOPIFY_INBOX = 'https://admin.shopify.com/store/amimi-10000/apps/inbox';

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
  // guardia race (audit #7): le risposte async di un thread APERTO PRIMA non devono scrivere sul corrente
  const threadRef = useRef('');
  const [selIdx, setSelIdx] = useState(0);
  const [daVer, setDaVer] = useState(0);
  const [fonti, setFonti] = useState<string[]>([]);
  const [bozzaText, setBozzaText] = useState('');
  const [genBozza, setGenBozza] = useState(false);
  const [refineTxt, setRefineTxt] = useState('');
  const [refining, setRefining] = useState(false);
  const [copied, setCopied] = useState(false);
  const [convs, setConvs] = useState<CsConversation[] | null>(null);
  const [rumore, setRumore] = useState<CsConversation[] | null>(null);
  const [current, setCurrent] = useState<CsConversation | null>(null);
  const [msgs, setMsgs] = useState<CsMessage[] | null>(null);
  const [menu, setMenu] = useState(false);
  const [err, setErr] = useState('');
  const [email, setEmail] = useState('');
  const [pwd, setPwd] = useState('');
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    csClient.auth.getSession().then(({ data }) => setSession(data.session ? 'in' : 'out'));
    const { data: sub } = csClient.auth.onAuthStateChange((_e, s) => setSession(s ? 'in' : 'out'));
    return () => sub.subscription.unsubscribe();
  }, []);

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
    threadRef.current = c.id;
    setCurrent(c); setMsgs(null); setView('thread'); setErr('');
    setCtx(null); setCaso(null); setConfirmDate(''); setOptions(null); setBozzaText(''); setFonti([]); setRefineTxt(''); setCopied(false);
    try { const m = await fetchMessages(c.id); if (threadRef.current === c.id) setMsgs(m); }
    catch (e) { if (threadRef.current === c.id) setErr((e as Error).message); }
    // Contesto (link ordine + storico acquisti): nessuna spesa AI, best-effort (non blocca il thread).
    if (c.canale !== 'chat_notifica' && c.canale !== 'rumore') {
      fetchContext(c.id).then((x) => { if (threadRef.current === c.id) setCtx(x); }).catch(() => { /* testata best-effort */ });
      if (c.categoria && CASE_CATS.has(c.categoria)) loadCaso(c.id);
    }
  };
  // Fase 3: 3 opzioni di risposta con dati reali (edge cs-assist, JWT). Recupero dati deterministico + Gemini.
  const doGenOptions = async () => {
    if (!current) return;
    const tid = current.id;
    setGenBozza(true); setErr(''); setCopied(false);
    try {
      const r = await generateOptions(tid, ident, confirmDate || undefined);
      if (threadRef.current !== tid) return;   // thread cambiato nel frattempo: butta la risposta
      setOptions(r.options); setSelIdx(0); setBozzaText(r.options[0]?.testo ?? ''); setDaVer(r.options[0]?.da_verificare ?? 0); setFonti(r.fonti);
      if (!ctx) setCtx({ fonti: r.fonti, order_admin_url: r.order_admin_url, storia: r.storia });
    } catch (e) { if (threadRef.current === tid) setErr((e as Error).message); }
    if (threadRef.current === tid) setGenBozza(false);
  };
  const pickOption = (i: number) => { if (!options?.[i]) return; setSelIdx(i); setBozzaText(options[i].testo); setDaVer(options[i].da_verificare); setCopied(false); };
  // "Chiedi una modifica": l'AI riscrive la bozza corrente applicando l'istruzione, sempre sui dati reali.
  const doRefine = async () => {
    if (!current || !bozzaText.trim() || !refineTxt.trim()) return;
    const tid = current.id;
    setRefining(true); setErr(''); setCopied(false);
    try { const r = await refineDraft(tid, ident, bozzaText, refineTxt); if (threadRef.current === tid) { setBozzaText(r.draft); setDaVer(r.da_verificare); setRefineTxt(''); } }
    catch (e) { if (threadRef.current === tid) setErr((e as Error).message); }
    if (threadRef.current === tid) setRefining(false);
  };
  const copiaBozza = async () => { try { await navigator.clipboard.writeText(bozzaText); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* no clipboard */ } };
  const openRumore = async () => {
    setView('rumore'); setErr('');
    if (!rumore) { try { setRumore(await fetchRumore()); } catch (e) { setErr((e as Error).message); } }
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
      setView('coda');
    } catch (e) { setErr((e as Error).message); }
    setSavingStato(false);
  };
  // swipe a sinistra su una card = conclusa (sparisce da "Da iniziare", la ritrovi in "Concluse")
  const doSwipeDone = (c: CsConversation) => {
    suppressOpenRef.current = c.id;
    setTimeout(() => { if (suppressOpenRef.current === c.id) suppressOpenRef.current = ''; }, 450);
    void doStato(c, 'fatto');
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
    return (
      <div className="screen">
        <header>
          <button className="badge" onClick={() => setView('coda')} type="button">‹ Coda</button>
          <button onClick={() => setMenu((m) => !m)} type="button" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontWeight: 700, fontSize: 13 }}>{IDENTS[ident]?.n ?? ident} ▾</button>
        </header>
        {menu && <IdentMenu ident={ident} setIdent={(k) => { setIdent(k); setMenu(false); }} logout={logout} />}
        <div className="card">
          <div className="cs-tnm">{nmeOf(c)}</div>
          <div className="cs-tem">{c.customer_email || '—'} · {CANALI[c.canale]}{c.order_number ? ` · ordine #${c.order_number}` : ''}</div>
          <div style={{ marginTop: 6 }}>
            <span className="cs-badge cs-can">{CANALI[c.canale]}</span>
            {c.parse_failed && <span className="cs-badge cs-warn">da rivedere</span>}
            <span className={'cs-badge cs-state' + (c.stato === 'fatto' ? ' cs-state-done' : c.stato === 'in_corso' ? ' cs-state-prog' : '')}>
              {c.stato === 'fatto' ? `✓ conclusa${c.stato_by ? ' · ' + c.stato_by : ''}` : c.stato === 'in_corso' ? `✋ in corso · ${c.stato_by ?? ''}` : 'da iniziare'}
            </span>
          </div>
          {c.canale !== 'rumore' && <Badges c={c} />}
          {c.canale !== 'rumore' && (
            <div className="cs-catedit">
              <label>Categoria</label>
              <select value={c.categoria ?? ''} disabled={savingCat} onChange={(e) => applyCat(e.target.value || null)}>
                <option value="">— da confermare —</option>
                {CS_CATEGORIES.map((k) => <option key={k.label} value={k.label}>{k.emoji} {k.label}</option>)}
              </select>
              {savingCat && <span className="muted" style={{ fontSize: 12 }}>salvo…</span>}
            </div>
          )}
          {c.canale !== 'rumore' && (
            <div className="cs-actions-row">
              {c.stato === 'da_fare' && <button className="cs-btn cs-ghost" disabled={savingStato} onClick={() => doStato(c, 'in_corso')} type="button">✋ Prendo io</button>}
              {c.stato !== 'fatto'
                ? <button className="cs-btn cs-ghost cs-okbtn" disabled={savingStato} onClick={() => doStato(c, 'fatto')} type="button">✓ Conclusa</button>
                : <button className="cs-btn cs-ghost" disabled={savingStato} onClick={() => doStato(c, 'da_fare')} type="button">↩ Riapri</button>}
              <button className="cs-btn cs-ghost cs-noisebtn" disabled={savingStato} onClick={() => doNoise(c)} type="button">🚫 Non è un cliente</button>
            </div>
          )}
        </div>
        {c.canale !== 'rumore' && ctx && (ctx.order_admin_url || (ctx.storia && ctx.storia.n_ordini > 0)) && (
          <div className="cs-ctx">
            {ctx.order_admin_url && (
              <a className="cs-orderlink" href={ctx.order_admin_url} target="_blank" rel="noreferrer">🛍 Apri ordine{c.order_number ? ` #${c.order_number}` : ''} su Shopify ↗</a>
            )}
            {ctx.storia && ctx.storia.n_ordini > 0 && (
              <div className="cs-storia">
                <div className="cs-storia-h">🧾 Cliente: <b>{ctx.storia.n_ordini}</b> {ctx.storia.n_ordini === 1 ? 'ordine' : 'ordini'} · <b>{ctx.storia.totale}€</b> totali{ctx.storia.n_ordini > 1 ? ' · abituale' : ''}</div>
                <div className="cs-storia-list">
                  {ctx.storia.recenti.map((o, i) => <span key={i} className="cs-storia-row">#{o.numero} · {o.data} · {o.totale}€</span>)}
                </div>
              </div>
            )}
          </div>
        )}
        {c.summary && (
          <div className="cs-summary"><span className="cs-summary-h">📝 Riassunto e storia</span>{c.summary}</div>
        )}
        {c.canale === 'chat_notifica' && (
          <div className="cs-banner">💬 Conversazione della chat del sito (Shopify Inbox): il tool la legge dalle email di notifica. Si risponde dentro Shopify Inbox.
            <div style={{ marginTop: 8 }}><a className="cs-btn cs-inbox" href={SHOPIFY_INBOX} target="_blank" rel="noreferrer">Apri Shopify Inbox ↗</a></div>
          </div>
        )}
        {err && <div className="err">{err}</div>}
        {msgs === null ? <div className="muted center" style={{ padding: 20 }}>Carico messaggi…</div> :
          msgs.length === 0 ? <div className="muted center" style={{ padding: 20 }}>Nessun messaggio.</div> :
            msgs.map((m) => (
              <div key={m.id} className={'cs-msg ' + (m.direction === 'out' ? 'out' : 'in')}>
                <div className="cs-who">{m.direction === 'out' ? (m.sent_by || 'Amimi’') + ' · ' : ''}{fmtWhen(m.sent_at)}</div>
                {m.form_fields && Object.keys(m.form_fields).length > 0 && (
                  <div className="cs-form">{Object.entries(m.form_fields).map(([k, v]) => <div key={k}><b>{k}:</b> {v}</div>)}</div>
                )}
                <div className="cs-body">{m.body_text || m.form_fields ? (m.body_text || '') : '(vuoto)'}</div>
              </div>
            ))}
        {c.canale !== 'chat_notifica' && c.canale !== 'rumore' && c.categoria && CASE_CATS.has(c.categoria) && caso && (
          <div className="cs-case">
            <div className="cs-case-h">{c.categoria === 'Modifica / correzione indirizzo' ? '📍 Caso indirizzo — calcolato dal sistema' : '↩️ Caso reso — calcolato dal sistema'}</div>
            {c.categoria === 'Modifica / correzione indirizzo' ? (
              caso.indirizzo.caso === 'correggibile' ? (
                <div className="cs-verdict cs-v-ok"><b>🚚 Non ancora ritirata dal corriere · ✅ correggibile</b><span>Chiedi l&#8217;indirizzo completo; correggi su Shopify e TWS prima del ritiro.</span></div>
              ) : caso.indirizzo.caso === 'consegnato' ? (
                <div className="cs-verdict cs-v-no"><b>📬 Risulta gia&#8217; consegnata · nulla da fare sulla spedizione</b><span>Bozza: empatia + vicini/portineria, niente promesse impossibili.</span></div>
              ) : caso.indirizzo.caso === 'verificare_tracking' ? (
                <div className="cs-verdict cs-v-warn"><b>🚚 Gia&#8217; partita: in viaggio o gia&#8217; consegnata?</b><span>{caso.tracking_url ? <>Controlla dal <a href={caso.tracking_url} target="_blank" rel="noreferrer">tracking ↗</a> — la bozza resta prudente su entrambe le ipotesi.</> : 'Tracking non disponibile: la bozza resta prudente su entrambe le ipotesi.'}</span></div>
              ) : (
                <div className="cs-verdict cs-v-info"><b>Stato spedizione non determinabile</b><span>Ordine non agganciato con certezza alla cliente: la bozza usa [DA VERIFICARE].</span></div>
              )
            ) : (
              <>
                {caso.reso.difetto_sospetto && (
                  <div className="cs-verdict cs-v-warn"><b>⚠️ Possibile difetto segnalato</b><span>La finestra non si applica da sola (garanzia legale 24 mesi): bozza prudente, mai un rifiuto.</span></div>
                )}
                {caso.reso.verdetto === 'entro' ? (
                  <div className="cs-verdict cs-v-ok"><b>📦 Consegnata il {caso.reso.delivered_at} · {caso.reso.giorni} giorni fa · ✅ ENTRO i {caso.reso.finestra}</b><span>Fonte: {caso.reso.fonte}. Reso ammesso: istruzioni + rientro a carico cliente + rimborso in 14 giorni.</span></div>
                ) : caso.reso.verdetto === 'fuori' ? (
                  <div className="cs-verdict cs-v-no"><b>📦 Consegnata il {caso.reso.delivered_at} · {caso.reso.giorni} giorni fa · ⛔ FUORI dai {caso.reso.finestra}</b><span>Fonte: {caso.reso.fonte}. Rifiuto garbato con un&#8217;alternativa (salvo difetto).</span></div>
                ) : (
                  <div className="cs-verdict cs-v-info">
                    <b>Data di consegna non nota</b>
                    <span>{caso.tracking_url ? <>Leggila dal <a href={caso.tracking_url} target="_blank" rel="noreferrer">tracking ↗</a> e confermala qui: il conteggio dei {caso.reso.finestra} giorni lo fa il sistema.</> : 'Senza data niente verdetto: la bozza usa [DA VERIFICARE].'}</span>
                    <div className="cs-case-row">
                      <input type="date" value={confirmDate} onChange={(e) => setConfirmDate(e.target.value)} aria-label="Data di consegna" />
                      <button className="cs-btn cs-ghost" type="button" disabled={!confirmDate || casoBusy} onClick={() => loadCaso(c.id, confirmDate)}>{casoBusy ? '…' : '✓ Conferma data'}</button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
        {c.canale !== 'chat_notifica' && c.canale !== 'rumore' && (
          <div className="cs-draftbox">
            {!options ? (
              <button className="cs-btn cs-primary" style={{ width: '100%' }} onClick={doGenOptions} disabled={genBozza} type="button">
                {genBozza ? 'Genero 3 proposte…' : '✍️ Genera 3 risposte con i dati reali'}
              </button>
            ) : (
              <>
                {options.length > 1 && (
                  <div className="cs-opts">
                    {options.map((o, i) => (
                      <button key={i} className={'cs-opt' + (i === selIdx ? ' on' : '')} onClick={() => pickOption(i)} type="button">
                        <span className="cs-opt-t">{TONO_LABEL[o.tono] ?? o.tono}</span>
                        <span className="cs-opt-p">{o.testo.slice(0, 90)}{o.testo.length > 90 ? '…' : ''}</span>
                      </button>
                    ))}
                  </div>
                )}
                <div className="cs-draft-h">
                  <span>✍️ Bozza (ritoccala o chiedi una modifica)</span>
                  {daVer > 0 && <span className="cs-badge cs-warn">{daVer} da verificare</span>}
                </div>
                <textarea className="cs-draft-ta" value={bozzaText} onChange={(e) => setBozzaText(e.target.value)} rows={8} />
                <div className="cs-refine">
                  <input className="cs-refine-in" value={refineTxt} onChange={(e) => setRefineTxt(e.target.value)} placeholder="Chiedi una modifica all’AI (es. più formale, aggiungi il reso)" onKeyDown={(e) => { if (e.key === 'Enter') doRefine(); }} disabled={refining} />
                  <button className="cs-btn cs-ghost" onClick={doRefine} disabled={refining || !refineTxt.trim()} type="button">{refining ? '…' : '✨ Applica'}</button>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button className="cs-btn cs-primary" onClick={copiaBozza} type="button">{copied ? '✓ Copiata' : '📋 Copia'}</button>
                  <button className="cs-btn cs-ghost" onClick={doGenOptions} disabled={genBozza} type="button">{genBozza ? '…' : '↻ Rigenera'}</button>
                </div>
                {fonti.length > 0 && (
                  <div className="cs-fonti">
                    <div className="cs-fonti-h">Fonti (dati recuperati dal gestionale)</div>
                    {fonti.map((f, i) => <div key={i} className="cs-fonti-row">• {f}</div>)}
                  </div>
                )}
              </>
            )}
            <div className="cs-note">Le bozze usano SOLO i dati reali; dove manca un dato scrivono [DA VERIFICARE]. Ritocca e copia nel thread Gmail. L&#8217;invio dal tool arriva in Fase 4.</div>
          </div>
        )}
      </div>
    );
  }

  // ---- rumore ----
  if (view === 'rumore') return (
    <div className="screen">
      <header>
        <button className="badge" onClick={() => setView('coda')} type="button">‹ Coda</button>
        <h1 style={{ fontSize: 18 }}>Rumore</h1>
        <span style={{ width: 40 }} />
      </header>
      {err && <div className="err">{err}</div>}
      {rumore === null ? <div className="muted center" style={{ padding: 20 }}>Carico…</div> :
        rumore.length === 0 ? <div className="muted center" style={{ padding: 20 }}>Niente rumore.</div> :
          rumore.map((c) => (
            <button key={c.id} className="cs-card cs-quiet" onClick={() => openThread(c)} type="button">
              <div className="cs-ctop"><span className="cs-emoji">🔕</span><span className="cs-cn">{c.subject || nmeOf(c)}</span><span className="cs-cora">{fmtWhen(c.last_msg_at)}</span></div>
            </button>
          ))}
      <div className="cs-note">Nascosto di default, mai passato all&#8217;AI. Serve solo a controllare che il filtro non abbia nascosto un cliente per errore.</div>
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
        {c.canale === 'chat_notifica' && <span className="cs-badge cs-chat">solo lettura</span>}
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
      <div className="cs-chips">
        {([['dafare', 'Da iniziare'], ['incorso', 'In corso'], ['fatte', 'Concluse'], ['tutte', 'Tutte']] as const).map(([k, l]) => (
          <button key={k} className={'cs-chip' + (filtro === k ? ' on' : '')} onClick={() => setFiltro(k)} type="button">{l}</button>
        ))}
        <span className="cs-seg" style={{ marginLeft: 'auto' }}>
          {([['tempo', '🕗 Tempo'], ['tema', '🏷️ Tema']] as const).map(([k, l]) => (
            <button key={k} className={'cs-seg-btn' + (codaView === k ? ' on' : '')} onClick={() => setCodaView(k)} type="button">{l}</button>
          ))}
        </span>
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
      <button className="cs-srow" onClick={logout} type="button" style={{ justifyContent: 'center', color: 'var(--muted)' }}>Esci (logout)</button>
    </div>
  );
}
