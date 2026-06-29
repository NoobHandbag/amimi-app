import { useState } from 'react';
import NumberStepper from './NumberStepper';
import { addExpense, oggi } from '../lib/api';
import { toast } from '../lib/toast';

const CATS = ['COGS', 'LOGISTICA', 'MARKETING', 'OPEX', 'PACKAGING', 'SALARI', 'TASSE'];

export default function ExpenseForm({ pin, chi, mode, onDone }: {
  pin: string; chi: string; mode: 'expense_manual' | 'expense_propose'; onDone?: () => void;
}) {
  const [operazione, setOp] = useState('');
  const [costo, setCosto] = useState('');
  const [cat, setCat] = useState('OPEX');
  const [data, setData] = useState(oggi());
  const [amimi, setAmimi] = useState(true);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!operazione.trim()) return toast('Descrivi la spesa', 'err');
    if (!(Number(costo) > 0)) return toast('Importo non valido (positivo)', 'err');
    setBusy(true);
    try {
      await addExpense(mode, { operazione, costo: Number(costo), categoria: cat, date_paid: data, amimi: amimi ? 'si' : 'no', note }, pin, chi);
      toast(mode === 'expense_propose' ? 'Proposta inviata, in attesa di approvazione' : 'Spesa registrata', 'ok');
      setOp(''); setCosto(''); setNote('');
      if (onDone) setTimeout(onDone, 700);
    } catch (e) { toast((e as Error).message, 'err'); }
    finally { setBusy(false); }
  }

  return (
    <div className="form">
      <label className="fl">Descrizione</label>
      <input className="txt" value={operazione} onChange={(e) => setOp(e.target.value)} placeholder="es. Meta Ads, materiale, spedizione" />

      <div className="grid2">
        <div><label className="fl">Importo € (IVA incl.)</label><NumberStepper value={costo} onChange={setCosto} decimal step={5} placeholder="0,00" /></div>
        <div><label className="fl">Data</label>
          <input className="num" type="date" value={data} onChange={(e) => setData(e.target.value)} /></div>
      </div>

      <label className="fl">Categoria</label>
      <div className="supgrid">
        {CATS.map((c) => <button key={c} type="button" className={`supcard ${cat === c ? 'on' : ''}`} onClick={() => setCat(c)}>{c}</button>)}
      </div>

      <label className="fl">Imputazione</label>
      <div className="seg">
        <button className={amimi ? 'on' : ''} onClick={() => setAmimi(true)}>Amimì</button>
        <button className={!amimi ? 'on' : ''} onClick={() => setAmimi(false)}>Altro / Totale</button>
      </div>

      <label className="fl">Note (opzionale)</label>
      <input className="txt" value={note} onChange={(e) => setNote(e.target.value)} placeholder="—" />

      <button className="submit" disabled={busy} onClick={submit}>
        {busy ? 'Salvo…' : mode === 'expense_propose' ? 'Proponi spesa' : 'Registra spesa'}
      </button>
    </div>
  );
}
