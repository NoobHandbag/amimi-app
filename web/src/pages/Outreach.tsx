import { useEffect, useMemo, useState } from 'react';
import { fetchTouches, addTouch, renderTemplate, STAGES, STAGE_LABEL, ESITI, VERDETTO_LABEL, TIPO_LABEL } from '../lib/leadApi';
import type { LeadOutreach, LeadTouch, LeadSequence } from '../lib/leadApi';

// Sezione Outreach (tappa 1 del PIANO_Outreach_CRM.md): pipeline per stadio, coda del giorno, scheda con
// timeline dei tocchi e compositore da template, sequenze. Nessun invio dall'app: le email si mandano da
// Gmail (bottone "Apri in Gmail") e si registrano con "Segna come inviata". Ogni azione = INSERT in lead_touches.

const fmtD = (iso: string | null | undefined) => { if (!iso) return ''; const d = new Date(iso); return isNaN(d.getTime()) ? iso.slice(0, 10) : d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' }); };
const fmtDT = (iso: string) => { const d = new Date(iso); return d.toLocaleString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); };
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const CANALI: Record<string, string> = { email: 'Email', telefono: 'Telefono', instagram_dm: 'Instagram DM', visita: 'Visita', altro: 'Altro' };

function Due({ r }: { r: LeadOutreach }) {
  if (r.da_gestire) return <span className="or-due late">risposta da gestire</span>;
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
        <div className={`ds-kpi ${risposti.length ? 'pos' : ''}`}><div className="v">{contattati.length ? `${Math.round((risposti.length / contattati.length) * 100)}%` : '—'}</div><div className="l">Tasso di risposta</div><div className="s">{risposti.length} su {contattati.length} contattati</div></div>
        <div className={`ds-kpi ${rows.some((r) => r.scaduta || r.da_gestire) ? 'neg' : ''}`}><div className="v">{rows.filter((r) => r.scaduta || r.da_gestire).length}</div><div className="l">Da fare oggi</div><div className="s">{rows.filter((r) => r.scaduta).length} scadute · {rows.filter((r) => r.da_gestire).length} risposte</div></div>
      </div>
      <div className="or-board">
        {cols.map((s) => { const list = rows.filter((r) => r.lead_stage === s.key); return (
          <div key={s.key} className="or-col">
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
export function OutreachCoda({ rows, onOpen }: { rows: LeadOutreach[]; onOpen: (id: string) => void }) {
  const risposte = rows.filter((r) => r.da_gestire);
  const scadute = rows.filter((r) => r.scaduta && !r.da_gestire);
  const inScadenza = rows.filter((r) => !r.scaduta && r.prossima_azione_at && r.prossima_azione_at <= addDays(2));
  const nuovi = rows.filter((r) => r.lead_stage === 'da_contattare' && !r.n_tocchi);
  const Row = ({ r, icon, what }: { r: LeadOutreach; icon: string; what: string }) => (
    <button type="button" className="or-row" onClick={() => onOpen(r.id)}>
      <span className="or-ico">{icon}</span>
      <span className="or-t"><b>{r.nome}</b><small>{what}</small></span>
      <span className="or-go">Apri ›</span>
    </button>
  );
  const empty = !risposte.length && !scadute.length && !inScadenza.length && !nuovi.length;
  return (
    <>
      {empty && <section className="card"><p className="muted">Niente da fare oggi. Bel lavoro.</p></section>}
      {risposte.length > 0 && <section className="card"><h2>Risposte da gestire · {risposte.length}</h2><div className="or-list">{risposte.map((r) => <Row key={r.id} r={r} icon="📩" what={`${CANALI[r.ultimo_canale ?? ''] ?? ''} ricevuta ${fmtD(r.ultimo_tocco_at)}${r.ultimo_esito ? ` · ${ESITI.find((e) => e.key === r.ultimo_esito)?.label ?? r.ultimo_esito}` : ''}`} />)}</div></section>}
      {scadute.length > 0 && <section className="card"><h2>Azioni scadute · {scadute.length}</h2><div className="or-list">{scadute.map((r) => <Row key={r.id} r={r} icon="⏰" what={`${r.prossima_azione ?? 'azione'} · scaduta il ${fmtD(r.prossima_azione_at)} · ${r.owner_outreach ?? ''}`} />)}</div></section>}
      {inScadenza.length > 0 && <section className="card"><h2>In scadenza entro 2 giorni · {inScadenza.length}</h2><div className="or-list">{inScadenza.map((r) => <Row key={r.id} r={r} icon="📅" what={`${r.prossima_azione ?? 'azione'} · ${fmtD(r.prossima_azione_at)}`} />)}</div></section>}
      {nuovi.length > 0 && <section className="card"><h2>Da contattare, mai toccati · {nuovi.length}</h2><div className="or-list">{nuovi.map((r) => <Row key={r.id} r={r} icon={r.telefono_maps || r.telefono ? '📞' : '✍️'} what={r.telefono_maps || r.telefono ? `telefonata di qualifica (${r.telefono ?? r.telefono_maps})` : r.email_generica || r.email_sito ? `email 1 a ${r.email_generica ?? r.email_sito}` : 'nessun contatto trovato: cercare email o telefono'} />)}</div></section>}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
export function OutreachScheda({ r, urls, who, sequences, settings, onBack, onOpenDossier, onChanged }: { r: LeadOutreach; urls: Record<string, string>; who: string; sequences: LeadSequence[]; settings: Record<string, string>; onBack: () => void; onOpenDossier: (id: string) => void; onChanged: () => Promise<void> }) {
  const [touches, setTouches] = useState<LeadTouch[] | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  // registra tocco
  const [canale, setCanale] = useState('telefono');
  const [dir, setDir] = useState<'in' | 'out'>('out');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [esito, setEsito] = useState('');
  const [stageDopo, setStageDopo] = useState('');
  const [pa, setPa] = useState('');
  const [paAt, setPaAt] = useState('');
  // compositore
  const [codice, setCodice] = useState(r.paese === 'IT' ? 'boutique_it' : 'boutique_en');
  const [tocco, setTocco] = useState<number>(Math.min(4, (r.n_email_out || 0) + 1));
  const [referente, setReferente] = useState('');
  const [testo, setTesto] = useState('');
  const [oggetto, setOggetto] = useState('');
  const [moveTo, setMoveTo] = useState('');
  const firma = settings.lead_firma ?? 'Benedetta - Amimì Milano';
  const to = r.email_generica ?? r.email_sito ?? '';

  const reload = async () => { setTouches(await fetchTouches(r.id)); };
  useEffect(() => { setTouches(null); reload().catch((e: Error) => setMsg(e.message)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [r.id]);

  const seq = useMemo(() => sequences.find((s) => s.codice === codice && s.tocco === tocco) ?? null, [sequences, codice, tocco]);
  useEffect(() => {
    if (!seq) { setTesto(''); setOggetto(''); return; }
    setTesto(renderTemplate(seq.corpo, r, referente, firma));
    setOggetto(seq.oggetto ? renderTemplate(seq.oggetto, r, referente, firma) : '');
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [seq?.id, referente, r.id]);

  const save = async (t: Parameters<typeof addTouch>[0], ok: string) => {
    setBusy(true); setMsg('');
    try { await addTouch(t); await onChanged(); await reload(); setMsg(ok); } catch (e) { setMsg((e as Error).message); }
    setBusy(false);
  };
  const registra = () => save({ account_id: r.id, canale, direzione: dir, subject: subject || null, body_clean: body || null, stage_prima: r.lead_stage, stage_dopo: stageDopo || null, esito: esito || null, prossima_azione: pa || null, prossima_azione_at: paAt || null, chi: who }, 'Tocco registrato.').then(() => { setSubject(''); setBody(''); setEsito(''); setStageDopo(''); setPa(''); setPaAt(''); });
  const segnaInviata = () => {
    const next = sequences.find((s) => s.codice === codice && s.tocco === tocco + 1 && s.canale === 'email');
    return save({ account_id: r.id, canale: seq?.canale ?? 'email', direzione: 'out', subject: oggetto || null, body_clean: testo, stage_prima: r.lead_stage, stage_dopo: r.lead_stage === 'da_contattare' ? 'contattato' : null, sequenza_tocco: tocco, prossima_azione: next ? `follow-up ${next.tocco} di 4` : 'chiusura: nessun altro tocco', prossima_azione_at: next ? addDays(next.giorni_attesa) : null, chi: who }, next ? `Registrata come inviata. Follow-up ${next.tocco} fra ${next.giorni_attesa} giorni.` : 'Registrata come inviata. Sequenza finita.').then(() => setTocco((t) => Math.min(4, t + 1)));
  };
  const sposta = () => moveTo && save({ account_id: r.id, canale: 'altro', direzione: 'out', body_clean: `Spostato a "${STAGE_LABEL[moveTo]}" da ${who}`, stage_prima: r.lead_stage, stage_dopo: moveTo, chi: who }, `Spostato in ${STAGE_LABEL[moveTo]}.`).then(() => setMoveTo(''));
  const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}&su=${encodeURIComponent(oggetto)}&body=${encodeURIComponent(testo)}`;
  const copia = async () => { try { await navigator.clipboard.writeText(`${oggetto ? oggetto + '\n\n' : ''}${testo}`); setMsg('Testo copiato.'); } catch { setMsg('Copia non riuscita: seleziona e copia a mano.'); } };

  return (
    <div className="screen">
      <header>
        <button className="badge" onClick={onBack} type="button">‹ Pipeline</button>
        <span className="badge" style={{ background: 'var(--interactive)', color: '#fff' }}>{STAGE_LABEL[r.lead_stage]}</span>
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
      {r.gancio && <div className="lead-gancio"><b>Gancio dal dossier</b><p>{r.gancio}</p></div>}
      <div className="or-next">
        <div><b>Prossima azione:</b> {r.prossima_azione ? `${r.prossima_azione}${r.prossima_azione_at ? ` entro il ${fmtD(r.prossima_azione_at)}` : ''}` : 'nessuna pianificata'}{r.owner_outreach ? ` · segue ${r.owner_outreach}` : ''}</div>
        <div className="or-move"><select value={moveTo} onChange={(e) => setMoveTo(e.target.value)}><option value="">Sposta a…</option>{STAGES.map((s) => <option key={s.key} value={s.key} disabled={s.key === r.lead_stage}>{s.label}</option>)}</select><button type="button" className="ds-btn" disabled={!moveTo || busy} onClick={sposta}>Sposta</button></div>
      </div>
      {msg && <div className="note" style={{ margin: '4px 0' }}>{msg}</div>}

      <div className="or-two">
        <section className="card">
          <h2>Timeline</h2>
          {!touches ? <p className="muted">Carico…</p> : !touches.length ? <p className="muted">Nessun tocco ancora. Il primo lo registri qui a destra, o lo mandi dal compositore.</p> : (
            <div className="or-timeline">{touches.map((t) => (
              <div key={t.id} className={`or-ev ${t.direzione === 'in' ? 'in' : ''} ${t.canale === 'telefono' || t.canale === 'visita' ? 'call' : ''}`}>
                <div className="h">{fmtDT(t.at)} · {CANALI[t.canale] ?? t.canale} {t.direzione === 'in' ? 'ricevuta' : t.canale === 'altro' ? '' : 'inviata'}{t.sequenza_tocco != null ? ` · tocco ${t.sequenza_tocco}` : ''}{t.chi ? ` · ${t.chi}` : ''}{t.esito ? ` · ${ESITI.find((e) => e.key === t.esito)?.label ?? t.esito}` : ''}{t.stage_dopo ? ` → ${STAGE_LABEL[t.stage_dopo] ?? t.stage_dopo}` : ''}</div>
                {(t.subject || t.body_clean) && <div className="b">{t.subject ? <b>{t.subject}{'\n'}</b> : null}{t.body_clean}</div>}
                {(t.prossima_azione || t.prossima_azione_at) && <div className="h">prossima: {t.prossima_azione ?? ''} {t.prossima_azione_at ? fmtD(t.prossima_azione_at) : ''}</div>}
              </div>
            ))}</div>
          )}
          <h2 style={{ marginTop: 14 }}>Registra un tocco</h2>
          <div className="or-form">
            <label>Canale<select value={canale} onChange={(e) => setCanale(e.target.value)}>{Object.entries(CANALI).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label>Direzione<select value={dir} onChange={(e) => setDir(e.target.value as 'in' | 'out')}><option value="out">Noi → loro</option><option value="in">Loro → noi</option></select></label>
            <label className="wide">Oggetto / titolo<input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="es. telefonata con Valentina" /></label>
            <label className="wide">Cosa ci siamo detti<textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Riassunto, o il testo della risposta ricevuta" /></label>
            <label>Esito<select value={esito} onChange={(e) => setEsito(e.target.value)}><option value="">—</option>{ESITI.map((e) => <option key={e.key} value={e.key}>{e.label}</option>)}</select></label>
            <label>Stadio dopo<select value={stageDopo} onChange={(e) => setStageDopo(e.target.value)}><option value="">automatico</option>{STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select></label>
            <label>Prossima azione<input value={pa} onChange={(e) => setPa(e.target.value)} placeholder="es. mandare catalogo" /></label>
            <label>Entro il<input type="date" value={paAt} onChange={(e) => setPaAt(e.target.value)} min={today()} /></label>
          </div>
          <button type="button" className="ds-btn" disabled={busy} onClick={registra}>Registra ({who})</button>
        </section>

        <section className="card">
          <h2>Compositore</h2>
          <div className="or-form">
            <label>Sequenza<select value={codice} onChange={(e) => setCodice(e.target.value)}>{[...new Set(sequences.map((s) => s.codice))].map((c) => <option key={c} value={c}>{c === 'boutique_it' ? 'Boutique · italiano' : c === 'boutique_en' ? 'Boutique · English' : c}</option>)}</select></label>
            <label>Tocco<select value={tocco} onChange={(e) => setTocco(Number(e.target.value))}>{sequences.filter((s) => s.codice === codice).map((s) => <option key={s.tocco} value={s.tocco}>{s.tocco === 0 ? '0 · telefonata' : `${s.tocco} · ${s.canale}${s.giorni_attesa ? ` (+${s.giorni_attesa} gg)` : ''}`}</option>)}</select></label>
            <label className="wide">Referente (nome)<input value={referente} onChange={(e) => setReferente(e.target.value)} placeholder="es. Valentina · vuoto = team di …" /></label>
            {oggetto !== '' || seq?.canale === 'email' ? <label className="wide">Oggetto<input value={oggetto} onChange={(e) => setOggetto(e.target.value)} /></label> : null}
            <label className="wide">Testo<textarea rows={14} value={testo} onChange={(e) => setTesto(e.target.value)} /></label>
          </div>
          <div className="facts-note">Riempito dal template con nome, gancio del dossier e firma. Le parti fra parentesi quadre vanno sistemate a mano prima di inviare. Tetto invii: {settings.lead_tetto_giornaliero ?? '20'} al giorno.</div>
          <div className="lead-actions">
            {seq?.canale === 'email' && to && <a className="ds-btn" href={gmailUrl} target="_blank" rel="noreferrer">Apri in Gmail</a>}
            <button type="button" className="ds-btn" onClick={copia}>Copia testo</button>
            <button type="button" className="ds-btn" disabled={busy || !testo} style={{ background: 'var(--positive)', color: '#fff', borderColor: 'var(--positive)' }} onClick={segnaInviata}>{seq?.canale === 'telefono' ? 'Segna come fatta' : 'Segna come inviata'}</button>
          </div>
          {!to && seq?.canale === 'email' && <p className="note">Nessuna email in anagrafica: "Apri in Gmail" compare quando c&#8217;e&#8217; un destinatario.</p>}
        </section>
      </div>
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
              <tr key={s.id}><td>{s.tocco}</td><td className="l">{s.tocco === 0 ? 'prima dell’email, se c’e’ un numero' : s.giorni_attesa ? `+${s.giorni_attesa} giorni dal precedente` : 'subito'}</td><td className="l">{CANALI[s.canale] ?? s.canale}</td><td className="l">{s.oggetto ?? '—'}</td><td className="l">{s.chi_default ?? ''}</td></tr>
            ))}</tbody>
          </table></div>
          {sequences.filter((s) => s.codice === c).map((s) => <details key={s.id} style={{ marginTop: 6 }}><summary style={{ cursor: 'pointer', fontSize: 13 }}>Testo del tocco {s.tocco}</summary><pre className="lead-pre" style={{ maxHeight: 300 }}>{s.corpo}</pre></details>)}
        </section>
      ))}
      <section className="card">
        <h2>Impostazioni</h2>
        <div className="list">
          <div className="row"><div className="rt">Casella</div><div className="rs">wholesale@amimi.it (da creare nel Workspace; inbound automatico = tappa 2)</div></div>
          <div className="row"><div className="rt">Firma</div><div className="rs" style={{ whiteSpace: 'pre-line' }}>{settings.lead_firma ?? '—'}</div></div>
          <div className="row"><div className="rt">Tetto invii al giorno</div><div className="rs">{settings.lead_tetto_giornaliero ?? '20'}</div></div>
          <div className="row"><div className="rt">Modulo (flag)</div><div className="rs">lead_enabled = {settings.lead_enabled ?? 'false'} (gata i cron delle tappe 2-4; la tappa 1 e' manuale e funziona comunque)</div></div>
          <div className="row"><div className="rt">Regole</div><div className="rs">Massimo 4 tocchi email, poi stop. Opt-out onorato dal database (esito "Opt-out" su un tocco). Contatto 1:1 personalizzato, riga di opt-out in ogni email.</div></div>
        </div>
        <p className="note">I testi vivono nella tabella lead_sequences: per cambiarli, chiedi a Claude Code o modifica a DB. La firma e il tetto in app_flags (lead_firma, lead_tetto_giornaliero).</p>
      </section>
    </>
  );
}
