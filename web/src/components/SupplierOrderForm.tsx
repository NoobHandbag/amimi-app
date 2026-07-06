import { useEffect, useMemo, useState } from 'react';
import { fetchSuppliers, fetchFornitoreProdotti, fetchProducts, createOrderMulti, oggi, fetchActiveFornitori, fetchLastPurchase } from '../lib/api';
import type { Supplier, FornProd, Product } from '../lib/api';
import { toast } from '../lib/toast';

const modelTok = (s: string) => s.trim().replace(/\s+/g, '_').replace(/[^A-Za-z0-9_]/g, '');
const variantTok = (s: string) => s.trim().toUpperCase().replace(/\s+/g, '_').replace(/[^A-Z0-9_]/g, '');

type Line = { codice: string; item: string | null; variant: string | null; qty: number; costo: string; nuovo: boolean; wip: boolean };

export default function SupplierOrderForm({ pin, chi, onDone, initialForn, initialCodice }: { pin: string; chi: string; onDone: () => void; initialForn?: string; initialCodice?: string }) {
  const [sups, setSups] = useState<Supplier[]>([]);
  const [active, setActive] = useState<Set<string>>(new Set());
  const [showOld, setShowOld] = useState(false);
  const [forn, setForn] = useState(initialForn ?? '');
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

  useEffect(() => { fetchSuppliers().then(setSups).catch(() => {}); fetchProducts().then(setAll).catch(() => {}); fetchActiveFornitori().then((a) => setActive(new Set(a))).catch(() => {}); }, []);
  useEffect(() => { if (forn) fetchFornitoreProdotti(forn).then(setBags).catch(() => setBags([])); }, [forn]);

  const inCart = useMemo(() => new Set(lines.map((l) => l.codice)), [lines]);
  const addLine = (codice: string, item: string | null, variant: string | null, costo: number | null, nuovo: boolean) => {
    if (!codice || inCart.has(codice)) return;
    setLines((p) => [...p, { codice, item, variant, qty: nuovo ? 5 : 5, costo: costo != null ? String(costo) : '', nuovo, wip: false }]);
  };

  // riordino precompilato (item 21): arrivo dal magazzino con un CODICE — fornitore e costo
  // dall'ultimo acquisto di quella borsa, riga già nel carrello.
  useEffect(() => {
    if (!initialCodice) return;
    let alive = true;
    (async () => {
      const [prods, last] = await Promise.all([fetchProducts(), fetchLastPurchase(initialCodice).catch(() => null)]);
      if (!alive) return;
      const p = prods.find((x) => x.codice === initialCodice);
      if (last?.fornitore) setForn((f) => f || last.fornitore!);
      setLines((prev) => prev.some((l) => l.codice === initialCodice) ? prev
        : [...prev, { codice: initialCodice, item: p?.item ?? null, variant: p?.variant ?? null, qty: 5, costo: last?.costo_unitario != null ? String(last.costo_unitario) : '', nuovo: false, wip: false }]);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCodice]);
  const searchHits = useMemo(() => {
    const s = q.trim().toLowerCase(); if (!s) return [];
    return all.filter((p) => `${p.item ?? ''} ${p.variant ?? ''} ${p.codice}`.toLowerCase().includes(s)).slice(0, 8);
  }, [all, q]);

  function addNewBag() {
    // CODICE tutto MAIUSCOLO (decisione owner 06-07). Il codice qui e' comunque PROVVISORIO:
    // quello definitivo lo fissa Benny alla verifica in pulizia dati (product_verify lo
    // rigenera dai suoi Modello+Variante con rename a cascata).
    const codice = (nm && nv ? `${modelTok(nm)}_${variantTok(nv)}` : nm ? `${modelTok(nm)}_` : '').toUpperCase();
    if (!nm) return toast('Scrivi almeno il modello', 'err');
    addLine(codice, nm.trim().toUpperCase(), nv ? variantTok(nv) : null, null, true);
    setNm(''); setNv(''); setNewOpen(false);
  }

  async function submit() {
    if (!forn) return toast('Scegli il fornitore', 'err');
    if (!lines.length) return toast('Aggiungi almeno una borsa', 'err');
    const invalid = lines.find((l) => !l.wip && !(l.qty > 0));
    if (invalid) return toast(`Quantità mancante per ${invalid.item ?? invalid.codice}: mettila o segna WIP`, 'err');
    setBusy(true);
    try {
      const righe = lines.map((l) => ({
        codice: l.codice, item: l.item, variant: l.variant, qty_ordered: l.wip ? 0 : l.qty, wip: l.wip,
        nuovo_riordino: l.nuovo ? 'Nuovo' : 'Riordino', costo_unitario: l.costo === '' ? null : Number(l.costo),
      }));
      const r = await createOrderMulti(forn, dataOrd, righe, pin, chi) as unknown as { lines: number; stubs: number };
      toast(`Ordine salvato · ${r.lines} borse${r.stubs ? ` · ${r.stubs} nuove da verificare` : ''}`, 'ok');
      setTimeout(onDone, 700);
    } catch (e) { toast((e as Error).message, 'err'); setBusy(false); }
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
        ) : (() => {
          const act = sups.filter((s) => active.has(s.name));
          const vecchi = sups.filter((s) => !active.has(s.name));
          return (
            <>
              <div className="supgrid">
                {act.map((s) => <button key={s.name} type="button" className="supcard" onClick={() => setForn(s.name)}>{s.name}</button>)}
                <button type="button" className="supcard alt" onClick={() => setTyping(true)}>+ nuovo</button>
              </div>
              {vecchi.length > 0 && (
                <>
                  <button className="addnew" type="button" onClick={() => setShowOld((v) => !v)}>{showOld ? '− Nascondi vecchi fornitori' : `Vecchi fornitori (${vecchi.length})`}</button>
                  {showOld && <div className="supgrid">{vecchi.map((s) => <button key={s.name} type="button" className="supcard old" onClick={() => setForn(s.name)}>{s.name}</button>)}</div>}
                </>
              )}
            </>
          );
        })()}
      </div>
    );
  }

  const tot = lines.reduce((s, l) => s + (l.wip ? 0 : l.qty), 0);
  return (
    <div className="form">
      <div className="ordtop">
        <button className="chip on" onClick={() => { setForn(''); setLines([]); }}>{forn} ✕</button>
        <label className="datepick">📅 <input type="date" value={dataOrd} onChange={(e) => setDataOrd(e.target.value)} /></label>
      </div>

      {lines.length > 0 && (
        <div className="cart">
          {/* etichette esplicite Pezzi / € al pezzo: in call Ginni li aveva invertiti (item 28) */}
          <div className="cartrow" style={{ opacity: .7, fontSize: 11, fontWeight: 700, paddingBottom: 0 }}>
            <div className="cartinfo">BORSA</div>
            <div className="qbox" style={{ textAlign: 'center', border: 'none', background: 'none' }}>PEZZI</div>
            <div className="cbox" style={{ textAlign: 'center', border: 'none', background: 'none' }}>€ AL PEZZO</div>
            <span style={{ width: 28 }} />
          </div>
          {lines.map((l, i) => (
            <div className="cartrow" key={l.codice}>
              <div className="cartinfo">
                <div className="rt">{l.item ?? l.codice} {l.nuovo && <span className="newtag">nuova</span>}</div>
                <div className="rs">{l.variant ?? (l.codice.endsWith('_') ? 'variante da definire' : '')}</div>
                <button type="button" className="linkbtn" style={{ fontSize: 11, padding: 0 }}
                  title="WIP = non so ancora quanti pezzi/che costo (es. affinamento pelle): si definisce all'arrivo"
                  onClick={() => setLines((p) => p.map((x, j) => j === i ? { ...x, wip: !x.wip } : x))}>
                  {l.wip ? '⏳ WIP · quantità/costo da definire (tocca per annullare)' : 'non so la quantità? → segna WIP'}
                </button>
              </div>
              <input className="qbox" type="number" inputMode="numeric" placeholder="pezzi" value={l.wip ? '' : l.qty} disabled={l.wip}
                onChange={(e) => setLines((p) => p.map((x, j) => j === i ? { ...x, qty: Number(e.target.value) } : x))} />
              <input className="cbox" type="number" inputMode="decimal" placeholder="€/pz" value={l.costo}
                onChange={(e) => setLines((p) => p.map((x, j) => j === i ? { ...x, costo: e.target.value } : x))} />
              <button className="x" onClick={() => setLines((p) => p.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
          <div className="carttot">{lines.length} borse · {tot} pezzi{lines.some((l) => l.wip) ? ' · + WIP' : ''}</div>
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
              {p.image_url ? <img className="invimg sm" src={p.image_url} alt="" loading="lazy" style={{ verticalAlign: 'middle', marginRight: 6 }} /> : null}
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
    </div>
  );
}
