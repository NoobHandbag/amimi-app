import { useEffect, useState } from 'react';
import { fetchRecent } from '../lib/api';
import type { Activity } from '../lib/api';

const META: Record<string, [string, string]> = {
  purchases: ['📦', 'Arrivo'], counts: ['🔢', 'Conta'], gifts_offline: ['🎁', 'Regalo'],
  b2b_movements: ['🏬', 'B2B'], products: ['🏷️', 'Prodotto'],
};
function ago(ts: string) {
  const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60) return 'ora';
  if (s < 3600) return `${Math.floor(s / 60)}m fa`;
  if (s < 86400) return `${Math.floor(s / 3600)}h fa`;
  return `${Math.floor(s / 86400)}g fa`;
}

export default function RecentFeed() {
  const [rows, setRows] = useState<Activity[]>([]);
  useEffect(() => { fetchRecent().then(setRows).catch(() => {}); }, []);
  if (!rows.length) return null;
  return (
    <div className="card" style={{ marginTop: 14 }}>
      <h2>Ultimi inserimenti</h2>
      <div className="list">
        {rows.map((r) => {
          const m = META[r.tbl] ?? ['•', r.tbl];
          return (
            <div className="row" key={r.id}>
              <div>
                <div className="rt">{m[0]} {m[1]}</div>
                <div className="rs">{r.codice ?? ''}{r.chi ? ' · ' + r.chi : ''}</div>
              </div>
              <div className="rs">{ago(r.ts)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
