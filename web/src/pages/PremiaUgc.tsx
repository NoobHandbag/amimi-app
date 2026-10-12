import { useEffect, useState } from 'react';
import { decideUgc, fetchUgcQueue, fotoUgcUrls } from '../lib/premiaApi';
import type { UgcItem, UgcQueue, UgcStato } from '../lib/premiaApi';

// Coda "Recensioni e foto" della tab Premia (migr 0153): quello che le clienti mandano dall'Area Membri. Approvare dà
// i punti alla cliente (recensione +20, look +30: li decide la RPC); rifiutare chiede un motivo, che la cliente legge
// nella sua pagina. Una decisione presa da un'altra persona nel frattempo torna "già decisa", senza punti doppi.
// I punti dati non si riprendono da qui: per questo Approva chiede un secondo tocco.

const TABS: [UgcStato, string][] = [['in_revisione', 'Da approvare'], ['approvata', 'Approvate'], ['rifiutata', 'Non approvate']];
const MOTIVI = ['Nella foto non si vede una borsa Amimì', 'La foto non è chiara', 'Il testo non è adatto alla pubblicazione'];
const quando = (iso: string | null) => (iso ? new Date(iso).toLocaleString('it-IT', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

export default function PremiaUgc() {
  const [tab, setTab] = useState<UgcStato>('in_revisione');
  const [q, setQ] = useState<UgcQueue | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState<Record<number, boolean>>({});
  const [conferma, setConferma] = useState<number | null>(null);
  const [rifiuto, setRifiuto] = useState<{ id: number; motivo: string } | null>(null);
  const [giro, setGiro] = useState(0);

  useEffect(() => {
    let vivo = true;                                   // cambio di scheda rapido: una risposta vecchia non sovrascrive la nuova
    fetchUgcQueue(tab)
      .then(async (x) => {
        if (!vivo) return;
        setQ(x); setErr('');
        // i link delle foto durano un'ora: si rifanno a ogni ricarica della lista (ogni decisione la ricarica)
        try { const u = await fotoUgcUrls(x.items.flatMap((i) => i.foto)); if (vivo) setUrls(u); } catch (e) { if (vivo) setErr((e as Error).message); }
      })
      .catch((e: Error) => { if (vivo) setErr(e.message); });
    return () => { vivo = false; };
  }, [tab, giro]);

  const cambiaTab = (k: UgcStato) => { if (k === tab) return; setQ(null); setUrls({}); setErr(''); setMsg(''); setRifiuto(null); setConferma(null); setTab(k); };

  const decidi = async (it: UgcItem, decisione: 'approva' | 'rifiuta', motivo?: string) => {
    if (busy[it.id]) return;
    setBusy((b) => ({ ...b, [it.id]: true })); setErr(''); setMsg('');
    try {
      const r = await decideUgc(it.id, decisione, motivo);
      if (!r.ok) { setErr(r.reason === 'motivo' ? 'Scrivi il motivo (almeno 3 caratteri): lo legge la cliente.' : 'Non riuscito: ' + (r.reason ?? 'errore')); return; }
      setRifiuto(null); setConferma(null);
      setMsg(r.already ? `Già decisa${r.deciso_da ? ' da ' + r.deciso_da : ''}: nessun punto in più.` : decisione === 'approva' ? `Approvata: +${r.punti ?? it.punti} punti alla cliente.` : 'Non approvata: la cliente vede il motivo.');
      setGiro((g) => g + 1);                           // la lista resta a schermo finché non arriva quella nuova
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy((b) => ({ ...b, [it.id]: false }));
    }
  };

  const n = q?.conteggi;
  return (
    <section className="card">
      <h2>Recensioni e foto {n && n.in_revisione > 0 ? <span className="pill warn">{n.in_revisione} da guardare</span> : null}</h2>
      <div className="seg wrap" style={{ margin: '6px 0 10px' }}>
        {TABS.map(([k, label]) => <button key={k} type="button" className={tab === k ? 'on' : ''} onClick={() => cambiaTab(k)}>{label}{n ? ` (${n[k] ?? 0})` : ''}</button>)}
      </div>
      {msg && <p className="note" style={{ marginTop: 0 }}>{msg}</p>}
      {err && <p className="err" style={{ margin: '0 0 8px' }}>{err}</p>}
      {!q ? (!err && <p className="muted">Carico&#8230;</p>) : q.items.length === 0 ? (
        <p className="note" style={{ marginTop: 0 }}>{tab === 'in_revisione' ? 'Niente da guardare: quando una cliente manda una recensione o un look, compare qui.' : 'Nessuna, per ora.'}</p>
      ) : q.items.map((it) => (
        <div key={it.id} style={{ borderTop: '1px solid var(--line)', padding: '10px 0' }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'baseline' }}>
            <strong>{it.kind === 'look' ? 'Look' : 'Recensione'}</strong>
            <span>{it.titolo ?? it.codice}</span>
            {it.verificata ? <span className="pill ok">acquisto verificato</span> : <span className="pill muted">non comprata online</span>}
          </div>
          {it.rating ? <div style={{ fontWeight: 700, marginTop: 4 }}>{it.rating} stelle su 5</div> : null}
          {it.testo ? <p style={{ whiteSpace: 'pre-wrap', margin: '6px 0', overflowWrap: 'anywhere' }}>{it.testo}</p> : null}
          {it.foto.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
              {it.foto.map((p, i) => urls[p]
                ? <a key={p} href={urls[p]} target="_blank" rel="noreferrer"><img src={urls[p]} alt={`Foto ${i + 1}`} style={{ width: 96, height: 120, objectFit: 'cover', borderRadius: 8, display: 'block' }} /></a>
                : <span key={p} className="note" style={{ margin: 0 }}>foto in arrivo&#8230;</span>)}
            </div>
          )}
          <div className="note" style={{ marginTop: 6 }}>{it.firma ? `Firma: ${it.firma} · ` : ''}cliente {it.cliente} · {quando(it.created_at)}</div>
          {tab === 'in_revisione' ? (
            rifiuto?.id === it.id ? (
              <div style={{ marginTop: 8 }}>
                <div className="cs-fld"><label htmlFor={`mot-${it.id}`}>Motivo (lo legge la cliente)</label>
                  <input id={`mot-${it.id}`} value={rifiuto.motivo} maxLength={200} onChange={(e) => setRifiuto({ id: it.id, motivo: e.target.value })} /></div>
                <div className="pillrow" style={{ marginBottom: 8 }}>
                  {MOTIVI.map((m) => <button key={m} type="button" className="pill muted" style={{ border: 0, cursor: 'pointer' }} onClick={() => setRifiuto({ id: it.id, motivo: m })}>{m}</button>)}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" className="cs-btn cs-primary" disabled={!!busy[it.id]} onClick={() => decidi(it, 'rifiuta', rifiuto.motivo)}>Conferma il rifiuto</button>
                  <button type="button" className="cs-btn" disabled={!!busy[it.id]} onClick={() => setRifiuto(null)}>Annulla</button>
                </div>
              </div>
            ) : conferma === it.id ? (
              <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                <button type="button" className="cs-btn cs-primary" disabled={!!busy[it.id]} onClick={() => decidi(it, 'approva')}>{busy[it.id] ? 'Un attimo…' : `Sì, dai +${it.punti} punti`}</button>
                <button type="button" className="cs-btn" disabled={!!busy[it.id]} onClick={() => setConferma(null)}>Annulla</button>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button type="button" className="cs-btn cs-primary" disabled={!!busy[it.id]} onClick={() => { setConferma(it.id); setRifiuto(null); }}>Approva</button>
                <button type="button" className="cs-btn" disabled={!!busy[it.id]} onClick={() => { setRifiuto({ id: it.id, motivo: '' }); setConferma(null); }}>Rifiuta</button>
              </div>
            )
          ) : (
            <div className="note" style={{ marginTop: 4 }}>
              {it.status === 'approvata' ? `Approvata${it.deciso_da ? ' da ' + it.deciso_da : ''} il ${quando(it.deciso_at)}: +${it.punti} punti.` : `Non approvata${it.deciso_da ? ' da ' + it.deciso_da : ''} il ${quando(it.deciso_at)}: ${it.motivo ?? ''}`}
            </div>
          )}
        </div>
      ))}
      <p className="note">Approvare dà subito i punti alla cliente. Qui ci sono dati personali (testi, firme e foto delle clienti): le foto restano private, le vede solo chi entra con un account @amimi.it.</p>
    </section>
  );
}
