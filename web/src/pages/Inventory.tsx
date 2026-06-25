import { useEffect, useMemo, useState } from 'react';
import { fetchInventory, fetchContoVendita, fetchShopifyAlign, syncShopifyStock, realignShopify, fetchReorder, fetchSkuAvailability } from '../lib/api';
import type { InvFull, CV, ShopAlign, Reorder, SkuAvail } from '../lib/api';
import { useSort } from '../lib/sortable';

const eur = (n: number) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n || 0);
const daysSince = (iso: string | null) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : Infinity);
const FILTERS: [string, string][] = [['attivi', 'Attivi'], ['riordino', 'Da riordinare'], ['esauriti', 'Esauriti'], ['online', 'Su Shopify']];

function Tile({ url, label }: { url: string | null; label: string }) {
  return url ? <img className="invimg" src={url} alt="" loading="lazy" /> : <div className="invimg ph">{label.slice(0, 2)}</div>;
}

/* ---------- THIRD FLOW: Shopify alignment ---------- */
function ShopView({ pin, chi }: { pin: string; chi: string }) {
  const [rows, setRows] = useState<ShopAlign[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const load = () => fetchShopifyAlign().then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, []);

  async function sync() {
    setBusy(true); setMsg(null);
    try { const r = await syncShopifyStock(pin) as { synced: number }; setMsg(`Aggiornato: ${r.synced} varianti da Shopify`); load(); }
    catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  }
  async function realign(codici: string[]) {
    setBusy(true); setMsg(null);
    try {
      const r = await realignShopify(codici, pin, chi) as { gated?: boolean; realigned?: number; error?: string };
      setMsg(r.gated ? '⚠️ Riallineamento disattivato lato server (interruttore spento).' : r.error ? r.error : `Riallineati ${r.realigned} prodotti su Shopify`);
      load();
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  }

  if (rows == null) return <p className="muted center">Carico…</p>;
  const mis = rows.filter((r) => r.diff !== 0);
  const low = rows.filter((r) => r.on_shopify && r.disponibili <= 2);
  const lastSync = rows.map((r) => r.synced_at).filter(Boolean).sort().pop();

  return (
    <>
      <button className="syncbtn" onClick={sync} disabled={busy}>
        {busy ? 'Sincronizzo…' : lastSync ? `🔄 Aggiorna da Shopify · ultimo ${String(lastSync).slice(0, 10)}` : '🔄 Aggiorna da Shopify'}
      </button>
      {msg && <div className={`msg ${msg.startsWith('⚠️') ? 'err' : 'ok'}`}>{msg}</div>}
      {!lastSync && <div className="card muted center">Tocca “Aggiorna da Shopify” per leggere le giacenze online e confrontarle.</div>}

      {low.length > 0 && (
        <section className="card">
          <h2>Scorte basse online · conta consigliata</h2>
          <div className="list">
            {low.slice(0, 20).map((p) => (
              <div className="row" key={p.codice}>
                <div className="invleft"><Tile url={p.image_url} label={p.item ?? p.codice} /><div><div className="rt">{p.item ?? p.codice}</div><div className="rs">{p.variant ?? ''}</div></div></div>
                <div className="giac neg">{p.disponibili}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {mis.length > 0 && (
        <section className="card">
          <div className="dethead"><h2>Disallineati con Shopify · {mis.length}</h2>
            <button className="chip" disabled={busy} onClick={() => realign(mis.map((m) => m.codice))}>Riallinea tutti</button></div>
          <div className="list">
            {mis.slice(0, 60).map((p) => (
              <div className="alignrow" key={p.codice}>
                <div className="invleft"><Tile url={p.image_url} label={p.item ?? p.codice} />
                  <div><div className="rt">{p.item ?? p.codice}</div>
                    <div className="rs">gestionale {p.disponibili} · Shopify {p.shopify_qty ?? '—'}</div>
                    <div className={`whytag ${p.diff < 0 ? 'under' : 'over'}`}>{p.diff < 0 ? `Shopify ne mostra ${-p.diff} in meno` : `Shopify ne mostra ${p.diff} in più`}</div>
                  </div>
                </div>
                <button className="chip" disabled={busy} onClick={() => realign([p.codice])}>riallinea</button>
              </div>
            ))}
          </div>
        </section>
      )}
      {lastSync && !mis.length && <div className="card muted center">Tutto allineato con Shopify. ✓</div>}
    </>
  );
}

/* ---------- FEATURE: reorder board ("Cosa Riprodurre") ---------- */
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
      <p className="note">Ordinati per urgenza (vendite ultimi 60 giorni ÷ stock disponibile). Badge = best-seller che sta finendo senza riordini in arrivo.</p>
      <div className="card"><div className="list">
        {list.slice(0, 120).map((p) => (
          <div className="row" key={p.codice}>
            <div className="invleft"><Tile url={p.image_url} label={p.item ?? p.codice} />
              <div><div className="rt">{p.item ?? p.codice} {urgent(p) && <span className="hot">da riprodurre</span>}</div>
                <div className="rs">{p.variant ?? ''}</div>
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

/* ---------- FEATURE: SKU availability monitor ---------- */
function DispView() {
  const [rows, setRows] = useState<SkuAvail[] | null>(null);
  useEffect(() => { fetchSkuAvailability().then(setRows).catch(() => setRows([])); }, []);
  if (rows == null) return <p className="muted center">Carico…</p>;
  const acq = rows.filter((r) => r.stato === 'acquistabile');
  const nonPub = rows.filter((r) => r.stato === 'in_stock_non_pubblicato');
  const esaur = rows.filter((r) => r.stato === 'pubblicato_esaurito');
  const Block = ({ title, hint, items }: { title: string; hint: string; items: SkuAvail[] }) => (
    <section className="card"><h2>{title} · {items.length}</h2><p className="note">{hint}</p>
      <div className="list">{items.slice(0, 40).map((p) => (
        <div className="row" key={p.codice}><div className="invleft"><Tile url={p.image_url} label={p.item ?? p.codice} />
          <div><div className="rt">{p.item ?? p.codice}</div><div className="rs">{p.variant ?? ''}</div></div></div>
          <div className="giac">{p.giacenza}</div></div>))}
        {!items.length && <p className="muted center">Nessuno. ✓</p>}</div>
    </section>
  );
  return (
    <>
      <div className="kpis">
        <div className="kpi green"><div className="v">{acq.length}</div><div className="k">Acquistabili ora</div></div>
        <div className="kpi red"><div className="v">{nonPub.length + esaur.length}</div><div className="k">Vendite perse</div></div>
      </div>
      <Block title="In stock ma NON su Shopify" hint="Hai i pezzi ma non sono pubblicati: pubblicali per vendere." items={nonPub} />
      <Block title="Su Shopify ma esauriti" hint="Pubblicati ma senza disponibilità: riproduci o avvia il back-in-stock." items={esaur} />
    </>
  );
}

/* ---------- FEATURE: inventory valuation ---------- */
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

const VIEWS = ['mag', 'riordino', 'disp', 'neg', 'shop', 'valore'];
export default function Inventory({ pin, chi, initial, go }: { pin: string; chi: string; initial?: string; go?: (t: 'registra', p?: string) => void }) {
  type V = 'mag' | 'neg' | 'shop' | 'riordino' | 'disp' | 'valore';
  const [view, setView] = useState<V>((initial && VIEWS.includes(initial) ? initial : 'mag') as V);
  const [store, setStore] = useState<string | null>(null);
  const [inv, setInv] = useState<InvFull[]>([]);
  const [cv, setCv] = useState<CV[]>([]);
  const [q, setQ] = useState('');
  const [f, setF] = useState('attivi');
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetchInventory().then(setInv).catch((e) => setErr(e.message));
    fetchContoVendita().then(setCv).catch(() => {});
  }, []);

  const alive = useMemo(() => inv.filter((p) => p.giacenza_attuale > 0 || daysSince(p.last_sale) <= 60), [inv]);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    let r = alive.filter((p) => !s || `${p.item ?? ''} ${p.variant ?? ''} ${p.codice}`.toLowerCase().includes(s));
    if (f === 'riordino') r = r.filter((p) => p.giacenza_attuale <= 3);
    else if (f === 'esauriti') r = r.filter((p) => p.giacenza_attuale <= 0);
    else if (f === 'online') r = r.filter((p) => p.on_shopify);
    return r.slice(0, 300);
  }, [alive, q, f]);

  const totVal = alive.reduce((s, p) => s + (p.valore || 0), 0);
  const hidden = inv.length - alive.length;
  const byStore = useMemo(() => {
    const m = new Map<string, CV[]>();
    for (const r of cv) { const a = m.get(r.negozio) ?? []; a.push(r); m.set(r.negozio, a); }
    return [...m.entries()];
  }, [cv]);

  if (err) return <div className="screen"><div className="card err">Errore: {err}</div></div>;

  return (
    <div className="screen">
      <header>
        <h1>Inventario</h1>
        <div className="seg wrap">
          <button className={view === 'mag' ? 'on' : ''} onClick={() => setView('mag')}>Magazzino</button>
          <button className={view === 'riordino' ? 'on' : ''} onClick={() => setView('riordino')}>Riordino</button>
          <button className={view === 'disp' ? 'on' : ''} onClick={() => setView('disp')}>Disponibilità</button>
          <button className={view === 'neg' ? 'on' : ''} onClick={() => setView('neg')}>Nei negozi</button>
          <button className={view === 'shop' ? 'on' : ''} onClick={() => setView('shop')}>Shopify</button>
          <button className={view === 'valore' ? 'on' : ''} onClick={() => setView('valore')}>Valore</button>
        </div>
      </header>

      {view === 'mag' && (
        <>
          <div className="kpis">
            <div className="kpi accent"><div className="v">{eur(totVal)}</div><div className="k">Valore magazzino</div></div>
            <div className="kpi"><div className="v">{alive.length}</div><div className="k">Attivi{hidden > 0 ? ` · ${hidden} nascosti` : ''}</div></div>
          </div>
          <input className="search" placeholder="Cerca prodotto…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="filters">
            {FILTERS.map(([k, l]) => <button key={k} type="button" className={`fchip ${f === k ? 'on' : ''}`} onClick={() => setF(k)}>{l}</button>)}
          </div>
          <div className="card">
            <div className="list">
              {list.map((p) => (
                <div className="row" key={p.codice}>
                  <div className="invleft">
                    <Tile url={p.image_url} label={p.item ?? p.codice} />
                    <div>
                      <div className="rt">{p.item ?? p.codice}</div>
                      <div className="rs">{p.variant ?? ''}</div>
                      <div className="invtags">
                        {p.on_shopify
                          ? <span className="tag live">● Shopify · {Math.max(0, p.disponibili_da_vendere)} disp.</span>
                          : <span className="tag off">non online</span>}
                        {p.in_conto_vendita > 0 && <span className="tag cv">{p.in_conto_vendita} in negozio</span>}
                      </div>
                    </div>
                  </div>
                  <div className={`giac ${p.giacenza_attuale <= 0 ? 'neg' : ''}`}>{p.giacenza_attuale}</div>
                </div>
              ))}
              {!list.length && <p className="muted center">Nessun prodotto.</p>}
            </div>
          </div>
        </>
      )}

      {view === 'neg' && !store && (
        <>
          {byStore.length === 0 && <div className="card muted center">Nessuna merce in conto vendita. Registra un movimento B2B (invio) da Registra ▸ B2B.</div>}
          {byStore.map(([s, items]) => (
            <button className="navcard" key={s} onClick={() => setStore(s)} type="button">
              <div className="ncmain">
                <div className="nct">{s}</div>
                <div className="pillrow"><span className="pill warn">{items.reduce((a, i) => a + i.pezzi, 0)} pezzi in conto</span><span className="pill muted">{items.length} modelli</span></div>
              </div>
              <span className="chev">›</span>
            </button>
          ))}
        </>
      )}
      {view === 'neg' && store && (() => {
        const items = byStore.find(([s]) => s === store)?.[1] ?? [];
        const pezzi = items.reduce((a, i) => a + i.pezzi, 0);
        return (
          <>
            <button className="back" onClick={() => setStore(null)}>← Tutti i negozi</button>
            <section className="card"><h2>{store} · {pezzi} pezzi in conto</h2>
              <div className="list">{items.map((i) => (
                <div className="row" key={i.codice}>
                  <div className="invleft"><Tile url={i.image_url} label={i.item ?? i.codice} />
                    <div><div className="rt">{i.item ?? i.codice}</div><div className="rs">{i.variant ?? ''}</div></div></div>
                  <div className="giac">{i.pezzi}</div>
                </div>))}
                {!items.length && <p className="muted center">Niente in conto vendita qui.</p>}
              </div>
            </section>
            {go && <button className="submit" onClick={() => go('registra', 'b2b')}>Registra vendita / rientro (B2B)</button>}
          </>
        );
      })()}

      {view === 'shop' && <ShopView pin={pin} chi={chi} />}
      {view === 'riordino' && <ReorderView />}
      {view === 'disp' && <DispView />}
      {view === 'valore' && <ValoreView inv={inv} />}
    </div>
  );
}
