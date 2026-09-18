import { useEffect, useMemo, useState } from 'react';
import { fetchAdsCreativeStatus, fetchAdsWeekly, fetchAdsSetInventory, pullAds } from '../lib/api';
import type { AdsCreativeStatus, AdsWeekly, AdsSetInventory } from '../lib/api';
import { useSort } from '../lib/sortable';

// Pagina "Ads" (feature Amimì Ads, 2026-09-18): reportistica Meta a livello CREATIVITA'. Legge SOLO le viste
// v_ads_creative_status / v_ads_weekly_account / v_ads_set_inventory (migr 0129/0130), alimentate dall'edge
// ads-sync (cron 06:07 UTC). "Pull ora" invoca la stessa edge (pull di ieri + anagrafica + mappa product_set).
// Soglie CPA dalla prior art (Apps Script 22-05): target 45, breakeven 76,70. Raggiungibile da #ads e dal Cruscotto.

const eur = (n: number) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n || 0);
const eur2 = (n: number) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const nz = (v: unknown): number | null => (v == null || v === '' ? null : num(v));
const CPA_TARGET = 45;
const CPA_BREAKEVEN = 76.7;
const cpaTone = (cpa: number | null) => (cpa == null ? '' : cpa <= CPA_TARGET ? 'green' : cpa <= CPA_BREAKEVEN ? 'accent' : 'red');
const faticaClass = (s: string | null) => (s === 'alta' ? 'pill warn' : s === 'media' ? 'pill muted' : 'pill ok');
const dmy = (iso: string) => { const d = new Date(iso.slice(0, 10) + 'T12:00:00'); return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`; };

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone: string }) {
  return <div className={`kpi ${tone}`}><div className="v">{value}</div><div className="k">{label}</div>{sub && <div className="ksub">{sub}</div>}</div>;
}

// riga normalizzata a NUMERI (PostgREST rende i numeric come stringhe): serve a ordinare e sommare bene
type Row = {
  ad_id: string; ad_name: string; campaign_name: string; effective_status: string; product_set_id: string | null; as_of: string | null;
  spend_7: number; purchases_7: number; value_7: number; cpa_7: number | null; roas_7: number | null;
  ctr_7: number | null; ctr_prev7: number | null; ctr_90: number | null; freq: number | null;
  risolti: number | null; nel_set: number | null; pct_oos: number | null; stato_fatica: string; azione: string | null;
};
const toRow = (r: AdsCreativeStatus): Row => ({
  ad_id: r.ad_id, ad_name: r.ad_name ?? r.ad_id, campaign_name: r.campaign_name ?? '', effective_status: r.effective_status ?? '', product_set_id: r.product_set_id, as_of: r.as_of,
  spend_7: num(r.spend_7), purchases_7: num(r.purchases_7), value_7: num(r.value_7), cpa_7: nz(r.cpa_7), roas_7: nz(r.roas_7),
  ctr_7: nz(r.ctr_7), ctr_prev7: nz(r.ctr_prev7), ctr_90: nz(r.ctr_90), freq: nz(r.freq_media_giornaliera_7),
  risolti: nz(r.prodotti_risolti), nel_set: nz(r.prodotti_nel_set), pct_oos: nz(r.pct_oos), stato_fatica: r.stato_fatica ?? 'ok', azione: r.azione_suggerita,
});

export default function Ads({ onBack, pin, chi }: { onBack?: () => void; pin: string; chi: string }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [weeks, setWeeks] = useState<AdsWeekly[] | null>(null);
  const [sets, setSets] = useState<AdsSetInventory[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [pulling, setPulling] = useState(false);
  const [pullMsg, setPullMsg] = useState<string | null>(null);
  const [soloAttive, setSoloAttive] = useState(true);

  useEffect(() => {
    Promise.all([fetchAdsCreativeStatus(), fetchAdsWeekly(), fetchAdsSetInventory()])
      .then(([r, w, s]) => { setRows(r.map(toRow)); setWeeks(w); setSets(s); })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, [reload]);

  const visibili = useMemo(() => (rows ?? []).filter((r) => (soloAttive ? r.effective_status === 'ACTIVE' : r.spend_7 > 0 || r.effective_status === 'ACTIVE')), [rows, soloAttive]);
  const azioni = useMemo(() => (rows ?? []).filter((r) => r.azione && r.effective_status === 'ACTIVE'), [rows]);
  const adsPerSet = useMemo(() => {
    const m = new Map<string, string[]>();
    (rows ?? []).filter((r) => r.product_set_id).sort((a, b) => (b.effective_status === 'ACTIVE' ? 1 : 0) - (a.effective_status === 'ACTIVE' ? 1 : 0) || b.spend_7 - a.spend_7)
      .forEach((r) => { const k = r.product_set_id as string; const l = m.get(k) ?? []; if (l.length < 3) l.push(r.ad_name + (r.effective_status === 'ACTIVE' ? '' : ' (pausa)')); m.set(k, l); });
    return m;
  }, [rows]);
  const sort = useSort(visibili as unknown as Record<string, unknown>[], 'spend_7', 'desc'); // la creativita' che spende di piu' in cima

  const pull = async () => {
    setPulling(true); setPullMsg(null);
    try {
      const j = await pullAds(pin, chi);
      if (j.skipped === 'no_token') setPullMsg('Nessun token Meta in app_config: pull non eseguito (vedi SETUP_GUIDE_System_User_Token.md).');
      else setPullMsg(`Aggiornato: ${j.dailyRows ?? 0} righe ad-giorno, ${j.creativeRows ?? 0} creativita', ${j.mapRows ?? 0} righe di set.`);
      setReload((n) => n + 1);
    } catch (e) { setPullMsg('Errore: ' + (e instanceof Error ? e.message : String(e))); }
    finally { setPulling(false); }
  };

  if (err) return <div className="screen"><header><h1>Ads</h1></header>{onBack && <button className="back" onClick={onBack}>← Home</button>}<div className="card err">Errore: {err}</div></div>;
  if (!rows || !weeks || !sets) return <div className="screen"><header><h1>Ads</h1></header><p className="muted center">Carico le creativita'…</p></div>;

  const asOf = rows.find((r) => r.as_of)?.as_of ?? null;
  const staleDays = asOf ? Math.floor((Date.now() - new Date(String(asOf).slice(0, 10) + 'T12:00:00').getTime()) / 86400000) : null;
  const spend7 = rows.reduce((s, r) => s + r.spend_7, 0);
  const purch7 = rows.reduce((s, r) => s + r.purchases_7, 0);
  const val7 = rows.reduce((s, r) => s + r.value_7, 0);
  const cpa7 = purch7 > 0 ? spend7 / purch7 : null;
  const roas7 = spend7 > 0 ? val7 / spend7 : null;
  const inCorso = (s: string) => new Date(s.slice(0, 10) + 'T00:00:00').getTime() + 6 * 86400000 >= Date.now();

  return (
    <div className="screen">
      <header><h1>Ads</h1><span className="badge">Meta · per creativita'</span></header>
      {onBack && <button className="back" onClick={onBack}>← Home</button>}

      <p className="note" style={{ marginTop: 0 }}>
        Dati al <strong>{asOf ? String(asOf).slice(0, 10) : 'n/d'}</strong>
        {staleDays != null && staleDays > 2 && <span className="err"> ({staleDays} giorni fa: il cron del mattino non ha girato, controlla Salute)</span>}
        {' '}· aggiornamento automatico ogni mattina (Meta Marketing API).{' '}
        <button className="chip" type="button" onClick={pull} disabled={pulling}>{pulling ? 'Aggiorno…' : 'Pull ora'}</button>
      </p>
      {pullMsg && <p className="note">{pullMsg}</p>}

      <section className={`card ${azioni.length ? 'warn' : ''}`}>
        <h2>Azioni proposte</h2>
        {azioni.length === 0 && <p className="muted" style={{ margin: 0 }}>Nessuna azione: nessuna creativita' attiva in fatica ne' product set scoperto.</p>}
        {azioni.map((r) => (
          <div key={r.ad_id} style={{ marginBottom: 6 }}><strong>{r.ad_name}</strong> <span className="muted">({r.campaign_name}, {eur(r.spend_7)} in 7g)</span><br />{r.azione}</div>
        ))}
      </section>

      <div className="kpis">
        <Kpi label="Spesa 7g" value={eur(spend7)} tone="accent" sub={weeks[1] ? `settimana precedente ${eur(num(weeks[1].spend))}` : undefined} />
        <Kpi label="Acquisti 7g" value={String(purch7)} tone="" sub={`valore ${eur(val7)}`} />
        <Kpi label="CPA 7g" value={cpa7 == null ? 'n/d' : eur2(cpa7)} tone={cpaTone(cpa7)} sub={`target ${eur(CPA_TARGET)} · breakeven ${eur2(CPA_BREAKEVEN)}`} />
        <Kpi label="ROAS 7g" value={roas7 == null ? 'n/d' : roas7.toFixed(2) + '×'} tone={roas7 == null ? '' : roas7 >= 1 ? 'green' : 'red'} sub="valore acquisti ÷ spesa" />
      </div>

      <section className="card">
        <h2>Settimane</h2>
        <div className="tablewrap"><table>
          <thead><tr><th>Settimana</th><th>Spesa</th><th>Acq.</th><th>CPA</th><th>ROAS</th><th>Δ spesa</th><th>Δ acq.</th></tr></thead>
          <tbody>{weeks.slice(0, 10).map((w) => {
            const cpa = nz(w.cpa), roas = nz(w.roas), dS = nz(w.spend_wow), dP = nz(w.purchases_wow);
            return (
              <tr key={w.settimana}>
                <td className="l">{dmy(w.settimana)}{inCorso(w.settimana) ? <span className="muted"> (in corso)</span> : ''}</td>
                <td>{eur(num(w.spend))}</td><td>{num(w.purchases)}</td>
                <td className={cpa != null && cpa > CPA_BREAKEVEN ? 'neg' : ''}>{cpa == null ? 'n/d' : eur2(cpa)}</td>
                <td className={roas != null && roas < 1 ? 'neg' : ''}>{roas == null ? 'n/d' : roas.toFixed(2) + '×'}</td>
                <td className={dS != null && dS < 0 ? 'neg' : ''}>{dS == null ? '' : (dS > 0 ? '+' : '') + eur(dS)}</td>
                <td className={dP != null && dP < 0 ? 'neg' : ''}>{dP == null ? '' : (dP > 0 ? '+' : '') + dP}</td>
              </tr>
            );
          })}</tbody>
        </table></div>
        <p className="note">Settimane da lunedi'. Δ = differenza con la settimana precedente. La settimana in corso e' parziale.</p>
      </section>

      <section className="card">
        <h2>Creativita' {soloAttive ? 'attive' : 'con dati'} <span className="badge">{visibili.length}</span></h2>
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <button className={`chip ${soloAttive ? 'on' : ''}`} type="button" onClick={() => setSoloAttive(true)}>Attive</button>
          <button className={`chip ${!soloAttive ? 'on' : ''}`} type="button" onClick={() => setSoloAttive(false)}>Tutte con spesa</button>
        </div>
        <div className="tablewrap"><table className="sortable">
          <thead><tr>
            <th onClick={() => sort.toggle('ad_name')}>Creativita'{sort.arrow('ad_name')}</th>
            <th onClick={() => sort.toggle('spend_7')}>Spesa 7g{sort.arrow('spend_7')}</th>
            <th onClick={() => sort.toggle('purchases_7')}>Acq.{sort.arrow('purchases_7')}</th>
            <th onClick={() => sort.toggle('cpa_7')}>CPA{sort.arrow('cpa_7')}</th>
            <th onClick={() => sort.toggle('roas_7')}>ROAS{sort.arrow('roas_7')}</th>
            <th onClick={() => sort.toggle('ctr_7')}>CTR 7g{sort.arrow('ctr_7')}</th>
            <th onClick={() => sort.toggle('freq')}>Freq/g{sort.arrow('freq')}</th>
            <th>Fatica</th><th>Set (risolti · OOS)</th><th>Azione</th>
          </tr></thead>
          <tbody>{(sort.sorted as unknown as Row[]).map((r) => (
            <tr key={r.ad_id}>
              <td className="l"><strong>{r.ad_name}</strong><br /><span className="muted">{r.campaign_name}{r.effective_status !== 'ACTIVE' ? ` · ${r.effective_status.toLowerCase()}` : ''}</span></td>
              <td>{eur(r.spend_7)}</td>
              <td>{r.purchases_7}</td>
              <td className={r.cpa_7 != null && r.cpa_7 > CPA_BREAKEVEN ? 'neg' : ''}>{r.cpa_7 == null ? <span className="muted">n/d</span> : eur2(r.cpa_7)}</td>
              <td className={r.roas_7 != null && r.roas_7 < 1 && r.spend_7 > 0 ? 'neg' : ''}>{r.roas_7 == null ? <span className="muted">n/d</span> : r.roas_7.toFixed(2) + '×'}</td>
              <td>{r.ctr_7 == null ? <span className="muted">n/d</span> : r.ctr_7.toFixed(2) + '%'}<br /><span className="muted">prec {r.ctr_prev7 == null ? '–' : r.ctr_prev7.toFixed(2)} · 90g {r.ctr_90 == null ? '–' : r.ctr_90.toFixed(2)}</span></td>
              <td>{r.freq == null ? <span className="muted">n/d</span> : r.freq.toFixed(2)}</td>
              <td><span className={faticaClass(r.stato_fatica)}>{r.stato_fatica}</span></td>
              <td>{r.nel_set == null ? <span className="muted">nessun set</span> : <>{r.risolti ?? 0}/{r.nel_set}<br /><span className={r.pct_oos != null && r.pct_oos >= 30 ? 'neg' : 'muted'}>{r.pct_oos == null ? 'n/d' : r.pct_oos.toFixed(0) + '% OOS'}</span></>}</td>
              <td className="l">{r.azione ? <strong>{r.azione}</strong> : ''}</td>
            </tr>
          ))}</tbody>
        </table></div>
        <p className="note">CPA e ROAS per creativita' solo se ci sono acquisti attribuiti nei 7 giorni, altrimenti n/d per volume: il giudizio "spengo o scalo" si fa sulla campagna. Fatica = media della frequency giornaliera e CTR sotto la settimana precedente (media) o sotto la media 90 giorni (alta), soglie tarate sui dati reali.</p>
      </section>

      <section className="card">
        <h2>Product set e inventario</h2>
        <div className="tablewrap"><table>
          <thead><tr><th>Set (usato da)</th><th>Prodotti</th><th>Risolti</th><th>OOS</th><th>Scorta 1-2</th><th>Non su Shopify</th><th>% OOS</th></tr></thead>
          <tbody>{sets.map((s) => {
            const pct = nz(s.pct_oos);
            return (
              <tr key={s.product_set_id}>
                <td className="l">{(adsPerSet.get(s.product_set_id) ?? []).join(', ') || <span className="muted">nessun ad con dati</span>}<br /><span className="muted">set …{s.product_set_id.slice(-6)}</span></td>
                <td>{num(s.prodotti_nel_set)}</td><td>{num(s.prodotti_risolti)}</td><td>{num(s.prodotti_oos)}</td><td>{num(s.prodotti_low_stock)}</td><td>{num(s.prodotti_non_su_shopify)}</td>
                <td className={pct != null && pct >= 30 ? 'neg' : ''}>{pct == null ? 'n/d' : pct.toFixed(0) + '%'}</td>
              </tr>
            );
          })}</tbody>
        </table></div>
        <p className="note">Un set e' l'insieme di prodotti del catalogo Meta che un ad a catalogo puo' mostrare. "Risolti" = agganciati a un codice dell'app (i non risolti sono prodotti del catalogo Meta assenti dal mirror Shopify: archiviati o rimossi). % OOS sui risolti, da <code>v_inventory</code>. "Set scoperto" scatta solo con copertura sufficiente (almeno 3 risolti e almeno meta' del set).</p>
      </section>
    </div>
  );
}
