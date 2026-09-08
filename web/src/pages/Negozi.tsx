import { useEffect, useMemo, useState } from 'react';
import { csClient } from '../lib/csClient';
import { fetchDossier, fetchEvidence, fetchContacts, fetchReviews, signedUrls, addReview, assetPathsOf, TIPO_LABEL, STATO_LABEL, CRITERI_ORDER } from '../lib/leadApi';
import type { LeadDossier, LeadEvidence, LeadContact, LeadReview } from '../lib/leadApi';
import { personaName } from '../lib/people';
import { pushBack, popBack } from '../lib/backnav';
import ExportBtn from '../components/ExportBtn';

// Pagina "Negozi B2B" (modulo lead_*, migr 0111/0112). Mostra il dossier di ogni negozio o gruppo
// raccolto dal collector (workers/lead) e valutato dalla sessione Claude con la rubrica v1
// (PIANO_Ricerca_e_Outreach_B2B.md cap. 3.4). L'unica scrittura e' la decisione umana (lead_reviews).
// Login: stesso client e stessa sessione dell'Assistenza (csClient, RLS @amimi.it).
// Le immagini vivono nel bucket privato lead-assets: la lista firma solo le miniature, la scheda
// firma tutto il suo materiale (feed IG, foto prodotto, screenshot) quando si apre.

const fmtN = (n: number | null | undefined) => (n == null ? '—' : new Intl.NumberFormat('it-IT').format(n));
const eur = (n: number | null | undefined) => (n == null ? '—' : `${Math.round(n)}€`);
const short = (s: string | null | undefined, n = 110) => (!s ? '' : s.length > n ? s.slice(0, n - 1) + '…' : s);
const tierColor = (t: string | null | undefined) => (t === 'A' ? 'var(--positive)' : t === 'B' ? 'var(--warning)' : t === 'C' ? 'var(--ink-muted)' : 'var(--border-strong)');
const scoreColor = (n: number | null | undefined) => (n == null ? 'var(--border-strong)' : n >= 75 ? 'var(--positive)' : n >= 55 ? 'var(--warning)' : 'var(--negative)');
const MESI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
const fmtD = (iso: string | null | undefined) => { if (!iso) return ''; const [y, m, d] = iso.split('-'); return `${Number(d)} ${MESI[Number(m) - 1]} ${y}`; };
// la data del post sta nell'alt di Instagram ("Photo by X on September 06, 2026."): piu' affidabile del campo calcolato
const postDate = (p: { alt: string; data: string | null }) => { const m = p.alt.match(/on ([A-Z][a-z]+) (\d{1,2}), (\d{4})/); if (!m) return fmtD(p.data); const EN = ['january','february','march','april','may','june','july','august','september','october','november','december']; const i = EN.indexOf(m[1].toLowerCase()); return i < 0 ? fmtD(p.data) : `${Number(m[2])} ${MESI[i]} ${m[3]}`; };
// descrizione automatica di Instagram ("Potrebbe essere un'immagine raffigurante ...")
const postDesc = (alt: string) => { const m = alt.match(/raffigurante (.+?)\.?$/) || alt.match(/may be an image of (.+?)\.?$/i); return m ? m[1] : ''; };
const AMIMI_MIN = 50; const AMIMI_MAX = 190;

type View = 'lista' | 'tabella' | 'scheda';

export default function Negozi({ onBack, chi }: { onBack?: () => void; chi: string }) {
  const [session, setSession] = useState<'?' | 'in' | 'out'>('?');
  const [email, setEmail] = useState(''); const [pwd, setPwd] = useState(''); const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [rows, setRows] = useState<LeadDossier[] | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [view, setView] = useState<View>('lista');
  const [cur, setCur] = useState<LeadDossier | null>(null);
  const [fStato, setFStato] = useState<string>('attivi');
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
      const thumbs = r.flatMap((x) => [x.thumb, x.shot_ig, x.shot_home_mobile, x.shot_home]).filter((p): p is string => !!p);
      setUrls((u) => ({ ...u }));
      const signed = await signedUrls(thumbs); setUrls((u) => ({ ...u, ...signed }));
      if (cur) setCur(r.find((x) => x.id === cur.id) ?? null);
    } catch (e) { setErr((e as Error).message); }
  };
  useEffect(() => { if (session === 'in') load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [session]);
  const signMore = async (paths: string[]) => { const missing = paths.filter((p) => !urls[p]); if (!missing.length) return; const s = await signedUrls(missing); setUrls((u) => ({ ...u, ...s })); };

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
      (fStato === 'tutti' || (fStato === 'attivi' ? r.stato_ricerca !== 'rejected' : r.stato_ricerca === fStato)) &&
      (fTier === 'tutti' || (fTier === 'senza' ? !r.tier && !r.tier_proposto : (r.tier ?? r.tier_proposto) === fTier)) &&
      (fTipo === 'tutti' || r.tipo === fTipo) &&
      (!s || `${r.nome} ${r.citta ?? ''} ${r.ig_handle ?? ''} ${(r.brands_carried?.peer_match ?? []).join(' ')} ${(r.brands_carried?.vendors ?? []).join(' ')}`.toLowerCase().includes(s)));
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

  if (view === 'scheda' && cur) return <Scheda r={cur} urls={urls} signMore={signMore} who={who} onBack={closeScheda} onChanged={load} />;

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
            <div className="ds-kpi"><div className="v">{rows.length}</div><div className="l">Profili nel database</div><div className="s">{byStato.get('rejected') ?? 0} scartati</div></div>
            <div className="ds-kpi"><div className="v">{byStato.get('scored') ?? 0}</div><div className="l">Valutati, da rivedere</div><div className="s">score pronto, decisione umana mancante</div></div>
            <div className="ds-kpi pos"><div className="v">{rows.filter((r) => r.tier === 'A').length}</div><div className="l">Tier A decisi</div><div className="s">{rows.filter((r) => r.tier_proposto === 'A' && r.stato_ricerca !== 'rejected').length} proposti dal modello</div></div>
            <div className="ds-kpi"><div className="v">{byStato.get('reviewed') ?? 0}</div><div className="l">Rivisti</div><div className="s">{byStato.get('seed') ?? 0} ancora da raccogliere</div></div>
          </div>

          <section className="card">
            <div className="ds-search" style={{ marginBottom: 8 }}><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cerca nome, citta', Instagram, brand a catalogo…" aria-label="Cerca negozio" /></div>
            <div className="chips" style={{ marginBottom: 6 }}>
              {['attivi', 'scored', 'reviewed', 'seed', 'enriched', 'rejected', 'tutti'].map((s) => <button key={s} type="button" className={`chip ${fStato === s ? 'on' : ''}`} onClick={() => setFStato(s)}>{s === 'tutti' ? 'Tutti' : s === 'attivi' ? 'Attivi' : STATO_LABEL[s]}{byStato.get(s) ? ` · ${byStato.get(s)}` : ''}</button>)}
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
                const shot = (r.thumb && urls[r.thumb]) || (r.shot_ig && urls[r.shot_ig]) || (r.shot_home_mobile && urls[r.shot_home_mobile]) || (r.shot_home && urls[r.shot_home]) || null;
                const peer = r.brands_carried?.peer_match ?? [];
                return (
                  <button key={r.id} type="button" className="lead-card" onClick={() => openScheda(r)}>
                    <div className="lead-thumb" style={{ background: shot ? `url(${shot}) center / cover no-repeat` : 'var(--surface-alt)' }}>
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
                        <span>borse {r.price_band?.borse ? `${eur(r.price_band.borse.min)}–${eur(r.price_band.borse.max)}` : '—'}</span>
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
function Scheda({ r, urls, signMore, who, onBack, onChanged }: { r: LeadDossier; urls: Record<string, string>; signMore: (p: string[]) => Promise<void>; who: string; onBack: () => void; onChanged: () => Promise<void> }) {
  const [ev, setEv] = useState<LeadEvidence[] | null>(null);
  const [contacts, setContacts] = useState<LeadContact[]>([]);
  const [reviews, setReviews] = useState<LeadReview[]>([]);
  const [showEv, setShowEv] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [nota, setNota] = useState('');
  const [motivo, setMotivo] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [big, setBig] = useState<{ src: string; label: string; href?: string | null } | null>(null);

  useEffect(() => {
    setEv(null);
    signMore(assetPathsOf(r));
    Promise.all([fetchEvidence(r.id), fetchContacts(r.id), fetchReviews(r.id)]).then(([e, c, v]) => { setEv(e); setContacts(c); setReviews(v); }).catch((e: Error) => setMsg(e.message));
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
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

  const ig = r.ig_metrics; const mp = r.maps; const bc = r.brands_carried; const pb = r.price_band;
  const posts = (r.ig_posts?.post ?? []).filter((p) => p.asset_path);
  const cad = r.ig_posts?.cadenza;
  const perWeek = cad && cad.giorni > 0 ? (cad.n / cad.giorni) * 7 : null;
  const prods = r.site_products?.prodotti ?? [];
  const bagProds = prods.filter((p) => p.borsa);
  const revs = r.maps_reviews?.recensioni ?? [];
  const press = r.stampa?.risultati ?? [];
  const crit = r.criteri ?? {};
  const shots: { label: string; path: string | null }[] = [
    { label: 'Instagram (profilo)', path: r.shot_ig }, { label: 'Sito (mobile)', path: r.shot_home_mobile }, { label: 'Sito (desktop)', path: r.shot_home }, { label: 'Google Maps', path: r.shot_maps }, { label: 'Foto su Google', path: r.shot_maps_photos },
  ];
  // scala prezzi: borse del negozio contro Amimi (50-190), su un asse 0-max
  const axisMax = Math.max(AMIMI_MAX, pb?.borse?.max ?? 0, 200);
  const pct = (v: number) => `${Math.min(100, (v / axisMax) * 100)}%`;

  return (
    <div className="screen">
      <header>
        <button className="badge" onClick={onBack} type="button">‹ Negozi</button>
        <span className="badge" style={{ background: tierColor(r.tier ?? r.tier_proposto), color: '#fff' }}>{r.tier ? `Tier ${r.tier}` : r.tier_proposto ? `Proposto ${r.tier_proposto}` : STATO_LABEL[r.stato_ricerca]}</span>
      </header>
      <h1 style={{ margin: '4px 0 0' }}>{r.nome}</h1>
      <div className="muted" style={{ marginBottom: 6 }}>{[TIPO_LABEL[r.tipo] ?? r.tipo, r.citta, r.provincia, r.paese !== 'IT' ? r.paese : null, r.gruppo_nome ? `gruppo: ${r.gruppo_nome}` : null].filter(Boolean).join(' · ')}</div>
      <div className="lead-links">
        {r.website && <a href={r.website} target="_blank" rel="noreferrer">sito</a>}
        {r.ig_handle && <a href={`https://www.instagram.com/${r.ig_handle}/`} target="_blank" rel="noreferrer">@{r.ig_handle}</a>}
        {r.google_maps_url && <a href={r.google_maps_url} target="_blank" rel="noreferrer">maps</a>}
        {(r.email_generica || r.site_meta?.emails?.[0]) && <a href={`mailto:${r.email_generica ?? r.site_meta?.emails?.[0]}`}>{r.email_generica ?? r.site_meta?.emails?.[0]}</a>}
        {(r.telefono || mp?.telefono) && <span>{r.telefono ?? mp?.telefono}</span>}
      </div>
      {r.stato_ricerca === 'rejected' && <div className="card err">Scartato: {r.rejected_motivo}</div>}
      {r.site_meta?.meta && <p className="lead-tagline">{short(r.site_meta.meta, 220)}</p>}

      {posts.length > 0 && (
        <section className="card">
          <h2>Feed Instagram <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>· ultimi {posts.length} post{cad ? `, dal ${fmtD(cad.primo)} al ${fmtD(cad.ultimo)}` : ''}{perWeek != null ? ` · circa ${perWeek >= 1 ? perWeek.toFixed(1) + ' a settimana' : (perWeek * 4.3).toFixed(1) + ' al mese'}` : ''}</span></h2>
          <div className="lead-feed">
            {posts.map((p) => p.asset_path && urls[p.asset_path] ? (
              <button key={p.i} type="button" className="lead-post" onClick={() => setBig({ src: urls[p.asset_path!], label: `${postDate(p)}${postDesc(p.alt) ? ' · ' + postDesc(p.alt) : ''}`, href: p.url })} title={p.alt}>
                <img src={urls[p.asset_path]} alt={p.alt} loading="lazy" />
                <span>{postDate(p)}{p.reel ? ' · reel' : ''}</span>
              </button>
            ) : <div key={p.i} className="lead-post lead-post-empty" />)}
          </div>
          {ig?.bio ? <p className="note">Bio: {short(ig.bio, 320)}</p> : null}
        </section>
      )}

      {prods.length > 0 && (
        <section className="card">
          <h2>Vetrina online <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>· {r.site_products?.n_borse ?? 0} borse su {pb?.n_prodotti ?? prods.length} prodotti a catalogo{r.site_meta?.platform ? ` · ${r.site_meta.platform}` : ''}</span></h2>
          <div className="lead-feed">
            {prods.map((p, i) => p.asset_path && urls[p.asset_path] ? (
              <a key={i} className={`lead-post ${p.borsa ? 'lead-post-bag' : ''}`} href={p.url} target="_blank" rel="noreferrer" title={`${p.titolo}${p.vendor ? ' · ' + p.vendor : ''}`}>
                <img src={urls[p.asset_path]} alt={p.titolo} loading="lazy" />
                <span>{eur(p.prezzo)}{p.vendor ? ` · ${short(p.vendor, 18)}` : ''}</span>
              </a>
            ) : null)}
          </div>
          {pb?.borse && (
            <div className="lead-scale">
              <div className="lead-scale-lbl">Borse a catalogo: {eur(pb.borse.min)} – {eur(pb.borse.max)}, mediana {eur(pb.borse.mediana)} ({pb.borse.n} varianti)</div>
              <div className="lead-scale-bar">
                <div className="lead-scale-store" style={{ left: pct(pb.borse.min), width: `calc(${pct(pb.borse.max)} - ${pct(pb.borse.min)})` }} />
                <div className="lead-scale-med" style={{ left: pct(pb.borse.mediana) }} />
                <div className="lead-scale-amimi" style={{ left: pct(AMIMI_MIN), width: `calc(${pct(AMIMI_MAX)} - ${pct(AMIMI_MIN)})` }} />
              </div>
              <div className="lead-scale-leg"><i style={{ background: 'var(--interactive-tint)', border: '1px solid var(--interactive)' }} /> negozio <i style={{ background: 'var(--accent-coral-tint)', border: '1px solid var(--accent-coral)' }} /> Amimi&#8217; {AMIMI_MIN}–{AMIMI_MAX}€ <i style={{ background: 'var(--ink)', width: 3 }} /> mediana · asse fino a {eur(axisMax)}</div>
            </div>
          )}
          {bc?.vendors?.length ? <p className="note">Brand a catalogo: {bc.vendors.slice(0, 40).join(', ')}{bc.vendors.length > 40 ? '…' : ''}</p> : null}
          {bagProds.length === 0 && prods.length > 0 && <p className="note">Nessuna borsa riconosciuta fra i primi 250 prodotti: mostrati gli altri articoli.</p>}
        </section>
      )}

      <div className="lead-shots">
        {shots.map((s) => s.path && urls[s.path] ? (
          <button key={s.label} type="button" className="lead-shot" onClick={() => setBig({ src: urls[s.path!], label: s.label })}>
            <img src={urls[s.path]} alt={s.label} loading="lazy" /><span>{s.label}</span>
          </button>
        ) : <div key={s.label} className="lead-shot lead-shot-empty"><span>{s.label}: non disponibile</span></div>)}
      </div>
      {big && <div className="lead-lightbox" onClick={() => setBig(null)} role="presentation"><img src={big.src} alt="" /><div className="lead-lightbox-cap">{big.label}{big.href ? <> · <a href={big.href} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>apri su Instagram</a></> : null}</div></div>}

      <section className="card">
        <h2>Numeri</h2>
        <div className="lead-facts">
          <div><b>{fmtN(ig?.follower)}</b><span>follower IG · {fmtN(ig?.post)} post</span></div>
          <div><b>{perWeek != null ? (perWeek >= 1 ? `${perWeek.toFixed(1)}/sett` : `${(perWeek * 4.3).toFixed(1)}/mese`) : '—'}</b><span>cadenza post{cad ? `, ultimo ${fmtD(cad.ultimo)}` : ''}</span></div>
          <div><b>{mp?.rating ?? '—'}</b><span>rating Google{mp?.recensioni != null ? ` (${fmtN(mp.recensioni)} recensioni)` : ''}</span></div>
          <div><b>{pb?.borse ? `${eur(pb.borse.min)}–${eur(pb.borse.max)}` : '—'}</b><span>borse a catalogo{pb?.borse ? `, mediana ${eur(pb.borse.mediana)}` : ''}</span></div>
          <div><b>{bc?.peer_match?.length ?? 0}</b><span>brand affini a scaffale</span></div>
          <div><b>{r.n_evidenze}</b><span>evidenze raccolte</span></div>
        </div>
        {bc?.peer_match?.length ? <div className="chips" style={{ marginTop: 8 }}>{bc.peer_match.map((b) => <span key={b} className="chip on">{b}</span>)}</div> : null}
        {mp?.categoria || mp?.orari || mp?.indirizzo ? <p className="note">{[mp?.categoria?.replace(/^[^A-Za-zÀ-ÿ]+|[^A-Za-zÀ-ÿ)]+$/g, ''), mp?.orari, mp?.indirizzo].filter(Boolean).join(' · ')}</p> : null}
        {posts.length === 0 && ig?.bio ? <p className="note">Bio IG: {short(ig.bio, 300)}</p> : null}
      </section>

      {(revs.length > 0 || press.length > 0 || r.about_text?.testo) && (
        <section className="card">
          <h2>Cosa si dice</h2>
          {revs.length > 0 && <>
            <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>Recensioni Google (le prime {revs.length})</div>
            <div className="list">{revs.map((v, i) => <div key={i} className="row" style={{ alignItems: 'flex-start' }}><div><div className="rt">{v.stelle ?? '—'}</div><div className="rs" style={{ whiteSpace: 'normal' }}>{short(v.testo.replace(/Traduzione di Google.*$/, '').replace(/Mi piace\s+Condividi\s*$/, ''), 320)}</div></div></div>)}</div>
          </>}
          {press.length > 0 && <>
            <div className="muted" style={{ fontSize: 12, margin: '10px 0 4px' }}>Sul web (ricerca &#8220;{r.stampa?.query}&#8221;)</div>
            <div className="list">{press.map((p, i) => <div key={i} className="row" style={{ alignItems: 'flex-start' }}><div style={{ minWidth: 0 }}><div className="rt"><a href={p.url} target="_blank" rel="noreferrer">{p.titolo}</a> <span className="muted" style={{ fontWeight: 400, fontSize: 11 }}>· {p.dominio}</span></div><div className="rs" style={{ whiteSpace: 'normal' }}>{short(p.snippet, 200)}</div></div></div>)}</div>
          </>}
          {r.about_text?.testo && <>
            <button type="button" className="ds-btn" style={{ marginTop: 10 }} onClick={() => setShowAbout((s) => !s)}>{showAbout ? 'Nascondi' : 'Leggi'} la pagina &#8220;chi siamo&#8221;</button>
            {showAbout && <pre className="lead-pre" style={{ maxHeight: 400 }}>{r.about_text.testo}</pre>}
          </>}
        </section>
      )}

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
          {r.website && <div className="row"><div className="rt">Sito</div><div className="rs"><a href={r.website} target="_blank" rel="noreferrer">{r.website}</a>{r.site_meta?.platform ? ` · ${r.site_meta.platform}${r.site_meta.ecommerce ? ', e-commerce' : ''}` : ''}</div></div>}
          {r.ig_handle && <div className="row"><div className="rt">Instagram</div><div className="rs"><a href={`https://www.instagram.com/${r.ig_handle}/`} target="_blank" rel="noreferrer">@{r.ig_handle}</a></div></div>}
          {r.google_maps_url && <div className="row"><div className="rt">Google Maps</div><div className="rs"><a href={r.google_maps_url} target="_blank" rel="noreferrer">apri la scheda</a></div></div>}
          {(r.telefono || mp?.telefono) && <div className="row"><div className="rt">Telefono</div><div className="rs">{r.telefono ?? mp?.telefono}</div></div>}
          {(r.email_generica || r.site_meta?.emails?.length) && <div className="row"><div className="rt">Email</div><div className="rs">{[r.email_generica, ...(r.site_meta?.emails ?? [])].filter((e, i, a) => e && a.indexOf(e) === i).slice(0, 5).join(' · ')}</div></div>}
          {(r.piva || r.site_meta?.piva) && <div className="row"><div className="rt">P.IVA</div><div className="rs">{r.piva ?? r.site_meta?.piva}</div></div>}
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
