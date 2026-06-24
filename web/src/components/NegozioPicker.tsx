import { useEffect, useState } from 'react';
import { fetchNegozi } from '../lib/api';

export default function NegozioPicker({ value, onChange }: { value: string; onChange: (s: string) => void }) {
  const [neg, setNeg] = useState<string[]>([]);
  const [other, setOther] = useState(false);

  useEffect(() => { fetchNegozi().then(setNeg).catch(() => {}); }, []);

  if (other) {
    return <input className="txt" placeholder="Nome negozio" value={value} onChange={(e) => onChange(e.target.value)} autoFocus />;
  }
  return (
    <div className="supgrid">
      {neg.map((n) => (
        <button key={n} type="button" className={`supcard ${value === n ? 'on' : ''}`} onClick={() => onChange(n)}>{n}</button>
      ))}
      <button type="button" className="supcard alt" onClick={() => { setOther(true); onChange(''); }}>+ altro</button>
    </div>
  );
}
