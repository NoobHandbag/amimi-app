import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchProducts, fetchInventory, fetchActiveFornitori, fetchSuppliers, fetchLastOrder, fetchLastPurchase, createOrderMulti, oggi } from '../lib/api';
import type { Product } from '../lib/api';
import { csClient } from '../lib/csClient';
import { aiCompila, matApi, preparaFoto, uploadInbox, v } from '../lib/matApi';
import type { PropostaFoglio, RigaFoglio } from '../lib/matApi';
import { deriveCodice, tok } from '../lib/helpers';
import { toast } from '../lib/toast';
import Icon from './Icon';

// Ordine da FOGLIO scritto a mano col fornitore (04-10, per Ginevra). Sul foglio la variante non e' scritta: e' il
// campione di pelle spillato. L'AI (ai-compila, target foglio_ordine, un foglio per chiamata) legge righe, quantita',
// interno e note e propone fino a 3 varianti candidate; qui Ginevra SCEGLIE la variante di ogni riga (nessuna e'
// preselezionata: e' la decisione che solo lei sa prendere), corregge e conferma. Scrittura = order_multi di
// write-api, invariata: un ordine solo per tutti i fogli. TUTTA/TUTTO = quantita' da definire all'arrivo (riga WIP,
// decisione owner 04-10); l'interno (colore della fodera, terza colonna del foglio) va nella nota della riga.

const norm = (s: string | null | undefined) => (s ?? '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
const MAX_FOGLI = 8;
const BASSA = 0.7;

type Foglio = { id: string; file: File; url: string; w: number; h: number; stato: 'attesa' | 'leggo' | 'ok' | 'errore'; errore?: string; logId?: string; avviso?: string | null; nota?: string | null };
type Scelta = { tipo: 'esistente'; codice: string; item: string | null; variant: string | null } | { tipo: 'nuova'; variant: string };
type Riga = {
  key: string; foglioId: string; posizione: number; box: number[] | null; modello: string;
  descr: string; scritto: string | null; candidati: string[];
  scelta: Scelta | null; primoScelto: boolean;
  wip: boolean; qty: string; interno: string; nota: string; costo: string; inclusa: boolean;
  qtyBassa: boolean; internoBassa: boolean;
  proposta: { wip: boolean; qty: string; interno: string };
};

// riga della foto ritagliata col box dell'AI (scala 0-1000), solo CSS: background ingrandito e spostato sul rettangolo
function Ritaglio({ f, box }: { f: Foglio; box: number[] | null }) {
  if (!box || !f.w || !f.h) return null;
  const [y0, x0, y1, x1] = box;
  const cw = ((x1 - x0) / 1000) * f.w, ch = ((y1 - y0) / 1000) * f.h;
  if (cw < 8 || ch < 8) return null;
  const px = f.w - cw > 0 ? ((x0 / 1000) * f.w) / (f.w - cw) * 100 : 0;
  const py = f.h - ch > 0 ? ((y0 / 1000) * f.h) / (f.h - ch) * 100 : 0;
  return <div style={{ width: '100%', aspectRatio: `${cw} / ${ch}`, backgroundImage: `url(${f.url})`, backgroundSize: `${(f.w / cw) * 100}% auto`, backgroundPosition: `${px}% ${py}%`, backgroundRepeat: 'no-repeat', borderRadius: 10, border: '1px solid var(--line)', marginBottom: 8 }} />;
}

const LAB = { fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--ink-muted)', margin: '6px 0 3px' } as const;

// tessera variante: foto Shopify grande quanto basta per confrontarla col campione del ritaglio
function Pill({ img, label, on, onClick }: { img: string; label: string; on?: boolean; onClick: () => void }) {
  return (
    <button type="button" className={'chip' + (on ? ' on' : '')} onClick={onClick} style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: 4, borderRadius: 12, width: 92 }}>
      <span style={{ width: 82, height: 82, borderRadius: 9, overflow: 'hidden', background: 'linear-gradient(160deg, #f3eee6, #efe7f7)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, color: '#b9a9df' }}>
        {img ? <img src={img} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : label.slice(0, 2)}
      </span>
      <span style={{ fontSize: 11, lineHeight: 1.15, overflowWrap: 'anywhere' }}>{label}</span>
    </button>
  );
}

export default function FoglioOrdine({ pin, chi, onDone, onCancel }: { pin: string; chi: string; onDone: () => void; onCancel: () => void }) {
  const [all, setAll] = useState<Product[]>([]);
  const [img, setImg] = useState<Map<string, string>>(new Map());
  const [fornitori, setFornitori] = useState<{ attivi: string[]; tutti: string[] }>({ attivi: [], tutti: [] });
  const [logged, setLogged] = useState<boolean | null>(null);
  const [lgEmail, setLgEmail] = useState(''); const [lgPwd, setLgPwd] = useState(''); const [lgBusy, setLgBusy] = useState(false); const [lgErr, setLgErr] = useState('');
  const [fogli, setFogli] = useState<Foglio[]>([]);
  const [righe, setRighe] = useState<Riga[]>([]);
  const [forn, setForn] = useState(''); const [fq, setFq] = useState('');
  const [dataOrd, setDataOrd] = useState(oggi());
  const [busy, setBusy] = useState(false);
  const [cerca, setCerca] = useState<{ key: string; q: string } | null>(null);
  const [nuova, setNuova] = useState<{ key: string; v: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const fogliRef = useRef<Foglio[]>([]);
  fogliRef.current = fogli;

  useEffect(() => {
    fetchProducts().then(setAll).catch(() => toast('Catalogo non letto: ricarica la pagina', 'err'));
    fetchInventory().then((inv) => setImg(new Map(inv.filter((r) => r.image_url).map((r) => [r.codice, r.image_url as string])))).catch(() => {});
    Promise.all([fetchActiveFornitori().catch(() => [] as string[]), fetchSuppliers().catch(() => [])])
      .then(([a, s]) => setFornitori({ attivi: [...a].sort((x, y) => x.localeCompare(y)), tutti: [...new Set([...a, ...s.map((x) => x.name)])] }));
    csClient.auth.getSession().then(({ data }) => setLogged(!!data.session)).catch(() => setLogged(false));
    const { data: sub } = csClient.auth.onAuthStateChange((_e, s) => setLogged(!!s));
    return () => { sub.subscription.unsubscribe(); fogliRef.current.forEach((f) => URL.revokeObjectURL(f.url)); };
  }, []);

  const perModello = useMemo(() => {
    const m = new Map<string, Product[]>();
    for (const p of all) if (p.item) { const k = norm(p.item); m.set(k, [...(m.get(k) ?? []), p]); }
    for (const l of m.values()) l.sort((a, b) => (a.variant ?? '').localeCompare(b.variant ?? ''));
    return m;
  }, [all]);
  const modelli = useMemo(() => [...new Set(all.filter((p) => p.item).map((p) => p.item!.toUpperCase()))].sort(), [all]);
  const byCodice = useMemo(() => new Map(all.map((p) => [p.codice, p])), [all]);

  async function login() {
    setLgBusy(true); setLgErr('');
    const { error } = await csClient.auth.signInWithPassword({ email: lgEmail.trim(), password: lgPwd });
    setLgBusy(false);
    if (error) setLgErr('Accesso non riuscito. Controlla email e password.'); else setLgPwd('');
  }

  async function aggiungiFoto(files: File[]) {
    const posto = MAX_FOGLI - fogli.length;
    if (files.length > posto) toast(`Al massimo ${MAX_FOGLI} fogli per ordine`, 'err');
    const nuovi: Foglio[] = [];
    for (const f of files.slice(0, posto)) {
      const p = await preparaFoto(f);
      nuovi.push({ id: crypto.randomUUID(), file: p.file, url: URL.createObjectURL(p.file), w: p.w, h: p.h, stato: 'attesa' });
    }
    setFogli((x) => [...x, ...nuovi]);
  }
  const togliFoto = (id: string) => setFogli((x) => { const f = x.find((y) => y.id === id); if (f) URL.revokeObjectURL(f.url); return x.filter((y) => y.id !== id); });
  const patchFoglio = (id: string, p: Partial<Foglio>) => setFogli((x) => x.map((f) => (f.id === id ? { ...f, ...p } : f)));

  const daRiga = (f: Foglio, x: RigaFoglio): Riga => {
    const nome = (x.modello?.match_esistente || v(x.modello) || '').toUpperCase();
    const modello = modelli.find((m) => norm(m) === norm(nome)) ?? nome;
    const varianti = perModello.get(norm(modello)) ?? [];
    // i candidati arrivano come NOMI di variante: si agganciano al catalogo del modello, il resto si scarta
    const candidati = [...new Set((x.candidati ?? []).map((c) => varianti.find((p) => norm(p.variant) === norm(c))?.codice).filter((c): c is string => !!c))];
    const qtyLetta = v(x.quantita);
    const qty = !x.tutta && qtyLetta != null ? String(qtyLetta) : '';
    const interno = v(x.interno) ?? '';
    // la cella quantita' di una riga TUTTA (stima e mq) resta leggibile nella nota: la quantita' si sa all'arrivo
    const nota = [x.tutta ? (x.quantita_scritta?.trim() || (x.stima_pezzi ? `TUTTA (stima ${x.stima_pezzi})` : 'TUTTA')) : null, x.note].filter(Boolean).join(' · ');
    return {
      key: `${f.id}:${x.posizione}:${Math.random().toString(36).slice(2, 7)}`, foglioId: f.id, posizione: x.posizione, box: x.box, modello,
      descr: x.campione?.descrizione ?? '', scritto: x.campione?.scritto ?? null, candidati,
      scelta: null, primoScelto: false, wip: !!x.tutta, qty, interno, nota, costo: '', inclusa: true,
      qtyBassa: !x.tutta && (qtyLetta == null || Number(x.quantita?.confidenza) < BASSA), internoBassa: !interno || Number(x.interno?.confidenza) < BASSA,
      proposta: { wip: !!x.tutta, qty, interno },
    };
  };

  async function leggi(f: Foglio) {
    patchFoglio(f.id, { stato: 'leggo', errore: undefined });
    try {
      const path = await uploadInbox(f.file, chi);
      const catalogo = [...new Set(all.filter((p) => p.item && p.variant).map((p) => `${p.item!.toUpperCase()} | ${p.variant}`))];
      const r = await aiCompila<PropostaFoglio>(chi, 'foglio_ordine', [path], '', { catalogo, fornitori: fornitori.tutti });
      const p = r.proposta;
      patchFoglio(f.id, { stato: 'ok', logId: r.log_id, avviso: p.avviso, nota: v(p.note) });
      const fp = p.fornitore?.match_esistente || v(p.fornitore);
      if (fp) setForn((x) => x || fp);
      const nuove = [...(p.righe ?? [])].sort((a, b) => a.posizione - b.posizione).map((x) => daRiga(f, x));
      setRighe((prev) => [...prev.filter((x) => x.foglioId !== f.id), ...nuove]);
      if (!nuove.length) toast('Nessuna riga letta su questo foglio: rifai la foto piu\' dritta e vicina', 'err');
    } catch (e) { patchFoglio(f.id, { stato: 'errore', errore: (e as Error).message }); }
  }
  const leggiTutti = () => Promise.all(fogli.filter((f) => f.stato === 'attesa' || f.stato === 'errore').map(leggi));

  const patch = (key: string, p: Partial<Riga>) => setRighe((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));
  // costo dallo storico (ultimo ordine, poi ultimo acquisto) solo se il campo e' ancora vuoto: mai bloccante.
  // Uno storico a 0 (righe legacy) non e' un costo: il campo resta vuoto.
  const prefillCosto = (key: string, codice: string) => {
    const metti = (c: number | null | undefined) => { const okc = c != null && Number(c) > 0; if (okc) setRighe((rs) => rs.map((r) => (r.key === key && r.costo === '' ? { ...r, costo: String(c) } : r))); return okc; };
    fetchLastOrder(codice).then((lo) => { if (!metti(lo?.costo_unitario)) fetchLastPurchase(codice).then((lp) => metti(lp?.costo_unitario)).catch(() => {}); }).catch(() => {});
  };
  const scegli = (r: Riga, p: Product) => {
    patch(r.key, { scelta: { tipo: 'esistente', codice: p.codice, item: p.item, variant: p.variant }, primoScelto: r.candidati[0] === p.codice, costo: '' });
    setCerca(null); setNuova(null);
    prefillCosto(r.key, p.codice);
  };

  const incluse = righe.filter((r) => r.inclusa);
  const codiceDi = (r: Riga) => (r.scelta?.tipo === 'esistente' ? r.scelta.codice : r.scelta ? deriveCodice(r.modello, r.scelta.variant) : '');
  const problemi = useMemo(() => {
    const out: string[] = [];
    if (!forn.trim()) out.push('scegli il fornitore');
    const sv = incluse.filter((r) => !r.scelta).length;
    if (sv) out.push(`${sv} ${sv === 1 ? 'riga senza variante' : 'righe senza variante'}`);
    const sq = incluse.filter((r) => !r.wip && !(Number.isInteger(Number(r.qty)) && Number(r.qty) > 0)).length;
    if (sq) out.push(`${sq} ${sq === 1 ? 'quantità mancante' : 'quantità mancanti'} (o "da definire all'arrivo")`);
    if (incluse.some((r) => r.costo !== '' && !(Number(r.costo) >= 0))) out.push('un costo non valido');
    const visti = new Map<string, number>();
    for (const r of incluse) if (r.scelta) { const c = norm(codiceDi(r)); visti.set(c, (visti.get(c) ?? 0) + 1); }
    const doppi = [...visti.entries()].filter(([, n]) => n > 1).map(([c]) => c);
    if (doppi.length) out.push(`stessa borsa su più righe (${doppi.join(', ')}): tienine una o cambia variante`);
    if (!incluse.length) out.push('nessuna riga da inserire');
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [righe, forn]);

  async function inserisci() {
    if (problemi.length) return toast('Prima: ' + problemi.join(' · '), 'err');
    setBusy(true);
    try {
      const payload = incluse.map((r) => {
        const note = [r.interno.trim() ? `Interno ${r.interno.trim()}` : '', r.nota.trim()].filter(Boolean).join(' · ') || null;
        const base = { qty_ordered: r.wip ? 0 : Number(r.qty), wip: r.wip, costo_unitario: r.costo === '' ? null : Number(r.costo), note };
        const s = r.scelta!;
        if (s.tipo === 'esistente') return { ...base, codice: s.codice, item: s.item, variant: s.variant, nuovo_riordino: 'Riordino' };
        // variante nuova: codice PROVVISORIO (lo deriva comunque il server); lo finalizza la verifica in pulizia dati
        return { ...base, codice: deriveCodice(r.modello, s.variant), item: r.modello, variant: tok(s.variant), nuovo_riordino: 'Nuovo' };
      });
      const res = await createOrderMulti(forn.trim(), dataOrd, payload, pin, chi) as unknown as { lines: number; stubs: number; gruppo: string };
      toast(`Ordine salvato · ${res.lines} righe${res.stubs ? ` · ${res.stubs} varianti nuove da verificare` : ''}`, 'ok');
      // esito per foglio in ai_compila_log (quanto aiuta l'AI): confermato = ogni riga presa con il PRIMO candidato e
      // quantita'/interno come letti; altrimenti modificato. Best effort, mai bloccante.
      for (const f of fogli) {
        if (!f.logId) continue;
        const rs = righe.filter((r) => r.foglioId === f.id);
        const intatto = rs.length > 0 && rs.every((r) => r.inclusa && r.primoScelto && r.wip === r.proposta.wip && r.qty === r.proposta.qty && r.interno === r.proposta.interno);
        matApi('ai_esito', chi, { ai_log_id: f.logId, esito: intatto ? 'confermato' : 'modificato', ref_tabella: 'supplier_orders', ref_id: res.gruppo }).catch(() => {});
      }
      setTimeout(onDone, 700);
    } catch (e) { toast((e as Error).message, 'err'); setBusy(false); }
  }

  const esci = () => { if (!righe.length || window.confirm('Uscire? Le righe lette dai fogli non sono ancora salvate.')) onCancel(); };

  if (logged === false) return (
    <div className="form">
      <button className="back" onClick={onCancel}>← Ordini</button>
      <div className="mat-aibox">
        <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>Per leggere i fogli serve il login @amimi.it (una volta per dispositivo).</div>
        <input className="txt" type="email" autoCapitalize="none" autoCorrect="off" value={lgEmail} onChange={(e) => setLgEmail(e.target.value)} placeholder="Email @amimi.it" style={{ width: '100%', marginBottom: 6 }} />
        <input className="txt" type="password" value={lgPwd} onChange={(e) => setLgPwd(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') login(); }} placeholder="Password" style={{ width: '100%', marginBottom: 6 }} />
        {lgErr && <div className="err" style={{ marginBottom: 6 }}>{lgErr}</div>}
        <button type="button" className="ds-btn secondary full" disabled={lgBusy || !lgEmail.trim() || !lgPwd} onClick={login}>{lgBusy ? 'Accesso…' : 'Entra'}</button>
      </div>
    </div>
  );

  const daLeggere = fogli.filter((f) => f.stato === 'attesa' || f.stato === 'errore').length;
  const pezzi = incluse.reduce((s, r) => s + (r.wip ? 0 : Number(r.qty) || 0), 0);
  const nWip = incluse.filter((r) => r.wip).length;
  const fs = fq.trim().toLowerCase();

  return (
    <div className="form">
      <button className="back" onClick={esci}>← Ordini</button>
      <div className="muted" style={{ fontSize: 13, marginBottom: 10, lineHeight: 1.45 }}>
        Fotografa i fogli fatti col fornitore, uno per foto, dritti e interi. Leggo quantità, interno e note; la variante di ogni campione la scegli tu.
      </div>

      <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: 'none' }}
        onChange={(e) => { const fl = [...(e.target.files ?? [])]; e.target.value = ''; aggiungiFoto(fl); }} />
      <div className="mat-files" style={{ marginBottom: 10 }}>
        {fogli.map((f, i) => (
          <span key={f.id} className="chip" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 10px 3px 3px' }}>
            <span className="ds-thumb" style={{ width: 30, height: 30, borderRadius: 7 }}><img src={f.url} alt="" /></span>
            Foglio {i + 1}{f.stato === 'leggo' ? ' · leggo…' : f.stato === 'ok' ? ' · letto' : f.stato === 'errore' ? ' · errore' : ''}
            {f.stato === 'attesa' && <button type="button" className="linkbtn" onClick={() => togliFoto(f.id)} aria-label="Togli foto">✕</button>}
          </span>
        ))}
        {fogli.length < MAX_FOGLI && <button type="button" className="chip" onClick={() => fileRef.current?.click()}>+ foto foglio</button>}
      </div>
      {daLeggere > 0 && (
        <button type="button" className="ds-btn secondary full" style={{ marginBottom: 12 }} disabled={!all.length || logged === null || fogli.some((f) => f.stato === 'leggo')} onClick={leggiTutti}>
          <Icon name="sparkles" size={15} /> {fogli.some((f) => f.stato === 'leggo') ? 'Leggo i fogli…' : `Leggi ${daLeggere === 1 ? 'il foglio' : `i ${daLeggere} fogli`}`}
        </button>
      )}

      {fogli.map((f, fi) => {
        const rs = righe.filter((r) => r.foglioId === f.id).sort((a, b) => a.posizione - b.posizione);
        if (f.stato === 'attesa') return null;
        return (
          <div key={f.id} style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '6px 0 8px', flexWrap: 'wrap' }}>
              <b style={{ fontSize: 14 }}>Foglio {fi + 1}</b>
              {/* il modello e' l'intestazione del foglio: vale per tutte le sue righe; cambiarlo azzera varianti e candidati */}
              {rs.length > 0 && (
                <select className="txt" style={{ padding: '4px 6px', fontSize: 13, width: 'auto' }} value={rs[0].modello}
                  onChange={(e) => setRighe((all0) => all0.map((x) => (x.foglioId === f.id ? { ...x, modello: e.target.value, scelta: null, candidati: [], primoScelto: false } : x)))}>
                  {!modelli.includes(rs[0].modello) && <option value={rs[0].modello}>{rs[0].modello || '(modello non letto)'}</option>}
                  {modelli.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              )}
              {f.stato === 'ok' && <span className="muted" style={{ fontSize: 12.5 }}>{rs.length} righe</span>}
            </div>
            {f.stato === 'leggo' && <div className="card muted" style={{ fontSize: 13 }}>Leggo il foglio, di solito 10-20 secondi…</div>}
            {f.stato === 'errore' && <div className="card" style={{ fontSize: 13 }}><span className="err">Non sono riuscito a leggerlo: {f.errore}</span> <button type="button" className="linkbtn" style={{ fontWeight: 700 }} onClick={() => leggi(f)}>Riprova</button></div>}
            {f.avviso && <div className="card warn">{f.avviso}</div>}
            {f.nota && <div className="muted" style={{ fontSize: 12, margin: '0 2px 8px' }}>Sul foglio, fuori ordine: {f.nota}</div>}
            {rs.map((r) => {
              const varianti = perModello.get(norm(r.modello)) ?? [];
              const scelto = r.scelta?.tipo === 'esistente' ? byCodice.get(r.scelta.codice) : null;
              const qCerca = cerca?.key === r.key ? norm(cerca.q) : '';
              const trovate = cerca?.key === r.key ? varianti.filter((p) => !qCerca || norm(p.variant).includes(qCerca)).slice(0, 24) : [];
              return (
                <div key={r.key} className="card" style={{ padding: 12, opacity: r.inclusa ? 1 : 0.5 }}>
                  <Ritaglio f={f} box={r.box} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline', marginBottom: 6 }}>
                    <div style={{ fontSize: 13 }}><b>Riga {r.posizione}</b> <span className="muted">{r.descr}{r.scritto ? ` · scritto "${r.scritto}"` : ''}</span></div>
                    <button type="button" className="linkbtn" style={{ fontSize: 12, textDecoration: 'underline', whiteSpace: 'nowrap' }} onClick={() => patch(r.key, { inclusa: !r.inclusa })}>{r.inclusa ? 'Togli' : 'Rimetti'}</button>
                  </div>
                  {r.inclusa && (
                    <>
                      <div style={LAB}>Variante{r.modello !== rs[0].modello ? ` · ${r.modello}` : ''}</div>
                      {r.scelta ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                          {scelto ? <Pill img={img.get(scelto.codice) ?? ''} label={scelto.variant ?? scelto.codice} on onClick={() => patch(r.key, { scelta: null, primoScelto: false })} />
                            : <span className="chip on">{tok(r.scelta.tipo === 'nuova' ? r.scelta.variant : '')} <span className="newtag">nuova</span></span>}
                          <button type="button" className="linkbtn" style={{ fontSize: 12, textDecoration: 'underline' }} onClick={() => patch(r.key, { scelta: null, primoScelto: false })}>cambia</button>
                        </div>
                      ) : (
                        <div className="mat-files" style={{ marginBottom: 6 }}>
                          {r.candidati.map((c) => { const p = byCodice.get(c); return p ? <Pill key={c} img={img.get(c) ?? ''} label={p.variant ?? c} onClick={() => scegli(r, p)} /> : null; })}
                          <button type="button" className="chip" onClick={() => { setNuova(null); setCerca(cerca?.key === r.key ? null : { key: r.key, q: '' }); }}>{r.candidati.length ? 'Altra…' : 'Scegli variante…'}</button>
                          <button type="button" className="chip" onClick={() => { setCerca(null); setNuova(nuova?.key === r.key ? null : { key: r.key, v: r.scritto ?? '' }); }}>+ Nuova</button>
                        </div>
                      )}
                      {cerca?.key === r.key && !r.scelta && (
                        <div className="mat-aibox">
                          <input className="txt" autoFocus value={cerca.q} onChange={(e) => setCerca({ key: r.key, q: e.target.value })} placeholder={`Cerca fra le ${varianti.length} varianti di ${r.modello}`} style={{ width: '100%', marginBottom: 6 }} />
                          <div className="mat-files">{trovate.map((p) => <Pill key={p.codice} img={img.get(p.codice) ?? ''} label={p.variant ?? p.codice} onClick={() => scegli(r, p)} />)}</div>
                          {!trovate.length && <div className="muted" style={{ fontSize: 12 }}>Nessuna variante trovata: usa "+ Nuova".</div>}
                        </div>
                      )}
                      {nuova?.key === r.key && !r.scelta && (
                        <div className="mat-aibox" style={{ display: 'flex', gap: 6 }}>
                          <input className="txt" autoFocus value={nuova.v} onChange={(e) => setNuova({ key: r.key, v: e.target.value })} placeholder="Nome variante (es. Cavallino tigrato)" style={{ flex: 1 }} />
                          <button type="button" className="submit small" disabled={!tok(nuova.v)} onClick={() => { patch(r.key, { scelta: { tipo: 'nuova', variant: nuova.v.trim() }, primoScelto: false }); setNuova(null); toast('Variante nuova: codice provvisorio, da verificare in pulizia dati'); }}>Usa</button>
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                        <div>
                          <div style={LAB}>Pezzi</div>
                          {r.wip
                            ? <button type="button" className="chip on" title="TUTTA: i pezzi si sanno all'arrivo" onClick={() => patch(r.key, { wip: false })}>da definire all'arrivo ✕</button>
                            : <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                <input className={'txt' + (r.qtyBassa ? ' mat-low' : '')} style={{ width: 72 }} type="number" inputMode="numeric" value={r.qty} onChange={(e) => patch(r.key, { qty: e.target.value, qtyBassa: false })} placeholder="pz" />
                                <button type="button" className="linkbtn" style={{ fontSize: 11.5, textDecoration: 'underline' }} onClick={() => patch(r.key, { wip: true })}>tutta</button>
                              </div>}
                        </div>
                        <div>
                          <div style={LAB}>Interno</div>
                          <input className={'txt' + (r.internoBassa ? ' mat-low' : '')} style={{ width: 96 }} value={r.interno} onChange={(e) => patch(r.key, { interno: e.target.value, internoBassa: false })} placeholder="es. 91" />
                        </div>
                        <div>
                          <div style={LAB}>€ al pezzo</div>
                          <input className="txt" style={{ width: 80 }} type="number" inputMode="decimal" value={r.costo} onChange={(e) => patch(r.key, { costo: e.target.value })} placeholder="€/pz" />
                        </div>
                      </div>
                      <div style={LAB}>Nota</div>
                      <input className="txt" style={{ width: '100%' }} value={r.nota} onChange={(e) => patch(r.key, { nota: e.target.value })} placeholder="es. con asole" />
                    </>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}

      {righe.length > 0 && (
        <>
          <div style={{ ...LAB, marginTop: 14 }}>Fornitore</div>
          {forn ? (
            <button type="button" className="chip on" onClick={() => setForn('')}>{forn} ✕</button>
          ) : (
            <>
              <div className="ds-lens" style={{ marginTop: 2 }}>{fornitori.attivi.map((n) => <button key={n} type="button" className="ds-fp" onClick={() => setForn(n)}>{n}</button>)}</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <input className="txt" style={{ flex: 1 }} value={fq} onChange={(e) => setFq(e.target.value)} placeholder="Altro fornitore…" list="foglio-fornitori" />
                <datalist id="foglio-fornitori">{fornitori.tutti.filter((n) => !fs || n.toLowerCase().includes(fs)).map((n) => <option key={n} value={n} />)}</datalist>
                <button type="button" className="chip" disabled={!fq.trim()} onClick={() => { setForn(fq.trim()); setFq(''); }}>Usa</button>
              </div>
            </>
          )}
          <div style={{ ...LAB, marginTop: 12 }}>Data ordine</div>
          <input className="txt" type="date" value={dataOrd} onChange={(e) => setDataOrd(e.target.value)} />
          <div className="muted" style={{ fontSize: 13, marginTop: 12 }}>{incluse.length} righe · {pezzi} pezzi{nWip ? ` + ${nWip} da definire all'arrivo` : ''}</div>
          {problemi.length > 0 && <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>Prima di inserire: {problemi.join(' · ')}</div>}
          <button className="submit" disabled={busy || problemi.length > 0} onClick={inserisci}>{busy ? 'Salvo…' : `Inserisci ordine (${incluse.length} righe)`}</button>
        </>
      )}
    </div>
  );
}
