import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchSuppliers, fetchFornitoreProdotti, fetchProducts, createOrderMulti, oggi, fetchActiveFornitori, fetchLastPurchase, fetchLastOrder, fetchModels } from '../lib/api';
import type { Supplier, FornProd, Product } from '../lib/api';
import { toast } from '../lib/toast';
import Icon from './Icon';

const modelTok = (s: string) => s.trim().replace(/\s+/g, '_').replace(/[^A-Za-z0-9_]/g, '');
const variantTok = (s: string) => s.trim().toUpperCase().replace(/\s+/g, '_').replace(/[^A-Z0-9_]/g, '');

// qty come TESTO: vuotabile (redesign 31-07: il default 5 hardcoded era concausa dell'ordine
// fantasma COCCO; mai ordinata = campo vuoto da compilare, la validazione al salvataggio blocca).
type Line = { codice: string; item: string | null; variant: string | null; qty: string; costo: string; nuovo: boolean; wip: boolean };

export default function SupplierOrderForm({ pin, chi, onDone, initialForn, initialCodice }: { pin: string; chi: string; onDone: () => void; initialForn?: string; initialCodice?: string }) {
  const [sups, setSups] = useState<Supplier[]>([]);
  const [active, setActive] = useState<Set<string>>(new Set());
  const [showOld, setShowOld] = useState(false);
  const [forn, setForn] = useState(initialForn ?? '');
  const [fq, setFq] = useState('');
  const [bags, setBags] = useState<FornProd[]>([]);
  const [all, setAll] = useState<Product[]>([]);
  const [q, setQ] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [dataOrd, setDataOrd] = useState(oggi());
  const [newOpen, setNewOpen] = useState(false);
  const [nm, setNm] = useState(''); const [nv, setNv] = useState('');
  const [nmFree, setNmFree] = useState(false);
  const [modelList, setModelList] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  // feedback aggiunta (decisione owner 2): flash sulla riga carrello appena aggiunta/gia' presente
  const [flashCodice, setFlashCodice] = useState('');
  const flashTimer = useRef<number | undefined>(undefined);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => { fetchSuppliers().then(setSups).catch(() => {}); fetchProducts().then(setAll).catch(() => {}); fetchActiveFornitori().then((a) => setActive(new Set(a))).catch(() => {}); fetchModels().then((m) => setModelList(m.map((x) => x.model))).catch(() => {}); }, []);

  // MODELLO da picklist (brief 23-07 C.2): tabella models + modelli gia' a catalogo. Il testo
  // libero resta come "+ nuovo modello" per il primo capo di una linea davvero nuova.
  const modelOpts = useMemo(() => {
    const s = new Set<string>(modelList.map((m) => m.toUpperCase()));
    for (const p of all) if (p.item) s.add(p.item.toUpperCase());
    return [...s].sort();
  }, [modelList, all]);
  useEffect(() => { if (forn) fetchFornitoreProdotti(forn).then(setBags).catch(() => setBags([])); }, [forn]);

  const inCart = useMemo(() => new Set(lines.map((l) => l.codice)), [lines]);
  const bagOf = useMemo(() => new Map(bags.map((b) => [b.codice, b])), [bags]);

  const flashRow = (codice: string) => {
    setFlashCodice('');
    window.clearTimeout(flashTimer.current);
    // due frame: ri-applica la classe anche su flash consecutivi della stessa riga
    requestAnimationFrame(() => requestAnimationFrame(() => {
      setFlashCodice(codice);
      flashTimer.current = window.setTimeout(() => setFlashCodice(''), 1300);
    }));
  };
  // scroll-into-view della riga evidenziata se fuori schermo
  useEffect(() => {
    if (!flashCodice) return;
    document.querySelector(`[data-cart-codice="${CSS.escape(flashCodice)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [flashCodice]);

  // prefill ASINCRONO di costo/quantita' dallo storico: mai bloccare l'aggiunta, se la chiamata
  // fallisce i campi restano vuoti. Riempie solo se l'utente non ha gia' scritto.
  const prefillLine = (codice: string) => {
    fetchLastOrder(codice).then((lo) => {
      if (!lo) return;
      setLines((p) => p.map((x) => x.codice === codice ? {
        ...x,
        qty: x.qty === '' && lo.qty_ordered != null ? String(lo.qty_ordered) : x.qty,
        costo: x.costo === '' && lo.costo_unitario != null ? String(lo.costo_unitario) : x.costo,
      } : x));
    }).catch(() => {});
    fetchLastPurchase(codice).then((lp) => {
      if (!lp || lp.costo_unitario == null) return;
      setLines((p) => p.map((x) => x.codice === codice && x.costo === '' ? { ...x, costo: String(lp.costo_unitario) } : x));
    }).catch(() => {});
  };

  // aggiunta dal risultato di ricerca: costo dallo storico fornitore se c'e', il resto async;
  // toast + flash + query svuotata + focus ancora sulla barra (aggiunte consecutive su iPhone)
  const addFromSearch = (codice: string, item: string | null, variant: string | null) => {
    const nome = [item, variant].filter(Boolean).join(' ') || codice;
    if (inCart.has(codice)) {
      toast(`${nome}: già nell'ordine`, 'err');
      flashRow(codice);
      setQ(''); searchRef.current?.focus();
      return;
    }
    const costoStorico = bagOf.get(codice)?.ultimo_costo;
    setLines((p) => {
      toast(`${nome} aggiunta · ${p.length + 1} nell'ordine`);
      return [...p, { codice, item, variant, qty: '', costo: costoStorico != null ? String(costoStorico) : '', nuovo: false, wip: false }];
    });
    prefillLine(codice);
    flashRow(codice);
    setQ(''); searchRef.current?.focus();
  };

  // riordino precompilato (item 21 + decisione 3): arrivo dal magazzino con un CODICE — fornitore
  // e costo dall'ultimo acquisto, quantita' dall'ultimo ordine, riga già nel carrello.
  useEffect(() => {
    if (!initialCodice) return;
    let alive = true;
    (async () => {
      const [prods, last] = await Promise.all([fetchProducts(), fetchLastPurchase(initialCodice).catch(() => null)]);
      if (!alive) return;
      const p = prods.find((x) => x.codice === initialCodice);
      if (last?.fornitore) setForn((f) => f || last.fornitore!);
      setLines((prev) => prev.some((l) => l.codice === initialCodice) ? prev
        : [...prev, { codice: initialCodice, item: p?.item ?? null, variant: p?.variant ?? null, qty: '', costo: last?.costo_unitario != null ? String(last.costo_unitario) : '', nuovo: false, wip: false }]);
      prefillLine(initialCodice);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCodice]);

  // risultati: storico del fornitore IN TESTA (con thumbnail e "gia' ordinata N volte · ultimo €X"),
  // poi il resto del catalogo; con barra vuota NESSUNA lista (decisione owner 1).
  type Hit = { codice: string; item: string | null; variant: string | null; image_url: string | null; storico: FornProd | null };
  const searchHits: Hit[] = useMemo(() => {
    const s = q.trim().toLowerCase(); if (!s) return [];
    const match = (item: string | null, variant: string | null, codice: string) => `${item ?? ''} ${variant ?? ''} ${codice}`.toLowerCase().includes(s);
    const hitsForn: Hit[] = bags.filter((b) => match(b.item, b.variant, b.codice)).map((b) => ({ codice: b.codice, item: b.item, variant: b.variant, image_url: b.image_url, storico: b }));
    const seen = new Set(hitsForn.map((h) => h.codice));
    const hitsAll: Hit[] = all.filter((p) => !seen.has(p.codice) && match(p.item, p.variant, p.codice)).map((p) => ({ codice: p.codice, item: p.item, variant: p.variant, image_url: p.image_url, storico: null }));
    return [...hitsForn, ...hitsAll].slice(0, 12);
  }, [all, bags, q]);

  function addNewBag() {
    // CODICE tutto MAIUSCOLO (decisione owner 06-07). Il codice qui e' comunque PROVVISORIO:
    // quello definitivo lo fissa Benny alla verifica in pulizia dati (product_verify lo
    // rigenera dai suoi Modello+Variante con rename a cascata).
    const codice = (nm && nv ? `${modelTok(nm)}_${variantTok(nv)}` : nm ? `${modelTok(nm)}_` : '').toUpperCase();
    if (!nm) return toast('Scrivi almeno il modello', 'err');
    if (!codice || inCart.has(codice)) { if (inCart.has(codice)) { toast(`già nell'ordine`, 'err'); flashRow(codice); } return; }
    setLines((p) => {
      toast(`${nm.trim().toUpperCase()} aggiunta · ${p.length + 1} nell'ordine`);
      return [...p, { codice, item: nm.trim().toUpperCase(), variant: nv ? variantTok(nv) : null, qty: '', costo: '', nuovo: true, wip: false }];
    });
    flashRow(codice);
    setNm(''); setNv(''); setNewOpen(false); setNmFree(false);
  }

  async function submit() {
    if (!forn) return toast('Scegli il fornitore', 'err');
    if (!lines.length) return toast('Aggiungi almeno una borsa', 'err');
    const invalid = lines.find((l) => !l.wip && !(Number(l.qty) > 0));
    if (invalid) return toast(`Quantità mancante per ${invalid.item ?? invalid.codice}: mettila o segna WIP`, 'err');
    setBusy(true);
    try {
      const righe = lines.map((l) => ({
        codice: l.codice, item: l.item, variant: l.variant, qty_ordered: l.wip ? 0 : Number(l.qty), wip: l.wip,
        nuovo_riordino: l.nuovo ? 'Nuovo' : 'Riordino', costo_unitario: l.costo === '' ? null : Number(l.costo),
      }));
      const r = await createOrderMulti(forn, dataOrd, righe, pin, chi) as unknown as { lines: number; stubs: number };
      toast(`Ordine salvato · ${r.lines} borse${r.stubs ? ` · ${r.stubs} nuove da verificare` : ''}`, 'ok');
      setTimeout(onDone, 700);
    } catch (e) { toast((e as Error).message, 'err'); setBusy(false); }
  }

  // STEP 1 — fornitore: ricerca in alto + attivi come chip compatte (decisione owner 4).
  // Fonte attivi invariata: set `active` da supplier_orders, NON intersecato con `suppliers`
  // (un fornitore ordinato ma assente dal catalogo suppliers sparirebbe). I vecchi si vedono
  // cercando o dietro il toggle. Testo senza match esatto -> "Crea fornitore {testo}".
  if (!forn) {
    const fs = fq.trim().toLowerCase();
    const act = [...active].sort((a, b) => a.localeCompare(b)).filter((n) => !fs || n.toLowerCase().includes(fs));
    const vecchiTutti = sups.filter((s) => !active.has(s.name)).map((s) => s.name);
    const vecchi = vecchiTutti.filter((n) => !fs || n.toLowerCase().includes(fs));
    const exact = [...active, ...vecchiTutti].some((n) => n.toLowerCase() === fs);
    return (
      <div className="form">
        <label className="fl">Fornitore</label>
        <div className="ds-search">
          <Icon name="search" size={19} />
          <input value={fq} onChange={(e) => setFq(e.target.value)} placeholder="Cerca o crea un fornitore…" autoFocus />
        </div>
        {act.length > 0 && (
          <div className="ds-lens" style={{ marginTop: 2 }}>
            {act.map((name) => <button key={name} type="button" className="ds-fp" onClick={() => setForn(name)}>{name}</button>)}
          </div>
        )}
        {fs && vecchi.length > 0 && (
          <div className="ds-lens">
            <span className="ll">Vecchi</span>
            {vecchi.map((name) => <button key={name} type="button" className="ds-lp" onClick={() => setForn(name)}>{name}</button>)}
          </div>
        )}
        {fs && !exact && (
          <button className="ds-btn secondary full" style={{ marginTop: 6 }} type="button" onClick={() => setForn(fq.trim())}>
            <Icon name="plus" size={16} /> Crea fornitore “{fq.trim()}”
          </button>
        )}
        {!fs && vecchiTutti.length > 0 && (
          <>
            <button className="addnew" type="button" onClick={() => setShowOld((v) => !v)}>{showOld ? '− Nascondi vecchi fornitori' : `Vecchi fornitori (${vecchiTutti.length})`}</button>
            {showOld && <div className="ds-lens">{vecchiTutti.map((name) => <button key={name} type="button" className="ds-lp" onClick={() => setForn(name)}>{name}</button>)}</div>}
          </>
        )}
      </div>
    );
  }

  const tot = lines.reduce((s, l) => s + (l.wip ? 0 : (Number(l.qty) || 0)), 0);
  return (
    <div className="form">
      <div className="ordtop">
        <button className="chip on" onClick={() => { setForn(''); setLines([]); setQ(''); }}>{forn} ✕</button>
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
            <div className={'cartrow' + (flashCodice === l.codice ? ' flash' : '')} data-cart-codice={l.codice} key={l.codice}>
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
                onChange={(e) => setLines((p) => p.map((x, j) => j === i ? { ...x, qty: e.target.value } : x))} />
              <input className="cbox" type="number" inputMode="decimal" placeholder="€/pz" value={l.costo}
                onChange={(e) => setLines((p) => p.map((x, j) => j === i ? { ...x, costo: e.target.value } : x))} />
              <button className="x" onClick={() => setLines((p) => p.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
          <div className="carttot">{lines.length} borse · {tot} pezzi{lines.some((l) => l.wip) ? ' · + WIP' : ''}</div>
        </div>
      )}

      {/* search-first (decisione owner 1): si aggiunge SOLO dalla ricerca; barra vuota = nessuna lista */}
      <div className="ds-search" style={{ marginBottom: 8 }}>
        <Icon name="search" size={19} />
        <input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Cerca una borsa da ordinare a ${forn}…`} autoFocus={!initialCodice} />
      </div>
      {q.trim() && searchHits.length > 0 && (
        <div style={{ marginBottom: 4 }}>
          {searchHits.map((h) => {
            const already = inCart.has(h.codice);
            return (
              <button key={h.codice} className="ds-prow" type="button" onClick={() => addFromSearch(h.codice, h.item, h.variant)}>
                <span className="ds-thumb">{h.image_url ? <img src={h.image_url} alt="" loading="lazy" /> : (h.item ?? h.codice).slice(0, 2)}</span>
                <span className="ds-pinfo">
                  <span className="ds-pn">{h.item ?? h.codice} <span style={{ fontWeight: 400, color: 'var(--ink-muted)' }}>{h.variant ?? ''}</span></span>
                  <span className="ds-psub">{h.storico
                    ? `già ordinata ${h.storico.n_ordini} ${h.storico.n_ordini === 1 ? 'volta' : 'volte'}${h.storico.ultimo_costo != null ? ` · ultimo €${h.storico.ultimo_costo}` : ''}`
                    : 'mai ordinata da questo fornitore'}</span>
                </span>
                {already ? <span className="ds-pbadge pub">✓ nell’ordine</span> : <span className="ds-pbadge off">+ aggiungi</span>}
              </button>
            );
          })}
        </div>
      )}
      {q.trim() && searchHits.length === 0 && (
        <div className="muted" style={{ fontSize: 13, margin: '4px 2px 8px' }}>
          Nessuna borsa trovata per “{q.trim()}”.
          <button type="button" className="linkbtn" style={{ display: 'block', padding: '6px 0 0', fontWeight: 700 }}
            onClick={() => { setNewOpen(true); setNmFree(true); setNm(q.trim()); setQ(''); }}>
            + Borsa nuova “{q.trim()}”
          </button>
        </div>
      )}

      {!newOpen ? (
        <button className="addnew" onClick={() => setNewOpen(true)}>+ Borsa nuova (senza codice finale)</button>
      ) : (
        <div className="newbag">
          {nmFree ? (
            <input className="txt" placeholder="Nuovo modello (es. Clutch)" value={nm} onChange={(e) => setNm(e.target.value)} autoFocus />
          ) : (
            <>
              <label className="fl">Modello</label>
              <div className="supgrid">
                {modelOpts.map((m) => (
                  <button key={m} type="button" className={`supcard${nm === m ? ' alt' : ''}`} onClick={() => setNm(nm === m ? '' : m)}>{m}</button>
                ))}
                <button type="button" className="supcard old" onClick={() => { setNmFree(true); setNm(''); }}>+ nuovo modello</button>
              </div>
            </>
          )}
          <input className="txt" placeholder="Variante (opzionale)" value={nv} onChange={(e) => setNv(e.target.value)} />
          <button className="submit small" disabled={!nm.trim()} onClick={addNewBag}>Aggiungi</button>
        </div>
      )}

      <button className="submit" disabled={busy} onClick={submit}>{busy ? 'Salvo…' : `Salva ordine (${lines.length})`}</button>
    </div>
  );
}
