import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, RefObject } from 'react';
import Icon from '../components/Icon';
import { fetchInventory, fetchOrdiniGruppi, fetchVillaggioEventi, oggi, segnaPresenza, verificaFornitore } from '../lib/api';
import type { InvFull, OrdGruppo, OrdLine } from '../lib/api';
import { ArrivoRow } from './Ordini';
import SupplierOrderForm from '../components/SupplierOrderForm';
import CountForm from '../components/CountForm';
import { PEOPLE, personaName } from '../lib/people';
import { killBack, popBack, pushBack } from '../lib/backnav';
import { MODEL_ORDER, FIN_IT, PRINT_IT, arriviFra, conTaglia, costruisci, giorniAllaConsegna, labOf, modelOf } from '../lib/villaggio/catalogo';
import type { Lab, Look, Mod, Modello, Pila } from '../lib/villaggio/catalogo';
import { Mondo, labColor, swatchURL, thumbAsync } from '../lib/villaggio/mondo';
import type { RigaMondo } from '../lib/villaggio/mondo';
import { LIVELLI, MEDAGLIE, VALORI, calcola, differenza, missioni } from '../lib/villaggio/paillettes';
import type { Evento, Stato } from '../lib/villaggio/paillettes';
import '@fontsource/fredoka/400.css';
import '@fontsource/fredoka/500.css';
import '@fontsource/fredoka/600.css';
import '@fontsource/fredoka/700.css';
import '@fontsource/nunito/700.css';
import '@fontsource/nunito/800.css';
import '../styles/villaggio.css';

// Villaggio (16-10): la stessa gestione ordini e magazzino, vista come un'isola in stile FarmVille / Animal Crossing.
// LEGGE le stesse viste di Ordini e Magazzino (v_ordini_arrivo, v_inventory). SCRIVE solo attraverso i componenti di
// Ordini e Magazzino: ArrivoRow (arrivi, con le sue conferme su mese chiuso, doppio arrivo e totale atteso),
// SupplierOrderForm (ordine nuovo) e CountForm (giro di conta). Le Paillettes (fase 2, migr 0163) aggiungono le loro due
// sole scritture, la presenza e la verifica fornitore, con segnaPresenza e verificaFornitore di lib/api; i punti non si
// scrivono da nessuna parte, si ricalcolano da v_villaggio_eventi con lib/villaggio/paillettes.ts.
// Interruttori: app_flags.villaggio_enabled (migr 0162) e villaggio_paillettes_enabled, letti da App.tsx e da VillaggioApp.tsx.

type Sheet = { t: 'lab'; key: string } | { t: 'wh'; model?: Modello } | { t: 'labs' } | { t: 'help' }
  | { t: 'add'; step: 1 | 2 | 3 | 4; lab?: string; model?: Modello; pila?: string; codice?: string }
  | { t: 'percorso' } | { t: 'missioni' } | { t: 'verifica'; lab: string } | { t: 'giro'; codici: string[] } | null;

const INTRO_KEY = 'amimi_villaggio_intro';
const PRESENZA_KEY = 'amimi_villaggio_presenza';
const dataBreve = (iso: string | null | undefined) => (iso ? new Date(String(iso).slice(0, 10) + 'T12:00:00').toLocaleDateString('it-IT', { day: 'numeric', month: 'long' }) : '');
const righe = (n: number) => (n === 1 ? '1 riga' : n + ' righe');
const css = (c: number) => ({ '--c': '#' + c.toString(16).padStart(6, '0') }) as CSSProperties;
/** "1.240": il punto delle migliaia anche a 4 cifre, come il "+n" di Mondo.puntiFlottanti. */
const migliaia = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
/** Il premio che ogni livello mette sull'isola (Mondo.setLivello): Ginni lo dice quando si sale. */
const PREMI = ['', 'Lungo i sentieri sono spuntate le aiuole fiorite.', 'Davanti al magazzino c\'è una fontana nuova.',
  'Sono arrivati i lampioni e una panchina.', 'Ora c\'è il chiosco-boutique con la tenda a righe rosa.',
  'Guarda in cielo: c\'è una mongolfiera rosa.', 'Corona d\'oro e tappeto rosso fino al magazzino.'];
const GIORNI = ['L', 'M', 'M', 'G', 'V'];

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

/** Per le voci del percorso: il prodotto di un codice o di una riga d'ordine, il laboratorio di un ordine. */
function dettagli(gruppi: OrdGruppo[], inv: InvFull[]) {
  const nome = (item: string | null, variant: string | null) => { const mv = modelOf(item, variant); return (mv.model ?? item ?? '') + ' ' + conTaglia(mv.variant).toLowerCase(); };
  const m = new Map<string, string>();
  for (const r of inv) m.set('c:' + r.codice, nome(r.item, r.variant));
  for (const g of gruppi) {
    m.set('g:' + g.gruppo, 'a ' + labOf(g.fornitore).nome);
    for (const l of g.righe) m.set('r:' + l.id, nome(l.item, l.variant));
  }
  return m;
}

/** Il giro di conta del Magazzino: prima i codici negativi, poi pila per pila come nel pannello (modello, pila piu' alta
 *  prima), in fondo i modelli che il villaggio non disegna. Solo codici con giacenza diversa da 0: la base della conta completa. */
function giroMagazzino(mod: Mod) {
  const neg = [...mod.stockCodice].filter(([, n]) => n < 0).map(([c]) => c);
  const perPila = MODEL_ORDER.flatMap((m) => [...mod.pile.values()].filter((p) => p.model === m).sort((a, b) => b.stock - a.stock)
    .flatMap((p) => p.codes.filter((c) => c.stock !== 0).map((c) => c.codice)));
  const fuori = [...mod.stockCodice].filter(([c, n]) => n !== 0 && !mod.codeToPila.has(c)).map(([c]) => c);
  return [...new Set([...neg, ...perPila, ...fuori])];
}

type Scelta = { confermata?: boolean; data?: string };
/** Verifica con il fornitore: una riga per riga aperta del laboratorio, confermata (acceso di default) e con la data di
 *  consegna attuale da mettere o correggere. La bozza vive qui: cambiando pannello sparisce, quindi toccata la protegge
 *  la stessa guardia del modulo dell'ordine. */
function Verifica({ lab, mod, chi, sporca, onSalvata }: { lab: Lab; mod: Mod; chi: string; sporca: () => void; onSalvata: (dateCambiate: number) => void }) {
  const [scelte, setScelte] = useState<Record<string, Scelta>>({});
  const [nota, setNota] = useState('');
  const [busy, setBusy] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);
  const aperte = [...lab.raw, ...lab.extra];
  const valore = (l: OrdLine) => ({ confermata: scelte[l.id]?.confermata ?? true, data: scelte[l.id]?.data ?? String(l.data_consegna ?? '').slice(0, 10) });
  const cambia = (id: string, x: Scelta) => { sporca(); setScelte((s) => ({ ...s, [id]: { ...s[id], ...x } })); };
  const senzaData = aperte.filter((l) => !valore(l).data).length;
  async function salva() {
    setBusy(true); setErrore(null);
    try {
      const r = await verificaFornitore(chi, {
        fornitore: lab.forn ?? '', nota: nota.trim() || null,
        righe: aperte.map((l) => { const v = valore(l); return { id: l.id, confermata: v.confermata, data_consegna: v.data || null }; }),
      });
      onSalvata(Number(r.date_cambiate) || 0);
    } catch (e) {
      setErrore((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return <>
    <p className="v-note">{righe(aperte.length)}{senzaData ? ` · ${senzaData} senza data` : ''}. Spegni quelle che {lab.nome} non sta lavorando.</p>
    <div className="v-list">{aperte.map((l) => {
      const info = mod.righe.get(l.id), v = valore(l), d = giorniAllaConsegna(l.data_consegna, oggi());
      return (
        <div key={l.id} className={'v-row v-vrow' + (v.confermata ? '' : ' no')}>
          {info ? <Thumb model={info.riga.model} look={info.riga.look} /> : <span className="v-th" />}
          <div className="v-rt">
            <b>{info ? `${info.riga.model} · ${info.riga.label}` : `${l.item ?? l.codice} · ${conTaglia(l.variant)}`}</b>
            <div className="v-meta">
              {l.wip ? 'quantità da definire' : `${Number(l.qty_arrived) || 0} di ${l.qty_ordered ?? '?'} arrivate`}
              {d != null && d < 0 && <span className={'v-chip ' + (-d >= 30 ? 'verylate' : 'late')}>{-d === 1 ? '1 giorno di ritardo' : `${-d} giorni di ritardo`}</span>}
            </div>
          </div>
          <div className="v-vctl">
            <label className="v-sw"><input type="checkbox" checked={v.confermata} onChange={(e) => cambia(l.id, { confermata: e.target.checked })} /><i aria-hidden="true" />{v.confermata ? 'confermata' : 'non confermata'}</label>
            <label className={'v-dt' + (v.data ? '' : ' manca')}><small>{v.data ? 'consegna' : 'manca la data'}</small>
              <input type="date" value={v.data} onChange={(e) => cambia(l.id, { data: e.target.value })} /></label>
          </div>
        </div>
      );
    })}</div>
    <label className="v-fl">Nota (facoltativa)
      <textarea className="v-nota" rows={2} value={nota} onChange={(e) => { sporca(); setNota(e.target.value); }} placeholder={`cosa ti ha detto ${lab.nome}`} /></label>
    {errore && <p className="v-errl" role="alert">{errore}</p>}
    <button className="v-btn wide" type="button" disabled={busy || !aperte.length} onClick={salva}>{busy ? 'Salvo la verifica…' : 'Salva la verifica'}</button>
  </>;
}

/** Giro di conta: un codice alla volta, con la camera sulla sua pila e il CountForm di Magazzino gia' sul prodotto.
 *  Contato (onDone), si passa da soli al prossimo; "Salta" lo lascia com'e', "Avanti" se e' gia' stato contato oggi. */
function Giro({ codici, mod, nomi, contatiOggi, pin, chi, mondo, lascia, sporca, pulisci, onContato, onFine }: {
  codici: string[]; mod: Mod; nomi: Map<string, string>; contatiOggi: Set<string>; pin: string; chi: string; mondo: RefObject<Mondo | null>;
  lascia: () => boolean; sporca: () => void; pulisci: () => void; onContato: () => void; onFine: () => void;
}) {
  const [i, setI] = useState(0);
  const [contati, setContati] = useState(0);
  const codice = codici[i];
  // un onDone arrivato tardi (salvataggio lento e intanto "Salta") vale per il SUO codice: non fa saltare quello dopo
  const attuale = useRef(codice);
  useEffect(() => { attuale.current = codice; }, [codice]);
  const pila = codice ? mod.pile.get(mod.codeToPila.get(codice) ?? '') : undefined;
  const pilaKey = pila?.key;
  useEffect(() => {
    const W = mondo.current;
    if (!W || !pilaKey) return;
    W.focusPila(pilaKey);
    // focusPila toglie il contesto: senza, un tocco sull'isola aprirebbe un laboratorio e lascerebbe il giro
    W.setCtx({ type: 'giro' });
  }, [pilaKey, mondo]);
  if (!codice) {
    return <>
      <p className="v-fine">Giro finito: {contati === 1 ? '1 codice contato' : contati + ' codici contati'} su {codici.length}.</p>
      <button className="v-btn wide" type="button" onClick={onFine}>Chiudi il giro</button>
    </>;
  }
  const voce = pila?.codes.find((c) => c.codice === codice);
  const nome = pila ? pila.model + ' · ' + (voce ? conTaglia(voce.variant) : pila.name) : nomi.get('c:' + codice) ?? codice;
  const gia = contatiOggi.has(codice);
  return <>
    <div className="v-giro"><span className="v-prog"><i style={{ width: (i / codici.length) * 100 + '%' }} /></span><b>{i + 1} / {codici.length}</b></div>
    <div className="v-qty">{pila ? <Thumb model={pila.model} look={pila.look} /> : <span className="v-th" />}
      <div><b>{nome}</b><small>{codice} · in magazzino {mod.stockCodice.get(codice) ?? 0}{gia ? ' · già contato oggi' : ''}</small></div></div>
    <div className="v-form v-conta" onInput={sporca} onClick={sporca}>
      <CountForm key={codice} pin={pin} chi={chi} initialCodice={codice} onDone={() => {
        setContati((n) => n + 1); onContato();
        if (attuale.current !== codice) return;
        pulisci(); setI((x) => x + 1);
      }} />
    </div>
    <button className="v-btn ghost wide" type="button" onClick={() => { if (lascia()) { pulisci(); setI((x) => x + 1); } }}>{gia ? 'Avanti ›' : 'Salta ›'}</button>
  </>;
}

export default function Villaggio({ pin, chi, setChi, onBack, paillettes = false, giocatrice = null }: {
  pin: string; chi: string; setChi?: (c: string) => void; onBack: () => void; paillettes?: boolean; giocatrice?: string | null;
}) {
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

  // Paillettes (fase 2): gioca solo la giocatrice di app_flags. Gli altri vedono i suoi punti, senza presenza ne' missioni.
  const gioca = paillettes && !!giocatrice && chi === giocatrice;
  const giocaRef = useRef(gioca);
  useEffect(() => { giocaRef.current = gioca; }, [gioca]);
  const nomeG = personaName(giocatrice ?? '');
  const [stato, setStato] = useState<Stato | null>(null);
  const [eventi, setEventi] = useState<Evento[] | null>(null);
  const [nomi, setNomi] = useState<Map<string, string>>(() => new Map());
  // i negativi del giorno restano nella missione anche dopo che la conta li ha sistemati, cosi' la si vede fatta
  const [negOggi, setNegOggi] = useState<{ giorno: string; codici: string[] }>({ giorno: '', codici: [] });
  const prevStato = useRef<Stato | null>(null);
  const presenta = useRef(false);

  // il messaggio a video: le paillettes della stessa azione ci si accodano invece di scavalcarlo
  const toastOra = useRef<string | null>(null);
  const toast = useCallback((m: string) => {
    toastOra.current = m; setToastMsg(m);
    window.setTimeout(() => { if (toastOra.current === m) toastOra.current = null; setToastMsg((x) => (x === m ? null : x)); }, 3200);
  }, []);

  // I moduli toccati non si perdono senza chiedere: l'ordine al passo 4, la verifica fornitore e la conta del giro. Vale
  // per Esc, "indietro", la X, le etichette della mappa e la barra in basso; su questi pannelli la mappa non chiude (W.onTap).
  const formSporco = useRef(false);
  const lascia = useCallback(() => {
    const s = sheetRef.current;
    const cosa = !s || !formSporco.current ? null
      : s.t === 'add' && s.step === 4 ? "l'ordine" : s.t === 'verifica' ? 'la verifica' : s.t === 'giro' ? 'la conta' : null;
    if (!cosa) return true;
    if (!window.confirm(`Lasci ${cosa} a metà? Quello che hai scritto si perde.`)) return false;
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
  const sporca = () => { formSporco.current = true; };
  const pulisci = () => { formSporco.current = false; };

  // carica (o ricarica dopo una scrittura); se qualche riga ha nuovi arrivi fa partire il furgoncino.
  // Conta solo l'ultima lettura partita: una risposta vecchia non sovrascrive quella nuova.
  const load = useCallback(async () => {
    const mia = ++ultima.current;
    try {
      // gli eventi delle Paillettes arrivano con la stessa lettura ma per conto loro: se falliscono il villaggio va avanti
      // e i punti restano quelli dell'ultima lettura buona (un errore non e' mai "zero eventi")
      const [g, inv, ev] = await Promise.all([fetchOrdiniGruppi(), fetchInventory(),
        paillettes ? fetchVillaggioEventi().catch((e: Error) => e) : null]);
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
      if (paillettes) {
        setNomi(dettagli(g, inv));
        const giorno = oggi(), neg = [...m.stockCodice].filter(([, n]) => n < 0).map(([c]) => c);
        setNegOggi((x) => ({ giorno, codici: [...new Set([...(x.giorno === giorno ? x.codici : []), ...neg])] }));
        if (Array.isArray(ev)) {
          const st = calcola(ev, giorno, [...m.stockCodice].filter(([, n]) => n !== 0).map(([c]) => c));
          const prima = prevStato.current;
          prevStato.current = st;
          setEventi(ev); setStato(st);
          // i premi sull'isola sono del livello di Ginni per tutti; si festeggia solo chi gioca, e mai alla prima lettura
          // (differenza con prima = null non da' niente)
          if (W && (!prima || st.livello !== prima.livello)) W.setLivello(st.livello);
          const d = differenza(prima, st);
          if (giocaRef.current) {
            if (W && d.punti > 0) W.puntiFlottanti(d.punti);
            if (d.livelloNuovo) {
              if (W) W.festa(d.livelloNuovo);
              setSay([`Sei diventata ${d.livelloNuovo}!`, PREMI[st.livello]].filter(Boolean));
            }
            const avviso = [d.punti > 0 ? `+${migliaia(d.punti)} paillettes` : '', ...d.medaglieNuove.map((x) => `Medaglia nuova: ${x.nome}!`)].filter(Boolean).join(' · ');
            if (avviso) toast(toastOra.current ? toastOra.current + ' ' + avviso : avviso);
          }
        }
      }
    } catch (e) { if (mia === ultima.current) setErr((e as Error).message); }
  }, [toast, paillettes]);

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
    // tocco sull'isola con un pannello aperto: lo chiude, tranne i moduli che non si perdono a meta' (ordine al passo 4,
    // verifica fornitore, giro di conta)
    W.onTap = () => { const s = sheetRef.current; if (!s || (s.t === 'add' && s.step === 4) || s.t === 'verifica' || s.t === 'giro') return; chiudi(); };
    mondoRef.current = W;
    prevStato.current = null;
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

  // Presenza del giorno, solo per chi gioca: una volta al giorno su questo telefono (il server e' comunque idempotente),
  // anche quando la PWA rimasta aperta torna in primo piano il giorno dopo. Se non va (flag spento = 409, niente rete) non
  // succede niente e si riprova alla prossima apertura. Parte dopo la prima lettura, cosi' la rilettura che segue ha un
  // "prima" con cui fare la differenza (il +5 si vede); la prima presenza del giorno fa presentare le missioni a Ginni.
  const pronto = !!mod;
  useEffect(() => {
    if (!gioca || !pronto) return;
    const segna = () => {
      const k = chi + '|' + oggi();
      try { if (localStorage.getItem(PRESENZA_KEY) === k) return; } catch { /* storage non disponibile: decide il server */ }
      segnaPresenza(chi).then((r) => {
        try { localStorage.setItem(PRESENZA_KEY, k); } catch { /* come sopra */ }
        if (r.nuova) { presenta.current = true; load(); }
      }).catch(() => { /* vedi sopra: si riprova alla prossima apertura */ });
    };
    segna();
    const onVis = () => { if (!document.hidden) segna(); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [gioca, pronto, chi, load]);

  // pannello aperto -> camera e contesto del mondo; cambiando pannello la riga d'arrivo si richiude e Ginni tace
  const sheetId = sheet ? sheet.t + ':' + (sheet.t === 'lab' ? sheet.key : sheet.t === 'verifica' ? sheet.lab : sheet.t === 'wh' ? sheet.model ?? '' : '') : '';
  useEffect(() => {
    setOpenLine(null);
    const s = sheetRef.current;
    if (s) setSay([]);
    const W = mondoRef.current;
    if (!W) return;
    if (!s) { W.ripristina(); return; }
    if (s.t === 'lab') W.focusLab(s.key);
    else if (s.t === 'verifica') W.focusLab(s.lab);
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

  // missioni di oggi, solo per chi gioca: le calcola paillettes.ts dai laboratori, dai negativi del giorno e dagli eventi
  const contatiOggi = useMemo(() => new Set((eventi ?? []).filter((e) => e.tipo === 'conta' && e.giorno === oggi()).map((e) => e.ref)), [eventi]);
  const lista = useMemo(() => {
    if (!gioca || !mod || !eventi) return null;
    return missioni({
      labs: mod.labs.map((L) => {
        const tutte = [...L.raw, ...L.extra];
        return { key: L.key, nome: L.nome, forn: L.forn, senzaData: tutte.filter((l) => !l.data_consegna).length,
          righe: tutte.map((l) => ({ late: (giorniAllaConsegna(l.data_consegna, oggi()) ?? 0) < 0, wip: !!l.wip })) };
      }),
      negativi: negOggi.codici, eventi, oggi: oggi(),
    });
  }, [gioca, mod, eventi, negOggi]);
  const daFare = lista ? lista.filter((x) => !x.fatta).length : 0;
  useEffect(() => {
    if (!lista || !presenta.current) return;
    presenta.current = false;
    if (lista.length) setSay((s) => [...s, `Buongiorno! Oggi ${lista.length === 1 ? 'ho una missione' : `ho ${lista.length} missioni`} per te: le trovi sotto la stella.`, ...lista.map((x) => x.testo + '.')]);
  }, [lista]);

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
    if (gioca && stato?.prossimo) out.push(`Ti mancano ${migliaia(stato.prossimo.da - stato.totale)} paillettes per diventare ${stato.prossimo.nome}.`);
    return out;
  }, [mod, gioca, stato]);
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
          {paillettes && lab.forn && <button className="v-btn wide" type="button" onClick={() => apri({ t: 'verifica', lab: lab.key })}>✓ Verifica con {lab.nome}</button>}
          {lab.forn
            ? <button className="v-btn alt wide" type="button" onClick={() => apri({ t: 'add', step: 2, lab: lab.key })}>+ Ordina a {lab.nome}</button>
            : <button className="v-btn alt wide" type="button" onClick={() => apri({ t: 'add', step: 1 })}>+ Ordina borse</button>}
        </>,
      };
    }
    if (sheet.t === 'wh') {
      const giro = paillettes ? giroMagazzino(mod) : [];
      return {
        cls: 'short',
        head: <><span className="v-hic" style={css(0xe57f9d)}><Icon name="box" size={22} /></span><div className="v-ht"><h2 id="v-sheet-title">Magazzino</h2><p>{tot.stock} pezzi · una pila per variante, più è alta più pezzi ci sono</p></div></>,
        body: <>
        {giro.length > 0 && <button className="v-btn wide" type="button" onClick={() => apri({ t: 'giro', codici: giro })}>Giro di conta · {giro.length} codici</button>}
        {MODEL_ORDER.map((m) => {
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
    if (sheet.t === 'percorso') {
      const st = stato;
      const head = <><span className="v-hic" style={css(0xe0a32f)}><Icon name="sparkles" size={22} /></span>
        <div className="v-ht"><h2 id="v-sheet-title">{gioca ? 'Il tuo percorso' : `Il percorso di ${nomeG}`}</h2><p>{st ? `${migliaia(st.totale)} paillettes · ${st.nomeLivello}` : 'Paillettes non ancora lette'}</p></div></>;
      if (!st) return { cls: '', head, body: <p className="v-empty">Le paillettes arrivano con la prossima lettura dei dati.</p> };
      const prese = new Set(st.medaglie.map((x) => x.id));
      return {
        cls: '', head,
        body: <>
          <div className="v-pcard">
            <div className="v-prow">
              <span><b>+{migliaia(st.oggi)}</b><small>oggi</small></span>
              <span><b>{st.serie}</b><small>{st.serie === 1 ? 'giorno di fila' : 'giorni di fila'}</small></span>
              <span className="v-wk" aria-label={`Questa settimana: ${st.settimana.filter(Boolean).length} giorni su 5`}>{GIORNI.map((g, i) => <i key={i} className={st.settimana[i] ? 'on' : ''}>{g}</i>)}</span>
            </div>
            {st.prossimo
              ? <><span className="v-prog big"><i style={{ width: Math.round(st.frazione * 100) + '%' }} /></span><small>Ancora {migliaia(st.prossimo.da - st.totale)} paillettes per {st.prossimo.nome}</small></>
              : <small>{gioca ? 'Livello massimo: sei la regina della produzione.' : `${nomeG} è al livello massimo.`}</small>}
          </div>
          <h3 className="v-sec">I livelli</h3>
          <div className="v-lad">{LIVELLI.map((l, i) => ({ l, i })).reverse().map(({ l, i }) => (
            <div key={l.nome} className={'v-lv' + (i === st.livello ? ' on' : i < st.livello ? ' preso' : '')}>
              <span className="n">{i + 1}</span><b>{l.nome}</b>
              <small>{i === st.livello ? 'adesso' : i === st.livello + 1 ? `mancano ${migliaia(l.da - st.totale)}` : `da ${migliaia(l.da)}`}</small>
            </div>
          ))}</div>
          <h3 className="v-sec">Medaglie<small>{st.medaglie.length} di {MEDAGLIE.length}</small></h3>
          <div className="v-meds">{MEDAGLIE.map((x) => (
            <div key={x.id} className={'v-med' + (prese.has(x.id) ? ' presa' : '')}><span aria-hidden="true">{prese.has(x.id) ? '★' : '☆'}</span><b>{x.nome}</b><small>{x.descrizione}</small></div>
          ))}</div>
          <h3 className="v-sec">Ultime paillettes</h3>
          {st.voci.length
            ? <div className="v-list">{st.voci.slice(0, 15).map((v, k) => {
              const det = v.tipo === 'ordine' ? nomi.get('g:' + v.ref) : v.tipo === 'arrivo' || v.tipo === 'data_aggiunta' ? nomi.get('r:' + v.ref) : v.tipo === 'conta' ? nomi.get('c:' + v.ref) : undefined;
              return <div key={k} className="v-voce"><span className="pt">+{migliaia(v.punti)}</span><span><b>{v.testo}</b><small>{[det, v.giorno === oggi() ? 'oggi' : dataBreve(v.giorno)].filter(Boolean).join(' · ')}</small></span></div>;
            })}</div>
            : <p className="v-empty">Ancora nessuna paillette: arrivano con presenze, ordini, arrivi, verifiche e conte.</p>}
          <h3 className="v-sec">Come si guadagnano</h3>
          <ul className="v-regole">
            <li><b>+{VALORI.presenza}</b> presenza, una al giorno; <b>+{VALORI.settimanaPiena}</b> con la settimana piena, da lunedì a venerdì</li>
            <li><b>+{VALORI.ordine}</b> ordine, più <b>+{VALORI.rigaOrdine}</b> a riga</li>
            <li><b>+{VALORI.arrivo}</b> arrivo registrato, a riga</li>
            <li><b>+{VALORI.verifica}</b> verifica con un laboratorio, una a settimana</li>
            <li><b>+{VALORI.dataAggiunta}</b> data di consegna aggiunta a una riga</li>
            <li><b>+{VALORI.conta}</b> conta di un codice; <b>+{VALORI.contaCompleta}</b> per la conta completa (80% del magazzino in 7 giorni, una al mese)</li>
          </ul>
        </>,
      };
    }
    if (sheet.t === 'missioni') {
      const xs = lista ?? [];
      return {
        cls: 'short',
        head: <><span className="v-hic" style={css(0xe0a32f)}>★</span><div className="v-ht"><h2 id="v-sheet-title">Missioni di oggi</h2>
          <p>{xs.length ? `${xs.length - daFare} di ${xs.length} fatte · ti portano alle cose utili, le paillettes arrivano dalle azioni` : 'Oggi niente da segnalare'}</p></div></>,
        body: xs.length
          ? <div className="v-list">{xs.map((x) => (
            <button key={x.id} type="button" className={'v-lrow v-mrow' + (x.fatta ? ' fatta' : '')}
              onClick={() => apri(x.azione.t === 'verifica' ? { t: 'verifica', lab: x.azione.lab } : { t: 'giro', codici: x.azione.codici })}>
              <span className="v-hic" style={css(x.fatta ? 0x4f9a2f : 0xe0a32f)}>{x.fatta ? <Icon name="check" size={22} /> : '★'}</span>
              <span><b>{x.testo}</b><small>{x.azione.t === 'verifica' ? 'Apri la verifica' : 'Apri il giro di conta'}</small></span>
              {x.fatta ? <span className="v-chip ok">fatta</span> : <span className="v-chip nodate">da fare</span>}
            </button>
          ))}</div>
          : <p className="v-empty">Nessuna missione: laboratori verificati, niente negativi, date a posto.</p>,
      };
    }
    if (sheet.t === 'verifica') {
      const s = sheet, L = mod.labs.find((x) => x.key === s.lab);
      if (!L || !L.forn) {
        return { cls: '', head: <div className="v-ht"><h2 id="v-sheet-title">Verifica</h2></div>,
          body: <p className="v-empty">{L ? 'Senza un fornitore non c\'è nessuno con cui verificare.' : 'Questo laboratorio non ha più righe aperte.'}</p> };
      }
      return {
        cls: 'tall',
        head: <><span className="v-hic" style={css(labColor(labIndex(L.key)))}><Icon name="check" size={22} /></span>
          <div className="v-ht"><h2 id="v-sheet-title">Verifica con {L.nome}</h2><p>Le righe aperte: confermale con {L.nome} e metti o correggi la data di consegna</p></div></>,
        body: <Verifica key={L.key} lab={L} mod={mod} chi={chi} sporca={sporca} onSalvata={(n) => {
          toast(`Verifica con ${L.nome} salvata${n ? `: ${n === 1 ? '1 data aggiornata' : n + ' date aggiornate'}` : ''}.`);
          load();
          // si torna al laboratorio solo se si e' ancora su QUESTA verifica
          if (sheetRef.current !== s) return;
          formSporco.current = false;
          sheetRef.current = { t: 'lab', key: L.key }; setSheet({ t: 'lab', key: L.key });
        }} />,
      };
    }
    if (sheet.t === 'giro') {
      return {
        cls: 'labsheet',
        head: <><span className="v-hic" style={css(0xe57f9d)}><Icon name="count" size={22} /></span>
          <div className="v-ht"><h2 id="v-sheet-title">Giro di conta</h2><p>Conta i pezzi di ogni codice: contato, si passa al prossimo</p></div></>,
        body: <Giro key={sheet.codici.join(' ')} codici={sheet.codici} mod={mod} nomi={nomi} contatiOggi={contatiOggi} pin={pin} chi={chi}
          mondo={mondoRef} lascia={lascia} sporca={sporca} pulisci={pulisci} onContato={load} onFine={chiudi} />,
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
          {paillettes && stato && (
            <button className="v-pill v-pai" type="button" onClick={() => apri({ t: 'percorso' })}
              aria-label={`${gioca ? 'Le tue paillettes' : 'Paillettes di ' + nomeG}: ${migliaia(stato.totale)}, livello ${stato.nomeLivello}`}>
              <span className="ic"><Icon name="sparkles" size={16} /></span>
              <span><b>{migliaia(stato.totale)}</b><small>{gioca ? stato.nomeLivello : `${nomeG} · ${stato.nomeLivello}`}</small>
                <span className="v-prog"><i style={{ width: Math.round(stato.frazione * 100) + '%' }} /></span></span>
            </button>
          )}
          {lista && lista.length > 0 && (
            <button className="v-qb v-mis" type="button" onClick={() => apri({ t: 'missioni' })}
              aria-label={daFare ? `Missioni di oggi: ${daFare} da fare` : 'Missioni di oggi: tutte fatte'}>★{daFare > 0 && <i className="v-nb">{daFare}</i>}</button>
          )}
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
