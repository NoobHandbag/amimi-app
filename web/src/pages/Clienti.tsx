import { useEffect, useMemo, useState } from 'react';
import { fetchClientiRfm, fetchCoorti } from '../lib/api';
import type { ClienteRfm, Coorte } from '../lib/api';
import ExportBtn from '../components/ExportBtn';
import PrintBtn from '../components/PrintBtn';
import AppBar from '../components/AppBar';
import '../styles/screens/clienti.css';

// Pagina "Clienti" (audit dashboard 06-09). Le viste v_clienti_rfm e v_clienti_coorti (migr 0088)
// esistevano senza schermata: 678 clienti segmentati e un riacquisto a 90 giorni quasi nullo che
// nessuno vedeva. Sola lettura. L'export CSV del segmento serve a Klaviyo (lista per email).

const eur = (n: number) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n || 0);
const pct = (n: number) => `${Math.round((n || 0) * 100)}%`;
const SEG_ORDER = ['top', 'ripetuto', 'nuovo', 'una_tantum', 'dormiente'];
const SEG_LABEL: Record<string, string> = { top: 'Top', ripetuto: 'Ripetuti', nuovo: 'Nuovi', una_tantum: 'Una tantum', dormiente: 'Dormienti' };
const SEG_DESC: Record<string, string> = {
  top: 'hanno speso di piu’ e sono tornati: da coccolare',
  ripetuto: 'almeno due ordini, ancora attivi',
  nuovo: 'primo ordine recente: il momento giusto per il secondo',
  una_tantum: 'un solo ordine, non recente',
  dormiente: 'non comprano da molto: campagna di riattivazione o lasciar andare',
};
// tema A: i segmenti sono una scala di grigi (il colore e' per gli esiti); bordeaux solo il segmento filtrato.
// Cinque passi fra --ink e --chart-bar, tutti almeno 3:1 sul bianco come ogni segno di grafico (19,5 / 12,3 / 8,0 / 4,9 /
// 3,2:1), ognuno 1,5 volte il successivo: --chart-5 e --border-strong (2,5 e 1,4:1) sparivano sulla card e sul foglio
const SEG_COLOR: Record<string, string> = {
  top: 'var(--ink)',
  ripetuto: 'color-mix(in srgb, var(--ink) 55%, var(--chart-4))',
  nuovo: 'color-mix(in srgb, var(--ink) 25%, var(--chart-4))',
  una_tantum: 'color-mix(in srgb, var(--chart-4) 75%, var(--chart-bar))',
  dormiente: 'var(--chart-bar)',
};
// mese della coorte in italiano ("gen 26"), solo per mostrarlo: la data resta quella della vista
const meseCoorte = (c: string) => {
  const m = /^(\d{4})-(\d{2})/.exec(String(c));
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, 1).toLocaleDateString('it-IT', { month: 'short', year: '2-digit' }) : String(c).slice(0, 7);
};

export default function Clienti({ onBack }: { onBack?: () => void }) {
  const [rfm, setRfm] = useState<ClienteRfm[] | null>(null);
  const [coorti, setCoorti] = useState<Coorte[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [seg, setSeg] = useState<string | null>(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    Promise.all([fetchClientiRfm(), fetchCoorti()])
      .then(([r, c]) => { setRfm(r); setCoorti(c); })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);

  const bySeg = useMemo(() => {
    const m = new Map<string, number>();
    (rfm ?? []).forEach((r) => m.set(r.segmento, (m.get(r.segmento) ?? 0) + 1));
    return m;
  }, [rfm]);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (rfm ?? []).filter((r) => (!seg || r.segmento === seg) && (!s || (r.email ?? '').toLowerCase().includes(s)));
  }, [rfm, seg, q]);

  if (err) return <div className="screen scr-clienti"><AppBar title="Clienti" onBack={onBack} /><div className="card err">Errore: {err}</div></div>;
  if (!rfm || !coorti) return <div className="screen scr-clienti"><AppBar title="Clienti" onBack={onBack} /><p className="muted center">Carico i clienti…</p></div>;

  const tot = rfm.length || 1;
  const ripetuti = rfm.filter((r) => r.frequency >= 2).length;
  const mature = coorti.filter((c) => c.maturita_giorni >= 90);
  const r90 = mature.reduce((s, c) => s + c.ricomprato_90gg, 0);
  const r90base = mature.reduce((s, c) => s + c.clienti, 0);
  const spesaMedia = rfm.reduce((s, r) => s + r.monetary, 0) / tot;
  const segCol = (s: string) => (seg === s ? 'var(--interactive)' : SEG_COLOR[s]);

  return (
    <div className="screen scr-clienti">
      <AppBar title="Clienti" onBack={onBack} actions={<>
        <PrintBtn />
        <ExportBtn name={`clienti_${seg ?? 'tutti'}`} rows={() => list.map((r) => ({ email: r.email, segmento: r.segmento, ordini: r.frequency, spesa: Math.round(r.monetary), aov: Math.round(r.aov), primo_ordine: r.primo_ordine, ultimo_ordine: r.ultimo_ordine, giorni_da_ultimo: r.recency_giorni }))} />
      </>} />

      <div className="kpis">
        {/* card scura: il numero per cui e' nata la pagina. Esito (stessa soglia del 10%, sul valore non arrotondato) in una
            pillola che non ripete la cifra: a 9,7% la card mostra "10%" e "sotto il 10%" si contraddiceva. Il trattino senza dati non e' rosso */}
        <div className="ds-kpi hero">
          <div className="v">{r90base ? pct(r90 / r90base) : '—'}</div><div className="l">Riacquisto a 90 gg</div><div className="s">coorti mature ({r90base} clienti)</div>
          {r90base > 0 && <span className={`ds-pill ${r90 / r90base >= 0.1 ? 'pos' : 'neg'}`}>{r90 / r90base >= 0.1 ? 'soglia raggiunta' : 'sotto la soglia'}</span>}
        </div>
        <div className="ds-kpi"><div className="v">{rfm.length}</div><div className="l">Clienti online</div><div className="s">con almeno un ordine</div></div>
        <div className={`ds-kpi ${!rfm.length ? '' : ripetuti / tot >= 0.1 ? 'pos' : 'neg'}`}><div className="v">{pct(ripetuti / tot)}</div><div className="l">Hanno riordinato</div><div className="s">{ripetuti} clienti con 2+ ordini</div></div>
        <div className="ds-kpi accent"><div className="v">{eur(spesaMedia)}</div><div className="l">Spesa media per cliente</div><div className="s">netto, tutta la storia</div></div>
      </div>

      <section className="card">
        <h2>Segmenti</h2>
        {/* un segmento a zero non si disegna: con i 2 px fra i segmenti lascerebbe un buco */}
        <div className="ds-chbar">
          {SEG_ORDER.filter((s) => bySeg.get(s)).map((s) => <div key={s} style={{ flex: bySeg.get(s), background: segCol(s) }} />)}
        </div>
        <div className="list cli-segs">
          {SEG_ORDER.map((s) => (
            <button type="button" className={`row cli-seg${seg === s ? ' on' : ''}`} key={s} onClick={() => setSeg(seg === s ? null : s)}>
              <div><div className="rt"><i className="cli-dot" style={{ background: segCol(s) }} />{SEG_LABEL[s]}</div><div className="rs">{SEG_DESC[s]}</div></div>
              <div className="giac">{bySeg.get(s) ?? 0} <span className="muted">· {pct((bySeg.get(s) ?? 0) / tot)}</span></div>
            </button>
          ))}
        </div>
        <p className="note">Segmenti calcolati dalla vista v_clienti_rfm su recency, frequenza e spesa. Tocca un segmento per filtrare la lista sotto ed esportarla (CSV) per Klaviyo.</p>
      </section>

      <section className="card">
        <h2>Coorti · chi ricompra</h2>
        <div className="tablewrap"><table>
          <thead><tr><th>Primo ordine</th><th>Clienti</th><th>30 gg</th><th>60 gg</th><th>90 gg</th><th>Netto medio</th></tr></thead>
          <tbody>{coorti.map((c) => (
            <tr key={c.coorte} className={c.maturita_giorni < 90 ? 'dim' : ''}>
              <td className="l">{meseCoorte(c.coorte)}</td><td>{c.clienti}</td>
              <td>{c.ricomprato_30gg}</td><td>{c.ricomprato_60gg}</td><td className={c.maturita_giorni >= 90 && c.clienti && c.ricomprato_90gg / c.clienti >= 0.1 ? 'pos' : ''}>{c.maturita_giorni >= 90 ? c.ricomprato_90gg : '—'}</td>
              <td>{eur(c.netto_medio_cliente)}</td>
            </tr>
          ))}</tbody>
        </table></div>
        <p className="note">Ogni riga e' il gruppo di clienti che ha fatto il primo ordine in quel mese: quanti hanno riordinato entro 30, 60, 90 giorni. Le coorti piu' giovani di 90 giorni sono in grigio: non ancora giudicabili. In verde il 90 gg delle coorti che ricomprano almeno il 10%, la soglia della card in alto.</p>
      </section>

      <section className="card">
        <div className="dethead"><h2>{seg ? SEG_LABEL[seg] : 'Tutti i clienti'} · {list.length}</h2></div>
        <div className="ds-search" style={{ marginBottom: 8 }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cerca per email…" aria-label="Cerca cliente" />
        </div>
        {/* lista al posto della tabella a sei colonne (a 390 px scorreva): stesse righe, stesso ordine, stessi valori */}
        <div className="list cli-list">
          {list.slice(0, 200).map((r) => (
            <div className="row" key={r.email}>
              <div><div className="rt">{r.email}</div><div className="rs">{r.frequency} {r.frequency === 1 ? 'ordine' : 'ordini'} · ultimo {r.ultimo_ordine ? String(r.ultimo_ordine).slice(0, 10) : '—'} · {r.recency_giorni} gg fa</div></div>
              <div className="cli-amt">{eur(r.monetary)}<div className="rs">AOV {eur(r.aov)}</div></div>
            </div>
          ))}
        </div>
        {list.length > 200 && <p className="note">Mostrati i primi 200 di {list.length}: l'export CSV li contiene tutti.</p>}
      </section>
    </div>
  );
}
