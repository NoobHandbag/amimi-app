import { useEffect, useState } from 'react';
import { pushBack, popBack } from '../lib/backnav';
import CountForm from '../components/CountForm';
import NewProductForm from '../components/NewProductForm';
import GiftForm from '../components/GiftForm';
import B2BForm from '../components/B2BForm';
import ReturnForm from '../components/ReturnForm';
import SpeseManage from '../components/SpeseManage';
import RecentFeed from '../components/RecentFeed';
import { ProdVerify, Publish, Catalog } from './Prodotti';
import { DataTables } from './Tables';
import Icon from '../components/Icon';
import AppBar from '../components/AppBar';
import { personaName } from '../lib/people';
import '../styles/screens/registra.css';

// in fondo a ogni flusso, porta alla sua tabella intera (frase intera, "tutti" o "tutte" secondo il nome)
const SEE_ALL: Record<string, { key: string; label: string }> = {
  gift: { key: 'regali', label: 'Vedi tutti i regali' }, reso: { key: 'resi', label: 'Vedi tutti i resi' },
  b2b: { key: 'b2b', label: 'Vedi tutti i movimenti B2B' }, count: { key: 'conte', label: 'Vedi tutte le conte' },
  product: { key: 'prodotti', label: 'Vedi tutti i prodotti' }, spesa: { key: 'spese', label: 'Vedi tutte le spese' },
  catalogo: { key: 'prodotti', label: 'Vedi tutti i prodotti' },
};

// Same actions for everyone (only the Home is persona-personalized). "Arrivo/Acquisto" lives in Ordini.
const TIPI = [
  { k: 'count', icon: 'count', label: 'Conta fisica', desc: 'Conta i pezzi reali a scaffale' },
  { k: 'reso', icon: 'return', label: 'Reso / Cambio', desc: 'Parti dalla vendita, poi correggi o rimborsa' },
  { k: 'gift', icon: 'gift', label: 'Regalo / Vendita manuale', desc: 'Regalo, o vendita offline fuori Qromo' },
  { k: 'b2b', icon: 'handshake', label: 'Movimento B2B', desc: 'Conto vendita o ingrosso' },
  { k: 'product', icon: 'tag', label: 'Nuovo prodotto', desc: 'Crea un nuovo articolo' },
  { k: 'catalogo', icon: 'search', label: 'Prodotti & prezzi', desc: 'Cerca un prodotto: modifica prezzo, COGS e scheda' },
  { k: 'spesa', icon: 'euro', label: 'Spese', desc: 'Proponi e approva spese' },
  { k: 'pulizia', icon: 'sparkles', label: 'Pulizia dati', desc: 'Completa modello, prezzo e foto' },
  { k: 'pubblica', icon: 'rocket', label: 'Pubblica su Shopify', desc: 'Metti online i prodotti pronti' },
  { k: 'tabelle', icon: 'table', label: 'Tabelle', desc: 'Sfoglia i dati grezzi (ordini, vendite, prodotti…)' },
];

export default function Ingest({ pin, chi, initial }: {
  pin: string; chi: string; initial?: string;
}) {
  const [sel, setSel] = useState<string | null>(initial ? initial.split(':')[0] : null);
  const [arg, setArg] = useState<string | undefined>(initial && initial.includes(':') ? initial.slice(initial.indexOf(':') + 1) : undefined);
  const [tableInit, setTableInit] = useState<string | undefined>(undefined);
  // il tab puo' essere GIA' montato quando arriva un nuovo deep-link (es. bottone nav "Tabelle",
  // o "Registra conta" dalla scheda prodotto): reagisci ai cambi di initial, non solo al mount.
  useEffect(() => {
    if (!initial) return;
    setTableInit(undefined);
    setSel(initial.split(':')[0]);
    setArg(initial.includes(':') ? initial.slice(initial.indexOf(':') + 1) : undefined);
  }, [initial]);
  const cur = TIPI.find((t) => t.k === sel);
  const seeAll = sel ? SEE_ALL[sel] : undefined;

  return (
    <div className="screen scr-registra">
      <AppBar
        title={cur?.label ?? 'Registra'}
        onBack={sel ? () => popBack(() => setSel(null)) : undefined}
        backAria="Indietro"
        actions={<span className="badge" title="A chi viene attribuito il movimento">{personaName(chi)}</span>}
      />

      {!sel ? (
        <>
          <div className="tipi reg-tipi">
            {TIPI.map((t) => (
              <button key={t.k} className="tipo" onClick={() => { setTableInit(undefined); pushBack(() => setSel(null)); setSel(t.k); }} type="button">
                <span className="ti"><Icon name={t.icon} size={22} /></span>
                <span className="tt">{t.label}</span>
                <span className="td">{t.desc}</span>
              </button>
            ))}
          </div>
          <RecentFeed />
        </>
      ) : (
        <>
          {sel === 'count' && <CountForm pin={pin} chi={chi} initialCodice={arg} />}
          {sel === 'product' && <NewProductForm pin={pin} chi={chi} />}
          {sel === 'gift' && <GiftForm pin={pin} chi={chi} />}
          {sel === 'b2b' && <B2BForm pin={pin} chi={chi} initialNegozio={arg} />}
          {sel === 'reso' && <ReturnForm pin={pin} chi={chi} />}
          {sel === 'spesa' && <SpeseManage pin={pin} chi={chi} />}
          {sel === 'catalogo' && <Catalog pin={pin} chi={chi} />}
          {sel === 'pulizia' && <ProdVerify pin={pin} chi={chi} />}
          {sel === 'pubblica' && <Publish />}
          {sel === 'tabelle' && <DataTables initial={tableInit} />}
          {seeAll && (
            <button className="seeall" type="button" onClick={() => { setTableInit(seeAll.key); setSel('tabelle'); }}>
              <Icon name="table" size={16} /> {seeAll.label}
            </button>
          )}
        </>
      )}
    </div>
  );
}
