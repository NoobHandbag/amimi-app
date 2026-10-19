// Custode delle notifiche native (17-10, brief notifiche native, PR A). Vive in App accanto a UpdateBanner perche' App
// e' l'unico componente sempre montato.
//
// 1. All'avvio, SOLO se questo telefono si era iscritto (amimi_push_device in localStorage) e il flag e' acceso: rilegge
//    l'iscrizione del browser. Se c'e' e c'e' una sessione del team, rinnova (endpoint e chiavi possono cambiare: su
//    iPhone succede dopo un aggiornamento); se e' sparita, o il server non conosce piu' il telefono, un avviso porta alla
//    scheda Notifiche. Non registra MAI il service worker (lo fa solo la scheda Notifiche): qui lo si cerca soltanto.
// 2. Il tocco su una notifica con l'app gia' aperta arriva dal service worker come messaggio {tipo:'amimi-apri', hash}:
//    si cambia scheda con go(), mai scrivendo location.hash (il backnav leggerebbe il cambio come "indietro"). Per una
//    scheda con sotto-rotte lette dall'hash (oggi Negozi, #negozi/outreach/<id>; 18-10, Gate 3 push-eventi) la rotta va
//    nell'URL con history.replaceState DOPO go(), che non manda ne' popstate ne' hashchange e lascia l'URL della voce
//    precedente com'era, poi EVENTO_ROTTA dice alla pagina gia' montata di rileggerla; una pagina non ancora montata la
//    legge dall'URL nascendo. Prima ad app aperta si finiva sulla lista, o sul negozio aperto prima.
// 3. L'avviso non compare sulla scheda Notifiche (nascondi, da App: lo stato vero e' gia' li') e sparisce del tutto dopo
//    un "Attiva" o un "Disattiva" riuscito (EVENTO_ISCRIZIONE): prima restava fino al riavvio anche a notifiche riattivate.
import { useEffect, useRef, useState } from 'react';
import type { Tab } from '../lib/people';
import { csClient } from '../lib/csClient';
import { EVENTO_ISCRIZIONE, EVENTO_ROTTA, leggiDevice, rinnova, rottaDaHash, spento, swSupportato, tabDaHash } from '../lib/push';

export default function PushKeeper({ attivo, nascondi, go }: { attivo: boolean; nascondi: boolean; go: (t: Tab, p?: string) => void }) {
  const [spente, setSpente] = useState(false);
  const [chiuso, setChiuso] = useState(false);
  // go di App cambia a ogni render (chiude sulla scheda corrente): il listener registrato una volta usa sempre l'ultimo
  const goRef = useRef(go);
  useEffect(() => { goRef.current = go; });

  useEffect(() => {
    const risolto = () => setSpente(false);
    window.addEventListener(EVENTO_ISCRIZIONE, risolto);
    return () => window.removeEventListener(EVENTO_ISCRIZIONE, risolto);
  }, []);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const sw = navigator.serviceWorker;
    const suMessaggio = (e: MessageEvent) => {
      const d = e.data as { tipo?: unknown; hash?: unknown } | null;
      if (!d || d.tipo !== 'amimi-apri' || typeof d.hash !== 'string') return;
      // hash vuoto o sconosciuto: l'app viene solo in primo piano, senza perdere cio' che era aperto
      const t = tabDaHash(d.hash);
      if (!t) return;
      goRef.current(t);
      const rotta = rottaDaHash(d.hash);
      if (rotta === null) return;
      history.replaceState(history.state, '', rotta);
      window.dispatchEvent(new Event(EVENTO_ROTTA));
    };
    sw.addEventListener('message', suMessaggio);
    // con addEventListener (a differenza di onmessage) la coda dei messaggi parte solo da qui
    sw.startMessages();
    return () => sw.removeEventListener('message', suMessaggio);
  }, []);

  useEffect(() => {
    if (!attivo || !swSupportato()) return;
    const deviceId = leggiDevice();
    if (!deviceId) return;
    let vivo = true;
    (async () => {
      const reg = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL);
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      if (!sub) { if (vivo) setSpente(true); return; }
      const { data } = await csClient.auth.getSession();
      if (!data.session) return;
      const r = await rinnova(deviceId, sub);
      if (vivo && !spento(r) && !r.trovato) setSpente(true);
    })().catch((e) => {
      // rete assente o sessione scaduta: si riprova al prossimo avvio; un avviso qui sarebbe un falso allarme
      console.warn('PushKeeper: rinnovo non riuscito', e);
    });
    return () => { vivo = false; };
  }, [attivo]);

  if (!attivo || !spente || chiuso || nascondi) return null;
  return (
    // sopra l'avviso "versione nuova" (bottom 124px, alto ~56px): se compaiono insieme restano tutti e due toccabili
    <div className="upd-banner" role="status" style={{ bottom: 186 }}>
      <button type="button" className="upd-txt" style={{ background: 'none', border: 0, color: 'inherit', font: 'inherit', textAlign: 'left', padding: 0, cursor: 'pointer' }}
        onClick={() => { setChiuso(true); go('notifiche'); }}>
        Notifiche spente su questo telefono, tocca per riattivarle
      </button>
      <button type="button" className="upd-x" onClick={() => setChiuso(true)} aria-label="Nascondi l&#8217;avviso">✕</button>
    </div>
  );
}
