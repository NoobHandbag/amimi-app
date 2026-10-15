import { useEffect, useMemo, useState } from 'react';
import { fetchTouches, addTouch, renderTemplate, STAGES, STAGE_LABEL, ESITI, VERDETTO_LABEL, TIPO_LABEL, fetchDrafts, generaBozza, inviaBozza, inviaProva, indirizzoInterno, sbloccaBozza, scartaBozza, segnaposto, LEAD_MITTENTE, cercaInviate, agganciaTocco, inviaRisposta, proponiRisposta, rifinisciTesto, fetchInbound, inboundCollega, inboundScarta, inboundCrea, nuovoNegozio } from '../lib/leadApi';
import type { LeadOutreach, LeadTouch, LeadSequence, LeadDraft, InviataCandidata, LeadInbound, NegozioCandidato, Alternativa } from '../lib/leadApi';
import { negozioCiHaScritto, dopoInvioManuale, rispostaPreparata, avvisiTesto, ordinaConversazione, propostaSalvata, propostaStantia, giaRisposto, modoIniziale, NON_CONVERSAZIONE } from '../lib/leadRegole';
import type { ElementoConv } from '../lib/leadRegole';

// Sezione Outreach (tappa 1 del PIANO_Outreach_CRM.md): pipeline per stadio, coda del giorno, scheda del negozio
// (conversazione a bolle e un compositore, come Assistenza, dal 15-10), sequenze. Le email partono dalla edge
// lead-outreach dopo la conferma di una persona, o da Gmail ("Apri in Gmail" + "Segna come inviata"). Ogni azione
// registrata a mano = INSERT in lead_touches.

const fmtD = (iso: string | null | undefined) => { if (!iso) return ''; const d = new Date(iso); return isNaN(d.getTime()) ? iso.slice(0, 10) : d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' }); };
const fmtDT = (iso: string) => { const d = new Date(iso); return d.toLocaleString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); };
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const CANALI: Record<string, string> = { email: 'Email', telefono: 'Telefono', instagram_dm: 'Instagram DM', visita: 'Visita', altro: 'Altro' };

function Due({ r }: { r: LeadOutreach }) {
  if (r.da_gestire) return <span className="or-due late">risposta da gestire</span>;
  if (r.bozza_auto_tocco != null) return <span className="or-due late">follow-up {r.bozza_auto_tocco} pronto da rivedere</span>;
  if (r.scaduta) return <span className="or-due late">{r.prossima_azione ?? 'azione'} · scaduta {fmtD(r.prossima_azione_at)}</span>;
  if (r.prossima_azione_at) return <span className="or-due">{r.prossima_azione ?? 'prossima azione'} · {fmtD(r.prossima_azione_at)}</span>;
  if (r.lead_stage === 'da_contattare' && !r.n_tocchi) return <span className="or-due">{r.telefono_maps || r.telefono ? 'telefono prima' : r.email_generica || r.email_sito ? 'email 1 da scrivere' : 'nessun contatto: cercarlo'}</span>;
  if (r.giorni_da_ultimo != null) return <span className="or-due muted">{r.giorni_da_ultimo} gg dall&#8217;ultimo tocco</span>;
  return null;
}

function Card({ r, urls, onOpen }: { r: LeadOutreach; urls: Record<string, string>; onOpen: (id: string) => void }) {
  return (
    <button type="button" className="or-card" onClick={() => onOpen(r.id)}>
      {r.thumb && urls[r.thumb] ? <img src={urls[r.thumb]} alt="" /> : <span className="or-thumb-empty" />}
      <div className="or-card-b">
        <div className="or-n">{r.nome}</div>
        <div className="or-m">{[r.citta ?? r.paese, r.tier ? `Tier ${r.tier}` : r.tier_proposto ? `${r.tier_proposto}?` : null, r.totale != null ? r.totale : null].filter((x) => x != null).join(' · ')}</div>
        {r.ultimo_tocco_at && <div className="or-m">{CANALI[r.ultimo_canale ?? ''] ?? r.ultimo_canale} {r.ultima_direzione === 'in' ? 'ricevuta' : 'inviata'} · {fmtD(r.ultimo_tocco_at)}{r.ultimo_chi ? ` · ${r.ultimo_chi}` : ''}</div>}
        <Due r={r} />
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------------------------
export function OutreachBoard({ rows, urls, onOpen }: { rows: LeadOutreach[]; urls: Record<string, string>; onOpen: (id: string) => void }) {
  const contattati = rows.filter((r) => r.n_email_out > 0 || (r.n_tocchi > 0 && r.lead_stage !== 'da_contattare'));
  const risposti = rows.filter((r) => ['risposto', 'interessato', 'materiale_inviato', 'appuntamento', 'primo_ordine', 'attivo'].includes(r.lead_stage));
  const cols = STAGES.filter((s) => s.key !== 'opt_out' || rows.some((r) => r.lead_stage === 'opt_out'));
  return (
    <>
      <div className="kpis">
        <div className="ds-kpi"><div className="v">{rows.filter((r) => r.lead_stage === 'da_contattare').length}</div><div className="l">Da contattare</div><div className="s">verdetto positivo, nessun tocco ancora</div></div>
        <div className="ds-kpi"><div className="v">{contattati.length}</div><div className="l">Contattati</div><div className="s">{rows.filter((r) => r.n_tocchi > 0 && r.ultimo_tocco_at && Date.now() - new Date(r.ultimo_tocco_at).getTime() < 7 * 864e5).length} toccati negli ultimi 7 giorni</div></div>
        <div className={`ds-kpi ${risposti.length ? 'pos' : ''}`}><div className="v">{contattati.length ? `${Math.round((risposti.length / contattati.length) * 100)}%` : 'n.d.'}</div><div className="l">Tasso di risposta</div><div className="s">{risposti.length} su {contattati.length} contattati</div></div>
        <div className={`ds-kpi ${rows.some((r) => r.scaduta || r.da_gestire) ? 'neg' : ''}`}><div className="v">{rows.filter((r) => r.scaduta || r.da_gestire).length}</div><div className="l">Da fare oggi</div><div className="s">{rows.filter((r) => r.scaduta).length} scadute · {rows.filter((r) => r.da_gestire).length} risposte</div></div>
      </div>
      {/* su telefono (sotto i 700 px, index.css) il kanban diventa una lista unica per stadio: gli stadi vuoti spariscono */}
      {!rows.length && <p className="muted or-solo-tel">Nessun negozio in pipeline.</p>}
      <div className="or-board">
        {cols.map((s) => { const list = rows.filter((r) => r.lead_stage === s.key); return (
          <div key={s.key} className={list.length ? 'or-col' : 'or-col empty'}>
            <h3><span>{s.label}</span><span>{list.length}</span></h3>
            {list.map((r) => <Card key={r.id} r={r} urls={urls} onOpen={onOpen} />)}
          </div>
        ); })}
      </div>
      <p className="note">Entrano qui i negozi con verdetto "da contattare". Lo stadio si cambia dalla scheda (registrando un tocco o con "Sposta a"). "Primo ordine" e "Attivo" per ora si spostano a mano: l&#8217;aggancio automatico alle vendite B2B arriva con la tappa 4.</p>
    </>
  );
}


// ---------------------------------------------------------------------------------------------
// v13 (blocco C del cruscotto B2B): ingresso inbound. In cima alla Coda, i messaggi di Assistenza che possono essere un
// negozio e non sono ancora qui (vista v_lead_inbound: modulo del sito classificato B2B, email a wholesale@, mittenti gia'
// noti), con "Collega a", "Crea negozio" e "Non e' un negozio"; e "Nuovo negozio" per un ingresso da Instagram, telefono,
// visita o fiera. Assistenza si legge soltanto. Un negozio nuovo non nasce se ne esiste uno uguale (email, Instagram, sito,
// nome+citta'): la edge risponde con i candidati e la persona sceglie se collegarsi a uno di quelli o crearlo comunque.
type FormNegozio = { convId: string | null; nome: string; citta: string; tipo: string; email: string; telefono: string; ig: string; website: string; canale: string; referente: string; nota: string; duplicati: NegozioCandidato[] };
const CANALI_INGRESSO: Record<string, string> = { instagram_dm: 'Instagram', telefono: 'Telefono', visita: 'Visita in negozio', email: 'Email', altro: 'Fiera, passaparola, altro (non conta come un loro contatto)' };
const viaLabel: Record<string, string> = { email: 'stessa email del negozio', contatto: 'è un suo contatto', dominio: 'stesso dominio del sito', sito: 'stesso sito', instagram: 'stesso Instagram', "nome e citta'": 'stesso nome e città' };

function InboundCoda({ who, onChanged, onOpen, rows }: { who: string; onChanged: () => Promise<void>; onOpen: (id: string) => void; rows: LeadOutreach[] }) {
  const [inbound, setInbound] = useState<LeadInbound[] | null>(null);
  const [msg, setMsg] = useState<{ t: string; err: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<FormNegozio | null>(null);
  const carica = async () => { try { setInbound(await fetchInbound()); } catch (e) { setInbound([]); setMsg({ t: 'Messaggi da collegare non disponibili: ' + (e as Error).message, err: true }); } };
  // si ricarica quando la pipeline si ricarica ("Aggiorna" in testata, o dopo un'azione che cambia un negozio)
  /* eslint-disable-next-line react-hooks/exhaustive-deps */
  useEffect(() => { void carica(); }, [rows]);
  const fatto = async (t: string, apri?: string) => {
    setMsg({ t, err: false });
    // la pipeline si ricarica solo quando un negozio cambia (collegato o creato): serve ad aprirne la scheda
    if (apri) { try { await onChanged(); } catch { /* il ricarico della pipeline non annulla l'azione fatta */ } }
    await carica();
    if (apri) onOpen(apri);
  };
  const collega = async (m: LeadInbound, c: NegozioCandidato) => {
    setBusy(true); setMsg(null);
    try { const r = await inboundCollega({ conv_id: m.conv_id, account_id: c.id, chi: who }); setForm(null); await fatto(`Collegato a ${c.nome}: ${r.tocchi} messaggi in timeline.`, c.id); }
    catch (e) { setMsg({ t: (e as Error).message, err: true }); }
    setBusy(false);
  };
  const scarta = async (m: LeadInbound) => {
    if (!window.confirm('Togliere questo messaggio dalla lista? Resta in Assistenza com’è.')) return;
    setBusy(true); setMsg(null);
    try { await inboundScarta({ conv_id: m.conv_id, chi: who }); await fatto('Tolto dalla lista: non è un negozio.'); }
    catch (e) { setMsg({ t: (e as Error).message, err: true }); }
    setBusy(false);
  };
  const apriForm = (m: LeadInbound | null) => setForm({ convId: m?.conv_id ?? null, nome: m?.customer_name ?? '', citta: '', tipo: 'boutique', email: m?.customer_email ?? '', telefono: '', ig: '', website: '', canale: 'instagram_dm', referente: '', nota: '', duplicati: [] });
  const salva = async (forza: boolean) => {
    if (!form) return;
    setBusy(true); setMsg(null);
    const dati = { nome: form.nome, citta: form.citta, tipo: form.tipo, email: form.email, telefono: form.telefono, ig_handle: form.ig, website: form.website, referente: form.referente, nota: form.nota, forza, chi: who };
    try {
      const r = form.convId ? await inboundCrea({ ...dati, conv_id: form.convId }) : await nuovoNegozio({ ...dati, canale: form.canale });
      setForm(null);
      await fatto(`Negozio ${form.nome} creato.`, r.account_id);
    } catch (e) {
      const dup = ((e as Error & { dati?: { duplicati?: NegozioCandidato[] } }).dati?.duplicati) ?? [];
      if (dup.length) setForm((f) => (f ? { ...f, duplicati: dup } : f));
      setMsg({ t: (e as Error).message, err: true });
    }
    setBusy(false);
  };
  const campo = (k: keyof FormNegozio, label: string, extra: Record<string, unknown> = {}) => (
    <label className="cs-fld">{label}<input value={String(form?.[k] ?? '')} onChange={(e) => setForm((f) => (f ? { ...f, [k]: e.target.value, duplicati: [] } : f))} {...extra} /></label>
  );
  const modulo = form && (
    <div className="or-inbound-form">
      <h3>{form.convId ? 'Crea il negozio da questo messaggio' : 'Nuovo negozio'}</h3>
      {campo('nome', 'Nome del negozio')}
      {campo('citta', 'Città')}
      <label className="cs-fld">Tipo<select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value, duplicati: [] })}>{Object.entries(TIPO_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      {!form.convId && <label className="cs-fld">Come ci ha contattato<select value={form.canale} onChange={(e) => setForm({ ...form, canale: e.target.value, duplicati: [] })}>{Object.entries(CANALI_INGRESSO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>}
      {campo('email', 'Email', { type: 'email' })}
      {!form.convId && campo('telefono', 'Telefono')}
      {!form.convId && campo('referente', 'Referente (nome)')}
      {campo('ig', 'Instagram (handle)')}
      {campo('website', 'Sito')}
      {!form.convId && <label className="cs-fld">Cosa ci siamo detti<textarea rows={3} value={form.nota} onChange={(e) => setForm({ ...form, nota: e.target.value })} /></label>}
      {form.duplicati.length > 0 && <div className="note">
        <b>Potrebbe essere già qui:</b>
        {form.duplicati.map((d) => <div key={d.id} className="row"><div><div className="rt">{d.nome}{d.citta ? ` · ${d.citta}` : ''}</div><div className="rs">{viaLabel[d.via] ?? d.via}</div></div>
          {form.convId && inbound ? <button type="button" className="ds-btn" disabled={busy} onClick={() => { const m = inbound.find((x) => x.conv_id === form.convId); if (m) void collega(m, d); }}>Collega a questo</button> : <button type="button" className="ds-btn" disabled={busy} onClick={() => { setForm(null); onOpen(d.id); }}>Apri</button>}
        </div>)}
      </div>}
      <div className="lead-actions">
        <button type="button" className="ds-btn" disabled={busy || form.nome.trim().length < 2} onClick={() => void salva(form.duplicati.length > 0)}>{form.duplicati.length ? 'Crea comunque un negozio nuovo' : 'Crea negozio'}</button>
        <button type="button" className="ds-btn" disabled={busy} onClick={() => setForm(null)}>Annulla</button>
      </div>
    </div>
  );
  return (
    <section className="card">
      <div className="or-inbound-head"><h2>Messaggi da collegare{inbound ? ` · ${inbound.length}` : ''}</h2><button type="button" className="ds-btn" disabled={busy} onClick={() => apriForm(null)}>Nuovo negozio</button></div>
      <p className="note">Moduli del sito e email a wholesale@ arrivati in Assistenza negli ultimi 30 giorni, e messaggi da indirizzi già noti, non ancora nella timeline di un negozio.</p>
      {form && !form.convId && modulo}
      {!inbound ? <p className="muted">Carico…</p> : !inbound.length ? <p className="muted">Nessun messaggio da collegare.</p> : <div className="or-list">{inbound.map((m) => (
        <div key={m.conv_id} className="or-inbound">
          <div className="rt"><b>{m.customer_name || m.customer_email || 'mittente sconosciuto'}</b>{m.customer_email && m.customer_name ? ` · ${m.customer_email}` : ''} · {fmtDT(m.last_msg_at)}{m.da_modulo ? ' · modulo del sito' : ''}{m.a_wholesale ? ' · a wholesale@' : ''}</div>
          <div className="rs">{m.subject ? <b>{m.subject} </b> : null}{m.snippet}</div>
          <div className="lead-actions">
            {m.candidati.map((c) => <button key={c.id} type="button" className="ds-btn" disabled={busy} title={viaLabel[c.via] ?? c.via} onClick={() => void collega(m, c)}>Collega a {c.nome}{c.citta ? ` (${c.citta})` : ''}</button>)}
            <button type="button" className="ds-btn" disabled={busy} onClick={() => apriForm(m)}>Crea negozio</button>
            <button type="button" className="or-link" disabled={busy} onClick={() => void scarta(m)}>Non è un negozio</button>
          </div>
          {form?.convId === m.conv_id && modulo}
        </div>
      ))}</div>}
      <div className="or-esito" aria-live="polite">{msg && <div className={msg.err ? 'err' : 'note'} style={{ marginTop: 8 }}>{msg.t}</div>}</div>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
export function OutreachCoda({ rows, onOpen, who, onChanged, aiOn }: { rows: LeadOutreach[]; onOpen: (id: string) => void; who: string; onChanged: () => Promise<void>; aiOn: boolean }) {
  const risposte = rows.filter((r) => r.da_gestire);
  // follow-up gia' scritti dal giro automatico (migr 0148): manca solo la rilettura e il click di invio
  const pronti = rows.filter((r) => r.bozza_auto_tocco != null && !r.da_gestire);
  const scadute = rows.filter((r) => r.scaduta && !r.da_gestire && r.bozza_auto_tocco == null);
  const inScadenza = rows.filter((r) => !r.scaduta && r.bozza_auto_tocco == null && r.prossima_azione_at && r.prossima_azione_at <= addDays(2));
  const nuovi = rows.filter((r) => r.lead_stage === 'da_contattare' && !r.n_tocchi);
  const Row = ({ r, icon, what }: { r: LeadOutreach; icon: string; what: string }) => (
    <button type="button" className="or-row" onClick={() => onOpen(r.id)}>
      <span className="or-ico">{icon}</span>
      <span className="or-t"><b>{r.nome}</b><small>{what}</small></span>
      <span className="or-go">Apri ›</span>
    </button>
  );
  const empty = !risposte.length && !pronti.length && !scadute.length && !inScadenza.length && !nuovi.length;
  return (
    <>
      {aiOn && <InboundCoda who={who} onChanged={onChanged} onOpen={onOpen} rows={rows} />}
      {empty && <section className="card"><p className="muted">Niente da fare oggi. Bel lavoro.</p></section>}
      {risposte.length > 0 && <section className="card"><h2>Risposte da gestire · {risposte.length}</h2><div className="or-list">{risposte.map((r) => <Row key={r.id} r={r} icon="📩" what={`${CANALI[r.ultimo_canale ?? ''] ?? ''} ricevuta ${fmtD(r.ultimo_tocco_at)}${r.ultimo_esito ? ` · ${ESITI.find((e) => e.key === r.ultimo_esito)?.label ?? r.ultimo_esito}` : ''}`} />)}</div></section>}
      {pronti.length > 0 && <section className="card"><h2>Follow-up pronti da rivedere · {pronti.length}</h2><div className="or-list">{pronti.map((r) => <Row key={r.id} r={r} icon="✍️" what={`bozza del follow-up ${r.bozza_auto_tocco} di 4 già scritta: rileggila e inviala`} />)}</div></section>}
      {scadute.length > 0 && <section className="card"><h2>Azioni scadute · {scadute.length}</h2><div className="or-list">{scadute.map((r) => <Row key={r.id} r={r} icon="⏰" what={`${r.prossima_azione ?? 'azione'} · scaduta il ${fmtD(r.prossima_azione_at)} · ${r.owner_outreach ?? ''}`} />)}</div></section>}
      {inScadenza.length > 0 && <section className="card"><h2>In scadenza entro 2 giorni · {inScadenza.length}</h2><div className="or-list">{inScadenza.map((r) => <Row key={r.id} r={r} icon="📅" what={`${r.prossima_azione ?? 'azione'} · ${fmtD(r.prossima_azione_at)}`} />)}</div></section>}
      {nuovi.length > 0 && <section className="card"><h2>Da contattare, mai toccati · {nuovi.length}</h2><div className="or-list">{nuovi.map((r) => <Row key={r.id} r={r} icon={r.telefono_maps || r.telefono ? '📞' : '✍️'} what={r.telefono_maps || r.telefono ? `telefonata di qualifica (${r.telefono ?? r.telefono_maps})` : r.email_generica || r.email_sito ? `email 1 a ${r.email_generica ?? r.email_sito}` : 'nessun contatto trovato: cercare email o telefono'} />)}</div></section>}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// v15 (15-10, Dan: "fallo come Assistenza, che e' stupenda"): la scheda del negozio e' UNA colonna, come il thread di
// Assistenza: testata, Info utili, la conversazione a bolle in ordine cronologico, UN solo compositore (modo 'risposta'
// per chi ci ha scritto, con le proposte AI lette dalla conversazione; modo 'sequenza' per il contatto a freddo), poi le
// bozze e "Registra un tocco". Le classi cs-* sono quelle di Assistenza, riusate tali e quali; le regole pure stanno in
// leadRegole.ts (ordinaConversazione, propostaSalvata, propostaStantia, giaRisposto, modoIniziale).
const ICONA_NOTA: Record<string, string> = { telefono: '📞', visita: '🏬', instagram_dm: '📸', altro: '📝', email: '✉️' };

export function OutreachScheda({ r, urls, who, sequences, settings, onBack, onOpenDossier, onChanged }: { r: LeadOutreach; urls: Record<string, string>; who: string; sequences: LeadSequence[]; settings: Record<string, string>; onBack: () => void; onOpenDossier: (id: string) => void; onChanged: () => Promise<void> }) {
  const [touches, setTouches] = useState<LeadTouch[] | null>(null);
  const [drafts, setDrafts] = useState<LeadDraft[]>([]);
  // esito delle azioni della testata (Sposta, Collega a Gmail, ricarico fallito): sotto le Info utili
  const [msg, setMsg] = useState<{ t: string; err: boolean } | null>(null);
  const avvisa = (t: string, err = false) => setMsg(t ? { t, err } : null);
  const [busy, setBusy] = useState(false);
  // registra tocco (telefonata, visita, Instagram, nota): modulo chiuso in fondo, con il suo esito
  const [canale, setCanale] = useState('telefono');
  const [dir, setDir] = useState<'in' | 'out'>('out');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [esito, setEsito] = useState('');
  const [stageDopo, setStageDopo] = useState('');
  const [pa, setPa] = useState('');
  const [paAt, setPaAt] = useState('');
  const [tmsg, setTmsg] = useState<{ t: string; err: boolean } | null>(null);
  const diciT = (t: string, err = false) => setTmsg(t ? { t, err } : null);
  const [moveTo, setMoveTo] = useState('');
  const firma = settings.lead_firma ?? 'Benedetta - Amimì Milano';
  const linesheet = settings.lead_linesheet_url ?? '';
  // flag: lead_outreach_ai_enabled = bozza AI della sequenza, invio e prova dall'app; lead_risposta_ai_enabled (v15) =
  // proposte di risposta dalla conversazione e "chiedi una modifica"
  const aiOn = settings.lead_outreach_ai_enabled === 'true';
  const aiRispostaOn = settings.lead_risposta_ai_enabled === 'true';
  // il compositore: un modo alla volta. Parte da modoIniziale quando la conversazione e' caricata; la persona lo cambia.
  const [modo, setModo] = useState<'risposta' | 'sequenza' | null>(null);
  // esito delle azioni del compositore, in fondo al compositore accanto ai bottoni (08-10: un invio rifiutato mostrato
  // in cima alla scheda e' sembrato un'email mai arrivata)
  const [cmsg, setCmsg] = useState<{ t: string; err: boolean } | null>(null);
  const dire = (t: string, err = false) => setCmsg(t ? { t, err } : null);
  const [aiBusy, setAiBusy] = useState(false);
  const [provaBusy, setProvaBusy] = useState(false);
  const [refineTxt, setRefineTxt] = useState('');
  const [refining, setRefining] = useState(false);
  // finestra di conferma dell'invio (al posto di window.confirm): vale per entrambi i modi
  const [sendOpen, setSendOpen] = useState(false);
  const [sendErr, setSendErr] = useState('');
  const [sendBloccato, setSendBloccato] = useState(false);
  const [convErr, setConvErr] = useState('');       // la conversazione non si e' letta: errore al posto di "Carico…", con Riprova
  const [apertura, setApertura] = useState('');     // perche' il compositore si e' aperto cosi' (follow-up automatico), sotto il selettore
  const [incertoMsg, setIncertoMsg] = useState(''); // esito incerto dell'ultimo invio: resta visibile anche dopo aver chiuso la finestra
  // modo sequenza: template, bozza AI (edge lead-outreach), invio con draftId e sendKey
  const [codice, setCodice] = useState(r.paese === 'IT' ? 'boutique_it' : 'boutique_en');
  const [tocco, setTocco] = useState<number>(Math.min(4, (r.n_email_out || 0) + 1));
  const [referente, setReferente] = useState('');
  const [testo, setTesto] = useState('');
  const [oggetto, setOggetto] = useState('');
  const [to, setTo] = useState(r.email_generica ?? r.email_sito ?? '');
  const [draftId, setDraftId] = useState<string | null>(null);
  const [sendKey, setSendKey] = useState('');
  const [avvisi, setAvvisi] = useState<string[]>([]);
  const [sNonGrounded, setSNonGrounded] = useState<string[]>([]);   // dati non nei fatti dopo "chiedi una modifica" sulla sequenza
  // modo risposta (v12 blocco B + v15): testo della persona o proposta AI, nessun numero di tocco
  const [rTo, setRTo] = useState('');
  const [rOggetto, setROggetto] = useState('');
  const [rTesto, setRTesto] = useState('');
  const [rKey, setRKey] = useState(() => crypto.randomUUID());
  const [rBusy, setRBusy] = useState(false);
  const [rProvaBusy, setRProvaBusy] = useState(false);   // Gate Fable: la prova non mostra "Invio" sul bottone vero
  const [rPronto, setRPronto] = useState(false);   // destinatario e oggetto riempiti una volta: poi decide la persona
  const [rToccato, setRToccato] = useState(false);   // destinatario o oggetto cambiati a mano: la proposta non li sovrascrive
  const [options, setOptions] = useState<Alternativa[] | null>(null);
  const [selIdx, setSelIdx] = useState(0);
  const [rDraftId, setRDraftId] = useState<string | null>(null);
  const [nonGrounded, setNonGrounded] = useState<string[]>([]);
  const [troncata, setTroncata] = useState(false);
  // v11 (blocco A3): collegare un tocco registrato a mano all'email partita da Gmail, scegliendola fra quelle di Posta inviata
  const [collega, setCollega] = useState<{ touchId: string; stato: 'carico' | 'pronto' | 'errore'; candidati: InviataCandidata[]; nota: string } | null>(null);

  const apriBozza = (d: LeadDraft) => {
    setCmsg(null);   // l'esito della bozza di prima non deve restare sotto il bottone Invia di questa
    if (d.sequenza_tocco != null) setTocco(d.sequenza_tocco);
    if (d.lingua === 'en' || d.lingua === 'it') setCodice(d.lingua === 'en' ? 'boutique_en' : 'boutique_it');
    setDraftId(d.id); setSendKey(crypto.randomUUID());
    setOggetto(d.oggetto ?? ''); setTesto(d.testo); if (d.to_email) setTo(d.to_email);
    setAvvisi(d.fatti_usati?.avvisi ?? []); setSNonGrounded([]);
    setModo('sequenza');
  };
  // v15: una proposta di risposta salvata torna nel compositore con le sue alternative (niente chiamata al modello)
  const apriProposta = (d: LeadDraft) => {
    setCmsg(null);
    const alts: Alternativa[] = (d.fatti_usati?.alternative ?? []).map((a) => ({ titolo: a.titolo, testo: a.testo, non_grounded: a.non_grounded ?? [], troncata: !!a.troncata, avvisi: a.avvisi ?? [], segnaposto: a.segnaposto ?? [] }));
    if (!alts.length) alts.push({ titolo: 'Risposta', testo: d.testo, non_grounded: [], troncata: false, avvisi: [], segnaposto: [] });
    setOptions(alts); setSelIdx(0); setRTesto(alts[0].testo); setNonGrounded(alts[0].non_grounded); setTroncata(alts[0].troncata);
    setRDraftId(d.id); setRKey(crypto.randomUUID()); setRefineTxt('');
    if (!rToccato) { if (d.to_email) setRTo(d.to_email); if (d.oggetto) setROggetto(d.oggetto); setRPronto(true); }
    setModo('risposta');
  };
  // tocchi e bozze in parallelo (15-10: "la sezione B2B e' lentissima")
  const reload = async () => { const [ts, ds] = await Promise.all([fetchTouches(r.id), fetchDrafts(r.id)]); setTouches(ts); setDrafts(ds); return { ts, ds }; };
  // dopo una scrittura RIUSCITA la scheda si ricarica: se il ricarico fallisce l'azione resta fatta, e l'esito lo dice
  // invece di sembrare un errore dell'azione (un invio partito non deve mai leggersi come fallito)
  const ricarica = async (): Promise<string> => { try { await onChanged(); await reload(); return ''; } catch { return ' La scheda non si è aggiornata: ricarica la pagina per vedere la conversazione.'; } };
  // all'apertura: se il giro automatico ha gia' scritto il follow-up di questo negozio, il compositore parte da li' (modo
  // sequenza); altrimenti dal modo iniziale (risposta a chi ci ha scritto, sequenza a freddo agli altri)
  const apriScheda = () => {
    setTouches(null); setDraftId(null); setRDraftId(null); setOptions(null); setCmsg(null); setModo(null); setSendOpen(false); setConvErr(''); setApertura(''); setIncertoMsg('');
    reload().then(({ ts, ds }) => {
      const auto = r.bozza_auto_tocco != null ? ds.find((d) => d.origine === 'auto' && d.stato === 'proposta' && d.sequenza_tocco === r.bozza_auto_tocco) : undefined;
      // il follow-up automatico apre la sequenza SOLO se il negozio non ci ha scritto nel frattempo: a chi ha scritto si
      // risponde, e il follow-up resta fra le bozze. L'avviso sta sotto il selettore, non in fondo al compositore.
      if (auto && !negozioCiHaScritto(ts)) { apriBozza(auto); setApertura(`Follow-up ${auto.sequenza_tocco} scritto in automatico alla scadenza: rileggilo, correggilo e invialo (o scartalo).`); }
      else { setModo(modoIniziale(ts, r.lead_stage, r.n_opt_out)); if (auto) setApertura(`Il follow-up ${auto.sequenza_tocco} automatico è fra le bozze, ma il negozio ci ha scritto: rispondi alla conversazione (e scarta il follow-up).`); }
    }).catch((e: Error) => {
      // senza conversazione il compositore resta usabile (template, Gmail, copia); l'errore sta dove c'era "Carico…",
      // con Riprova (Gate 2 v15, B4)
      setModo(modoIniziale([], r.lead_stage, r.n_opt_out));
      setConvErr(e.message);
    });
  };
  useEffect(() => { apriScheda(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [r.id]);
  // una proposta di risposta non piu' utile si chiude (scarta della edge): il riquadro "C’è già una proposta" sparisce
  const scartaProposta = async (id: string) => {
    setBusy(true); dire('');
    try {
      await scartaBozza({ draft_id: id, chi: who });
      if (rDraftId === id) { setRDraftId(null); setOptions(null); setNonGrounded([]); setTroncata(false); }
      dire('Proposta scartata.'); setDrafts(await fetchDrafts(r.id));
    } catch (e) { dire((e as Error).message, true); }
    setBusy(false);
  };
  const scarta = async () => {
    if (!draftId) return;
    setBusy(true); dire('');
    try { await scartaBozza({ draft_id: draftId, chi: who }); setDraftId(null); setAvvisi([]); setSNonGrounded([]); setApertura(''); dire('Bozza scartata.' + (await ricarica())); } catch (e) { dire((e as Error).message, true); }
    setBusy(false);
  };

  const seq = useMemo(() => sequences.find((s) => s.codice === codice && s.tocco === tocco) ?? null, [sequences, codice, tocco]);
  useEffect(() => {
    if (draftId) return;
    if (!seq) { setTesto(''); setOggetto(''); return; }
    setTesto(renderTemplate(seq.corpo, r, referente, firma, linesheet));
    setOggetto(seq.oggetto ? renderTemplate(seq.oggetto, r, referente, firma, linesheet) : '');
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [seq?.id, referente, r.id, draftId, firma, linesheet]);

  const bozzaAI = async () => {
    if (seq?.canale !== 'email') { dire('La bozza AI è per i tocchi email (1-4).', true); return; }
    setAiBusy(true); dire('');
    try {
      const d = await generaBozza({ account_id: r.id, tocco, referente: referente || undefined, lingua: codice.endsWith('_en') ? 'en' : 'it', chi: who });
      setDraftId(d.draft_id); setSendKey(crypto.randomUUID());
      setOggetto(d.oggetto); setTesto(d.testo); if (d.to && !to) setTo(d.to);
      setAvvisi(d.avvisi ?? []); setSNonGrounded([]); setRefineTxt('');
      dire(d.segnaposto.length ? `Bozza pronta. Completa le ${d.segnaposto.length} parti fra parentesi quadre prima di inviare.` : 'Bozza pronta: rileggila e correggila prima di inviare.');
      setDrafts(await fetchDrafts(r.id));
    } catch (e) { dire((e as Error).message, true); }
    setAiBusy(false);
  };
  const residui = segnaposto(`${oggetto}\n${testo}`);
  const toInterno = indirizzoInterno(to);
  // invio della sequenza: dalla finestra di conferma. Un errore resta nella finestra (la persona legge e decide).
  const invia = async () => {
    if (!draftId) return;
    setBusy(true); setSendErr('');
    try {
      const res = await inviaBozza({ draft_id: draftId, send_key: sendKey, to, oggetto, testo, chi: who });
      setDraftId(null); setAvvisi([]); setSNonGrounded([]); setSendOpen(false); setIncertoMsg(''); setApertura('');
      dire(`${res.already_sent ? 'Già inviata prima' : 'Inviata'} a ${res.to}${res.from ? ` da ${res.from}` : ''}.${res.prossimo ? ` Follow-up in coda per il ${fmtD(res.prossimo)}.` : ''}${res.warnings?.length ? ' Attenzione: ' + res.warnings.join(' ') : ''}${await ricarica()}`);
      setTocco((t) => Math.min(4, t + 1));
    } catch (e) {
      const err = e as Error & { bloccante?: boolean; incerto?: boolean };
      setSendErr(err.message);
      if (err.incerto) setIncertoMsg(err.message);   // la bozza resta in invio con la stessa chiave: lo si vede anche a finestra chiusa
      if (err.bloccante) setSendBloccato(true);
    }
    setBusy(false);
  };
  // prova: il testo che c'e' ADESSO nel box, alla casella di chi e' loggato. Non e' un invio: niente tocco, niente tetto.
  // Stato suo (provaBusy): durante una prova il bottone Invia non deve leggere "Invio…".
  const prova = async () => {
    setProvaBusy(true); dire('');
    try {
      const res = await inviaProva({ oggetto, testo });
      dire(`Prova inviata a ${res.to}${res.from ? ` da ${res.from}` : ''}: la trovi in Posta in arrivo con “[PROVA]” nell’oggetto. Non conta come invio: bozza, tocchi e tetto restano come prima.${res.segnaposto ? ` Nel testo restano ${res.segnaposto} parti fra parentesi da completare.` : ''}${res.warnings?.length ? ' Attenzione: ' + res.warnings.join(' ') : ''}`);
    } catch (e) { dire((e as Error).message, true); }
    setProvaBusy(false);
  };

  // torna l'id del tocco solo se e' stato scritto: chi chiama pulisce il modulo o avanza il tocco SOLO in quel caso
  const save = async (t: Parameters<typeof addTouch>[0], ok: string, out: (s: string, err?: boolean) => void = avvisa): Promise<string | null> => {
    setBusy(true); out('');
    let id: string | null = null;
    try { id = await addTouch(t); out(ok + (await ricarica())); } catch (e) { out((e as Error).message, true); }
    setBusy(false);
    return id;
  };
  // v11 (A3): i candidati di Posta inviata per un tocco email senza thread. Nessuna scelta automatica, anche con un solo candidato.
  const apriCollega = async (touchId: string) => {
    setCollega({ touchId, stato: 'carico', candidati: [], nota: '' });
    try {
      const res = await cercaInviate(touchId);
      const nota = res.gia_agganciato ? 'Già collegata.' : res.motivo ?? (res.candidati.length ? '' : 'Nessuna email a questo negozio in Posta inviata di info@ nei 3 giorni attorno alla registrazione. Se l’hai appena mandata, Gmail può metterci qualche secondo: premi “Cerca di nuovo”. Se è partita da un’altra casella, le risposte non si leggono da qui: registrale con “Registra un tocco”.');
      setCollega({ touchId, stato: 'pronto', candidati: res.candidati, nota });
    } catch (e) { setCollega({ touchId, stato: 'errore', candidati: [], nota: (e as Error).message }); }
  };
  const collegaA = async (touchId: string, gmailId: string) => {
    setBusy(true);
    try {
      await agganciaTocco({ touch_id: touchId, gmail_message_id: gmailId, chi: who });
      setCollega(null);
      avvisa('Email collegata: le risposte del negozio a quell’email entrano in conversazione al prossimo giro automatico (entro mezz’ora).' + (await ricarica()));
    } catch (e) { setCollega((c) => (c ? { ...c, stato: 'errore', nota: (e as Error).message } : c)); }
    setBusy(false);
  };
  const registra = () => save({ account_id: r.id, canale, direzione: dir, subject: subject || null, body_clean: body || null, stage_prima: r.lead_stage, stage_dopo: stageDopo || null, esito: esito || null, prossima_azione: pa || null, prossima_azione_at: paAt || null, chi: who }, 'Tocco registrato.', diciT).then((ok) => { if (!ok) return; setSubject(''); setBody(''); setEsito(''); setStageDopo(''); setPa(''); setPaAt(''); });

  // modo risposta: chi ci ha scritto riceve la risposta dal cruscotto. La preparazione (destinatario, oggetto, thread) e'
  // la stessa regola della edge; riempie i campi una volta sola, poi i campi sono della persona.
  const ciHaScrittoOra = negozioCiHaScritto(touches ?? []);
  // Gate Fable (15-10, B): il ripiego e' solo email_generica, che la edge conosce; email_sito no (verrebbe rifiutata)
  const prep = touches ? rispostaPreparata(touches, r.nome, r.email_generica ?? '') : null;
  // si risponde solo a chi ci ha scritto e si puo' contattare (la edge rifiuta il resto); invio e prova vogliono anche aiOn
  const puoRispondere = !!touches && ciHaScrittoOra && r.lead_stage !== 'opt_out' && r.lead_stage !== 'chiuso_no' && r.n_opt_out === 0;
  useEffect(() => {
    if (!prep || rPronto) return;
    setRTo(prep.to); setROggetto(prep.oggetto); setRTesto(`\n\n${firma}`); setRPronto(true);
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [touches, rPronto]);
  const avvisiR = avvisiTesto(rTesto);
  const residuiR = segnaposto(`${rOggetto}\n${rTesto}`);
  const toInternoR = indirizzoInterno(rTo);
  const testoVuotoR = !rTesto.trim() || rTesto.trim() === firma.trim();
  const proposta = propostaSalvata(drafts);
  const stantia = proposta ? propostaStantia(proposta.created_at, touches ?? []) : null;
  const giaRisp = giaRisposto(touches ?? []);
  const conv = useMemo(() => ordinaConversazione(touches ?? []), [touches]);
  // v15: le proposte dalla conversazione (edge proponi_risposta). Generare non spedisce: nasce una riga 'proposta'.
  const proponi = async () => {
    setAiBusy(true); dire(''); setSendOpen(false);
    try {
      const p = await proponiRisposta({ account_id: r.id, chi: who });
      const a = p.alternative[0];
      setOptions(p.alternative); setSelIdx(0); setRTesto(a?.testo ?? ''); setNonGrounded(a?.non_grounded ?? []); setTroncata(!!a?.troncata);
      setRDraftId(p.draft_id); setRKey(crypto.randomUUID()); setRefineTxt('');
      if (!rToccato) { if (p.to) setRTo(p.to); if (p.oggetto) setROggetto(p.oggetto); setRPronto(true); }
      dire(p.alternative.length > 1 ? `${p.alternative.length} proposte dalla conversazione: scegline una, ritoccala e invia.` : 'Proposta pronta: rileggila, ritoccala e invia.');
      setDrafts(await fetchDrafts(r.id));
    } catch (e) { dire((e as Error).message, true); }
    setAiBusy(false);
  };
  const scegli = (i: number) => { const a = options?.[i]; if (!a) return; setSelIdx(i); setRTesto(a.testo); setNonGrounded(a.non_grounded ?? []); setTroncata(!!a.troncata); };
  // "chiedi una modifica": il testo del box riscritto con l'istruzione, in entrambi i modi; fa fede il box all'invio
  const rifinisci = async () => {
    const corrente = modo === 'risposta' ? rTesto : testo;
    if (!modo || !corrente.trim() || !refineTxt.trim()) return;
    setRefining(true); dire('');
    try {
      const res = await rifinisciTesto({ account_id: r.id, testo: corrente, istruzione: refineTxt, modo, chi: who, ...(modo === 'sequenza' ? { lingua: codice.endsWith('_en') ? 'en' as const : 'it' as const } : {}) });
      if (modo === 'risposta') { setRTesto(res.testo); setNonGrounded(res.non_grounded ?? []); setTroncata(!!res.troncata); }
      else { setTesto(res.testo); setAvvisi(res.avvisi ?? []); setSNonGrounded(res.non_grounded ?? []); if (res.troncata) dire('La modifica risulta tagliata a metà: controlla la fine del testo.', true); }
      setRefineTxt('');
    } catch (e) { dire((e as Error).message, true); }
    setRefining(false);
  };
  const inviaRisp = async () => {
    setRBusy(true); setSendErr('');
    try {
      const res = await inviaRisposta({ account_id: r.id, to: rTo, oggetto: rOggetto, testo: rTesto, send_key: rKey, chi: who, draft_id: rDraftId });
      setRKey(crypto.randomUUID()); setRTesto(`\n\n${firma}`); setRPronto(false); setRToccato(false);
      setOptions(null); setRDraftId(null); setNonGrounded([]); setTroncata(false); setSendOpen(false); setIncertoMsg('');
      dire(`${res.already_sent ? 'Già inviata prima' : 'Risposta inviata'} a ${res.to}${res.from ? ` da ${res.from}` : ''}${res.already_sent ? '' : res.nel_thread ? ', nel thread della conversazione' : ', come email nuova'}. Prossima azione: attesa risposta fra 5 giorni.${res.warnings?.length ? ' Attenzione: ' + res.warnings.join(' ') : ''}${await ricarica()}`);
    } catch (e) {
      const err = e as Error & { incerto?: boolean; bloccante?: boolean; codice?: string };
      // un esito incerto tiene la chiave: ripremere non deve far ripartire l'email finche' non si guarda Posta inviata
      if (!err.incerto) setRKey(crypto.randomUUID());
      if (err.incerto) setIncertoMsg(err.message);
      // la edge dice con un `codice` cosa e' successo alla proposta (mai dedotto dal testo): superata o scartata = il testo
      // nel box resta della persona, che lo rimanda senza proposta; partita, o una risposta partita dopo = si ricarica
      if (err.codice === 'proposta_superata') {
        setRDraftId(null); setOptions(null);
        setSendErr(err.message + ' Premi di nuovo “Invia adesso” per mandare il testo così com’è.');
        void reload().catch(() => undefined);   // l'avviso "gia' inviata una risposta" della finestra deve vedere cio' che e' partito intanto
      } else {
        setSendErr(err.message);
        if (err.bloccante) setSendBloccato(true);
      }
      if (err.codice === 'proposta_partita' || err.codice === 'proposta_dopo_risposta') void reload().catch(() => undefined);
    }
    setRBusy(false);
  };
  const provaRisp = async () => {
    setRProvaBusy(true); dire('');
    try {
      const res = await inviaProva({ oggetto: rOggetto, testo: rTesto });
      dire(`Prova inviata a ${res.to}: la trovi in Posta in arrivo con “[PROVA]” nell’oggetto. Non conta come invio.`);
    } catch (e) { dire((e as Error).message, true); }
    setRProvaBusy(false);
  };

  const pannelloCollega = (touchId: string) => collega?.touchId === touchId && (
    <div className="or-collega" aria-live="polite">
      {collega.stato === 'carico' && <p className="muted">Cerco in Posta inviata di info@…</p>}
      {collega.stato !== 'carico' && collega.nota && <p className={collega.stato === 'errore' ? 'err' : 'note'}>{collega.nota}</p>}
      {collega.stato === 'pronto' && collega.candidati.length > 0 && <>
        <p className="note">Quale di queste email hai registrato? Scegli quella giusta: le risposte a quella entreranno in conversazione.</p>
        {collega.candidati.map((c) => <div key={c.gmail_message_id} className="row"><div><div className="rt">{c.oggetto || '(senza oggetto)'}</div><div className="rs">{fmtDT(c.data)} · a {c.a}</div></div><button type="button" className="ds-btn" disabled={busy} onClick={() => void collegaA(touchId, c.gmail_message_id)}>Collega</button></div>)}
      </>}
      {collega.stato !== 'carico' && <button type="button" className="or-link" disabled={busy} onClick={() => void apriCollega(touchId)} style={{ marginRight: 12 }}>Cerca di nuovo</button>}<button type="button" className="or-link" disabled={busy} onClick={() => setCollega(null)}>Chiudi</button>
    </div>
  );

  // v11 (A4): a un negozio che ci ha gia' scritto "Segna come inviata" non registra un tocco della sequenza a freddo
  const segnaInviata = () => {
    const canaleT = seq?.canale ?? 'email';
    const next = sequences.find((s) => s.codice === codice && s.tocco === tocco + 1 && s.canale === 'email');
    const d = dopoInvioManuale({ ciHaScritto: negozioCiHaScritto(touches ?? []), email: canaleT === 'email', tocco, prossimo: next ? { tocco: next.tocco, giorni_attesa: next.giorni_attesa } : null, oggi: new Date() });
    return save({ account_id: r.id, canale: canaleT, direzione: 'out', subject: oggetto || null, body_clean: testo, stage_prima: r.lead_stage, stage_dopo: r.lead_stage === 'da_contattare' ? 'contattato' : null, sequenza_tocco: d.sequenza_tocco, prossima_azione: d.prossima_azione, prossima_azione_at: d.prossima_azione_at, chi: who }, d.messaggio, dire).then((id) => {
      if (!id) return;
      if (d.avanzaTocco) setTocco((t) => Math.min(4, t + 1));
      // subito dopo la registrazione si sceglie l'email partita da Gmail, cosi' il giro ne legge le risposte
      if (canaleT === 'email' && aiOn) void apriCollega(id);
    });
  };
  const sposta = () => moveTo && save({ account_id: r.id, canale: 'altro', direzione: 'out', body_clean: `Spostato a "${STAGE_LABEL[moveTo]}" da ${who}`, stage_prima: r.lead_stage, stage_dopo: moveTo, chi: who }, `Spostato in ${STAGE_LABEL[moveTo]}.`).then((ok) => { if (ok) setMoveTo(''); });
  const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}&su=${encodeURIComponent(oggetto)}&body=${encodeURIComponent(testo)}`;
  const copia = async () => {
    const t = modo === 'risposta' ? `${rOggetto ? rOggetto + '\n\n' : ''}${rTesto}` : `${oggetto ? oggetto + '\n\n' : ''}${testo}`;
    try { await navigator.clipboard.writeText(t); dire('Testo copiato.'); } catch { dire('Copia non riuscita: seleziona e copia a mano.', true); }
  };
  const cambiaModo = (m: 'risposta' | 'sequenza') => { setModo(m); setCmsg(null); setRefineTxt(''); setSendOpen(false); setApertura(''); setIncertoMsg(''); };
  const openSend = () => { setSendErr(''); setSendBloccato(false); setSendOpen(true); };

  const contatto = r.email_generica ?? r.email_sito ?? '';
  const tel = r.telefono ?? r.telefono_maps ?? '';
  const testoBox = modo === 'risposta' ? rTesto : testo;
  const refineBox = (
    <div className="cs-refine">
      <input className="cs-refine-in" value={refineTxt} onChange={(e) => setRefineTxt(e.target.value)} placeholder="Chiedi una modifica all’AI (es. più breve, proponi martedì)" onKeyDown={(e) => { if (e.key === 'Enter') void rifinisci(); }} disabled={refining} />
      <button className="cs-btn cs-ghost" type="button" onClick={() => void rifinisci()} disabled={refining || !refineTxt.trim() || !testoBox.trim()}>{refining ? '…' : '✨ Applica'}</button>
    </div>
  );
  // riga compatta della conversazione: telefonate, visite, Instagram, note, spostamenti di stadio, bounce e automatiche
  const notaRiga = (t: ElementoConv) => {
    const automatica = t.direzione === 'in' && NON_CONVERSAZIONE.includes(t.esito ?? '');
    const spostato = /^Spostato a /.test(t.testo);
    const icona = automatica ? '⚠️' : spostato ? '↪' : ICONA_NOTA[t.canale] ?? '📝';
    const parti = [
      spostato ? null : automatica ? (ESITI.find((e) => e.key === t.esito)?.label ?? t.esito) : `${CANALI[t.canale] ?? t.canale}${t.direzione === 'in' ? ' ricevuta' : ''}`,
      fmtDT(t.at), t.chi,
      !automatica && t.esito ? (ESITI.find((e) => e.key === t.esito)?.label ?? t.esito) : null,
      !spostato && t.stage_dopo ? `→ ${STAGE_LABEL[t.stage_dopo] ?? t.stage_dopo}` : null,
      t.prossima_azione || t.prossima_azione_at ? `prossima: ${t.prossima_azione ?? ''} ${t.prossima_azione_at ? fmtD(t.prossima_azione_at) : ''}`.trim() : null,
    ].filter(Boolean).join(' · ');
    const dettaglio = [t.subject, t.testo].filter(Boolean).join(': ');
    return (
      <div key={t.id} className="or-nota">
        <span className="or-nota-i" aria-hidden="true">{icona}</span>
        <span><span className="or-nota-h">{parti}</span>{dettaglio ? <span className="or-nota-t"> {dettaglio.length > 180 ? dettaglio.slice(0, 180) + '…' : dettaglio}</span> : null}</span>
      </div>
    );
  };
  const inviando = modo === 'risposta' ? rBusy : busy;
  const phModal = modo === 'risposta' ? residuiR : residui;
  const ngModal = modo === 'risposta' ? nonGrounded : sNonGrounded;

  return (
    <div className="screen">
      <header>
        <button className="lead-back" onClick={onBack} type="button">‹ Pipeline</button>
        <span className="badge" style={{ background: 'var(--interactive-700)', color: '#fff' }}>{STAGE_LABEL[r.lead_stage]}</span>
      </header>
      <div className="or-head">
        {r.thumb && urls[r.thumb] ? <img src={urls[r.thumb]} alt="" /> : <span className="or-thumb-empty big" />}
        <div>
          <h1 style={{ margin: 0 }}>{r.nome}</h1>
          <div className="muted">{[TIPO_LABEL[r.tipo] ?? r.tipo, r.citta, r.paese !== 'IT' ? r.paese : null, r.tier ? `Tier ${r.tier}` : r.tier_proposto ? `proposto ${r.tier_proposto}` : null, r.totale != null ? `score ${r.totale}` : null, r.follower != null ? `IG ${new Intl.NumberFormat('it-IT').format(r.follower)}` : null].filter(Boolean).join(' · ')}</div>
          <div className="lead-links" style={{ marginTop: 6 }}>
            {to && <a href={`mailto:${to}`}>{to}</a>}
            {(r.telefono ?? r.telefono_maps) && <span>{r.telefono ?? r.telefono_maps}</span>}
            {r.website && <a href={r.website} target="_blank" rel="noreferrer">sito</a>}
            {r.ig_handle && <a href={`https://www.instagram.com/${r.ig_handle}/`} target="_blank" rel="noreferrer">@{r.ig_handle}</a>}
            <button type="button" className="or-link" onClick={() => onOpenDossier(r.id)}>Apri il dossier ›</button>
          </div>
          {r.verdetto && <div className="note" style={{ marginTop: 4 }}><b>{VERDETTO_LABEL[r.verdetto]}</b>{r.verdetto_motivo ? `: ${r.verdetto_motivo}` : ''}</div>}
          {r.n_opt_out > 0 && <div className="err" style={{ marginTop: 4 }}>OPT-OUT registrato: non contattare.</div>}
        </div>
      </div>

      {/* INFO UTILI come in Assistenza: i fatti che servono mentre si scrive, richiudibili ma aperti */}
      <details className="cs-info" open>
        <summary><span className="cs-tri">▶</span> Info utili</summary>
        <div className="cs-facts">
          <div className={'cs-fact' + (r.scaduta || r.da_gestire ? ' warn' : '')}>
            <span className="fl">Prossima azione</span>
            <span className="fv">{r.da_gestire ? 'risposta da gestire' : r.prossima_azione ?? 'nessuna pianificata'}</span>
            <span className="fs">{[r.prossima_azione_at ? `${r.scaduta ? 'scaduta il' : 'entro il'} ${fmtD(r.prossima_azione_at)}` : null, r.owner_outreach ? `segue ${r.owner_outreach}` : null].filter(Boolean).join(' · ')}</span>
          </div>
          <div className="cs-fact">
            <span className="fl">Stadio</span>
            <span className="fv">{STAGE_LABEL[r.lead_stage]}</span>
            <div className="or-move" style={{ marginTop: 6 }}>
              <select value={moveTo} aria-label="Sposta in un altro stadio" onChange={(e) => setMoveTo(e.target.value)}><option value="">Sposta a…</option>{STAGES.map((s) => <option key={s.key} value={s.key} disabled={s.key === r.lead_stage}>{s.label}</option>)}</select>
              <button type="button" className="ds-btn" disabled={!moveTo || busy} onClick={sposta}>Sposta</button>
            </div>
          </div>
          <div className={'cs-fact' + (contatto || tel ? '' : ' warn')}>
            <span className="fl">Contatto</span>
            <span className="fv">{contatto ? <a href={`mailto:${contatto}`}>{contatto}</a> : tel ? <a href={`tel:${tel.replace(/[^\d+]/g, '')}`}>{tel}</a> : '⚠ nessuno'}</span>
            <span className="fs">{contatto && tel ? tel : r.ig_handle ? `@${r.ig_handle}` : contatto || tel ? '' : 'cercare email o telefono'}</span>
          </div>
          {r.verdetto && <div className="cs-fact">
            <span className="fl">Verdetto</span>
            <span className="fv">{VERDETTO_LABEL[r.verdetto] ?? r.verdetto}</span>
            <span className="fs">{r.verdetto_motivo ?? ''}</span>
          </div>}
          <div className="cs-fact">
            <span className="fl">{r.tier ? 'Tier' : 'Score'}</span>
            <span className="fv">{r.tier ? `Tier ${r.tier}` : r.tier_proposto ? `proposto ${r.tier_proposto}` : r.totale != null ? String(r.totale) : 'n.d.'}</span>
            <span className="fs">{[r.tier && r.totale != null ? `score ${r.totale}` : null, r.follower != null ? `IG ${new Intl.NumberFormat('it-IT').format(r.follower)}` : null].filter(Boolean).join(' · ')}</span>
          </div>
          {linesheet ? (
            <a className="cs-fact link" href={linesheet} target="_blank" rel="noreferrer">
              <span className="fl">Line sheet</span>
              <span className="fv">Apri ↗</span>
              <span className="fs">{linesheet.replace(/^https?:\/\//, '').slice(0, 60)}</span>
            </a>
          ) : (
            <div className="cs-fact warn">
              <span className="fl">Line sheet</span>
              <span className="fv">⚠ manca</span>
              <span className="fs">da impostare (lead_linesheet_url nelle impostazioni)</span>
            </div>
          )}
          {r.gancio && <div className="cs-fact" style={{ flexBasis: '100%' }}>
            <span className="fl">Gancio dal dossier</span>
            <span className="fv" style={{ fontWeight: 500, fontStyle: 'italic' }}>{r.gancio}</span>
          </div>}
        </div>
      </details>
      <div className="or-esito" aria-live="polite">{msg && <div className={msg.err ? 'err' : 'note'} style={{ margin: '4px 0' }}>{msg.t}</div>}</div>

      {/* CONVERSAZIONE: bolle in ordine cronologico (la piu' vecchia in alto), note in riga compatta */}
      {touches && conv.length > 0 && <div className="ds-seclb" style={{ marginTop: 12 }}>Conversazione</div>}
      {!touches ? (convErr ? <p className="err" style={{ marginTop: 12 }}>Conversazione non caricata: {convErr} <button type="button" className="or-link" disabled={aiBusy || busy || refining} onClick={apriScheda}>↻ Riprova</button></p> : <p className="muted" style={{ marginTop: 12 }}>Carico la conversazione…</p>) : !conv.length ? <p className="muted" style={{ marginTop: 12 }}>Nessun messaggio ancora: il primo lo scrivi qui sotto.</p> : (
        <div className="or-conv">{conv.map((t) => t.tipo === 'nota' ? notaRiga(t) : (
          <div key={t.id} className={'cs-msg ' + (t.direzione === 'out' ? 'out' : 'in')}>
            <div className="cs-mh">{(t.direzione === 'out' ? `${fmtDT(t.at)} · ${t.chi || 'Amimì'}${t.sequenza_tocco != null ? ` · tocco ${t.sequenza_tocco}` : ''}` : `${r.nome}${t.mittente ? ` · ${t.mittente}` : ''} · ${fmtDT(t.at)}`) + (t.esito ? ` · ${ESITI.find((e) => e.key === t.esito)?.label ?? t.esito}` : '') + (t.stage_dopo ? ` → ${STAGE_LABEL[t.stage_dopo] ?? t.stage_dopo}` : '')}</div>
            <div className="cs-mb">
              {t.subject && <div style={{ fontWeight: 700, marginBottom: 4 }}>{t.subject}</div>}
              <div className="cs-body">{t.testo || (t.subject ? '' : '(vuoto)')}</div>
            </div>
            {(t.prossima_azione || t.prossima_azione_at) && <div className="cs-mh" style={{ marginTop: 3 }}>prossima: {t.prossima_azione ?? ''} {t.prossima_azione_at ? fmtD(t.prossima_azione_at) : ''}</div>}
            {aiOn && t.direzione === 'out' && t.canale === 'email' && !t.gmail_thread_id && collega?.touchId !== t.id && <button type="button" className="or-link" disabled={busy} onClick={() => void apriCollega(t.id)}>Collega a Gmail</button>}{aiOn && t.direzione === 'out' && t.canale === 'email' && !t.gmail_thread_id && collega?.touchId !== t.id && <span className="muted" style={{ fontSize: 11 }}> (senza, il giro automatico non legge le risposte a questa email)</span>}
            {pannelloCollega(t.id)}
          </div>
        ))}</div>
      )}
      {/* Gate Fable (15-10, B): se la conversazione non si e' ricaricata dopo "Segna come inviata", il tocco nuovo non c'e'
          ancora: la scelta dell'email si mostra lo stesso, qui sotto */}
      {collega && touches && !touches.some((t) => t.id === collega.touchId) && pannelloCollega(collega.touchId)}

      {/* IL COMPOSITORE, uno solo: risposta alla conversazione o sequenza a freddo */}
      <div className="cs-draftbox or-comp">
        <div className="cs-seg" role="group" aria-label="Modo del compositore" style={{ marginBottom: 8 }}>
          <button type="button" className={'cs-seg-btn' + (modo === 'risposta' ? ' on' : '')} aria-pressed={modo === 'risposta'} disabled={!modo} onClick={() => cambiaModo('risposta')}>Rispondi</button>
          <button type="button" className={'cs-seg-btn' + (modo === 'sequenza' ? ' on' : '')} aria-pressed={modo === 'sequenza'} disabled={!modo} onClick={() => cambiaModo('sequenza')}>Sequenza a freddo</button>
        </div>
        {apertura && <div className="cs-note" style={{ textAlign: 'left', margin: '0 0 8px' }}>{apertura}</div>}
        {modo === 'sequenza' && ciHaScrittoOra && <div className="cs-note" style={{ textAlign: 'left', margin: '0 0 8px' }}>Questo negozio ci ha già scritto: un’email della sequenza conta come tocco (fino a 4), rientra nel tetto giornaliero e porta la riga di opt-out. Per rispondere alla conversazione usa “Rispondi”.</div>}
        {modo === 'risposta' && !touches && convErr && <div className="cs-lint" style={{ marginBottom: 8 }}>Conversazione non caricata: riprova a caricarla (qui sopra) prima di rispondere. Proposta e invio restano fermi.</div>}
        {modo === 'risposta' && touches && !puoRispondere && <div className="cs-lint" style={{ marginBottom: 8 }}>{!ciHaScrittoOra ? 'Questo negozio non ci ha mai scritto: la risposta non si può né proporre né inviare (il primo contatto passa dalla sequenza a freddo, con verdetto, tetto e riga di opt-out).' : 'Negozio in opt-out o chiuso: non si contatta.'}</div>}
        {!modo && <p className="muted">Preparo il compositore…</p>}

        {modo === 'risposta' && (
          <>
            {/* proposta gia' salvata: si DICHIARA e si lascia scegliere (caricarla d'ufficio cambierebbe il testo sotto gli
                occhi; rigenerare costa una chiamata al modello). Se dopo e' successo qualcosa lo si dice. */}
            {aiRispostaOn && !options && proposta && (
              <div className={stantia?.scrittoDopo || stantia?.rispostoDopo ? 'cs-lint' : 'cs-note'} style={{ textAlign: 'left', marginBottom: 8 }}>
                <b>C’è già una proposta</b> del {fmtDT(proposta.created_at)}{proposta.chi ? ` (${proposta.chi})` : ''}.
                {stantia?.scrittoDopo && <div style={{ marginTop: 4 }}>⚠️ Dopo quella proposta il negozio ha scritto di nuovo: rigenera, o risponderai a un messaggio vecchio.</div>}
                {!stantia?.scrittoDopo && stantia?.rispostoDopo && <div style={{ marginTop: 4 }}>⚠️ Dopo quella proposta è già partita una risposta: controlla la conversazione prima di usarla.</div>}
                <div style={{ marginTop: 6, display: 'flex', gap: 8, flexWrap: 'wrap' }}><button className="cs-btn cs-ghost" type="button" onClick={() => apriProposta(proposta)}>↩ Riprendi</button><button className="cs-btn cs-ghost" type="button" disabled={busy} onClick={() => void scartaProposta(proposta.id)}>Scarta</button></div>
              </div>
            )}
            {aiRispostaOn
              ? (!options && <button className="cs-btn cs-primary" style={{ width: '100%' }} type="button" disabled={aiBusy || !puoRispondere} onClick={() => void proponi()}>{aiBusy ? 'Propongo…' : '✍️ Proponi le risposte dalla conversazione'}</button>)
              : <div className="cs-note" style={{ textAlign: 'left', marginBottom: 8 }}>Proposte AI spente (impostazione lead_risposta_ai_enabled): scrivi la risposta qui sotto.</div>}
            {options && options.length > 1 && (
              <div className="cs-opts" style={{ marginTop: 8 }}>
                {options.map((o, i) => (
                  <button key={i} className={'cs-opt' + (i === selIdx ? ' on' : '')} onClick={() => scegli(i)} type="button">
                    <span className="cs-opt-t">{o.titolo || `Alternativa ${i + 1}`}</span>
                    <span className="cs-opt-p">{o.testo.slice(0, 90)}{o.testo.length > 90 ? '…' : ''}</span>
                  </button>
                ))}
              </div>
            )}
            {options && options.length === 1 && <div className="cs-note">Una sola risposta possibile: i fatti bastano a decidere, non ci sono esiti alternativi da scegliere.</div>}
            {troncata && <div className="cs-note">⚠ La proposta scelta risulta tagliata a metà: rigenera o completala a mano prima di inviare.</div>}
            <div className="cs-draft-h" style={{ marginTop: 10 }}>
              <span>✍️ Risposta (ritoccala o chiedi una modifica)</span>
              {residuiR.length > 0 && <span className="cs-badge cs-warn">{residuiR.length} da verificare</span>}
              {nonGrounded.length > 0 && <span className="cs-badge cs-urg">⚠ {nonGrounded.length} non nei fatti</span>}
            </div>
            <div className="cs-fld"><label htmlFor="or-r-to">Destinatario</label><input id="or-r-to" type="email" value={rTo} onChange={(e) => { setRTo(e.target.value.trim()); setRToccato(true); }} placeholder="chi ci ha scritto, o l’email del negozio" /></div>
            <div className="cs-fld"><label htmlFor="or-r-oggetto">Oggetto</label><input id="or-r-oggetto" value={rOggetto} onChange={(e) => { setROggetto(e.target.value); setRToccato(true); }} /></div>
            <textarea className="cs-draft-ta" rows={8} aria-label="Risposta" value={rTesto} onChange={(e) => setRTesto(e.target.value)} placeholder="Scrivi qui la risposta, o fatti proporre le alternative dalla conversazione" />
            {avvisiR.length > 0 && <div className="cs-lint">⚠️ <b>Da controllare</b>: {avvisiR.join(' · ')}</div>}
            {nonGrounded.length > 0 && (
              <div className="cs-lint">⚠️ <b>Controlla questi dati</b>: l’AI li ha scritti ma NON risultano dalla conversazione né dal dossier: {nonGrounded.map((x, i) => <span key={i} className="cs-lint-t">{x}</span>)}</div>
            )}
            {residuiR.length > 0 && <p className="cs-note" style={{ textAlign: 'left' }}>Prima di inviare completa: {residuiR.slice(0, 4).join(' ')}</p>}
            {toInternoR && <p className="cs-note" style={{ textAlign: 'left' }}>Gli indirizzi @amimi.it non ricevono l’invio vero: usa “Prova a me”.</p>}
            {touches && puoRispondere && !rTo && <p className="cs-note" style={{ textAlign: 'left' }}>Manca il destinatario.</p>}
            {touches && puoRispondere && !rOggetto.trim() && <p className="cs-note" style={{ textAlign: 'left' }}>Manca l’oggetto.</p>}
            {aiRispostaOn && refineBox}
            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              <button className="cs-btn cs-primary" type="button" disabled={rBusy || rProvaBusy || busy || !aiOn || !puoRispondere || !rTo || toInternoR || residuiR.length > 0 || testoVuotoR || !rOggetto.trim()} onClick={openSend}>✉️ Invia…</button>
              <button className="cs-btn cs-ghost" type="button" disabled={rBusy || rProvaBusy || !aiOn || !rOggetto.trim() || testoVuotoR} onClick={() => void provaRisp()}>{rProvaBusy ? 'Mando la prova…' : 'Prova a me'}</button>
              <button className="cs-btn cs-ghost" type="button" onClick={() => void copia()}>📋 Copia</button>
              {aiRispostaOn && options && <button className="cs-btn cs-ghost" type="button" disabled={aiBusy || !puoRispondere} onClick={() => void proponi()}>{aiBusy ? '…' : '↻ Rigenera'}</button>}
            </div>
            {!aiOn && <p className="cs-note" style={{ textAlign: 'left' }}>Invio e prova dall’app spenti (impostazione lead_outreach_ai_enabled): copia la risposta e mandala dal thread in Gmail.</p>}
            <div className="cs-note" style={{ textAlign: 'left' }}>La risposta va nel thread della conversazione, non conta nel tetto giornaliero e non serve la riga di opt-out. Parte da {LEAD_MITTENTE} solo dopo la tua conferma.</div>
          </>
        )}

        {modo === 'sequenza' && (
          <>
            {/* una bozza della sequenza gia' salvata si DICHIARA, come la proposta nel modo risposta e come in Assistenza */}
            {!draftId && (() => { const b = drafts.find((d) => d.sequenza_tocco != null && d.stato === 'proposta'); return b ? (
              <div className="cs-note" style={{ textAlign: 'left', marginBottom: 8 }}><b>C’è già una bozza</b> del tocco {b.sequenza_tocco} ({fmtDT(b.created_at)}{b.origine === 'auto' ? ', automatica' : b.chi ? `, ${b.chi}` : ''}). <button className="cs-btn cs-ghost" type="button" disabled={busy} onClick={() => apriBozza(b)}>↩ Riprendi</button></div>
            ) : null; })()}
            <div className="or-form">
              <label>Sequenza<select value={codice} onChange={(e) => { setCodice(e.target.value); setCmsg(null); }}>{[...new Set(sequences.map((s) => s.codice))].map((c) => <option key={c} value={c}>{c === 'boutique_it' ? 'Boutique · italiano' : c === 'boutique_en' ? 'Boutique · English' : c}</option>)}</select></label>
              <label>Tocco<select value={tocco} disabled={!!draftId} title={draftId ? 'La bozza aperta è di questo tocco: per cambiarlo torna al template' : undefined} onChange={(e) => { setTocco(Number(e.target.value)); setCmsg(null); }}>{sequences.filter((s) => s.codice === codice).map((s) => <option key={s.tocco} value={s.tocco}>{s.tocco === 0 ? '0 · telefonata' : `${s.tocco} · ${s.canale}${s.giorni_attesa ? ` (+${s.giorni_attesa} gg)` : ''}`}</option>)}</select></label>
              <label className="wide">Referente (nome)<input value={referente} onChange={(e) => setReferente(e.target.value)} placeholder={`es. Valentina (vuoto: si scrive al team di ${r.nome})`} /></label>
            </div>
            <div className="cs-draft-h">
              <span>✍️ {draftId ? `Bozza AI del tocco ${tocco} (ritoccala o chiedi una modifica)` : seq?.canale === 'telefono' ? 'Traccia della telefonata' : `Testo del tocco ${tocco} dal template`}</span>
              {residui.length > 0 && <span className="cs-badge cs-warn">{residui.length} da verificare</span>}
              {avvisi.length > 0 && <span className="cs-badge cs-urg">⚠ {avvisi.length} da controllare</span>}
              {sNonGrounded.length > 0 && <span className="cs-badge cs-urg">⚠ {sNonGrounded.length} non nei fatti</span>}
            </div>
            {seq?.canale === 'email' && <div className="cs-fld"><label htmlFor="or-s-to">Destinatario</label><input id="or-s-to" type="email" value={to} onChange={(e) => setTo(e.target.value.trim())} placeholder="email del negozio" /></div>}
            {(oggetto !== '' || seq?.canale === 'email') && <div className="cs-fld"><label htmlFor="or-s-oggetto">Oggetto</label><input id="or-s-oggetto" value={oggetto} onChange={(e) => setOggetto(e.target.value)} /></div>}
            <textarea className="cs-draft-ta" rows={12} aria-label="Testo" value={testo} onChange={(e) => setTesto(e.target.value)} />
            {avvisi.length > 0 && <div className="cs-lint">⚠️ <b>Da controllare</b>: {avvisi.join(' · ')}</div>}
            {sNonGrounded.length > 0 && (
              <div className="cs-lint">⚠️ <b>Controlla questi dati</b>: l’AI li ha scritti ma NON risultano dal dossier né dalla conversazione: {sNonGrounded.map((x, i) => <span key={i} className="cs-lint-t">{x}</span>)}</div>
            )}
            {residui.length > 0 && <p className="cs-note" style={{ textAlign: 'left' }}>Prima di inviare completa: {residui.slice(0, 4).join(' ')}</p>}
            {toInterno && <p className="cs-note" style={{ textAlign: 'left' }}>Gli indirizzi @amimi.it non ricevono l’invio vero, che va solo ai negozi. Per vedere l’email nella tua casella usa “Prova a me”.</p>}
            {aiRispostaOn && seq?.canale === 'email' && refineBox}
            <div className="cs-note" style={{ textAlign: 'left', marginTop: 8 }}>{draftId ? 'Bozza scritta dall’AI dal dossier e dal template approvato: è una proposta, rileggila tutta.' : 'Riempito dal template con nome, gancio del dossier e firma.'} Le parti fra parentesi quadre vanno sistemate a mano prima di inviare. Tetto invii: {settings.lead_tetto_giornaliero ?? '20'} al giorno.</div>
            {aiOn ? (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {draftId && <button className="cs-btn cs-primary" type="button" disabled={busy || provaBusy || !to || toInterno || residui.length > 0 || r.n_opt_out > 0 || aiBusy} onClick={openSend}>✉️ Invia…</button>}
                <button className={draftId ? 'cs-btn cs-ghost' : 'cs-btn cs-primary'} type="button" disabled={aiBusy || busy || seq?.canale !== 'email'} onClick={() => void bozzaAI()}>{aiBusy ? 'Scrivo la bozza…' : draftId ? '↻ Rigenera bozza AI' : `✨ Bozza con l’AI (tocco ${tocco})`}</button>
                {seq?.canale === 'email' && <button className="cs-btn cs-ghost" type="button" disabled={busy || aiBusy || provaBusy || !oggetto.trim() || !testo.trim()} title="Manda questo testo alla tua casella, con [PROVA] nell’oggetto: non conta come invio" onClick={() => void prova()}>{provaBusy ? 'Mando la prova…' : 'Prova a me'}</button>}
                <button className="cs-btn cs-ghost" type="button" onClick={() => void copia()}>📋 Copia</button>
                {draftId && <button className="cs-btn cs-ghost" type="button" disabled={busy} onClick={() => { setSNonGrounded([]); setDraftId(null); setAvvisi([]); setCmsg(null); setApertura(''); setIncertoMsg(''); }}>Torna al template</button>}
                {draftId && <button className="cs-btn cs-ghost" type="button" disabled={busy} onClick={() => void scarta()}>Scarta bozza</button>}
              </div>
            ) : <p className="cs-note" style={{ textAlign: 'left' }}>Bozza AI e invio dall’app spenti (impostazione lead_outreach_ai_enabled). Per ora: template, Gmail e “Segna come inviata”.</p>}
            {!draftId && <div className="lead-actions" style={{ marginTop: 8 }}>
              {seq?.canale === 'email' && to && <a className="ds-btn" href={gmailUrl} target="_blank" rel="noreferrer">Apri in Gmail</a>}
              {!aiOn && <button type="button" className="ds-btn" onClick={() => void copia()}>Copia testo</button>}
              {/* secondaria (bordo, non pieno): registra un invio fatto altrove, non lo esegue */}
              <button type="button" className="ds-btn" disabled={busy || !testo || !touches} style={{ color: 'var(--positive-700)', borderColor: 'var(--positive-700)' }} onClick={segnaInviata}>{seq?.canale === 'telefono' ? 'Segna come fatta' : 'Segna come inviata'}</button>
            </div>}
            {!to && seq?.canale === 'email' && <p className="cs-note" style={{ textAlign: 'left' }}>Nessuna email in anagrafica: “Apri in Gmail” compare quando c’è un destinatario.</p>}
          </>
        )}
        {incertoMsg && <div className="cs-lint" style={{ marginTop: 8 }}>⚠️ {incertoMsg} Ripremere “Invia…” riusa la stessa chiave: l’email non parte due volte.</div>}
        {/* contenitore sempre montato: una regione live che compare gia' piena spesso non viene letta */}
        <div className="or-esito" aria-live="polite">{cmsg && <div className={cmsg.err ? 'err' : 'note'} style={{ marginTop: 8 }}>{cmsg.t}</div>}</div>

        {/* finestra di conferma: destinatario, mittente, come parte e i warning SEMPRE in vista (come in Assistenza) */}
        {sendOpen && modo && (
          <div className="cs-sendwrap" role="dialog" aria-modal="true" aria-label="Conferma invio" tabIndex={-1} onKeyDown={(e) => { if (e.key === 'Escape' && !inviando) setSendOpen(false); }}>
            <div className="cs-sendmodal">
              <div className="cs-send-h">{`✉️ Inviare adesso da ${LEAD_MITTENTE}?`}</div>
              <div className="cs-send-row"><span className="k">A</span><b>{modo === 'risposta' ? rTo : to}</b></div>
              <div className="cs-send-row"><span className="k">Da</span><span>{LEAD_MITTENTE} · firma {who}</span></div>
              <div className="cs-send-row"><span className="k">Oggetto</span><span>{modo === 'risposta' ? rOggetto : oggetto}</span></div>
              <div className="cs-send-row"><span className="k">Come</span><span>{modo === 'risposta'
                ? (prep?.nelThread && prep.riferimento ? `nel thread di “${prep.riferimento.subject || '(senza oggetto)'}” del ${fmtDT(prep.riferimento.at)}` : 'email nuova (nessun thread Gmail da riprendere)')
                : `sequenza a freddo · tocco ${tocco} di 4 · email nuova con la riga di opt-out`}</span></div>
              {modo === 'risposta' && giaRisp && (
                <div className="cs-lint" style={{ marginTop: 10 }}>⚠️ A questo negozio risulta <b>già inviata una risposta</b> il {fmtDT(giaRisp)}, e da allora il negozio non ha più scritto. Se è un secondo invio voluto va bene, altrimenti annulla.</div>
              )}
              {(phModal.length > 0 || ngModal.length > 0) && (
                <div className="cs-lint" style={{ marginTop: 10 }}>
                  {phModal.length > 0 && <div>⚠️ Nel testo ci sono ancora <b>{phModal.length} segnaposto</b>: {phModal.map((x, i) => <span key={i} className="cs-lint-t">{x}</span>)}</div>}
                  {ngModal.length > 0 && <div style={{ marginTop: phModal.length > 0 ? 6 : 0 }}>⚠️ Dati NON nei fatti (dall’ultima generazione): {ngModal.map((x, i) => <span key={i} className="cs-lint-t">{x}</span>)}</div>}
                </div>
              )}
              <div className="cs-send-preview">{modo === 'risposta' ? rTesto : testo}</div>
              {sendErr && <div className="err" style={{ marginTop: 10 }}>{sendErr}</div>}
              {sendBloccato && <div className="cs-note" style={{ textAlign: 'left', marginTop: 8 }}>L’invio è stato rifiutato: ripremere darebbe lo stesso esito. Chiudi, sistema quello che dice l’errore e riprova.</div>}
              <div className="cs-send-actions">
                <button className="cs-btn cs-ghost" type="button" autoFocus disabled={inviando} onClick={() => setSendOpen(false)}>{sendBloccato ? 'Chiudi' : 'Annulla'}</button>
                {!sendBloccato && <button className="cs-btn cs-primary" type="button" disabled={inviando} onClick={() => void (modo === 'risposta' ? inviaRisp() : invia())}>{inviando ? 'Invio…' : '✓ Invia adesso'}</button>}
              </div>
            </div>
          </div>
        )}
      </div>

      {drafts.length > 0 && <details style={{ marginTop: 10 }}><summary style={{ cursor: 'pointer', fontSize: 13 }}>Bozze di questo negozio ({drafts.length})</summary><div className="list">{drafts.map((d) => {
        // una bozza della sequenza si riapre nel modo sequenza (mai una risposta: la edge rifiuta send senza tocco); una
        // proposta di risposta ancora aperta si riapre nel modo risposta con le sue alternative
        const apribileRisp = aiRispostaOn && d.sequenza_tocco == null && (d.stato === 'proposta' || d.stato === 'errore') && d.fatti_usati?.tipo === 'risposta' && d.id !== rDraftId;
        return <div key={d.id} className="row"><div><div className="rt">{d.sequenza_tocco != null ? `Tocco ${d.sequenza_tocco}` : d.fatti_usati?.tipo === 'risposta' ? 'Proposta di risposta' : 'Risposta'} · {d.stato}{d.origine === 'auto' ? ' · automatica' : ''}{d.sent_by ? ` · ${d.sent_by}` : d.chi ? ` · ${d.chi}` : ''}</div><div className="rs">{d.oggetto ?? ''}{d.errore ? ` · ${d.errore}` : ''}</div>{aiOn && d.sequenza_tocco != null && (d.stato === 'proposta' || d.stato === 'errore') && d.id !== draftId && <button type="button" className="or-link" disabled={busy} onClick={() => apriBozza(d)}>Apri</button>}{apribileRisp && <button type="button" className="or-link" disabled={busy} onClick={() => apriProposta(d)}>Apri</button>}{d.sequenza_tocco == null && (d.stato === 'proposta' || d.stato === 'errore') && <button type="button" className="or-link" disabled={busy} onClick={() => void scartaProposta(d.id)}>Scarta</button>}{d.stato === 'in_invio' && <button type="button" className="or-link" disabled={busy} onClick={async () => { if (!window.confirm('Hai controllato "Posta inviata" di info@amimi.it e questa email NON c’è? Solo in quel caso sbloccala.')) return; try { await sbloccaBozza({ draft_id: d.id, chi: who }); setIncertoMsg(''); dire('Bozza sbloccata: si può reinviare.'); await reload(); } catch (e) { dire((e as Error).message, true); } }}>Sblocca (esito incerto)</button>}</div><div className="muted" style={{ fontSize: 12 }}>{fmtD(d.sent_at ?? d.created_at)}</div></div>;
      })}</div></details>}

      <details style={{ marginTop: 10 }}>
        <summary style={{ cursor: 'pointer', fontSize: 13 }}>Registra un tocco (telefonata, visita, Instagram, nota)</summary>
        <div className="or-form" style={{ marginTop: 8 }}>
          <label>Canale<select value={canale} onChange={(e) => setCanale(e.target.value)}>{Object.entries(CANALI).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label>Direzione<select value={dir} onChange={(e) => setDir(e.target.value as 'in' | 'out')}><option value="out">Noi → loro</option><option value="in">Loro → noi</option></select></label>
          <label className="wide">Oggetto / titolo<input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="es. telefonata con Valentina" /></label>
          <label className="wide">Cosa ci siamo detti<textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Riassunto, o il testo della risposta ricevuta" /></label>
          <label>Esito<select value={esito} onChange={(e) => setEsito(e.target.value)}><option value="">nessuno</option>{ESITI.map((e) => <option key={e.key} value={e.key}>{e.label}</option>)}</select></label>
          <label>Stadio dopo<select value={stageDopo} onChange={(e) => setStageDopo(e.target.value)}><option value="">automatico</option>{STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select></label>
          <label>Prossima azione<input value={pa} onChange={(e) => setPa(e.target.value)} placeholder="es. mandare catalogo" /></label>
          <label>Entro il<input type="date" value={paAt} onChange={(e) => setPaAt(e.target.value)} min={today()} /></label>
        </div>
        <button type="button" className="ds-btn" disabled={busy} onClick={registra}>Registra ({who})</button>
        <div className="or-esito" aria-live="polite">{tmsg && <div className={tmsg.err ? 'err' : 'note'} style={{ marginTop: 8 }}>{tmsg.t}</div>}</div>
      </details>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
export function OutreachSequenze({ sequences, settings }: { sequences: LeadSequence[]; settings: Record<string, string> }) {
  const codici = [...new Set(sequences.map((s) => s.codice))].sort((a, b) => (a.endsWith('_it') ? -1 : b.endsWith('_it') ? 1 : a.localeCompare(b)));
  return (
    <>
      {codici.map((c) => (
        <section className="card" key={c}>
          <h2>{c === 'boutique_it' ? 'Sequenza boutique · italiano' : c === 'boutique_en' ? 'Sequenza boutique · English' : c}</h2>
          <div className="tablewrap"><table className="sortable">
            <thead><tr><th>Tocco</th><th>Quando</th><th>Canale</th><th>Oggetto</th><th>Chi</th></tr></thead>
            <tbody>{sequences.filter((s) => s.codice === c).map((s) => (
              <tr key={s.id}><td>{s.tocco}</td><td className="l">{s.tocco === 0 ? 'prima dell’email, se c’è un numero' : s.giorni_attesa ? `+${s.giorni_attesa} giorni dal precedente` : 'subito'}</td><td className="l">{CANALI[s.canale] ?? s.canale}</td><td className="l">{s.oggetto ?? 'n.d.'}</td><td className="l">{s.chi_default ?? ''}</td></tr>
            ))}</tbody>
          </table></div>
          {sequences.filter((s) => s.codice === c).map((s) => <details key={s.id} style={{ marginTop: 6 }}><summary style={{ cursor: 'pointer', fontSize: 13 }}>Testo del tocco {s.tocco}</summary><pre className="lead-pre" style={{ maxHeight: 300 }}>{s.corpo}</pre></details>)}
        </section>
      ))}
      <section className="card">
        <h2>Impostazioni</h2>
        <div className="list">
          <div className="row"><div className="rt">Casella</div><div className="rs">le email partono come {LEAD_MITTENTE} (alias della casella info@, con ripiego su info@ se l&#8217;alias non è attivo); le risposte nello stesso thread le legge il giro automatico</div></div>
          <div className="row"><div className="rt">Firma</div><div className="rs" style={{ whiteSpace: 'pre-line' }}>{settings.lead_firma ?? 'n.d.'}</div></div>
          <div className="row"><div className="rt">Tetto invii al giorno</div><div className="rs">{settings.lead_tetto_giornaliero ?? '20'}</div></div>
          <div className="row"><div className="rt">Modulo (flag)</div><div className="rs">lead_enabled = {settings.lead_enabled ?? 'false'}: {settings.lead_enabled === 'true' ? 'ogni 30 minuti il giro automatico legge le risposte dei negozi e, alla scadenza, scrive la bozza del follow-up nella Coda. L’invio resta sempre un tuo click.' : 'giro automatico spento: risposte e follow-up si registrano a mano. Acceso, legge le risposte e propone i follow-up in Coda (mai invii automatici).'}</div></div>
          <div className="row"><div className="rt">Regole</div><div className="rs">Massimo 4 tocchi email, poi stop. Opt-out onorato dal database (esito "Opt-out" su un tocco). Contatto 1:1 personalizzato, riga di opt-out in ogni email.</div></div>
        </div>
        <p className="note">I testi vivono nella tabella lead_sequences: per cambiarli, chiedi a Claude Code o modifica a DB. La firma e il tetto in app_flags (lead_firma, lead_tetto_giornaliero).</p>
      </section>
    </>
  );
}
