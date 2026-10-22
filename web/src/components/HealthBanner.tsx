import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import Icon from './Icon';

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

  // tema A (Home, 22-10): avviso pieno in tinta rossa, intestazione .askhead di shell.css con la freccia che ruota,
  // un controllo per riga col conteggio a destra. Lo stile sta in styles/screens/home.css (.scr-home .hb): lo usa solo la Home
  return (
    <div className="hb">
      <button type="button" className="askhead" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span>{items.length} {items.length === 1 ? 'controllo contabile da vedere' : 'controlli contabili da vedere'}</span>
        <Icon name="chevron" size={18} />
      </button>
      {open && (
        <ul className="hb-list" role="list">
          {items.map((r) => (
            <li key={r.k}><span>{r.label}</span><b>{r.n}</b></li>
          ))}
        </ul>
      )}
    </div>
  );
}
