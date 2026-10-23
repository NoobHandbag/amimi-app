import { Fragment, useEffect, useMemo, useState } from 'react';
import { fetchMargineOrdini, fetchMargineSku, shopifyOrderUrl } from '../lib/api';
import type { MargOrdine, MargSku } from '../lib/api';
import { nowMonth, prettyName } from '../lib/helpers';
import ExportBtn from '../components/ExportBtn';
import PrintBtn from '../components/PrintBtn';
import AppBar from '../components/AppBar';
import Icon from '../components/Icon';
import '../styles/screens/margini.css';

// Pagina "Margini" (audit dashboard 06-09). Le viste v_margine_ordine (migr 0083) e v_margine_sku
// (0083/0089) esistevano da agosto senza nessuna schermata: 16 ordini in perdita e i modelli a
// margine piu' basso erano invisibili. Sola lettura. Margine = contribuzione dopo COGS, commissioni,
// packaging e rimborsi; % sul ricavo netto.

const MESI = ['', 'Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];
const eur = (n: number) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n || 0);
const pct = (n: number) => `${Math.round((n || 0) * 100)}%`;
const CUR = nowMonth();

type Agg = { key: string; item: string | null; variant: string | null; pezzi: number; netto: number; cogs: number; margine: number; n: number };
function aggregate(rows: MargSku[], by: (r: MargSku) => string, label: (r: MargSku) => [string | null, string | null]): Agg[] {
  const m = new Map<string, Agg>();
  rows.forEach((r) => {
    const k = by(r); const [item, variant] = label(r);
    const e = m.get(k) ?? { key: k, item, variant, pezzi: 0, netto: 0, cogs: 0, margine: 0, n: 0 };
    e.pezzi += r.pezzi; e.netto += r.ricavo_netto; e.cogs += r.cogs; e.margine += r.margine_contribuzione; e.n += 1;
    m.set(k, e);
  });
  return [...m.values()].sort((a, b) => b.netto - a.netto);
}

export default function Margini({ onBack }: { onBack?: () => void }) {
  const [ord, setOrd] = useState<MargOrdine[] | null>(null);
  const [sku, setSku] = useState<MargSku[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);      // modello aperto
  const [scope, setScope] = useState<'chiusi' | 'tutti'>('tutti');
  const [canale, setCanale] = useState<'tutti' | 'online' | 'offline'>('tutti');

  useEffect(() => {
    Promise.all([fetchMargineOrdini(), fetchMargineSku()])
      .then(([o, s]) => { setOrd(o); setSku(s); })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);

  const skuF = useMemo(() => (sku ?? []).filter((r) => (scope === 'tutti' || r.month < CUR) && (canale === 'tutti' || r.canale === canale)), [sku, scope, canale]);
  const ordF = useMemo(() => (ord ?? []).filter((o) => scope === 'tutti' || o.month < CUR), [ord, scope]);
  const perModello = useMemo(() => aggregate(skuF, (r) => r.item ?? r.codice, (r) => [r.item ?? r.codice, null]), [skuF]);
  const perVariante = useMemo(() => sel ? aggregate(skuF.filter((r) => (r.item ?? r.codice) === sel), (r) => r.codice, (r) => [r.item, r.variant]) : [], [skuF, sel]);
  const perMese = useMemo(() => {
    const m = new Map<number, { netto: number; margine: number; n: number }>();
    ordF.forEach((o) => { const e = m.get(o.month) ?? { netto: 0, margine: 0, n: 0 }; e.netto += o.ricavo_netto; e.margine += o.margine_contribuzione; e.n += 1; m.set(o.month, e); });
    return [...m.entries()].sort((a, b) => a[0] - b[0]);
  }, [ordF]);

  if (err) return <div className="screen scr-margini"><AppBar title="Margini" onBack={onBack} /><div className="card err">Errore: {err}</div></div>;
  if (!ord || !sku) return <div className="screen scr-margini"><AppBar title="Margini" onBack={onBack} /><p className="muted center">Carico i margini…</p></div>;

  const netto = ordF.reduce((s, o) => s + o.ricavo_netto, 0);
  const margine = ordF.reduce((s, o) => s + o.margine_contribuzione, 0);
  // un ordine con margine NON calcolabile (COGS mancante, gift card) non e' una perdita: e' un buco dati
  const perdita = ordF.filter((o) => o.margine_noto && o.margine_contribuzione <= 0);
  const senzaMargine = ordF.filter((o) => !o.margine_noto).length;
  const rimborsati = ordF.filter((o) => o.rimborso > 0).length;
  const motivo = (o: MargOrdine) => o.rimborso > 0 ? 'rimborso' : o.sconto > 0 ? 'sconto' : o.cogs >= o.ricavo_netto ? 'costo prodotto' : 'costi accessori';

  return (
    <div className="screen scr-margini">
      <AppBar title="Margini" onBack={onBack} backLabel="Home" actions={<>
        <PrintBtn />
        <ExportBtn name="margini_modello" rows={() => perModello.map((r) => ({ modello: r.item, pezzi: r.pezzi, netto: Math.round(r.netto), cogs: Math.round(r.cogs), margine: Math.round(r.margine), margine_pct: r.netto ? Math.round(r.margine / r.netto * 100) : '' }))} />
      </>} />

      <div className="ctrlbar cedt-ctrl">
        <div className="ds-seg full" role="group" aria-label="Periodo">
          <button type="button" className={scope === 'tutti' ? 'on' : ''} onClick={() => setScope('tutti')}>Anno</button>
          <button type="button" className={scope === 'chiusi' ? 'on' : ''} onClick={() => setScope('chiusi')}>Mesi chiusi</button>
        </div>
        <div className="ds-seg full" role="group" aria-label="Canale">
          <button type="button" className={canale === 'tutti' ? 'on' : ''} onClick={() => setCanale('tutti')}>Tutti</button>
          <button type="button" className={canale === 'online' ? 'on' : ''} onClick={() => setCanale('online')}>Online</button>
          <button type="button" className={canale === 'offline' ? 'on' : ''} onClick={() => setCanale('offline')}>Negozio</button>
        </div>
      </div>

      <div className="kpis">
        <div className="ds-kpi hero"><div className="v">{eur(margine)}</div><div className="l">Margine di contribuzione</div><div className="s">{netto ? pct(margine / netto) : '—'} sul netto</div></div>
        <div className="ds-kpi"><div className="v">{eur(netto)}</div><div className="l">Ricavo netto ordini</div><div className="s">{ordF.length} ordini online</div></div>
        <div className={`ds-kpi ${perdita.length ? 'neg' : ''}`}><div className="v">{perdita.length}</div><div className="l">Ordini in perdita</div><div className="s">margine ≤ 0{senzaMargine ? ` · ${senzaMargine} senza margine calcolabile` : ''}</div></div>
        <div className="ds-kpi"><div className="v">{rimborsati}</div><div className="l">Ordini con rimborso</div><div className="s">pesano sul margine</div></div>
      </div>

      <section className="card">
        <h2>Margine per modello</h2>
        <p className="note">Dalle righe d'ordine (v_margine_sku): pezzi, netto, COGS e margine per modello. Tocca un modello per vedere le varianti. Filtro canale sopra.</p>
        <div className="list mg-list">{perModello.map((r) => {
          const p = r.netto ? r.margine / r.netto : 0;
          const aperto = sel === r.key;
          return (
            <Fragment key={r.key}>
              <button type="button" className={`mg-row ${aperto ? 'on' : ''}`} aria-expanded={aperto} onClick={() => setSel(aperto ? null : r.key)}>
                <span className="mg-l"><span className="rt">{prettyName(r.item, null)}</span><span className="rs">{r.pezzi}&nbsp;pz · netto&nbsp;{eur(r.netto)} · COGS&nbsp;{eur(r.cogs)}</span></span>
                <span className="mg-r"><span className={`mg-v ${r.margine < 0 ? 'neg' : ''}`}>{eur(r.margine)}</span><span className={`mg-p ${p < 0.55 ? 'neg' : p > 0.8 ? 'pos' : ''}`}>{pct(p)}</span></span>
                <Icon name="chevron" size={16} className="mg-chev" />
              </button>
              {aperto && perVariante.length > 0 && (
                <div className="mg-var" role="list" aria-label={`Varianti di ${prettyName(r.key, null)}`}>{perVariante.map((v) => {
                  const pv = v.netto ? v.margine / v.netto : 0;
                  return (
                    <div className="mg-vrow" role="listitem" key={v.key}>
                      <span className="mg-l"><span className="rt">{(v.variant ?? v.key).replace(/_/g, ' ')}</span><span className="rs">{v.pezzi}&nbsp;pz · netto&nbsp;{eur(v.netto)}</span></span>
                      <span className="mg-r"><span className={`mg-v ${v.margine < 0 ? 'neg' : ''}`}>{eur(v.margine)}</span><span className={`mg-p ${pv < 0.55 ? 'neg' : pv > 0.8 ? 'pos' : ''}`}>{pct(pv)}</span></span>
                    </div>
                  );
                })}</div>
              )}
            </Fragment>
          );
        })}</div>
        <p className="note">Verde sopra 80%, rosso sotto 55% (banda MC1 attesa 55-80%). Un modello sotto banda con molti pezzi vale una revisione di prezzo o di costo.</p>
      </section>

      <section className="card">
        <h2>Ordini in perdita · {perdita.length}</h2>
        {perdita.length === 0 ? <p className="muted center">Nessun ordine con margine negativo.</p> : (
          <div className="list">
            {perdita.sort((a, b) => a.margine_contribuzione - b.margine_contribuzione).slice(0, 40).map((o) => {
              const url = shopifyOrderUrl(o.order_number ?? o.order_id);
              const n = (o.order_number ?? o.order_id).replace(/^#/, '');
              return (
                <div className="row" key={o.order_id}>
                  <div><div className="rt">#{n} · {MESI[o.month]}</div>
                    <div className="rs">causa:&nbsp;{motivo(o)} · netto&nbsp;{eur(o.ricavo_netto)} · COGS&nbsp;{eur(o.cogs)} · sconto&nbsp;{eur(o.sconto)} · rimborso&nbsp;{eur(o.rimborso)}</div></div>
                  <div className="giac neg">{eur(o.margine_contribuzione)}</div>
                  {url && <Icon name="chevron" size={16} className="mg-chev" />}
                  {url && <a className="mg-link" href={url} target="_blank" rel="noreferrer" title="Apri su Shopify" aria-label={`Apri l'ordine #${n} su Shopify`} />}
                </div>
              );
            })}
          </div>
        )}
        <p className="note">Perdita = ricavo netto meno COGS, commissioni, packaging e rimborso. Un rimborso totale porta il margine sotto zero di tutto il COGS: e' il caso piu' frequente.</p>
      </section>

      <section className="card">
        <h2>Margine per mese</h2>
        <div className="tablewrap"><table>
          <thead><tr><th>Mese</th><th>Ordini</th><th>Netto</th><th>Margine</th><th>%</th></tr></thead>
          <tbody>{perMese.map(([m, v]) => (
            <tr key={m}><td className="l">{MESI[m]}{m === CUR ? ' *' : ''}</td><td>{v.n}</td><td>{eur(v.netto)}</td><td className={v.margine < 0 ? 'neg' : ''}>{eur(v.margine)}</td><td>{v.netto ? pct(v.margine / v.netto) : '—'}</td></tr>
          ))}</tbody>
        </table></div>
        <p className="note">Solo ordini online (Shopify): il margine per ordine esiste solo dove esiste l'ordine. Il margine omnichannel del mese e' MC1 nel CE dettagliato. * mese in corso.</p>
      </section>
    </div>
  );
}
