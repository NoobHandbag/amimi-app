import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { csClient, EMAIL_TEAM_TESTO } from '../lib/csClient';
import { fetchBehDashboard } from '../lib/behApi';
import type { BehDash, BehOn, BehHealth, BehGiro } from '../lib/behApi';
import AppBar from '../components/AppBar';
import '../styles/screens/comportamento.css';

// Pagina "Comportamento" (modulo beh_*, sola lettura, migr 0169-0171): da dove arrivano gli ordini di amimi.it, quanti
// ne vede il tracciamento, cosa succede dopo un click sulle ads, chi torna a comprare e l'Area Membri. Una sola RPC col
// login del team, solo aggregati. Le visite contano solo chi accetta i cookie (Fase 1: il 27,6% degli ordini online non
// ha visite registrate), quindi ogni numero sulle visite lo dice. Scheletro di Premia (login, periodo, risposte vecchie).

const num = (n: number) => new Intl.NumberFormat('it-IT').format(n || 0);
const eur0 = (n: number) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n || 0);
const eur2 = (n: number) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
const quota = (a: number | null, b: number | null) => (a != null && b ? (a / b) * 100 : null);
const pct1 = (a: number | null, b: number | null) => { const q = quota(a, b); return q === null ? 'n.d.' : q.toLocaleString('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%'; };
const fmtDay = (d: string | null) => (d ? new Date(String(d).slice(0, 10) + 'T00:00:00').toLocaleDateString('it-IT', { day: '2-digit', month: 'short' }) : 'n.d.');
const fmtOra = (iso: string | null) => (iso ? new Date(iso).toLocaleString('it-IT', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'mai');
const SEV_CLS: Record<string, string> = { error: 'neg', warn: 'warn', ok: 'pos' };
const sevRank = (s: string) => (s === 'error' ? 0 : s === 'warn' ? 1 : 2);

// classi delle sorgenti (beh-sync, PURE:beh-ordini), nell'ordine in cui si mostrano
const SORGENTE: [string, string][] = [
  ['direct', 'Diretto (link salvato, indirizzo scritto, app)'],
  ['search', 'Ricerca (Google e simili)'],
  ['social', 'Social, senza ads'],
  ['paid_social', 'Ads Meta'],
  ['email', 'Email'],
  ['paid_search', 'Ricerca a pagamento'],
  ['referral', 'Altri siti'],
  ['unknown', 'Sorgente non riconosciuta'],
  ['none', 'Nessuna visita registrata (di solito cookie non accettati)'],
];
const CANALE: Record<string, string> = { online_store: 'Sito', bozza: 'Ordini a mano', facebook_instagram: 'Checkout in Instagram e Facebook', shop: 'App Shop', sconosciuto: 'Canale sconosciuto' };
const canaleNome = (k: string) => CANALE[k] ?? (k.startsWith('app:') ? `Altra app (${k.slice(4)})` : k);
const PASSO: Record<string, string> = { ordini: 'Ordini (Shopify)', meta: 'Ads Meta (click e pagine caricate)' };
const NOME: Record<string, string> = {
  beh_fresh: 'Giri del modulo', beh_tracciamento_guasto: 'Tracciamento delle visite (48 ore)', beh_quota_tracciata: 'Quota tracciata (28 giorni)',
  beh_copertura: 'Giorni mancanti (35 giorni)',
  beh_ordini: 'Giro ordini', beh_ordini_backfill: 'Recupero dello storico ordini', beh_meta: 'Giro Meta', beh_meta_backfill: 'Recupero dello storico Meta', beh_sync: 'beh-sync',
};
const HINT: Record<string, string> = {
  beh_fresh: 'Un giro del cron non arriva da piu\' della sua soglia, la spesa Meta e\' ferma, oppure una soglia in app_flags e\' scritta male: avvisa Code.',
  beh_tracciamento_guasto: 'Ordini del sito senza nessuna visita registrata: controllare il banner dei cookie e il tracciamento di Shopify.',
  beh_quota_tracciata: 'Meno ordini del solito hanno visite registrate: banner dei cookie o tracciamento da controllare.',
  beh_copertura: 'Ci sono giorni che nessun giro riuscito ha letto. Ordini e click Meta: il giro rilegge solo gli ultimi 7, quindi serve un recupero di beh-sync. Spesa Meta: nessuna riga in quei giorni e nessun giro Meta che li abbia letti senza click, quindi serve un recupero di ads-sync (da solo legge solo ieri). Avvisa Code coi giorni scritti qui sopra.',
  beh_ordini: 'L\'ultimo giro ordini non e\' andato: il messaggio dice perche\'. Il giro di domani rilegge gli ultimi 7 giorni; un fermo piu\' lungo lo segnala "Giorni mancanti".',
  beh_meta: 'L\'ultimo giro Meta non e\' andato: il messaggio dice perche\'. Il giro di domani rilegge gli ultimi 7 giorni; un fermo piu\' lungo lo segnala "Giorni mancanti".',
  backfill: 'Il recupero dello storico non e\' andato e non riparte da solo: va rilanciato a mano (avvisa Code).',
};
// chiavi di salute che appartengono a un passo: con quel passo spento non contano (non tengono rosso il pallino)
const passoDi = (k: string): string | null => (k.startsWith('beh_ordini') || k === 'beh_tracciamento_guasto' || k === 'beh_quota_tracciata' ? 'ordini'
  : k.startsWith('beh_meta') ? 'meta' : null);
const giorni = (n: number, uno: string, tanti: string) => (n === 1 ? `1 ${uno}` : `${num(n)} ${tanti}`);
const giornoDopo = (d: string) => new Date(Date.parse(d.slice(0, 10) + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
// le fasce le conta il server con le stesse date di beh_copertura: nessuna frase decisa dal solo giorno piu' recente
const inSalute = (s: number, tot: number) => (s === tot ? 'li elenca' : `di questi ${s === 1 ? 'uno lo' : `${num(s)} li`} elenca`) + ' anche "Giorni mancanti" in Salute';
// frase di una fascia: "E'"/"Sono" se la fascia ha tutti i giorni mancanti, "Uno e'"/"N sono" se ne ha una parte
const fascia = (n: number, tot: number, dove: string, cosa: (uno: boolean) => string) =>
  (n > 0 ? ` ${n === tot ? (n === 1 ? 'E\'' : 'Sono') : (n === 1 ? 'Uno e\'' : `${num(n)} sono`)} ${dove}: ${cosa(n === 1)}` : '');

// frecce sul periodo prima: copiate da Salute (deltaPct e Delta), senza toccare Salute. Qui un valore puo' mancare
// (null): periodo prima che comincia prima dei dati, o un costo per ordine senza ordini. Allora "n.d.", mai una freccia.
function deltaPct(cur: number | null, prev: number | null): number | null {
  if (cur == null || !prev) return null;
  return (cur - prev) / prev;
}
function Delta({ cur, prev, goodUp = true }: { cur: number | null; prev: number | null; goodUp?: boolean }) {
  const d = deltaPct(cur, prev);
  if (d == null) return <span className="muted">n.d.</span>;
  const up = d >= 0;
  const good = goodUp ? up : !up;
  return <span className={`ds-delta ${d === 0 ? 'flat' : good ? 'up' : 'down'}`}>{d === 0 ? '' : up ? '+' : '−'}{Math.abs(d * 100).toLocaleString('it-IT', { maximumFractionDigits: 0 })}%</span>;
}

function Kpi({ v, k, sub }: { v: ReactNode; k: string; sub?: ReactNode }) {
  return <div className="kpi"><div className="v">{v}</div><div className="k">{k}</div>{sub ? <div className="ksub">{sub}</div> : null}</div>;
}

// barre giornaliere: ordini del sito con attribuzione finita (grigio) e la parte con visite registrate (bordeaux)
function Barre({ rows }: { rows: BehOn['ordini']['giorni'] }) {
  if (!rows.length) return <p className="note">Nessun ordine nel periodo.</p>;
  const max = Math.max(1, ...rows.map((r) => r.online));
  const W = 100 / rows.length;
  return (
    <div>
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" style={{ width: '100%', height: 90, display: 'block' }} role="img" aria-label="Ordini del sito per giorno, con e senza visite registrate">
        {rows.map((r, i) => {
          const h = (r.online / max) * 38; const ht = (Math.min(r.tracciati, r.online) / max) * 38;
          return (<g key={r.day}>
            <rect className="cmp-bar" x={i * W + W * 0.15} y={40 - h} width={W * 0.7} height={h}><title>{fmtDay(r.day)}: {r.online} ordini del sito, {r.tracciati} con visite registrate</title></rect>
            {r.tracciati > 0 && <rect className="cmp-bar on" x={i * W + W * 0.15} y={40 - ht} width={W * 0.7} height={ht} />}
          </g>);
        })}
      </svg>
      <div className="cmp-axis"><span>{fmtDay(rows[0].day)}</span><span>max {num(max)} ordini al giorno</span><span>{fmtDay(rows[rows.length - 1].day)}</span></div>
      <p className="note" style={{ marginTop: 4 }}>{'Barra grigia = ordini del sito di quel giorno con attribuzione finita; parte bordeaux = quelli con visite registrate.'}</p>
    </div>
  );
}

// righe a barra orizzontale: un'etichetta, il numero, la quota sul totale
function Righe({ rows }: { rows: [string, number][] }) {
  const tot = rows.reduce((s, [, n]) => s + n, 0);
  const top = Math.max(1, ...rows.map(([, n]) => n));
  if (!tot) return <p className="note">Nessun ordine nel periodo.</p>;
  return (
    <div>
      {rows.map(([label, n]) => (
        <div key={label} className="cmp-fstep">
          <div className="cmp-flab"><span>{label}</span><strong>{num(n)}<span className="cmp-fpct"> · {pct1(n, tot)}</span></strong></div>
          <div className="cmp-ftrack"><div className="cmp-ffill" style={{ width: (n / top) * 100 + '%' }} /></div>
        </div>
      ))}
    </div>
  );
}

// imbuto: ogni passaggio con la quota sul precedente, l'ultimo in bordeaux
function Funnel({ steps }: { steps: [string, number][] }) {
  const top = Math.max(1, steps[0][1]);
  return (
    <div>
      {steps.map(([label, v], i) => (
        <div key={label} className="cmp-fstep">
          <div className="cmp-flab"><span>{label}</span><strong>{num(v)}{i > 0 && v <= steps[i - 1][1] ? <span className="cmp-fpct"> · {pct1(v, steps[i - 1][1])}</span> : null}</strong></div>
          <div className="cmp-ftrack"><div className={'cmp-ffill' + (i === steps.length - 1 ? ' last' : '')} style={{ width: Math.min(100, (v / top) * 100) + '%' }} /></div>
        </div>
      ))}
    </div>
  );
}

function Dashboard({ d, src, setSrc }: { d: BehOn; src: 'ultima' | 'prima'; setSrc: (s: 'ultima' | 'prima') => void }) {
  const o = d.ordini, f = d.fonti, c = d.clienti, p = d.premia;
  const qCur = quota(o.online_tracciati, o.online_pronti), qPrev = quota(o.prev_online_tracciati, o.prev_online_pronti);
  const puntiQuota = qCur !== null && qPrev !== null ? qCur - qPrev : null;
  const visite = src === 'ultima' ? f.ultima_visita : f.prima_visita;
  const sorgenti: [string, number][] = SORGENTE.filter(([k]) => (visite[k] ?? 0) > 0).map(([k, label]) => [label, visite[k]]);
  for (const [k, n] of Object.entries(visite)) if (!SORGENTE.some(([s]) => s === k) && n > 0) sorgenti.push([k || 'Sorgente vuota', n]);
  // costo per ordine: null senza spesa letta o senza ordini (o senza periodo prima confrontabile), mai "-100%" su un vuoto
  const cpa = f.spesa_meta != null && f.ordini_cpa ? f.spesa_meta / f.ordini_cpa : null;
  const cpaPrev = f.prev_ordini_cpa && f.prev_spesa_meta != null ? f.prev_spesa_meta / f.prev_ordini_cpa : null;
  const metaAcceso = d.steps.includes('meta');
  // giorni contati oltre l'ultima riga di spesa: solo giorni senza consegna letti dal giro Meta (spesa 0), mai prima del periodo
  const zeroDal = f.spesa_al && f.meta_dati_al && f.spesa_dal && f.spesa_al > f.meta_dati_al
    ? (f.meta_dati_al >= f.spesa_dal ? giornoDopo(f.meta_dati_al) : f.spesa_dal) : null;
  const maturi = c.coorti.filter((x) => x.maturita_giorni >= 90);
  // salute e giri dei soli passi accesi (un passo spento non tiene rosso il pallino); un giro del cron piu' vecchio della
  // sua soglia (quella di beh_fresh, decisa dal server) conta warn
  const health = d.salute.health.filter((h) => { const s = passoDi(h.k); return !s || d.steps.includes(s); })
    .sort((a, b) => sevRank(a.severity) - sevRank(b.severity) || a.k.localeCompare(b.k));
  const ora = Date.parse(d.generated_at);
  const fermo = (g: BehGiro) => !g.ended_at || ora - Date.parse(g.ended_at) > (g.soglia_ore || 48) * 3600 * 1000;
  const giri = d.salute.giri.filter((g) => d.steps.includes(g.step));
  const statoGiro = (g: BehGiro) => (g.status === 'ok' && fermo(g) ? 'warn' : g.status);
  const worst = [...health.map((h) => h.severity), ...giri.map(statoGiro)].sort((a, b) => sevRank(a) - sevRank(b))[0] ?? 'ok';
  const overallLabel = worst === 'error' ? 'Da sistemare' : worst === 'warn' ? 'Da tenere d’occhio' : 'Tutto in ordine';
  const rigaSalute = (h: BehHealth) => (
    <li key={h.k} className={'cmp-hrow sev-' + (SEV_CLS[h.severity] ?? 'nd')}>
      <div className="rt">{NOME[h.k] ?? h.k}</div>
      {/* datata su oggi, non sulla fine del periodo (che e' sempre ieri o prima) */}
      <div className="rs">{h.label}{h.day < d.oggi ? ` (del ${fmtDay(h.day)})` : null}</div>
      {h.severity !== 'ok' && <div className="note">{(h.k.endsWith('_backfill') ? HINT.backfill : HINT[h.k]) ?? 'Avvisa Code con il messaggio qui sopra.'}</div>}
    </li>
  );
  const rigaGiro = (g: BehGiro) => (
    <li key={g.step} className={'cmp-hrow sev-' + (SEV_CLS[statoGiro(g)] ?? 'nd')}>
      <div className="rt">{PASSO[g.step] ?? g.step}</div>
      <div className="rs">{`ultimo giro del cron ${fmtOra(g.ended_at)}, esito ${g.status}${g.rows_written != null ? `, ${num(g.rows_written)} righe` : ''}${g.status === 'ok' && fermo(g) ? `: fermo da piu' di ${(g.soglia_ore || 48) >= 72 ? `${Math.floor((g.soglia_ore || 48) / 24)} giorni` : `${g.soglia_ore || 48} ore`}` : ''}`}</div>
    </li>
  );
  const fonteDati = (testo: string) => <p className="note">{`Fonte: ${testo}.`}</p>;

  return (
    <>
      <p className="note" style={{ marginTop: 0 }}>{`Dal ${fmtDay(d.from)} al ${fmtDay(d.to)}, confronto coi ${d.days} giorni prima: numeri aggregati, nessun dato personale. Le fonti si aggiornano una volta al giorno, quindi il periodo finisce all'ultimo giorno completo, mai oggi.`}</p>

      <section className="card">
        <h2>Ordini e tracciamento</h2>
        <div className="kpis">
          <div className="ds-kpi hero">
            <div className="v">{pct1(o.online_tracciati, o.online_pronti)}</div>
            <div className="l">Ordini del sito con visite registrate</div>
            <div className="s">{`${num(o.online_tracciati)} su ${num(o.online_pronti)}${o.in_attribuzione ? `, piu' ${num(o.in_attribuzione)} ancora in attribuzione` : ''}. Periodo prima ${pct1(o.prev_online_tracciati, o.prev_online_pronti)}${puntiQuota !== null ? ` (${puntiQuota >= 0 ? '+' : '−'}${Math.abs(puntiQuota).toLocaleString('it-IT', { maximumFractionDigits: 1 })} punti)` : ''}`}</div>
          </div>
          <Kpi v={num(o.tutti)} k="Ordini, tutti i canali" sub={<Delta cur={o.tutti} prev={o.prev_tutti} />} />
          <Kpi v={num(o.online)} k="Ordini dal sito" />
          <Kpi v={eur0(o.lordo)} k="Lordo degli ordini, tutti i canali" />
        </div>
        <Barre rows={o.giorni} />
        <div className="pillrow">{Object.entries(o.per_canale).sort((a, b) => b[1] - a[1]).map(([k, n]) => <span key={k} className="pill muted">{canaleNome(k)}: {num(n)}</span>)}</div>
        <p className="note">{'Le visite si vedono solo per chi accetta i cookie: un ordine senza visite registrate e\' di solito un ordine di chi non li ha accettati, non un ordine senza fonte. Gli ordini "in attribuzione" sono i piu\' recenti: Shopify finisce di attribuirli in qualche ora.'}</p>
        <p className="note">{`Fonte: ${o.fonte}, aggiornata ${fmtOra(o.dati_al)}.`}</p>
      </section>

      <section className="card">
        <h2>Da dove arrivano gli ordini</h2>
        <div className="seg" style={{ marginBottom: 10 }}>
          <button type="button" className={src === 'ultima' ? 'on' : ''} onClick={() => setSrc('ultima')}>Ultima visita</button>
          <button type="button" className={src === 'prima' ? 'on' : ''} onClick={() => setSrc('prima')}>Prima visita</button>
        </div>
        <Righe rows={sorgenti} />
        <p className="note">{src === 'ultima'
          ? 'Ultima visita = da dove e\' arrivata la cliente la volta in cui ha comprato. Solo ordini del sito con attribuzione finita.'
          : 'Prima visita = la prima volta che Shopify ha visto la cliente, anche settimane prima dell\'ordine. Solo ordini del sito con attribuzione finita.'}</p>
        {fonteDati(`${f.fonte}`)}

        <h3 className="cmp-h3">Ads Meta</h3>
        <div className="kpis">
          <Kpi v={f.spesa_meta != null ? eur2(f.spesa_meta) : 'n.d.'} k="Spesa Meta" sub={<Delta cur={f.spesa_meta} prev={f.prev_spesa_meta} goodUp={false} />} />
          <Kpi v={cpa != null ? eur2(cpa) : 'n.d.'} k="Costo per ordine (blended)" sub={<Delta cur={cpa} prev={cpaPrev} goodUp={false} />} />
        </div>
        {f.giorni_spesa_mancanti > 0 && (
          <p className="note warn">{f.giorni_spesa_mancanti === 1
            ? `Spesa n.d.: 1 giorno del periodo (il ${fmtDay(f.ultimo_giorno_spesa_mancante)}) non ha nessuna riga di spesa: ads-sync non l'ha letto, o le ads erano tutte ferme. Se erano attive serve un recupero di ads-sync per quel giorno${f.giorni_spesa_mancanti_salute > 0 ? ': lo elenca anche "Giorni mancanti" in Salute' : ''}.`
            : `Spesa n.d.: ${num(f.giorni_spesa_mancanti)} giorni del periodo non hanno nessuna riga di spesa (l'ultimo il ${fmtDay(f.ultimo_giorno_spesa_mancante)}): ads-sync non li ha letti, o le ads erano tutte ferme. Se erano attive serve un recupero di ads-sync per quei giorni${f.giorni_spesa_mancanti_salute > 0 ? `: ${inSalute(f.giorni_spesa_mancanti_salute, f.giorni_spesa_mancanti)}` : ''}.`}</p>
        )}
        {f.giorni_spesa_mancanti === 0 && f.giorni_spesa_mancanti_prima > 0 && (
          <p className="note">{`Confronto n.d.: nel periodo prima ${giorni(f.giorni_spesa_mancanti_prima, 'giorno non ha', 'giorni non hanno')} righe di spesa.`}</p>
        )}
        {f.giorni_spesa > 0 ? (
          <p className="note">{`Costo per ordine blended = spesa Meta divisa per tutti gli ordini degli stessi giorni (${num(f.ordini_cpa)}), non solo quelli venuti dalle ads. Spesa e costo contano i ${num(f.giorni_spesa)} giorni dal ${fmtDay(f.spesa_dal)} al ${fmtDay(f.spesa_al)} gia' coperti dalla spesa (${zeroDal ? `righe per annuncio fino al ${fmtDay(f.meta_dati_al)}; dal ${fmtDay(zeroDal)} al ${fmtDay(f.spesa_al)} il giro Meta non ha trovato consegne, quindi spesa 0` : `aggiornata al ${fmtDay(f.meta_dati_al)}`}), confrontati con lo stesso numero di giorni prima; n.d. quando quei giorni cominciano prima della spesa per annuncio, letta dal 20 giugno.`}</p>
        ) : <p className="note">{`Nessun giorno del periodo e' coperto dalla spesa per annuncio (${f.meta_dati_al ? `righe fino al ${fmtDay(f.meta_dati_al)}` : 'nessuna riga letta'}): spesa e costo per ordine sono n.d., non zero.`}</p>}
        {!metaAcceso ? <p className="note">{'Il passo Meta del modulo e\' spento: click, uscite e pagine caricate compariranno qui quando si accende.'}</p>
          : !f.ads.dati_al ? <p className="note">{'Nessun click Meta letto nel periodo: se le ads erano attive, guarda il giro Meta in Salute.'}</p>
          : f.giorni_click_mancanti > 0 ? (
          <>
            <p className="note warn">{`${f.giorni_click_mancanti === 1
              ? `Click parziali: 1 giorno del periodo (il ${fmtDay(f.ultimo_giorno_click_mancante)}) non e' stato letto dal giro Meta`
              : `Click parziali: ${num(f.giorni_click_mancanti)} giorni del periodo non sono stati letti dal giro Meta (l'ultimo il ${fmtDay(f.ultimo_giorno_click_mancante)})`}, quindi i numeri qui sotto possono essere piu' bassi del vero.${fascia(f.click_mancanti_recenti, f.giorni_click_mancanti, 'nella finestra del cron (ultimi 7 giorni)', (u) => `il prossimo giro del cron ${u ? 'lo' : 'li'} rilegge; se ${u ? 'resta mancante lo' : 'restano mancanti li'} elenchera' "Giorni mancanti" in Salute.`)}${fascia(f.click_mancanti_salute, f.giorni_click_mancanti, 'fuori dalla finestra del cron, ma degli ultimi 35 giorni', (u) => `${u ? 'lo' : 'li'} elenca "Giorni mancanti" in Salute.`)}${fascia(f.click_mancanti_vecchi, f.giorni_click_mancanti, "di piu' di 35 giorni fa", (u) => `nessun giro ${u ? 'lo' : 'li'} rilegge piu' e Salute non ${u ? 'lo' : 'li'} elenca: serve un backfill di beh-sync per ${u ? 'quel giorno' : 'quei giorni'}.`)}`}</p>
            <Funnel steps={[
              ['Click sul link dell\'annuncio (parziali)', f.ads.link_clicks],
              ['Uscite verso il sito (parziali)', f.ads.outbound_clicks],
              ['Pagine del sito caricate (parziali)', f.ads.landing_page_views],
            ]} />
          </>
          )
          : (
          <>
            <Funnel steps={[
              ['Click sul link dell\'annuncio', f.ads.link_clicks],
              ['Uscite verso il sito', f.ads.outbound_clicks],
              ['Pagine del sito caricate', f.ads.landing_page_views],
            ]} />
            <p className="note">{`Con le Collection il primo tocco apre la vetrina dentro Instagram: i click sul link contano anche quello, le uscite contano solo chi va sul sito. Le pagine caricate le conta il pixel, quindi solo chi accetta i cookie. Dati al ${fmtDay(f.ads.dati_al)}.`}</p>
          </>
        )}
      </section>

      <section className="card">
        <h2>Clienti che tornano</h2>
        <div className="kpis cmp-list">
          <Kpi v={num(c.clienti)} k="Clienti con almeno un ordine" />
          <Kpi v={num(c.con_2_ordini)} k="Con 2 o piu' ordini" sub={pct1(c.con_2_ordini, c.clienti) + ' dei clienti'} />
          <Kpi v={pct1(c.riacquisto_90.ricomprato, c.riacquisto_90.clienti)} k="Riacquisto entro 90 giorni" sub={`${num(c.riacquisto_90.ricomprato)} su ${num(c.riacquisto_90.clienti)} clienti delle coorti con almeno 90 giorni dal primo del mese`} />
        </div>
        {c.coorti.length > 0 && (
          <table className="dtable" style={{ marginTop: 10 }}>
            <thead><tr><th>Primo ordine</th><th className="cmp-n">Clienti</th><th className="cmp-n">Ricomprato in 90 gg</th></tr></thead>
            <tbody>{c.coorti.map((x) => {
              const maturo = x.maturita_giorni >= 90;
              return (<tr key={x.coorte} className={maturo ? '' : 'cmp-immatura'}>
                <td>{String(x.coorte).slice(0, 7)}{maturo ? '' : ' (non ancora a 90 giorni)'}</td>
                <td className="cmp-n">{num(x.clienti)}</td>
                <td className="cmp-n">{maturo ? `${num(x.ricomprato_90gg)} · ${pct1(x.ricomprato_90gg, x.clienti)}` : num(x.ricomprato_90gg)}</td>
              </tr>);
            })}</tbody>
          </table>
        )}
        <p className="note">{`Tutta la storia, non segue il periodo scelto. Una coorte = i clienti col primo ordine nello stesso mese. Il riacquisto conta solo le ${num(maturi.length)} coorti che hanno gia' 90 giorni dal primo del mese: quelle in grigio sono ancora aperte.`}</p>
        {fonteDati(c.fonte)}
      </section>

      <section className="card">
        <h2>Area Membri</h2>
        <Funnel steps={[
          ['Hanno aperto l\'area', p.aperture],
          ['Avevano punti per un premio', p.premio_pronto],
          ['Hanno toccato Riscatta', p.tap_riscatta],
          ['Hanno riscattato', p.riscatti],
          ['Ordini pagati con AMICA12 (ordini)', p.ordini_amica12],
        ]} />
        <p className="note">Aperture rispetto al periodo prima: <Delta cur={p.aperture} prev={p.prev_aperture} />. {`Stesse definizioni della tab Premia (clienti distinti, tranne l'ultimo passaggio che conta ordini), ma sul periodo di questa pagina, che finisce all'ultimo giorno completo: i numeri possono differire da Premia di qualche cliente. Le aperture si contano dal 21 settembre (prima il confronto e' n.d.); "punti per un premio" e "Riscatta" vengono dal tracciamento dei tap${p.tap_dal ? ` (dati dal ${fmtDay(p.tap_dal)})` : ''}.`}</p>
        {fonteDati(p.fonte)}
      </section>

      <section className="card">
        <h2>Salute delle fonti <span className={'ds-pill ' + (SEV_CLS[worst] ?? 'pos')}>{overallLabel}</span></h2>
        <ul className="cmp-hlist" role="list">{giri.map(rigaGiro)}{health.map(rigaSalute)}</ul>
        {giri.length === 0 && <p className="note">{'Nessun giro del cron ancora per i passi accesi: il primo parte la mattina dopo l\'accensione del modulo.'}</p>}
        <p className="note">{`Passi accesi: ${d.steps.length ? d.steps.map((s) => PASSO[s] ?? s).join(', ') : 'nessuno'}. I giri del cron partono ogni mattina poco dopo le 7 (le 8 con l'ora legale) e rileggono gli ultimi 7 giorni; qui si vede l'ultimo giro del cron di ogni passo, non i recuperi dello storico.`}</p>
      </section>
    </>
  );
}

export default function Comportamento({ onBack }: { onBack: () => void }) {
  const [session, setSession] = useState<'loading' | 'in' | 'out'>('loading');
  const [email, setEmail] = useState(''); const [pwd, setPwd] = useState(''); const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [days, setDays] = useState(30);
  const [d, setD] = useState<BehDash | null>(null);
  const [src, setSrc] = useState<'ultima' | 'prima'>('ultima');

  useEffect(() => {
    csClient.auth.getSession().then(({ data }) => setSession(data.session ? 'in' : 'out'));
    const { data: sub } = csClient.auth.onAuthStateChange((_e, s) => setSession(s ? 'in' : 'out'));
    return () => sub.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (session !== 'in') return;
    // cambio periodo rapido: una risposta vecchia non sovrascrive quella nuova
    let vivo = true;
    setErr(''); setD(null);
    fetchBehDashboard(days).then((x) => { if (vivo) setD(x); }).catch((e: Error) => { if (vivo) setErr(e.message); });
    return () => { vivo = false; };
  }, [session, days]);

  const doLogin = async () => {
    setBusy(true); setErr('');
    const { error } = await csClient.auth.signInWithPassword({ email: email.trim(), password: pwd });
    setBusy(false);
    if (error) setErr('Accesso non riuscito. Controlla email e password.'); else setPwd('');
  };
  const doGoogle = async () => {
    setBusy(true); setErr('');
    // redirectTo SENZA hash: Supabase appende la sessione come fragment (#access_token=...), un hash nostro lo romperebbe
    const { error } = await csClient.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin + import.meta.env.BASE_URL, queryParams: { prompt: 'select_account' } } });
    if (error) { setBusy(false); setErr('Google non attivo: accedi con email e password.'); }
  };

  const header = <AppBar title="Comportamento" onBack={onBack} backLabel="Home" />;

  if (session === 'loading') return <div className="screen scr-comportamento">{header}<p className="muted center">{'Controllo l\'accesso...'}</p></div>;
  if (session === 'out') return (
    <div className="screen scr-comportamento">
      {header}
      <div className="cs-login">
        <div className="cs-logo">amimi<span>&#8217; comportamento</span></div>
        <div className="cs-lt">{'Da dove arrivano gli ordini e chi torna a comprare: accedi con il tuo account Amimi\''}</div>
        <button className="ds-btn secondary full" onClick={doGoogle} disabled={busy} type="button">Accedi con Google</button>
        <div className="cs-or">oppure con email</div>
        <div className="cs-fld"><label>Email ({EMAIL_TEAM_TESTO})</label>
          <input type="email" autoCapitalize="none" autoCorrect="off" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="info@amimi.it" /></div>
        <div className="cs-fld"><label>Password</label>
          <input type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') doLogin(); }} /></div>
        {err && <div className="err">{err}</div>}
        <button className="ds-btn primary full" onClick={doLogin} disabled={busy} type="button">{busy ? 'Accesso…' : 'Entra'}</button>
        <div className="cs-note">{`Stesso login di Premia e dell'Assistenza: vale qualsiasi casella ${EMAIL_TEAM_TESTO}, si fa una volta per dispositivo.`}</div>
      </div>
    </div>
  );

  const periodo = (
    <div className="seg" style={{ marginBottom: 12 }}>
      {[7, 30, 90].map((n) => <button key={n} type="button" className={days === n ? 'on' : ''} onClick={() => setDays(n)}>{n} giorni</button>)}
    </div>
  );
  if (err) return <div className="screen scr-comportamento">{header}{periodo}<div className="card err">{err}</div></div>;
  if (!d) return <div className="screen scr-comportamento">{header}{periodo}<p className="muted center">Carico i numeri...</p></div>;
  if (d.state !== 'on') return <div className="screen scr-comportamento">{header}<div className="card muted center">Sezione non attiva (flag beh_enabled spento).</div></div>;
  return <div className="screen scr-comportamento">{header}{periodo}<Dashboard d={d} src={src} setSrc={setSrc} /></div>;
}
