import { useEffect, useState } from 'react';
import SupplierOrderForm from '../components/SupplierOrderForm';
import { fetchOrdiniGruppi, writeApi, oggi } from '../lib/api';
import type { OrdGruppo, OrdLine } from '../lib/api';

function ArrivoRow({ l, pin, chi, reload }: { l: OrdLine; pin: string; chi: string; reload: () => void }) {
  const [open, setOpen] = useState(false);
  const [n, setN] = useState(String(l.mancano));
  const [d, setD] = useState(oggi());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const done = l.completo;

  async function arrivo() {
    if (!(Number(n) > 0)) return setErr('Quante?');
    setBusy(true); setErr(null);
    try { await writeApi('arrival', { order_id: l.id, qty: Number(n), data: d }, pin, chi); reload(); }
    catch (e) { setErr((e as Error).message); setBusy(false); }
  }

  return (
    <div className={`linerow ${done ? 'done' : ''}`}>
      <div className="lineinfo">
        {l.image_url ? <img className="invimg sm" src={l.image_url} alt="" /> : <div className="invimg sm ph">{(l.item ?? l.codice).slice(0, 2)}</div>}
        <div>
          <div className="rt">{l.item ?? l.codice} <span className="rs">{l.variant ?? (l.codice.endsWith('_') ? '· da definire' : '')}</span></div>
          <div className="ordnums">{done ? '✓ completo' : <><b>{l.mancano}</b> mancano</>} · {l.qty_arrived}/{l.qty_ordered}{l.nuovo_riordino ? ` · ${l.nuovo_riordino}` : ''}</div>
        </div>
      </div>
      {!done && (!open ? (
        <button className="chip" onClick={() => setOpen(true)}>arrivo</button>
      ) : (
        <div className="arrinline">
          <input className="qbox" type="number" inputMode="numeric" value={n} onChange={(e) => setN(e.target.value)} autoFocus />
          <input className="dbox" type="date" value={d} onChange={(e) => setD(e.target.value)} />
          <button className="submit small" disabled={busy} onClick={arrivo}>{busy ? '…' : 'ok'}</button>
        </div>
      ))}
      {err && <div className="msg err">{err}</div>}
    </div>
  );
}

function GruppoCard({ g, pin, chi, reload }: { g: OrdGruppo; pin: string; chi: string; reload: () => void }) {
  return (
    <div className="ordcard">
      <div className="grphead">
        <div className="rt">{g.fornitore ?? '—'}</div>
        <div className="rs">{g.data_ordine ?? ''} · {g.righe.length} borse · <b>{g.mancano}</b> in arrivo</div>
      </div>
      {g.righe.map((l) => <ArrivoRow key={l.id} l={l} pin={pin} chi={chi} reload={reload} />)}
    </div>
  );
}

export default function Arrivi({ pin, chi, setChi }: { pin: string; chi: string; setChi: (c: string) => void }) {
  const [grp, setGrp] = useState<OrdGruppo[]>([]);
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // load only fetches; it must NOT touch `adding` or the mount fetch resolving would snap the
  // order form shut if the user opened it before orders finished loading.
  const load = () => { fetchOrdiniGruppi().then(setGrp).catch((e) => setErr(e.message)); };
  useEffect(load, []);

  const open = grp.filter((g) => !g.completo);
  if (err) return <div className="screen"><div className="card err">Errore: {err}</div></div>;

  return (
    <div className="screen">
      <header>
        <h1>In arrivo</h1>
        <div className="seg wrap">
          {['Ale', 'Bene', 'Ginevra', 'Dan'].map((c) => <button key={c} className={chi === c ? 'on' : ''} onClick={() => setChi(c)}>{c}</button>)}
        </div>
      </header>

      <button className="bigadd" onClick={() => setAdding((a) => !a)}>{adding ? '✕ Chiudi' : '+ Nuovo ordine fornitore'}</button>

      {adding ? (
        <SupplierOrderForm pin={pin} chi={chi} onDone={() => { setAdding(false); load(); }} />
      ) : (
        <>
          {open.length === 0 && <div className="card muted center">Nessun ordine in arrivo. Tocca “+ Nuovo ordine fornitore”.</div>}
          {open.map((g) => <GruppoCard key={g.gruppo} g={g} pin={pin} chi={chi} reload={load} />)}
        </>
      )}
    </div>
  );
}
