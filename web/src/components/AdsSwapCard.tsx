import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { fetchAdsSwap, fetchAdsPeriodo } from '../lib/api';
import type { AdsSwap, AdsPeriodo } from '../lib/api';
import { oggi } from '../lib/helpers';
import Icon from './Icon';
import '../styles/screens/ads-swap.css';

// Card del Cruscotto "Creativita' da cambiare" (28-10-2026, decisione Dan): prende il posto della card "Meta Ads 2026",
// che leggeva v_ads_mensile ferma al 01-07. Due viste della migr 0175, sola lettura via anon: v_ads_swap (un ad per
// riga, stato e motivo calcolati a DB con la regola di cambio) e v_ads_periodo_14g (ultimi 14 giorni contro i 14 prima,
// per account, campagna, adset e ad). Una lettura fallita si vede nella card, mai una card sparita.

const CPA_TARGET = 45, CPA_BREAKEVEN = 76.7;
const IMPR_MIN = 1000;     // impression per lato sotto cui il CTR non si confronta (k.impr_min della vista)
const GIORNI_VECCHI = 2;   // as_of e' ieri: oltre 2 giorni il pull del mattino non e' arrivato (Regola Ferrea 18)

const num = (v: unknown): number | null => { if (v == null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const it = (n: number, dec: number) => n.toLocaleString('it-IT', { minimumFractionDigits: dec, maximumFractionDigits: dec });
const eur0 = (n: number) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);
const eur2 = (n: number) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const pct = (n: number, dec = 2) => it(n, dec) + '%';
const molt = (n: number) => it(n, 2) + '×';
const intero = (n: number) => Math.round(n).toLocaleString('it-IT');
const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const giorniFa = (iso: string) => Math.round((Date.parse(oggi() + 'T12:00:00Z') - Date.parse(iso.slice(0, 10) + 'T12:00:00Z')) / 86400000);
const varPct = (a: number | null, b: number | null) => (a == null || b == null || b === 0 ? null : (a / b - 1) * 100);
const cpaTono = (cpa: number | null) => (cpa == null ? '' : cpa <= CPA_TARGET ? 'pos' : cpa <= CPA_BREAKEVEN ? 'warn' : 'neg');
// vista non ancora creata (migrazione 0175 non applicata): PostgREST risponde PGRST205, lo si dice in chiaro.
// L'errore di PostgREST puo' arrivare come oggetto semplice {code, message}, non come Error: si legge message
const errMsg = (e: unknown, vista: string) => {
  const o = (e ?? {}) as { code?: unknown; message?: unknown };
  if (o.code === 'PGRST205') return `la vista ${vista} non c'e' ancora (migrazione 0175 non applicata)`;
  return typeof o.message === 'string' && o.message ? o.message : String(e);
};

const STATI: Record<string, { label: string; pill: string; gruppo: string }> = {
  cambia: { label: 'da cambiare', pill: 'neg', gruppo: 'Da cambiare' },
  osserva: { label: 'da osservare', pill: 'warn', gruppo: 'Da osservare' },
  nuova: { label: 'nuova', pill: 'info', gruppo: 'Nuove' },
  ok: { label: 'ok', pill: 'pos', gruppo: 'Ok' },
  senza_consegna: { label: 'senza consegna', pill: 'sw-off', gruppo: 'Senza consegna' },
  in_pausa: { label: 'in pausa', pill: 'sw-off', gruppo: 'In pausa' },
};
// i sei stati della vista hanno un gruppo (senza consegna e in pausa chiusi in fondo); uno stato che la card non
// conosce non sparisce: finisce fra quelli da osservare
const statoDi = (s: string | null) => (s && STATI[s] ? s : 'osserva');

// il verdetto del colore detto anche a voce (lettore di schermo): verde = meglio, rosso = peggio
const VERDETTO: Record<string, string> = { good: 'meglio', bad: 'peggio', flat: 'quasi invariato' };

// variazione in percento, colorata secondo il verso buono della metrica (meglio = 'su' o 'giu'); sotto il 5% e' neutra.
// piccola: un lato del confronto sotto le 1.000 impression (o CTR di base a zero), la variazione resta grigia
function Delta({ v, meglio, dopo, piccola = false }: { v: number | null; meglio: 'su' | 'giu'; dopo: string; piccola?: boolean }) {
  if (v == null) return null;
  const tono = piccola || Math.abs(v) < 5 ? 'flat' : (v > 0) === (meglio === 'su') ? 'good' : 'bad';
  return (
    <small className={`sw-d ${tono}`}>
      {v > 0 ? '+' : v < 0 ? '-' : ''}{Math.round(Math.abs(v))}% {dopo}{piccola && ' (base piccola)'}
      <span className="sw-sr">{piccola ? ', non valutato' : `, ${VERDETTO[tono]}`}</span>
    </small>
  );
}

function M({ v, extra, l, d, tono = '' }: { v: string; extra?: string; l: string; d?: ReactNode; tono?: string }) {
  return <div className={`sw-m ${tono}`}><b>{v}{extra && <small>{extra}</small>}</b><span>{l}</span>{d}</div>;
}

// anteprima: frame del video, poi la foto, poi il thumbnail di Meta; un url che non carica passa al successivo
function SwThumb({ urls, video }: { urls: (string | null)[]; video: boolean }) {
  const lista = [...new Set(urls.filter((u): u is string => !!u))];
  const [i, setI] = useState(0);
  const src = lista[i];
  return (
    <div className="sw-thumb">
      {src
        ? <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setI((n) => n + 1)} />
        : <span className="sw-ph">{video ? 'Video' : 'Senza foto'}</span>}
      {video && src && <span className="sw-vtag">Video</span>}
    </div>
  );
}

function AdRow({ r }: { r: AdsSwap }) {
  const st = STATI[statoDi(r.stato)] ?? STATI.osserva;
  const video = r.object_type === 'VIDEO';
  const freq = num(r.freq_7g), soglia = num(r.freq_soglia);
  const ctr7 = num(r.link_ctr_7), cpm7 = num(r.cpm_7), ctrBase = num(r.link_ctr_base);
  const ctrVar = num(r.ctr_var_pct) ?? varPct(ctr7, ctrBase);
  // CTR confrontabile solo con 1.000 impression per lato e un CTR di base sopra zero, come segnale_ctr nella vista
  const basePiccola = (num(r.impressions_7) ?? 0) < IMPR_MIN || (num(r.impressions_base) ?? 0) < IMPR_MIN || ctrBase === 0;
  const cpmVar = num(r.cpm_var_pct) ?? varPct(cpm7, num(r.cpm_base));
  const spesa14 = num(r.spend_14) ?? 0, acq14 = num(r.purchases_14) ?? 0, cpa = num(r.cpa_14), roas = num(r.roas_14);
  const hook7 = num(r.hook_7), hookBase = num(r.hook_base);
  const live = num(r.giorni_live), oos = num(r.pct_oos);
  return (
    <div className="sw-ad">
      <SwThumb urls={[r.frame_url, r.image_url, r.thumbnail_url]} video={video} />
      <div className="sw-info">
        <div className="sw-nm">{r.ad_name ?? r.ad_id}</div>
        <div className="sw-sub">{r.campaign_name ?? '(?)'} · {r.adset_name ?? '(senza adset)'}</div>
        <div className="sw-tags">
          <span className={`ds-pill ${st.pill}`}>{st.label}</span>
          {live != null && <span className="sw-live">live da {live} {live === 1 ? 'giorno' : 'giorni'}</span>}
        </div>
      </div>
      {r.motivo && <p className="sw-motivo">{r.motivo}</p>}
      {oos != null && oos >= 30 && <p className="sw-oos">Nel suo product set il {Math.round(oos)}% dei prodotti e' esaurito.</p>}
      <div className="sw-ms">
        <M v={freq == null ? 'n/d' : it(freq, 2)} extra={soglia == null ? undefined : ` / ${it(soglia, 1)}`} l="freq 7g / soglia" tono={r.segnale_freq || r.freq_mancante ? 'warn' : ''} />
        <M v={ctr7 == null ? 'n/d' : pct(ctr7)} l="CTR link 7g" d={<Delta v={ctrVar} meglio="su" dopo="vs inizio" piccola={basePiccola} />} tono={r.segnale_ctr ? 'neg' : ''} />
        <M v={cpm7 == null ? 'n/d' : eur2(cpm7)} l="CPM 7g" d={<Delta v={cpmVar} meglio="giu" dopo="vs inizio" />} />
        <M v={eur0(spesa14)} l="spesa 14g" tono={r.segnale_spesa ? 'neg' : ''} />
        <M v={intero(acq14)} l="acquisti 14g" />
        <M v={cpa == null ? 'n/d' : eur2(cpa)} l="CPA 14g" tono={cpa == null ? (r.segnale_spesa ? 'neg' : '') : cpaTono(cpa)} />
        <M v={roas == null ? 'n/d' : molt(roas)} l="ROAS 14g" />
        {video && <M v={hook7 == null ? 'n/d' : pct(hook7, 0)} l="hook 7g" d={hookBase == null ? undefined : <Delta v={varPct(hook7, hookBase)} meglio="su" dopo={`(inizio ${pct(hookBase, 0)})`} />} />}
      </div>
    </div>
  );
}

// ---- tabella 14 giorni contro 14: una coppia (cur14, prev14) per oggetto ----
type Coppia = { base: AdsPeriodo; cur: AdsPeriodo | null; prev: AdsPeriodo | null };
type Col = { k: keyof AdsPeriodo; h: string; fmt: (n: number) => string; meglio: 'su' | 'giu' | null };
const COLS: Col[] = [
  { k: 'spend', h: 'Spesa', fmt: eur0, meglio: null },
  { k: 'roas', h: 'ROAS', fmt: molt, meglio: 'su' },
  { k: 'cpa', h: 'CPA', fmt: eur2, meglio: 'giu' },
  { k: 'purchases', h: 'Acquisti', fmt: intero, meglio: 'su' },
  { k: 'reach', h: 'Reach', fmt: intero, meglio: null },
  { k: 'frequency', h: 'Frequency', fmt: (n) => it(n, 2), meglio: 'giu' },
  { k: 'link_ctr', h: 'CTR link', fmt: (n) => pct(n), meglio: 'su' },
  { k: 'cpm', h: 'CPM', fmt: eur2, meglio: 'giu' },
  { k: 'link_clicks', h: 'Click link', fmt: intero, meglio: 'su' },
  { k: 'lpv_rate', h: 'LPV / click', fmt: (n) => pct(n, 0), meglio: 'su' },
  { k: 'atc_rate', h: 'ATC / LPV', fmt: (n) => pct(n, 1), meglio: 'su' },
  { k: 'hook_rate', h: 'Hook', fmt: (n) => pct(n, 0), meglio: 'su' },
];

// il valore di una finestra. Il CPA si colora anche qui sulle soglie (target 45, break-even 76,70), come sulle creativita'.
// Senza acquisti la vista lo lascia vuoto, ma con della spesa il CPA vale almeno quella spesa: '0 acq.', colorato sul
// limite inferiore (dal break-even rosso, oltre il target arancio)
function valore(r: AdsPeriodo | null, col: Col): { n: number | null; txt: string; tono: string } {
  const n = num(r?.[col.k]);
  if (n != null) return { n, txt: col.fmt(n), tono: col.k === 'cpa' ? cpaTono(n) : '' };
  const spesa = num(r?.spend) ?? 0;
  if (col.k === 'cpa' && spesa > 0 && num(r?.purchases) === 0) {
    return { n: null, txt: '0 acq.', tono: spesa >= CPA_BREAKEVEN ? 'neg' : spesa > CPA_TARGET ? 'warn' : '' };
  }
  return { n: null, txt: '–', tono: '' };
}

function Cella({ c, col }: { c: Coppia; col: Col }) {
  const cur = valore(c.cur, col), prev = valore(c.prev, col);
  if (cur.txt === '–' && prev.txt === '–') return <td className="sw-c" />;
  let freccia: ReactNode = null;
  if (cur.n != null && prev.n != null && cur.n !== prev.n) {
    const su = cur.n > prev.n;
    const rel = prev.n !== 0 ? Math.abs(cur.n - prev.n) / Math.abs(prev.n) : 1;
    const tono = col.meglio == null || rel < 0.03 ? 'flat' : su === (col.meglio === 'su') ? 'good' : 'bad';
    // a voce anche il verdetto del colore; la spesa non ha un verso
    const detto = (su ? 'in aumento' : 'in calo') + (col.meglio == null ? '' : `, ${VERDETTO[tono]}`);
    freccia = <span className={`sw-arr ${tono}`} role="img" aria-label={detto}>{su ? '▲' : '▼'}</span>;
  }
  return <td className="sw-c"><b className={cur.tono || undefined}>{cur.txt}</b>{freccia}<small>{prev.txt}</small></td>;
}

function Periodo({ righe }: { righe: AdsPeriodo[] }) {
  const [aperti, setAperti] = useState<Set<string>>(new Set());
  const t = useMemo(() => {
    const m = new Map<string, Coppia>();
    for (const r of righe) {
      const k = r.level + '|' + r.object_id;
      const c = m.get(k) ?? { base: r, cur: null, prev: null };
      if (r.window_key === 'cur14') c.cur = r; else if (r.window_key === 'prev14') c.prev = r;
      m.set(k, c);
    }
    const tutte = [...m.values()];
    const spesa = (c: Coppia) => num(c.cur?.spend) ?? 0;
    const di = (lv: AdsPeriodo['level']) => tutte.filter((c) => c.base.level === lv).sort((a, b) => spesa(b) - spesa(a) || String(a.base.object_name).localeCompare(String(b.base.object_name)));
    const camps = di('campaign'), adsets = di('adset'), ads = di('ad');
    const campIds = new Set(camps.map((c) => c.base.object_id));
    const cur = righe.find((r) => r.window_key === 'cur14'), prev = righe.find((r) => r.window_key === 'prev14');
    return {
      account: di('account'), camps, ads,
      adsetsDi: (id: string) => adsets.filter((a) => a.base.campaign_id === id),
      // un adset senza la sua campagna nella vista non si perde: va in fondo
      orfani: adsets.filter((a) => !campIds.has(a.base.campaign_id ?? '')),
      finestre: { cur: cur?.since && cur.until ? `${ddmm(cur.since)}-${ddmm(cur.until)}` : null, prev: prev?.since && prev.until ? `${ddmm(prev.since)}-${ddmm(prev.until)}` : null },
    };
  }, [righe]);

  const nome = (c: Coppia) => c.base.object_name ?? c.base.object_id;
  const riga = (c: Coppia, cella: ReactNode) => (
    <tr key={c.base.level + c.base.object_id} className={`sw-lv-${c.base.level}`}>
      <td className="l sw-name">{cella}</td>
      {COLS.map((col) => <Cella key={col.k} c={c} col={col} />)}
    </tr>
  );
  const adsetRighe = (a: Coppia) => {
    const id = a.base.object_id;
    const suoi = t.ads.filter((x) => x.base.adset_id === id);
    const aperto = aperti.has(id);
    const tgl = () => setAperti((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
    return [
      riga(a, suoi.length
        ? <button type="button" className="sw-tgl" aria-expanded={aperto} onClick={tgl}><Icon name="chevron" size={14} /><span>{nome(a)}<span className="sw-n">{suoi.length} ad</span></span></button>
        : nome(a)),
      ...(aperto ? suoi.map((x) => riga(x, <>{nome(x)}{x.base.effective_status && x.base.effective_status !== 'ACTIVE' && <span className="sw-n">in pausa</span>}</>)) : []),
    ];
  };

  return (
    <div className="sw-per">
      <h3>Ultimi 14 giorni contro i 14 precedenti</h3>
      <p className="note">
        In grassetto gli ultimi 14 giorni{t.finestre.cur ? ` (${t.finestre.cur})` : ''}, sotto i 14 prima{t.finestre.prev ? ` (${t.finestre.prev})` : ''}.
        Freccia verde = meglio, rossa = peggio; la spesa non ha un verso. Tocca un adset per vedere i suoi ad.
      </p>
      {righe.length === 0
        ? <p className="note">Nessun dato nei 28 giorni.</p>
        : (
          <div className="tablewrap">
            <table className="sw-tab">
              <thead><tr><th>Livello</th>{COLS.map((c) => <th key={c.k}>{c.h}</th>)}</tr></thead>
              <tbody>
                {t.account.map((c) => riga(c, "Tutto l'account"))}
                {t.camps.flatMap((c) => [riga(c, nome(c)), ...t.adsetsDi(c.base.object_id).flatMap(adsetRighe)])}
                {t.orfani.flatMap(adsetRighe)}
              </tbody>
            </table>
          </div>
        )}
    </div>
  );
}

// un gruppo chiuso in fondo alla lista (senza consegna, in pausa): si apre col tocco
function Chiuso({ titolo, righe }: { titolo: string; righe: AdsSwap[] }) {
  const [aperto, setAperto] = useState(false);
  if (!righe.length) return null;
  return (
    <div className="sw-grp">
      <button type="button" className="sw-more" aria-expanded={aperto} onClick={() => setAperto((v) => !v)}>
        {titolo} ({righe.length})<Icon name="chevron" size={16} />
      </button>
      {aperto && righe.map((r) => <AdRow key={r.ad_id} r={r} />)}
    </div>
  );
}

export default function AdsSwapCard({ onAds }: { onAds?: () => void }) {
  const [swap, setSwap] = useState<AdsSwap[] | null>(null);
  const [per, setPer] = useState<AdsPeriodo[] | null>(null);
  const [errSwap, setErrSwap] = useState<string | null>(null);
  const [errPer, setErrPer] = useState<string | null>(null);
  useEffect(() => {
    fetchAdsSwap().then(setSwap).catch((e) => setErrSwap(errMsg(e, 'v_ads_swap')));
    fetchAdsPeriodo().then(setPer).catch((e) => setErrPer(errMsg(e, 'v_ads_periodo_14g')));
  }, []);

  const gruppi = useMemo(() => {
    const g: Record<string, AdsSwap[]> = {};
    const ord = (r: AdsSwap) => num(r.ordine) ?? 9;
    [...(swap ?? [])].sort((a, b) => ord(a) - ord(b) || (num(b.spend_7) ?? 0) - (num(a.spend_7) ?? 0))
      .forEach((r) => { const s = statoDi(r.stato); (g[s] ??= []).push(r); });
    return g;
  }, [swap]);

  const asOf = swap?.find((r) => r.as_of)?.as_of ?? per?.find((r) => r.as_of)?.as_of ?? null;
  const vecchi = asOf ? giorniFa(asOf) : null;
  const nCambia = gruppi.cambia?.length ?? 0, nOsserva = gruppi.osserva?.length ?? 0;
  const senza = gruppi.senza_consegna ?? [], pausa = gruppi.in_pausa ?? [];
  const visibili = (['cambia', 'osserva', 'nuova', 'ok'] as const).filter((s) => gruppi[s]?.length);
  // frequency 7g non letta per il giorno dei dati (meta_ad_freq7 ferma, B1 28-10): il segnale di frequency non e' valutato
  const freqAl = swap?.find((r) => r.freq_al)?.freq_al ?? null;
  const freqFerma = !!swap?.some((r) => r.freq_mancante) && (freqAl == null || freqAl.slice(0, 10) !== asOf?.slice(0, 10));

  return (
    <section className="card ads-swap">
      <div className="sw-head">
        <h2>Creativita' da cambiare</h2>
        {asOf && <span className="sw-asof">dati al {ddmm(asOf)}</span>}
      </div>
      {vecchi != null && vecchi > GIORNI_VECCHI && (
        <p className="sw-stale" role="alert">
          Dati Meta fermi al {ddmm(asOf!)} ({vecchi} giorni fa): l'aggiornamento del mattino (ads-sync) non e' arrivato, questi numeri non sono di oggi.
        </p>
      )}
      {freqFerma && (
        <p className="sw-stale sw-freq" role="alert">
          {/* freq_al dopo as_of = il daily di ieri e' mancato ma la freq7 no: la frequency non e' "ferma", sono i dati di spesa a non combaciare */}
          Frequency 7g {!freqAl ? 'non letta' : asOf && freqAl.slice(0, 10) > asOf.slice(0, 10) ? `letta al ${ddmm(freqAl)}, i dati di spesa al ${ddmm(asOf)}` : `ferma al ${ddmm(freqAl)}`}: le creativita' non sono valutate sulla frequency.
        </p>
      )}

      {errSwap && <p className="err sw-err">Creativita' non lette: {errSwap}</p>}
      {!errSwap && !swap && <p className="note">Carico le creativita'…</p>}
      {swap && (
        <>
          <div className="sw-counts">
            <span className={`ds-pill ${nCambia ? 'neg' : 'sw-off'}`}>{nCambia} da cambiare</span>
            <span className={`ds-pill ${nOsserva ? 'warn' : 'sw-off'}`}>{nOsserva} da osservare</span>
          </div>
          {visibili.length === 0 && senza.length === 0 && pausa.length === 0 && <p className="note">Nessun ad attivo o con spesa negli ultimi 14 giorni.</p>}
          <div className="sw-list">
            {visibili.map((s) => (
              <div className="sw-grp" key={s}>
                <h3 className="sw-gh">{STATI[s].gruppo} <span className="c">{gruppi[s].length}</span></h3>
                {gruppi[s].map((r) => <AdRow key={r.ad_id} r={r} />)}
              </div>
            ))}
            <Chiuso titolo={STATI.senza_consegna.gruppo} righe={senza} />
            <Chiuso titolo={STATI.in_pausa.gruppo} righe={pausa} />
          </div>
        </>
      )}

      {errPer && <p className="err sw-err">Confronto 14 giorni non letto: {errPer}</p>}
      {!errPer && !per && <p className="note">Carico il confronto dei 14 giorni…</p>}
      {per && <Periodo righe={per} />}

      <p className="note sw-regola">
        Da cambiare: frequency 7g oltre la soglia (2,5 cold, 4 retargeting) e CTR link sceso del 25% rispetto ai primi 14 giorni,
        oppure 76,70 € spesi in 14 giorni senza acquisti. Un solo segnale di fatica = da osservare. CPA verde fino a 45 €
        (target), arancio fino a 76,70 € (break-even), rosso sopra.
      </p>
      {onAds && <p className="sw-go"><button className="ds-btn secondary sm" type="button" onClick={onAds}>Apri Ads per creativita'<Icon name="chevron" size={16} /></button></p>}
    </section>
  );
}
