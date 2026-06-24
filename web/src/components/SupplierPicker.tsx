import { useEffect, useState } from 'react';
import { fetchSuppliers } from '../lib/api';
import type { Supplier } from '../lib/api';

export default function SupplierPicker({ value, onChange }: { value: string; onChange: (s: string) => void }) {
  const [sup, setSup] = useState<Supplier[]>([]);
  const [other, setOther] = useState(false);

  useEffect(() => { fetchSuppliers().then(setSup).catch(() => {}); }, []);

  if (other) {
    return <input className="txt" placeholder="Nome fornitore" value={value} onChange={(e) => onChange(e.target.value)} autoFocus />;
  }
  return (
    <div className="supgrid">
      {sup.map((s) => (
        <button key={s.name} type="button" className={`supcard ${value === s.name ? 'on' : ''}`} onClick={() => onChange(s.name)}>
          {s.name}
        </button>
      ))}
      <button type="button" className="supcard alt" onClick={() => { setOther(true); onChange(''); }}>+ altro</button>
    </div>
  );
}
