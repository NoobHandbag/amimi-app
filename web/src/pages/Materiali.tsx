import { useEffect, useMemo, useRef, useState } from 'react';
import { csClient } from '../lib/csClient';
import { CATEGORIE, TINTA, UNITA, aiCompila, bassa, fetchAcquisti, fetchAssets, fetchCatalogo, fetchFornitori, fetchMatSettings, fmtPrezzo, matApi, raggruppa, signedUrls, uploadInbox, v } from '../lib/matApi';
import type { AiCampo, MatAcquisto, MatAsset, MatCatalogo, MatFornitore, MatGruppo, MatSettings, PropostaFornitore, PropostaMateriale } from '../lib/matApi';
import Icon from '../components/Icon';
import { toast } from '../lib/toast';

// Sezione "Materie prime" (modulo mat_*, migr 0140 + 0144): il catalogo dei materiali offerti o acquistati dai
// fornitori di pelli, tessuti, nastri e accessori, in stile vetrina, con scheda, fornitori e (Fase 2) i form di
// inserimento con lo strato AI "Compila": foto o documento + nota dettata -> proposta dei campi -> l'umano corregge e
// conferma -> la edge mat-api scrive. E' la meta' MATERIE PRIME dell'area Fornitori (l'altra e' Ordini). Niente stock, niente CE.
// Login Supabase Auth @amimi.it (stesso client di Assistenza e Negozi); foto e PDF nel bucket privato mat-assets con URL firmati.
// Flag: mat_enabled (sezione), mat_write_enabled (bottoni di scrittura), ai_compila_enabled (bottone "Compila").

const fmtD = (iso: string | null | undefined) => { if (!iso) return ''; const d = new Date(iso); return isNaN(d.getTime()) ? iso.slice(0, 10) : d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' }); };
const eur = (n: number | null | undefined) => (n == null ? '' : Number(n).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €');
const num = (n: number | null | undefined) => (n == null ? '' : Number(n).toLocaleString('it-IT', { maximumFractionDigits: 3 }));
const tinta = (cat: string): [string, string] => TINTA[cat] ?? ['#b8b8b8', '#8a8a8a'];
const isImg = (a: MatAsset) => a.tipo === 'foto' && /^image\//.test(a.mime ?? '');
const oggi = () => new Date().toISOString().slice(0, 10);

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

// ---- "Foto o documento + nota" + bottone Compila: il pezzo comune ai tre form (materiale, fornitore, ordine) ----
function AiBox({ files, setFiles, testo, setTesto, busy, onCompila, abilitato, avviso }: { files: File[]; setFiles: (f: File[]) => void; testo: string; setTesto: (s: string) => void; busy: boolean; onCompila: () => void; abilitato: boolean; avviso: string | null }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="mat-aibox">
      <div className="rl">Foto o documento</div>
      <input ref={ref} type="file" accept="image/*,application/pdf" capture="environment" multiple style={{ display: 'none' }}
        onChange={(e) => { const nf = [...(e.target.files ?? [])]; setFiles([...files, ...nf].slice(0, 4)); e.target.value = ''; }} />
      <div className="mat-files">
        {files.map((f, i) => <span key={i} className="chip" onClick={() => setFiles(files.filter((_, j) => j !== i))}>{f.name.slice(0, 22)} ✕</span>)}
        <button type="button" className="chip" onClick={() => ref.current?.click()} disabled={files.length >= 4}>+ foto / PDF</button>
      </div>
      <textarea className="txt" rows={2} value={testo} onChange={(e) => setTesto(e.target.value)} placeholder="Nota (detta col microfono della tastiera): es. offerta Damapel cocco nero e bordeaux, 40 al mq…" style={{ width: '100%', marginTop: 8 }} />
      {abilitato
        ? <button type="button" className="ds-btn secondary full" style={{ marginTop: 8 }} disabled={busy || (!files.length && !testo.trim())} onClick={onCompila}><Icon name="sparkles" size={16} /> {busy ? 'Compilo…' : 'Compila con l\'AI'}</button>
        : <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>Compilazione AI spenta: compila a mano (i file si allegano comunque al salvataggio).</div>}
      {avviso && <div className="card warn" style={{ marginTop: 8, marginBottom: 0 }}>{avviso}</div>}
    </div>
  );
}
const cls = (low: Set<string>, k: string) => `txt${low.has(k) ? ' mat-low' : ''}`;

// ---- Nuovo materiale (con offerta iniziale e file) ----
function NuovoMateriale({ chi, settings, fornitori, gruppi, onBack, onSaved }: { chi: string; settings: MatSettings; fornitori: MatFornitore[]; gruppi: MatGruppo[]; onBack: () => void; onSaved: () => void }) {
  const [files, setFiles] = useState<File[]>([]); const [testo, setTesto] = useState('');
  const [busy, setBusy] = useState(false); const [saving, setSaving] = useState(false);
  const [logId, setLogId] = useState<string | null>(null); const [prop, setProp] = useState<PropostaMateriale | null>(null);
  const [paths, setPaths] = useState<string[]>([]); const [avviso, setAvviso] = useState<string | null>(null);
  const [low, setLow] = useState<Set<string>>(new Set());
  const [f, setF] = useState({ fornitore: '', categoria: '', materiale: '', articolo: '', colori: '', unita: '', tipo: 'offerta', prezzo: '', prezzoText: '', disponibilita: '', minOrdine: '', leadTime: '', condizioni: '', data: oggi(), documento: '', note: '' });
  const set = (k: keyof typeof f, val: string) => setF((p) => ({ ...p, [k]: val }));
  const nomiForn = useMemo(() => fornitori.map((x) => x.nome), [fornitori]);
  const nomiMat = useMemo(() => [...new Set(gruppi.map((g) => g.materiale))], [gruppi]);
  const fornEsiste = nomiForn.some((n) => n.toLowerCase() === f.fornitore.trim().toLowerCase());

  const compila = async () => {
    setBusy(true); setAvviso(null);
    try {
      const up = paths.length === files.length ? paths : await Promise.all(files.map((fl) => uploadInbox(fl, chi)));
      setPaths(up);
      const r = await aiCompila<PropostaMateriale>(chi, 'materiale', up, testo, { fornitori: nomiForn, materiali: nomiMat });
      const p = r.proposta; setProp(p); setLogId(r.log_id); setAvviso(p.avviso);
      const lowSet = new Set<string>();
      const pick = (k: keyof typeof f, c: { valore: unknown; confidenza: number } | undefined, val: string | null) => { if (val != null && val !== '') { set(k, val); if (bassa(c as never)) lowSet.add(k); } };
      pick('fornitore', p.fornitore, p.fornitore?.match_esistente || v(p.fornitore));
      pick('categoria', p.categoria, v(p.categoria)); pick('materiale', p.materiale, p.materiale?.match_esistente || v(p.materiale));
      pick('articolo', p.articolo_fornitore, v(p.articolo_fornitore));
      const colori = (p.colori ?? []).map((c) => c.valore).filter(Boolean).join(', '); if (colori) { set('colori', colori); if ((p.colori ?? []).some((c) => bassa(c))) lowSet.add('colori'); }
      pick('unita', p.unita, v(p.unita)); pick('tipo', p.tipo, v(p.tipo));
      if (p.prezzo?.valore != null) pick('prezzo', p.prezzo, String(p.prezzo.valore)); else if (p.prezzo?.testo) pick('prezzoText', p.prezzo, p.prezzo.testo);
      pick('disponibilita', p.disponibilita, v(p.disponibilita)); pick('minOrdine', p.min_ordine, v(p.min_ordine)); pick('leadTime', p.lead_time, v(p.lead_time));
      pick('condizioni', p.condizioni_pagamento, v(p.condizioni_pagamento)); pick('data', p.data, v(p.data)); pick('documento', p.documento_fonte, v(p.documento_fonte));
      const extra = [v(p.note), p.quantita?.valore != null ? `Acquisto: quantita' ${p.quantita.valore}` : null, p.importo_totale?.valore != null ? `importo ${p.importo_totale.valore}` : null].filter(Boolean).join('. ');
      if (extra) set('note', extra);
      setLow(lowSet);
      toast('Proposta pronta: controlla i campi evidenziati e conferma', 'ok');
    } catch (e) { toast((e as Error).message, 'err'); }
    finally { setBusy(false); }
  };

  const salva = async () => {
    const forn = f.fornitore.trim(), mat = f.materiale.trim();
    if (!forn) return toast('Fornitore mancante', 'err');
    if (!f.categoria) return toast('Scegli la categoria', 'err');
    if (!mat) return toast('Nome del materiale mancante', 'err');
    if (f.prezzo && !/^\d+([.,]\d+)?$/.test(f.prezzo.trim())) return toast('Prezzo: un numero, oppure usa il campo testo per range e scaglioni', 'err');
    setSaving(true);
    try {
      const modificato = !!prop && (v(prop.materiale) !== mat || String(prop.prezzo?.valore ?? '') !== f.prezzo.trim() || (prop.colori ?? []).map((c) => c.valore).join(', ') !== f.colori.trim());
      const sup = await matApi('supplier_upsert', chi, { nome: forn, condizioni_pagamento: f.condizioni || null });
      const colori = f.colori.split(/[,;\n]/).map((c) => c.trim()).filter(Boolean);
      const offerta = (f.prezzo || f.prezzoText || f.disponibilita) ? { tipo: 'offerta', prezzo: f.prezzo ? Number(f.prezzo.replace(',', '.')) : null, prezzo_text: f.prezzo ? null : (f.prezzoText || null), unita: f.unita || null, disponibilita: f.disponibilita || null, min_ordine: f.minOrdine || null, lead_time: f.leadTime || null, data: f.data || null, documento_fonte: f.documento || null } : null;
      const res = await matApi('item_upsert', chi, { supplier_id: sup.id, categoria: f.categoria, materiale: mat, articolo_fornitore: f.articolo || null, colori: colori.length ? colori : [null], unita: f.unita || null, note: [f.note, f.tipo === 'acquistato' ? `Acquisto (registrazione acquisti in Fase 3): ${f.documento || ''}` : ''].filter(Boolean).join('. ') || null, offerta, ai_log_id: logId, ai_modificato: modificato });
      const up = paths.length === files.length ? paths : await Promise.all(files.map((fl) => uploadInbox(fl, chi)));
      for (let i = 0; i < up.length; i++) {
        const fl = files[i];
        await matApi('asset_add', chi, { path: up[i], tipo: fl.type.startsWith('image/') ? 'foto' : 'scheda_tecnica', titolo: fl.name, supplier_id: sup.id, materiale: mat, fonte: `app, ${chi}, ${oggi()}` });
      }
      const items = (res.items as { creato: boolean }[]) ?? [];
      toast(`Salvato: ${items.filter((i) => i.creato).length} colori nuovi, ${items.length - items.filter((i) => i.creato).length} gia' presenti, ${up.length} file`, 'ok');
      onSaved();
    } catch (e) { toast((e as Error).message, 'err'); }
    finally { setSaving(false); }
  };

  return (
    <div className="screen">
      <header><h1>Nuovo materiale</h1></header>
      <button className="back" onClick={onBack} type="button">← Catalogo</button>
      <AiBox files={files} setFiles={setFiles} testo={testo} setTesto={setTesto} busy={busy} onCompila={compila} abilitato={settings.ai} avviso={avviso} />
      <div className="card mat-form">
        <label className="fl">Fornitore {f.fornitore && !fornEsiste && <span className="mat-badge">nuovo</span>}</label>
        <input className={cls(low, 'fornitore')} list="mat-forn" value={f.fornitore} onChange={(e) => set('fornitore', e.target.value)} placeholder="Es. Damapel" />
        <datalist id="mat-forn">{nomiForn.map((n) => <option key={n} value={n} />)}</datalist>
        {!fornEsiste && f.fornitore && <input className={cls(low, 'condizioni')} value={f.condizioni} onChange={(e) => set('condizioni', e.target.value)} placeholder="Condizioni di pagamento (se le sai)" />}
        <label className="fl">Categoria</label>
        <div className="chips">{CATEGORIE.map((c) => <button key={c} type="button" className={`chip ${f.categoria === c ? 'on' : ''}${low.has('categoria') && f.categoria === c ? ' mat-low' : ''}`} onClick={() => set('categoria', c)}>{c}</button>)}</div>
        <label className="fl">Materiale</label>
        <input className={cls(low, 'materiale')} list="mat-mat" value={f.materiale} onChange={(e) => set('materiale', e.target.value)} placeholder="Es. Cocco stampato lucido" />
        <datalist id="mat-mat">{nomiMat.map((n) => <option key={n} value={n} />)}</datalist>
        <input className={cls(low, 'articolo')} value={f.articolo} onChange={(e) => set('articolo', e.target.value)} placeholder="Articolo del fornitore (opzionale)" />
        <label className="fl">Colori (separati da virgola)</label>
        <input className={cls(low, 'colori')} value={f.colori} onChange={(e) => set('colori', e.target.value)} placeholder="Nero, Bordeaux, Marrone" />
        <label className="fl">Unita' e tipo</label>
        <div className="chips">{UNITA.map((u) => <button key={u} type="button" className={`chip ${f.unita === u ? 'on' : ''}`} onClick={() => set('unita', f.unita === u ? '' : u)}>{u}</button>)}
          <span style={{ width: 8 }} />
          <button type="button" className={`chip ${f.tipo === 'offerta' ? 'on' : ''}`} onClick={() => set('tipo', 'offerta')}>offerta</button>
          <button type="button" className={`chip ${f.tipo === 'acquistato' ? 'on' : ''}`} onClick={() => set('tipo', 'acquistato')}>acquistato</button></div>
        <label className="fl">Prezzo</label>
        <div style={{ display: 'flex', gap: 6 }}>
          <input className={cls(low, 'prezzo')} type="text" inputMode="decimal" value={f.prezzo} onChange={(e) => set('prezzo', e.target.value)} placeholder="numero (es. 40)" style={{ flex: 1 }} />
          <input className={cls(low, 'prezzoText')} value={f.prezzoText} onChange={(e) => set('prezzoText', e.target.value)} placeholder="o testo fedele (40-45/mq)" style={{ flex: 2 }} />
        </div>
        <input className={cls(low, 'disponibilita')} value={f.disponibilita} onChange={(e) => set('disponibilita', e.target.value)} placeholder="Disponibilita' (es. ~120 mq in stock)" />
        <div style={{ display: 'flex', gap: 6 }}>
          <input className={cls(low, 'minOrdine')} value={f.minOrdine} onChange={(e) => set('minOrdine', e.target.value)} placeholder="Minimo d'ordine" style={{ flex: 1 }} />
          <input className={cls(low, 'leadTime')} value={f.leadTime} onChange={(e) => set('leadTime', e.target.value)} placeholder="Tempi (es. 4-5 settimane)" style={{ flex: 1 }} />
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <input className={cls(low, 'data')} type="date" value={f.data} onChange={(e) => set('data', e.target.value)} style={{ flex: 1 }} />
          <input className={cls(low, 'documento')} value={f.documento} onChange={(e) => set('documento', e.target.value)} placeholder="Fonte (es. email Damapel 07/09, proforma 496)" style={{ flex: 2 }} />
        </div>
        <textarea className={cls(low, 'note')} rows={2} value={f.note} onChange={(e) => set('note', e.target.value)} placeholder="Note" />
        {low.size > 0 && <div className="muted" style={{ fontSize: 11 }}>I campi in giallo hanno confidenza bassa: controllali sul documento.</div>}
        <button className="submit" disabled={saving} onClick={salva} type="button">{saving ? 'Salvo…' : 'Conferma e salva'}</button>
      </div>
    </div>
  );
}

// ---- Nuovo fornitore ----
function NuovoFornitore({ chi, settings, fornitori, onBack, onSaved }: { chi: string; settings: MatSettings; fornitori: MatFornitore[]; onBack: () => void; onSaved: () => void }) {
  const [files, setFiles] = useState<File[]>([]); const [testo, setTesto] = useState('');
  const [busy, setBusy] = useState(false); const [saving, setSaving] = useState(false);
  const [logId, setLogId] = useState<string | null>(null); const [avviso, setAvviso] = useState<string | null>(null); const [paths, setPaths] = useState<string[]>([]);
  const [low, setLow] = useState<Set<string>>(new Set());
  const [f, setF] = useState({ nome: '', ragione_sociale: '', categoria_principale: '', email: '', telefono: '', referente: '', indirizzo: '', piva_vat: '', deposito_luogo: '', condizioni_pagamento: '', note: '' });
  const set = (k: keyof typeof f, val: string) => setF((p) => ({ ...p, [k]: val }));
  const esiste = fornitori.find((x) => x.nome.toLowerCase() === f.nome.trim().toLowerCase());
  const compila = async () => {
    setBusy(true); setAvviso(null);
    try {
      const up = paths.length === files.length ? paths : await Promise.all(files.map((fl) => uploadInbox(fl, chi))); setPaths(up);
      const r = await aiCompila<PropostaFornitore>(chi, 'fornitore', up, testo, { fornitori: fornitori.map((x) => x.nome) });
      const p = r.proposta; setLogId(r.log_id); setAvviso(p.avviso);
      const lowSet = new Set<string>();
      for (const k of Object.keys(f) as (keyof typeof f)[]) { const c = (p as unknown as Record<string, AiCampo | undefined>)[k]; const val = k === 'nome' ? (c?.match_esistente || c?.valore) : c?.valore; if (val) { set(k, val); if (bassa(c)) lowSet.add(k); } }
      setLow(lowSet); toast('Proposta pronta: controlla e conferma', 'ok');
    } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); }
  };
  const salva = async () => {
    if (!f.nome.trim()) return toast('Nome mancante', 'err');
    setSaving(true);
    try {
      const res = await matApi('supplier_upsert', chi, { ...f, nome: f.nome.trim(), ai_log_id: logId });
      const up = paths.length === files.length ? paths : await Promise.all(files.map((fl) => uploadInbox(fl, chi)));
      for (let i = 0; i < up.length; i++) await matApi('asset_add', chi, { path: up[i], tipo: 'documento', titolo: files[i].name, supplier_id: res.id, fonte: `app, ${chi}, ${oggi()}` });
      toast(res.creato ? 'Fornitore creato' : 'Fornitore aggiornato', 'ok'); onSaved();
    } catch (e) { toast((e as Error).message, 'err'); } finally { setSaving(false); }
  };
  const campi: [keyof typeof f, string][] = [['nome', 'Nome corto (es. Vicenza Pelli)'], ['ragione_sociale', 'Ragione sociale'], ['categoria_principale', 'Cosa vende (es. pelli stampate)'], ['email', 'Email'], ['telefono', 'Telefono'], ['referente', 'Referente'], ['indirizzo', 'Indirizzo'], ['piva_vat', 'P.IVA'], ['deposito_luogo', 'Deposito / luogo'], ['condizioni_pagamento', 'Condizioni di pagamento'], ['note', 'Note']];
  return (
    <div className="screen">
      <header><h1>Nuovo fornitore</h1></header>
      <button className="back" onClick={onBack} type="button">← Fornitori</button>
      <AiBox files={files} setFiles={setFiles} testo={testo} setTesto={setTesto} busy={busy} onCompila={compila} abilitato={settings.ai} avviso={avviso} />
      <div className="card mat-form">
        {esiste && <div className="card warn" style={{ marginBottom: 8 }}>Esiste gia' "{esiste.nome}": salvando aggiorni i campi compilati, gli altri restano.</div>}
        {campi.map(([k, ph]) => <input key={k} className={cls(low, k)} value={f[k]} onChange={(e) => set(k, e.target.value)} placeholder={ph} />)}
        <button className="submit" disabled={saving} onClick={salva} type="button">{saving ? 'Salvo…' : esiste ? 'Aggiorna' : 'Crea fornitore'}</button>
      </div>
    </div>
  );
}

function Scheda({ g, acquisti, materialiFornitore, settings, chi, onBack, onChanged }: { g: MatGruppo; acquisti: MatAcquisto[]; materialiFornitore: Set<string>; settings: MatSettings; chi: string; onBack: () => void; onChanged: () => void }) {
  const [assets, setAssets] = useState<MatAsset[] | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [err, setErr] = useState('');
  const [tick, setTick] = useState(0);
  const [offOpen, setOffOpen] = useState(false); const [off, setOff] = useState({ item: g.righe[0]?.item_id ?? '', prezzo: '', prezzoText: '', disponibilita: '', data: oggi(), documento: '' }); const [busy, setBusy] = useState(false);
  const fotoRef = useRef<HTMLInputElement>(null);
  const ids = useMemo(() => new Set(g.righe.map((r) => r.item_id)), [g]);
  const acq = useMemo(() => acquisti.filter((a) => ids.has(a.item_id)), [acquisti, ids]);
  const ordini = useMemo(() => new Set(acq.map((a) => a.order_id)), [acq]);
  useEffect(() => {
    setAssets(null); setErr('');
    fetchAssets(g.supplier_id).then(async (all) => {
      const mine = all.filter((a) => (a.item_id && ids.has(a.item_id)) || (!a.item_id && !a.order_id && a.materiale && a.materiale.toLowerCase() === g.materiale.toLowerCase()) || (a.order_id && ordini.has(a.order_id)));
      // "del fornitore": documenti generali (materiale vuoto) e materiali senza riga a catalogo (es. foto di un
      // articolo ordinato ma non ancora inserito): altrimenti non sarebbero raggiungibili da nessuna schermata
      const generali = all.filter((a) => !a.item_id && !a.order_id && (!a.materiale || !materialiFornitore.has(a.materiale.toLowerCase())));
      const lista = [...mine, ...generali];
      setAssets(lista);
      setUrls(await signedUrls(lista.map((a) => a.path)));
    }).catch((e: Error) => setErr(e.message));
  }, [g, ids, ordini, materialiFornitore, tick]);
  const r0 = g.righe[0];
  const isGenerale = (a: MatAsset) => !a.item_id && !a.order_id && (!a.materiale || a.materiale.toLowerCase() !== g.materiale.toLowerCase());
  const foto = (assets ?? []).filter((a) => isImg(a) && !isGenerale(a));
  const docs = (assets ?? []).filter((a) => !foto.includes(a));

  const addFoto = async (fl: FileList | null) => {
    if (!fl?.length) return; setBusy(true);
    try {
      for (const f of [...fl].slice(0, 4)) {
        const path = await uploadInbox(f, chi);
        await matApi('asset_add', chi, { path, tipo: f.type.startsWith('image/') ? 'foto' : 'scheda_tecnica', titolo: f.name, supplier_id: g.supplier_id, materiale: g.materiale, fonte: `app, ${chi}, ${oggi()}` });
      }
      toast('Caricato', 'ok'); setTick((t) => t + 1); onChanged();
    } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); }
  };
  const addOfferta = async () => {
    if (!off.item) return toast('Scegli il colore', 'err');
    if (!off.prezzo && !off.prezzoText) return toast('Serve un prezzo o un testo di prezzo', 'err');
    if (off.prezzo && !/^\d+([.,]\d+)?$/.test(off.prezzo.trim())) return toast('Prezzo: un numero, oppure il campo testo', 'err');
    setBusy(true);
    try {
      await matApi('offer_add', chi, { item_id: off.item, prezzo: off.prezzo ? Number(off.prezzo.replace(',', '.')) : null, prezzo_text: off.prezzo ? null : off.prezzoText, disponibilita: off.disponibilita || null, data: off.data || null, documento_fonte: off.documento || null });
      toast('Offerta aggiunta', 'ok'); setOffOpen(false); onChanged();
    } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); }
  };
  const setAttivo = async (itemId: string, attivo: boolean) => {
    if (!attivo && !window.confirm('Segnare questo colore come non attivo? Sparisce dal catalogo, i dati restano.')) return;
    setBusy(true);
    try { await matApi('item_set_attivo', chi, { item_id: itemId, attivo }); toast(attivo ? 'Riattivato' : 'Segnato non attivo', 'ok'); onChanged(); }
    catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); }
  };

  return (
    <div className="screen">
      <header><h1 style={{ fontSize: 20 }}>{g.materiale}</h1></header>
      <button className="back" onClick={onBack} type="button">← Catalogo</button>
      {foto.length > 0
        ? <div className="mat-photos">{foto.map((a) => urls[a.path] ? <a key={a.id} href={urls[a.path]} target="_blank" rel="noreferrer"><img src={urls[a.path]} alt={a.titolo ?? ''} /></a> : null)}</div>
        : <div style={{ borderRadius: 14, overflow: 'hidden', marginBottom: 12 }}><Segno cat={g.categoria} label={`${g.categoria} · nessuna foto ancora`} big /></div>}
      {settings.write && (
        <div className="chips" style={{ marginBottom: 12 }}>
          <input ref={fotoRef} type="file" accept="image/*,application/pdf" capture="environment" multiple style={{ display: 'none' }} onChange={(e) => { addFoto(e.target.files); e.target.value = ''; }} />
          <button type="button" className="chip" disabled={busy} onClick={() => fotoRef.current?.click()}>+ Foto o scheda</button>
          <button type="button" className="chip" disabled={busy} onClick={() => setOffOpen((o) => !o)}>+ Offerta</button>
        </div>)}
      {offOpen && (
        <div className="card mat-form">
          <label className="fl">Colore</label>
          <div className="chips">{g.righe.map((r) => <button key={r.item_id} type="button" className={`chip ${off.item === r.item_id ? 'on' : ''}`} onClick={() => setOff((o) => ({ ...o, item: r.item_id }))}>{r.colore ?? 'unico'}</button>)}</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input className="txt" inputMode="decimal" value={off.prezzo} onChange={(e) => setOff((o) => ({ ...o, prezzo: e.target.value }))} placeholder={`numero €/${g.unita ?? 'unita'}`} style={{ flex: 1 }} />
            <input className="txt" value={off.prezzoText} onChange={(e) => setOff((o) => ({ ...o, prezzoText: e.target.value }))} placeholder="o testo fedele" style={{ flex: 2 }} />
          </div>
          <input className="txt" value={off.disponibilita} onChange={(e) => setOff((o) => ({ ...o, disponibilita: e.target.value }))} placeholder="Disponibilita'" />
          <div style={{ display: 'flex', gap: 6 }}>
            <input className="txt" type="date" value={off.data} onChange={(e) => setOff((o) => ({ ...o, data: e.target.value }))} style={{ flex: 1 }} />
            <input className="txt" value={off.documento} onChange={(e) => setOff((o) => ({ ...o, documento: e.target.value }))} placeholder="Fonte (email, listino…)" style={{ flex: 2 }} />
          </div>
          <button className="submit small" disabled={busy} onClick={addOfferta} type="button">Salva offerta</button>
        </div>)}
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
        <table className="mat-tbl"><thead><tr><th>Colore</th><th>Prezzo</th><th>Disponibilita'</th><th>Ultimo acquisto</th>{settings.write && <th />}</tr></thead>
          <tbody>{g.righe.map((r) => (
            <tr key={r.item_id}>
              <td>{r.colore ?? 'n/d'}</td>
              <td>{fmtPrezzo(r.prezzo_rif, r.prezzo_rif_text, r.unita_rif)}{r.acquistato && r.offerta_prezzo_text ? <div className="muted" style={{ fontSize: 11 }}>offerta: {r.offerta_prezzo_text}</div> : null}</td>
              <td>{r.disponibilita ?? (r.acquistato ? '' : 'n/d')}{r.min_ordine ? <div className="muted" style={{ fontSize: 11 }}>min {r.min_ordine}</div> : null}{r.lead_time ? <div className="muted" style={{ fontSize: 11 }}>{r.lead_time}</div> : null}</td>
              <td>{r.acquistato ? <>{num(r.acquisto_quantita)} {r.acquisto_unita ?? ''}<div className="muted" style={{ fontSize: 11 }}>{fmtD(r.acquisto_data)}</div></> : ''}</td>
              {settings.write && <td><button type="button" className="linkbtn" style={{ fontSize: 11 }} disabled={busy} onClick={() => setAttivo(r.item_id, false)}>non attivo</button></td>}
            </tr>))}</tbody></table>
        {g.righe.some((r) => r.offerta_fonte || r.note) && (
          <div className="mat-kv" style={{ marginTop: 8 }}>
            {[...new Set(g.righe.map((r) => r.offerta_fonte).filter(Boolean))].map((f) => <div key={f as string} className="muted" style={{ fontSize: 12 }}>Fonte: {f}</div>)}
            {[...new Set(g.righe.map((r) => r.note).filter(Boolean))].map((n) => <div key={n as string} style={{ fontSize: 12 }}>{n}</div>)}
          </div>)}
      </div>
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

function Fornitori({ rows, onPick, onNew, canWrite }: { rows: MatFornitore[]; onPick: (nome: string) => void; onNew: () => void; canWrite: boolean }) {
  return (
    <div>
      {canWrite && <button className="ds-btn secondary full" style={{ marginBottom: 12 }} type="button" onClick={onNew}><Icon name="plus" size={17} /> Nuovo fornitore</button>}
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

export default function Materiali({ chi, onBack, onProdotti }: { chi: string; onBack: () => void; onProdotti: () => void }) {
  const [session, setSession] = useState<'loading' | 'in' | 'out'>('loading');
  const [email, setEmail] = useState(''); const [pwd, setPwd] = useState(''); const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [view, setView] = useState<'catalogo' | 'fornitori' | 'nuovo' | 'nuovo_fornitore'>('catalogo');
  const [settings, setSettings] = useState<MatSettings>({ enabled: true, write: false, ai: false });
  const [rows, setRows] = useState<MatCatalogo[] | null>(null);
  const [forn, setForn] = useState<MatFornitore[]>([]);
  const [acquisti, setAcquisti] = useState<MatAcquisto[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [cat, setCat] = useState<string>(''); const [fSup, setFSup] = useState<string>(''); const [tipo, setTipo] = useState<'' | 'acq' | 'off'>('');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const [gen, setGen] = useState(0);

  useEffect(() => {
    csClient.auth.getSession().then(({ data }) => setSession(data.session ? 'in' : 'out'));
    const { data: sub } = csClient.auth.onAuthStateChange((_e, s) => setSession(s ? 'in' : 'out'));
    fetchMatSettings().then(setSettings).catch(() => {});
    return () => sub.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (session !== 'in') return;
    setErr('');
    Promise.all([fetchCatalogo(), fetchFornitori(), fetchAcquisti()]).then(async ([c, f, a]) => {
      setRows(c); setForn(f); setAcquisti(a);
      // firma solo la prima foto di ogni materiale (poche decine di URL): la scheda firma tutto il suo materiale quando si apre
      setUrls(await signedUrls([...new Set(c.map((r) => r.foto_path))]));
    }).catch((e: Error) => setErr(e.message));
  }, [session, gen]);
  const reload = () => setGen((g) => g + 1);

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

  if (view === 'nuovo') return <NuovoMateriale chi={chi} settings={settings} fornitori={forn} gruppi={gruppi} onBack={() => setView('catalogo')} onSaved={() => { setView('catalogo'); reload(); }} />;
  if (view === 'nuovo_fornitore') return <NuovoFornitore chi={chi} settings={settings} fornitori={forn} onBack={() => setView('fornitori')} onSaved={() => { setView('fornitori'); reload(); }} />;
  if (selected) return <Scheda g={selected} acquisti={acquisti} materialiFornitore={materialiDelFornitore} settings={settings} chi={chi} onBack={() => setSel(null)} onChanged={reload} />;

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
      {view === 'fornitori' && <Fornitori rows={forn} onPick={(nome) => { setFSup(nome); setView('catalogo'); }} onNew={() => setView('nuovo_fornitore')} canWrite={settings.write} />}
      {view === 'catalogo' && rows !== null && (
        <>
          {settings.write && <button className="ds-btn secondary full" style={{ marginBottom: 10 }} type="button" onClick={() => setView('nuovo')}><Icon name="plus" size={17} /> Nuovo materiale{settings.ai ? ' (foto + AI)' : ''}</button>}
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
          <p className="muted" style={{ fontSize: 11, marginTop: 14 }}><Icon name="search" size={12} /> {settings.write ? 'Nuovi materiali, offerte e foto si inseriscono da qui: l\'AI compila, tu confermi.' : 'Catalogo in sola lettura: le scritture dall\'app sono spente. Fino ad allora i nuovi materiali vanno nel Notion di Ginevra.'}</p>
        </>
      )}
    </div>
  );
}
