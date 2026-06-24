import { useEffect, useMemo, useState } from 'react';
import { fetchInventory } from '../lib/api';
import type { InvFull } from '../lib/api';

const eur = (n: number) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n || 0);
const FILTERS: [string, string][] = [['tutti', 'Tutti'], ['riordino', 'Da riordinare'], ['scorta', 'Esauriti'], ['conto', 'In negozio']];

export default function Inventory() {
  const [inv, setInv] = useState<InvFull[]>([]);
  const [q, setQ] = useState('');
  const [f, setF] = useState('tutti');
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { fetchInventory().then(setInv).catch((e) => setErr(e.message)); }, []);

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    let r = inv.filter((p) => !s || `${p.item ?? ''} ${p.variant ?? ''} ${p.codice}`.toLowerCase().includes(s));
    if (f === 'riordino') r = r.filter((p) => p.giacenza_attuale <= 3);
    else if (f === 'scorta') r = r.filter((p) => p.giacenza_attuale <= 0);
    else if (f === 'conto') r = r.filter((p) => p.in_conto_vendita > 0);
    return r.slice(0, 250);
  }, [inv, q, f]);

  const totVal = inv.reduce((s, p) => s + (p.valore || 0), 0);
  const esaurito = inv.filter((p) => p.giacenza_attuale <= 0).length;

  if (err) return <div className="screen"><div className="card err">Errore: {err}</div></div>;

  return (
    <div className="screen">
      <header><h1>Inventario</h1><span className="badge">{inv.length} prodotti</span></header>
      <div className="kpis">
        <div className="kpi accent"><div className="v">{eur(totVal)}</div><div className="k">Valore magazzino</div></div>
        <div className="kpi red"><div className="v">{esaurito}</div><div className="k">Esauriti</div></div>
      </div>
      <input className="search" placeholder="Cerca prodotto…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="filters">
        {FILTERS.map(([k, l]) => <button key={k} type="button" className={`fchip ${f === k ? 'on' : ''}`} onClick={() => setF(k)}>{l}</button>)}
      </div>
      <div className="card">
        <div className="list">
          {list.map((p) => (
            <div className="row" key={p.codice}>
              <div>
                <div className="rt">{p.item ?? p.codice}</div>
                <div className="rs">{p.variant ?? ''}{p.in_conto_vendita > 0 ? ` · ${p.in_conto_vendita} in negozio` : ''}</div>
              </div>
              <div className={`giac ${p.giacenza_attuale <= 0 ? 'neg' : ''}`}>{p.giacenza_attuale}</div>
            </div>
          ))}
          {!list.length && <p className="muted center">Nessun prodotto.</p>}
        </div>
      </div>
    </div>
  );
}
