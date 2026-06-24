import { useEffect, useMemo, useState } from 'react';
import { fetchProducts } from '../lib/api';
import type { Product } from '../lib/api';

export default function ProductPicker({ selected, onPick }: { selected: Product | null; onPick: (p: Product | null) => void }) {
  const [all, setAll] = useState<Product[]>([]);
  const [q, setQ] = useState('');

  useEffect(() => { fetchProducts().then(setAll).catch(() => {}); }, []);

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    const base = s
      ? all.filter((p) => `${p.item ?? ''} ${p.variant ?? ''} ${p.codice}`.toLowerCase().includes(s))
      : all;
    return base.slice(0, 48);
  }, [all, q]);

  if (selected) {
    return (
      <div className="picked">
        <div className="pimg sm">{selected.image_url ? <img src={selected.image_url} alt="" /> : <span>{(selected.item ?? selected.codice).slice(0, 2)}</span>}</div>
        <div className="pickedtxt">
          <div className="rt">{selected.item ?? selected.codice}</div>
          <div className="rs">{selected.variant ?? ''}</div>
        </div>
        <button className="chip" onClick={() => onPick(null)}>cambia</button>
      </div>
    );
  }

  return (
    <div>
      <input className="search" placeholder="Cerca prodotto…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      <div className="pgrid">
        {list.map((p) => (
          <button key={p.codice} className="pcard" onClick={() => onPick(p)} type="button">
            <div className="pimg">{p.image_url ? <img src={p.image_url} alt="" loading="lazy" /> : <span>{(p.item ?? p.codice).slice(0, 2)}</span>}</div>
            <div className="pname">{p.item ?? p.codice}</div>
            <div className="pvar">{p.variant ?? ''}</div>
          </button>
        ))}
        {!list.length && <p className="muted">Nessun prodotto trovato.</p>}
      </div>
    </div>
  );
}
