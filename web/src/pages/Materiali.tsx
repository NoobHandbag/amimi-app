import { useEffect, useMemo, useState } from 'react';
import { csClient } from '../lib/csClient';
import { CATEGORIE, TINTA, fetchAcquisti, fetchAssets, fetchCatalogo, fetchFornitori, fetchMatSettings, fmtPrezzo, raggruppa, signedUrls } from '../lib/matApi';
import type { MatAcquisto, MatAsset, MatCatalogo, MatFornitore, MatGruppo } from '../lib/matApi';
import { personaName } from '../lib/people';
import { NuovoFornitore, NuovoMateriale, SchedaAzioni } from './MaterialiNuovo';
import Icon from '../components/Icon';

// Sezione "Materie prime" (modulo mat_*, migr 0140, Fase 1): il catalogo dei materiali offerti o acquistati
// dai fornitori di pelli, tessuti, nastri e accessori, in stile vetrina (foto o segnaposto di categoria, prezzo,
// colori), con la scheda del materiale (colori, condizioni, contatti, documenti, storico acquisti) e la lista
// dei fornitori. E' la meta' MATERIE PRIME dell'area Fornitori: la meta' PRODOTTI resta la pagina Ordini
// (borse finite, arrivi, stock). Qui niente stock, niente CE: registro separato (brief catalogo 22-09, §2).
// Sola lettura: login Supabase Auth @amimi.it (stesso client di Assistenza e Negozi, RLS lato DB); le foto e i
// PDF vivono nel bucket privato mat-assets e si aprono con URL firmati. Le scritture arrivano con la Fase 2.

const fmtD = (iso: string | null | undefined) => { if (!iso) return ''; const d = new Date(iso); return isNaN(d.getTime()) ? iso.slice(0, 10) : d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' }); };
const eur = (n: number | null | undefined) => (n == null ? '' : Number(n).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €');
const num = (n: number | null | undefined) => (n == null ? '' : Number(n).toLocaleString('it-IT', { maximumFractionDigits: 3 }));
const tinta = (cat: string): [string, string] => TINTA[cat] ?? ['#b8b8b8', '#8a8a8a'];
const isImg = (a: MatAsset) => a.tipo === 'foto' && /^image\//.test(a.mime ?? '');

function Segno({ cat, label, big }: { cat: string; label: string; big?: boolean }) {
  const [c1, c2] = tinta(cat);
  return <div className="mat-img" style={{ background: `linear-gradient(150deg, ${c1}, ${c2})`, fontSize: big ? 15 : 12 }}>{label}</div>;
}

function Card({ g, url, onOpen }: { g: MatGruppo; url: string | undefined; onOpen: () => void }) {
  const colori = g.righe.map((r) => r.colore).filter((c): c is string => !!c);
  return (
    <button className="mat-card" type="button" onClick={onOpen}>
      {url ? <div className="mat-img"><img src={url} alt="" loading="lazy" /></div> : <Segno cat={g.categoria} label={g.categoria} />}
      <div className="mat-body">
        <div className="mat-nm">{g.materiale}</div>
        <div className="mat-sup">{g.fornitore}</div>
        <div className="mat-price">{g.prezzo}</div>
        <span className={`mat-badge ${g.acquistato ? 'acq' : ''}`}>{g.acquistato ? 'acquistato' : 'offerta'}</span>
        {g.n_foto > 1 && <span className="mat-badge" style={{ marginLeft: 4 }}>{g.n_foto} foto</span>}
        {colori.length > 0 && <div className="mat-colors">{colori.slice(0, 4).map((c) => <span key={c}>{c}</span>)}{colori.length > 4 && <span>+{colori.length - 4}</span>}</div>}
      </div>
    </button>
  );
}

function Scheda({ g, acquisti, materialiFornitore, onBack, chi, canWrite, onChanged }: { g: MatGruppo; acquisti: MatAcquisto[]; materialiFornitore: Set<string>; onBack: () => void; chi: string; canWrite: boolean; onChanged: () => Promise<void> }) {
  const [assets, setAssets] = useState<MatAsset[] | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [err, setErr] = useState('');
  const ids = useMemo(() => new Set(g.righe.map((r) => r.item_id)), [g]);
  const acq = useMemo(() => acquisti.filter((a) => ids.has(a.item_id)), [acquisti, ids]);
  const ordini = useMemo(() => new Set(acq.map((a) => a.order_id)), [acq]);
  useEffect(() => {
    setAssets(null); setErr('');
    fetchAssets(g.supplier_id).then(async (all) => {
      // asset del materiale (per colore o per tutti i colori), proforma dei suoi acquisti, documenti generali del fornitore
      const mine = all.filter((a) => (a.item_id && ids.has(a.item_id)) || (!a.item_id && !a.order_id && a.materiale && a.materiale.toLowerCase() === g.materiale.toLowerCase()) || (a.order_id && ordini.has(a.order_id)));
      // "del fornitore": documenti generali (materiale vuoto) e materiali senza riga a catalogo (es. foto di un
      // articolo ordinato ma non ancora nel Notion): altrimenti non sarebbero raggiungibili da nessuna schermata
      const generali = all.filter((a) => !a.item_id && !a.order_id && (!a.materiale || !materialiFornitore.has(a.materiale.toLowerCase())));
      const lista = [...mine, ...generali];
      setAssets(lista);
      setUrls(await signedUrls(lista.map((a) => a.path)));
    }).catch((e: Error) => setErr(e.message));
  }, [g, ids, ordini, materialiFornitore]);
  const r0 = g.righe[0];
  const isGenerale = (a: MatAsset) => !a.item_id && !a.order_id && (!a.materiale || a.materiale.toLowerCase() !== g.materiale.toLowerCase());
  const foto = (assets ?? []).filter((a) => isImg(a) && !isGenerale(a));
  const docs = (assets ?? []).filter((a) => !foto.includes(a));
  return (
    <div className="screen">
      <header><h1 style={{ fontSize: 20 }}>{g.materiale}</h1></header>
      <button className="back" onClick={onBack} type="button">← Catalogo</button>
      {foto.length > 0
        ? <div className="mat-photos">{foto.map((a) => urls[a.path] ? <a key={a.id} href={urls[a.path]} target="_blank" rel="noreferrer"><img src={urls[a.path]} alt={a.titolo ?? ''} /></a> : null)}</div>
        : <div style={{ borderRadius: 14, overflow: 'hidden', marginBottom: 12 }}><Segno cat={g.categoria} label={`${g.categoria} · nessuna foto ancora`} big /></div>}
      <div className="card">
        <div className="mat-kv">
          <b>Fornitore</b>{g.fornitore}{r0.fornitore_referente ? ` · ${r0.fornitore_referente}` : ''}
          <b>Categoria</b>{g.categoria}{g.articolo_fornitore ? ` · art. ${g.articolo_fornitore}` : ''}
          <b>Prezzo di riferimento</b>{g.prezzo}
          {r0.condizioni_pagamento && <><b>Condizioni</b>{r0.condizioni_pagamento}</>}
          {r0.deposito_luogo && <><b>Deposito</b>{r0.deposito_luogo}</>}
          {(r0.fornitore_email || r0.fornitore_telefono) && <><b>Contatti</b>
            {r0.fornitore_email && r0.fornitore_email.split(/[;,]\s*/).map((e) => <a key={e} href={`mailto:${e}`} style={{ marginRight: 10 }}>{e}</a>)}
            {r0.fornitore_telefono && <a href={`tel:${r0.fornitore_telefono.replace(/[^+\d]/g, '')}`}>{r0.fornitore_telefono}</a>}</>}
        </div>
      </div>
      <div className="card">
        <div className="rl" style={{ marginBottom: 6 }}>Colori e prezzi</div>
        <table className="mat-tbl"><thead><tr><th>Colore</th><th>Prezzo</th><th>Disponibilita'</th><th>Ultimo acquisto</th></tr></thead>
          <tbody>{g.righe.map((r) => (
            <tr key={r.item_id}>
              <td>{r.colore ?? 'n/d'}</td>
              <td>{fmtPrezzo(r.prezzo_rif, r.prezzo_rif_text, r.unita_rif)}{r.acquistato && r.offerta_prezzo_text ? <div className="muted" style={{ fontSize: 11 }}>offerta: {r.offerta_prezzo_text}</div> : null}</td>
              <td>{r.disponibilita ?? (r.acquistato ? '' : 'n/d')}{r.min_ordine ? <div className="muted" style={{ fontSize: 11 }}>min {r.min_ordine}</div> : null}{r.lead_time ? <div className="muted" style={{ fontSize: 11 }}>{r.lead_time}</div> : null}</td>
              <td>{r.acquistato ? <>{num(r.acquisto_quantita)} {r.acquisto_unita ?? ''}<div className="muted" style={{ fontSize: 11 }}>{fmtD(r.acquisto_data)}</div></> : ''}</td>
            </tr>))}</tbody></table>
        {g.righe.some((r) => r.offerta_fonte || r.note) && (
          <div className="mat-kv" style={{ marginTop: 8 }}>
            {[...new Set(g.righe.map((r) => r.offerta_fonte).filter(Boolean))].map((f) => <div key={f as string} className="muted" style={{ fontSize: 12 }}>Fonte: {f}</div>)}
            {[...new Set(g.righe.map((r) => r.note).filter(Boolean))].map((n) => <div key={n as string} style={{ fontSize: 12 }}>{n}</div>)}
          </div>)}
      </div>
      {canWrite && <SchedaAzioni g={g} chi={chi} onChanged={onChanged} />}
      {acq.length > 0 && (
        <div className="card">
          <div className="rl" style={{ marginBottom: 6 }}>Acquisti</div>
          {acq.map((a) => (
            <div key={a.line_id} className="mat-doc" style={{ justifyContent: 'space-between' }}>
              <div><div style={{ fontWeight: 700 }}>{fmtD(a.data_documento)} · {a.numero_documento}</div>
                <div className="muted" style={{ fontSize: 12 }}>{a.colore ?? ''} · {num(a.quantita)} {a.unita ?? ''} x {fmtPrezzo(a.prezzo_unitario, null, a.unita)}{a.sconto_text ? ` (${a.sconto_text})` : ''}</div></div>
              <div style={{ fontWeight: 800 }}>{eur(a.importo)}</div>
            </div>))}
        </div>)}
      {err && <div className="card err">Errore: {err}</div>}
      {assets === null && !err && <div className="muted center" style={{ padding: 10 }}>Carico documenti…</div>}
      {docs.length > 0 && (
        <div className="card">
          <div className="rl" style={{ marginBottom: 6 }}>Documenti</div>
          {docs.map((a) => (
            <div key={a.id} className="mat-doc">
              <span className="mat-badge">{a.tipo.replace('_', ' ')}</span>
              {urls[a.path] ? <a href={urls[a.path]} target="_blank" rel="noreferrer">{a.titolo ?? a.path.split('/').pop()}</a> : <span>{a.titolo ?? a.path}</span>}
              {isGenerale(a) && <span className="muted" style={{ fontSize: 11 }}>{a.materiale ? `del fornitore: ${a.materiale}` : 'del fornitore'}</span>}
            </div>))}
        </div>)}
    </div>
  );
}

function Fornitori({ rows, onPick }: { rows: MatFornitore[]; onPick: (nome: string) => void }) {
  return (
    <div>
      {rows.map((f) => (
        // card non cliccabile nel suo insieme: i link mailto/tel non possono stare dentro un <button>
        <div className="ds-scard" key={f.id} style={{ alignItems: 'flex-start', cursor: 'default' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="sn">{f.nome}{!f.attivo && <span className="mat-badge" style={{ marginLeft: 6 }}>da verificare</span>}</div>
            <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{f.categorie ?? f.categoria_principale ?? ''} · {f.n_materiali} materiali{f.n_ordini > 0 ? ` · ${f.n_ordini} acquisti (${eur(f.tot_imponibile)} imponibile)` : ' · solo offerte'}</div>
            <div className="mat-kv" style={{ fontSize: 12, marginTop: 4 }}>
              {f.email && f.email.split(/[;,]\s*/).map((e) => <a key={e} href={`mailto:${e}`} style={{ marginRight: 8 }}>{e}</a>)}
              {f.telefono && <a href={`tel:${f.telefono.replace(/[^+\d]/g, '')}`}>{f.telefono}</a>}
            </div>
            {(f.deposito_luogo || f.condizioni_pagamento) && <div className="muted" style={{ fontSize: 11, marginTop: 3 }}>{[f.deposito_luogo, f.condizioni_pagamento].filter(Boolean).join(' · ')}</div>}
            {f.ultimo_acquisto && <div className="muted" style={{ fontSize: 11 }}>ultimo acquisto {fmtD(f.ultimo_acquisto)}</div>}
          </div>
          <button type="button" className="chip" onClick={() => onPick(f.nome)} disabled={f.n_materiali === 0}>Catalogo ›</button>
        </div>))}
    </div>
  );
}

export default function Materiali({ onBack, onProdotti, chi }: { onBack: () => void; onProdotti: () => void; chi: string }) {
  const [session, setSession] = useState<'loading' | 'in' | 'out'>('loading');
  // Fase 2: i flag decidono cosa si puo' fare (scritture, Compila); la persona che firma e' il selettore di Home.
  // Il client non scrive MAI sulle tabelle mat_*: le scritture passano dalla edge mat-api (vedi MaterialiNuovo.tsx).
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [nuovo, setNuovo] = useState<'' | 'materiale' | 'fornitore'>('');
  const who = personaName(chi);
  const canWrite = settings.mat_write_enabled === 'true';
  const aiOn = canWrite && settings.ai_compila_enabled === 'true';
  const [email, setEmail] = useState(''); const [pwd, setPwd] = useState(''); const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [view, setView] = useState<'catalogo' | 'fornitori'>('catalogo');
  const [rows, setRows] = useState<MatCatalogo[] | null>(null);
  const [forn, setForn] = useState<MatFornitore[]>([]);
  const [acquisti, setAcquisti] = useState<MatAcquisto[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [cat, setCat] = useState<string>(''); const [fSup, setFSup] = useState<string>(''); const [tipo, setTipo] = useState<'' | 'acq' | 'off'>('');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string | null>(null);

  useEffect(() => {
    csClient.auth.getSession().then(({ data }) => setSession(data.session ? 'in' : 'out'));
    const { data: sub } = csClient.auth.onAuthStateChange((_e, s) => setSession(s ? 'in' : 'out'));
    return () => sub.subscription.unsubscribe();
  }, []);
  const reload = async () => {
    setErr('');
    try {
      const [c, f, a, st] = await Promise.all([fetchCatalogo(), fetchFornitori(), fetchAcquisti(), fetchMatSettings()]);
      setRows(c); setForn(f); setAcquisti(a); setSettings(st);
      // firma solo la prima foto di ogni materiale (poche decine di URL): la scheda firma tutto il suo materiale quando si apre
      setUrls(await signedUrls([...new Set(c.map((r) => r.foto_path))]));
    } catch (e) { setErr((e as Error).message); }
  };
  useEffect(() => {
    if (session !== 'in') return;
    reload();
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [session]);

  const doLogin = async () => {
    setBusy(true); setErr('');
    const { error } = await csClient.auth.signInWithPassword({ email: email.trim(), password: pwd });
    setBusy(false);
    if (error) setErr('Accesso non riuscito. Controlla email e password.'); else setPwd('');
  };
  const doGoogle = async () => {
    setBusy(true); setErr('');
    // redirectTo SENZA hash: Supabase appende la sessione come fragment (#access_token=...), un hash nostro lo romperebbe
    const { error } = await csClient.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin + import.meta.env.BASE_URL, queryParams: { hd: 'amimi.it', prompt: 'select_account' } } });
    if (error) { setBusy(false); setErr('Google non attivo: accedi con email e password.'); }
  };

  const gruppi = useMemo(() => (rows ? raggruppa(rows) : []), [rows]);
  const fornitoriNomi = useMemo(() => [...new Set(gruppi.map((g) => g.fornitore))].sort(), [gruppi]);
  const query = q.trim().toLowerCase();
  const visibili = useMemo(() => gruppi.filter((g) =>
    (!cat || g.categoria === cat) && (!fSup || g.fornitore === fSup) && (!tipo || (tipo === 'acq' ? g.acquistato : !g.acquistato)) &&
    (!query || g.materiale.toLowerCase().includes(query) || g.fornitore.toLowerCase().includes(query) || (g.articolo_fornitore ?? '').toLowerCase().includes(query) || g.righe.some((r) => (r.colore ?? '').toLowerCase().includes(query)))
  ), [gruppi, cat, fSup, tipo, query]);
  const selected = sel ? gruppi.find((g) => g.key === sel) : null;
  const materialiDelFornitore = useMemo(() => new Set(selected ? gruppi.filter((g) => g.supplier_id === selected.supplier_id).map((g) => g.materiale.toLowerCase()) : []), [gruppi, selected]);

  const segmented = (
    <div className="seg" style={{ marginBottom: 12 }}>
      <button type="button" onClick={onProdotti}>Prodotti</button>
      <button type="button" className="on">Materie prime</button>
    </div>
  );

  if (session === 'loading') return <div className="screen"><header><h1>Materie prime</h1></header><p className="muted center">Controllo l&#8217;accesso…</p></div>;
  if (session === 'out') return (
    <div className="screen">
      <header><button className="badge" onClick={onBack} type="button">‹ Home app</button></header>
      {segmented}
      <div className="cs-login">
        <div className="cs-logo">amimi<span>&#8217; materie prime</span></div>
        <div className="cs-lt">Listini e contatti dei fornitori: accedi con il tuo account Amimi&#8217;</div>
        <button className="cs-btn" style={{ width: '100%', background: '#fff', border: '1px solid var(--line)', color: 'var(--dark)' }} onClick={doGoogle} disabled={busy} type="button">Accedi con Google</button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '14px 0 4px', color: 'var(--muted)', fontSize: 12 }}>
          <span style={{ flex: 1, height: 1, background: 'var(--line)' }} /> oppure con email <span style={{ flex: 1, height: 1, background: 'var(--line)' }} />
        </div>
        <div className="cs-fld"><label>Email (@amimi.it)</label>
          <input type="email" autoCapitalize="none" autoCorrect="off" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="info@amimi.it" /></div>
        <div className="cs-fld"><label>Password</label>
          <input type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') doLogin(); }} /></div>
        {err && <div className="err" style={{ marginBottom: 8 }}>{err}</div>}
        <button className="cs-btn cs-primary" style={{ width: '100%' }} onClick={doLogin} disabled={busy} type="button">{busy ? 'Accesso…' : 'Entra'}</button>
        <div className="cs-note">Stesso login dell&#8217;Assistenza: vale qualsiasi casella @amimi.it, si fa una volta per dispositivo.</div>
      </div>
    </div>
  );

  if (nuovo === 'materiale') return <NuovoMateriale chi={who} aiOn={aiOn} fornitori={forn} onDone={reload} onBack={() => setNuovo('')} />;
  if (nuovo === 'fornitore') return <NuovoFornitore chi={who} aiOn={aiOn} fornitori={forn} onDone={reload} onBack={() => { setNuovo(''); setView('fornitori'); }} />;
  if (selected) return <Scheda g={selected} acquisti={acquisti} materialiFornitore={materialiDelFornitore} onBack={() => setSel(null)} chi={who} canWrite={canWrite} onChanged={reload} />;

  return (
    <div className="screen">
      <header><h1>Materie prime</h1><button className="badge" onClick={onBack} type="button">‹ Home</button></header>
      {segmented}
      <div className="seg wrap" style={{ marginBottom: 10 }}>
        <button type="button" className={view === 'catalogo' ? 'on' : ''} onClick={() => setView('catalogo')}>Catalogo{rows ? ` (${gruppi.length})` : ''}</button>
        <button type="button" className={view === 'fornitori' ? 'on' : ''} onClick={() => setView('fornitori')}>Fornitori{forn.length ? ` (${forn.length})` : ''}</button>
      </div>
      {err && <div className="card err">Errore: {err}</div>}
      {rows === null && !err && <div className="muted center" style={{ padding: 30 }}>Carico il catalogo…</div>}
      {view === 'fornitori' && canWrite && <div className="lead-actions" style={{ marginBottom: 10 }}><button type="button" className="ds-btn" style={{ background: 'var(--positive-700)', color: '#fff' }} onClick={() => setNuovo('fornitore')}>+ Fornitore</button></div>}
      {view === 'fornitori' && <Fornitori rows={forn} onPick={(nome) => { setFSup(nome); setView('catalogo'); }} />}
      {view === 'catalogo' && rows !== null && (
        <>
          {canWrite && <div className="lead-actions" style={{ marginBottom: 10 }}><button type="button" className="ds-btn" style={{ background: 'var(--positive-700)', color: '#fff' }} onClick={() => setNuovo('materiale')}>+ Materiale{aiOn ? ' (foto e Compila)' : ''}</button></div>}
          <input className="txt" placeholder="Cerca materiale, colore, fornitore…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: '100%', marginBottom: 8 }} />
          <div className="mat-filters">
            <button type="button" className={`chip ${tipo === '' ? 'on' : ''}`} onClick={() => setTipo('')}>Tutti</button>
            <button type="button" className={`chip ${tipo === 'acq' ? 'on' : ''}`} onClick={() => setTipo('acq')}>Acquistati</button>
            <button type="button" className={`chip ${tipo === 'off' ? 'on' : ''}`} onClick={() => setTipo('off')}>Offerte</button>
          </div>
          <div className="mat-filters">
            <button type="button" className={`chip ${cat === '' ? 'on' : ''}`} onClick={() => setCat('')}>Tutte le categorie</button>
            {CATEGORIE.filter((c) => gruppi.some((g) => g.categoria === c)).map((c) => <button key={c} type="button" className={`chip ${cat === c ? 'on' : ''}`} onClick={() => setCat(cat === c ? '' : c)}>{c}</button>)}
          </div>
          <div className="mat-filters">
            <button type="button" className={`chip ${fSup === '' ? 'on' : ''}`} onClick={() => setFSup('')}>Tutti i fornitori</button>
            {fornitoriNomi.map((f) => <button key={f} type="button" className={`chip ${fSup === f ? 'on' : ''}`} onClick={() => setFSup(fSup === f ? '' : f)}>{f}</button>)}
          </div>
          {visibili.length === 0
            ? <div className="card muted center">Nessun materiale con questi filtri.</div>
            : <div className="mat-grid">{visibili.map((g) => <Card key={g.key} g={g} url={g.foto_path ? urls[g.foto_path] : undefined} onOpen={() => setSel(g.key)} />)}</div>}
          <p className="muted" style={{ fontSize: 11, marginTop: 14 }}><Icon name="search" size={12} /> {canWrite ? `Nuovi materiali, offerte e foto si inseriscono da qui (firmi come ${who}); l'AI compila, tu confermi.` : 'Catalogo in sola lettura. Le scritture dall’app sono spente: fino all’accensione si inserisce nel Notion di Ginevra.'}</p>
        </>
      )}
    </div>
  );
}
