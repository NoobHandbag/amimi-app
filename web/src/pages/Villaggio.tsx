import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import Icon from '../components/Icon';
import { fetchInventory, fetchOrdiniGruppi, oggi } from '../lib/api';
import type { OrdLine } from '../lib/api';
import { ArrivoRow } from './Ordini';
import SupplierOrderForm from '../components/SupplierOrderForm';
import { PEOPLE, personaName } from '../lib/people';
import { killBack, popBack, pushBack } from '../lib/backnav';
import { MODEL_ORDER, FIN_IT, PRINT_IT, arriviFra, conTaglia, costruisci, giorniAllaConsegna, modelOf } from '../lib/villaggio/catalogo';
import type { Lab, Look, Mod, Modello, Pila } from '../lib/villaggio/catalogo';
import { Mondo, labColor, swatchURL, thumbAsync } from '../lib/villaggio/mondo';
import type { RigaMondo } from '../lib/villaggio/mondo';
import '@fontsource/fredoka/400.css';
import '@fontsource/fredoka/500.css';
import '@fontsource/fredoka/600.css';
import '@fontsource/fredoka/700.css';
import '@fontsource/nunito/700.css';
import '@fontsource/nunito/800.css';
import '../styles/villaggio.css';

// Villaggio (16-10): la stessa gestione ordini e magazzino, vista come un'isola in stile FarmVille / Animal Crossing.
// LEGGE le stesse viste di Ordini e Magazzino (v_ordini_arrivo, v_inventory). SCRIVE solo attraverso i componenti di
// Ordini: ArrivoRow (arrivi, con le sue conferme su mese chiuso, doppio arrivo e totale atteso) e SupplierOrderForm
// (ordine nuovo). Nessuna chiamata a write-api nasce qui: e' una vista parallela, non un secondo modo di scrivere.
// Interruttore: app_flags.villaggio_enabled (migr 0162), letto da App.tsx e da villaggio-main.tsx.

type Sheet = { t: 'lab'; key: string } | { t: 'wh'; model?: Modello } | { t: 'labs' } | { t: 'help' }
  | { t: 'add'; step: 1 | 2 | 3 | 4; lab?: string; model?: Modello; pila?: string; codice?: string } | null;

const INTRO_KEY = 'amimi_villaggio_intro';
const dataBreve = (iso: string | null | undefined) => (iso ? new Date(String(iso).slice(0, 10) + 'T12:00:00').toLocaleDateString('it-IT', { day: 'numeric', month: 'long' }) : '');
const righe = (n: number) => (n === 1 ? '1 riga' : n + ' righe');
const css = (c: number) => ({ '--c': '#' + c.toString(16).padStart(6, '0') }) as CSSProperties;

function Thumb({ model, look }: { model: Modello; look: Look }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => { let on = true; const via = thumbAsync(model, look, (u) => { if (on) setSrc(u); }); return () => { on = false; via(); }; }, [model, look]);
  return src ? <img className="v-th" src={src} alt="" /> : <span className="v-th" />;
}

function Pezzi({ a, o }: { a: number; o: number }) {
  const unit = Math.max(1, Math.ceil(o / 20)), n = Math.ceil(o / unit), on = Math.floor(a / unit);
  return <div className="v-pz" aria-hidden="true">{Array.from({ length: n }, (_, i) => <i key={i} className={i < on ? 'on' : ''} />)}</div>;
}

/** Il fumetto di Ginni con il testo che si scrive da solo: stato proprio, cosi' la pagina non rifa' il render a ogni lettera. */
function Dialogo({ testo, onAvanti }: { testo: string; onAvanti: () => void }) {
  const ridotto = useMemo(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches, []);
  const [k, setK] = useState(ridotto ? testo.length : 0);
  const tutto = ridotto || k >= testo.length;
  useEffect(() => {
    if (tutto) return;
    const id = window.setInterval(() => setK((x) => Math.min(testo.length, x + 1)), 22);
    return () => window.clearInterval(id);
  }, [testo, tutto]);
  return (
    <button type="button" className="v-dlg" aria-label={'Ginni: ' + testo} onClick={() => (tutto ? onAvanti() : setK(testo.length))}>
      <span className="tag">Ginni</span><span className="v-dlgp" aria-hidden="true">{ridotto ? testo : testo.slice(0, k)}</span><span className="more" aria-hidden="true">▼</span>
    </button>
  );
}

export default function Villaggio({ pin, chi, setChi, onBack }: { pin: string; chi: string; setChi?: (c: string) => void; onBack: () => void }) {
  const sceneRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const hudRef = useRef<HTMLElement>(null);
  const sbodyRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const mondoRef = useRef<Mondo | null>(null);
  const [mod, setMod] = useState<Mod | null>(null);
  const prevArrived = useRef<Map<string, number>>(new Map());
  const prevMod = useRef<Mod | null>(null);
  const ultima = useRef(0);
  const [err, setErr] = useState<string | null>(null);
  const [noGl, setNoGl] = useState(false);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [openLine, setOpenLine] = useState<string | null>(null);
  const [say, setSay] = useState<string[]>([]);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [furgoni, setFurgoni] = useState(0);
  const sheetRef = useRef<Sheet>(null);
  useEffect(() => { sheetRef.current = sheet; }, [sheet]);

  const toast = useCallback((m: string) => { setToastMsg(m); window.setTimeout(() => setToastMsg((x) => (x === m ? null : x)), 3200); }, []);

  // Il modulo dell'ordine (passo 4) toccato non si perde senza chiedere: vale per Esc, "indietro", la X, le etichette
  // della mappa e la barra in basso. La mappa al passo 4 non chiude proprio (W.onTap).
  const formSporco = useRef(false);
  const lascia = useCallback(() => {
    const s = sheetRef.current;
    if (!s || s.t !== 'add' || s.step !== 4 || !formSporco.current) return true;
    if (!window.confirm("Lasci l'ordine a metà? Quello che hai scritto si perde.")) return false;
    formSporco.current = false;
    return true;
  }, []);
  // Pannelli e gesto "indietro" di Android (lib/backnav): aprire da chiuso spinge una voce, chiudere la consuma. La X
  // chiude subito e lascia in volo un history.back() (`backPendenti`). Quello che si chiede mentre il back e' in volo
  // (riaprire un pannello, la Home) aspetta che arrivi (`dopoIlBack`): Chromium fissa la meta del back quando lo si
  // chiama, quindi una voce spinta prima verrebbe scavalcata (pannello senza "indietro", X che esce dal Villaggio) e
  // la voce del cambio di scheda di App verrebbe consumata (rimbalzo nel Villaggio).
  const pushed = useRef<(() => void)[]>([]);
  const backPendenti = useRef(0);
  const dopoIlBack = useRef<(() => void) | null>(null);
  const attesa = useRef(0);
  const quandoArrivaIlBack = useCallback((f: () => void) => {
    if (backPendenti.current === 0) { f(); return; }
    dopoIlBack.current = f;
    // rete: se il popstate non arrivasse (history toccata da altri), dopo 2 s si procede comunque
    window.clearTimeout(attesa.current);
    attesa.current = window.setTimeout(() => { backPendenti.current = 0; const g = dopoIlBack.current; dopoIlBack.current = null; g?.(); }, 2000);
  }, []);
  const apriRef = useRef<(s: Exclude<Sheet, null>) => void>(() => {});
  const apri = useCallback((s: Exclude<Sheet, null>) => {
    if (backPendenti.current > 0) { quandoArrivaIlBack(() => apriRef.current(s)); return; }
    if (sheetRef.current && !lascia()) return;
    if (!sheetRef.current) {
      const fn = () => {
        if (backPendenti.current > 0) {
          if (--backPendenti.current === 0) { window.clearTimeout(attesa.current); const g = dopoIlBack.current; dopoIlBack.current = null; g?.(); }
          return;
        }
        if (!lascia()) { pushed.current.push(fn); pushBack(fn); return; }
        sheetRef.current = null; setSheet(null);
      };
      pushed.current.push(fn); pushBack(fn);
    }
    formSporco.current = false;
    sheetRef.current = s;
    setSheet(s);
  }, [lascia, quandoArrivaIlBack]);
  useEffect(() => { apriRef.current = apri; }, [apri]);
  const chiudi = useCallback(() => {
    if (!sheetRef.current || !lascia()) return;
    sheetRef.current = null; setSheet(null);
    let subito = false;
    popBack(() => { subito = true; });
    if (!subito) backPendenti.current++;
  }, [lascia]);
  useEffect(() => () => window.clearTimeout(attesa.current), []);
  useEffect(() => () => killBack(pushed.current), []);

  // carica (o ricarica dopo una scrittura); se qualche riga ha nuovi arrivi fa partire il furgoncino.
  // Conta solo l'ultima lettura partita: una risposta vecchia non sovrascrive quella nuova.
  const load = useCallback(async () => {
    const mia = ++ultima.current;
    try {
      const [g, inv] = await Promise.all([fetchOrdiniGruppi(), fetchInventory()]);
      if (mia !== ultima.current) return;
      const m = costruisci(g, inv, oggi());
      const arrivi = arriviFra(prevArrived.current, prevMod.current, m, g);
      prevArrived.current = new Map(g.flatMap((gr) => gr.righe.map((l) => [l.id, Number(l.qty_arrived) || 0] as [string, number])));
      prevMod.current = m;
      setMod(m); setErr(null);
      const W = mondoRef.current;
      if (W) {
        // il molo e' quello del capannone dopo l'aggiornamento (i posti scorrono quando un laboratorio sparisce); quello
        // letto prima serve solo se il capannone non c'e' piu' (ha chiuso la sua ultima riga)
        const prima = arrivi.map((x) => W.dockOf(x.lab));
        W.aggiorna(m.dati);
        arrivi.forEach((x, i) => {
          W.arrivo(W.dockOf(x.lab) ?? prima[i], x.riga, x.n, m.codeToPila.get(x.riga.codice) ?? '');
          toast(`${x.n} ${x.riga.model} ${x.riga.label.replace(/ \(WIP\)$/, '').toLowerCase()} in magazzino.`);
        });
      }
    } catch (e) { if (mia === ultima.current) setErr((e as Error).message); }
  }, [toast]);

  // il mondo 3D vive finche' la pagina e' montata; senza WebGL resta un messaggio, non una pagina bianca
  useEffect(() => {
    const box = sceneRef.current, lb = labelsRef.current;
    if (!box || !lb) return;
    let W: Mondo;
    try {
      W = new Mondo(box, lb, hudRef.current, {
        onLab: (key) => apri({ t: 'lab', key }),
        onMagazzino: (model) => apri({ t: 'wh', model }),
        onGinni: () => setSay((s) => (s.length ? s : ['__fatto__'])),
        onCarro: () => toast('Con il furgoncino porto le borse dai laboratori al magazzino.'),
        onPartenza: () => setFurgoni((n) => n + 1),
      });
    } catch { setNoGl(true); return; }
    // tocco sull'isola con un pannello aperto: lo chiude, tranne il modulo dell'ordine (non si perde a meta')
    W.onTap = () => { const s = sheetRef.current; if (!s || (s.t === 'add' && s.step === 4)) return; chiudi(); };
    mondoRef.current = W;
    prevMod.current = null;
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
  }, [load, toast, apri, chiudi]);

  // pannello aperto -> camera e contesto del mondo; cambiando pannello la riga d'arrivo si richiude e Ginni tace
  const sheetId = sheet ? sheet.t + ':' + (sheet.t === 'lab' ? sheet.key : sheet.t === 'wh' ? sheet.model ?? '' : '') : '';
  useEffect(() => {
    setOpenLine(null);
    const s = sheetRef.current;
    if (s) setSay([]);
    const W = mondoRef.current;
    if (!W) return;
    if (!s) { W.ripristina(); return; }
    if (s.t === 'lab') W.focusLab(s.key);
    else if (s.t === 'wh') W.focusMagazzino(s.model);
    else W.setCtx({ type: s.t });
  }, [sheetId]);
  useEffect(() => {
    const s = sheetRef.current;
    if (!s) return;
    closeRef.current?.focus({ preventScroll: true });
    if (s.t !== 'wh' || !s.model) return;
    const model = s.model;
    const id = requestAnimationFrame(() => {
      const b = sbodyRef.current, el = b?.querySelector<HTMLElement>(`[data-model="${model}"]`);
      if (b && el) b.scrollTop += el.getBoundingClientRect().top - b.getBoundingClientRect().top - 8;
    });
    return () => cancelAnimationFrame(id);
  }, [sheetId]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !sheetRef.current) return;
      // Esc dentro un campo resta al campo (svuotarlo, chiudere un menu): il pannello si chiude da fuori dei campi
      if ((e.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      chiudi();
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [chiudi]);

  // fatti veri per Ginni, calcolati dai dati
  const fatti = useMemo(() => {
    if (!mod) return [];
    const out: string[] = [];
    let peggio: { r: OrdLine; lab: Lab; d: number } | null = null;
    for (const L of mod.labs) for (const r of L.raw) {
      const d = giorniAllaConsegna(r.data_consegna, oggi());
      if (d != null && d < 0 && (!peggio || d < peggio.d)) peggio = { r, lab: L, d };
    }
    if (peggio) out.push(`${modelOf(peggio.r.item, peggio.r.variant).model ?? peggio.r.item} ${conTaglia(peggio.r.variant).toLowerCase()} di ${peggio.lab.nome} doveva arrivare il ${dataBreve(peggio.r.data_consegna)}: mancano ${peggio.r.mancano} pezzi.`);
    const grande = [...mod.labs].sort((a, b) => b.pz - a.pz)[0];
    if (grande && grande.pz > 0) out.push(`${grande.nome} ha ${grande.pz} pezzi in preparazione.`);
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

  const lab = sheet?.t === 'lab' ? mod?.labs.find((l) => l.key === sheet.key) : undefined;
  const labIndex = (key: string) => (mod ? Math.max(0, mod.labs.findIndex((l) => l.key === key)) : 0);
  const tot = mod?.tot ?? { stock: 0, prep: 0, open: 0, fuori: 0 };
  const stockDi = (codice: string | undefined) => (codice && mod ? mod.stockCodice.get(codice) ?? 0 : 0);

  const openByCodice = useMemo(() => {
    const m = new Map<string, OrdLine[]>();
    for (const L of mod?.labs ?? []) for (const l of [...L.raw, ...L.extra]) { const a = m.get(l.codice) ?? []; a.push(l); m.set(l.codice, a); }
    return m;
  }, [mod]);

  function rigaLab(r: RigaMondo, raw: OrdLine) {
    const aperta = openLine === r.id;
    const d = giorniAllaConsegna(raw.data_consegna, oggi());
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
                : <span className="v-chip ok">consegna {dataBreve(raw.data_consegna)}</span>}
            <span className={'v-chip stock' + (stockDi(r.codice) < 0 ? ' neg' : '')}>in magazzino {stockDi(r.codice)}</span>
          </div>
        </div>
        <button className={'v-btn sm' + (aperta ? ' ghost' : '')} type="button" aria-expanded={aperta} onClick={() => setOpenLine(aperta ? null : r.id)}>{aperta ? 'Chiudi' : 'Arrivate'}</button>
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
      if (!lab) return { head: <div className="v-ht"><h2 id="v-sheet-title">Laboratorio</h2></div>, body: <p className="v-empty">Questo laboratorio non ha più righe aperte.</p>, cls: 'labsheet' };
      const gruppi = new Map<string, { r: RigaMondo; raw: OrdLine }[]>();
      const resto = (r: RigaMondo) => (r.wip ? 0 : r.o - r.a);
      lab.righe.map((r, i) => ({ r, raw: lab.raw[i] }))
        .sort((x, y) => (y.r.late ? 1000 : 0) - (x.r.late ? 1000 : 0) + (resto(y.r) - resto(x.r)) * 0.001)
        .forEach((x) => { const a = gruppi.get(x.r.model) ?? []; a.push(x); gruppi.set(x.r.model, a); });
      return {
        cls: 'labsheet',
        head: <><span className="v-hic" style={css(labColor(labIndex(lab.key)))}><Icon name="store" size={22} /></span>
          <div className="v-ht"><h2 id="v-sheet-title">{lab.nome} sta preparando</h2><p>{lab.tipo ? `Laboratorio ${lab.tipo} · ` : ''}{righe(lab.raw.length + lab.extra.length)}, {lab.pz} pz da arrivare</p></div></>,
        body: <>
          {[...gruppi.entries()].map(([m, xs]) => (
            <div key={m}>
              <div className="v-gh"><b>{m}</b><small>{xs.length} {xs.length === 1 ? 'variante' : 'varianti'} · {xs.reduce((s, x) => s + resto(x.r), 0)} pz da arrivare</small></div>
              <div className="v-list">{xs.map((x) => rigaLab(x.r, x.raw))}</div>
            </div>
          ))}
          {lab.extra.length > 0 && (
            <div>
              <div className="v-gh"><b>Altri prodotti</b><small>modelli che il villaggio non sa ancora disegnare</small></div>
              <div className="v-list v-arrivo">{lab.extra.map((l) => <ArrivoRow key={l.id} l={l} pin={pin} chi={chi} reload={load} altri={(openByCodice.get(l.codice) ?? []).filter((x) => x.id !== l.id)} />)}</div>
            </div>
          )}
          <p className="v-note">Nel capannone c'è un carrello per variante: la pila è quanto deve ancora arrivare (una lastra = 2 pezzi). Gli arrivi si registrano con la stessa riga di Ordini.</p>
          {lab.forn
            ? <button className="v-btn alt wide" type="button" onClick={() => apri({ t: 'add', step: 2, lab: lab.key })}>+ Ordina a {lab.nome}</button>
            : <button className="v-btn alt wide" type="button" onClick={() => apri({ t: 'add', step: 1 })}>+ Ordina borse</button>}
        </>,
      };
    }
    if (sheet.t === 'wh') {
      return {
        cls: 'short',
        head: <><span className="v-hic" style={css(0xe57f9d)}><Icon name="box" size={22} /></span><div className="v-ht"><h2 id="v-sheet-title">Magazzino</h2><p>{tot.stock} pezzi · una pila per variante, più è alta più pezzi ci sono</p></div></>,
        body: <>{MODEL_ORDER.map((m) => {
          const ps = mod.dati.pile.filter((p) => p.model === m).sort((a, b) => b.stock - a.stock);
          if (!ps.length) return null;
          const t = ps.reduce((s, p) => s + Math.max(0, p.stock), 0);
          const low = ps.filter((p) => p.stock > 0 && p.stock <= 2).length, out = ps.filter((p) => p.stock <= 0).length;
          return (
            <div key={m} data-model={m}>
              <h3 className="v-sec">{m}<small>{t} pz · {ps.length} varianti{low ? ` · ${low} quasi finite` : ''}{out ? ` · ${out} finite` : ''}</small></h3>
              <div className="v-vgrid">{ps.map((p) => {
                const st = Math.max(0, p.stock);
                return (
                  <button key={p.key} type="button" className={'v-vt' + (p.stock < 0 || p.neg ? ' neg' : st === 0 ? ' out' : st <= 2 ? ' low' : '')}
                    onClick={() => { chiudi(); window.setTimeout(() => mondoRef.current?.focusPila(p.key), 30); }}>
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
        head: <><span className="v-hic" style={css(0xc8643f)}><Icon name="store" size={22} /></span><div className="v-ht"><h2 id="v-sheet-title">Laboratori</h2><p>Le borse in preparazione, laboratorio per laboratorio</p></div></>,
        body: <div className="v-list">{mod.labs.map((L, i) => {
          const late = L.righe.filter((r) => r.late).length;
          return (
            <button key={L.key} type="button" className="v-lrow" onClick={() => apri({ t: 'lab', key: L.key })}>
              <span className="v-hic" style={css(labColor(i))}>{L.nome.slice(0, 1)}</span>
              <span><b>{L.nome}</b><small>{L.tipo ? L.tipo + ' · ' : ''}{righe(L.raw.length + L.extra.length)} · {L.pz} pz</small></span>
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
        head: <><span className="v-hic" style={css(0xe0a32f)}>?</span><div className="v-ht"><h2 id="v-sheet-title">Come leggere il villaggio</h2><p>Forma = modello · finitura = materiale · colore = colore</p></div></>,
        body: <>
          <h3 className="v-sec">La forma dice il modello</h3>
          <div className="v-lg">{MODEL_ORDER.map((m) => { const p = rapp(m); return p ? <div key={m}><Thumb model={m} look={p.look} /><b>{m}</b></div> : null; })}</div>
          <h3 className="v-sec">La finitura dice il materiale</h3>
          <div className="v-lg">{fins.map((p) => <div key={p.key}><span className="v-sq" style={{ backgroundImage: `url(${swatchURL(p.look)})` }} /><b>{p.look.print ? PRINT_IT[p.look.print] : FIN_IT[p.look.fin]}</b>{p.model}</div>)}</div>
          <h3 className="v-sec">I segnali</h3>
          <div className="v-sig"><span className="mk" style={{ background: '#f2b84b' }} /><span><b>Anello giallo sotto la pila</b>Quasi finita: 1 o 2 pezzi.</span></div>
          <div className="v-sig"><span className="mk" style={{ background: '#9fd3ec' }} /><span><b>Borsa trasparente su anello azzurro</b>Finita in magazzino, ma c'è un ordine aperto.</span></div>
          <div className="v-sig"><span className="mk" style={{ background: '#e0574b' }} /><span><b>Anello rosso</b>Giacenza negativa: venduta senza carico, da sistemare.</span></div>
          <div className="v-sig"><span className="mk" style={{ background: '#e0574b', borderRadius: '4px 50% 50% 4px' }} /><span><b>Bandierina rossa sul carrello</b>Quella variante ha passato la data di consegna.</span></div>
          <div className="v-sig"><span className="mk" style={{ background: '#eee' }} /><span><b>Pile e carrelli</b>Ogni lastra vale 2 pezzi, ovunque. In magazzino la pila è quello che c'è, nei laboratori quello che deve ancora arrivare.</span></div>
        </>,
      };
    }
    // ordine nuovo: si sceglie con le figure, poi si compila il modulo vero di Ordini
    const s = sheet;
    const passi = ['A chi lo ordini?', 'Che modello?', 'Che materiale e colore?', 'Quantità e prezzo'];
    const L = s.lab != null ? mod.labs.find((x) => x.key === s.lab) : undefined;
    const P = s.pila ? mod.pile.get(s.pila) : undefined;
    const C = P?.codes.find((c) => c.codice === s.codice);
    return {
      cls: s.step === 4 ? 'tall' : '',
      head: <><span className="v-hic plus"><Icon name="plus" size={22} /></span><div className="v-ht"><h2 id="v-sheet-title">Ordina borse</h2><p>{passi[s.step - 1]}</p></div></>,
      body: <>
        <div className="v-dots">{[1, 2, 3, 4].map((i) => <i key={i} className={i <= s.step ? 'on' : ''} />)}</div>
        {s.step === 1 && <div className="v-tiles">
          {mod.labs.filter((x) => x.forn).map((x) => <button key={x.key} type="button" className="v-tile" onClick={() => setSheet({ ...s, step: 2, lab: x.key })}><span className="v-hic" style={css(labColor(labIndex(x.key)))}>{x.nome.slice(0, 1)}</span><b>{x.nome}</b><small>{x.tipo}</small></button>)}
          <button type="button" className="v-tile" onClick={() => setSheet({ ...s, step: 2, lab: undefined })}><span className="v-hic">…</span><b>Un altro</b><small>lo scegli nel modulo</small></button>
        </div>}
        {s.step === 2 && <>
          <button className="v-back" type="button" onClick={() => setSheet({ ...s, step: 1 })}>‹ {L?.forn ? `Cambia fornitore (${L.nome})` : 'Cambia fornitore'}</button>
          <div className="v-tiles">{MODEL_ORDER.map((m) => { const p = [...mod.pile.values()].filter((x) => x.model === m).sort((a, b) => b.stock - a.stock)[0]; return p ? <button key={m} type="button" className="v-tile" onClick={() => setSheet({ ...s, step: 3, model: m })}><Thumb model={m} look={p.look} /><b>{m}</b></button> : null; })}</div>
        </>}
        {s.step === 3 && s.model && (() => {
          // due codici con la stessa figura e lo stesso nome (MILITARY_GREEN / GREEN_MILITARY): si distinguono dal codice
          const voci = [...mod.pile.values()].filter((p) => p.model === s.model).sort((a, b) => b.stock - a.stock)
            .flatMap((p) => p.codes.map((c) => ({ p, c, nome: p.codes.length > 1 ? conTaglia(c.variant) : p.name })));
          const quanti = new Map<string, number>();
          voci.forEach((v) => quanti.set(v.nome, (quanti.get(v.nome) ?? 0) + 1));
          return <>
            <button className="v-back" type="button" onClick={() => setSheet({ ...s, step: 2 })}>‹ Cambia modello ({s.model})</button>
            <div className="v-vgrid">{voci.map(({ p, c, nome }) => (
              <button key={c.codice} type="button" className="v-vt" onClick={() => { formSporco.current = false; setSheet({ ...s, step: 4, pila: p.key, codice: c.codice }); }}>
                <Thumb model={p.model} look={p.look} /><small>{nome}</small>{(quanti.get(nome) ?? 0) > 1 && <small className="cod">{c.codice}</small>}<small>in magazzino {c.stock}</small>
              </button>
            ))}</div>
          </>;
        })()}
        {s.step === 4 && P && <>
          <button className="v-back" type="button" onClick={() => { if (lascia()) setSheet({ ...s, step: 3 }); }}>‹ Cambia colore</button>
          <div className="v-qty"><Thumb model={P.model} look={P.look} /><div><b>{P.model} · {C ? conTaglia(C.variant) : P.name}</b><small>{s.codice} · {L?.forn ? `da ${L.nome}` : 'scegli il fornitore qui sotto'} · in magazzino {stockDi(s.codice)}</small></div></div>
          <div className="v-form" onInput={() => { formSporco.current = true; }} onClick={() => { formSporco.current = true; }}>
            <SupplierOrderForm pin={pin} chi={chi} initialForn={L?.forn ?? undefined} initialCodice={s.codice}
              onDone={() => {
                load(); toast('Ordine salvato: lo trovi anche in Ordini.');
                // il modulo chiama onDone 700 ms dopo il salvataggio: conta solo se si e' ancora su QUESTO passo 4
                if (sheetRef.current !== s) return;
                formSporco.current = false;
                sheetRef.current = { t: 'labs' }; setSheet({ t: 'labs' });
              }} />
          </div>
        </>}
      </>,
    };
  }
  const P = pannello();

  return (
    <div className="vil" data-furgoni={furgoni}>
      <div ref={sceneRef} className="v-scene" />
      <div ref={labelsRef} className="v-labels" />
      <header ref={hudRef} className="v-hud">
        <button className="v-pill v-home" type="button" onClick={() => { if (lascia()) quandoArrivaIlBack(onBack); }} aria-label="Torna alla Home"><Icon name="home" size={20} /></button>
        {!noGl && <>
          <div className="v-pill"><span className="ic" style={{ background: '#e57f9d' }}><Icon name="bag" size={16} /></span><span><b>{tot.stock}</b><small>in magazzino</small></span></div>
          <div className="v-pill"><span className="ic" style={{ background: '#c8643f' }}><Icon name="store" size={16} /></span><span><b>{tot.prep}</b><small>in preparazione</small></span></div>
          <div className="v-pill"><span className="ic" style={{ background: '#e0a32f' }}><Icon name="inbox" size={16} /></span><span><b>{tot.open}</b><small>righe aperte</small></span></div>
          {setChi
            ? <label className="v-pill v-chi"><span><small>scrive</small>
                <select value={chi} onChange={(e) => setChi(e.target.value)} aria-label="Chi scrive">
                  {(PEOPLE as readonly string[]).includes(chi) ? null : <option value={chi}>{personaName(chi)}</option>}
                  {PEOPLE.map((p) => <option key={p} value={p}>{personaName(p)}</option>)}
                </select></span></label>
            : <div className="v-pill v-chi" aria-label={`Scrive ${personaName(chi)}`}><span><small>scrive</small><b>{personaName(chi)}</b></span></div>}
          <button className="v-qb" type="button" onClick={() => apri({ t: 'help' })} aria-label="Legenda: come leggere il villaggio">?</button>
        </>}
      </header>
      {noGl && (
        <div className="v-err">Questo dispositivo non riesce a disegnare il villaggio (manca il WebGL). Ordini e Magazzino funzionano come sempre.
          <button type="button" onClick={onBack}>Torna alla Home</button></div>
      )}
      {err && !noGl && <div className="v-err">Non riesco a leggere i dati: {err}. <button type="button" onClick={load}>Riprova</button></div>}
      {!mod && !err && !noGl && <div className="v-loading">Carico il villaggio…</div>}
      {!noGl && <nav className="v-bar" aria-label="Azioni del villaggio">
        <button className="v-rb" type="button" onClick={() => apri({ t: 'wh' })}><span className="c"><Icon name="box" size={28} /></span><span className="t">Magazzino</span></button>
        <button className="v-rb big" type="button" onClick={() => apri({ t: 'add', step: 1 })} aria-label="Ordina borse"><span className="c"><Icon name="plus" size={36} /></span><span className="t">Ordina</span></button>
        <button className="v-rb" type="button" onClick={() => apri({ t: 'labs' })}><span className="c"><Icon name="store" size={28} /></span><span className="t">Laboratori</span></button>
      </nav>}
      {toastMsg && <div className="v-toast" role="status"><b>Ginni</b>{toastMsg}</div>}
      {say.length > 0 && say[0] !== '__fatto__' && <Dialogo key={say[0]} testo={say[0]} onAvanti={() => setSay((x) => x.slice(1))} />}
      <section className={'v-sheet' + (P ? ' open ' + P.cls : '')} role="dialog" aria-modal="false" aria-labelledby="v-sheet-title" aria-hidden={!P}>
        {P && <>
          <div className="v-grab" />
          <div className="v-shead">{P.head}<button ref={closeRef} className="v-x" type="button" onClick={chiudi} aria-label="Chiudi">✕</button></div>
          <div ref={sbodyRef} className="v-sbody">{P.body}</div>
        </>}
      </section>
    </div>
  );
}
