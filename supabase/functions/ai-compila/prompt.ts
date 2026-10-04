// Prompt e schemi dello strato AI "Compila" (edge ai-compila). File SENZA dipendenze Deno, cosi' il golden test
// (tests/mat_ai_golden.mjs, Node 24) importa ESATTAMENTE lo stesso prompt che gira in produzione.
// Regola 1 applicata al prompt: un numero compare solo se e' scritto nel documento; niente stime, niente medie.

export const CATEGORIE = ['Tessuto', 'Tessuto velluto', 'Animalier', 'Cocco', 'Vitello stampato', 'Pelle vitello', 'Vernice', 'Crosta/Velour', 'Nappa', 'Nastri', 'Accessori metallici'] as const;
export const UNITA = ['mq', 'ml', 'mt', 'pz'] as const;
export type Target = 'materiale' | 'fornitore' | 'ordine_prodotti' | 'foglio_ordine';

// D6 decisa dal golden set del 23-09: il lite legge bene le proforma (prezzi, quantita', categorie) e non va in
// MAX_TOKENS; il flash consuma il tetto di output col ragionamento interno (thinkingConfig e' vietato dal gotcha
// CONOSCENZA) e si e' fermato su una proforma di 2 pagine. Override senza deploy: app_flags.ai_compila_model.
export const MODELLO_DEFAULT = 'gemini-flash-lite-latest';
// foglio_ordine (misura del 04-10 su tre fogli veri, 20 righe, tests/foglio_ordine_golden.mjs): quantita' e interni li
// leggono bene entrambi, ma i candidati variante del lite sono poveri (zero o uno, spesso fuori strada), quelli del
// flash sono una rosa sensata. Il flash ragiona (fino a 3.900 token e 21 s per foglio): un foglio per chiamata e
// timeout dedicato nella edge. Override senza deploy: app_flags.ai_foglio_model.
export const MODELLO_FOGLIO_DEFAULT = 'gemini-flash-latest';

const REGOLE_COMUNI = `Sei l'assistente di inserimento dati di Amimi Milano, un piccolo brand di borse. Leggi le immagini (proforma, fatture, schede tecniche, email, foto di campioni, screenshot di chat) e la nota scritta dall'operatrice, e proponi i campi di un modulo.
Rispondi SOLO con un oggetto JSON valido, senza testo attorno, con la struttura richiesta.
Regole ferree:
1. Un numero (prezzo, quantita', importo) compare SOLO se e' scritto nel documento o nella nota. Se non c'e', il campo e' null. Mai stimare, mai arrotondare, mai dedurre un prezzo da un altro.
2. Un prezzo e' "valore" numerico solo se e' un valore singolo e certo. Range ("40-45"), scaglioni ("49,16 sotto 6 pelli, 46,66 da 6 a 30 mq") e prezzi con condizioni vanno nel campo di testo fedele, con "valore" null.
3. I nomi (materiale, colore, articolo, fornitore) si riportano come compaiono nel documento, senza tradurli o normalizzarli.
4. Per ogni campo dai una "confidenza" da 0 a 1 e una "fonte": la frase o la zona del documento da cui viene (o "nota" se viene dalla nota dell'operatrice). Un campo null ha confidenza 0 e fonte "".
5. Testi in italiano. Niente trattini lunghi.
6. Se il documento non riguarda il target richiesto (per esempio e' una bolla di trasporto e ti chiedono un materiale), restituisci comunque la struttura con i campi a null e "avviso" spiega perche'.`;

export const SCHEMA_MATERIALE = `{
  "avviso": string | null,
  "fornitore": { "valore": string | null, "confidenza": number, "fonte": string, "match_esistente": string | null },
  "categoria": { "valore": one of ${JSON.stringify(CATEGORIE)} | null, "confidenza": number, "fonte": string },
  "materiale": { "valore": string | null, "confidenza": number, "fonte": string, "match_esistente": string | null },
  "articolo_fornitore": { "valore": string | null, "confidenza": number, "fonte": string },
  "colori": [ { "valore": string, "confidenza": number, "fonte": string } ],
  "unita": { "valore": one of ${JSON.stringify(UNITA)} | null, "confidenza": number, "fonte": string },
  "prezzo": { "valore": number | null, "testo": string | null, "confidenza": number, "fonte": string },
  "tipo": { "valore": "acquistato" | "offerta" | null, "confidenza": number, "fonte": string },
  "quantita": { "valore": number | null, "confidenza": number, "fonte": string },
  "disponibilita": { "valore": string | null, "confidenza": number, "fonte": string },
  "min_ordine": { "valore": string | null, "confidenza": number, "fonte": string },
  "lead_time": { "valore": string | null, "confidenza": number, "fonte": string },
  "condizioni_pagamento": { "valore": string | null, "confidenza": number, "fonte": string },
  "data": { "valore": "YYYY-MM-DD" | null, "confidenza": number, "fonte": string },
  "documento_fonte": { "valore": string | null, "confidenza": number, "fonte": string },
  "importo_totale": { "valore": number | null, "confidenza": number, "fonte": string },
  "note": { "valore": string | null, "confidenza": number, "fonte": string }
}`;

export const SCHEMA_FORNITORE = `{
  "avviso": string | null,
  "nome": { "valore": string | null, "confidenza": number, "fonte": string, "match_esistente": string | null },
  "ragione_sociale": { "valore": string | null, "confidenza": number, "fonte": string },
  "categoria_principale": { "valore": string | null, "confidenza": number, "fonte": string },
  "email": { "valore": string | null, "confidenza": number, "fonte": string },
  "telefono": { "valore": string | null, "confidenza": number, "fonte": string },
  "referente": { "valore": string | null, "confidenza": number, "fonte": string },
  "indirizzo": { "valore": string | null, "confidenza": number, "fonte": string },
  "piva_vat": { "valore": string | null, "confidenza": number, "fonte": string },
  "deposito_luogo": { "valore": string | null, "confidenza": number, "fonte": string },
  "condizioni_pagamento": { "valore": string | null, "confidenza": number, "fonte": string },
  "note": { "valore": string | null, "confidenza": number, "fonte": string }
}`;

export const SCHEMA_ORDINE = `{
  "avviso": string | null,
  "fornitore": { "valore": string | null, "confidenza": number, "fonte": string, "match_esistente": string | null },
  "data_ordine": { "valore": "YYYY-MM-DD" | null, "confidenza": number, "fonte": string },
  "righe": [ {
    "modello": { "valore": string | null, "confidenza": number, "fonte": string, "match_esistente": string | null },
    "variante": { "valore": string | null, "confidenza": number, "fonte": string },
    "quantita": { "valore": number | null, "confidenza": number, "fonte": string },
    "costo_unitario": { "valore": number | null, "confidenza": number, "fonte": string }
  } ],
  "note": { "valore": string | null, "confidenza": number, "fonte": string }
}`;

// Foglio d'ordine scritto a mano col fornitore (04-10): la variante NON e' scritta, e' il campione spillato sul foglio.
// L'AI legge quantita', interno e note, descrive il campione e propone al massimo 3 varianti candidate della lista:
// la variante la sceglie l'operatrice. "box" e' il rettangolo della riga, per mostrarle il ritaglio accanto alla proposta.
export const SCHEMA_FOGLIO = `{
  "avviso": string | null,
  "fornitore": { "valore": string | null, "confidenza": number, "fonte": string, "match_esistente": string | null },
  "data_ordine": { "valore": "YYYY-MM-DD" | null, "confidenza": number, "fonte": string },
  "righe": [ {
    "foglio": number,
    "posizione": number,
    "modello": { "valore": string | null, "confidenza": number, "fonte": string, "match_esistente": string | null },
    "campione": { "descrizione": string, "scritto": string | null },
    "candidati": [ string ],
    "quantita": { "valore": number | null, "confidenza": number, "fonte": string },
    "tutta": boolean,
    "stima_pezzi": number | null,
    "quantita_scritta": string,
    "interno": { "valore": string | null, "confidenza": number, "fonte": string },
    "note": string | null,
    "box": [ ymin, xmin, ymax, xmax ]
  } ],
  "note": { "valore": string | null, "confidenza": number, "fonte": string }
}`;

// catalogo: righe "MODELLO | VARIANTE" (solo foglio_ordine: i candidati si scelgono fra le varianti del modello del foglio)
export type Contesto = { fornitori?: string[]; materiali?: string[]; modelli?: string[]; varianti?: string[]; catalogo?: string[] };

// responseSchema per Gemini (structured output, decodifica vincolata): con il solo responseMimeType il modello
// puo' ancora produrre JSON rotto (una virgoletta non escapata dentro un testo copiato dal documento: successo sul
// golden set del 23-09); con lo schema il JSON e' valido per costruzione. Lo schema e' lo stesso del prompt.
type GSchema = Record<string, unknown>;
const campo = (tipo: 'STRING' | 'NUMBER', extra: GSchema = {}, match = false): GSchema => ({
  type: 'OBJECT',
  properties: {
    valore: { type: tipo, nullable: true, ...extra },
    confidenza: { type: 'NUMBER' },
    fonte: { type: 'STRING' },
    ...(match ? { match_esistente: { type: 'STRING', nullable: true } } : {}),
  },
  required: ['valore', 'confidenza', 'fonte'],
});
export function responseSchema(target: Target): GSchema {
  if (target === 'materiale') return {
    type: 'OBJECT',
    properties: {
      avviso: { type: 'STRING', nullable: true },
      fornitore: campo('STRING', {}, true),
      categoria: campo('STRING', { enum: [...CATEGORIE] }),
      materiale: campo('STRING', {}, true),
      articolo_fornitore: campo('STRING'),
      colori: { type: 'ARRAY', items: campo('STRING') },
      unita: campo('STRING', { enum: [...UNITA] }),
      prezzo: { type: 'OBJECT', properties: { valore: { type: 'NUMBER', nullable: true }, testo: { type: 'STRING', nullable: true }, confidenza: { type: 'NUMBER' }, fonte: { type: 'STRING' } }, required: ['valore', 'testo', 'confidenza', 'fonte'] },
      tipo: campo('STRING', { enum: ['acquistato', 'offerta'] }),
      quantita: campo('NUMBER'),
      disponibilita: campo('STRING'), min_ordine: campo('STRING'), lead_time: campo('STRING'), condizioni_pagamento: campo('STRING'),
      data: campo('STRING'), documento_fonte: campo('STRING'), importo_totale: campo('NUMBER'), note: campo('STRING'),
    },
    required: ['avviso', 'fornitore', 'categoria', 'materiale', 'colori', 'unita', 'prezzo', 'tipo', 'quantita'],
  };
  if (target === 'fornitore') return {
    type: 'OBJECT',
    properties: {
      avviso: { type: 'STRING', nullable: true }, nome: campo('STRING', {}, true), ragione_sociale: campo('STRING'), categoria_principale: campo('STRING'),
      email: campo('STRING'), telefono: campo('STRING'), referente: campo('STRING'), indirizzo: campo('STRING'), piva_vat: campo('STRING'),
      deposito_luogo: campo('STRING'), condizioni_pagamento: campo('STRING'), note: campo('STRING'),
    },
    required: ['avviso', 'nome', 'email', 'telefono'],
  };
  if (target === 'foglio_ordine') return {
    type: 'OBJECT',
    properties: {
      avviso: { type: 'STRING', nullable: true }, fornitore: campo('STRING', {}, true), data_ordine: campo('STRING'),
      righe: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
        foglio: { type: 'INTEGER' }, posizione: { type: 'INTEGER' },
        modello: campo('STRING', {}, true),
        campione: { type: 'OBJECT', properties: { descrizione: { type: 'STRING' }, scritto: { type: 'STRING', nullable: true } }, required: ['descrizione', 'scritto'] },
        candidati: { type: 'ARRAY', items: { type: 'STRING' } },
        quantita: campo('NUMBER'), tutta: { type: 'BOOLEAN' }, stima_pezzi: { type: 'NUMBER', nullable: true }, quantita_scritta: { type: 'STRING' },
        interno: campo('STRING'), note: { type: 'STRING', nullable: true },
        box: { type: 'ARRAY', items: { type: 'NUMBER' } },
      }, required: ['foglio', 'posizione', 'modello', 'campione', 'candidati', 'quantita', 'tutta', 'stima_pezzi', 'quantita_scritta', 'interno', 'note', 'box'] } },
      note: campo('STRING'),
    },
    required: ['avviso', 'fornitore', 'data_ordine', 'righe'],
  };
  return {
    type: 'OBJECT',
    properties: {
      avviso: { type: 'STRING', nullable: true }, fornitore: campo('STRING', {}, true), data_ordine: campo('STRING'),
      righe: { type: 'ARRAY', items: { type: 'OBJECT', properties: { modello: campo('STRING', {}, true), variante: campo('STRING'), quantita: campo('NUMBER'), costo_unitario: campo('NUMBER') }, required: ['modello', 'variante', 'quantita', 'costo_unitario'] } },
      note: campo('STRING'),
    },
    required: ['avviso', 'fornitore', 'data_ordine', 'righe'],
  };
}

const catalogo = (ctx?: Contesto): string[] => (Array.isArray(ctx?.catalogo) ? ctx.catalogo.map((x) => String(x)) : []);

export function buildPrompt(target: Target, testo: string, ctx: Contesto): string {
  const lista = (t: string, xs?: string[]) => xs?.length ? `\n${t} gia' presenti (se il documento ne cita uno, metti il nome ESATTO di questa lista in "match_esistente"):\n- ${xs.slice(0, 300).join('\n- ')}` : '';
  if (target === 'materiale') {
    return `${REGOLE_COMUNI}

TARGET: un materiale (pelle, tessuto, nastro, accessorio) offerto o acquistato da un fornitore, con i suoi colori. Se il documento elenca piu' colori dello stesso materiale, mettili tutti in "colori". Se elenca materiali DIVERSI, scegli quello che la nota dell'operatrice indica; se la nota non aiuta, prendi il primo e scrivi gli altri in "note".
"tipo" e' "acquistato" se il documento e' una fattura, una proforma o una conferma di acquisto; "offerta" se e' un listino, una scheda tecnica, una proposta o una foto di campione.
"quantita" e "importo_totale" solo per un acquisto e solo se scritti.
${lista('Fornitori', ctx.fornitori)}${lista('Materiali', ctx.materiali)}

Nota dell'operatrice: ${testo ? JSON.stringify(testo) : '(nessuna)'}

Struttura JSON richiesta:
${SCHEMA_MATERIALE}`;
  }
  if (target === 'fornitore') {
    return `${REGOLE_COMUNI}

TARGET: l'anagrafica di un fornitore (da un'email, una firma, una fattura, un biglietto da visita). "nome" e' il nome corto con cui lo chiamiamo (es. "Vicenza Pelli"), "ragione_sociale" quella legale se c'e'.
${lista('Fornitori', ctx.fornitori)}

Nota dell'operatrice: ${testo ? JSON.stringify(testo) : '(nessuna)'}

Struttura JSON richiesta:
${SCHEMA_FORNITORE}`;
  }
  if (target === 'foglio_ordine') {
    return `${REGOLE_COMUNI}

TARGET: uno o piu' FOGLI D'ORDINE scritti a mano col fornitore di borse. Ogni immagine e' un foglio: in alto il MODELLO (es. "LEA BAG", "LEA BAG MAXI"; le scritte fra parentesi accanto al titolo, come "(1 A COLORE)", sono annotazioni e non fanno parte del modello), sotto una tabella con una riga per variante. Ogni riga ha tre zone: a sinistra il CAMPIONE del materiale spillato sul foglio (a volte, al posto del campione o sotto, il nome scritto a mano); al centro la QUANTITA'; a destra il colore dell'INTERNO della borsa, che e' un nome di colore ("MARRONE", "NERO") oppure un codice numerico ("88", "91", "123").
Regole di questo target:
a. Una riga per ogni riga della tabella, nell'ordine dall'alto in basso. "foglio" e' il numero dell'immagine (1 la prima), "posizione" quello della riga nel foglio (1 la prima in alto).
b. Le scritte CANCELLATE (barrate o scarabocchiate) si ignorano: vale quello che e' scritto accanto o sotto.
c. Quantita': se e' scritto un numero di pezzi, "quantita.valore" e' quel numero e "tutta" e' false. Se e' scritto "TUTTA" o "TUTTO" (tutta la pelle disponibile: i pezzi si sapranno all'arrivo), "tutta" e' true e "quantita.valore" e' null; un numero fra parentesi accanto ("(10)", "(40 pezzi)") e' la stima e va in "stima_pezzi", mai in "quantita". I metri quadri ("2,2 mq disp") non sono pezzi.
d. "quantita_scritta" riporta la cella della quantita' com'e' scritta, senza le parti cancellate.
e. "interno.valore" e' la cella di destra com'e' scritta ("91", "MARRONE").
f. "note": le altre annotazioni della riga ("con asole"), null se non ce ne sono. Una stella o un asterisco accanto al campione si riporta come "stella".
g. "campione.descrizione": cosa si vede del campione, in poche parole (materiale, colore, fantasia: "cavallino zebrato bianco e nero", "cocco verde lucido"). "campione.scritto": il nome scritto nella prima colonna, se c'e' ed e' leggibile, altrimenti null.
h. "candidati": le varianti del MODELLO di quel foglio che possono corrispondere al campione, al massimo 3, la piu' probabile per prima, con il nome ESATTO della lista qui sotto (solo la parte dopo la barra). Se nessuna corrisponde in modo plausibile, lista vuota: il campione puo' essere una variante nuova. Mai un nome fuori lista.
i. "box": il rettangolo che contiene l'intera riga (campione, quantita', interno) nell'immagine, come [ymin, xmin, ymax, xmax] su scala 0-1000.
l. Una riga senza quantita' (per esempio "da cercare") non e' una riga d'ordine: non metterla in "righe", riportala nella "note" generale.
m. Fornitore e data si compilano solo se sono scritti sul foglio o nella nota dell'operatrice.
${lista('Fornitori', ctx.fornitori)}${catalogo(ctx).length ? `\nCatalogo, una riga per variante nella forma MODELLO | VARIANTE (per "modello.match_esistente" usa il MODELLO esatto, per "candidati" la VARIANTE esatta):\n- ${catalogo(ctx).slice(0, 600).join('\n- ')}` : ''}

Nota dell'operatrice: ${testo ? JSON.stringify(testo) : '(nessuna)'}

Struttura JSON richiesta:
${SCHEMA_FOGLIO}`;
  }
  return `${REGOLE_COMUNI}

TARGET: un ordine di BORSE FINITE a un fornitore o a una sarta (da una conferma d'ordine, una chat, una nota dettata). Ogni riga e' un modello con la sua variante, i pezzi e, se scritto, il costo al pezzo. Usa i nomi ESATTI delle liste quando il documento li cita, anche se scritti in modo diverso (es. "lea leopardo" = modello "LEA", variante "LEOPARDO SAVANA" solo se una variante della lista lo permette senza inventare). Se una variante non e' nella lista, riportala come scritta e lascia "match_esistente" null.
${lista('Fornitori', ctx.fornitori)}${lista('Modelli', ctx.modelli)}${lista('Varianti', ctx.varianti)}

Nota dell'operatrice: ${testo ? JSON.stringify(testo) : '(nessuna)'}

Struttura JSON richiesta:
${SCHEMA_ORDINE}`;
}

// Tetto di output: i modelli con ragionamento interno contano i token di reasoning DENTRO maxOutputTokens (gotcha
// CONOSCENZA): con 4.000 il flash usciva in MAX_TOKENS sul golden set del 23-09 prima ancora di scrivere il JSON.
export const MAX_OUTPUT_TOKENS = 16384;

// Normalizzazione CONSERVATIVA prima della validazione (Regola 1): se il modello mette un prezzo numerico E un testo
// insieme, il numero non e' "singolo e certo" -> resta solo il testo. Le confidenze fuori [0,1] si riportano nel range.
const nk = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
export function normalizzaOutput(target: Target, p: unknown, ctx?: Contesto): unknown {
  if (!p || typeof p !== 'object') return p;
  const o = p as Record<string, unknown>;
  if (target === 'foglio_ordine' && Array.isArray(o.righe)) {
    // varianti ammesse per modello, dal catalogo del contesto (Regola 1: mai un candidato fuori lista)
    const perModello = new Map<string, Map<string, string>>();
    for (const riga of catalogo(ctx)) {
      const i = riga.indexOf('|'); if (i < 0) continue;
      const m = nk(riga.slice(0, i)), va = riga.slice(i + 1).trim(); if (!va) continue;
      if (!perModello.has(m)) perModello.set(m, new Map());
      perModello.get(m)!.set(nk(va), va);
    }
    for (const r of o.righe as Array<Record<string, unknown>>) {
      // TUTTA con un numero in quantita': quel numero e' la stima, mai i pezzi ordinati (decisione owner 04-10)
      const q = r.quantita as { valore?: unknown } | undefined;
      if (r.tutta === true && q && q.valore != null) { if (r.stima_pezzi == null) r.stima_pezzi = q.valore; q.valore = null; }
      const st = Number(r.stima_pezzi);
      r.stima_pezzi = r.stima_pezzi != null && Number.isFinite(st) && st > 0 ? st : null;
      const mod = r.modello as { valore?: unknown; match_esistente?: unknown } | undefined;
      const ammesse = perModello.get(nk(String(mod?.match_esistente ?? mod?.valore ?? '')));
      const cand = (Array.isArray(r.candidati) ? r.candidati : []).map((c) => String(c).split('|').pop()!.trim()).filter(Boolean);
      r.candidati = catalogo(ctx).length ? [...new Set(cand.map((c) => ammesse?.get(nk(c))).filter((c): c is string => !!c))].slice(0, 3) : cand.slice(0, 3);
      const b = Array.isArray(r.box) ? r.box.map(Number) : [];
      r.box = b.length === 4 && b.every((n) => Number.isFinite(n)) && b[2] > b[0] && b[3] > b[1] ? b.map((n) => Math.min(1000, Math.max(0, n))) : null;
    }
  }
  const fix = (c: unknown) => { if (c && typeof c === 'object' && 'confidenza' in (c as object)) { const x = c as { confidenza: unknown }; const n = Number(x.confidenza); x.confidenza = Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0; } };
  for (const v of Object.values(o)) { if (Array.isArray(v)) v.forEach((e) => { fix(e); if (e && typeof e === 'object') Object.values(e as object).forEach(fix); }); else fix(v); }
  if (target === 'materiale' && o.prezzo && typeof o.prezzo === 'object') {
    const pr = o.prezzo as { valore?: unknown; testo?: unknown };
    const t = pr.testo == null ? '' : String(pr.testo).trim();
    // i modelli copiano il numero anche nel testo ("66,000", "0,0600"): un testo che E' un numero singolo
    // (virgola o punto decimale, niente altro) vale come valore; un range o uno scaglione vince sul numero
    const m = t.match(/^(\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d+))?$/) ?? t.match(/^(\d+)(?:\.(\d+))?$/);
    const singolo = m ? Number(m[1].replace(/\./g, '') + (m[2] != null ? '.' + m[2] : '')) : null;
    if (singolo != null && Number.isFinite(singolo)) { pr.valore = singolo; pr.testo = null; }
    else if (t === '') pr.testo = null;
    else pr.valore = null;
  }
  return o;
}

// Validazione leggera dell'output: la struttura c'e' e i tipi base tornano. Non "corregge" i valori: quelli li giudica l'umano.
export function validaOutput(target: Target, p: unknown): string | null {
  if (!p || typeof p !== 'object') return 'output non e\' un oggetto';
  const o = p as Record<string, unknown>;
  const campo = (k: string) => { const v = o[k]; return v && typeof v === 'object' && 'valore' in (v as object); };
  if (target === 'materiale') {
    for (const k of ['fornitore', 'categoria', 'materiale', 'prezzo', 'tipo']) if (!campo(k)) return `manca il campo ${k}`;
    if (!Array.isArray(o.colori)) return 'manca colori[]';
    const pr = o.prezzo as { valore?: unknown; testo?: unknown };
    if (pr.valore != null && typeof pr.valore !== 'number') return 'prezzo.valore non numerico';
    if (pr.valore != null && pr.testo) return 'prezzo con valore E testo insieme (deve essere uno dei due)';
    const cat = (o.categoria as { valore?: unknown }).valore;
    if (cat != null && !(CATEGORIE as readonly string[]).includes(String(cat))) return `categoria fuori lista: ${String(cat)}`;
  } else if (target === 'fornitore') {
    for (const k of ['nome', 'email', 'telefono']) if (!campo(k)) return `manca il campo ${k}`;
  } else if (target === 'foglio_ordine') {
    for (const k of ['fornitore', 'data_ordine']) if (!campo(k)) return `manca il campo ${k}`;
    if (!Array.isArray(o.righe)) return 'manca righe[]';
    for (const r of o.righe as Array<Record<string, unknown>>) {
      if (!r.modello || typeof r.modello !== 'object') return 'manca il modello della riga';
      if (typeof r.tutta !== 'boolean') return 'tutta non booleano';
      if (!Array.isArray(r.candidati)) return 'manca candidati[]';
      const q = (r.quantita as { valore?: unknown } | undefined)?.valore;
      if (q != null && (typeof q !== 'number' || q <= 0 || !Number.isInteger(q))) return 'quantita non intera positiva';
      if (r.tutta && q != null) return 'riga TUTTA con una quantita (la stima va in stima_pezzi)';
    }
  } else {
    for (const k of ['fornitore', 'data_ordine']) if (!campo(k)) return `manca il campo ${k}`;
    if (!Array.isArray(o.righe)) return 'manca righe[]';
    for (const r of o.righe as Array<Record<string, unknown>>) {
      const q = (r.quantita as { valore?: unknown } | undefined)?.valore;
      if (q != null && (typeof q !== 'number' || q <= 0 || !Number.isInteger(q))) return 'quantita non intera positiva';
    }
  }
  return null;
}
