import { useEffect, useMemo, useState } from 'react';
import { fetchInventory } from '../lib/api';
import type { Product, InvFull } from '../lib/api';
import { prettyName } from '../lib/helpers';
import Icon from './Icon';

const daysSince = (iso: string | null) => (iso ? (Date.now() - new Date(iso).getTime()) / 86400000 : Infinity);
// #3: a product is "active" if it has stock OR sold within 90 days; the rest are old.
const isActive = (p: InvFull) => p.giacenza_attuale > 0 || daysSince(p.last_sale) <= 90;
const toProduct = (p: InvFull): Product => ({ codice: p.codice, item: p.item, variant: p.variant, categoria: p.categoria, image_url: p.image_url, retail_price: p.retail_price, cogs: p.cogs });
const lineOf = (p: InvFull) => (p.item ?? p.codice).trim().split(/[\s_]/)[0];
const initials = (s: string) => s.slice(0, 2).toUpperCase();
const titleCase = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s);

export default function ProductPicker({ selected, onPick }: { selected: Product | null; onPick: (p: Product | null) => void }) {
  const [all, setAll] = useState<InvFull[]>([]);
  const [q, setQ] = useState('');
  const [line, setLine] = useState('');
  const [showOld, setShowOld] = useState(false);

  useEffect(() => { fetchInventory().then(setAll).catch(() => {}); }, []);

  // linee (per il filtro) ordinate per numero di prodotti attivi
  const lines = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of all.filter(isActive)) m.set(lineOf(p), (m.get(lineOf(p)) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k]) => k);
  }, [all]);

  const { active, old, searching } = useMemo(() => {
    const s = q.trim().toLowerCase();
    const match = (p: InvFull) => (!s || `${p.item ?? ''} ${p.variant ?? ''} ${p.codice}`.toLowerCase().includes(s)) && (!line || lineOf(p) === line);
    return {
      active: all.filter((p) => isActive(p) && match(p)).sort((a, b) => b.giacenza_attuale - a.giacenza_attuale), // in stock prima
      old: all.filter((p) => !isActive(p) && match(p)),
      searching: s.length > 0,
    };
  }, [all, q, line]);

  if (selected) {
    return (
      <div className="ds-picked">
        <span className="ds-picked-img">{selected.image_url ? <img src={selected.image_url} alt="" /> : initials(selected.item ?? selected.codice)}</span>
        <div className="ds-picked-txt">{prettyName(selected.item, selected.variant, selected.codice)}</div>
        <button className="ds-btn secondary" style={{ minHeight: 36, padding: '7px 14px', fontSize: 13 }} onClick={() => onPick(null)} type="button">Cambia</button>
      </div>
    );
  }

  const giaCls = (n: number) => (n <= 0 ? 'zero' : n <= 3 ? 'low' : '');
  const card = (p: InvFull) => (
    <button key={p.codice} className="ds-pcard" onClick={() => onPick(toProduct(p))} type="button">
      <div className="ds-pcard-img">{p.image_url ? <img src={p.image_url} alt="" loading="lazy" /> : initials(p.item ?? p.codice)}</div>
      <div className="ds-pcard-nm">{prettyName(p.item, p.variant, p.codice)}</div>
      <span className={`ds-pcard-gia ${giaCls(p.giacenza_attuale)}`}>{p.giacenza_attuale} pz</span>
    </button>
  );

  return (
    <div>
      <div className="ds-search">
        <Icon name="search" size={18} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cerca prodotto…" aria-label="Cerca prodotto" autoFocus />
      </div>
      {lines.length > 1 && (
        <div className="ds-linefilters">
          <button type="button" className={`ds-fp ${line === '' ? 'on' : ''}`} onClick={() => setLine('')}>Tutte</button>
          {lines.map((l) => <button key={l} type="button" className={`ds-fp ${line === l ? 'on' : ''}`} onClick={() => setLine(line === l ? '' : l)}>{titleCase(l)}</button>)}
        </div>
      )}
      <div className="ds-pgrid">{active.slice(0, 60).map(card)}</div>
      {!active.length && !old.length && <p className="muted">Nessun prodotto trovato.</p>}
      {old.length > 0 && (searching ? (
        <>
          <p className="note">Non visti da oltre 90 giorni (senza stock):</p>
          <div className="ds-pgrid">{old.slice(0, 40).map(card)}</div>
        </>
      ) : (
        <>
          <button className="addnew" type="button" onClick={() => setShowOld((v) => !v)}>{showOld ? '− Nascondi' : `Non visti da oltre 90 giorni (${old.length})`}</button>
          {showOld && <div className="ds-pgrid">{old.slice(0, 60).map(card)}</div>}
        </>
      ))}
    </div>
  );
}
