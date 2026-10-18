// Villaggio, fase 2 (16-10): le Paillettes di Ginni come funzioni pure. I punti NON si salvano da nessuna parte: si
// ricalcolano a ogni lettura dagli eventi che il database registra comunque (v_villaggio_eventi: presenze, ordini, arrivi,
// conte, conte complete registrate, verifiche fornitore, date aggiunte), quindi stessi eventi = stesso punteggio su ogni
// dispositivo e nessun punto "regalato" dal client. Nessun import (neanche di tipi): lo usano la pagina e
// tests/villaggio_paillettes.mjs (Node 24 strippa i tipi). Niente Date.now(): `oggi` (data di Roma, 'YYYY-MM-DD') arriva da
// fuori, cosi' il calcolo e' ripetibile. I tetti (una volta al giorno, alla settimana, al mese, per riga) tolgono il gusto
// di ripetere la stessa azione per fare punti.

export type TipoEvento = 'presenza' | 'ordine' | 'arrivo' | 'conta' | 'conta_completa' | 'verifica' | 'data_aggiunta';
export type Evento = { tipo: TipoEvento; giorno: string; ts: string; ref: string; n: number };

export const VALORI = { presenza: 6, settimanaPiena: 50, ordine: 20, rigaOrdine: 5, arrivo: 10, verifica: 50, conta: 2,
  contaCompleta: 500, dataAggiunta: 15 } as const;

// Tarati il 17-10 sugli eventi veri di Ginevra (02-09..16-10, taratura in tests/villaggio_paillettes.mjs): con una presenza
// ogni giorno lavorativo fanno circa 930 paillettes ogni 30 giorni, regina in circa 16 mesi; aggiungendo la verifica
// settimanale dei due laboratori con piu' righe aperte circa 1.360, regina in circa 11 mesi. Dan 17-10: restano cosi'.
export type Livello = { nome: string; da: number };
export const LIVELLI: readonly Livello[] = [
  { nome: 'Stagista', da: 0 }, { nome: 'Junior', da: 300 }, { nome: 'Production Assistant', da: 1000 },
  { nome: 'Coordinator', da: 2500 }, { nome: 'Production Manager', da: 5000 }, { nome: 'Head of Production', da: 9000 },
  { nome: 'Executive Queen of Fashion Production', da: 15000 },
];

/** Il premio della settimana piena non viene da un evento suo: nasce dalla presenza che completa la settimana. */
export type TipoVoce = TipoEvento | 'settimana_piena';
export type Voce = { giorno: string; ts: string; tipo: TipoVoce; ref: string; punti: number; testo: string };

/** Quello che le medaglie guardano, contato sulle voci che hanno dato punti (un'azione ripetuta oltre il tetto non conta). */
export type Conteggi = {
  presenze: number; settimanePiene: number; verifiche: number; labInUnaSettimana: number; conteComplete: number;
  arrivi: number; serieMax: number; dateAggiunte: number;
};
export type Medaglia = { id: string; nome: string; descrizione: string; regola: (c: Conteggi) => boolean };

export const MEDAGLIE: readonly Medaglia[] = [
  { id: 'prima-presenza', nome: 'Prima presenza', descrizione: 'Hai aperto il Villaggio per la prima volta', regola: (c) => c.presenze >= 1 },
  { id: 'settimana-perfetta', nome: 'Settimana perfetta', descrizione: 'Presente tutti i giorni da lunedì a venerdì', regola: (c) => c.settimanePiene >= 1 },
  { id: 'prima-verifica', nome: 'Prima verifica', descrizione: 'Hai passato le righe aperte con un laboratorio', regola: (c) => c.verifiche >= 1 },
  { id: 'tutti-i-laboratori', nome: 'Tutti i laboratori', descrizione: '4 laboratori verificati nella stessa settimana', regola: (c) => c.labInUnaSettimana >= 4 },
  { id: 'prima-conta-completa', nome: 'Prima conta completa', descrizione: 'Hai registrato la prima conta completa del magazzino', regola: (c) => c.conteComplete >= 1 },
  { id: 'cento-arrivi', nome: 'Cento arrivi', descrizione: '100 arrivi registrati', regola: (c) => c.arrivi >= 100 },
  { id: 'serie-20', nome: 'Serie da 20', descrizione: '20 giorni lavorativi di fila', regola: (c) => c.serieMax >= 20 },
  { id: 'date-a-posto', nome: 'Date a posto', descrizione: '10 date di consegna aggiunte', regola: (c) => c.dateAggiunte >= 10 },
];

export type Stato = {
  totale: number; oggi: number; livello: number; nomeLivello: string; prossimo: Livello | null; frazione: number;
  serie: number; settimana: boolean[]; voci: Voce[]; medaglie: Medaglia[];
};

// --- Giorni come interi (giorni dal 1970-01-01, che era giovedi'): settimane senza fusi orari ---
const GIORNO = 86400000;
const num = (g: string) => Math.round(Date.parse(g.slice(0, 10) + 'T00:00:00Z') / GIORNO);
const iso = (d: number) => new Date(d * GIORNO).toISOString().slice(0, 10);
/** 0 = lunedi' ... 6 = domenica */
const dow = (d: number) => (d + 3) % 7;
const lunedi = (d: number) => d - dow(d);
const lavorativo = (d: number) => dow(d) < 5;
const lavPrima = (d: number) => { do d--; while (!lavorativo(d)); return d; };

const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre',
  'novembre', 'dicembre'];
const nomeMese = (m: string) => MESI[Number(m.slice(5, 7)) - 1] ?? m;
/** Il mese di una conta completa: la vista lo mette in ref ('YYYY-MM', mese di Roma della registrazione); se il ref non e'
 *  un mese vale quello del giorno, cosi' anche un evento storto conta una volta sola. */
const meseDi = (e: Evento) => (/^\d{4}-\d{2}$/.test(e.ref) ? e.ref : e.giorno.slice(0, 7));

const righe = (n: number) => (n === 1 ? '1 riga' : n + ' righe');
const codici = (n: number) => (n === 1 ? '1 codice' : n + ' codici');
/** "Francesco (pelle)" -> "Francesco", come labOf() di catalogo.ts (qui niente import di valori). */
const nomeLab = (f: string) => f.replace(/\s*\([^)]*\)\s*$/, '').trim() || f;
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
// ordine totale: lo stesso insieme di eventi da' le stesse voci qualunque sia l'ordine in cui la vista li restituisce
const cronologico = (a: Evento, b: Evento) =>
  Date.parse(a.ts) - Date.parse(b.ts) || cmp(a.tipo, b.tipo) || cmp(a.ref, b.ref) || cmp(a.giorno, b.giorno) || a.n - b.n;

export function calcola(eventi: Evento[], oggi: string): Stato {
  const voci: Voce[] = [];
  const presi = new Set<string>();
  const unaVolta = (k: string) => (presi.has(k) ? false : (presi.add(k), true));
  const presenti = new Set<number>();
  const labSettimana = new Map<number, Set<string>>();
  const voce = (e: Evento, tipo: TipoVoce, punti: number, testo: string, ref = e.ref) =>
    voci.push({ giorno: e.giorno, ts: e.ts, tipo, ref, punti, testo });

  for (const e of [...eventi].sort(cronologico)) {
    const d = num(e.giorno);
    switch (e.tipo) {
      case 'presenza': {
        if (!unaVolta('p|' + e.giorno)) break;
        presenti.add(d);
        voce(e, 'presenza', VALORI.presenza, 'Presenza');
        // scatta alla quinta presenza della settimana, che per forza cade su un giorno lavorativo ancora scoperto
        const l = lunedi(d);
        if (lavorativo(d) && [0, 1, 2, 3, 4].every((i) => presenti.has(l + i))) {
          voce(e, 'settimana_piena', VALORI.settimanaPiena, 'Settimana piena!', iso(l));
        }
        break;
      }
      case 'ordine':
        if (e.n > 0) voce(e, 'ordine', VALORI.ordine + VALORI.rigaOrdine * e.n, 'Ordine · ' + righe(e.n));
        break;
      case 'arrivo':
        if (unaVolta('a|' + e.ref + '|' + e.giorno)) voce(e, 'arrivo', VALORI.arrivo, 'Arrivo registrato · ' + e.n + ' pz');
        break;
      case 'verifica': {
        // una verifica senza righe confermate non vale e non consuma la settimana di quel fornitore
        const l = lunedi(d);
        if (e.n > 0 && unaVolta('v|' + e.ref + '|' + l)) {
          voce(e, 'verifica', VALORI.verifica, 'Verifica con ' + nomeLab(e.ref) + ' · ' + (e.n === 1 ? '1 riga confermata' : e.n + ' righe confermate'));
          if (!labSettimana.has(l)) labSettimana.set(l, new Set());
          labSettimana.get(l)!.add(e.ref);
        }
        break;
      }
      case 'data_aggiunta':
        if (unaVolta('d|' + e.ref)) voce(e, 'data_aggiunta', VALORI.dataAggiunta, 'Data di consegna aggiunta');
        break;
      case 'conta':
        if (unaVolta('c|' + e.ref + '|' + e.giorno)) voce(e, 'conta', VALORI.conta, 'Conta registrata');
        break;
      case 'conta_completa': {
        // la registra Ginni in fondo al giro di conta: il numero di codici e' solo per il testo, i punti sono una volta al mese
        const mese = meseDi(e);
        if (unaVolta('cc|' + mese)) {
          voce(e, 'conta_completa', VALORI.contaCompleta, 'Conta completa di ' + nomeMese(mese) + (e.n > 0 ? ' · ' + codici(e.n) : ''), mese);
        }
        break;
      }
    }
  }

  const totale = voci.reduce((s, v) => s + v.punti, 0);
  const puntiOggi = voci.reduce((s, v) => s + (v.giorno === oggi ? v.punti : 0), 0);
  let livello = 0;
  while (livello + 1 < LIVELLI.length && totale >= LIVELLI[livello + 1].da) livello++;
  const prossimo = LIVELLI[livello + 1] ?? null;
  const frazione = prossimo ? (totale - LIVELLI[livello].da) / (prossimo.da - LIVELLI[livello].da) : 1;

  // serie: oggi non e' ancora finito, quindi se Ginni non e' ancora passata la serie si conta da ieri (lavorativo)
  const t = num(oggi);
  let g = lavorativo(t) && presenti.has(t) ? t : lavPrima(t);
  let serie = 0;
  while (presenti.has(g)) { serie++; g = lavPrima(g); }
  let serieMax = 0, corrente = 0, prec = NaN;
  for (const d of [...presenti].filter(lavorativo).sort((a, b) => a - b)) {
    corrente = lavPrima(d) === prec ? corrente + 1 : 1;
    prec = d;
    serieMax = Math.max(serieMax, corrente);
  }
  const settimana = [0, 1, 2, 3, 4].map((i) => presenti.has(lunedi(t) + i));

  const quante = (tipo: TipoVoce) => voci.filter((v) => v.tipo === tipo).length;
  const c: Conteggi = {
    presenze: quante('presenza'), settimanePiene: quante('settimana_piena'), verifiche: quante('verifica'),
    labInUnaSettimana: Math.max(0, ...[...labSettimana.values()].map((s) => s.size)), conteComplete: quante('conta_completa'),
    arrivi: quante('arrivo'), serieMax, dateAggiunte: quante('data_aggiunta'),
  };

  return {
    totale, oggi: puntiOggi, livello, nomeLivello: LIVELLI[livello].nome, prossimo, frazione, serie, settimana,
    // costruite in ordine cronologico con il premio subito dopo l'evento che lo fa scattare: rovesciate, il premio sta sopra
    voci: voci.reverse(), medaglie: MEDAGLIE.filter((m) => m.regola(c)),
  };
}

// --- Missioni: guidano verso le azioni utili di oggi, NON danno punti propri ---

export type LabMissione = { key: string; nome: string; forn: string | null; righe: { late: boolean; wip?: boolean }[]; senzaData: number };
export type Missione = {
  id: string; testo: string; fatta: boolean;
  azione: { t: 'verifica'; lab: string } | { t: 'conta'; codici: string[] } | { t: 'contaCompleta' };
};

/** Al massimo 3, in ordine di priorita': verifica del laboratorio piu' in ritardo, conta dei negativi, date mancanti, conta
 *  completa del mese (dal 20). `negativi` sono i codici con giacenza negativa: una conta li sistema e li toglie dalla lista,
 *  quindi perche' la missione resti visibile come fatta la pagina passa quelli della prima lettura del giorno. */
export function missioni(input: { labs: LabMissione[]; negativi: string[]; eventi: Evento[]; oggi: string }): Missione[] {
  const { labs, negativi, eventi, oggi } = input;
  const t = num(oggi), l = lunedi(t), mese = oggi.slice(0, 7);
  const oggiVerificati = new Set<string>(), giaVerificati = new Set<string>(), contatiOggi = new Set<string>();
  let completaOggi = false, completaPrima = false;
  for (const e of eventi) {
    const d = num(e.giorno);
    if (e.tipo === 'verifica' && d === t) oggiVerificati.add(e.ref);
    else if (e.tipo === 'verifica' && d >= l && d < t) giaVerificati.add(e.ref);
    else if (e.tipo === 'conta' && d === t) contatiOggi.add(e.ref);
    else if (e.tipo === 'conta_completa' && meseDi(e) === mese) { if (d === t) completaOggi = true; else completaPrima = true; }
  }
  const ritardi = (x: LabMissione) => x.righe.filter((r) => r.late).length;
  const fatto = (x: LabMissione) => oggiVerificati.has(x.forn!);
  // verificato in un giorno precedente di questa settimana = a posto fino a lunedi'. Un laboratorio verificato OGGI resta in
  // cima anche se la verifica ha appena spostato le date (e quindi azzerato i ritardi): sparirebbe proprio quando e' fatta
  const aperti = labs.filter((x) => x.forn && !giaVerificati.has(x.forn));
  const perPriorita = (k: (x: LabMissione) => number) => (a: LabMissione, b: LabMissione) =>
    Number(fatto(b)) - Number(fatto(a)) || k(b) - k(a) || a.nome.localeCompare(b.nome, 'it');
  const out: Missione[] = [];

  const v = aperti.filter((x) => fatto(x) || ritardi(x) > 0).sort(perPriorita(ritardi))[0];
  if (v) {
    const n = ritardi(v);
    out.push({ id: 'verifica:' + v.key, testo: 'Verifica con ' + v.nome + (n ? ' · ' + righe(n) + ' in ritardo' : ''),
      azione: { t: 'verifica', lab: v.key }, fatta: fatto(v) });
  }
  if (negativi.length) {
    out.push({ id: 'conta-negativi', testo: negativi.length === 1 ? 'Conta il codice negativo' : 'Conta i ' + negativi.length + ' codici negativi',
      azione: { t: 'conta', codici: [...negativi] }, fatta: negativi.every((c) => contatiOggi.has(c)) });
  }
  const dt = aperti.filter((x) => x !== v && (fatto(x) || x.senzaData > 0)).sort(perPriorita((x) => x.senzaData))[0];
  if (dt) {
    out.push({ id: 'date:' + dt.key, testo: 'Chiedi a ' + dt.nome + (dt.senzaData ? ' la data di ' + righe(dt.senzaData) : ' le date di consegna'),
      azione: { t: 'verifica', lab: dt.key }, fatta: fatto(dt) });
  }
  // il giro completo e' lungo: lo si ricorda solo nell'ultima parte del mese, e per ultimo. Registrata oggi resta (fatta),
  // registrata in un giorno precedente dello stesso mese non torna fino al mese dopo
  if (out.length < 3 && Number(oggi.slice(8, 10)) >= 20 && !completaPrima) {
    out.push({ id: 'conta-completa:' + mese, testo: 'Conta completa di ' + nomeMese(mese), azione: { t: 'contaCompleta' }, fatta: completaOggi });
  }
  return out;
}

/** Cosa festeggiare fra due letture. Alla prima lettura (prima = null) niente: non si festeggia tutto lo storico.
 *  `punti` puo' essere negativo (un ordine che perde righe vale meno): la pagina mostra il "+n" solo se e' > 0. */
export function differenza(prima: Stato | null, dopo: Stato): { punti: number; livelloNuovo: string | null; medaglieNuove: Medaglia[] } {
  if (!prima) return { punti: 0, livelloNuovo: null, medaglieNuove: [] };
  const avute = new Set(prima.medaglie.map((m) => m.id));
  return {
    punti: dopo.totale - prima.totale,
    livelloNuovo: dopo.livello > prima.livello ? dopo.nomeLivello : null,
    medaglieNuove: dopo.medaglie.filter((m) => !avute.has(m.id)),
  };
}
