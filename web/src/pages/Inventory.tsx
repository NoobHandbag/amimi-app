import { useEffect, useMemo, useState } from 'react';
import { fetchInventory, fetchContoVendita, syncShopifyStock, fetchReorder, fetchShopStockMap, fetchSalesByCodice, fetchPurchasesByCodice, fetchLastSaleMap } from '../lib/api';
import type { InvFull, CV, Reorder, SaleRow, PurchaseRow } from '../lib/api';
import { useSort } from '../lib/sortable';
import ExportBtn from '../components/ExportBtn';
import PrintBtn from '../components/PrintBtn';
import { toast } from '../lib/toast';
import { prettyName } from '../lib/helpers';

const eur = (n: number) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n || 0);
const daysSince = (iso: string | null) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : Infinity);
// #4: ITEM + VARIANT as one clean name on a single line (underscores stripped, model de-duped)
const nome = (item: string | null, variant: string | null) => prettyName(item, variant);
const norm = (c: string) => c.toUpperCase().replace(/\s+/g, '_');

function Tile({ url, label }: { url: string | null; label: string }) {
  return url ? <img className="invimg" src={url} alt="" loading="lazy" /> : <div className="invimg ph">{label.slice(0, 2)}</div>;
}

/* product detail drawer — 3 stocks + sales/purchase history */
function ProductDrawer({ p, shopQty, onClose }: { p: InvFull; shopQty: number | null; onClose: () => void }) {
  const [sales, setSales] = useState<SaleRow[] | null>(null);
  const [purch, setPurch] = useState<PurchaseRow[] | null>(null);
  useEffect(() => {
    fetchSalesByCodice(p.codice).then(setSales).catch(() => setSales([]));
    fetchPurchasesByCodice(p.codice).then(setPurch).catch(() => setPurch([]));
  }, [p.codice]);
  return (
    <div className="drawerwrap" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawerhead">
          <Tile url={p.image_url} label={p.item ?? p.codice} />
          <div className="grow"><div className="rt">{nome(p.item, p.variant)}</div><div className="rs">{p.codice}</div></div>
          <button className="drawerx" onClick={onClose} type="button">✕</button>
        </div>
        <div className="kpis">
          <div className={`kpi ${p.giacenza_attuale < 0 ? 'red' : 'accent'}`}><div className="v">{p.giacenza_attuale}</div><div className="k">Magazzino</div></div>
          <div className="kpi"><div className="v">{p.in_conto_vendita}</div><div className="k">In conto vendita</div></div>
          <div className="kpi"><div className="v">{p.on_shopify ? (shopQty ?? '—') : '—'}</div><div className="k">Su Shopify</div></div>
        </div>
        <section className="card"><h2>Acquisti{purch ? ` · ${purch.reduce((s, a) => s + Number(a.quantita), 0)} pz` : ''}</h2>
          {purch == null ? <p className="muted center">…</p> : !purch.length ? <p className="muted center">Nessun acquisto registrato.</p> : (
            <div className="list">{purch.map((a) => (
              <div className="row" key={a.id}><div><div className="rt">{a.fornitore ?? '—'}</div>
                <div className="rs">{a.data ?? ''}{a.costo_unitario != null ? ` · €${a.costo_unitario}/pz` : ''}</div></div>
                <div className="giac">+{a.quantita}</div></div>
            ))}</div>
          )}
        </section>
        <section className="card"><h2>Vendite{sales ? ` · ${sales.reduce((s, v) => s + Number(v.qty), 0)} pz` : ''}</h2>
          {sales == null ? <p className="muted center">…</p> : !sales.length ? <p className="muted center">Nessuna vendita.</p> : (
            <div className="list">{sales.map((s) => (
              <div className="row" key={s.source + s.id}><div><div className="rt">{s.source === 'qromo' ? '🏬 Negozio' : '🌐 Online'} · {s.descr}</div>
                <div className="rs">{s.data ?? ''}{s.price != null ? ` · ${eur(s.price)}` : ''}</div></div>
                <div className="giac neg">−{s.qty}</div></div>
            ))}</div>
          )}
        </section>
      </div>
    </div>
  );
}

/* #2: Shopify catalog composition — treemap of online SKUs per model, sized by count */
const CATCOL: Record<string, string> = { BAG: '#8B5E6B', PELLE: '#9C5F33', TESSUTO: '#2E8049', ACCESSORI: '#5d6b7a', ALTRO: '#6f6056' };
function ShopComposition({ inv, pin }: { inv: InvFull[]; pin: string }) {
  const [busy, setBusy] = useState(false);
  const byItem = useMemo(() => {
    const m = new Map<string, { item: string; cat: string; n: number }>();
    for (const p of inv.filter((x) => x.on_shopify)) {
      const k = p.item ?? p.codice; const a = m.get(k) ?? { item: k, cat: p.categoria ?? 'ALTRO', n: 0 };
      a.n += 1; m.set(k, a);
    }
    return [...m.values()].sort((a, b) => b.n - a.n);
  }, [inv]);
  const tot = byItem.reduce((s, i) => s + i.n, 0);
  async function sync() {
    setBusy(true);
    try { const r = await syncShopifyStock(pin) as { synced: number }; toast(`Aggiornato: ${r.synced} varianti da Shopify`, 'ok'); }
    catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); }
  }
  return (
    <>
      <div className="kpis">
        <div className="kpi rose"><div className="v">{tot}</div><div className="k">SKU su Shopify</div></div>
        <div className="kpi accent"><div className="v">{byItem.length}</div><div className="k">Modelli online</div></div>
      </div>
      <p className="note">Varianti pubblicate su Shopify per modello — riquadro più grande = più varianti online. Lo stock Shopify è tenuto a <b>magazzino − 2</b> per scelta (cuscinetto di sicurezza), non è un disallineamento.</p>
      <div className="treemap">
        {byItem.map((it) => (
          <div className="tmbox" key={it.item} style={{ flexGrow: it.n, background: CATCOL[it.cat] ?? CATCOL.ALTRO }} title={`${it.item} · ${it.n} SKU`}>
            <span className="tmname">{it.item}</span><span className="tmn">{it.n}</span>
          </div>
        ))}
        {!byItem.length && <p className="muted center">Nessun prodotto su Shopify.</p>}
      </div>
      <div className="catleg">{Object.entries(CATCOL).map(([c, col]) => <span key={c}><i style={{ background: col }} />{c}</span>)}</div>
      <button className="syncbtn" onClick={sync} disabled={busy}>{busy ? 'Sincronizzo…' : '🔄 Aggiorna da Shopify'}</button>
    </>
  );
}

/* reorder board */
function ReorderView() {
  const [rows, setRows] = useState<Reorder[] | null>(null);
  const [soloVend, setSoloVend] = useState(true);
  useEffect(() => { fetchReorder().then(setRows).catch(() => setRows([])); }, []);
  if (rows == null) return <p className="muted center">Carico…</p>;
  const urgent = (p: Reorder) => p.venduto_60d > 0 && p.disponibili <= 2 && p.in_arrivo === 0;
  const list = (soloVend ? rows.filter((p) => p.venduto_60d > 0) : rows);
  return (
    <>
      <div className="filters"><button className={`fchip ${soloVend ? 'on' : ''}`} onClick={() => setSoloVend(true)}>Solo venduti</button>
        <button className={`fchip ${!soloVend ? 'on' : ''}`} onClick={() => setSoloVend(false)}>Tutti</button></div>
      <p className="note">Ordinati per urgenza (vendite 60g ÷ stock disponibile). Badge = best-seller che sta finendo senza riordini in arrivo.</p>
      <div className="card"><div className="list">
        {list.slice(0, 120).map((p) => (
          <div className="row" key={p.codice}>
            <div className="invleft"><Tile url={p.image_url} label={p.item ?? p.codice} />
              <div><div className="rt">{nome(p.item, p.variant)} {urgent(p) && <span className="hot">da riprodurre</span>}</div>
                <div className="invtags">
                  <span className="tag cv">{p.venduto_60d} venduti/60g</span>
                  {p.in_arrivo > 0 && <span className="tag live">{p.in_arrivo} in arrivo</span>}
                  {p.giorni_stock != null && <span className="tag off">~{p.giorni_stock}g stock</span>}
                </div>
              </div>
            </div>
            <div className={`giac ${p.disponibili <= 0 ? 'neg' : ''}`}>{p.disponibili}</div>
          </div>
        ))}
        {!list.length && <p className="muted center">Nessun prodotto.</p>}
      </div></div>
    </>
  );
}

/* inventory valuation */
function ValoreView({ inv }: { inv: InvFull[] }) {
  const live = inv.filter((p) => p.giacenza_attuale > 0);
  const atCogs = live.reduce((s, p) => s + p.giacenza_attuale * (p.cogs || 0), 0);
  const atRetail = live.reduce((s, p) => s + (p.valore || 0), 0);
  const byLine = useMemo(() => {
    const m = new Map<string, { cogs: number; retail: number; pezzi: number }>();
    for (const p of live) {
      const k = p.item ?? p.codice; const a = m.get(k) ?? { cogs: 0, retail: 0, pezzi: 0 };
      a.cogs += p.giacenza_attuale * (p.cogs || 0); a.retail += p.valore || 0; a.pezzi += p.giacenza_attuale; m.set(k, a);
    }
    return [...m.entries()].sort((x, y) => y[1].retail - x[1].retail);
  }, [inv]);
  const vSort = useSort(byLine.map(([k, v]) => ({ linea: k, pezzi: v.pezzi, cogs: v.cogs, retail: v.retail })) as unknown as Record<string, unknown>[], 'retail', 'desc');
  return (
    <>
      <div className="kpis">
        <div className="kpi accent"><div className="v">{eur(atCogs)}</div><div className="k">Valore a costo (COGS)</div></div>
        <div className="kpi rose"><div className="v">{eur(atRetail)}</div><div className="k">Valore a prezzo vendita</div></div>
      </div>
      <section className="card"><h2>Per linea</h2>
        <div className="tablewrap"><table className="sortable">
          <thead><tr>
            <th onClick={() => vSort.toggle('linea')}>Linea{vSort.arrow('linea')}</th>
            <th onClick={() => vSort.toggle('pezzi')}>Pezzi{vSort.arrow('pezzi')}</th>
            <th onClick={() => vSort.toggle('cogs')}>A costo{vSort.arrow('cogs')}</th>
            <th onClick={() => vSort.toggle('retail')}>A prezzo{vSort.arrow('retail')}</th>
          </tr></thead>
          <tbody>{(vSort.sorted as unknown as { linea: string; pezzi: number; cogs: number; retail: number }[]).map((v) => (
            <tr key={v.linea}><td className="l">{v.linea}</td><td>{v.pezzi}</td><td>{eur(v.cogs)}</td><td>{eur(v.retail)}</td></tr>
          ))}</tbody>
        </table></div>
      </section>
    </>
  );
}

/* Disponibilità — availability overview (KPI + critical lines + reorder), artifact-style.
   Note: "giorni vuoto" is NOT shown — it needs stock-history sampling the app doesn't have yet. */
const lineOf = (item: string | null, codice: string) => (item ?? codice).trim().split(/[\s_]/)[0].toUpperCase();
function DisponibilitaView({ inv }: { inv: InvFull[] }) {
  const [reord, setReord] = useState<Reorder[] | null>(null);
  useEffect(() => { fetchReorder().then(setReord).catch(() => setReord([])); }, []);

  const pub = inv.filter((p) => p.on_shopify);
  const skuAcq = inv.filter((p) => p.on_shopify && p.giacenza_attuale > 0).length;
  const varAcq = inv.filter((p) => p.giacenza_attuale > 0).length;
  const attiviEsauriti = pub.filter((p) => p.giacenza_attuale <= 0).length;
  const inStockNonPub = inv.filter((p) => !p.on_shopify && p.giacenza_attuale > 0).length;

  const lines = useMemo(() => {
    const m = new Map<string, { pub: number; esa: number }>();
    for (const p of inv.filter((x) => x.on_shopify)) {
      const k = lineOf(p.item, p.codice); const a = m.get(k) ?? { pub: 0, esa: 0 };
      a.pub += 1; if (p.giacenza_attuale <= 0) a.esa += 1; m.set(k, a);
    }
    return [...m.entries()].filter(([, v]) => v.esa > 0)
      .map(([k, v]) => ({ line: k, esa: v.esa, cov: Math.round(((v.pub - v.esa) / v.pub) * 100) }))
      .sort((a, b) => b.esa - a.esa).slice(0, 8);
  }, [inv]);

  const reorder = useMemo(() => {
    const price = new Map(inv.map((p) => [p.codice, p.retail_price ?? 0]));
    return (reord ?? []).filter((r) => r.disponibili <= 0 && r.venduto_60d > 0)
      .map((r) => ({ ...r, persiSett: Math.round((r.venduto_60d / 60) * 7 * (price.get(r.codice) ?? 0)) }))
      .sort((a, b) => b.persiSett - a.persiSett);
  }, [reord, inv]);

  return (
    <>
      <div className="kpis">
        <div className="kpi rose"><div className="v">{skuAcq}</div><div className="k">SKU acquistabili</div><div className="ksub">pubblicati e in stock</div></div>
        <div className="kpi accent"><div className="v">{varAcq}</div><div className="k">Varianti acquistabili</div><div className="ksub">varianti in stock</div></div>
        <div className="kpi red"><div className="v">{attiviEsauriti}</div><div className="k">Attivi ma esauriti</div><div className="ksub">vetrina vuota: pubblicati a 0</div></div>
        <div className="kpi"><div className="v">{inStockNonPub}</div><div className="k">In stock non pubblicati</div><div className="ksub">magazzino non esposto</div></div>
        <div className="kpi green"><div className="v">{pub.length}</div><div className="k">Pubblicati su Shopify</div><div className="ksub">di cui {attiviEsauriti} esauriti</div></div>
      </div>

      {lines.length > 0 && (
        <>
          <h2 className="sech">Linee critiche / da monitorare</h2>
          <div className="filters">
            {lines.map((l) => <span key={l.line} className="critchip">{l.line}: {l.esa} esauriti · copertura {l.cov}%</span>)}
          </div>
        </>
      )}

      <h2 className="sech">Da riordinare adesso</h2>
      {reord == null ? <p className="muted center">Carico…</p> : !reorder.length ? (
        <div className="card muted center">Niente di esaurito tra i best-seller. 🎉</div>
      ) : (
        <div className="card"><div className="tablewrap"><table className="sortable invtable">
          <thead><tr><th className="l">Prodotto</th><th>Venduti (60gg)</th><th>€ persi/sett.</th></tr></thead>
          <tbody>{reorder.slice(0, 40).map((r) => (
            <tr key={r.codice}>
              <td className="l">{nome(r.item, r.variant)}{r.in_arrivo > 0 && <span className="tag live"> {r.in_arrivo} in arrivo</span>}</td>
              <td>{r.venduto_60d}</td>
              <td className="neg">{eur(r.persiSett)}</td>
            </tr>
          ))}</tbody>
        </table></div></div>
      )}
    </>
  );
}

const VIEWS = ['disp', 'mag', 'riordino', 'neg', 'shop', 'valore'];
export default function Inventory({ pin, initial, go }: { pin: string; chi: string; initial?: string; go?: (t: 'registra', p?: string) => void }) {
  type V = 'disp' | 'mag' | 'neg' | 'shop' | 'riordino' | 'valore';
  const [view, setView] = useState<V>((initial && VIEWS.includes(initial) ? initial : 'disp') as V);
  const [inv, setInv] = useState<InvFull[]>([]);
  const [cv, setCv] = useState<CV[]>([]);
  const [q, setQ] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState<InvFull | null>(null);
  const [shopMap, setShopMap] = useState<Map<string, number>>(new Map());
  const [lastSaleMap, setLastSaleMap] = useState<Map<string, { date: string | null; price: number | null }>>(new Map());
  const shopQ = (p: InvFull) => shopMap.get(norm(p.codice)) ?? null;

  useEffect(() => {
    fetchInventory().then(setInv).catch((e) => setErr(e.message));
    fetchContoVendita().then(setCv).catch(() => {});
    fetchShopStockMap().then(setShopMap).catch(() => {});
    fetchLastSaleMap().then(setLastSaleMap).catch(() => {});
  }, []);

  const alive = useMemo(() => inv.filter((p) => p.giacenza_attuale > 0 || daysSince(p.last_sale) <= 60), [inv]);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return alive.filter((p) => !s || `${p.item ?? ''} ${p.variant ?? ''} ${p.codice}`.toLowerCase().includes(s));
  }, [alive, q]);

  // #3: Magazzino = one clean summary table with the requested KPIs (3 stocks + value)
  const magRows = useMemo(() => list.map((p) => ({
    codice: p.codice, nome: nome(p.item, p.variant), mag: p.giacenza_attuale, conto: p.in_conto_vendita,
    shopify: p.on_shopify ? (shopMap.get(norm(p.codice)) ?? 0) : -1, valore: Math.round(p.valore || 0),
    _img: p.image_url, _p: p,
  })), [list, shopMap]);
  const magSort = useSort(magRows as unknown as Record<string, unknown>[], 'mag', 'asc');

  const totVal = alive.reduce((s, p) => s + (p.valore || 0), 0);
  const hidden = inv.length - alive.length;
  const magNeg = alive.filter((p) => p.giacenza_attuale < 0).length;
  const cvList = useMemo(() => cv.map((r) => {
    const ls = lastSaleMap.get(norm(r.codice));
    return { ...r, last_date: ls?.date ?? null, last_price: ls?.price ?? null };
  }).sort((a, b) => (b.last_date ?? '').localeCompare(a.last_date ?? '')), [cv, lastSaleMap]);

  if (err) return <div className="screen"><div className="card err">Errore: {err}</div></div>;

  return (
    <div className="screen">
      <header>
        <h1>Inventario</h1>
        <div className="seg wrap">
          <button className={view === 'disp' ? 'on' : ''} onClick={() => setView('disp')}>Disponibilità</button>
          <button className={view === 'mag' ? 'on' : ''} onClick={() => setView('mag')}>Magazzino</button>
          <button className={view === 'riordino' ? 'on' : ''} onClick={() => setView('riordino')}>Riordino</button>
          <button className={view === 'neg' ? 'on' : ''} onClick={() => setView('neg')}>Nei negozi</button>
          <button className={view === 'shop' ? 'on' : ''} onClick={() => setView('shop')}>Shopify</button>
          <button className={view === 'valore' ? 'on' : ''} onClick={() => setView('valore')}>Valore</button>
        </div>
        <div className="hbtns"><PrintBtn /><ExportBtn name="inventario" rows={() => inv.map((p) => ({ codice: p.codice, prodotto: nome(p.item, p.variant), modello: p.item, variante: p.variant, categoria: p.categoria, magazzino: p.giacenza_attuale, conto_vendita: p.in_conto_vendita, su_shopify: p.on_shopify ? 'si' : 'no', shopify_qty: shopQ(p) ?? '', prezzo: p.retail_price, cogs: p.cogs, valore: p.valore }))} /></div>
      </header>

      {view === 'mag' && (
        <>
          <div className="kpis">
            <div className="kpi accent"><div className="v">{eur(totVal)}</div><div className="k">Valore magazzino</div></div>
            <div className="kpi"><div className="v">{alive.length}</div><div className="k">Attivi{hidden > 0 ? ` · ${hidden} nascosti` : ''}</div></div>
          </div>
          {magNeg > 0 && <p className="note">{magNeg} varianti a giacenza negativa (in rosso): vendite senza carico registrato, da sistemare. Riducono il valore mostrato.</p>}
          <input className="search" placeholder="Cerca prodotto…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="card">
            <div className="tablewrap"><table className="sortable invtable">
              <thead><tr>
                <th onClick={() => magSort.toggle('nome')}>Prodotto{magSort.arrow('nome')}</th>
                <th onClick={() => magSort.toggle('mag')}>Mag.{magSort.arrow('mag')}</th>
                <th onClick={() => magSort.toggle('conto')}>Conto{magSort.arrow('conto')}</th>
                <th onClick={() => magSort.toggle('shopify')}>Shopify{magSort.arrow('shopify')}</th>
                <th onClick={() => magSort.toggle('valore')}>Valore{magSort.arrow('valore')}</th>
              </tr></thead>
              <tbody>{(magSort.sorted as unknown as { codice: string; nome: string; mag: number; conto: number; shopify: number; valore: number; _img: string | null; _p: InvFull }[]).map((r) => (
                <tr key={r.codice} className="clickrow" onClick={() => setSel(r._p)}>
                  <td className="l prodcell"><span className="tdimg">{r._img ? <img src={r._img} alt="" loading="lazy" /> : <i>{r.nome.slice(0, 2)}</i>}</span>{r.nome}</td>
                  <td className={r.mag < 0 ? 'neg' : ''}>{r.mag}</td>
                  <td>{r.conto || ''}</td>
                  <td>{r.shopify < 0 ? '—' : r.shopify}</td>
                  <td>{eur(r.valore)}</td>
                </tr>
              ))}</tbody>
            </table></div>
            {!magRows.length && <p className="muted center">Nessun prodotto.</p>}
          </div>
        </>
      )}

      {view === 'neg' && (
        cvList.length === 0 ? <div className="card muted center">Nessuna merce in conto vendita. Registra un movimento B2B (invio) da Registra ▸ B2B.</div> : (
          <>
            <p className="note">In conto vendita, ordinati per ultima vendita. Tocca un prodotto per registrare vendita/rientro nel suo negozio.</p>
            <div className="card"><div className="list">
              {cvList.map((r) => (
                <button className="row clickrow" type="button" key={r.negozio + r.codice} onClick={() => go && go('registra', `b2b:${r.negozio}`)}>
                  <div className="invleft">
                    <Tile url={r.image_url} label={r.item ?? r.codice} />
                    <div>
                      <div className="rt">{nome(r.item, r.variant)}</div>
                      <div className="rs">@ {r.negozio} · {r.pezzi} pz</div>
                      <div className="invtags"><span className="tag">{r.last_date ? `🛒 ${r.last_date}` : 'mai venduto'}{r.last_price != null ? ` · ${eur(r.last_price)}` : ''}</span></div>
                    </div>
                  </div>
                  <span className="chev">›</span>
                </button>
              ))}
            </div></div>
          </>
        )
      )}

      {view === 'disp' && <DisponibilitaView inv={inv} />}
      {view === 'shop' && <ShopComposition inv={inv} pin={pin} />}
      {view === 'riordino' && <ReorderView />}
      {view === 'valore' && <ValoreView inv={inv} />}

      {sel && <ProductDrawer p={sel} shopQty={shopQ(sel)} onClose={() => setSel(null)} />}
    </div>
  );
}
