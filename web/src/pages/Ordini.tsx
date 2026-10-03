import { useEffect, useMemo, useState } from 'react';
import SupplierOrderForm from '../components/SupplierOrderForm';
import { fetchOrdiniGruppi, fetchOrderArrived, oggi, setArrival, deleteOrder } from '../lib/api';
import type { OrdGruppo, OrdLine } from '../lib/api';
import ExportBtn from '../components/ExportBtn';
import PrintBtn from '../components/PrintBtn';
import NumberStepper from '../components/NumberStepper';
import Icon from '../components/Icon';
import { prettyName, pianoArrivo } from '../lib/helpers';
import type { ModoArrivo } from '../lib/helpers';
import { toast } from '../lib/toast';

// valore di partenza del campo: in 'adesso' i pezzi che mancano (come prima, quando era precompilato l'ordinato),
// in 'totale' il totale gia' registrato
const campoIniziale = (m: ModoArrivo, gia: number, mancano: number, wip: boolean, done: boolean) =>
  m === 'totale' ? String(gia) : (wip || done || mancano <= 0 ? '' : String(mancano));

/* register an arrival against one order line */
function ArrivoRow({ l, pin, chi, reload, defaultOpen, altri = [] }: { l: OrdLine; pin: string; chi: string; reload: () => void; defaultOpen?: boolean; altri?: OrdLine[] }) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  const done = l.completo;
  const wip = !!l.wip;
  const gia = Number(l.qty_arrived) || 0;
  const mancano = Number(l.mancano) || 0;
  // null = quantita' ordinata ignota (riga WIP, o riga legacy senza ordinato): niente "su N", niente confronto
  const ordinati = wip || l.qty_ordered == null ? null : Number(l.qty_ordered);
  // 03-10: il campo chiede i pezzi arrivati ADESSO e li somma al gia' arrivato. Il totale si tocca solo in
  // "Correggi il totale" (una riga gia' completa si apre li': non aspetta altri arrivi).
  const modoBase: ModoArrivo = done ? 'totale' : 'adesso';
  const [modo, setModo] = useState<ModoArrivo>(modoBase);
  const [n, setN] = useState(campoIniziale(modoBase, gia, mancano, wip, done));
  const [d, setD] = useState(oggi());
  const [costo, setCosto] = useState(l.costo_unitario != null ? String(l.costo_unitario) : '');
  const [busy, setBusy] = useState(false);
  // la riga e' cambiata (arrivo appena salvato, o registrato da un altro telefono): il campo riparte dal
  // nuovo stato, altrimenti resterebbe precompilato con il numero dell'arrivo precedente
  useEffect(() => {
    setModo(modoBase); setN(campoIniziale(modoBase, gia, mancano, wip, done));
  }, [modoBase, gia, mancano, wip, done]);
  const cambiaModo = (m: ModoArrivo) => { setModo(m); setN(campoIniziale(m, gia, mancano, wip, done)); };
  // il pannello si apre sempre nel modo di default: una correzione lasciata a meta' non deve restare
  // attiva per l'arrivo successivo (era l'equivoco di partenza, a rovescio). Se il modo e' gia' quello,
  // il numero digitato resta: un tocco per sbaglio sull'intestazione non lo deve cancellare.
  const tornaAlModoBase = () => { if (modo !== modoBase) cambiaModo(modoBase); };
  const apriChiudi = () => { setOpen((o) => !o); tornaAlModoBase(); };

  const piano = pianoArrivo(modo, n, gia);

  // un arrivo (modo 'adesso') o una correzione del totale (modo 'totale'): al server va sempre il TOTALE
  async function save() {
    if (!piano.ok) return toast(piano.errore, 'err');
    const { target, delta } = piano;
    // chi era abituato al campo "totale" scrive 30 su una riga 20/40: la somma (50) supera l'ordinato
    const pz = (k: number) => (k === 1 ? '1 pezzo' : `${k} pezzi`);
    if (modo === 'adesso' && ordinati != null && target > ordinati
      && !window.confirm(`Con questo arrivo il totale arrivato diventa ${target}, più dei ${ordinati} ordinati.\n\nQui si scrivono i pezzi arrivati ADESSO, non il totale.\n\nConfermi un arrivo di ${pz(delta)} adesso?`)) return;
    if (modo === 'totale' && delta < 0
      && !window.confirm(`Stai TOGLIENDO ${pz(-delta)} dal magazzino: il totale arrivato passa da ${gia} a ${target}.\n\nConfermi la correzione?`)) return;
    setBusy(true);
    // Un solo punto di scrittura, ritentabile: il server puo' rispondere con due guardie e la UI le
    // scioglie con una conferma ciascuna (concatenabili, se scattano entrambe).
    const doSave = async (force: boolean, confirmDup: boolean): Promise<void> => {
      try {
        // riga riletta a ogni tentativo: se un altro telefono ha registrato nel frattempo, il totale calcolato
        // qui annullerebbe quell'arrivo (o lo conterebbe due volte). Ci si ferma e si mostra lo stato nuovo.
        const vivo = await fetchOrderArrived(l.id);
        if (vivo !== gia) return toast(`Questa riga è cambiata: ora risultano ${vivo} arrivati, qui ne vedevi ${gia}. Niente è stato salvato: controlla i numeri aggiornati e ripeti.`, 'err');
        await setArrival(l.id, target, d, pin, chi, costo !== '' ? Number(costo) : null, confirmDup, force);
        const tot = `${target}${ordinati == null ? '' : `/${ordinati}`}`;
        toast(modo === 'adesso' ? `Arrivo salvato · +${delta} (totale ${tot})` : delta === 0 ? `Salvato · totale invariato (${tot})` : `Totale corretto · da ${gia} a ${tot}`, 'ok');
        setOpen(false); tornaAlModoBase();
      }
      catch (e) {
        const err = e as Error & { closedMonth?: boolean; duplicato?: boolean };
        // mese chiuso (protezione CE): non e' un blocco definitivo, si registra comunque su conferma
        // esplicita (force). L'owner ha scelto la conferma al posto del blocco secco (2026-09-01).
        if (err.closedMonth && !force) {
          if (window.confirm(err.message + '\n\nRegistrare COMUNQUE questo arrivo?')) return doSave(true, confirmDup);
          return;
        }
        // fix a (31-07): il server ha visto un arrivo GIA' registrato oggi per questo codice su
        // un'altra riga (il meccanismo del doppio conteggio COCCO/TOASTED). Si procede solo su conferma.
        if (err.duplicato && !confirmDup) {
          if (window.confirm(err.message + '\n\nRegistrare COMUNQUE questo arrivo?')) return doSave(force, true);
          return;
        }
        toast(err.message, 'err');
      }
    };
    try { await doSave(false, false); }
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
      <button className="ds-lhead" type="button" onClick={apriChiudi}>
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
          {altri.length > 0 && (
            // fix b (31-07): il vero antidoto al doppio conteggio: chi registra VEDE che esistono
            // altre righe ordine aperte per la stessa borsa e controlla di essere su quella giusta.
            <div style={{ background: '#fff4e0', border: '1px solid #eac07a', color: '#7a4d0b', borderRadius: 10, padding: '8px 10px', fontSize: 12, marginBottom: 8 }}>
              Attenzione: {altri.length === 1 ? "c'e' un altro ordine aperto" : `ci sono ${altri.length} altri ordini aperti`} per questa borsa
              ({altri.map((a) => `${a.fornitore ?? '?'}: ${a.wip ? '?' : a.mancano} mancano, ordine del ${String(a.data_ordine ?? '').slice(0, 10)}`).join(' · ')}).
              Controlla di registrare l'arrivo sulla riga giusta.
            </div>
          )}
          <div className="rl">{modo === 'totale' ? 'Totale arrivati finora (correzione)' : wip ? 'Arrivati adesso (WIP: diventa la quantità ordinata)' : 'Arrivati adesso'}</div>
          <div className="ds-recvrow">
            <NumberStepper value={n} onChange={setN} min={modo === 'adesso' ? 1 : 0} />
            <input className="ds-recvdate" type="date" value={d} onChange={(e) => setD(e.target.value)} />
            <button className="ds-segna" disabled={busy} onClick={save}>{busy ? '…' : modo === 'totale' ? 'Salva totale' : 'Segna arrivati'}</button>
          </div>
          {/* il conto in chiaro: e' cio' che toglie l'equivoco fra "arrivati adesso" e "arrivati in totale" */}
          <div style={{ fontSize: 12.5, marginTop: 8, lineHeight: 1.4 }}>
            {modo === 'adesso'
              ? <>Già arrivati <b>{gia}</b>{ordinati == null ? '' : ` su ${ordinati}`}.{piano.ok && <> Con questo arrivo il totale diventa <b>{piano.target}</b>{ordinati == null ? '' : piano.target < ordinati ? ` (da ricevere ancora: ${ordinati - piano.target})` : piano.target === ordinati ? ': riga completa' : `: ${piano.target - ordinati} in più degli ordinati`}.</>}</>
              : <>Ora risultano arrivati <b>{gia}</b>{ordinati == null ? '' : ` su ${ordinati}`}.{piano.ok && (piano.delta === 0 ? ' Il magazzino non cambia.' : <> Salvando il totale diventa <b>{piano.target}</b>: magazzino {piano.delta > 0 ? '+' : '−'}{Math.abs(piano.delta)}.</>)}</>}
          </div>
          {(l.wip || l.costo_unitario == null) && (
            <input className="ds-recvdate" style={{ marginTop: 8, flexBasis: '100%', width: '100%' }} type="number" inputMode="decimal" value={costo} onChange={(e) => setCosto(e.target.value)} placeholder="€ al pezzo (se ora lo sai)" />
          )}
          <div className="ds-recvfoot" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <button type="button" className="linkbtn" style={{ textDecoration: 'underline', color: 'var(--ink-muted)', fontSize: 12 }} disabled={busy} onClick={() => cambiaModo(modo === 'adesso' ? 'totale' : 'adesso')}>
              {modo === 'adesso' ? 'Correggi il totale' : done ? 'Registra un altro arrivo' : 'Registra un arrivo'}
            </button>
            <button type="button" className="ds-del" disabled={busy} onClick={remove}><Icon name="trash" size={14} /> Elimina riga</button>
          </div>
        </div>
      )}
    </div>
  );
}

type Sup = { fornitore: string; lines: OrdLine[]; aperte: number; pezzi: number };

function SupplierDetail({ sup, pin, chi, onBack, onAdd, reload, openByCodice }: { sup: Sup; pin: string; chi: string; onBack: () => void; onAdd: () => void; reload: () => void; openByCodice: Map<string, OrdLine[]> }) {
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
      {/* fix d (31-07): niente riga auto-aperta: cosi' com'era, un tocco accidentale su "Segna
          arrivati" registrava un arrivo COMPLETO (quantita' precompilata + pannello gia' aperto). */}
      {open.length === 0 ? <div className="card muted center">Niente in arrivo da questo fornitore.</div>
        : open.map((l) => <ArrivoRow key={l.id} l={l} pin={pin} chi={chi} reload={reload} altri={(openByCodice.get(l.codice) ?? []).filter((x) => x.id !== l.id)} />)}
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

export default function Ordini({ pin, chi, initial, onMateriali }: { pin: string; chi: string; initial?: string; onMateriali?: () => void }) {
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
  // fix e (31-07): la lista si aggiorna anche quando il tab TORNA VISIBILE o l'app riprende focus.
  // Prima si ricaricava solo al mount e dopo un salvataggio PROPRIO: un secondo contesto (altro
  // telefono, o app-home vs Safari sullo stesso iPhone) restava stantio e mostrava ancora
  // "N mancano" per arrivi gia' registrati altrove: era l'invito al doppio inserimento.
  useEffect(() => {
    const onVis = () => { if (!document.hidden) load(); };
    window.addEventListener('focus', onVis);
    document.addEventListener('visibilitychange', onVis);
    return () => { window.removeEventListener('focus', onVis); document.removeEventListener('visibilitychange', onVis); };
  }, []);
  // fix b (31-07): mappa codice -> righe ordine APERTE (tutti i fornitori), per l'avviso in ArrivoRow
  const openByCodice = useMemo(() => {
    const m = new Map<string, OrdLine[]>();
    for (const g of grp) for (const l of g.righe) if (!l.completo) { const a = m.get(l.codice) ?? []; a.push(l); m.set(l.codice, a); }
    return m;
  }, [grp]);
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
    if (sup) return <SupplierDetail sup={sup} pin={pin} chi={chi} onBack={() => setForn(null)} onAdd={() => { setAddForn(forn ?? undefined); setAdding(true); }} reload={load} openByCodice={openByCodice} />;
    return <div className="screen"><button className="back" onClick={() => setForn(null)}>← Ordini</button><div className="card muted center">Nessun ordine per {forn}.</div></div>;
  }

  return (
    <div className="screen">
      {/* Area Fornitori in due meta' (brief catalogo 22-09): PRODOTTI = questa pagina (borse finite, arrivi, stock);
          MATERIE PRIME = catalogo pelli/tessuti (pagina Materiali). Il segmented compare solo a modulo acceso. */}
      {onMateriali && (
        <div className="seg" style={{ marginBottom: 12 }}>
          <button type="button" className="on">Prodotti</button>
          <button type="button" onClick={onMateriali}>Materie prime</button>
        </div>
      )}
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
