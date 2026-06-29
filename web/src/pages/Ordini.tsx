import { useEffect, useMemo, useState } from 'react';
import SupplierOrderForm from '../components/SupplierOrderForm';
import { fetchOrdiniGruppi, oggi, setArrival } from '../lib/api';
import type { OrdGruppo, OrdLine } from '../lib/api';
import { PersonaPicker } from '../lib/people';
import ExportBtn from '../components/ExportBtn';

/* register an arrival against one order line */
function ArrivoRow({ l, pin, chi, reload }: { l: OrdLine; pin: string; chi: string; reload: () => void }) {
  const [open, setOpen] = useState(false);
  const [n, setN] = useState(String(l.completo ? l.qty_arrived : l.qty_ordered));
  const [d, setD] = useState(oggi());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const done = l.completo;

  // set the arrived TOTAL — registers a new arrival AND edits/corrects one already registered
  async function save() {
    if (isNaN(Number(n)) || Number(n) < 0) return setErr('Valore non valido');
    setBusy(true); setErr(null);
    try { await setArrival(l.id, Number(n), d, pin, chi); reload(); }
    catch (e) { setErr((e as Error).message); setBusy(false); }
  }

  return (
    <div className={`linerow ${done ? 'done' : ''}`}>
      <button className="lineclick" type="button" onClick={() => setOpen((o) => !o)}>
        <div className="lineinfo">
          {l.image_url ? <img className="invimg sm" src={l.image_url} alt="" /> : <div className="invimg sm ph">{(l.item ?? l.codice).slice(0, 2)}</div>}
          <div>
            <div className="rt">{l.item ?? l.codice} <span className="rs">{l.variant ?? (l.codice.endsWith('_') ? '· da definire' : '')}</span></div>
            <div className="ordnums">{done ? '✓ completo' : <><b>{l.mancano}</b> mancano</>} · {l.qty_arrived}/{l.qty_ordered}{l.data_consegna ? ` · cons. ${String(l.data_consegna).slice(0, 10)}` : ''}</div>
          </div>
        </div>
        <span className="chev">{open ? '▾' : '›'}</span>
      </button>
      {open && (
        <div className="arrinline">
          <label className="fl mini">Arrivati in totale (su {l.qty_ordered} ordinati)</label>
          <div className="arredit">
            <input className="qbox" type="number" inputMode="numeric" value={n} onChange={(e) => setN(e.target.value)} autoFocus />
            <input className="dbox" type="date" value={d} onChange={(e) => setD(e.target.value)} />
            <button className="submit small" disabled={busy} onClick={save}>{busy ? '…' : 'salva'}</button>
          </div>
          {err && <div className="msg err">{err}</div>}
        </div>
      )}
    </div>
  );
}

type Sup = { fornitore: string; lines: OrdLine[]; aperte: number; pezzi: number };

function SupplierDetail({ sup, pin, chi, onBack, onAdd, reload }: { sup: Sup; pin: string; chi: string; onBack: () => void; onAdd: () => void; reload: () => void }) {
  const [showDone, setShowDone] = useState(false);
  const open = sup.lines.filter((l) => !l.completo);
  const done = sup.lines.filter((l) => l.completo);
  return (
    <div className="screen">
      <header><h1>{sup.fornitore}</h1></header>
      <button className="back" onClick={onBack}>← Tutti i fornitori</button>
      <button className="bigadd" onClick={onAdd}>+ Nuovo ordine per {sup.fornitore}</button>
      <section className="card">
        <h2>In arrivo · {open.length}</h2>
        {open.length === 0 ? <p className="muted center">Niente in arrivo da questo fornitore.</p>
          : <div className="list">{open.map((l) => <ArrivoRow key={l.id} l={l} pin={pin} chi={chi} reload={reload} />)}</div>}
      </section>
      {done.length > 0 && (
        <section className="card ask">
          <button className="askhead" onClick={() => setShowDone((s) => !s)}>✓ Già arrivati · {done.length} <span className="muted">{showDone ? '−' : '+'}</span></button>
          {showDone && <div className="askbody"><div className="list">{done.map((l) => <ArrivoRow key={l.id} l={l} pin={pin} chi={chi} reload={reload} />)}</div></div>}
        </section>
      )}
    </div>
  );
}

export default function Ordini({ pin, chi, setChi, initial }: { pin: string; chi: string; setChi: (c: string) => void; initial?: string }) {
  const [grp, setGrp] = useState<OrdGruppo[]>([]);
  const [adding, setAdding] = useState(initial === 'new');
  const [forn, setForn] = useState<string | null>(initial && initial !== 'new' ? initial : null);
  const [addForn, setAddForn] = useState<string | undefined>(undefined);
  const [err, setErr] = useState<string | null>(null);
  const load = () => { fetchOrdiniGruppi().then(setGrp).catch((e) => setErr(e.message)); };
  useEffect(load, []);

  const byForn = useMemo(() => {
    const m = new Map<string, OrdLine[]>();
    for (const g of grp) { const k = g.fornitore ?? '—'; const a = m.get(k) ?? []; a.push(...g.righe); m.set(k, a); }
    return [...m.entries()].map(([fornitore, lines]) => {
      const aperte = lines.filter((l) => !l.completo);
      return { fornitore, lines, aperte: aperte.length, pezzi: aperte.reduce((s, l) => s + Number(l.mancano || 0), 0) };
    }).sort((a, b) => b.aperte - a.aperte || a.fornitore.localeCompare(b.fornitore));
  }, [grp]);

  if (err) return <div className="screen"><div className="card err">Errore: {err}</div></div>;

  if (adding) return (
    <div className="screen">
      <header><h1>Nuovo ordine</h1></header>
      <button className="back" onClick={() => { setAdding(false); setAddForn(undefined); }}>← Ordini</button>
      <SupplierOrderForm pin={pin} chi={chi} initialForn={addForn} onDone={() => { setAdding(false); setAddForn(undefined); load(); }} />
    </div>
  );

  if (forn) {
    const sup = byForn.find((s) => s.fornitore === forn);
    if (sup) return <SupplierDetail sup={sup} pin={pin} chi={chi} onBack={() => setForn(null)} onAdd={() => { setAddForn(forn ?? undefined); setAdding(true); }} reload={load} />;
    return <div className="screen"><button className="back" onClick={() => setForn(null)}>← Ordini</button><div className="card muted center">Nessun ordine per {forn}.</div></div>;
  }

  return (
    <div className="screen">
      <header><h1>Ordini</h1><div className="operbar"><ExportBtn name="ordini" rows={() => grp.flatMap((g) => g.righe).map((l) => ({ fornitore: l.fornitore, codice: l.codice, modello: l.item, variante: l.variant, ordinati: l.qty_ordered, arrivati: l.qty_arrived, mancano: l.mancano, completo: l.completo ? 'si' : 'no', data_ordine: l.data_ordine, data_consegna: l.data_consegna, costo_unitario: l.costo_unitario, tipo: l.nuovo_riordino }))} /><PersonaPicker chi={chi} setChi={setChi} /></div></header>
      <button className="bigadd" onClick={() => setAdding(true)}>+ Nuovo ordine fornitore</button>
      {byForn.length === 0 && <div className="card muted center">Nessun ordine. Tocca “+ Nuovo ordine fornitore”.</div>}
      {byForn.map((s) => (
        <button className="navcard" key={s.fornitore} onClick={() => setForn(s.fornitore)} type="button">
          <div className="ncmain">
            <div className="nct">{s.fornitore}</div>
            <div className="pillrow">
              {s.aperte > 0 ? <span className="pill warn">{s.aperte} in arrivo · {s.pezzi} pz</span> : <span className="pill ok">tutto arrivato</span>}
              <span className="pill muted">{s.lines.length} righe</span>
            </div>
          </div>
          <span className="chev">›</span>
        </button>
      ))}
    </div>
  );
}
