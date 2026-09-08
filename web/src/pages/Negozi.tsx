import { useEffect, useMemo, useState } from 'react';
import { csClient } from '../lib/csClient';
import { fetchDossier, fetchEvidence, fetchContacts, fetchReviews, signedUrls, addReview, TIPO_LABEL, STATO_LABEL, CRITERI_ORDER } from '../lib/leadApi';
import type { LeadDossier, LeadEvidence, LeadContact, LeadReview } from '../lib/leadApi';
import { personaName } from '../lib/people';
import { pushBack, popBack } from '../lib/backnav';
import ExportBtn from '../components/ExportBtn';

// Pagina "Negozi B2B" (modulo lead_*, migr 0111). Mostra il dossier di ogni negozio o gruppo
// raccolto dal collector (workers/lead) e valutato dalla sessione Claude con la rubrica v1
// (PIANO_Ricerca_e_Outreach_B2B.md cap. 3.4). L'unica scrittura e' la decisione umana (lead_reviews).
// Login: stesso client e stessa sessione dell'Assistenza (csClient, RLS @amimi.it).

const fmtN = (n: number | null | undefined) => (n == null ? '—' : new Intl.NumberFormat('it-IT').format(n));
const eur = (n: number | null | undefined) => (n == null ? '—' : `${Math.round(n)}€`);
const short = (s: string | null | undefined, n = 110) => (!s ? '' : s.length > n ? s.slice(0, n - 1) + '…' : s);
const tierColor = (t: string | null | undefined) => (t === 'A' ? 'var(--positive)' : t === 'B' ? 'var(--warning)' : t === 'C' ? 'var(--ink-muted)' : 'var(--border-strong)');
const scoreColor = (n: number | null | undefined) => (n == null ? 'var(--border-strong)' : n >= 75 ? 'var(--positive)' : n >= 55 ? 'var(--warning)' : 'var(--negative)');

type View = 'lista' | 'tabella' | 'scheda';

export default function Negozi({ onBack, chi }: { onBack?: () => void; chi: string }) {
  const [session, setSession] = useState<'?' | 'in' | 'out'>('?');
  const [email, setEmail] = useState(''); const [pwd, setPwd] = useState(''); const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [rows, setRows] = useState<LeadDossier[] | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [view, setView] = useState<View>('lista');
  const [cur, setCur] = useState<LeadDossier | null>(null);
  const [fStato, setFStato] = useState<string>('tutti');
  const [fTier, setFTier] = useState<string>('tutti');
  const [fTipo, setFTipo] = useState<string>('tutti');
  const [q, setQ] = useState('');
  const who = personaName(chi);

  useEffect(() => {
    csClient.auth.getSession().then(({ data }) => setSession(data.session ? 'in' : 'out'));
    const { data: sub } = csClient.auth.onAuthStateChange((_e, s) => setSession(s ? 'in' : 'out'));
    return () => sub.subscription.unsubscribe();
  }, []);

  const load = async () => {
    setErr('');
    try {
      const r = await fetchDossier(); setRows(r);
      const paths = r.flatMap((x) => [x.shot_ig, x.shot_home, x.shot_home_mobile, x.shot_maps]).filter((p): p is string => !!p);
      setUrls(await signedUrls(paths));
      if (cur) setCur(r.find((x) => x.id === cur.id) ?? null);
    } catch (e) { setErr((e as Error).message); }
  };
  useEffect(() => { if (session === 'in') load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [session]);

  const doLogin = async () => {
    setBusy(true); setErr('');
    const { error } = await csClient.auth.signInWithPassword({ email: email.trim(), password: pwd });
    setBusy(false);
    if (error) setErr('Accesso non riuscito. Controlla email e password.'); else setPwd('');
  };
  const doGoogle = async () => {
    setBusy(true); setErr('');
    const { error } = await csClient.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin + import.meta.env.BASE_URL, queryParams: { hd: 'amimi.it', prompt: 'select_account' } } });
    if (error) { setBusy(false); setErr('Google non attivo: usa email e password.'); }
  };

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (rows ?? []).filter((r) =>
      (fStato === 'tutti' || r.stato_ricerca === fStato) &&
      (fTier === 'tutti' || (fTier === 'senza' ? !r.tier && !r.tier_proposto : (r.tier ?? r.tier_proposto) === fTier)) &&
      (fTipo === 'tutti' || r.tipo === fTipo) &&
      (!s || `${r.nome} ${r.citta ?? ''} ${r.ig_handle ?? ''} ${(r.brands_carried?.peer_match ?? []).join(' ')}`.toLowerCase().includes(s)));
  }, [rows, fStato, fTier, fTipo, q]);

  const openScheda = (r: LeadDossier) => { pushBack(() => { setCur(null); setView('lista'); }); setCur(r); setView('scheda'); };
  const closeScheda = () => popBack(() => { setCur(null); setView('lista'); });

  if (session === '?') return <div className="screen"><header><h1>Negozi B2B</h1></header><p className="muted center">Controllo l&#8217;accesso…</p></div>;
  if (session === 'out') return (
    <div className="screen">
      <header><button className="badge" onClick={onBack} type="button">‹ Home app</button></header>
      <div className="cs-login">
        <div className="cs-logo">amimi<span>&#8217; negozi B2B</span></div>
        <div className="cs-lt">Accedi con il tuo account Amimi&#8217; (dati di terzi: serve il login)</div>
        <button className="cs-btn" style={{ width: '100%', background: '#fff', border: '1px solid var(--border)', color: 'var(--ink)' }} onClick={doGoogle} disabled={busy} type="button">Accedi con Google</button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '14px 0 4px', color: 'var(--ink-muted)', fontSize: 12 }}><span style={{ flex: 1, height: 1, background: 'var(--border)' }} /> oppure con email <span style={{ flex: 1, height: 1, background: 'var(--border)' }} /></div>
        <div className="cs-fld"><label>Email (@amimi.it)</label><input type="email" autoCapitalize="none" autoCorrect="off" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="info@amimi.it" /></div>
        <div className="cs-fld"><label>Password</label><input type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') doLogin(); }} /></div>
        {err && <div className="err" style={{ marginBottom: 8 }}>{err}</div>}
        <button className="cs-btn cs-primary" style={{ width: '100%' }} onClick={doLogin} disabled={busy} type="button">{busy ? 'Accesso…' : 'Entra'}</button>
      </div>
    </div>
  );

  if (view === 'scheda' && cur) return <Scheda r={cur} urls={urls} who={who} onBack={closeScheda} onChanged={load} />;

  const counts = (k: keyof LeadDossier) => { const m = new Map<string, number>(); (rows ?? []).forEach((r) => { const v = String(r[k] ?? '—'); m.set(v, (m.get(v) ?? 0) + 1); }); return m; };
  const byStato = counts('stato_ricerca');
  const tipi = [...new Set((rows ?? []).map((r) => r.tipo))];

  return (
    <div className="screen">
      <header>
        <h1>Negozi B2B</h1>
        <div className="operbar">
          <button className="badge" onClick={load} type="button">Aggiorna</button>
          <ExportBtn name="negozi_b2b" rows={() => list.map((r) => ({ nome: r.nome, tipo: r.tipo, citta: r.citta, paese: r.paese, stato: r.stato_ricerca, totale: r.totale, tier_proposto: r.tier_proposto, tier: r.tier, follower: r.ig_metrics?.follower ?? null, rating: r.maps?.rating ?? null, recensioni: r.maps?.recensioni ?? null, borse_mediana: r.price_band?.borse?.mediana ?? null, brand_affini: (r.brands_carried?.peer_match ?? []).join(' '), sito: r.website, instagram: r.ig_handle, email: r.email_generica, telefono: r.telefono ?? r.maps?.telefono ?? null, gancio: r.gancio, nota: r.owner_note }))} />
        </div>
      </header>
      {onBack && <button className="back" onClick={onBack} type="button">← Home</button>}
      {err && <div className="card err">Errore: {err}</div>}
      {!rows ? <p className="muted center">Carico i negozi…</p> : (
        <>
          <div className="kpis">
            <div className="ds-kpi"><div className="v">{rows.length}</div><div className="l">Profili nel database</div><div className="s">pilota 08-09</div></div>
            <div className="ds-kpi"><div className="v">{byStato.get('scored') ?? 0}</div><div className="l">Valutati, da rivedere</div><div className="s">score pronto, decisione umana mancante</div></div>
            <div className="ds-kpi pos"><div className="v">{rows.filter((r) => r.tier === 'A').length}</div><div className="l">Tier A decisi</div><div className="s">{rows.filter((r) => r.tier_proposto === 'A').length} proposti dal modello</div></div>
            <div className="ds-kpi"><div className="v">{byStato.get('rejected') ?? 0}</div><div className="l">Scartati</div><div className="s">{byStato.get('seed') ?? 0} ancora da raccogliere</div></div>
          </div>

          <section className="card">
            <div className="ds-search" style={{ marginBottom: 8 }}><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cerca nome, citta', Instagram, brand…" aria-label="Cerca negozio" /></div>
            <div className="chips" style={{ marginBottom: 6 }}>
              {['tutti', 'seed', 'enriched', 'scored', 'reviewed', 'rejected'].map((s) => <button key={s} type="button" className={`chip ${fStato === s ? 'on' : ''}`} onClick={() => setFStato(s)}>{s === 'tutti' ? 'Tutti' : STATO_LABEL[s]}{s !== 'tutti' && byStato.get(s) ? ` · ${byStato.get(s)}` : ''}</button>)}
            </div>
            <div className="chips" style={{ marginBottom: 6 }}>
              {['tutti', 'A', 'B', 'C', 'senza'].map((t) => <button key={t} type="button" className={`chip ${fTier === t ? 'on' : ''}`} onClick={() => setFTier(t)}>{t === 'tutti' ? 'Ogni tier' : t === 'senza' ? 'Senza tier' : `Tier ${t}`}</button>)}
              <span style={{ width: 8 }} />
              {['tutti', ...tipi].map((t) => <button key={t} type="button" className={`chip ${fTipo === t ? 'on' : ''}`} onClick={() => setFTipo(t)}>{t === 'tutti' ? 'Ogni tipo' : TIPO_LABEL[t] ?? t}</button>)}
            </div>
            <div className="seg" style={{ marginTop: 4 }}>
              <button type="button" className={view === 'lista' ? 'on' : ''} onClick={() => setView('lista')}>Schede</button>
              <button type="button" className={view === 'tabella' ? 'on' : ''} onClick={() => setView('tabella')}>Tabella</button>
            </div>
          </section>

          {view === 'tabella' ? (
            <section className="card">
              <div className="tablewrap"><table className="sortable">
                <thead><tr><th>Negozio</th><th>Citta&#8217;</th><th>Tipo</th><th>Stato</th><th>Score</th><th>Tier</th><th>Follower</th><th>Rating</th><th>Borse (mediana)</th><th>Brand affini</th><th>Evid.</th></tr></thead>
                <tbody>{list.map((r) => (
                  <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => openScheda(r)}>
                    <td className="l">{r.nome}</td><td className="l">{r.citta ?? r.paese}</td><td className="l">{TIPO_LABEL[r.tipo] ?? r.tipo}</td><td className="l">{STATO_LABEL[r.stato_ricerca]}</td>
                    <td style={{ color: scoreColor(r.totale), fontWeight: 700 }}>{r.totale ?? '—'}</td>
                    <td>{r.tier ?? (r.tier_proposto ? `${r.tier_proposto}?` : '—')}</td>
                    <td>{fmtN(r.ig_metrics?.follower)}</td><td>{r.maps?.rating != null ? `${r.maps.rating} (${fmtN(r.maps.recensioni)})` : '—'}</td>
                    <td>{eur(r.price_band?.borse?.mediana)}</td><td className="l">{(r.brands_carried?.peer_match ?? []).join(', ') || '—'}</td><td>{r.n_evidenze}</td>
                  </tr>
                ))}</tbody>
              </table></div>
              <p className="note">Tocca una riga per aprire la scheda. "A?" = tier proposto dal modello, non ancora deciso da una persona.</p>
            </section>
          ) : (
            <div className="lead-grid">
              {list.map((r) => {
                const shot = (r.shot_ig && urls[r.shot_ig]) || (r.shot_home_mobile && urls[r.shot_home_mobile]) || (r.shot_home && urls[r.shot_home]) || null;
                const peer = r.brands_carried?.peer_match ?? [];
                return (
                  <button key={r.id} type="button" className="lead-card" onClick={() => openScheda(r)}>
                    <div className="lead-thumb" style={{ background: shot ? `url(${shot}) center top / cover no-repeat` : 'var(--surface-alt)' }}>
                      {!shot && <span className="muted">nessuna immagine</span>}
                      <span className="lead-score" style={{ background: scoreColor(r.totale) }}>{r.totale ?? '—'}</span>
                      {(r.tier || r.tier_proposto) && <span className="lead-tier" style={{ background: tierColor(r.tier ?? r.tier_proposto) }}>{r.tier ? `Tier ${r.tier}` : `${r.tier_proposto}?`}</span>}
                    </div>
                    <div className="lead-body">
                      <div className="lead-name">{r.nome}</div>
                      <div className="lead-sub">{[r.citta ?? r.paese, TIPO_LABEL[r.tipo] ?? r.tipo].join(' · ')}{r.stato_ricerca === 'rejected' ? ' · SCARTATO' : ''}</div>
                      <div className="lead-nums">
                        <span>IG {fmtN(r.ig_metrics?.follower)}</span>
                        <span>★ {r.maps?.rating ?? '—'}{r.maps?.recensioni != null ? ` (${fmtN(r.maps.recensioni)})` : ''}</span>
                        <span>borse {eur(r.price_band?.borse?.mediana)}</span>
                      </div>
                      {peer.length > 0 && <div className="chips" style={{ marginTop: 4 }}>{peer.slice(0, 4).map((b) => <span key={b} className="chip on" style={{ fontSize: 11 }}>{b}</span>)}</div>}
                      {r.motivazione && <div className="lead-mot">{short(r.motivazione, 140)}</div>}
                      {r.esclusione && <div className="lead-mot" style={{ color: 'var(--negative)' }}>Esclusione: {r.esclusione}</div>}
                    </div>
                  </button>
                );
              })}
              {!list.length && <div className="muted" style={{ padding: 12 }}>Nessun negozio con questi filtri.</div>}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
function Scheda({ r, urls, who, onBack, onChanged }: { r: LeadDossier; urls: Record<string, string>; who: string; onBack: () => void; onChanged: () => Promise<void> }) {
  const [ev, setEv] = useState<LeadEvidence[] | null>(null);
  const [contacts, setContacts] = useState<LeadContact[]>([]);
  const [reviews, setReviews] = useState<LeadReview[]>([]);
  const [showEv, setShowEv] = useState(false);
  const [nota, setNota] = useState('');
  const [motivo, setMotivo] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [big, setBig] = useState<string | null>(null);

  useEffect(() => {
    setEv(null);
    Promise.all([fetchEvidence(r.id), fetchContacts(r.id), fetchReviews(r.id)]).then(([e, c, v]) => { setEv(e); setContacts(c); setReviews(v); }).catch((e: Error) => setMsg(e.message));
  }, [r.id]);

  const act = async (azione: 'tier' | 'scarta' | 'ricontrolla' | 'nota', tier?: 'A' | 'B' | 'C') => {
    if (azione === 'scarta' && !motivo.trim()) { setMsg('Scrivi il motivo dello scarto.'); return; }
    if (azione === 'nota' && !nota.trim()) { setMsg('La nota e’ vuota.'); return; }
    setBusy(true); setMsg('');
    try {
      await addReview({ account_id: r.id, chi: who, azione, tier: tier ?? null, motivo: azione === 'scarta' ? motivo.trim() : null, nota: nota.trim() || null });
      setNota(''); setMotivo('');
      await onChanged();
      setReviews(await fetchReviews(r.id));
      setMsg(azione === 'tier' ? `Tier ${tier} salvato (${who}).` : azione === 'scarta' ? 'Scartato.' : azione === 'ricontrolla' ? 'Rimesso in coda al collector.' : 'Nota salvata.');
    } catch (e) { setMsg((e as Error).message); }
    setBusy(false);
  };

  const shots: { label: string; path: string | null }[] = [
    { label: 'Instagram', path: r.shot_ig }, { label: 'Sito (mobile)', path: r.shot_home_mobile }, { label: 'Sito (desktop)', path: r.shot_home }, { label: 'Google Maps', path: r.shot_maps },
  ];
  const ig = r.ig_metrics; const mp = r.maps; const bc = r.brands_carried; const pb = r.price_band;
  const crit = r.criteri ?? {};

  return (
    <div className="screen">
      <header>
        <button className="badge" onClick={onBack} type="button">‹ Negozi</button>
        <span className="badge" style={{ background: tierColor(r.tier ?? r.tier_proposto), color: '#fff' }}>{r.tier ? `Tier ${r.tier}` : r.tier_proposto ? `Proposto ${r.tier_proposto}` : STATO_LABEL[r.stato_ricerca]}</span>
      </header>
      <h1 style={{ margin: '4px 0 0' }}>{r.nome}</h1>
      <div className="muted" style={{ marginBottom: 8 }}>{[TIPO_LABEL[r.tipo] ?? r.tipo, r.citta, r.provincia, r.paese !== 'IT' ? r.paese : null, r.gruppo_nome ? `gruppo: ${r.gruppo_nome}` : null].filter(Boolean).join(' · ')}</div>
      {r.stato_ricerca === 'rejected' && <div className="card err">Scartato: {r.rejected_motivo}</div>}

      <div className="lead-shots">
        {shots.map((s) => s.path && urls[s.path] ? (
          <button key={s.label} type="button" className="lead-shot" onClick={() => setBig(urls[s.path!])}>
            <img src={urls[s.path]} alt={s.label} loading="lazy" /><span>{s.label}</span>
          </button>
        ) : <div key={s.label} className="lead-shot lead-shot-empty"><span>{s.label}: non disponibile</span></div>)}
      </div>
      {big && <div className="lead-lightbox" onClick={() => setBig(null)} role="presentation"><img src={big} alt="" /></div>}

      <section className="card">
        <h2>Numeri</h2>
        <div className="lead-facts">
          <div><b>{fmtN(ig?.follower)}</b><span>follower IG</span></div>
          <div><b>{fmtN(ig?.post)}</b><span>post</span></div>
          <div><b>{mp?.rating ?? '—'}</b><span>rating Google{mp?.recensioni != null ? ` (${fmtN(mp.recensioni)})` : ''}</span></div>
          <div><b>{pb?.borse ? `${eur(pb.borse.min)}–${eur(pb.borse.max)}` : '—'}</b><span>borse a catalogo{pb?.borse ? `, mediana ${eur(pb.borse.mediana)}` : ''}</span></div>
          <div><b>{bc?.peer_match?.length ?? 0}</b><span>brand affini a scaffale</span></div>
          <div><b>{r.n_evidenze}</b><span>evidenze raccolte</span></div>
        </div>
        {bc?.peer_match?.length ? <div className="chips" style={{ marginTop: 8 }}>{bc.peer_match.map((b) => <span key={b} className="chip on">{b}</span>)}</div> : null}
        {bc?.vendors?.length ? <p className="note">Brand a catalogo (dal sito): {bc.vendors.slice(0, 40).join(', ')}{bc.vendors.length > 40 ? '…' : ''}</p> : null}
        {mp?.categoria || mp?.orari ? <p className="note">{[mp?.categoria, mp?.orari].filter(Boolean).join(' · ')}</p> : null}
        {ig?.bio ? <p className="note">Bio IG: {short(ig.bio, 300)}</p> : null}
      </section>

      <section className="card">
        <h2>Valutazione {r.rubrica_version ? `(rubrica ${r.rubrica_version})` : ''}</h2>
        {r.totale == null ? <p className="muted">Non ancora valutato{r.stato_ricerca === 'seed' ? ': il collector non ha ancora raccolto i dati' : ''}.</p> : (
          <>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 8 }}>
              <span style={{ fontSize: 34, fontWeight: 800, color: scoreColor(r.totale) }}>{r.totale}</span>
              <span className="muted">su 100 · proposto Tier {r.tier_proposto ?? '—'}{r.dati_incompleti ? ' · DATI INCOMPLETI' : ''}</span>
            </div>
            {r.esclusione && <div className="err" style={{ marginBottom: 8 }}>Esclusione secca: {r.esclusione}</div>}
            <div className="lead-crit">
              {CRITERI_ORDER.map((c) => { const k = crit[c.key]; const p = k?.punti; return (
                <div key={c.key} className="lead-critrow">
                  <div className="lead-critlbl"><span>{c.label}</span><b>{p == null ? '—' : `${p}/10`}<i> · peso {c.peso}</i></b></div>
                  <div className="lead-bar"><div style={{ width: `${((p ?? 0) / 10) * 100}%`, background: p == null ? 'var(--border-strong)' : p >= 7 ? 'var(--positive)' : p >= 4 ? 'var(--warning)' : 'var(--negative)' }} /></div>
                  {k?.prova && <div className="lead-prova">{k.prova}</div>}
                </div>
              ); })}
            </div>
            {r.bonus && Object.keys(r.bonus).length > 0 && <p className="note">Bonus: {Object.entries(r.bonus).map(([k, v]) => `${k} +${v}`).join(', ')}</p>}
            {r.motivazione && <p style={{ marginTop: 8 }}>{r.motivazione}</p>}
            {r.perche_no && <p className="muted"><b>Perche&#8217; no:</b> {r.perche_no}</p>}
          </>
        )}
        {r.gancio && <div className="lead-gancio"><b>Gancio proposto</b><p>{r.gancio}</p></div>}
      </section>

      <section className="card">
        <h2>Decisione</h2>
        <p className="note">La tua decisione vince sul punteggio. Firmi come <b>{who}</b>.</p>
        <div className="lead-actions">
          {(['A', 'B', 'C'] as const).map((t) => <button key={t} type="button" className="ds-btn" disabled={busy} style={{ borderColor: tierColor(t), color: r.tier === t ? '#fff' : tierColor(t), background: r.tier === t ? tierColor(t) : 'transparent' }} onClick={() => act('tier', t)}>Tier {t}</button>)}
          <button type="button" className="ds-btn" disabled={busy} onClick={() => act('ricontrolla')}>Ricontrolla</button>
        </div>
        <div className="cs-fld" style={{ marginTop: 8 }}><label>Motivo scarto</label><input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="es. monomarca, chiuso, fuori target…" /></div>
        <button type="button" className="ds-btn" disabled={busy} style={{ color: 'var(--negative)', borderColor: 'var(--negative)' }} onClick={() => act('scarta')}>Scarta</button>
        <div className="cs-fld" style={{ marginTop: 10 }}><label>Nota</label><textarea rows={2} value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Una nota per voi due (resta sulla scheda)" /></div>
        <button type="button" className="ds-btn" disabled={busy} onClick={() => act('nota')}>Salva nota</button>
        {msg && <div className="note" style={{ marginTop: 6 }}>{msg}</div>}
        {r.owner_note && <p className="note" style={{ marginTop: 8 }}><b>Nota attuale:</b> {r.owner_note}</p>}
        {reviews.length > 0 && <div className="list" style={{ marginTop: 8 }}>{reviews.map((v) => <div key={v.id} className="row"><div><div className="rt">{v.azione}{v.tier ? ` ${v.tier}` : ''} · {v.chi}</div><div className="rs">{[v.motivo, v.nota].filter(Boolean).join(' · ')}</div></div><div className="muted" style={{ fontSize: 12 }}>{v.created_at.slice(0, 16).replace('T', ' ')}</div></div>)}</div>}
      </section>

      <section className="card">
        <h2>Anagrafica e contatti</h2>
        <div className="list">
          {r.indirizzo || mp?.indirizzo ? <div className="row"><div className="rt">Indirizzo</div><div className="rs">{r.indirizzo ?? mp?.indirizzo}</div></div> : null}
          {r.website && <div className="row"><div className="rt">Sito</div><div className="rs"><a href={r.website} target="_blank" rel="noreferrer">{r.website}</a></div></div>}
          {r.ig_handle && <div className="row"><div className="rt">Instagram</div><div className="rs"><a href={`https://www.instagram.com/${r.ig_handle}/`} target="_blank" rel="noreferrer">@{r.ig_handle}</a></div></div>}
          {r.google_maps_url && <div className="row"><div className="rt">Google Maps</div><div className="rs"><a href={r.google_maps_url} target="_blank" rel="noreferrer">apri la scheda</a></div></div>}
          {(r.telefono || mp?.telefono) && <div className="row"><div className="rt">Telefono</div><div className="rs">{r.telefono ?? mp?.telefono}</div></div>}
          {r.email_generica && <div className="row"><div className="rt">Email</div><div className="rs">{r.email_generica}</div></div>}
          {r.piva && <div className="row"><div className="rt">P.IVA</div><div className="rs">{r.piva}</div></div>}
          <div className="row"><div className="rt">Fonte</div><div className="rs">{r.fonte_seed}{r.contattato_prima ? ' · gia’ contattato in passato' : ''}{r.chi ? ` · ${r.chi}` : ''}</div></div>
        </div>
        {contacts.length > 0 && <div className="list" style={{ marginTop: 8 }}>{contacts.map((c) => <div key={c.id} className="row"><div><div className="rt">{c.nome ?? '—'} {c.ruolo ? <span className="muted">· {c.ruolo}</span> : null}</div><div className="rs">{[c.email, c.telefono, c.linkedin_url].filter(Boolean).join(' · ')}{c.opt_out ? ' · OPT-OUT' : ''}</div></div></div>)}</div>}
      </section>

      <section className="card">
        <button type="button" className="ds-btn" onClick={() => setShowEv((s) => !s)}>{showEv ? 'Nascondi' : 'Mostra'} le evidenze grezze ({ev?.length ?? '…'})</button>
        {showEv && ev && <div className="list" style={{ marginTop: 8 }}>{ev.map((e) => (
          <div key={e.id} className="row" style={{ alignItems: 'flex-start' }}>
            <div style={{ minWidth: 0 }}>
              <div className="rt">{e.tipo} <span className="muted" style={{ fontWeight: 400 }}>· {e.raccolto_da} · {e.captured_at.slice(0, 16).replace('T', ' ')}</span></div>
              {e.asset_path && urls[e.asset_path] && <a href={urls[e.asset_path]} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>apri immagine</a>}
              {e.payload && <pre className="lead-pre">{JSON.stringify(e.payload, null, 1).slice(0, 1200)}</pre>}
              {e.note && <div className="rs">{e.note}</div>}
            </div>
          </div>
        ))}</div>}
      </section>
    </div>
  );
}
