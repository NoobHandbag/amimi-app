import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import Icon from './Icon';

// Pezzi a magazzino che non sono in vendita sul sito (migr 0190, 09-11, chiesta da Dan). Il 09-11 erano 107 pezzi su 13
// codici, 97 arrivati fra il 16-10 e il 06-11 (codici doppi senza pagina, schede mai create, una bozza), e nessuno schermo
// lo diceva: il banner
// dei controlli (HealthBanner) lo vede solo Ale, mentre chi registra gli arrivi e pubblica sono Ginni e Benny. Per questo
// la scheda e' per tutto il team, in cima alla Home, e dice QUALI codici: pezzi, giorni dall'ultimo arrivo, e se la pagina
// sul sito manca o e' in bozza. La vista fa tutto il calcolo (fermo da almeno 3 giorni, nessuna riga Shopify attiva fra
// quelle dell'ultimo giro di sync); qui si legge soltanto. Una lettura fallita si dice, non si nasconde.

type Fermo = { codice: string; item: string | null; variant: string | null; pezzi: number; giorni: number | null; stato_shopify: string };

const statoTesto = (s: string) => (s === 'assente' ? 'nessuna pagina sul sito' : /draft/.test(s) ? 'pagina in bozza' : /archived/.test(s) ? 'pagina archiviata' : `pagina ${s}`);

export default function StockFermo() {
  const [rows, setRows] = useState<Fermo[] | null>(null);
  const [errore, setErrore] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.from('v_stock_fermo')
        .select('codice,item,variant,pezzi,giorni,stato_shopify').order('pezzi', { ascending: false }).limit(200);
      if (error) { setErrore(true); return; }
      setRows((data ?? []) as Fermo[]);
    })();
  }, []);

  if (errore) return <div className="hb sf"><div className="askhead">Non riesco a leggere i pezzi fermi: riapri l'app</div></div>;
  if (!rows || !rows.length) return null;
  const pezzi = rows.reduce((s, r) => s + Number(r.pezzi || 0), 0);

  return (
    <div className="hb sf">
      <button type="button" className="askhead" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span>{pezzi} pezzi a magazzino non in vendita sul sito ({rows.length} {rows.length === 1 ? 'prodotto' : 'prodotti'})</span>
        <Icon name="chevron" size={18} />
      </button>
      {open && (
        <ul className="hb-list" role="list">
          {rows.map((r) => (
            <li key={r.codice}>
              <span>
                {[r.item, r.variant].filter(Boolean).join(' ') || r.codice}
                <small className="sf-sub">{r.codice} · {statoTesto(r.stato_shopify)}{r.giorni != null ? ` · ferm${Number(r.pezzi) === 1 ? 'o' : 'i'} da ${r.giorni} gg` : ''}</small>
              </span>
              <b>{Number(r.pezzi)} pz</b>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
