import { useEffect, useMemo, useState } from 'react';
import { fetchAdsCreativeStatus, fetchAdsWeekly, fetchAdsSetModelli, fetchAdsCatalogoModelli, pullAds } from '../lib/api';
import type { AdsCreativeStatus, AdsWeekly, AdsSetModello, AdsCatModello } from '../lib/api';
import AppBar from '../components/AppBar';
import Icon from '../components/Icon';
import '../styles/screens/ads.css';

// Pagina "Ads" (redesign 2026-09-19, richiesta owner). Mostra l'ARCHITETTURA reale (solo le campagne con ad attivi:
// COLD e SUPER HOT; le altre sono obsolete), con gli ASSET visibili (le foto da image_url, i video dal frame_url
// risolto lato server, fallback al thumbnail 64px), la fatica sulla frequency VERA a 7 giorni, e per ogni ad i MODELLI che pubblicizza con quante borse
// sono LIVE. Legge solo le viste v_ads_* (anon). "Pull ora" (dalla cornice 3 l'azione tonda nella barra) invoca l'edge ads-sync. Soglie CPA dalla prior art.

const eur = (n: number) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n || 0);
const eur2 = (n: number) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const nz = (v: unknown): number | null => (v == null || v === '' ? null : num(v));
const CPA_TARGET = 45, CPA_BREAKEVEN = 76.7;
const cpaTone = (cpa: number | null) => (cpa == null ? '' : cpa <= CPA_TARGET ? 'green' : cpa <= CPA_BREAKEVEN ? 'warn' : 'red');
const faticaCls = (s: string) => (s === 'alta' ? 'pill warn' : s === 'media' ? 'pill muted' : 'pill ok');
// esito del CPA sulla card scura: la pillola dice dove sta il numero rispetto alle due soglie (stesso cpaTone)
const CPA_ESITO: Record<string, [string, string]> = { green: ['pos', 'sotto target'], warn: ['warn', 'sotto break-even'], red: ['neg', 'sopra break-even'] };
const dmy = (iso: string) => { const d = new Date(iso.slice(0, 10) + 'T12:00:00'); return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`; };

type Row = {
  ad_id: string; ad_name: string; campaign_name: string; adset_name: string; effective_status: string;
  object_type: string; product_set_id: string | null; image_url: string | null; frame_url: string | null; thumbnail_url: string | null; as_of: string | null;
  spend_7: number; purchases_7: number; value_7: number; cpa_7: number | null; roas_7: number | null;
  ctr_7: number | null; ctr_prev7: number | null; ctr_90: number | null; freq_7g: number | null; freq_giorn: number | null;
  stato_fatica: string; azione: string | null; nel_set: number | null; risolti: number | null; pct_oos: number | null;
};
const toRow = (r: AdsCreativeStatus): Row => ({
  ad_id: r.ad_id, ad_name: r.ad_name ?? r.ad_id, campaign_name: r.campaign_name ?? '(?)', adset_name: r.adset_name ?? '(senza adset)',
  effective_status: r.effective_status ?? '', object_type: r.object_type ?? '', product_set_id: r.product_set_id,
  image_url: r.image_url, frame_url: r.frame_url, thumbnail_url: r.thumbnail_url, as_of: r.as_of,
  spend_7: num(r.spend_7), purchases_7: num(r.purchases_7), value_7: num(r.value_7), cpa_7: nz(r.cpa_7), roas_7: nz(r.roas_7),
  ctr_7: nz(r.ctr_7), ctr_prev7: nz(r.ctr_prev7), ctr_90: nz(r.ctr_90), freq_7g: nz(r.freq_7g), freq_giorn: nz(r.freq_media_giornaliera_7),
  stato_fatica: r.stato_fatica ?? 'ok', azione: r.azione_suggerita, nel_set: nz(r.prodotti_nel_set), risolti: nz(r.prodotti_risolti), pct_oos: nz(r.pct_oos),
});

function AdThumb({ img, thumb, video }: { img: string | null; thumb: string | null; video: boolean }) {
  const first = img || thumb;
  const [src, setSrc] = useState<string | null>(first);
  const [triedThumb, setTriedThumb] = useState(!img);
  return (
    <div className="adthumbwrap">
      {src
        ? <img className="adthumb" src={src} alt="" loading="lazy" referrerPolicy="no-referrer"
            onError={() => { if (!triedThumb && thumb && thumb !== src) { setSrc(thumb); setTriedThumb(true); } else setSrc(null); }} />
        : <div className="adthumb ph">{video ? 'Video' : 'Senza foto'}</div>}
      {video && src && <span className="vtag">Video</span>}
    </div>
  );
}

// riga metriche: CTR con freccia (7g vs settimana precedente)
function ctrArrow(ctr: number | null, prev: number | null) {
  if (ctr == null || prev == null) return null;
  if (ctr > prev + 0.05) return <span className="arr-up"> ▲</span>;
  if (ctr < prev - 0.05) return <span className="arr-dn"> ▼</span>;
  return null;
}

function AdCardView({ r, modelli }: { r: Row; modelli: { modello: string; prodotti: number; live: number }[] }) {
  const paused = r.effective_status !== 'ACTIVE';
  const mods = modelli.filter((m) => m.modello !== '(non risolto)').sort((a, b) => b.prodotti - a.prodotti);
  const liveSet = mods.reduce((s, m) => s + m.live, 0), prodSet = mods.reduce((s, m) => s + m.prodotti, 0);
  return (
    <div className={`adcard${paused ? ' paused' : ''}`}>
      <AdThumb img={r.frame_url ?? r.image_url} thumb={r.thumbnail_url} video={r.object_type === 'VIDEO'} />
      <div className="adbody">
        <div className="top">
          <span className="nm">{r.ad_name}</span>
          <span className={paused ? 'tag off' : 'tag live'}>{paused ? 'in pausa' : 'attivo'}</span>
          {!paused && r.stato_fatica !== 'ok' && <span className={faticaCls(r.stato_fatica)}>fatica {r.stato_fatica}</span>}
        </div>
        <div className="admetrics">
          <div className="ads-m"><b>{eur(r.spend_7)}</b><span>spesa 7g</span></div>
          <div className="ads-m"><b className={r.cpa_7 != null && r.cpa_7 > CPA_BREAKEVEN ? 'neg' : ''}>{r.cpa_7 == null ? 'n/d' : eur2(r.cpa_7)}</b><span>CPA</span></div>
          <div className="ads-m"><b>{r.roas_7 == null ? 'n/d' : r.roas_7.toFixed(1) + '×'}</b><span>ROAS</span></div>
          <div className="ads-m"><b>{r.ctr_7 == null ? 'n/d' : r.ctr_7.toFixed(2) + '%'}{ctrArrow(r.ctr_7, r.ctr_prev7)}</b><span>CTR (90g {r.ctr_90 == null ? '–' : r.ctr_90.toFixed(2)})</span></div>
          <div className="ads-m"><b>{r.freq_7g == null ? 'n/d' : r.freq_7g.toFixed(1)}</b><span>freq 7g</span></div>
        </div>
        {mods.length > 0 && (
          <div className="admod">
            Pubblicizza <b>{prodSet}</b> prodotti (<b>{liveSet}</b> live){mods.length ? ': ' : ''}
            {mods.slice(0, 5).map((m, i) => (
              <span key={m.modello}>{i > 0 ? ' · ' : ''}<span className={m.live < m.prodotti ? 'lo' : ''}>{m.modello} {m.live}/{m.prodotti}</span></span>
            ))}
            {mods.length > 5 ? ` · +${mods.length - 5}` : ''}
          </div>
        )}
        {!paused && r.azione && <div className="adact">→ {r.azione}</div>}
      </div>
    </div>
  );
}

export default function Ads({ onBack, pin, chi }: { onBack?: () => void; pin: string; chi: string }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [weeks, setWeeks] = useState<AdsWeekly[] | null>(null);
  const [setMod, setSetMod] = useState<AdsSetModello[] | null>(null);
  const [catMod, setCatMod] = useState<AdsCatModello[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [pulling, setPulling] = useState(false);
  const [pullMsg, setPullMsg] = useState<string | null>(null);
  const [showPaused, setShowPaused] = useState(false);

  useEffect(() => {
    Promise.all([fetchAdsCreativeStatus(), fetchAdsWeekly(), fetchAdsSetModelli(), fetchAdsCatalogoModelli()])
      .then(([r, w, sm, cm]) => { setRows(r.map(toRow)); setWeeks(w); setSetMod(sm); setCatMod(cm); })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, [reload]);

  // Lo stesso modello puo' comparire su piu' categoria (BAG e ALTRO = categoria nulla in anagrafica): si SOMMA per
  // modello, altrimenti il conteggio "live" si perde. categoria = quella vera (BAG/ACCESSORY) se c'e'.
  const bestCat = (cur: string, next: string) => (next === 'BAG' || (next === 'ACCESSORY' && cur === 'ALTRO') ? next : cur);
  const modBySet = useMemo(() => {
    const bySet = new Map<string, Map<string, { modello: string; categoria: string; prodotti: number; live: number }>>();
    (setMod ?? []).forEach((r) => {
      const inner = bySet.get(r.product_set_id) ?? new Map();
      const e = inner.get(r.modello) ?? { modello: r.modello, categoria: r.categoria, prodotti: 0, live: 0 };
      e.prodotti += num(r.prodotti); e.live += num(r.live); e.categoria = bestCat(e.categoria, r.categoria);
      inner.set(r.modello, e); bySet.set(r.product_set_id, inner);
    });
    const out = new Map<string, { modello: string; categoria: string; prodotti: number; live: number }[]>();
    bySet.forEach((inner, k) => out.set(k, [...inner.values()]));
    return out;
  }, [setMod]);
  const catByModel = useMemo(() => {
    const m = new Map<string, { live: number; prodotti: number; su_shopify: number; categoria: string }>();
    (catMod ?? []).forEach((r) => {
      const e = m.get(r.modello) ?? { live: 0, prodotti: 0, su_shopify: 0, categoria: r.categoria };
      e.live += num(r.live); e.prodotti += num(r.prodotti); e.su_shopify += num(r.su_shopify); e.categoria = bestCat(e.categoria, r.categoria);
      m.set(r.modello, e);
    });
    return m;
  }, [catMod]);

  const arch = useMemo(() => {
    if (!rows) return [];
    const activeCamps = [...new Set(rows.filter((r) => r.effective_status === 'ACTIVE').map((r) => r.campaign_name))];
    return activeCamps.map((camp) => {
      const cr = rows.filter((r) => r.campaign_name === camp);
      const adsets = [...new Set(cr.map((r) => r.adset_name))].map((a) => {
        const ads = cr.filter((r) => r.adset_name === a).sort((x, y) => (y.effective_status === 'ACTIVE' ? 1 : 0) - (x.effective_status === 'ACTIVE' ? 1 : 0) || y.spend_7 - x.spend_7);
        return { adset: a, ads, attivi: ads.filter((r) => r.effective_status === 'ACTIVE').length };
      });
      return { camp, spend7: cr.reduce((s, r) => s + r.spend_7, 0), attivi: cr.filter((r) => r.effective_status === 'ACTIVE').length, adsets };
    }).sort((a, b) => b.spend7 - a.spend7);
  }, [rows]);

  const azioni = useMemo(() => (rows ?? []).filter((r) => r.azione && r.effective_status === 'ACTIVE'), [rows]);

  const advModels = useMemo(() => {
    if (!rows) return [];
    const active = rows.filter((r) => r.effective_status === 'ACTIVE');
    const map = new Map<string, { categoria: string; ads: Set<string> }>();
    active.forEach((r) => { if (!r.product_set_id) return; (modBySet.get(r.product_set_id) ?? []).forEach((m) => { if (m.modello === '(non risolto)') return; const e = map.get(m.modello) ?? { categoria: m.categoria, ads: new Set<string>() }; e.ads.add(r.ad_name); map.set(m.modello, e); }); });
    return [...map.entries()].map(([modello, v]) => { const c = catByModel.get(modello); return { modello, categoria: c?.categoria ?? v.categoria, adCount: v.ads.size, live: c?.live ?? 0, prodotti: c?.prodotti ?? 0, su_shopify: c?.su_shopify ?? 0 }; })
      .sort((a, b) => a.live - b.live || b.prodotti - a.prodotti);
  }, [rows, modBySet, catByModel]);

  const pull = async () => {
    setPulling(true); setPullMsg(null);
    try {
      const j = await pullAds(pin, chi);
      setPullMsg(j.skipped === 'no_token' ? 'Nessun token Meta in app_config: pull non eseguito.' : `Aggiornato: ${j.dailyRows ?? 0} righe, ${j.creativeRows ?? 0} creativita', ${j.mapRows ?? 0} set.`);
      setReload((n) => n + 1);
    } catch (e) { setPullMsg('Errore: ' + (e instanceof Error ? e.message : String(e))); }
    finally { setPulling(false); }
  };

  if (err) return <div className="screen scr-ads"><AppBar title="Ads" onBack={onBack} /><div className="card err">Errore: {err}</div></div>;
  if (!rows || !weeks || !setMod || !catMod) return <div className="screen scr-ads"><AppBar title="Ads" onBack={onBack} /><p className="muted center">Carico le creativita'…</p></div>;

  const asOf = rows.find((r) => r.as_of)?.as_of ?? null;
  const staleDays = asOf ? Math.floor((Date.now() - new Date(String(asOf).slice(0, 10) + 'T12:00:00').getTime()) / 86400000) : null;
  const spend7 = rows.reduce((s, r) => s + r.spend_7, 0), purch7 = rows.reduce((s, r) => s + r.purchases_7, 0), val7 = rows.reduce((s, r) => s + r.value_7, 0);
  const cpa7 = purch7 > 0 ? spend7 / purch7 : null, roas7 = spend7 > 0 ? val7 / spend7 : null;
  const inCorso = (s: string) => new Date(s.slice(0, 10) + 'T00:00:00').getTime() + 6 * 86400000 >= Date.now();
  const cpaEsito = CPA_ESITO[cpaTone(cpa7)];

  return (
    <div className="screen scr-ads">
      <AppBar title="Ads" onBack={onBack} actions={
        <button type="button" className={pulling ? 'exp busy' : 'exp'} onClick={pull} disabled={pulling} aria-label="Pull ora" title="Pull ora: aggiorna i dati Ads"><Icon name="recycle" size={18} /></button>
      } />
      <p className="note appbar-st" role="status">{pulling ? 'Aggiorno…' : pullMsg}</p>

      <p className="note ads-dati">
        Meta, per creativita' · dati al <strong>{asOf ? String(asOf).slice(0, 10) : 'n/d'}</strong> · ogni mattina
        {staleDays != null && staleDays > 2 && <> <span className="ds-pill neg">{staleDays} giorni fa: il cron non ha girato</span></>}
      </p>

      <section className="card ads-azioni">
        <h2>Azioni proposte{azioni.length > 0 && <span className="ds-pill warn">{azioni.length}</span>}</h2>
        {azioni.length === 0 && <p className="note">Nessuna: nessun ad attivo in fatica ne' set scoperto.</p>}
        {azioni.map((r) => (
          <div className="ads-azione" key={r.ad_id}>
            <div className="rt">{r.ad_name}</div>
            <div className="rs">{r.campaign_name} · {eur(r.spend_7)}/7g</div>
            <div>{r.azione}</div>
          </div>
        ))}
      </section>

      <div className="kpis">
        <div className="ds-kpi hero">
          <div className="v">{cpa7 == null ? 'n/d' : eur2(cpa7)}</div>
          <div className="l">CPA 7g</div>
          <div className="s">target {eur(CPA_TARGET)} · break-even {eur2(CPA_BREAKEVEN)}</div>
          {cpaEsito && <span className={`ds-pill ${cpaEsito[0]}`}>{cpaEsito[1]}</span>}
        </div>
        <Kpi label="Spesa 7g" value={eur(spend7)} tone="" sub={weeks[1] ? `sett. prec. ${eur(num(weeks[1].spend))}` : undefined} />
        <Kpi label="Acquisti 7g" value={String(purch7)} tone="" sub={`valore ${eur(val7)}`} />
        <Kpi label="ROAS 7g" value={roas7 == null ? 'n/d' : roas7.toFixed(2) + '×'} tone={roas7 == null ? '' : roas7 >= 1 ? 'pos' : 'neg'} sub="valore ÷ spesa" />
      </div>

      <section className="card">
        <div className="ads-head ads-sec">
          <h2>Architettura</h2>
          <button className={`chip ${showPaused ? 'on' : ''}`} type="button" onClick={() => setShowPaused((v) => !v)}>{showPaused ? 'nascondi in pausa' : 'mostra in pausa'}</button>
        </div>
        <p className="note ads-sub">Solo le campagne con ad attivi (le altre sono obsolete). Ogni ad con la sua anteprima, la fatica sulla frequency vera a 7 giorni, e i modelli che pubblicizza con quante borse sono live.</p>
        {arch.map((c) => (
          <div className="camp" key={c.camp}>
            <div className="ads-head">
              <h3>{c.camp}</h3>
              <span className="badge">{c.attivi} attivi</span>
              <span className="muted ads-spesa">{eur(c.spend7)} in 7g</span>
            </div>
            {c.adsets.map((a) => {
              const visible = showPaused ? a.ads : a.ads.filter((r) => r.effective_status === 'ACTIVE');
              const nascosti = a.ads.length - visible.length;
              return (
                <div key={a.adset}>
                  <div className="adset">{a.adset} · {a.attivi} attivi{nascosti > 0 ? ` · ${nascosti} in pausa nascosti` : ''}</div>
                  {visible.map((r) => <AdCardView key={r.ad_id} r={r} modelli={r.product_set_id ? (modBySet.get(r.product_set_id) ?? []) : []} />)}
                </div>
              );
            })}
          </div>
        ))}
      </section>

      <section className="card">
        <h2>Modelli in advertising vs disponibilita'</h2>
        <p className="note">I modelli che gli ad attivi possono mostrare (dai loro product set), e quante borse di quel modello sono <strong>live</strong> (su Shopify e a stock) in catalogo. Poche borse live su un modello molto spinto = si pubblicizza qualcosa che non si puo' comprare.</p>
        <div className="list ads-modelli">{advModels.map((m) => (
          <div className="row" key={m.modello}>
            <div className="ads-mi">
              <div className="rt">{m.modello}</div>
              <div className="rs">{m.categoria} · {m.su_shopify} su Shopify · {m.prodotti} totali · {m.adCount} {m.adCount === 1 ? 'ad attivo' : 'ad attivi'}</div>
            </div>
            <div className={`ads-live${m.live <= 2 ? ' neg' : ''}`}>{m.live}<small>live in catalogo</small></div>
          </div>
        ))}</div>
      </section>

      <section className="card ads-sett">
        <h2>Settimane</h2>
        <div className="tablewrap"><table>
          <thead><tr><th>Settimana</th><th>Spesa</th><th>Acq.</th><th>CPA</th><th>ROAS</th><th>Δ spesa</th></tr></thead>
          <tbody>{weeks.slice(0, 10).map((w) => {
            const cpa = nz(w.cpa), roas = nz(w.roas), dS = nz(w.spend_wow);
            return (<tr key={w.settimana} className={inCorso(w.settimana) ? 'cur' : undefined}>
              <td className="l">{dmy(w.settimana)}{inCorso(w.settimana) ? <span className="muted"> (in corso)</span> : ''}</td>
              <td>{eur(num(w.spend))}</td><td>{num(w.purchases)}</td>
              <td className={cpa != null && cpa > CPA_BREAKEVEN ? 'neg' : ''}>{cpa == null ? 'n/d' : eur2(cpa)}</td>
              <td className={roas != null && roas < 1 ? 'neg' : ''}>{roas == null ? 'n/d' : roas.toFixed(1) + '×'}</td>
              <td className={dS != null && dS < 0 ? 'neg' : ''}>{dS == null ? '' : (dS > 0 ? '+' : '') + eur(dS)}</td>
            </tr>);
          })}</tbody>
        </table></div>
      </section>
    </div>
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone: string }) {
  return <div className={`ds-kpi ${tone}`}><div className="v">{value}</div><div className="l">{label}</div>{sub && <div className="s">{sub}</div>}</div>;
}
