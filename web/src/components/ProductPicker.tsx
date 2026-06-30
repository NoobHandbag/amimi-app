import { useEffect, useMemo, useState } from 'react';
import { fetchInventory } from '../lib/api';
import type { Product, InvFull } from '../lib/api';
import { prettyName } from '../lib/helpers';

const daysSince = (iso: string | null) => (iso ? (Date.now() - new Date(iso).getTime()) / 86400000 : Infinity);
// #3: a product is "active" if it has stock OR sold within 90 days; the rest are old.
const isActive = (p: InvFull) => p.giacenza_attuale > 0 || daysSince(p.last_sale) <= 90;
const toProduct = (p: InvFull): Product => ({ codice: p.codice, item: p.item, variant: p.variant, categoria: p.categoria, image_url: p.image_url, retail_price: p.retail_price, cogs: p.cogs });

export default function ProductPicker({ selected, onPick }: { selected: Product | null; onPick: (p: Product | null) => void }) {
  const [all, setAll] = useState<InvFull[]>([]);
  const [q, setQ] = useState('');
  const [showOld, setShowOld] = useState(false);

  useEffect(() => { fetchInventory().then(setAll).catch(() => {}); }, []);

  const { active, old, searching } = useMemo(() => {
    const s = q.trim().toLowerCase();
    const match = (p: InvFull) => !s || `${p.item ?? ''} ${p.variant ?? ''} ${p.codice}`.toLowerCase().includes(s);
    return {
      active: all.filter((p) => isActive(p) && match(p)),
      old: all.filter((p) => !isActive(p) && match(p)),
      searching: s.length > 0,
    };
  }, [all, q]);

  if (selected) {
    return (
      <div className="picked">
        <div className="pimg sm">{selected.image_url ? <img src={selected.image_url} alt="" /> : <span>{(selected.item ?? selected.codice).slice(0, 2)}</span>}</div>
        <div className="pickedtxt"><div className="rt">{prettyName(selected.item, selected.variant, selected.codice)}</div></div>
        <button className="chip" onClick={() => onPick(null)}>cambia</button>
      </div>
    );
  }

  const card = (p: InvFull) => (
    <button key={p.codice} className="pcard" onClick={() => onPick(toProduct(p))} type="button">
      <div className="pimg">{p.image_url ? <img src={p.image_url} alt="" loading="lazy" /> : <span>{(p.item ?? p.codice).slice(0, 2)}</span>}</div>
      <div className="pname">{prettyName(p.item, p.variant, p.codice)}</div>
    </button>
  );

  return (
    <div>
      <input className="search" placeholder="Cerca prodotto…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      <div className="pgrid">{active.slice(0, 60).map(card)}</div>
      {!active.length && !old.length && <p className="muted">Nessun prodotto trovato.</p>}
      {old.length > 0 && (searching ? (
        <>
          <p className="note">Non visti da oltre 90 giorni (senza stock):</p>
          <div className="pgrid">{old.slice(0, 40).map(card)}</div>
        </>
      ) : (
        <>
          <button className="addnew" type="button" onClick={() => setShowOld((v) => !v)}>{showOld ? '− Nascondi' : `Non visti da oltre 90 giorni (${old.length})`}</button>
          {showOld && <div className="pgrid">{old.slice(0, 60).map(card)}</div>}
        </>
      ))}
    </div>
  );
}
