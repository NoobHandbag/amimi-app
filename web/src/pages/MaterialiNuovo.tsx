import { useMemo, useRef, useState } from 'react';
import { CATEGORIE, aiCompila, matWrite, uploadInbox } from '../lib/matApi';
import type { Campo, MatFornitore, MatGruppo, PropostaFornitore, PropostaMateriale, PropostaRiga } from '../lib/matApi';

// Materie prime, Fase 2 (brief 23-09): inserimento dall'app con lo strato AI "Compila".
// Flusso: foto o documento (fotocamera del telefono, anche PDF) + nota dettata con il microfono della tastiera ->
// "Compila" (edge ai-compila, solo lettura) riempie il form campo per campo con confidenza e fonte -> la persona
// corregge -> "Salva" scrive via edge mat-api (supplier_upsert, item_upsert, offer_add, asset_add).
// L'AI non scrive mai; ogni proposta resta tracciata (ai_log_id) accanto alla conferma. Se ai_compila_enabled e'
// spento, il bottone "Compila" non compare e il form resta manuale; se mat_write_enabled e' spento non si arriva qui.

const UNITA = ['', 'mq', 'ml', 'mt', 'pz'];
const SOGLIA = 0.7;
const vuoto = (): Campo => ({ v: null, c: 0, f: null });
type Riga = { key: number; categoria: string; materiale: string; articolo: string; colore: string; unita: string; quantita: string; prezzo: string; prezzo_text: string; disponibilita: string; min_ordine: string; lead_time: string; conf: Partial<Record<string, Campo>> };
let seq = 1;
const rigaVuota = (categoria = ''): Riga => ({ key: seq++, categoria, materiale: '', articolo: '', colore: '', unita: '', quantita: '', prezzo: '', prezzo_text: '', disponibilita: '', min_ordine: '', lead_time: '', conf: {} });
const s = (c: Campo<unknown> | undefined) => (c && c.v != null ? String(c.v) : '');
const n = (c: Campo<number> | undefined) => (c && c.v != null ? String(c.v).replace('.', ',') : '');
// giallo = l'AI non e' sicura (confidenza sotto soglia) o non ha trovato il dato: da controllare a vista
const stile = (c: Campo<unknown> | undefined, valore: string) => (c && valore && c.c < SOGLIA ? { background: '#fff3c4' } : undefined);
const tip = (c: Campo<unknown> | undefined) => (c?.f ? `Fonte: ${c.f}` : undefined);
const tipoFile = (f: { mime: string; name: string }, docTipo: string) => (/pdf$/i.test(f.mime) || /\.pdf$/i.test(f.name) ? (docTipo === 'scheda_tecnica' ? 'scheda_tecnica' : docTipo === 'proforma' || docTipo === 'fattura' ? 'proforma' : 'documento') : 'foto');

type Caricato = { path: string; mime: string; bytes: number; name: string };

function Allegati({ files, setFiles, disabled }: { files: File[]; setFiles: (f: File[]) => void; disabled: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="cs-fld">
      <label htmlFor="mat-file">Foto o documento (fotocamera, galleria, PDF)</label>
      <input id="mat-file" ref={ref} type="file" accept="image/*,application/pdf" capture="environment" multiple disabled={disabled} onChange={(e) => setFiles([...files, ...Array.from(e.target.files ?? [])].slice(0, 4))} />
      {files.length > 0 && <div className="chips" style={{ marginTop: 6 }}>{files.map((f, i) => <button key={i} type="button" className="chip on" disabled={disabled} onClick={() => setFiles(files.filter((_, j) => j !== i))} title="togli">{f.name.slice(0, 28)} ✕</button>)}</div>}
      <div className="note" style={{ marginTop: 4 }}>Al massimo 4 file, 4 MB l&#8217;uno. Le foto grandi vengono accettate cosi&#8217; come sono.</div>
    </div>
  );
}

export function NuovoMateriale({ chi, aiOn, fornitori, onDone, onBack }: { chi: string; aiOn: boolean; fornitori: MatFornitore[]; onDone: () => Promise<void>; onBack: () => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [caricati, setCaricati] = useState<Caricato[]>([]);
  const [nota, setNota] = useState('');
  const [busy, setBusy] = useState<'' | 'compila' | 'salva'>('');
  const [msg, setMsg] = useState('');
  const [aiLog, setAiLog] = useState<string | null>(null);
  const [modificato, setModificato] = useState(false);
  const [fornitore, setFornitore] = useState('');          // nome (nuovo) o nome del fornitore esistente
  const [matchId, setMatchId] = useState<string>('');       // id del fornitore esistente scelto
  const [docTipo, setDocTipo] = useState('');
  const [docNumero, setDocNumero] = useState('');
  const [docData, setDocData] = useState('');
  const [righe, setRighe] = useState<Riga[]>([rigaVuota()]);
  const [conf, setConf] = useState<Partial<Record<string, Campo>>>({});
  const [esito, setEsito] = useState<{ fornitore: string; materiali: number; offerte: number; asset: number; creato: boolean } | null>(null);
  const touch = () => { if (aiLog) setModificato(true); };
  // anche la ragione sociale: una proforma porta la conceria, il catalogo il marchio (Vicenza Pelli = Conceria San Biagio)
  const ctxFornitori = useMemo(() => fornitori.map((f) => ({ id: f.id, nome: f.nome, ragione_sociale: f.ragione_sociale })), [fornitori]);

  // i file si caricano UNA volta (sotto inbox/), poi lo stesso path serve a "Compila" e a "Salva"
  const assicuraUpload = async (): Promise<Caricato[]> => {
    const nuovi = files.slice(caricati.length);
    const out = [...caricati];
    for (const f of nuovi) { const u = await uploadInbox(f, chi); out.push({ ...u, name: f.name }); }
    setCaricati(out);
    return out;
  };
  const compila = async () => {
    if (!files.length && !nota.trim()) { setMsg('Serve almeno una foto o una nota.'); return; }
    setBusy('compila'); setMsg('');
    try {
      const up = await assicuraUpload();
      const r = await aiCompila<PropostaMateriale>({ target: 'materiale', immagini: up.map((u) => ({ path: u.path })), testo: nota, contesto: { fornitori: ctxFornitori }, chi });
      const p = r.proposta;
      setAiLog(r.ai_log_id); setModificato(false);
      const forn = p.match_fornitore_id ? fornitori.find((f) => f.id === p.match_fornitore_id) : null;
      setMatchId(forn?.id ?? ''); setFornitore(forn?.nome ?? s(p.fornitore));
      setDocTipo(s(p.documento_tipo)); setDocNumero(s(p.documento_numero)); setDocData(s(p.documento_data));
      setConf({ fornitore: p.fornitore ?? vuoto(), documento_numero: p.documento_numero ?? vuoto(), documento_data: p.documento_data ?? vuoto() });
      const rr = (p.righe.length ? p.righe : [{} as PropostaRiga]).map((x) => ({ ...rigaVuota(s(x.categoria)), materiale: s(x.materiale), articolo: s(x.articolo_fornitore), colore: s(x.colore), unita: s(x.unita), quantita: n(x.quantita), prezzo: n(x.prezzo), prezzo_text: s(x.prezzo_text), disponibilita: s(x.disponibilita), min_ordine: s(x.min_ordine), lead_time: s(x.lead_time), conf: x as unknown as Partial<Record<string, Campo>> }));
      setRighe(rr);
      const bassi = rr.reduce((k, x) => k + Object.values(x.conf).filter((c) => c && c.v != null && c.c < SOGLIA).length, 0);
      setMsg(`Compilato dall’AI in ${(r.ms / 1000).toFixed(1)} s (${r.modello}). ${rr.length} ${rr.length === 1 ? 'riga' : 'righe'}${bassi ? `, ${bassi} campi in giallo da controllare` : ''}. Rileggi tutto: e’ una proposta.`);
    } catch (e) { setMsg((e as Error).message); }
    setBusy('');
  };
  const scarta = async () => { if (aiLog) { try { await matWrite('ai_scarta', { ai_log_id: aiLog }, chi); } catch { /* solo statistica */ } } setAiLog(null); setRighe([rigaVuota()]); setConf({}); setFornitore(''); setMatchId(''); setDocTipo(''); setDocNumero(''); setDocData(''); setMsg('Proposta scartata: form vuoto.'); };
  const setRiga = (k: number, patch: Partial<Riga>) => { touch(); setRighe((rs) => rs.map((r) => (r.key === k ? { ...r, ...patch } : r))); };

  const salva = async () => {
    const nomeForn = fornitore.trim();
    if (!nomeForn) { setMsg('Manca il fornitore.'); return; }
    const valide = righe.filter((r) => r.materiale.trim());
    if (!valide.length) { setMsg('Serve almeno una riga con il nome del materiale.'); return; }
    for (const r of valide) if (!CATEGORIE.includes(r.categoria as typeof CATEGORIE[number])) { setMsg(`Scegli la categoria per "${r.materiale}".`); return; }
    setBusy('salva'); setMsg('');
    const aiExtra = aiLog ? { ai_log_id: aiLog, ai_modificato: modificato } : {};
    try {
      const up = await assicuraUpload();
      let supplierId = matchId;
      let creato = false;
      const esistente = fornitori.find((f) => f.nome.toLowerCase() === nomeForn.toLowerCase());
      if (!supplierId && esistente) supplierId = esistente.id;
      if (!supplierId) { const r = await matWrite('supplier_upsert', { nome: nomeForn, ...aiExtra }, chi); supplierId = String(r.supplier_id); creato = r.creato === true; }
      let materiali = 0, offerte = 0, asset = 0;
      const fonte = [docTipo, docNumero].filter(Boolean).join(' ') || null;
      const materialiDistinti = new Set(valide.map((r) => r.materiale.trim().toLowerCase()));
      for (const r of valide) {
        const it = await matWrite('item_upsert', { supplier: supplierId, categoria: r.categoria, materiale: r.materiale.trim(), articolo_fornitore: r.articolo || null, colori: r.colore ? [r.colore] : [], unita: r.unita || null, ...aiExtra }, chi);
        const items = (it.items ?? []) as { item_id: string; creato: boolean }[];
        materiali += items.filter((x) => x.creato).length;
        const itemId = items[0]?.item_id;
        if (itemId && (r.prezzo.trim() || r.prezzo_text.trim())) {
          try {
            await matWrite('offer_add', { item_id: itemId, tipo: docTipo === 'listino' ? 'listino' : 'offerta', prezzo: r.prezzo.trim() || null, prezzo_text: r.prezzo_text.trim() || null, unita: r.unita || null, data: docData || null, documento_fonte: fonte, disponibilita: r.disponibilita || null, min_ordine: r.min_ordine || null, lead_time: r.lead_time || null, ...aiExtra }, chi);
            offerte++;
          } catch (e) { if ((e as Error & { status?: number }).status !== 409) throw e; }   // offerta gia' registrata: non e' un errore
        }
      }
      for (const f of up) {
        try {
          await matWrite('asset_add', { path: f.path, tipo: tipoFile(f, docTipo), titolo: f.name, supplier: supplierId, materiale: materialiDistinti.size === 1 ? valide[0].materiale.trim() : null, mime: f.mime, bytes: f.bytes, fonte: `app ${chi}${fonte ? ' · ' + fonte : ''}` }, chi);
          asset++;
        } catch (e) { if ((e as Error & { status?: number }).status !== 409) throw e; }
      }
      setEsito({ fornitore: nomeForn, materiali, offerte, asset, creato });
      await onDone();
    } catch (e) { setMsg((e as Error).message); }
    setBusy('');
  };

  if (esito) return (
    <div className="screen">
      <header><h1 style={{ fontSize: 20 }}>Salvato</h1></header>
      <div className="card">
        <p><b>{esito.fornitore}</b>{esito.creato ? ' (fornitore nuovo)' : ''}: {esito.materiali} {esito.materiali === 1 ? 'materiale nuovo' : 'materiali nuovi'}, {esito.offerte} {esito.offerte === 1 ? 'offerta' : 'offerte'}, {esito.asset} {esito.asset === 1 ? 'file' : 'file'}.</p>
        <p className="note">I materiali gia&#8217; presenti non sono stati duplicati. Tutto e&#8217; nel catalogo, con la foto.</p>
        <div className="lead-actions"><button type="button" className="ds-btn" onClick={onBack}>Torna al catalogo</button></div>
      </div>
    </div>
  );

  return (
    <div className="screen">
      <header><h1 style={{ fontSize: 20 }}>Nuovo materiale</h1></header>
      <button className="back" onClick={onBack} type="button">← Catalogo</button>
      <div className="card">
        <Allegati files={files} setFiles={(f) => { setFiles(f); if (f.length < caricati.length) setCaricati(caricati.slice(0, f.length)); }} disabled={busy !== ''} />
        <div className="cs-fld"><label htmlFor="mat-nota">Nota (detta con il microfono della tastiera)</label><textarea id="mat-nota" rows={3} value={nota} onChange={(e) => setNota(e.target.value)} placeholder="es. cocco stampato nero di Damapel, 40-45 al metro quadro, in deposito" /></div>
        {aiOn && <div className="lead-actions"><button type="button" className="ds-btn" style={{ background: 'var(--interactive)', color: '#fff' }} disabled={busy !== ''} onClick={compila}>{busy === 'compila' ? 'Leggo il documento…' : aiLog ? 'Ricompila' : 'Compila'}</button>{aiLog && <button type="button" className="ds-btn" disabled={busy !== ''} onClick={scarta}>Scarta la proposta</button>}</div>}
        {msg && <div className="note" style={{ marginTop: 6 }}>{msg}</div>}
      </div>
      <div className="card">
        <div className="or-form">
          <label className="wide">Fornitore
            <input list="mat-forn" value={fornitore} title={tip(conf.fornitore)} style={stile(conf.fornitore, fornitore)} onChange={(e) => { touch(); setFornitore(e.target.value); setMatchId(fornitori.find((f) => f.nome.toLowerCase() === e.target.value.trim().toLowerCase())?.id ?? ''); }} placeholder="scegli o scrivi un nome nuovo" />
            <datalist id="mat-forn">{fornitori.map((f) => <option key={f.id} value={f.nome} />)}</datalist>
          </label>
          {matchId ? <div className="note wide" style={{ gridColumn: '1 / -1' }}>Fornitore esistente: le righe si aggiungono al suo catalogo.</div> : fornitore.trim() ? <div className="note" style={{ gridColumn: '1 / -1' }}>Fornitore nuovo: verra&#8217; creato.</div> : null}
          <label>Documento<select value={docTipo} onChange={(e) => { touch(); setDocTipo(e.target.value); }}><option value="">—</option><option value="proforma">proforma</option><option value="fattura">fattura</option><option value="listino">listino</option><option value="scheda_tecnica">scheda tecnica</option><option value="foto">foto / campione</option><option value="email">email</option><option value="altro">altro</option></select></label>
          <label>Numero<input value={docNumero} title={tip(conf.documento_numero)} style={stile(conf.documento_numero, docNumero)} onChange={(e) => { touch(); setDocNumero(e.target.value); }} /></label>
          <label>Data<input type="date" value={docData} title={tip(conf.documento_data)} style={stile(conf.documento_data, docData)} onChange={(e) => { touch(); setDocData(e.target.value); }} /></label>
        </div>
      </div>
      {righe.map((r, i) => (
        <div className="card" key={r.key}>
          <div className="rl" style={{ marginBottom: 6, display: 'flex', justifyContent: 'space-between' }}><span>Riga {i + 1}</span>{righe.length > 1 && <button type="button" className="or-link" onClick={() => setRighe((rs) => rs.filter((x) => x.key !== r.key))}>togli</button>}</div>
          <div className="or-form">
            <label className="wide">Materiale<input value={r.materiale} title={tip(r.conf.materiale)} style={stile(r.conf.materiale, r.materiale)} onChange={(e) => setRiga(r.key, { materiale: e.target.value })} placeholder="es. Cocco stampato lucido" /></label>
            <label>Categoria<select value={r.categoria} style={stile(r.conf.categoria, r.categoria)} onChange={(e) => setRiga(r.key, { categoria: e.target.value })}><option value="">scegli…</option>{CATEGORIE.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
            <label>Colore<input value={r.colore} title={tip(r.conf.colore)} style={stile(r.conf.colore, r.colore)} onChange={(e) => setRiga(r.key, { colore: e.target.value })} /></label>
            <label>Codice articolo<input value={r.articolo} title={tip(r.conf.articolo_fornitore)} style={stile(r.conf.articolo_fornitore, r.articolo)} onChange={(e) => setRiga(r.key, { articolo: e.target.value })} /></label>
            <label>Unita&#8217;<select value={r.unita} onChange={(e) => setRiga(r.key, { unita: e.target.value })}>{UNITA.map((u) => <option key={u} value={u}>{u || '—'}</option>)}</select></label>
            <label>Prezzo (numero)<input inputMode="decimal" value={r.prezzo} title={tip(r.conf.prezzo)} style={stile(r.conf.prezzo, r.prezzo)} onChange={(e) => setRiga(r.key, { prezzo: e.target.value })} placeholder="es. 48,44" /></label>
            <label>Prezzo come nel documento<input value={r.prezzo_text} title={tip(r.conf.prezzo_text)} style={stile(r.conf.prezzo_text, r.prezzo_text)} onChange={(e) => setRiga(r.key, { prezzo_text: e.target.value })} placeholder="range o scaglioni, es. 40-45/mq" /></label>
            <label>Quantita&#8217; nel documento<input inputMode="decimal" value={r.quantita} title={tip(r.conf.quantita)} style={stile(r.conf.quantita, r.quantita)} onChange={(e) => setRiga(r.key, { quantita: e.target.value })} /></label>
            <label>Disponibilita&#8217;<input value={r.disponibilita} onChange={(e) => setRiga(r.key, { disponibilita: e.target.value })} /></label>
            <label>Minimo d&#8217;ordine<input value={r.min_ordine} onChange={(e) => setRiga(r.key, { min_ordine: e.target.value })} /></label>
            <label>Tempi<input value={r.lead_time} onChange={(e) => setRiga(r.key, { lead_time: e.target.value })} /></label>
          </div>
        </div>
      ))}
      <div className="lead-actions" style={{ marginBottom: 10 }}>
        <button type="button" className="ds-btn" disabled={busy !== ''} onClick={() => setRighe((rs) => [...rs, rigaVuota(rs[rs.length - 1]?.categoria ?? '')])}>+ Riga</button>
        <button type="button" className="ds-btn" disabled={busy !== ''} style={{ background: 'var(--positive-700)', color: '#fff' }} onClick={salva}>{busy === 'salva' ? 'Salvo…' : `Salva (${chi})`}</button>
      </div>
      <p className="note">In giallo i campi che l&#8217;AI non e&#8217; sicura di aver letto bene. Un prezzo va nel campo numero solo se nel documento e&#8217; un valore unico; range e scaglioni restano testo. Niente viene scritto finche&#8217; non premi Salva.</p>
    </div>
  );
}

export function NuovoFornitore({ chi, aiOn, fornitori, onDone, onBack }: { chi: string; aiOn: boolean; fornitori: MatFornitore[]; onDone: () => Promise<void>; onBack: () => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [caricati, setCaricati] = useState<Caricato[]>([]);
  const [nota, setNota] = useState('');
  const [busy, setBusy] = useState<'' | 'compila' | 'salva'>('');
  const [msg, setMsg] = useState('');
  const [aiLog, setAiLog] = useState<string | null>(null);
  const [modificato, setModificato] = useState(false);
  const [f, setF] = useState<Record<string, string>>({ nome: '', ragione_sociale: '', email: '', telefono: '', referente: '', indirizzo: '', piva_vat: '', deposito_luogo: '', condizioni_pagamento: '', categoria_principale: '', note: '' });
  const [conf, setConf] = useState<Partial<Record<string, Campo>>>({});
  const [fatto, setFatto] = useState<string>('');
  const set = (k: string, v: string) => { if (aiLog) setModificato(true); setF((x) => ({ ...x, [k]: v })); };
  const esistente = fornitori.find((x) => x.nome.toLowerCase() === f.nome.trim().toLowerCase());
  const compila = async () => {
    if (!files.length && !nota.trim()) { setMsg('Serve almeno una foto (biglietto, email, intestazione) o una nota.'); return; }
    setBusy('compila'); setMsg('');
    try {
      const nuovi = files.slice(caricati.length); const up = [...caricati];
      for (const x of nuovi) { const u = await uploadInbox(x, chi); up.push({ ...u, name: x.name }); }
      setCaricati(up);
      const r = await aiCompila<PropostaFornitore>({ target: 'fornitore', immagini: up.map((u) => ({ path: u.path })), testo: nota, contesto: { fornitori: fornitori.map((x) => ({ id: x.id, nome: x.nome, ragione_sociale: x.ragione_sociale })) }, chi });
      const p = r.proposta; setAiLog(r.ai_log_id); setModificato(false);
      const nx: Record<string, string> = {}; const cx: Partial<Record<string, Campo>> = {};
      for (const k of Object.keys(f)) { const c = (p as unknown as Record<string, Campo>)[k]; nx[k] = s(c); cx[k] = c; }
      if (p.match_fornitore_id) { const m = fornitori.find((x) => x.id === p.match_fornitore_id); if (m) nx.nome = m.nome; }
      setF(nx); setConf(cx);
      setMsg(`Compilato dall’AI (${r.modello}, ${(r.ms / 1000).toFixed(1)} s). Controlla i campi in giallo.`);
    } catch (e) { setMsg((e as Error).message); }
    setBusy('');
  };
  const salva = async () => {
    if (!f.nome.trim()) { setMsg('Manca il nome.'); return; }
    setBusy('salva'); setMsg('');
    try {
      const payload: Record<string, unknown> = { ...(aiLog ? { ai_log_id: aiLog, ai_modificato: modificato } : {}) };
      for (const [k, v] of Object.entries(f)) if (v.trim()) payload[k] = v.trim();
      const r = await matWrite('supplier_upsert', payload, chi);
      setFatto(r.creato ? `Fornitore "${r.nome}" creato.` : `Fornitore "${r.nome}" aggiornato (esisteva gia’).`);
      await onDone();
    } catch (e) { setMsg((e as Error).message); }
    setBusy('');
  };
  const campi: [string, string][] = [['nome', 'Nome corto'], ['ragione_sociale', 'Ragione sociale'], ['email', 'Email'], ['telefono', 'Telefono'], ['referente', 'Referente'], ['indirizzo', 'Indirizzo'], ['piva_vat', 'P.IVA / VAT'], ['deposito_luogo', 'Deposito'], ['condizioni_pagamento', 'Condizioni di pagamento'], ['categoria_principale', 'Categoria principale'], ['note', 'Note']];
  if (fatto) return <div className="screen"><header><h1 style={{ fontSize: 20 }}>Salvato</h1></header><div className="card"><p>{fatto}</p><div className="lead-actions"><button type="button" className="ds-btn" onClick={onBack}>Torna ai fornitori</button></div></div></div>;
  return (
    <div className="screen">
      <header><h1 style={{ fontSize: 20 }}>Nuovo fornitore</h1></header>
      <button className="back" onClick={onBack} type="button">← Fornitori</button>
      <div className="card">
        <Allegati files={files} setFiles={(x) => { setFiles(x); if (x.length < caricati.length) setCaricati(caricati.slice(0, x.length)); }} disabled={busy !== ''} />
        <div className="cs-fld"><label htmlFor="mat-nota-f">Nota</label><textarea id="mat-nota-f" rows={2} value={nota} onChange={(e) => setNota(e.target.value)} placeholder="es. Damapel, pellami, referente Marco, pagamento 30 giorni" /></div>
        {aiOn && <div className="lead-actions"><button type="button" className="ds-btn" style={{ background: 'var(--interactive)', color: '#fff' }} disabled={busy !== ''} onClick={compila}>{busy === 'compila' ? 'Leggo…' : 'Compila'}</button></div>}
        {msg && <div className="note" style={{ marginTop: 6 }}>{msg}</div>}
      </div>
      <div className="card">
        <div className="or-form">
          {campi.map(([k, label]) => <label key={k} className={k === 'nome' || k === 'indirizzo' || k === 'note' ? 'wide' : ''}>{label}<input value={f[k]} title={tip(conf[k])} style={stile(conf[k], f[k])} onChange={(e) => set(k, e.target.value)} /></label>)}
        </div>
        {esistente && <div className="note">Esiste gia&#8217; &#8220;{esistente.nome}&#8221;: Salva aggiorna solo i campi compilati, non cancella niente.</div>}
        <div className="lead-actions" style={{ marginTop: 8 }}><button type="button" className="ds-btn" disabled={busy !== ''} style={{ background: 'var(--positive-700)', color: '#fff' }} onClick={salva}>{busy === 'salva' ? 'Salvo…' : `Salva (${chi})`}</button></div>
      </div>
    </div>
  );
}

/** Azioni sulla scheda di un materiale (Fase 2): foto, offerta, attivo/non attivo. Visibili solo a mat_write_enabled. */
export function SchedaAzioni({ g, chi, onChanged }: { g: MatGruppo; chi: string; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [offerta, setOfferta] = useState<{ item_id: string; prezzo: string; prezzo_text: string; data: string; fonte: string } | null>(null);
  const fotoRef = useRef<HTMLInputElement>(null);
  const attivi = g.righe.filter((r) => r.attivo).length;
  const aggiungiFoto = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy('foto'); setMsg('');
    try {
      let k = 0;
      for (const f of Array.from(files).slice(0, 4)) {
        const u = await uploadInbox(f, chi);
        await matWrite('asset_add', { path: u.path, tipo: /pdf$/i.test(f.type) ? 'documento' : 'foto', titolo: f.name, supplier: g.supplier_id, materiale: g.materiale, mime: u.mime, bytes: u.bytes, fonte: `app ${chi}` }, chi);
        k++;
      }
      setMsg(`${k} file ${k === 1 ? 'aggiunto' : 'aggiunti'}.`); await onChanged();
    } catch (e) { setMsg((e as Error).message); }
    setBusy(''); if (fotoRef.current) fotoRef.current.value = '';
  };
  const setAttivo = async (attivo: boolean) => {
    if (!window.confirm(attivo ? 'Riattivare questo materiale nel catalogo?' : 'Segnare questo materiale come non attivo? Resta nello storico, sparisce dal catalogo.')) return;
    setBusy('attivo'); setMsg('');
    try { for (const r of g.righe) await matWrite('item_set_attivo', { item_id: r.item_id, attivo }, chi); setMsg(attivo ? 'Riattivato.' : 'Segnato non attivo.'); await onChanged(); } catch (e) { setMsg((e as Error).message); }
    setBusy('');
  };
  const salvaOfferta = async () => {
    if (!offerta) return;
    if (!offerta.prezzo.trim() && !offerta.prezzo_text.trim()) { setMsg('Serve un prezzo, come numero o come testo.'); return; }
    setBusy('offerta'); setMsg('');
    try { await matWrite('offer_add', { item_id: offerta.item_id, prezzo: offerta.prezzo.trim() || null, prezzo_text: offerta.prezzo_text.trim() || null, unita: g.unita || null, data: offerta.data || null, documento_fonte: offerta.fonte || null }, chi); setMsg('Offerta salvata.'); setOfferta(null); await onChanged(); } catch (e) { setMsg((e as Error).message); }
    setBusy('');
  };
  return (
    <div className="card">
      <div className="rl" style={{ marginBottom: 6 }}>Aggiorna</div>
      <div className="lead-actions">
        <button type="button" className="ds-btn" disabled={busy !== ''} onClick={() => fotoRef.current?.click()}>{busy === 'foto' ? 'Carico…' : '+ Foto o documento'}</button>
        <input ref={fotoRef} type="file" accept="image/*,application/pdf" capture="environment" multiple hidden onChange={(e) => aggiungiFoto(e.target.files)} />
        <button type="button" className="ds-btn" disabled={busy !== ''} onClick={() => setOfferta(offerta ? null : { item_id: g.righe[0].item_id, prezzo: '', prezzo_text: '', data: new Date().toISOString().slice(0, 10), fonte: '' })}>+ Offerta</button>
        {attivi > 0 ? <button type="button" className="ds-btn" disabled={busy !== ''} onClick={() => setAttivo(false)}>Segna non attivo</button> : <button type="button" className="ds-btn" disabled={busy !== ''} onClick={() => setAttivo(true)}>Riattiva</button>}
      </div>
      {offerta && (
        <div className="or-form" style={{ marginTop: 8 }}>
          <label>Colore<select value={offerta.item_id} onChange={(e) => setOfferta({ ...offerta, item_id: e.target.value })}>{g.righe.map((r) => <option key={r.item_id} value={r.item_id}>{r.colore ?? 'unico'}</option>)}</select></label>
          <label>Data<input type="date" value={offerta.data} onChange={(e) => setOfferta({ ...offerta, data: e.target.value })} /></label>
          <label>Prezzo (numero)<input inputMode="decimal" value={offerta.prezzo} onChange={(e) => setOfferta({ ...offerta, prezzo: e.target.value })} placeholder={`es. 48,44${g.unita ? ' al ' + g.unita : ''}`} /></label>
          <label>Prezzo come nel documento<input value={offerta.prezzo_text} onChange={(e) => setOfferta({ ...offerta, prezzo_text: e.target.value })} placeholder="range o scaglioni" /></label>
          <label className="wide">Fonte<input value={offerta.fonte} onChange={(e) => setOfferta({ ...offerta, fonte: e.target.value })} placeholder="es. email del 23-09, listino 2026" /></label>
          <div className="lead-actions" style={{ gridColumn: '1 / -1' }}><button type="button" className="ds-btn" disabled={busy !== ''} style={{ background: 'var(--positive-700)', color: '#fff' }} onClick={salvaOfferta}>{busy === 'offerta' ? 'Salvo…' : 'Salva offerta'}</button></div>
        </div>
      )}
      {msg && <div className="note" style={{ marginTop: 6 }}>{msg}</div>}
    </div>
  );
}
