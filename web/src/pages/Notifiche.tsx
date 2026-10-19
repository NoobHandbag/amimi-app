import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { csClient, EMAIL_TEAM_TESTO } from '../lib/csClient';
import { PEOPLE, PersonaPicker, personaName } from '../lib/people';
import {
  supportoPush, chiaveVapid, preparaRegistrazione, datiIscrizione, etichettaDispositivo, leggiDevice, salvaDevice, togliDevice,
  pushConfig, dispositivi, iscrivi, salvaTemi, disiscrivi, rimuovi, prova, spento, temiPredefiniti, EVENTO_ISCRIZIONE, type Tema, type Dispositivo,
} from '../lib/push';

// Scheda Notifiche (17-10, brief notifiche native, PR A): ogni telefono si iscrive per conto suo e sceglie i temi.
// Stati in ordine: push non supportate (iPhone fuori dalla schermata Home) -> login del team (push-api vuole il JWT) ->
// sezione spenta (push-api risponde enabled:false) -> persona, temi e bottoni. Il flag spento all'avvio lo gestisce App.
// "Iscritto" si legge da getSubscription() del browser E dall'elenco del server, mai dal solo Notification.permission:
// su iPhone il permesso puo' restare 'granted' mentre l'iscrizione e' sparita.
// Elenco non letto (lista null, in caricamento o fallito) = stato SCONOSCIUTO, non "non iscritto": niente Attiva, temi,
// persona o Disattiva finche' non c'e' (Regola Ferrea 20a; Gate 3 del 17-10: un elenco fallito faceva riscrivere tutti i
// temi a un telefono iscritto solo ad alcuni).

type Cfg = { enabled: boolean; temi: Tema[]; chiave: Uint8Array<ArrayBuffer> | null; motivo?: string };
type Msg = { ok: boolean; testo: string } | null;

const quando = (iso: string) => new Date(iso).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' });
const permessoOra = (): NotificationPermission => ('Notification' in window ? Notification.permission : 'default');

function erroreIscrizione(e: unknown): string {
  const nome = (e as { name?: string } | null)?.name;
  if (permessoOra() === 'denied') return 'Le notifiche sono bloccate per Amimì su questo telefono: sotto trovi come riattivarle.';
  if (nome === 'NotAllowedError') return 'Serve il permesso: tocca di nuovo "Attiva notifiche su questo telefono" e scegli Consenti.';
  if (nome === 'AbortError') return 'Il servizio push del telefono non ha risposto: riprova fra poco.';
  return 'Iscrizione non riuscita: ' + ((e as Error | null)?.message || 'errore sconosciuto');
}

export default function Notifiche({ chi, setChi, onBack }: { chi: string; setChi: (c: string) => void; onBack: () => void }) {
  const supporto = useMemo(supportoPush, []);
  const ios = supporto === 'ios-safari' || supporto === 'ios-vecchio' || /iPhone|iPad|iPod/.test(navigator.userAgent);
  const [session, setSession] = useState<'?' | 'in' | 'out'>('?');
  const [email, setEmail] = useState(''); const [pwd, setPwd] = useState(''); const [busyLogin, setBusyLogin] = useState(false);
  const [errLogin, setErrLogin] = useState('');

  const [gen, setGen] = useState(0);
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [errCfg, setErrCfg] = useState('');
  const [reg, setReg] = useState<ServiceWorkerRegistration | null>(null);
  const [errReg, setErrReg] = useState('');
  const [sub, setSub] = useState<PushSubscription | null>(null);
  // getSubscription letto almeno una volta: prima, un sub null non vuol dire "iscrizione sparita"
  const [subLetta, setSubLetta] = useState(false);
  const [lista, setLista] = useState<Dispositivo[] | null>(null);
  const [errLista, setErrLista] = useState('');
  const [deviceId, setDeviceIdS] = useState<string | null>(leggiDevice);
  // caricaLista manda a push-api il device_id del momento (serve per "questo"), anche subito dopo un cambio non ancora renderizzato
  const deviceRef = useRef(deviceId);
  const impostaDevice = (id: string | null) => { deviceRef.current = id; setDeviceIdS(id); };
  const [sceltiLocali, setSceltiLocali] = useState<string[] | null>(null);
  // Persona scelta su QUESTO telefono (18-10, Gate 3 push-eventi, F2): senza amimi_chi App ripiega su 'Ale', e l'app
  // installata su iPhone ha uno storage suo, quindi Benny e Ginni arriverebbero qui con Ale e i suoi temi gia' scelti, e
  // un tocco su Attiva le iscriverebbe come Ale (riepilogo di Ale, niente Assistenza). Finche' non si sceglie, o finche'
  // il server non conosce gia' questo telefono (mio), nessuna persona e' segnata, i temi sono fermi e Attiva e' spento.
  const [personaScelta, setPersonaScelta] = useState(() => { try { return localStorage.getItem('amimi_chi') !== null; } catch { return false; } });
  const [permesso, setPermesso] = useState<NotificationPermission>(permessoOra);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<Msg>(null);

  useEffect(() => {
    csClient.auth.getSession().then(({ data }) => setSession(data.session ? 'in' : 'out'));
    const { data: ascolto } = csClient.auth.onAuthStateChange((_e, s) => setSession(s ? 'in' : 'out'));
    return () => ascolto.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session !== 'in' || supporto !== 'ok') return;
    let vivo = true;
    setErrCfg('');
    pushConfig().then((c) => {
      if (!vivo) return;
      // flag acceso ma chiavi VAPID mancanti sul server: push-api manda il motivo, che non e' "flag spento"
      if (spento(c) || !c.enabled) { setCfg({ enabled: false, temi: [], chiave: null, motivo: c.reason }); return; }
      const chiave = chiaveVapid(c.vapidPublicKey);
      setCfg({ enabled: true, temi: c.temi ?? [], chiave });
      if (!chiave) setErrReg('Manca la chiave delle notifiche sul server (VAPID): avvisa chi gestisce l’app.');
    }).catch((e: Error) => { if (vivo) setErrCfg(e.message); });
    return () => { vivo = false; };
  }, [session, supporto, gen]);

  // registrazione pronta PRIMA del tocco su "Attiva" (lib/push.ts, preparaRegistrazione): nel tocco il primo await
  // deve essere pushManager.subscribe, altrimenti Safari lo considera fuori dal gesto e lo rifiuta
  const chiave = cfg?.chiave ?? null;
  useEffect(() => {
    if (!chiave) return;
    let vivo = true;
    setErrReg('');
    preparaRegistrazione(chiave)
      .then(async (r) => { const s = await r.pushManager.getSubscription(); if (vivo) { setReg(r); setSub(s); setSubLetta(true); } })
      .catch((e: Error) => { if (vivo) setErrReg(e.message || 'Servizio notifiche non disponibile su questo telefono.'); });
    return () => { vivo = false; };
  }, [chiave]);

  const sezioneSpenta = () => setCfg({ enabled: false, temi: [], chiave: null });
  const caricaLista = useCallback(async () => {
    try {
      const r = await dispositivi(deviceRef.current);
      if (spento(r)) { setCfg({ enabled: false, temi: [], chiave: null }); return; }
      setLista(r.dispositivi ?? []); setErrLista('');
    } catch (e) {
      // un elenco vecchio lasciato a schermo direbbe cose non piu' vere dopo una scrittura: torna sconosciuto
      setLista(null); setErrLista((e as Error).message);
    }
  }, []);
  const riprovaLista = () => { setErrLista(''); setLista(null); void caricaLista(); };
  const acceso = cfg?.enabled === true;
  useEffect(() => { if (acceso) void caricaLista(); }, [acceso, caricaLista]);

  // tornando dalle impostazioni del telefono (permesso riattivato o tolto) si rilegge lo stato vero
  useEffect(() => {
    const rileggi = () => {
      if (document.visibilityState !== 'visible') return;
      setPermesso(permessoOra());
      // una rilettura fallita lascia a schermo lo stato di prima, che e' il meglio che si sa
      reg?.pushManager.getSubscription().then(setSub).catch(() => {});
    };
    document.addEventListener('visibilitychange', rileggi);
    return () => document.removeEventListener('visibilitychange', rileggi);
  }, [reg]);

  const doLogin = async () => {
    setBusyLogin(true); setErrLogin('');
    const { error } = await csClient.auth.signInWithPassword({ email: email.trim(), password: pwd });
    setBusyLogin(false);
    if (error) setErrLogin('Accesso non riuscito. Controlla email e password.'); else setPwd('');
  };
  const doGoogle = async () => {
    setBusyLogin(true); setErrLogin('');
    // redirectTo SENZA hash: Supabase appende la sessione come fragment, un hash nostro lo romperebbe
    const { error } = await csClient.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin + import.meta.env.BASE_URL, queryParams: { prompt: 'select_account' } } });
    if (error) { setBusyLogin(false); setErrLogin('Google non attivo: accedi con email e password.'); }
  };

  const temi = cfg?.temi ?? [];
  const nomeTema = (k: string) => temi.find((t) => t.key === k)?.etichetta ?? k;
  const mio = lista && deviceId ? lista.find((d) => d.questo) ?? null : null;
  const attivo = !!sub && !!mio;
  // solo i temi attivi in config: uno spento dopo, rimasto nella riga, non ha casella e iscrivi lo rifiuterebbe (422)
  const chiaviAttive = new Set(temi.map((t) => t.key));
  const soloAttivi = (ks: string[]) => ks.filter((k) => chiaviAttive.has(k));
  const chiValido = (personaScelta || !!mio) && (PEOPLE as readonly string[]).includes(chi);
  // con una riga sul server valgono i temi salvati; prima dell'iscrizione quelli predefiniti della persona scelta (18-10,
  // push_temi.predefinito_per), ricalcolati a ogni cambio di persona finche' non si tocca una casella (sceltiLocali);
  // senza persona scelta nessuno
  const scelti = soloAttivi(attivo && mio ? mio.temi : (sceltiLocali ?? mio?.temi ?? (chiValido ? temiPredefiniti(temi, chi) : [])));

  // Il server ha tolto questo telefono (invia ha avuto 404/410) ma il browser tiene l'iscrizione: subscribe con la stessa
  // chiave la restituirebbe uguale e "Attiva" registrerebbe di nuovo un endpoint morto. La si toglie UNA volta per
  // apertura, appena elenco e registrazione sono letti e PRIMA di ogni tocco (il primo await di attiva resta subscribe),
  // tenendo il device_id. Mai durante o dopo un'azione: setSub di attiva farebbe togliere l'iscrizione appena nata.
  const verificato = useRef(false);
  useEffect(() => {
    if (verificato.current || lista === null || !reg || busy) return;
    verificato.current = true;
    if (!deviceId || !sub || mio) return;
    setBusy('verifica');
    // un unsubscribe che non risponde mai terrebbe "Controllo l'iscrizione…" per sempre: dopo 10 s si va avanti lo stesso
    Promise.race([sub.unsubscribe().catch(() => false), new Promise((r) => setTimeout(r, 10000))]).finally(() => { setSub(null); setBusy(''); });
  }, [lista, reg, busy, deviceId, sub, mio]);

  const attiva = async () => {
    if (!reg || !chiave || busy || lista === null) return;
    setBusy('attiva'); setMsg(null);
    let s: PushSubscription;
    try {
      s = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chiave });
    } catch (e) {
      setPermesso(permessoOra()); setBusy(''); setMsg({ ok: false, testo: erroreIscrizione(e) });
      return;
    }
    setSub(s); setPermesso(permessoOra());
    const id = deviceId ?? crypto.randomUUID();
    try {
      const r = await iscrivi({ chi, device_id: id, subscription: datiIscrizione(s), temi: scelti, etichetta: etichettaDispositivo() });
      if (spento(r)) { sezioneSpenta(); return; }
      salvaDevice(id); impostaDevice(id);
      setMsg({ ok: true, testo: 'Notifiche attive su questo telefono. Prova con "Invia una prova".' });
      window.dispatchEvent(new Event(EVENTO_ISCRIZIONE));
      await caricaLista();
    } catch (e) {
      setMsg({ ok: false, testo: 'Iscrizione non salvata: ' + (e as Error).message });
    } finally { setBusy(''); }
  };

  const disattiva = async () => {
    if (busy || lista === null) return;
    setBusy('disattiva'); setMsg(null);
    try {
      // prima il server: se fallisce non si tocca niente e si puo' riprovare; il contrario lascerebbe una riga che
      // riceve per un telefono che non ascolta piu'
      if (deviceId) { const r = await disiscrivi(deviceId); if (spento(r)) { sezioneSpenta(); return; } }
      const s = reg ? await reg.pushManager.getSubscription() : sub;
      // la riga sul server non c'e' piu': un unsubscribe fallito lascia solo un'iscrizione che nessuno usa
      if (s) await s.unsubscribe().catch(() => false);
      togliDevice(); impostaDevice(null); setSub(null);
      setMsg({ ok: true, testo: 'Notifiche disattivate su questo telefono.' });
      window.dispatchEvent(new Event(EVENTO_ISCRIZIONE));
      await caricaLista();
    } catch (e) {
      setMsg({ ok: false, testo: 'Disattivazione non riuscita: ' + (e as Error).message });
    } finally { setBusy(''); }
  };

  const inviaProva = async () => {
    if (busy || !deviceId) return;
    setBusy('prova'); setMsg(null);
    try {
      const r = await prova(deviceId);
      if (spento(r)) { sezioneSpenta(); return; }
      // esito e' la chiave della classe (ok, rimuovi...): a schermo va la frase di push-api
      setMsg({ ok: r.ok, testo: r.messaggio || (r.ok ? 'Prova inviata: la notifica arriva entro qualche secondo.' : `Prova non consegnata (${r.esito || 'esito sconosciuto'}).`) });
      // rimuovi = il servizio push non conosce piu' questa iscrizione e push-api ha cancellato la riga. Va tolta anche dal
      // browser: subscribe con la stessa chiave restituirebbe la stessa iscrizione morta e "Attiva" girerebbe a vuoto
      if (r.esito === 'rimuovi') {
        const s = reg ? await reg.pushManager.getSubscription().catch(() => sub) : sub;
        if (s) await s.unsubscribe().catch(() => false);
        togliDevice(); impostaDevice(null); setSub(null);
      }
      await caricaLista();
    } catch (e) {
      setMsg({ ok: false, testo: (e as Error).message });
    } finally { setBusy(''); }
  };

  const cambiaTema = async (key: string) => {
    if (busy || lista === null) return;
    const set = new Set(scelti);
    if (set.has(key)) set.delete(key); else set.add(key);
    const nuovi = temi.map((t) => t.key).filter((k) => set.has(k));
    if (!attivo || !mio || !deviceId) { setSceltiLocali(nuovi); return; }
    setBusy('temi'); setMsg(null);
    try {
      const r = await salvaTemi(deviceId, nuovi);
      if (spento(r)) { sezioneSpenta(); return; }
      if (!r.trovato) {
        setMsg({ ok: false, testo: 'Questo telefono non risulta più iscritto: tocca "Attiva notifiche su questo telefono".' });
        await caricaLista();
        return;
      }
      setLista((l) => l?.map((d) => (d.id === mio.id ? { ...d, temi: nuovi } : d)) ?? l);
    } catch (e) {
      setMsg({ ok: false, testo: 'Temi non salvati: ' + (e as Error).message });
    } finally { setBusy(''); }
  };

  // la persona si cambia rifacendo l'iscrizione con la stessa subscription (iscrivi e' un upsert sull'endpoint)
  const aggiornaPersona = async () => {
    if (busy || !sub || !mio || !deviceId || !chiValido) return;
    setBusy('persona'); setMsg(null);
    try {
      const r = await iscrivi({ chi, device_id: deviceId, subscription: datiIscrizione(sub), temi: soloAttivi(mio.temi), etichetta: mio.etichetta ?? etichettaDispositivo() });
      if (spento(r)) { sezioneSpenta(); return; }
      setMsg({ ok: true, testo: `Ora questo telefono riceve come ${personaName(chi)}.` });
      await caricaLista();
    } catch (e) {
      setMsg({ ok: false, testo: 'Persona non aggiornata: ' + (e as Error).message });
    } finally { setBusy(''); }
  };

  const togli = async (d: Dispositivo) => {
    if (busy) return;
    if (!window.confirm(`Togliere ${d.etichetta || 'il dispositivo'} di ${personaName(d.chi)}? Su quel telefono le notifiche smettono di arrivare.`)) return;
    setBusy('rimuovi'); setMsg(null);
    try {
      const r = await rimuovi(d.id);
      if (spento(r)) { sezioneSpenta(); return; }
      await caricaLista();
    } catch (e) {
      setMsg({ ok: false, testo: 'Dispositivo non tolto: ' + (e as Error).message });
    } finally { setBusy(''); }
  };

  const testata = <header><h1>Notifiche</h1><button className="badge" onClick={onBack} type="button">‹ Home</button></header>;

  if (supporto !== 'ok') return (
    <div className="screen">
      {testata}
      {supporto === 'ios-safari' && (
        <div className="card">
          <h2>Prima aggiungi Amimì alla schermata Home</h2>
          <p style={{ margin: '0 0 10px', lineHeight: 1.5 }}>Su iPhone e iPad le notifiche arrivano solo all’app aperta dalla schermata Home, non a Safari.</p>
          <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 1.6 }}>
            <li>Tocca <b>Condividi</b> (il quadrato con la freccia in su).</li>
            <li>Scegli <b>Aggiungi alla schermata Home</b>, poi <b>Aggiungi</b>.</li>
            <li>Apri Amimì dalla sua icona sulla schermata Home e torna qui: Home, Altro, Notifiche sul telefono.</li>
          </ol>
          <p className="note">Serve iOS 16.4 o successivo.</p>
        </div>
      )}
      {supporto === 'ios-vecchio' && (
        <div className="card">
          <h2>Serve un iOS più nuovo</h2>
          <p style={{ margin: 0, lineHeight: 1.5 }}>Le notifiche delle app dalla schermata Home arrivano da iOS 16.4 in poi. Aggiorna da Impostazioni, Generale, Aggiornamento software, poi riapri Amimì.</p>
        </div>
      )}
      {supporto === 'no' && (
        <div className="card">
          <h2>Notifiche non disponibili qui</h2>
          <p style={{ margin: 0, lineHeight: 1.5 }}>Questo browser non riceve notifiche push. Su Android usa Chrome (meglio dall’app installata: menu, Installa app); sul computer Chrome, Edge, Firefox o Safari.</p>
        </div>
      )}
    </div>
  );

  if (session === '?') return <div className="screen">{testata}<p className="muted center">Controllo l&#8217;accesso…</p></div>;
  if (session === 'out') return (
    <div className="screen">
      <header><button className="badge" onClick={onBack} type="button">‹ Home</button></header>
      <div className="cs-login">
        <div className="cs-logo">amimi<span>&#8217; notifiche</span></div>
        <div className="cs-lt">Per iscrivere questo telefono accedi con il tuo account Amimì</div>
        {ios && <div className="cs-note" style={{ marginTop: 0, marginBottom: 10 }}>Su iPhone usa email e password: Google si apre in Safari e l&#8217;accesso resta lì, non nell&#8217;app.</div>}
        <button className="cs-btn" style={{ width: '100%', background: 'var(--surface)', border: '1px solid var(--line)', color: 'var(--dark)' }} onClick={doGoogle} disabled={busyLogin} type="button">Accedi con Google</button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '14px 0 4px', color: 'var(--muted)', fontSize: 12 }}>
          <span style={{ flex: 1, height: 1, background: 'var(--line)' }} /> oppure con email <span style={{ flex: 1, height: 1, background: 'var(--line)' }} />
        </div>
        <div className="cs-fld"><label>Email ({EMAIL_TEAM_TESTO})</label>
          <input type="email" autoCapitalize="none" autoCorrect="off" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="info@amimi.it" /></div>
        <div className="cs-fld"><label>Password</label>
          <input type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') doLogin(); }} /></div>
        {errLogin && <div className="err" style={{ marginBottom: 8 }}>{errLogin}</div>}
        <button className="cs-btn cs-primary" style={{ width: '100%' }} onClick={doLogin} disabled={busyLogin} type="button">{busyLogin ? 'Accesso…' : 'Entra'}</button>
        <div className="cs-note">Stesso login dell&#8217;Assistenza: vale qualsiasi casella {EMAIL_TEAM_TESTO}, si fa una volta per dispositivo.</div>
      </div>
    </div>
  );

  if (errCfg) return (
    <div className="screen">
      {testata}
      <div className="card err">Errore: {errCfg}</div>
      <button className="ds-btn secondary full" type="button" onClick={() => setGen((g) => g + 1)}>Riprova</button>
    </div>
  );
  if (!cfg) return <div className="screen">{testata}<p className="muted center">Carico…</p></div>;
  if (!cfg.enabled) return <div className="screen">{testata}<div className="card muted center">Sezione non attiva ({cfg.motivo || 'flag push_enabled spento'}).</div></div>;

  // "spente" solo con elenco E iscrizione del browser letti: prima, o con la registrazione fallita, non lo si sa
  const stato = errLista ? 'Non riesco a leggere l’elenco dei dispositivi: tocca Riprova.'
    : lista === null || !(subLetta || errReg) || busy === 'verifica' ? 'Controllo l’iscrizione…'
    : attivo && mio ? `Attive per ${personaName(mio.chi)} su ${mio.etichetta || 'questo telefono'}.`
    : errReg && mio ? 'Non riesco a controllare questo telefono: vedi l’errore qui sotto.'
    : sub ? 'Iscrizione da completare: tocca "Attiva notifiche su questo telefono".'
    : mio ? 'Le notifiche su questo telefono si sono spente (su iPhone succede dopo un aggiornamento o un cambio di permesso): riattivale qui sotto.'
    : 'Spente su questo telefono.';
  const nessunTema = scelti.length === 0;

  return (
    <div className="screen">
      {testata}
      <div className="card">
        <h2>Questo telefono</h2>
        <div style={{ lineHeight: 1.5 }}>{stato}</div>
        {errLista && <div className="err" style={{ fontSize: 13, marginTop: 6 }}>Elenco dei dispositivi non letto: {errLista}</div>}
        {errLista && <button className="ds-btn secondary sm" style={{ marginTop: 8 }} type="button" onClick={riprovaLista}>Riprova</button>}
      </div>

      {permesso === 'denied' && (
        <div className="card warn">
          <b>Le notifiche sono bloccate per Amimì.</b> Si riattivano dalle impostazioni, poi torna qui:
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            <li>iPhone: Impostazioni, Notifiche, Amimì, Consenti notifiche.</li>
            <li>Android: tieni premuta l&#8217;icona di Amimì, Info app, Notifiche, attiva.</li>
            <li>Computer: il lucchetto accanto all&#8217;indirizzo, Notifiche, Consenti.</li>
          </ul>
        </div>
      )}

      <div className="card">
        <h2>Chi usa questo telefono</h2>
        <PersonaPicker chi={personaScelta || mio ? chi : ''} setChi={(c) => { setPersonaScelta(true); setChi(c); }} />
        {attivo && mio && chiValido && mio.chi !== chi && (
          <div className="note">
            Iscritto come {personaName(mio.chi)}.{' '}
            <button className="ds-btn secondary sm" type="button" onClick={aggiornaPersona} disabled={!!busy}>{busy === 'persona' ? 'Aggiorno…' : `Usa ${personaName(chi)}`}</button>
          </div>
        )}
      </div>

      <div className="card">
        <h2>Cosa ricevere</h2>
        {temi.length === 0 && <div className="muted">Nessun tema attivo sul server.</div>}
        {temi.map((t) => (
          <label key={t.key} className="ds-toggle" style={{ display: 'flex', alignItems: 'flex-start', padding: '8px 0' }}>
            <input type="checkbox" checked={scelti.includes(t.key)} onChange={() => { void cambiaTema(t.key); }} disabled={!!busy || lista === null || (!attivo && !chiValido)} />
            <span className="track" style={{ marginTop: 1 }}><span className="knob" /></span>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span>{t.etichetta}</span>
              {t.descrizione && <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>{t.descrizione}</span>}
            </span>
          </label>
        ))}
        {nessunTema && temi.length > 0 && (chiValido || attivo) && <div className="note">Nessun tema scelto: {attivo ? 'questo telefono non riceve niente.' : 'scegline almeno uno.'}</div>}
      </div>

      {!attivo && (
        <button className="ds-btn primary full" type="button" onClick={attiva}
          disabled={!reg || !chiave || !!busy || nessunTema || !chiValido || permesso === 'denied' || lista === null}>
          {busy === 'attiva' ? 'Attivo…' : 'Attiva notifiche su questo telefono'}
        </button>
      )}
      {!attivo && !reg && !errReg && <div className="note center">Preparo il telefono…</div>}
      {!chiValido && <div className="note center">Scegli chi usa questo telefono.</div>}
      {errReg && <div className="msg err">{errReg}</div>}
      {attivo && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button className="ds-btn secondary full" type="button" onClick={inviaProva} disabled={!!busy}>{busy === 'prova' ? 'Invio…' : 'Invia una prova'}</button>
        </div>
      )}
      {(attivo || sub || mio) && (
        <button className="ds-btn danger soft full" style={{ marginTop: 8 }} type="button" onClick={disattiva} disabled={!!busy || lista === null}>{busy === 'disattiva' ? 'Disattivo…' : 'Disattiva su questo telefono'}</button>
      )}
      {msg && <div className={`msg ${msg.ok ? 'ok' : 'err'}`} role="status">{msg.testo}</div>}

      <div className="card" style={{ marginTop: 18 }}>
        <h2>Dispositivi iscritti</h2>
        {lista === null && !errLista && <div className="muted">Carico…</div>}
        {lista !== null && lista.length === 0 && <div className="muted">Nessun telefono iscritto.</div>}
        {(lista ?? []).map((d) => {
          const questo = !!deviceId && d.questo;
          const ko = d.last_status != null && (d.last_status < 200 || d.last_status >= 300);
          return (
            <div key={d.id} className="ds-lrow" data-dispositivo={d.id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <div style={{ minWidth: 0 }}>
                  <b>{personaName(d.chi)}</b> · {d.etichetta || 'dispositivo'}{questo && <span className="badge" style={{ marginLeft: 6 }}>questo telefono</span>}
                </div>
                {!questo && <button className="ds-btn danger soft sm" type="button" onClick={() => togli(d)} disabled={!!busy}>Rimuovi</button>}
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                {d.temi.length ? d.temi.map(nomeTema).join(', ') : 'nessun tema'}
                {' · '}{d.last_ok_at ? `ultimo invio riuscito ${quando(d.last_ok_at)}` : 'nessun invio ancora'}
                {ko && ` · ultimo esito ${d.last_status}`}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
