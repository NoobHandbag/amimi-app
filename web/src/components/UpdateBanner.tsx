// Avviso "e' disponibile una versione nuova" (brief cs_crop_residui_e_versione, parte 2).
//
// Vive in App.tsx, che e' l'unico componente sempre montato: le pagine vengono smontate a ogni
// cambio tab, quindi un timer dentro una pagina si azzererebbe a ogni navigazione.
//
// CADENZA, e i numeri hanno un motivo. Ogni 15 minuti e SOLO a scheda visibile, piu' un controllo
// quando la scheda torna in primo piano (con un pavimento di 5 minuti fra due letture). La CDN di
// GitHub Pages tiene i file fino a 10 minuti (`max-age=600` misurato sul sito vivo), quindi
// controllare piu' spesso non anticipa la scoperta: aggiunge solo richieste. A scheda nascosta non
// parte nulla, cosi' una PWA lasciata aperta tutta la notte non genera traffico. Nella pratica il
// segnale arriva quasi sempre dal ritorno in primo piano, che e' il gesto vero delle operatrici.
//
// NON si ricarica MAI da soli: l'operatrice puo' avere una bozza aperta e a meta'. Si avvisa e si
// lascia decidere a lei.
import { useEffect, useState } from 'react';
import Icon from './Icon';
import { cEUnAggiornamento, ricaricaAggiornando, type Pubblicata } from '../lib/version';

const OGNI = 15 * 60 * 1000;        // controllo periodico a scheda visibile
const PAVIMENTO = 5 * 60 * 1000;    // due letture non si avvicinano piu' di cosi'

export default function UpdateBanner() {
  const [nuova, setNuova] = useState<Pubblicata | null>(null);
  const [chiuso, setChiuso] = useState(false);

  useEffect(() => {
    let vivo = true;
    let ultimo = 0;
    const guarda = async () => {
      if (document.visibilityState !== 'visible') return;
      const ora = Date.now();
      if (ora - ultimo < PAVIMENTO) return;
      ultimo = ora;
      const p = await cEUnAggiornamento();
      if (vivo && p) setNuova(p);
    };
    const t = setInterval(guarda, OGNI);
    document.addEventListener('visibilitychange', guarda);
    // niente controllo all'avvio: si e' appena caricato l'index.html, si e' per definizione aggiornati
    return () => { vivo = false; clearInterval(t); document.removeEventListener('visibilitychange', guarda); };
  }, []);

  if (!nuova || chiuso) return null;
  return (
    <div className="upd-banner" role="status">
      <span className="upd-txt">C&#8217;&#232; una versione nuova dell&#8217;app.</span>
      <button type="button" className="upd-go" onClick={() => ricaricaAggiornando(nuova.build)}>Ricarica</button>
      <button type="button" className="upd-x" onClick={() => setChiuso(true)} aria-label="Nascondi l&#8217;avviso"><Icon name="x" size={15} /></button>
    </div>
  );
}
