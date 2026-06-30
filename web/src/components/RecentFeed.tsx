import { useEffect, useState } from 'react';
import { fetchRecent } from '../lib/api';
import type { Activity } from '../lib/api';

const META: Record<string, [string, string]> = {
  purchases: ['📦', 'Arrivo'], counts: ['🔢', 'Conta'], gifts_offline: ['🎁', 'Regalo'],
  b2b_movements: ['🏬', 'B2B'], products: ['🏷️', 'Prodotto'],
  supplier_orders: ['📦', 'Ordine fornitore'], expenses: ['💶', 'Spesa'], returns: ['↩️', 'Reso'],
  qromo_sales: ['🏬', 'Vendita Qromo'], shopify_orders: ['🌐', 'Ordine online'], shopify_line_items: ['🌐', 'Ordine online'],
};
// raw automation authors → friendly labels
const CHI: Record<string, string> = { 'qromo-forward': 'Qromo (auto)', 'shopify-sync': 'Shopify (auto)' };
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
          const m = META[r.tbl] ?? ['•', r.tbl.replace(/_/g, ' ')];
          return (
            <div className="row" key={r.id}>
              <div>
                <div className="rt">{m[0]} {m[1]}</div>
                <div className="rs">{r.codice ?? ''}{r.chi ? ' · ' + (CHI[r.chi] ?? r.chi) : ''}</div>
              </div>
              <div className="rs">{ago(r.ts)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
