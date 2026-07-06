import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

// Banner "salute contabile": rende VISIBILE nell'app cio' che prima finiva solo in health_log
// (che nessuno guardava). Legge i detector strutturali live (v_health, severity 'bad') + l'ultimo
// giro di ce-guard (health_log chiavi ce_*, severity 'error'). Se tutto ok, non mostra nulla.
// Audit 2026-07-06: la tesi anti-fallimento-silenzioso era sconfitta perche' l'allarme non
// raggiungeva nessuno schermo. Questo e' lo schermo.

type Chk = { k: string; label: string; n: number; severity: string };

export default function HealthBanner() {
  const [items, setItems] = useState<Chk[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    (async () => {
      const [vh, hl] = await Promise.all([
        supabase.from('v_health').select('k,label,n,severity'),
        supabase.from('health_log').select('k,label,n,severity,day').like('k', 'ce_%').order('day', { ascending: false }).limit(30),
      ]);
      const bad = ((vh.data ?? []) as Chk[]).filter((r) => r.severity === 'bad');
      const logs = (hl.data ?? []) as (Chk & { day: string })[];
      const lastDay = logs.length ? logs[0].day : null;
      const ceErr = logs.filter((r) => r.day === lastDay && r.severity === 'error');
      // v_health.ce_drift_live e ce-guard.ce_drift_mesi_chiusi coprono lo stesso fatto: tieni solo uno.
      const filteredCe = ceErr.filter((r) => !(r.k === 'ce_drift_mesi_chiusi' && bad.some((b) => b.k === 'ce_drift_live')));
      setItems([...bad, ...filteredCe]);
    })();
  }, []);

  if (!items.length) return null;

  return (
    <div
      style={{
        background: 'rgba(200,60,70,.10)', border: '1px solid var(--red, #c83c46)',
        borderRadius: 12, padding: '10px 12px', marginBottom: 14, color: 'var(--red, #c83c46)',
      }}
    >
      <button
        type="button" onClick={() => setOpen((v) => !v)}
        style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'inherit', fontWeight: 800, fontSize: 15, textAlign: 'left' }}
      >
        <span aria-hidden>⚠</span>
        <span>{items.length} {items.length === 1 ? 'controllo contabile da vedere' : 'controlli contabili da vedere'}</span>
        <span style={{ marginLeft: 'auto', opacity: .8 }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <ul style={{ margin: '10px 0 2px', paddingLeft: 18, color: 'var(--dark, #2d2226)', fontSize: 13.5, lineHeight: 1.5 }}>
          {items.map((r) => (
            <li key={r.k}><strong>{r.n}</strong> · {r.label}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
