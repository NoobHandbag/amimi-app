import { useEffect, useMemo, useState } from 'react';
import { fetchInventory, fetchContoVendita } from '../lib/api';
import type { InvFull, CV } from '../lib/api';

const eur = (n: number) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n || 0);
const daysSince = (iso: string | null) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : Infinity);
const FILTERS: [string, string][] = [['attivi', 'Attivi'], ['riordino', 'Da riordinare'], ['esauriti', 'Esauriti'], ['online', 'Su Shopify']];

function Tile({ url, label }: { url: string | null; label: string }) {
  return url ? <img className="invimg" src={url} alt="" loading="lazy" /> : <div className="invimg ph">{label.slice(0, 2)}</div>;
}

export default function Inventory() {
  const [view, setView] = useState<'mag' | 'neg'>('mag');
  const [inv, setInv] = useState<InvFull[]>([]);
  const [cv, setCv] = useState<CV[]>([]);
  const [q, setQ] = useState('');
  const [f, setF] = useState('attivi');
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetchInventory().then(setInv).catch((e) => setErr(e.message));
    fetchContoVendita().then(setCv).catch(() => {});
  }, []);

  // dead stock: hide products with no stock AND last sale older than 60 days (or never sold)
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
        <div className="seg">
          <button className={view === 'mag' ? 'on' : ''} onClick={() => setView('mag')}>Magazzino</button>
          <button className={view === 'neg' ? 'on' : ''} onClick={() => setView('neg')}>Nei negozi</button>
        </div>
      </header>

      {view === 'mag' ? (
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
      ) : (
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
    </div>
  );
}
