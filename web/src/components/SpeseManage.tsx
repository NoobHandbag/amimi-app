import { useEffect, useState } from 'react';
import ExpenseForm from './ExpenseForm';
import { fetchExpensesPending, approveExpense } from '../lib/api';
import type { ExpPending } from '../lib/api';

const eur = (n: number) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n || 0);

/** One place for expenses: add a direct expense + approve/reject anything proposed (e.g. via MCP). */
export default function SpeseManage({ pin, chi }: { pin: string; chi: string }) {
  const [list, setList] = useState<ExpPending[]>([]);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const load = () => fetchExpensesPending().then(setList).catch(() => {});
  useEffect(() => { load(); }, []);

  async function decide(id: string, status: 'approved' | 'rejected') {
    setBusy(id);
    try { await approveExpense(id, status, null, pin, chi); load(); } finally { setBusy(null); }
  }

  return (
    <div>
      <button className="bigadd" onClick={() => setAdding((a) => !a)}>{adding ? '✕ Chiudi' : '+ Aggiungi spesa'}</button>
      {adding && <ExpenseForm pin={pin} chi={chi} mode="expense_manual" onDone={() => { setAdding(false); load(); }} />}
      {!list.length ? (
        <div className="card muted center">Nessuna spesa in attesa di approvazione.</div>
      ) : (
        <div className="list">
          <p className="note">{list.length} spese proposte da approvare.</p>
          {list.map((e) => (
            <div className="exprow" key={e.id}>
              <div className="expinfo">
                <div className="rt">{e.operazione} · <b>{eur(Math.abs(e.costo))}</b></div>
                <div className="rs">{e.categoria}{e.amimi ? ' · Amimì' : ' · Altro'}{e.proposed_by ? ` · da ${e.proposed_by}` : ''}{e.date_paid ? ` · ${e.date_paid}` : ''}</div>
              </div>
              <div className="expbtns">
                <button className="ok" disabled={busy === e.id} onClick={() => decide(e.id, 'approved')}>✓</button>
                <button className="no" disabled={busy === e.id} onClick={() => decide(e.id, 'rejected')}>✕</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
