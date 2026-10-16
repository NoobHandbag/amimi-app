import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import Icon from '../components/Icon';
import { fetchInventory, fetchOrdiniGruppi, oggi } from '../lib/api';
import type { InvFull, OrdGruppo, OrdLine } from '../lib/api';
import { ArrivoRow } from './Ordini';
import SupplierOrderForm from '../components/SupplierOrderForm';
import { MODEL_ORDER, FIN_IT, PRINT_IT, giorniAllaConsegna, labOf, modelOf, nice, parseLook } from '../lib/villaggio/catalogo';
import type { Look, Modello } from '../lib/villaggio/catalogo';
import { Mondo, canvasFor, labColor, thumbAsync } from '../lib/villaggio/mondo';
import type { DatiMondo, LabMondo, PilaMondo, RigaMondo } from '../lib/villaggio/mondo';
import '../styles/villaggio.css';

// Villaggio (16-10): la stessa gestione ordini e magazzino, vista come un'isola in stile FarmVille / Animal Crossing.
// LEGGE le stesse viste di Ordini e Magazzino (v_ordini_arrivo, v_inventory). SCRIVE solo attraverso i componenti di
// Ordini: ArrivoRow (arrivi, con le sue conferme su mese chiuso, doppio arrivo e totale atteso) e SupplierOrderForm
// (ordine nuovo). Nessuna chiamata a write-api nasce qui: e' una vista parallela, non un secondo modo di scrivere.

type Pila = PilaMondo & { codes: { codice: string; variant: string }[] };
type Lab = LabMondo & { raw: OrdLine[]; extra: OrdLine[] };
type Mod = { dati: DatiMondo; labs: Lab[]; pile: Map<string, Pila>; codeToPila: Map<string, string>; righe: Map<string, { riga: RigaMondo; lab: string }>; tot: { stock: number; prep: number; open: number; fuori: number } };
type Sheet = { t: 'lab'; key: string } | { t: 'wh'; model?: Modello } | { t: 'labs' } | { t: 'help' }
  | { t: 'add'; step: 1 | 2 | 3 | 4; lab?: string; model?: Modello; pila?: string; codice?: string } | null;

const INTRO_KEY = 'amimi_villaggio_intro';
const dataBreve = (iso: string | null | undefined) => (iso ? new Date(String(iso).slice(0, 10) + 'T12:00:00').toLocaleDateString('it-IT', { day: 'numeric', month: 'long' }) : '');

/** Da ordini e magazzino al modello del villaggio. Le righe d'ordine prendono l'aspetto dalla variante di MAGAZZINO con lo stesso codice. */
function costruisci(gruppi: OrdGruppo[], inv: InvFull[], oggiIso: string): Mod {
  const invBy = new Map(inv.map((r) => [r.codice, r]));
  const pile = new Map<string, Pila>();
  const codeToPila = new Map<string, string>();
  const lookOf = (codice: string, item: string | null, variant: string | null) => {
    const mv = modelOf(item, variant);
    return mv.model ? { model: mv.model, look: parseLook(mv.model, mv.variant, codice), variant: mv.variant } : null;
  };
  const pilaFor = (codice: string, item: string | null, variant: string | null) => {
    const lk = lookOf(codice, item, variant);
    if (!lk) return null;
    const key = lk.model + '|' + lk.look.key;
    let p = pile.get(key);
    if (!p) { p = { key, model: lk.model, look: lk.look, name: nice(lk.variant), stock: 0, incoming: 0, codes: [] }; pile.set(key, p); }
    if (!p.codes.some((c) => c.codice === codice)) p.codes.push({ codice, variant: variant ?? '' });
    codeToPila.set(codice, key);
    return p;
  };
  let stock = 0, fuori = 0;
  for (const r of inv) {
    const n = Number(r.giacenza_attuale) || 0;
    stock += Math.max(0, n);
    const p = pilaFor(r.codice, r.item, r.variant);
    if (p) p.stock += n; else fuori += Math.max(0, n);
  }
  const labsBy = new Map<string, Lab>();
  const righe = new Map<string, { riga: RigaMondo; lab: string }>();
  let prep = 0, open = 0;
  for (const g of gruppi) for (const l of g.righe) {
    if (l.completo) continue;
    const key = l.fornitore ?? 'Senza fornitore';
    let L = labsBy.get(key);
    if (!L) { const lo = labOf(key); L = { key, nome: lo.nome, tipo: lo.tipo, righe: [], raw: [], extra: [] }; labsBy.set(key, L); }
    open++;
    const a = Number(l.qty_arrived) || 0;
    const o = l.wip || l.qty_ordered == null ? a + 1 : Math.max(Number(l.qty_ordered) || 0, a);
    if (!l.wip) prep += Math.max(0, Number(l.mancano) || 0);
    const iv = invBy.get(l.codice);
    const p = pilaFor(l.codice, iv?.item ?? l.item, iv?.variant ?? l.variant);
    if (!p) { L.extra.push(l); continue; }
    if (!l.wip) p.incoming += Math.max(0, Number(l.mancano) || 0);
    const d = giorniAllaConsegna(l.data_consegna_display ?? l.data_consegna, oggiIso);
    const riga: RigaMondo = { id: l.id, codice: l.codice, model: p.model, look: p.look, label: nice(l.variant) + (l.wip ? ' (WIP)' : ''), a, o, late: d != null && d < 0 };
    L.righe.push(riga); L.raw.push(l);
    righe.set(l.id, { riga, lab: key });
  }
  const labs = [...labsBy.values()].sort((x, y) => x.nome.localeCompare(y.nome, 'it'));
  const visibili = [...pile.values()].filter((p) => p.stock !== 0 || p.incoming > 0);
  return { dati: { labs, pile: visibili, totale: stock }, labs, pile, codeToPila, righe, tot: { stock, prep, open, fuori } };
}

function Thumb({ model, look }: { model: Modello; look: Look }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => { let on = true; thumbAsync(model, look, (u) => { if (on) setSrc(u); }); return () => { on = false; }; }, [model, look]);
  return src ? <img className="v-th" src={src} alt="" /> : <span className="v-th" />;
}

function Pezzi({ a, o }: { a: number; o: number }) {
  const unit = Math.max(1, Math.ceil(o / 20)), n = Math.ceil(o / unit), on = Math.floor(a / unit);
  return <div className="v-pz" aria-hidden="true">{Array.from({ length: n }, (_, i) => <i key={i} className={i < on ? 'on' : ''} />)}</div>;
}

export default function Villaggio({ pin, chi, onBack }: { pin: string; chi: string; onBack: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const hudRef = useRef<HTMLElement>(null);
  const mondoRef = useRef<Mondo | null>(null);
  const [mod, setMod] = useState<Mod | null>(null);
  const prevArrived = useRef<Map<string, number>>(new Map());
  const [err, setErr] = useState<string | null>(null);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [openLine, setOpenLine] = useState<string | null>(null);
  const [say, setSay] = useState<string[]>([]);
  const [typed, setTyped] = useState('');
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const sheetRef = useRef<Sheet>(null);
  sheetRef.current = sheet;

  const toast = useCallback((m: string) => { setToastMsg(m); window.setTimeout(() => setToastMsg((x) => (x === m ? null : x)), 3200); }, []);

  // carica (o ricarica dopo una scrittura) e, se qualche riga ha nuovi arrivi, fa partire il furgoncino
  const load = useCallback(async () => {
    try {
      const [g, inv] = await Promise.all([fetchOrdiniGruppi(), fetchInventory()]);
      const m = costruisci(g, inv, oggi());
      const before = prevArrived.current;
      const arrivi: { lab: string; riga: RigaMondo; n: number }[] = [];
      for (const gr of g) for (const l of gr.righe) {
        const prima = before.get(l.id), ora = Number(l.qty_arrived) || 0;
        const info = m.righe.get(l.id);
        if (prima != null && ora > prima && info) arrivi.push({ lab: info.lab, riga: info.riga, n: ora - prima });
      }
      prevArrived.current = new Map(g.flatMap((gr) => gr.righe.map((l) => [l.id, Number(l.qty_arrived) || 0] as [string, number])));
      setMod(m); setErr(null);
      const W = mondoRef.current;
      if (W) {
        W.aggiorna(m.dati);
        for (const x of arrivi) {
          W.arrivo(x.lab, x.riga, x.n, m.codeToPila.get(x.riga.codice) ?? '');
          toast(`${x.n} ${x.riga.model} ${x.riga.label.toLowerCase()} in magazzino.`);
        }
      }
    } catch (e) { setErr((e as Error).message); }
  }, [toast]);

  // il mondo 3D vive finche' la pagina e' montata
  useEffect(() => {
    if (!document.getElementById('vil-fonts')) {
      const l = document.createElement('link'); l.id = 'vil-fonts'; l.rel = 'stylesheet';
      l.href = 'https://fonts.googleapis.com/css2?family=Fredoka:wght@400;500;600;700&family=Nunito:wght@700;800&display=swap';
      document.head.appendChild(l);
    }
    const c = canvasRef.current, lb = labelsRef.current;
    if (!c || !lb) return;
    const W = new Mondo(c, lb, hudRef.current, {
      onLab: (key) => setSheet({ t: 'lab', key }),
      onMagazzino: (model) => setSheet({ t: 'wh', model }),
      onGinni: () => setSay((s) => (s.length ? s : ['__fatto__'])),
      onCarro: () => toast('Con il furgoncino porto le borse dai laboratori al magazzino.'),
    });
    W.onTap = () => { if (sheetRef.current) setSheet(null); };
    mondoRef.current = W;
    load();
    let intro = false;
    try { intro = !localStorage.getItem(INTRO_KEY); } catch { intro = false; }
    if (intro) {
      setSay(['Ciao! Questo è il villaggio Amimi, con i dati veri dell\'app.',
        'Nel magazzino c\'è una pila per ogni variante: più è alta più pezzi ci sono, ogni lastra vale 2 pezzi. Anello giallo: quasi finita. Trasparente: finita ma in arrivo.',
        'I laboratori sono capannoni: un carrello per ogni variante in lavorazione, la pila è quanto deve ancora arrivare. Bandierina rossa: in ritardo.',
        'Tocca un laboratorio per segnare gli arrivi, col + ordini borse nuove. Si scrive con gli stessi moduli di Ordini.']);
      try { localStorage.setItem(INTRO_KEY, '1'); } catch { /* storage non disponibile: l'intro tornera' la prossima volta */ }
    }
    const onVis = () => { if (!document.hidden) load(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { document.removeEventListener('visibilitychange', onVis); W.dispose(); mondoRef.current = null; };
  }, [load, toast]);

  // pannello aperto -> camera e contesto del mondo
  useEffect(() => {
    const W = mondoRef.current;
    if (!W) return;
    if (!sheet) { W.ripristina(); return; }
    if (sheet.t === 'lab') W.focusLab(sheet.key);
    else if (sheet.t === 'wh') W.focusMagazzino(sheet.model);
    else W.setCtx({ type: sheet.t });
  }, [sheet]);

  // fatti veri per Ginni, calcolati dai dati
  const fatti = useMemo(() => {
    if (!mod) return [];
    const out: string[] = [];
    let peggio: { r: OrdLine; lab: Lab; d: number } | null = null;
    for (const L of mod.labs) for (const r of L.raw) {
      const d = giorniAllaConsegna(r.data_consegna_display ?? r.data_consegna, oggi());
      if (d != null && d < 0 && (!peggio || d < peggio.d)) peggio = { r, lab: L, d };
    }
    if (peggio) out.push(`${modelOf(peggio.r.item, peggio.r.variant).model ?? peggio.r.item} ${nice(peggio.r.variant).toLowerCase()} di ${peggio.lab.nome} doveva arrivare il ${dataBreve(peggio.r.data_consegna_display ?? peggio.r.data_consegna)}: mancano ${peggio.r.mancano} pezzi.`);
    const grande = [...mod.labs].sort((a, b) => b.raw.reduce((s, r) => s + (Number(r.mancano) || 0), 0) - a.raw.reduce((s, r) => s + (Number(r.mancano) || 0), 0))[0];
    if (grande) out.push(`${grande.nome} ha ${grande.raw.reduce((s, r) => s + (Number(r.mancano) || 0), 0)} pezzi in preparazione.`);
    const finita = mod.dati.pile.find((p) => p.stock <= 0 && p.incoming > 0);
    if (finita) out.push(`${finita.model} ${finita.name.toLowerCase()} è finita in magazzino, ma ne arrivano ${finita.incoming}: la vedi trasparente.`);
    const alta = [...mod.dati.pile].sort((a, b) => b.stock - a.stock)[0];
    if (alta) out.push(`La pila più alta è ${alta.model} ${alta.name.toLowerCase()}: ${alta.stock} pezzi.`);
    return out;
  }, [mod]);
  const fattoI = useRef(0);
  useEffect(() => {
    if (say[0] === '__fatto__') setSay(fatti.length ? [fatti[fattoI.current++ % fatti.length]] : []);
  }, [say, fatti]);

  // testo che si scrive da solo, come in Animal Crossing
  useEffect(() => {
    if (!say.length || say[0] === '__fatto__') { setTyped(''); return; }
    const full = say[0];
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setTyped(full); return; }
    let k = 0; setTyped('');
    const id = window.setInterval(() => { k++; setTyped(full.slice(0, k)); if (k >= full.length) window.clearInterval(id); }, 22);
    return () => window.clearInterval(id);
  }, [say]);
  const avantiDialogo = () => { if (typed.length < (say[0] ?? '').length) setTyped(say[0]); else setSay((s) => s.slice(1)); };

  const chiudi = () => { setSheet(null); setOpenLine(null); };
  const lab = sheet?.t === 'lab' ? mod?.labs.find((l) => l.key === sheet.key) : undefined;
  const labIndex = (key: string) => mod ? mod.labs.findIndex((l) => l.key === key) : 0;
  const tot = mod?.tot ?? { stock: 0, prep: 0, open: 0, fuori: 0 };

  const openByCodice = useMemo(() => {
    const m = new Map<string, OrdLine[]>();
    for (const L of mod?.labs ?? []) for (const l of [...L.raw, ...L.extra]) { const a = m.get(l.codice) ?? []; a.push(l); m.set(l.codice, a); }
    return m;
  }, [mod]);

  function rigaLab(r: RigaMondo, raw: OrdLine) {
    const aperta = openLine === r.id;
    const d = giorniAllaConsegna(raw.data_consegna_display ?? raw.data_consegna, oggi());
    const p = mod?.pile.get(mod.codeToPila.get(r.codice) ?? '');
    return (
      <div className={'v-row' + (aperta ? ' on' : '')} key={r.id}>
        <Thumb model={r.model} look={r.look} />
        <div className="v-rt">
          <b>{r.label}</b>
          <Pezzi a={r.a} o={r.o} />
          <div className="v-meta">
            {raw.wip ? 'quantità da definire' : `${r.a} di ${r.o} arrivate`}
            {d == null ? <span className="v-chip nodate">senza data</span>
              : d < 0 ? <span className={'v-chip ' + (-d >= 30 ? 'verylate' : 'late')}>{-d === 1 ? '1 giorno di ritardo' : `${-d} giorni di ritardo`}</span>
                : <span className="v-chip ok">consegna {dataBreve(raw.data_consegna_display ?? raw.data_consegna)}</span>}
            <span className="v-chip stock">in magazzino {p ? Math.max(0, p.stock) : 0}</span>
          </div>
        </div>
        <button className={'v-btn sm' + (aperta ? ' ghost' : '')} type="button" onClick={() => setOpenLine(aperta ? null : r.id)}>{aperta ? 'Chiudi' : 'Arrivate'}</button>
        {aperta && (
          <div className="v-arrivo">
            <ArrivoRow l={raw} pin={pin} chi={chi} reload={load} defaultOpen altri={(openByCodice.get(raw.codice) ?? []).filter((x) => x.id !== raw.id)} />
          </div>
        )}
      </div>
    );
  }

  function pannello() {
    if (!sheet || !mod) return null;
    if (sheet.t === 'lab') {
      if (!lab) return { head: <h2>Laboratorio</h2>, body: <p className="v-empty">Questo laboratorio non ha più righe aperte.</p>, cls: 'labsheet' };
      const pz = lab.raw.reduce((s, r) => s + (r.wip ? 0 : Number(r.mancano) || 0), 0);
      const gruppi = new Map<string, { r: RigaMondo; raw: OrdLine }[]>();
      lab.righe.map((r, i) => ({ r, raw: lab.raw[i] }))
        .sort((x, y) => (y.r.late ? 1000 : 0) - (x.r.late ? 1000 : 0) + ((y.r.o - y.r.a) - (x.r.o - x.r.a)) * 0.001)
        .forEach((x) => { const a = gruppi.get(x.r.model) ?? []; a.push(x); gruppi.set(x.r.model, a); });
      return {
        cls: 'labsheet',
        head: <><span className="v-hic" style={{ '--c': '#' + labColor(labIndex(lab.key)).toString(16).padStart(6, '0') } as CSSProperties}><Icon name="store" size={22} /></span>
          <div className="v-ht"><h2>{lab.nome} sta preparando</h2><p>{lab.tipo ? `Laboratorio ${lab.tipo} · ` : ''}{lab.raw.length + lab.extra.length} righe, {pz} pz da arrivare</p></div></>,
        body: <>
          {[...gruppi.entries()].map(([m, xs]) => (
            <div key={m}>
              <div className="v-gh"><b>{m}</b><small>{xs.length} {xs.length === 1 ? 'variante' : 'varianti'} · {xs.reduce((s, x) => s + x.r.o - x.r.a, 0)} pz da arrivare</small></div>
              <div className="v-list">{xs.map((x) => rigaLab(x.r, x.raw))}</div>
            </div>
          ))}
          {lab.extra.length > 0 && (
            <div>
              <div className="v-gh"><b>Altri prodotti</b><small>modelli che il villaggio non sa ancora disegnare</small></div>
              <div className="v-list">{lab.extra.map((l) => <ArrivoRow key={l.id} l={l} pin={pin} chi={chi} reload={load} altri={(openByCodice.get(l.codice) ?? []).filter((x) => x.id !== l.id)} />)}</div>
            </div>
          )}
          <p className="v-note">Nel capannone c'è un carrello per variante: la pila è quanto deve ancora arrivare (una lastra = 2 pezzi). Gli arrivi si registrano con la stessa riga di Ordini.</p>
          <button className="v-btn alt wide" type="button" onClick={() => setSheet({ t: 'add', step: 2, lab: lab.key })}>+ Ordina a {lab.nome}</button>
        </>,
      };
    }
    if (sheet.t === 'wh') {
      return {
        cls: 'short',
        head: <><span className="v-hic" style={{ '--c': '#e57f9d' } as CSSProperties}><Icon name="box" size={22} /></span><div className="v-ht"><h2>Magazzino</h2><p>{tot.stock} pezzi · una pila per variante, più è alta più pezzi ci sono</p></div></>,
        body: <>{MODEL_ORDER.map((m) => {
          const ps = mod.dati.pile.filter((p) => p.model === m).sort((a, b) => b.stock - a.stock);
          if (!ps.length) return null;
          const t = ps.reduce((s, p) => s + Math.max(0, p.stock), 0);
          const low = ps.filter((p) => p.stock > 0 && p.stock <= 2).length, out = ps.filter((p) => p.stock <= 0).length;
          return (
            <div key={m} ref={(el) => { if (el && sheet.model === m) el.scrollIntoView({ block: 'start' }); }}>
              <h3 className="v-sec">{m}<small>{t} pz · {ps.length} varianti{low ? ` · ${low} quasi finite` : ''}{out ? ` · ${out} finite` : ''}</small></h3>
              <div className="v-vgrid">{ps.map((p) => {
                const st = Math.max(0, p.stock);
                return (
                  <button key={p.key} type="button" className={'v-vt' + (p.stock < 0 ? ' neg' : st === 0 ? ' out' : st <= 2 ? ' low' : '')} onClick={() => { setSheet(null); window.setTimeout(() => mondoRef.current?.focusPila(p.key), 30); }}>
                    <Thumb model={p.model} look={p.look} />
                    <b>{p.stock < 0 ? p.stock : st}</b><small>{p.name}</small>{p.incoming > 0 && <small className="inc">+{p.incoming} in arrivo</small>}
                  </button>
                );
              })}</div>
            </div>
          );
        })}
        {tot.fuori > 0 && <p className="v-note">Altri {tot.fuori} pezzi sono di modelli che il villaggio non sa ancora disegnare: li trovi nella pagina Magazzino.</p>}</>,
      };
    }
    if (sheet.t === 'labs') {
      return {
        cls: '',
        head: <><span className="v-hic" style={{ '--c': '#c8643f' } as CSSProperties}><Icon name="store" size={22} /></span><div className="v-ht"><h2>Laboratori</h2><p>Le borse in preparazione, laboratorio per laboratorio</p></div></>,
        body: <div className="v-list">{mod.labs.map((L, i) => {
          const pz = L.raw.reduce((s, r) => s + (r.wip ? 0 : Number(r.mancano) || 0), 0);
          const late = L.righe.filter((r) => r.late).length;
          return (
            <button key={L.key} type="button" className="v-lrow" onClick={() => setSheet({ t: 'lab', key: L.key })}>
              <span className="v-hic" style={{ '--c': '#' + labColor(i).toString(16).padStart(6, '0') } as CSSProperties}>{L.nome.slice(0, 1)}</span>
              <span><b>{L.nome}</b><small>{L.tipo ? L.tipo + ' · ' : ''}{L.raw.length + L.extra.length} righe · {pz} pz</small></span>
              {late ? <span className="v-chip verylate">{late} in ritardo</span> : <span className="v-chip nodate">{L.raw.length + L.extra.length} in corso</span>}
            </button>
          );
        })}</div>,
      };
    }
    if (sheet.t === 'help') {
      const rapp = (m: Modello) => [...mod.pile.values()].filter((p) => p.model === m).sort((a, b) => b.stock - a.stock)[0];
      const seen = new Set<string>(), fins: Pila[] = [];
      for (const p of mod.pile.values()) { const k = p.look.print ?? p.look.fin; if (!seen.has(k)) { seen.add(k); fins.push(p); } }
      return {
        cls: '',
        head: <><span className="v-hic" style={{ '--c': '#e0a32f' } as CSSProperties}>?</span><div className="v-ht"><h2>Come leggere il villaggio</h2><p>Forma = modello · finitura = materiale · colore = colore</p></div></>,
        body: <>
          <h3 className="v-sec">La forma dice il modello</h3>
          <div className="v-lg">{MODEL_ORDER.map((m) => { const p = rapp(m); return p ? <div key={m}><Thumb model={m} look={p.look} /><b>{m}</b></div> : null; })}</div>
          <h3 className="v-sec">La finitura dice il materiale</h3>
          <div className="v-lg">{fins.map((p) => <div key={p.key}><span className="v-sq" style={{ backgroundImage: `url(${canvasFor(p.look).toDataURL()})` }} /><b>{p.look.print ? PRINT_IT[p.look.print] : FIN_IT[p.look.fin]}</b>{p.model}</div>)}</div>
          <h3 className="v-sec">I segnali</h3>
          <div className="v-sig"><span className="mk" style={{ background: '#f2b84b' }} /><span><b>Anello giallo sotto la pila</b>Quasi finita: 1 o 2 pezzi.</span></div>
          <div className="v-sig"><span className="mk" style={{ background: '#9fd3ec' }} /><span><b>Borsa trasparente su anello azzurro</b>Finita in magazzino, ma c'è un ordine aperto.</span></div>
          <div className="v-sig"><span className="mk" style={{ background: '#e0574b' }} /><span><b>Anello rosso</b>Giacenza negativa: venduta senza carico, da sistemare.</span></div>
          <div className="v-sig"><span className="mk" style={{ background: '#e0574b', borderRadius: '4px 50% 50% 4px' }} /><span><b>Bandierina rossa sul carrello</b>Quella variante è in ritardo.</span></div>
          <div className="v-sig"><span className="mk" style={{ background: '#eee' }} /><span><b>Pile e carrelli</b>Ogni lastra vale 2 pezzi, ovunque. In magazzino la pila è quello che c'è, nei laboratori quello che deve ancora arrivare.</span></div>
        </>,
      };
    }
    // ordine nuovo: si sceglie con le figure, poi si compila il modulo vero di Ordini
    const s = sheet;
    const passi = ['A chi lo ordini?', 'Che modello?', 'Che materiale e colore?', 'Quantità e prezzo'];
    const L = s.lab ? mod.labs.find((x) => x.key === s.lab) : undefined;
    const P = s.pila ? mod.pile.get(s.pila) : undefined;
    return {
      cls: s.step === 4 ? 'tall' : '',
      head: <><span className="v-hic plus"><Icon name="plus" size={22} /></span><div className="v-ht"><h2>Ordina borse</h2><p>{passi[s.step - 1]}</p></div></>,
      body: <>
        <div className="v-dots">{[1, 2, 3, 4].map((i) => <i key={i} className={i <= s.step ? 'on' : ''} />)}</div>
        {s.step === 1 && <div className="v-tiles">
          {mod.labs.map((x, i) => <button key={x.key} type="button" className="v-tile" onClick={() => setSheet({ ...s, step: 2, lab: x.key })}><span className="v-hic" style={{ '--c': '#' + labColor(i).toString(16).padStart(6, '0') } as CSSProperties}>{x.nome.slice(0, 1)}</span><b>{x.nome}</b><small>{x.tipo}</small></button>)}
          <button type="button" className="v-tile" onClick={() => setSheet({ ...s, step: 2, lab: undefined })}><span className="v-hic">…</span><b>Un altro</b><small>lo scegli nel modulo</small></button>
        </div>}
        {s.step === 2 && <>
          <button className="v-back" type="button" onClick={() => setSheet({ ...s, step: 1 })}>‹ {L ? `Cambia fornitore (${L.nome})` : 'Cambia fornitore'}</button>
          <div className="v-tiles">{MODEL_ORDER.map((m) => { const p = [...mod.pile.values()].filter((x) => x.model === m).sort((a, b) => b.stock - a.stock)[0]; return p ? <button key={m} type="button" className="v-tile" onClick={() => setSheet({ ...s, step: 3, model: m })}><Thumb model={m} look={p.look} /><b>{m}</b></button> : null; })}</div>
        </>}
        {s.step === 3 && s.model && <>
          <button className="v-back" type="button" onClick={() => setSheet({ ...s, step: 2 })}>‹ Cambia modello ({s.model})</button>
          <div className="v-vgrid">{[...mod.pile.values()].filter((p) => p.model === s.model).sort((a, b) => b.stock - a.stock).flatMap((p) => p.codes.map((c) => (
            <button key={c.codice} type="button" className="v-vt" onClick={() => setSheet({ ...s, step: 4, pila: p.key, codice: c.codice })}>
              <Thumb model={p.model} look={p.look} /><small>{p.codes.length > 1 ? nice(c.variant) : p.name}</small><small>in magazzino {Math.max(0, p.stock)}</small>
            </button>
          )))}</div>
        </>}
        {s.step === 4 && P && <>
          <button className="v-back" type="button" onClick={() => setSheet({ ...s, step: 3 })}>‹ Cambia colore</button>
          <div className="v-qty"><Thumb model={P.model} look={P.look} /><div><b>{P.model} · {P.name}</b><small>{L ? `da ${L.nome}` : 'scegli il fornitore qui sotto'} · in magazzino {Math.max(0, P.stock)}</small></div></div>
          <div className="v-form">
            <SupplierOrderForm pin={pin} chi={chi} initialForn={L?.key} initialCodice={s.codice} onDone={() => { const k = L?.key; load(); setSheet(k ? { t: 'lab', key: k } : null); toast('Ordine salvato: lo trovi anche in Ordini.'); }} />
          </div>
        </>}
      </>,
    };
  }
  const P = pannello();

  return (
    <div className="vil">
      <canvas ref={canvasRef} className="v-canvas" aria-label="Villaggio Amimi: il magazzino con le borse impilate e i laboratori con le borse in preparazione" />
      <div ref={labelsRef} className="v-labels" />
      <header ref={hudRef} className="v-hud">
        <button className="v-pill v-home" type="button" onClick={onBack} aria-label="Torna alla Home"><Icon name="home" size={20} /></button>
        <div className="v-pill"><span className="ic" style={{ background: '#e57f9d' }}><Icon name="bag" size={16} /></span><span><b>{tot.stock}</b><small>in magazzino</small></span></div>
        <div className="v-pill"><span className="ic" style={{ background: '#c8643f' }}><Icon name="store" size={16} /></span><span><b>{tot.prep}</b><small>in preparazione</small></span></div>
        <div className="v-pill"><span className="ic" style={{ background: '#e0a32f' }}><Icon name="inbox" size={16} /></span><span><b>{tot.open}</b><small>righe aperte</small></span></div>
        <button className="v-qb" type="button" onClick={() => setSheet({ t: 'help' })} aria-label="Legenda: come leggere il villaggio">?</button>
      </header>
      {err && <div className="v-err">Non riesco a leggere i dati: {err}. <button type="button" onClick={load}>Riprova</button></div>}
      {!mod && !err && <div className="v-loading">Carico il villaggio…</div>}
      <nav className="v-bar" aria-label="Azioni del villaggio">
        <button className="v-rb" type="button" onClick={() => setSheet({ t: 'wh' })}><span className="c"><Icon name="box" size={28} /></span><span className="t">Magazzino</span></button>
        <button className="v-rb big" type="button" onClick={() => setSheet({ t: 'add', step: 1 })} aria-label="Ordina borse"><span className="c"><Icon name="plus" size={36} /></span><span className="t">Ordina</span></button>
        <button className="v-rb" type="button" onClick={() => setSheet({ t: 'labs' })}><span className="c"><Icon name="store" size={28} /></span><span className="t">Laboratori</span></button>
      </nav>
      {toastMsg && <div className="v-toast" role="status"><b>Ginni</b>{toastMsg}</div>}
      {say.length > 0 && say[0] !== '__fatto__' && (
        <div className="v-dlg" role="dialog" aria-label="Ginni ti spiega il villaggio" onClick={avantiDialogo}>
          <span className="tag">Ginni</span><p>{typed}</p><span className="more" aria-hidden="true">▼</span>
        </div>
      )}
      <section className={'v-sheet' + (P ? ' open ' + P.cls : '')} aria-hidden={!P}>
        {P && <>
          <div className="v-grab" />
          <div className="v-shead">{P.head}<button className="v-x" type="button" onClick={chiudi} aria-label="Chiudi">✕</button></div>
          <div className="v-sbody">{P.body}</div>
        </>}
      </section>
    </div>
  );
}
