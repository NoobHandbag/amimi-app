import { useEffect, useState } from 'react';
import ExpenseForm from './ExpenseForm';
import { fetchExpensesReview, approveExpense } from '../lib/api';
import type { ExpReview } from '../lib/api';

const eur = (n: number) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(n || 0);
const CATS = ['COGS', 'LOGISTICA', 'MARKETING', 'OPEX', 'PACKAGING', 'SALARI', 'TASSE', 'EVENTI'];
const MESI = ['', 'Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];

/** Trasforma la nota alla conferma SENZA perdere lo storico:
 *  "DA VERIFICARE (carburante ENI)" -> "VERIFICATO (carburante ENI)". */
const confirmNote = (note: string | null) => (note ? note.replace(/da verificare/i, 'VERIFICATO') : 'VERIFICATO');

/** Maschera spese: aggiunta diretta + CODA DI REVISIONE (proposte pending + storiche
 *  "DA VERIFICARE" dal task estratto conto). Ale/Benedetta leggono tutte le info,
 *  confermano il suggerimento o ricodificano con i dropdown. Le note restano per storico. */
export default function SpeseManage({ pin, chi }: { pin: string; chi: string }) {
  const [list, setList] = useState<ExpReview[]>([]);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  // edit locali per riga (dropdown/toggle prima della conferma)
  const [edits, setEdits] = useState<Record<string, { categoria: string; sottocategoria: string; amimi: boolean }>>({});
  const load = () => fetchExpensesReview().then(setList).catch(() => {});
  useEffect(() => { load(); }, []);

  const edited = (e: ExpReview) => edits[e.id] ?? {
    categoria: e.categoria || 'OPEX',
    sottocategoria: e.sottocategoria || '',
    amimi: !!e.amimi,
  };
  const setEdit = (id: string, patch: Partial<{ categoria: string; sottocategoria: string; amimi: boolean }>) =>
    setEdits((m) => {
      const row = list.find((x) => x.id === id);
      const base = m[id] ?? (row ? { categoria: row.categoria || 'OPEX', sottocategoria: row.sottocategoria || '', amimi: !!row.amimi } : { categoria: 'OPEX', sottocategoria: '', amimi: false });
      return { ...m, [id]: { ...base, ...patch } };
    });

  async function confirm(e: ExpReview) {
    const v = edited(e);
    const ricodificata = v.categoria !== (e.categoria || 'OPEX');
    let note = confirmNote(e.note);
    if (ricodificata) note += ` · ricodificata ${e.categoria || '?'}→${v.categoria} da ${chi}`;
    setBusy(e.id);
    try {
      await approveExpense(e.id, 'approved', {
        categoria: v.categoria,
        sottocategoria: v.sottocategoria || null,
        amimi: v.amimi ? 'si' : 'No',
        note,
      }, pin, chi);
      setEdits((m) => { const n = { ...m }; delete n[e.id]; return n; });
      load();
    } finally { setBusy(null); }
  }

  async function reject(e: ExpReview) {
    setBusy(e.id);
    try { await approveExpense(e.id, 'rejected', { note: (e.note ? e.note + ' · ' : '') + `rifiutata da ${chi}` }, pin, chi); load(); } finally { setBusy(null); }
  }

  return (
    <div>
      <button className="bigadd" onClick={() => setAdding((a) => !a)}>{adding ? '✕ Chiudi' : '+ Aggiungi spesa'}</button>
      {adding && <ExpenseForm pin={pin} chi={chi} mode="expense_manual" onDone={() => { setAdding(false); load(); }} />}
      {!list.length ? (
        <div className="card muted center">Nessuna spesa da verificare. ✨</div>
      ) : (
        <div className="list">
          <p className="note"><b>{list.length}</b> spese da verificare · conferma il suggerimento o ricodifica. Le note restano per storico.</p>
          {list.map((e) => {
            const v = edited(e);
            const changed = v.categoria !== (e.categoria || 'OPEX') || (v.sottocategoria || '') !== (e.sottocategoria || '') || v.amimi !== !!e.amimi;
            return (
              <div className="card" key={e.id} style={{ marginBottom: 10, padding: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
                  <b style={{ fontSize: 15 }}>{eur(Math.abs(e.costo))}</b>
                  <span className="muted" style={{ fontSize: 12 }}>{MESI[e.month] || ''} {e.year}{e.date_paid ? ` · ${e.date_paid}` : ''}{e.status === 'pending' ? ' · proposta' : ''}</span>
                </div>
                <div style={{ fontSize: 13, margin: '6px 0', wordBreak: 'break-word' }}>{e.operazione}</div>
                {e.note && <div style={{ fontSize: 12, background: 'rgba(196,149,106,.12)', borderRadius: 8, padding: '6px 8px', margin: '6px 0' }}>📝 {e.note}</div>}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', margin: '8px 0' }}>
                  <select value={v.categoria} onChange={(ev) => setEdit(e.id, { categoria: ev.target.value })} style={{ padding: '6px 8px', borderRadius: 8 }}>
                    {CATS.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <input value={v.sottocategoria} placeholder="sottocategoria" onChange={(ev) => setEdit(e.id, { sottocategoria: ev.target.value })}
                    style={{ padding: '6px 8px', borderRadius: 8, width: 130 }} />
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
                    <input type="checkbox" checked={v.amimi} onChange={(ev) => setEdit(e.id, { amimi: ev.target.checked })} /> Amimì
                  </label>
                </div>
                {v.categoria === 'LOGISTICA' && <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}>ℹ️ sottocategoria "Spedizioni" = costo variabile nel CE, altrimenti logistica fissa</div>}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="ok" disabled={busy === e.id} onClick={() => confirm(e)} style={{ flex: 1 }}>
                    {changed ? '💾 Salva ricodifica' : '✓ Conferma'}
                  </button>
                  {e.status === 'pending' && (
                    <button className="no" disabled={busy === e.id} onClick={() => reject(e)}>✕ Rifiuta</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
