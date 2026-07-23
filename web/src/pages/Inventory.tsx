import { useEffect, useMemo, useState } from 'react';
import { pushBack, popBack } from '../lib/backnav';
import { fetchInventory, fetchContoVendita, syncNowShopify, fetchReorder, fetchShopStockMap, fetchSalesByCodice, fetchPurchasesByCodice, fetchAdjustmentsByCodice, fetchLastSaleMap, archiveReorder } from '../lib/api';
import Icon from '../components/Icon';
import type { InvFull, CV, Reorder, SaleRow, PurchaseRow, AdjustmentRow } from '../lib/api';
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

/* product detail drawer — 3 stocks + sales/purchase/adjustment history */
function ProductDrawer({ p, shopQty, onClose, go }: { p: InvFull; shopQty: number | null; onClose: () => void; go?: (t: 'registra', p?: string) => void }) {
  const [sales, setSales] = useState<SaleRow[] | null>(null);
  const [purch, setPurch] = useState<PurchaseRow[] | null>(null);
  const [adjs, setAdjs] = useState<AdjustmentRow[] | null>(null);
  useEffect(() => {
    fetchSalesByCodice(p.codice).then(setSales).catch(() => setSales([]));
    fetchPurchasesByCodice(p.codice).then(setPurch).catch(() => setPurch([]));
    fetchAdjustmentsByCodice(p.codice).then(setAdjs).catch(() => setAdjs([]));
  }, [p.codice]);
  // etichetta leggibile per le rettifiche: la conta deve VEDERSI (feedback 06-07 item 4)
  const adjLabel = (m: string | null) => {
    const mm = (m ?? '').toLowerCase();
    if (mm.includes('conta')) return '🔢 Conta fisica';
    if (mm.includes('cambio')) return '↔️ Cambio (sostituto uscito)';
    return '🧮 Rettifica';
  };
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
        {go && (
          <button className="bigadd" type="button" onClick={() => go('registra', `count:${p.codice}`)}>
            🔢 Registra conta di questo prodotto
          </button>
        )}
        <section className="card"><h2>Acquisti{purch ? ` · ${purch.reduce((s, a) => s + Number(a.quantita), 0)} pz` : ''}</h2>
          {purch == null ? <p className="muted center">…</p> : !purch.length ? <p className="muted center">Nessun acquisto registrato.</p> : (
            <div className="list">{purch.map((a) => (
              <div className="row" key={a.id}><div><div className="rt">{a.fornitore ?? '—'}</div>
                <div className="rs">{a.data ?? ''}{a.costo_unitario != null ? ` · €${a.costo_unitario}/pz` : ''}</div></div>
                <div className="giac">+{a.quantita}</div></div>
            ))}</div>
          )}
        </section>
        {adjs != null && adjs.length > 0 && (
          <section className="card"><h2>Conte e rettifiche · {adjs.reduce((s, a) => s + Number(a.qty_delta), 0) >= 0 ? '+' : ''}{adjs.reduce((s, a) => s + Number(a.qty_delta), 0)} pz</h2>
            <div className="list">{adjs.map((a) => (
              <div className="row" key={a.id}><div><div className="rt">{adjLabel(a.motivo)}</div>
                <div className="rs">{a.data ?? ''}{a.motivo ? ` · ${a.motivo}` : ''}</div></div>
                <div className={`giac${Number(a.qty_delta) < 0 ? ' neg' : ''}`}>{Number(a.qty_delta) > 0 ? '+' : ''}{a.qty_delta}</div></div>
            ))}</div>
          </section>
        )}
        <section className="card"><h2>Vendite{sales ? ` · ${sales.reduce((s, v) => s + Number(v.qty), 0)} pz` : ''}</h2>
          {sales == null ? <p className="muted center">…</p> : !sales.length ? <p className="muted center">Nessuna vendita.</p> : (
            <div className="list">{sales.map((s) => (
              <div className="row" key={s.source + s.id}><div><div className="rt">{s.source === 'qromo' ? '🏬 QROMO' : '🌐 Shopify'} · {s.descr}</div>
                <div className="rs">{s.data ?? ''}{s.price != null ? ` · ${eur(s.price)}` : ''}{s.adminUrl ? <> · <a href={s.adminUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>apri su Shopify ↗</a></> : ''}</div></div>
                <div className="giac neg">−{s.qty}</div></div>
            ))}</div>
          )}
        </section>
      </div>
    </div>
  );
}

/* reorder board — click = nuovo ordine precompilato (item 21); archivio ripristinabile (item 20) */
function ReorderView({ pin, chi, goOrdini }: { pin: string; chi: string; goOrdini?: (param: string) => void }) {
  const [rows, setRows] = useState<Reorder[] | null>(null);
  const [soloVend, setSoloVend] = useState(true);
  const [showArch, setShowArch] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const load = () => fetchReorder().then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, []);
  if (rows == null) return <p className="muted center">Carico…</p>;
  const urgent = (p: Reorder) => p.venduto_60d > 0 && p.disponibili <= 2 && p.in_arrivo === 0;
  const attivi = rows.filter((p) => !p.riordino_archiviato);
  const archiviati = rows.filter((p) => p.riordino_archiviato);
  const list = (soloVend ? attivi.filter((p) => p.venduto_60d > 0) : attivi);

  async function setArch(codice: string, archived: boolean) {
    setBusy(codice);
    try {
      await archiveReorder(codice, archived, pin, chi);
      toast(archived ? 'Spostato nell’archivio riordino' : 'Ripristinato nel riordino', 'ok');
      load();
    } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(null); }
  }

  const riga = (p: Reorder, archived: boolean) => (
    <div className="row" key={p.codice}>
      <button className="invleft" type="button" style={{ background: 'none', border: 'none', padding: 0, cursor: goOrdini ? 'pointer' : 'default', textAlign: 'left' }}
        onClick={() => !archived && goOrdini && goOrdini(`new:${p.codice}`)}
        title={archived ? '' : 'Tocca per creare un nuovo ordine precompilato'}>
        <Tile url={p.image_url} label={p.item ?? p.codice} />
        <div><div className="rt">{nome(p.item, p.variant)} {!archived && urgent(p) && <span className="hot">da riprodurre</span>}</div>
          <div className="invtags">
            <span className="tag cv">{p.venduto_60d} venduti/60g</span>
            {p.in_arrivo > 0 && <span className="tag live">{p.in_arrivo} in arrivo</span>}
            {p.giorni_stock != null && <span className="tag off">~{p.giorni_stock}g stock</span>}
          </div>
        </div>
      </button>
      <div className={`giac ${p.disponibili <= 0 ? 'neg' : ''}`}>{p.disponibili}</div>
      <button className="chip" type="button" disabled={busy === p.codice} title={archived ? 'Ripristina nel riordino' : 'Archivia (es. pelle finita): sparisce da qui, resta nell’archivio'}
        onClick={() => setArch(p.codice, !archived)}>{busy === p.codice ? '…' : archived ? '↩︎' : '🗄️'}</button>
    </div>
  );

  return (
    <>
      <div className="filters"><button className={`fchip ${soloVend ? 'on' : ''}`} onClick={() => setSoloVend(true)}>Solo venduti</button>
        <button className={`fchip ${!soloVend ? 'on' : ''}`} onClick={() => setSoloVend(false)}>Tutti</button></div>
      <p className="note">Ordinati per urgenza (vendite 60g ÷ stock disponibile). Tocca una borsa per creare il riordino già precompilato; 🗄️ la sposta nell'archivio (es. pelle esaurita).</p>
      <div className="card"><div className="list">
        {list.slice(0, 120).map((p) => riga(p, false))}
        {!list.length && <p className="muted center">Nessun prodotto.</p>}
      </div></div>
      {archiviati.length > 0 && (
        <section className="card ask">
          <button className="askhead" type="button" onClick={() => setShowArch((s) => !s)}>🗄️ Archivio riordino · {archiviati.length} <span className="muted">{showArch ? '−' : '+'}</span></button>
          {showArch && (
            <div className="askbody">
              <p className="note">Prodotti messi da parte (pelle/materiale finito). Se il materiale ricompare, ↩︎ li riporta nel riordino.</p>
              <div className="list">{archiviati.map((p) => riga(p, true))}</div>
            </div>
          )}
        </section>
      )}
    </>
  );
}

/* Shopify status of a product → badge (Pubblicato / Esaurito online / In stock da caricare). */
function shopStatus(p: InvFull): { cls: string; label: string } | null {
  if (p.on_shopify) return p.giacenza_attuale > 0 ? { cls: 'pub', label: 'Pubblicato' } : { cls: 'out', label: 'Esaurito online' };
  if (p.giacenza_attuale > 0) return { cls: 'load', label: 'In stock, da caricare' };
  return null;
}
const giaCls = (n: number) => (n < 0 ? 'neg' : n === 0 ? 'zero' : n <= 3 ? 'low' : '');
function Thumb2({ url, label }: { url: string | null; label: string }) {
  return url ? <span className="ds-thumb"><img src={url} alt="" loading="lazy" /></span> : <span className="ds-thumb">{label.slice(0, 2).toUpperCase()}</span>;
}

type Lens = 'giacenza' | 'valore' | 'shopify' | 'negozi';
export default function Inventory({ pin, chi, initial, go }: { pin: string; chi: string; initial?: string; go?: (t: 'registra' | 'ordini', p?: string) => void }) {
  type Tab = 'mag' | 'riordino';
  const [tab, setTab] = useState<Tab>(initial === 'riordino' ? 'riordino' : 'mag');
  const [lens, setLens] = useState<Lens>('giacenza');
  const [inv, setInv] = useState<InvFull[]>([]);
  const [cv, setCv] = useState<CV[]>([]);
  const [q, setQ] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState<InvFull | null>(null);
  const [shopMap, setShopMap] = useState<Map<string, number>>(new Map());
  const [lastSaleMap, setLastSaleMap] = useState<Map<string, { date: string | null; price: number | null }>>(new Map());
  const [nowBusy, setNowBusy] = useState(false);
  const shopQ = (p: InvFull) => shopMap.get(norm(p.codice)) ?? null;

  useEffect(() => {
    fetchInventory().then(setInv).catch((e) => setErr(e.message));
    fetchContoVendita().then(setCv).catch(() => {});
    fetchShopStockMap().then(setShopMap).catch(() => {});
    fetchLastSaleMap().then(setLastSaleMap).catch(() => {});
  }, []);

  // §6bis — giro completo on-demand (azione sync_now già LIVE): pull mirror + push Shopify
  // := disponibili (stessi helper dei cron :17/:27). Cooldown server 45s; rispetta i flag di scrittura.
  async function syncNow() {
    if (nowBusy) return;
    setNowBusy(true);
    try {
      const r = await syncNowShopify(pin, chi);
      if (r.skipped === 'cooldown') toast('Giro appena eseguito: riprova tra qualche secondo.', 'ok');
      else if (r.realign?.skipped) toast('Autopush Shopify disattivato (interruttore server).', 'err');
      else {
        const ra = r.realign;
        const parts = [`${ra?.pushed ?? 0} aggiornati`, `${ra?.ok ?? 0} già ok`];
        if (ra?.failed) parts.push(`${ra.failed} falliti`);
        if (ra?.untracked?.length) parts.push(`${ra.untracked.length} senza tracking`);
        toast(`Shopify sincronizzato: ${parts.join(', ')}.`, ra?.failed ? 'err' : 'ok');
      }
      fetchShopStockMap().then(setShopMap).catch(() => {});
      fetchInventory().then(setInv).catch(() => {});
    } catch (e) { toast((e as Error).message, 'err'); } finally { setNowBusy(false); }
  }

  const alive = useMemo(() => inv.filter((p) => p.giacenza_attuale > 0 || daysSince(p.last_sale) <= 60), [inv]);

  // pannello KPI macro
  const totVal = alive.reduce((s, p) => s + (p.valore || 0), 0);
  const varInStock = inv.filter((p) => p.giacenza_attuale > 0).length;
  const hidden = inv.length - alive.length;
  const pubN = inv.filter((p) => p.on_shopify).length;
  const dispOnline = inv.filter((p) => p.on_shopify && p.giacenza_attuale > 0).length;
  const esauriti = inv.filter((p) => p.on_shopify && p.giacenza_attuale <= 0).length;
  const daCaricare = inv.filter((p) => !p.on_shopify && p.giacenza_attuale > 0).length;
  const magNeg = alive.filter((p) => p.giacenza_attuale < 0).length;

  // lista prodotti secondo la lente attiva (stessa lista, ordinamento/filtro diverso)
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    const match = (p: InvFull) => !s || `${p.item ?? ''} ${p.variant ?? ''} ${p.codice}`.toLowerCase().includes(s);
    const base = (lens === 'shopify' ? inv.filter((p) => p.on_shopify) : alive).filter(match);
    if (lens === 'valore') return [...base].sort((a, b) => (b.valore || 0) - (a.valore || 0));
    if (lens === 'shopify') return [...base].sort((a, b) => (a.giacenza_attuale > 0 ? 1 : 0) - (b.giacenza_attuale > 0 ? 1 : 0) || a.giacenza_attuale - b.giacenza_attuale);
    // giacenza: in stock prima (bassa in cima → arancio ben visibile), esauriti/negativi in fondo
    return [...base].sort((a, b) => (a.giacenza_attuale > 0 ? 0 : 1) - (b.giacenza_attuale > 0 ? 0 : 1) || a.giacenza_attuale - b.giacenza_attuale);
  }, [alive, inv, lens, q]);

  const cvList = useMemo(() => {
    const s = q.trim().toLowerCase();
    return cv.map((r) => {
      const ls = lastSaleMap.get(norm(r.codice));
      return { ...r, last_date: ls?.date ?? null, last_price: ls?.price ?? null };
    }).filter((r) => !s || `${r.item ?? ''} ${r.variant ?? ''} ${r.negozio} ${r.codice}`.toLowerCase().includes(s))
      .sort((a, b) => (b.last_date ?? '').localeCompare(a.last_date ?? ''));
  }, [cv, lastSaleMap, q]);

  if (err) return <div className="screen"><div className="card err">Errore: {err}</div></div>;

  const LENSES: [Lens, string][] = [['giacenza', 'Giacenza'], ['valore', 'Valore'], ['shopify', 'Shopify'], ['negozi', 'Nei negozi']];

  return (
    <div className="screen">
      <header className="invhead">
        <h1>Magazzino</h1>
        <div className="ds-seg">
          <button type="button" className={tab === 'mag' ? 'on' : ''} onClick={() => setTab('mag')}>Magazzino</button>
          <button type="button" className={tab === 'riordino' ? 'on' : ''} onClick={() => setTab('riordino')}>Riordino</button>
        </div>
        <div className="hbtns"><PrintBtn /><ExportBtn name="inventario" rows={() => inv.map((p) => ({ codice: p.codice, prodotto: nome(p.item, p.variant), modello: p.item, variante: p.variant, categoria: p.categoria, magazzino: p.giacenza_attuale, conto_vendita: p.in_conto_vendita, su_shopify: p.on_shopify ? 'si' : 'no', shopify_qty: shopQ(p) ?? '', prezzo: p.retail_price, cogs: p.cogs, valore: p.valore }))} /></div>
      </header>

      {tab === 'mag' && (
        <>
          <div className="ds-macro">
            <div className="mcell">
              <div className="mval">{eur(totVal)}</div>
              <div className="mlab">Valore a magazzino</div>
              <div className="msub">{varInStock} varianti in stock{hidden > 0 ? ` · ${hidden} nascosti` : ''}</div>
            </div>
            <div className="mcell">
              <div className="ds-stgrid">
                <div className="ds-st pub"><div className="v">{pubN}</div><div className="l">Pubblicati</div></div>
                <div className="ds-st ok"><div className="v">{dispOnline}</div><div className="l">Disponibili online</div></div>
                <div className="ds-st out"><div className="v">{esauriti}</div><div className="l">Pubblicati ma esauriti</div></div>
                <div className="ds-st load"><div className="v">{daCaricare}</div><div className="l">In stock, da caricare</div></div>
              </div>
            </div>
          </div>

          <button className="ds-btn primary full" style={{ marginBottom: 6 }} onClick={syncNow} disabled={nowBusy}>
            <Icon name="recycle" size={17} />{nowBusy ? 'Sincronizzo Shopify…' : 'Aggiorna stock Shopify ora'}
          </button>
          <p className="note" style={{ marginBottom: 12 }}>Esegue subito il giro orario completo: legge Shopify e riallinea le quantità allo stock reale. Rispetta gli interruttori di scrittura Shopify.</p>

          {magNeg > 0 && <p className="note">{magNeg} varianti a giacenza negativa (in rosso): vendite senza carico registrato, da sistemare.</p>}

          <div className="ds-search">
            <Icon name="search" size={18} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cerca prodotto…" aria-label="Cerca prodotto" />
          </div>

          <div className="ds-lens">
            <span className="ll">Lente</span>
            {LENSES.map(([k, l]) => <button key={k} type="button" className={`ds-lp ${lens === k ? 'on' : ''}`} onClick={() => setLens(k)}>{l}</button>)}
          </div>

          {lens === 'negozi' ? (
            cvList.length === 0 ? <div className="card muted center">Nessuna merce in conto vendita. Registra un movimento B2B (invio) da Registra ▸ B2B.</div> : (
              cvList.map((r) => (
                <button className="ds-prow" type="button" key={r.negozio + r.codice} onClick={() => go && go('registra', `b2b:${r.negozio}`)}>
                  <Thumb2 url={r.image_url} label={r.item ?? r.codice} />
                  <div className="ds-pinfo">
                    <div className="ds-pn">{nome(r.item, r.variant)}</div>
                    <div className="ds-psub">@ {r.negozio}{r.last_date ? ` · ultima vendita ${r.last_date}` : ' · mai venduto'}</div>
                  </div>
                  <div className="ds-gia"><div className="g">{r.pezzi}</div><div className="gp">pz</div></div>
                </button>
              ))
            )
          ) : (
            <>
              {rows.map((p) => {
                const st = shopStatus(p);
                return (
                  <button type="button" key={p.codice} className="ds-prow" onClick={() => { pushBack(() => setSel(null)); setSel(p); }}>
                    <Thumb2 url={p.image_url} label={p.item ?? p.codice} />
                    <div className="ds-pinfo">
                      <div className="ds-pn">{nome(p.item, p.variant)}</div>
                      {st && <span className={`ds-pbadge ${st.cls}`}>{st.label}</span>}
                    </div>
                    <div className="ds-gia">
                      <div className={`g ${giaCls(p.giacenza_attuale)}`}>{p.giacenza_attuale}</div>
                      <div className="gp">pz</div>
                      <div className="val">{eur(p.valore || 0)}</div>
                    </div>
                  </button>
                );
              })}
              {!rows.length && <p className="muted center">Nessun prodotto.</p>}
            </>
          )}
        </>
      )}

      {tab === 'riordino' && <ReorderView pin={pin} chi={chi} goOrdini={go ? (param) => go('ordini', param) : undefined} />}

      {sel && <ProductDrawer p={sel} shopQty={shopQ(sel)} onClose={() => popBack(() => setSel(null))} go={go} />}
    </div>
  );
}
