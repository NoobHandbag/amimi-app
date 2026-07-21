import { useEffect, useState } from 'react';
import { csClient } from '../lib/csClient';
import { fetchConversations, fetchRumore, fetchMessages } from '../lib/csApi';
import type { CsConversation, CsMessage, Canale } from '../lib/csApi';

// Sezione Assistenza clienti — FASE 1: SOLA LETTURA dietro login Supabase Auth.
// Login = solo cancello (@amimi.it); l'identita' che firma (Benny/Ginni) e' un selettore in-tool,
// ricordato per dispositivo (design 3.4). Niente AI, niente bozze, niente invio (Fasi 2-4).

const IDENTS: Record<string, { n: string; cls: string }> = { B: { n: 'Benedetta', cls: 'cs-b' }, G: { n: 'Ginevra', cls: 'cs-g' }, A: { n: 'Ale', cls: 'cs-a' } };
const CANALI: Record<Canale, string> = { email_diretta: '✉️ email', form_contatto: '📝 form sito', form_evento: '💍 form evento', chat_notifica: '💬 chat sito', rumore: '🔕 rumore' };
const BUCKETS: [string, string][] = [['oggi', 'Oggi'], ['ieri', 'Ieri'], ['sett', 'Questa settimana'], ['vecchie', 'Piu’ vecchie']];
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

export default function Assistenza({ onBack }: { onBack: () => void }) {
  const [session, setSession] = useState<'loading' | 'in' | 'out'>('loading');
  const [ident, setIdentS] = useState(() => localStorage.getItem('amimi_cs_ident') || '');
  const setIdent = (k: string) => { setIdentS(k); localStorage.setItem('amimi_cs_ident', k); };
  const [view, setView] = useState<'coda' | 'thread' | 'rumore'>('coda');
  const [filtro, setFiltro] = useState<'dafare' | 'fatte' | 'tutte'>('dafare');
  const [convs, setConvs] = useState<CsConversation[] | null>(null);
  const [rumore, setRumore] = useState<CsConversation[] | null>(null);
  const [current, setCurrent] = useState<CsConversation | null>(null);
  const [msgs, setMsgs] = useState<CsMessage[] | null>(null);
  const [menu, setMenu] = useState(false);
  const [err, setErr] = useState('');
  const [email, setEmail] = useState('');
  const [pwd, setPwd] = useState('');
  const [busy, setBusy] = useState(false);

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
  const openThread = async (c: CsConversation) => {
    setCurrent(c); setMsgs(null); setView('thread'); setErr('');
    try { setMsgs(await fetchMessages(c.id)); } catch (e) { setErr((e as Error).message); }
  };
  const openRumore = async () => {
    setView('rumore'); setErr('');
    if (!rumore) { try { setRumore(await fetchRumore()); } catch (e) { setErr((e as Error).message); } }
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
            <span className={'cs-av ' + IDENTS[k].cls}>{k}</span>
            <span className="cs-whn">{IDENTS[k].n}{k === 'A' ? ' (admin)' : ''}</span>
          </button>
        ))}
        <div className="cs-note">Ricordata su questo dispositivo. La cambi quando vuoi toccando l&#8217;avatar in alto.</div>
      </div>
    </div>
  );

  const av = IDENTS[ident] ?? IDENTS.A;

  // ---- thread ----
  if (view === 'thread' && current) {
    const c = current;
    return (
      <div className="screen">
        <header>
          <button className="badge" onClick={() => setView('coda')} type="button">‹ Coda</button>
          <span className={'cs-av ' + av.cls} onClick={() => setMenu((m) => !m)} role="button" tabIndex={0}>{ident}</span>
        </header>
        {menu && <IdentMenu ident={ident} setIdent={(k) => { setIdent(k); setMenu(false); }} logout={logout} />}
        <div className="card">
          <div className="cs-tnm">{nmeOf(c)}</div>
          <div className="cs-tem">{c.customer_email || '—'} · {CANALI[c.canale]}{c.order_number ? ` · ordine #${c.order_number}` : ''}</div>
          <div style={{ marginTop: 6 }}>
            <span className="cs-badge cs-can">{CANALI[c.canale]}</span>
            {c.parse_failed && <span className="cs-badge cs-warn">da rivedere</span>}
            <span className="cs-badge cs-state">{c.stato === 'fatto' ? '✓ fatta' : 'da fare'}</span>
          </div>
        </div>
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
        <div className="cs-note">Fase 1: sola lettura. Riassunto AI, bozza e invito arrivano nelle fasi successive.</div>
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
  const passa = (c: CsConversation) => filtro === 'tutte' ? true : filtro === 'fatte' ? c.stato === 'fatto' : c.stato === 'da_fare';
  const list = (convs ?? []).filter(passa);
  const daf = (convs ?? []).filter((c) => c.stato === 'da_fare').length;
  const fatte = (convs ?? []).filter((c) => c.stato === 'fatto').length;
  const rumCount = rumore?.length;

  return (
    <div className="screen">
      <header>
        <span className={'cs-av ' + av.cls} onClick={() => setMenu((m) => !m)} role="button" tabIndex={0}>{ident}</span>
        <div style={{ flex: 1 }}><h1 style={{ fontSize: 19 }}>Assistenza</h1></div>
        <button className="badge" onClick={onBack} type="button">Home app</button>
      </header>
      {menu && <IdentMenu ident={ident} setIdent={(k) => { setIdent(k); setMenu(false); }} logout={logout} />}

      <div className="cs-stats">
        <span className="cs-stat"><b>{daf}</b> da fare</span>
        <span className="cs-stat"><b>{fatte}</b> fatte</span>
      </div>
      <div className="cs-chips">
        {([['dafare', 'Da fare'], ['fatte', 'Fatte'], ['tutte', 'Tutte']] as const).map(([k, l]) => (
          <button key={k} className={'cs-chip' + (filtro === k ? ' on' : '')} onClick={() => setFiltro(k)} type="button">{l}</button>
        ))}
      </div>
      {err && <div className="err">{err}</div>}
      {convs === null ? <div className="muted center" style={{ padding: 24 }}>Carico la coda…</div> :
        list.length === 0 ? <div className="muted center" style={{ padding: 24 }}>Niente qui: coda pulita ✨</div> :
          BUCKETS.map(([bk, label]) => {
            const g = list.filter((c) => bucketOf(c.last_msg_at) === bk);
            if (!g.length) return null;
            return (
              <div key={bk}>
                <div className="cs-sect">{label} <span className="cs-cnt">{g.length}</span></div>
                {g.map((c) => (
                  <button key={c.id} className="cs-card" onClick={() => openThread(c)} type="button">
                    <div className="cs-ctop">
                      <span className="cs-cn">{nmeOf(c)}</span>
                      <span className="cs-cora">{fmtWhen(c.last_msg_at)}</span>
                    </div>
                    <div className="cs-snip">{c.snippet || c.subject || ''}</div>
                    <div className="cs-badges">
                      <span className="cs-badge cs-can">{CANALI[c.canale]}</span>
                      {c.canale === 'chat_notifica' && <span className="cs-badge cs-chat">solo lettura</span>}
                      {c.parse_failed && <span className="cs-badge cs-warn">da rivedere</span>}
                    </div>
                  </button>
                ))}
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
          <span className={'cs-av ' + IDENTS[k].cls} style={{ width: 30, height: 30, fontSize: 13 }}>{k}</span>
          <span>{IDENTS[k].n}</span>{ident === k && <span className="cs-tag">attiva</span>}
        </button>
      ))}
      <button className="cs-srow" onClick={logout} type="button" style={{ justifyContent: 'center', color: 'var(--muted)' }}>Esci (logout)</button>
    </div>
  );
}
