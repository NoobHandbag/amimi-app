import { useEffect, useMemo, useState } from 'react';
import SupplierOrderForm from '../components/SupplierOrderForm';
import { fetchOrdiniGruppi, oggi, setArrival, deleteOrder } from '../lib/api';
import type { OrdGruppo, OrdLine } from '../lib/api';
import ExportBtn from '../components/ExportBtn';
import PrintBtn from '../components/PrintBtn';
import NumberStepper from '../components/NumberStepper';
import Icon from '../components/Icon';
import { prettyName } from '../lib/helpers';
import { toast } from '../lib/toast';

/* register an arrival against one order line */
function ArrivoRow({ l, pin, chi, reload, defaultOpen }: { l: OrdLine; pin: string; chi: string; reload: () => void; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  const [n, setN] = useState(String(l.completo ? l.qty_arrived : (l.wip ? '' : l.qty_ordered)));
  const [d, setD] = useState(oggi());
  const [costo, setCosto] = useState(l.costo_unitario != null ? String(l.costo_unitario) : '');
  const [busy, setBusy] = useState(false);
  const done = l.completo;

  // set the arrived TOTAL — registers a new arrival AND edits/corrects one already registered
  async function save() {
    if (n === '' || isNaN(Number(n)) || Number(n) < 0) return toast('Valore non valido', 'err');
    setBusy(true);
    try {
      await setArrival(l.id, Number(n), d, pin, chi, costo !== '' ? Number(costo) : null);
      toast(`Arrivo salvato · ${n}${l.wip ? '' : `/${l.qty_ordered}`}`, 'ok'); setOpen(false);
    }
    catch (e) { toast((e as Error).message, 'err'); }
    finally { setBusy(false); reload(); }
  }

  // elimina la riga ordine (item 10): il server rifiuta se ha arrivi registrati
  async function remove() {
    if (!window.confirm(`Eliminare l'ordine di ${l.item ?? l.codice} ${l.variant ?? ''} (${l.qty_ordered} pz)? L'operazione non si annulla.`)) return;
    setBusy(true);
    try { await deleteOrder(l.id, pin, chi); toast('Riga ordine eliminata', 'ok'); }
    catch (e) { toast((e as Error).message, 'err'); }
    finally { setBusy(false); reload(); }
  }

  const ordered = l.wip ? 0 : l.qty_ordered;
  const pct = ordered > 0 ? Math.min(100, Math.round((l.qty_arrived / ordered) * 100)) : (done ? 100 : 0);

  return (
    <div className={`ds-lrow ${done ? 'done' : ''}`}>
      <button className="ds-lhead" type="button" onClick={() => setOpen((o) => !o)}>
        {l.image_url ? <span className="ds-thumb"><img src={l.image_url} alt="" /></span> : <span className="ds-thumb">{(l.item ?? l.codice).slice(0, 2).toUpperCase()}</span>}
        <div className="ds-lname">
          <div className="lm">{prettyName(l.item, l.variant, l.codice)}{l.wip && <span className="wip" title="quantità/costo da definire: si risolvono all'arrivo">WIP</span>}</div>
        </div>
        {done
          ? <div className="ds-miss done"><Icon name="check" size={15} /><small>arrivato</small></div>
          : <div className="ds-miss">{l.wip ? '?' : l.mancano}<small>mancano</small></div>}
      </button>
      <div className="ds-progline">
        <div className="ds-prog"><div className={`ds-progfill ${done ? 'done' : ''}`} style={{ width: `${pct}%` }} /></div>
        <span className="ds-progtxt">{l.qty_arrived} / {l.wip ? '?' : l.qty_ordered}</span>
      </div>
      {l.data_consegna_display && <div style={{ fontSize: 11, color: 'var(--ink-muted)', marginTop: 5 }}>Consegna prevista: {String(l.data_consegna_display).slice(0, 10)}</div>}
      {open && (
        <div className="ds-recv">
          <div className="rl">{l.wip ? 'Arrivati in totale (WIP: diventa la quantità ordinata)' : `Arrivati in totale (su ${l.qty_ordered} ordinati)`}</div>
          <div className="ds-recvrow">
            <NumberStepper value={n} onChange={setN} min={0} />
            <input className="ds-recvdate" type="date" value={d} onChange={(e) => setD(e.target.value)} />
            <button className="ds-segna" disabled={busy} onClick={save}>{busy ? '…' : 'Segna arrivati'}</button>
          </div>
          {(l.wip || l.costo_unitario == null) && (
            <input className="ds-recvdate" style={{ marginTop: 8, flexBasis: '100%', width: '100%' }} type="number" inputMode="decimal" value={costo} onChange={(e) => setCosto(e.target.value)} placeholder="€ al pezzo (se ora lo sai)" />
          )}
          <div className="ds-recvfoot">
            <button type="button" className="ds-del" disabled={busy} onClick={remove}><Icon name="trash" size={14} /> Elimina riga</button>
          </div>
        </div>
      )}
    </div>
  );
}

type Sup = { fornitore: string; lines: OrdLine[]; aperte: number; pezzi: number };

function SupplierDetail({ sup, pin, chi, onBack, onAdd, reload }: { sup: Sup; pin: string; chi: string; onBack: () => void; onAdd: () => void; reload: () => void }) {
  const [showDone, setShowDone] = useState(false);
  const open = sup.lines.filter((l) => !l.completo);
  // già arrivati ordinati per data di consegna, i più recenti in cima (senza data in fondo)
  const dcons = (l: OrdLine) => String(l.data_consegna_display ?? l.data_consegna ?? '').slice(0, 10);
  const done = sup.lines.filter((l) => l.completo).sort((a, b) => dcons(b).localeCompare(dcons(a)));
  return (
    <div className="screen">
      <header><h1>{sup.fornitore}</h1></header>
      <button className="back" onClick={onBack}>← Tutti i fornitori</button>
      <button className="ds-btn secondary full" style={{ marginBottom: 14 }} onClick={onAdd}><Icon name="plus" size={17} /> Nuovo ordine per {sup.fornitore}</button>
      <div className="ds-seclb">In arrivo <span className="c">{open.length}</span></div>
      {open.length === 0 ? <div className="card muted center">Niente in arrivo da questo fornitore.</div>
        : open.map((l, i) => <ArrivoRow key={l.id} l={l} pin={pin} chi={chi} reload={reload} defaultOpen={i === 0} />)}
      {done.length > 0 && (
        <>
          <button type="button" className="ds-more" style={{ marginTop: 8 }} onClick={() => setShowDone((s) => !s)}>
            <span>Già arrivati <span style={{ opacity: .7 }}>({done.length})</span></span>
            <b>{showDone ? 'Nascondi ▲' : 'Mostra ›'}</b>
          </button>
          {showDone && <div style={{ marginTop: 10 }}>{done.map((l) => <ArrivoRow key={l.id} l={l} pin={pin} chi={chi} reload={reload} />)}</div>}
        </>
      )}
    </div>
  );
}

export default function Ordini({ pin, chi, initial }: { pin: string; chi: string; initial?: string }) {
  const [grp, setGrp] = useState<OrdGruppo[]>([]);
  // deep-link: 'new' apre il form vuoto; 'new:CODICE' lo apre precompilato (riordino da magazzino, item 21)
  const isNew = initial === 'new' || (initial ?? '').startsWith('new:');
  const [adding, setAdding] = useState(isNew);
  const [addCodice, setAddCodice] = useState<string | undefined>((initial ?? '').startsWith('new:') ? initial!.slice(4) : undefined);
  const [forn, setForn] = useState<string | null>(initial && !isNew ? initial : null);
  const [addForn, setAddForn] = useState<string | undefined>(undefined);
  const [err, setErr] = useState<string | null>(null);
  const load = () => { fetchOrdiniGruppi().then(setGrp).catch((e) => setErr(e.message)); };
  useEffect(load, []);
  // il tab puo' essere gia' montato quando arriva un nuovo deep-link dal riordino
  useEffect(() => {
    if (!initial) return;
    const nn = initial === 'new' || initial.startsWith('new:');
    setAdding(nn);
    setAddCodice(initial.startsWith('new:') ? initial.slice(4) : undefined);
    if (!nn) setForn(initial);
  }, [initial]);

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
      <button className="back" onClick={() => { setAdding(false); setAddForn(undefined); setAddCodice(undefined); }}>← Ordini</button>
      <SupplierOrderForm pin={pin} chi={chi} initialForn={addForn} initialCodice={addCodice} onDone={() => { setAdding(false); setAddForn(undefined); setAddCodice(undefined); load(); }} />
    </div>
  );

  if (forn) {
    const sup = byForn.find((s) => s.fornitore === forn);
    if (sup) return <SupplierDetail sup={sup} pin={pin} chi={chi} onBack={() => setForn(null)} onAdd={() => { setAddForn(forn ?? undefined); setAdding(true); }} reload={load} />;
    return <div className="screen"><button className="back" onClick={() => setForn(null)}>← Ordini</button><div className="card muted center">Nessun ordine per {forn}.</div></div>;
  }

  return (
    <div className="screen">
      <header><h1>Ordini</h1><div className="hbtns"><PrintBtn /><ExportBtn name="ordini" rows={() => grp.flatMap((g) => g.righe).map((l) => ({ fornitore: l.fornitore, codice: l.codice, modello: l.item, variante: l.variant, ordinati: l.qty_ordered, arrivati: l.qty_arrived, mancano: l.mancano, completo: l.completo ? 'si' : 'no', data_ordine: l.data_ordine, data_consegna: l.data_consegna, costo_unitario: l.costo_unitario, tipo: l.nuovo_riordino }))} /></div></header>
      <button className="ds-btn secondary full" style={{ marginBottom: 14 }} onClick={() => setAdding(true)}><Icon name="plus" size={17} /> Nuovo ordine fornitore</button>
      {byForn.length === 0 && <div className="card muted center">Nessun ordine. Tocca “Nuovo ordine fornitore”.</div>}
      {byForn.map((s) => (
        <button className="ds-scard" key={s.fornitore} onClick={() => setForn(s.fornitore)} type="button">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="sn">{s.fornitore}</div>
            <div className="ds-schips">
              {s.aperte > 0 ? <span className="a">{s.aperte} in arrivo · {s.pezzi} pz</span> : <span className="ok">tutto arrivato</span>}
              <span className="r">{s.lines.length} righe</span>
            </div>
          </div>
          <span className="chev" style={{ color: 'var(--ink-muted)', fontSize: 20 }}>›</span>
        </button>
      ))}
    </div>
  );
}
