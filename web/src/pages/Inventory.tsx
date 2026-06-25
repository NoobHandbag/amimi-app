import { useEffect, useMemo, useState } from 'react';
import { fetchInventory, fetchContoVendita, fetchShopifyAlign, syncShopifyStock, realignShopify } from '../lib/api';
import type { InvFull, CV, ShopAlign } from '../lib/api';

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

export default function Inventory({ pin, chi }: { pin: string; chi: string }) {
  const [view, setView] = useState<'mag' | 'neg' | 'shop'>('mag');
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
          <button className={view === 'neg' ? 'on' : ''} onClick={() => setView('neg')}>Nei negozi</button>
          <button className={view === 'shop' ? 'on' : ''} onClick={() => setView('shop')}>Shopify</button>
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

      {view === 'neg' && (
        <>
          {byStore.length === 0 && <div className="card muted center">Nessuna merce in conto vendita. Registra un movimento B2B (invio) dalla sezione Inserisci.</div>}
          {byStore.map(([store, items]) => (
            <section className="card" key={store}>
              <h2>{store} · {items.reduce((s, i) => s + i.pezzi, 0)} pezzi</h2>
              <div className="list">
                {items.map((i) => (
                  <div className="row" key={i.codice}>
                    <div className="invleft">
                      <Tile url={i.image_url} label={i.item ?? i.codice} />
                      <div><div className="rt">{i.item ?? i.codice}</div><div className="rs">{i.variant ?? ''}</div></div>
                    </div>
                    <div className="giac">{i.pezzi}</div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </>
      )}

      {view === 'shop' && <ShopView pin={pin} chi={chi} />}
    </div>
  );
}
