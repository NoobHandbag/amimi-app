import { useEffect, useMemo, useState } from 'react';
import { fetchSuppliers, fetchFornitoreProdotti, fetchProducts, createOrderMulti, oggi } from '../lib/api';
import type { Supplier, FornProd, Product } from '../lib/api';

const modelTok = (s: string) => s.trim().replace(/\s+/g, '_').replace(/[^A-Za-z0-9_]/g, '');
const variantTok = (s: string) => s.trim().toUpperCase().replace(/\s+/g, '_').replace(/[^A-Z0-9_]/g, '');

type Line = { codice: string; item: string | null; variant: string | null; qty: number; costo: string; nuovo: boolean };

export default function SupplierOrderForm({ pin, chi, onDone }: { pin: string; chi: string; onDone: () => void }) {
  const [sups, setSups] = useState<Supplier[]>([]);
  const [forn, setForn] = useState('');
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState('');
  const [bags, setBags] = useState<FornProd[]>([]);
  const [all, setAll] = useState<Product[]>([]);
  const [q, setQ] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [dataOrd, setDataOrd] = useState(oggi());
  const [newOpen, setNewOpen] = useState(false);
  const [nm, setNm] = useState(''); const [nv, setNv] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; x: string } | null>(null);

  useEffect(() => { fetchSuppliers().then(setSups).catch(() => {}); fetchProducts().then(setAll).catch(() => {}); }, []);
  useEffect(() => { if (forn) fetchFornitoreProdotti(forn).then(setBags).catch(() => setBags([])); }, [forn]);

  const inCart = useMemo(() => new Set(lines.map((l) => l.codice)), [lines]);
  const addLine = (codice: string, item: string | null, variant: string | null, costo: number | null, nuovo: boolean) => {
    if (!codice || inCart.has(codice)) return;
    setLines((p) => [...p, { codice, item, variant, qty: nuovo ? 5 : 5, costo: costo != null ? String(costo) : '', nuovo }]);
  };
  const searchHits = useMemo(() => {
    const s = q.trim().toLowerCase(); if (!s) return [];
    return all.filter((p) => `${p.item ?? ''} ${p.variant ?? ''} ${p.codice}`.toLowerCase().includes(s)).slice(0, 8);
  }, [all, q]);

  function addNewBag() {
    const codice = nm && nv ? `${modelTok(nm)}_${variantTok(nv)}` : nm ? `${modelTok(nm)}_` : '';
    if (!nm) return setMsg({ t: 'err', x: 'Scrivi almeno il modello' });
    addLine(codice, nm.trim(), nv ? variantTok(nv) : null, null, true);
    setNm(''); setNv(''); setNewOpen(false); setMsg(null);
  }

  async function submit() {
    if (!forn) return setMsg({ t: 'err', x: 'Scegli il fornitore' });
    if (!lines.length) return setMsg({ t: 'err', x: 'Aggiungi almeno una borsa' });
    setBusy(true); setMsg(null);
    try {
      const righe = lines.map((l) => ({
        codice: l.codice, item: l.item, variant: l.variant, qty_ordered: l.qty,
        nuovo_riordino: l.nuovo ? 'Nuovo' : 'Riordino', costo_unitario: l.costo === '' ? null : Number(l.costo),
      }));
      const r = await createOrderMulti(forn, dataOrd, righe, pin, chi) as unknown as { lines: number; stubs: number };
      setMsg({ t: 'ok', x: `Ordine salvato · ${r.lines} borse${r.stubs ? ` · ${r.stubs} nuove da verificare` : ''}` });
      setTimeout(onDone, 700);
    } catch (e) { setMsg({ t: 'err', x: (e as Error).message }); setBusy(false); }
  }

  // STEP 1 — supplier
  if (!forn) {
    return (
      <div className="form">
        <label className="fl">Fornitore</label>
        {typing ? (
          <div className="newbag">
            <input className="txt" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Nome fornitore" autoFocus />
            <button className="submit small" disabled={!typed.trim()} onClick={() => setForn(typed.trim())}>Avanti →</button>
          </div>
        ) : (
          <div className="supgrid">
            {sups.map((s) => <button key={s.name} type="button" className="supcard" onClick={() => setForn(s.name)}>{s.name}</button>)}
            <button type="button" className="supcard alt" onClick={() => setTyping(true)}>+ nuovo</button>
          </div>
        )}
      </div>
    );
  }

  const tot = lines.reduce((s, l) => s + l.qty, 0);
  return (
    <div className="form">
      <div className="ordtop">
        <button className="chip on" onClick={() => { setForn(''); setLines([]); }}>{forn} ✕</button>
        <label className="datepick">📅 <input type="date" value={dataOrd} onChange={(e) => setDataOrd(e.target.value)} /></label>
      </div>

      {lines.length > 0 && (
        <div className="cart">
          {lines.map((l, i) => (
            <div className="cartrow" key={l.codice}>
              <div className="cartinfo">
                <div className="rt">{l.item ?? l.codice} {l.nuovo && <span className="newtag">nuova</span>}</div>
                <div className="rs">{l.variant ?? (l.codice.endsWith('_') ? 'variante da definire' : '')}</div>
              </div>
              <input className="qbox" type="number" inputMode="numeric" value={l.qty}
                onChange={(e) => setLines((p) => p.map((x, j) => j === i ? { ...x, qty: Number(e.target.value) } : x))} />
              <input className="cbox" type="number" inputMode="decimal" placeholder="€" value={l.costo}
                onChange={(e) => setLines((p) => p.map((x, j) => j === i ? { ...x, costo: e.target.value } : x))} />
              <button className="x" onClick={() => setLines((p) => p.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
          <div className="carttot">{lines.length} borse · {tot} pezzi</div>
        </div>
      )}

      <label className="fl">Borse di {forn}</label>
      <div className="pgrid">
        {bags.filter((b) => !inCart.has(b.codice)).slice(0, 12).map((b) => (
          <button key={b.codice} className="pcard" type="button" onClick={() => addLine(b.codice, b.item, b.variant, b.ultimo_costo, false)}>
            <div className="pimg">{b.image_url ? <img src={b.image_url} alt="" loading="lazy" /> : <span>{(b.item ?? b.codice).slice(0, 2)}</span>}</div>
            <div className="pname">{b.item ?? b.codice}</div>
            <div className="pvar">{b.variant ?? ''}{b.ultimo_costo != null ? ` · €${b.ultimo_costo}` : ''}</div>
          </button>
        ))}
        {!bags.length && <p className="muted">Nessuno storico per {forn}. Cerca sotto o aggiungi una borsa nuova.</p>}
      </div>

      <input className="search" placeholder="Cerca un'altra borsa…" value={q} onChange={(e) => setQ(e.target.value)} />
      {searchHits.length > 0 && (
        <div className="hits">
          {searchHits.map((p) => (
            <button key={p.codice} className="hit" type="button" onClick={() => { addLine(p.codice, p.item, p.variant, null, false); setQ(''); }}>
              {p.item ?? p.codice} <span>{p.variant ?? ''}</span>
            </button>
          ))}
        </div>
      )}

      {!newOpen ? (
        <button className="addnew" onClick={() => setNewOpen(true)}>+ Borsa nuova (senza codice finale)</button>
      ) : (
        <div className="newbag">
          <input className="txt" placeholder="Modello (es. Lea Bag x Rita)" value={nm} onChange={(e) => setNm(e.target.value)} autoFocus />
          <input className="txt" placeholder="Variante (opzionale)" value={nv} onChange={(e) => setNv(e.target.value)} />
          <button className="submit small" onClick={addNewBag}>Aggiungi</button>
        </div>
      )}

      <button className="submit" disabled={busy} onClick={submit}>{busy ? 'Salvo…' : `Salva ordine (${lines.length})`}</button>
      {msg && <div className={`msg ${msg.t}`}>{msg.x}</div>}
    </div>
  );
}
