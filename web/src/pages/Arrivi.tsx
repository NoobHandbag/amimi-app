import { useEffect, useState } from 'react';
import OrderForm from '../components/OrderForm';
import { fetchOrdiniArrivo, writeApi } from '../lib/api';
import type { Ordine } from '../lib/api';

function OrderCard({ o, pin, chi, reload }: { o: Ordine; pin: string; chi: string; reload: () => void }) {
  const [open, setOpen] = useState(false);
  const [n, setN] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function arrivo() {
    if (!(Number(n) > 0)) return setErr('Quante?');
    setBusy(true); setErr(null);
    try { await writeApi('arrival', { order_id: o.id, qty: Number(n) }, pin, chi); reload(); }
    catch (e) { setErr((e as Error).message); setBusy(false); }
  }

  return (
    <div className="ordcard">
      <div className="ordhead">
        {o.image_url ? <img className="invimg" src={o.image_url} alt="" /> : <div className="invimg ph">{(o.item ?? o.codice).slice(0, 2)}</div>}
        <div className="ordinfo">
          <div className="rt">{o.item ?? o.codice} {o.variant ?? ''}</div>
          <div className="rs">{o.fornitore ?? '—'}</div>
          <div className="ordnums"><b>{o.mancano}</b> mancano · {o.qty_arrived}/{o.qty_ordered} arrivate</div>
        </div>
      </div>
      {!open ? (
        <button className="arrbtn" onClick={() => setOpen(true)}>Segna arrivo</button>
      ) : (
        <div className="arrrow">
          <input className="num" type="number" inputMode="numeric" placeholder="quante?" value={n} onChange={(e) => setN(e.target.value)} autoFocus />
          <button className="submit small" disabled={busy} onClick={arrivo}>{busy ? '…' : 'Conferma'}</button>
        </div>
      )}
      {err && <div className="msg err">{err}</div>}
    </div>
  );
}

export default function Arrivi({ pin, chi, setChi }: {
  pin: string; chi: string; setChi: (c: string) => void;
}) {
  const [ord, setOrd] = useState<Ordine[]>([]);
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = () => { fetchOrdiniArrivo().then((o) => { setOrd(o); setAdding(false); }).catch((e) => setErr(e.message)); };
  useEffect(load, []);

  const open = ord.filter((o) => !o.completo);
  if (err) return <div className="screen"><div className="card err">Errore: {err}</div></div>;

  return (
    <div className="screen">
      <header>
        <h1>In arrivo</h1>
        <div className="seg wrap">
          {['Ale', 'Bene', 'Ginevra', 'Dan'].map((c) => <button key={c} className={chi === c ? 'on' : ''} onClick={() => setChi(c)}>{c}</button>)}
        </div>
      </header>

      <button className="bigadd" onClick={() => setAdding((a) => !a)}>{adding ? '✕ Chiudi' : '+ Nuovo ordine'}</button>

      {adding ? (
        <OrderForm pin={pin} chi={chi} onDone={load} />
      ) : (
        <>
          {open.length === 0 && <div className="card muted center">Nessun ordine in arrivo. Tocca “+ Nuovo ordine” per segnarne uno.</div>}
          {open.map((o) => <OrderCard key={o.id} o={o} pin={pin} chi={chi} reload={load} />)}
        </>
      )}
    </div>
  );
}
