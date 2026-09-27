import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { csClient } from '../lib/csClient';
import { fetchPremiaDashboard } from '../lib/premiaApi';
import type { PremiaDash, HealthItem, KpiDay } from '../lib/premiaApi';

// Pagina "Premia" (sola lettura, migr 0146): salute del programma fedelta', uso dell'Area Membri, premio AMICA12,
// membri, effetto sulle vendite e (Fase 2) il funnel dei tap. Una sola RPC con il login @amimi.it; nessun dato
// personale: la RPC restituisce solo conteggi e somme.

const num = (n: number) => new Intl.NumberFormat('it-IT').format(n || 0);
const eur = (n: number) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n || 0);
const R = { textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums' };
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) + '%' : '—');
const fmtDay = (d: string | null) => (d ? new Date(d + 'T00:00:00').toLocaleDateString('it-IT', { day: '2-digit', month: 'short' }) : '—');
const SEV_COLOR: Record<string, string> = { error: 'var(--red, #c83c46)', bad: 'var(--red, #c83c46)', warn: '#c98a1a', ok: 'var(--green, #2e9e5b)' };
const sevRank = (s: string) => (s === 'bad' || s === 'error' ? 0 : s === 'warn' ? 1 : 2);

// Cosa fare quando una voce non e' verde (sezioni di amimi-app/docs/LOYALTY_RUNBOOK.md)
const HINT: Record<string, string> = {
  loyalty_ledger: 'Saldi e storico punti non tornano. Non accendere nulla e avvisa Code (runbook §8).',
  loyalty_pool: 'Codici AMICA12 in esaurimento: va ricaricato il pool (runbook §4).',
  loyalty_pending: 'Ci sono riscatti senza codice, di solito per pool vuoto (runbook §7).',
  loyalty_orders_fresh: 'Il giro che accredita i punti degli acquisti non gira da 48 ore (runbook §5).',
  loyalty_orders: 'L’ultimo giro accrediti ha dato errore: leggere il messaggio (runbook §5).',
  loyalty_birthday: 'Il giro compleanni non e’ finito: riparte da solo domani; se resta cosi’ avvisa Code (runbook §12).',
  loyalty_bonus_second: 'Il giro bonus seconda borsa non e’ finito: riparte da solo domani; se resta cosi’ avvisa Code (runbook §12).',
};
const NOME: Record<string, string> = {
  loyalty_ledger: 'Saldi punti', loyalty_pool: 'Codici AMICA12', loyalty_pending: 'Riscatti in attesa', loyalty_orders_fresh: 'Giro accrediti',
  loyalty_orders: 'Ultimo giro accrediti', loyalty_birthday: 'Compleanni', loyalty_bonus_second: 'Bonus seconda borsa',
  loyalty_activity: 'Attivita’ di ieri', loyalty_backfill: 'Retroattivo',
};
const FLAG_NOME: [string, string][] = [
  ['loyalty_redeem_enabled', 'Riscatto'], ['loyalty_purchase_enabled', 'Punti sugli acquisti'], ['loyalty_profile_enabled', 'Profilo e compleanno'],
  ['loyalty_tier_lifetime_enabled', 'Livello sui punti cumulati'], ['loyalty_bonus_second_enabled', 'Bonus seconda borsa'], ['loyalty_track_enabled', 'Tracciamento tap'],
];
const ELEMENTO: Record<string, string> = {
  redeem_ready: 'Card premio (sbloccabile)', redeem_locked: 'Card premio (punti non bastano)', redeem_pending: 'Card premio (codice in arrivo)',
  profilo: 'Card profilo', mimi: 'Mimi', guardaroba: 'Guardaroba', bonus2: 'Riga seconda borsa', bday: 'Banner compleanno',
  redeem: 'Tap Riscatta', copy_code: 'Tap Copia codice', coccola: 'Tap Coccola', gioco: 'Tap Gioca', nanna: 'Tap Nanna', wear: 'Tap Indossa', profile_save: 'Tap Salva profilo',
};

function Kpi({ v, k, sub, tone }: { v: ReactNode; k: string; sub?: ReactNode; tone?: 'green' | 'red' | 'rose' | 'accent' }) {
  return <div className={'kpi' + (tone ? ' ' + tone : '')}><div className="v">{v}</div><div className="k">{k}</div>{sub ? <div className="ksub">{sub}</div> : null}</div>;
}

// barre giornaliere: visite (clienti distinti) e riscatti sovrapposti
function Barre({ rows }: { rows: KpiDay[] }) {
  if (!rows.length) return <p className="note">Nessun dato nel periodo.</p>;
  const max = Math.max(1, ...rows.map((r) => r.visite_clienti));
  const W = 100 / rows.length;
  return (
    <div>
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" style={{ width: '100%', height: 90, display: 'block' }} role="img" aria-label="Visite e riscatti per giorno">
        {rows.map((r, i) => {
          const h = (r.visite_clienti / max) * 38; const hr = (Math.min(r.riscatti, r.visite_clienti || r.riscatti) / max) * 38;
          return (<g key={r.day}>
            <rect x={i * W + W * 0.15} y={40 - h} width={W * 0.7} height={h} fill="var(--rose, #8b5e6b)" opacity={0.35}><title>{fmtDay(r.day)}: {r.visite_clienti} clienti in pagina, {r.riscatti} riscatti</title></rect>
            {r.riscatti > 0 && <rect x={i * W + W * 0.15} y={40 - hr} width={W * 0.7} height={hr} fill="var(--rose, #8b5e6b)" />}
          </g>);
        })}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--muted)' }}><span>{fmtDay(rows[0].day)}</span><span>max {num(max)} clienti/giorno</span><span>{fmtDay(rows[rows.length - 1].day)}</span></div>
      <p className="note" style={{ marginTop: 4 }}>Barra chiara = clienti che hanno aperto l&#8217;Area Membri quel giorno; parte piena = riscatti.</p>
    </div>
  );
}

function Funnel({ steps }: { steps: [string, number][] }) {
  const top = Math.max(1, steps[0][1]);
  return (
    <div>
      {steps.map(([label, v], i) => (
        <div key={label} style={{ margin: '6px 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><span>{label}</span><strong>{num(v)}{i > 0 ? <span style={{ color: 'var(--muted)', fontWeight: 400 }}> · {pct(v, steps[i - 1][1])}</span> : null}</strong></div>
          <div style={{ height: 8, borderRadius: 4, background: 'var(--line, #eee)' }}><div style={{ width: Math.min(100, (v / top) * 100) + '%', height: 8, borderRadius: 4, background: 'var(--rose, #8b5e6b)' }} /></div>
        </div>
      ))}
    </div>
  );
}

export default function Premia({ onBack }: { onBack: () => void }) {
  const [session, setSession] = useState<'loading' | 'in' | 'out'>('loading');
  const [email, setEmail] = useState(''); const [pwd, setPwd] = useState(''); const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [days, setDays] = useState(30);
  const [d, setD] = useState<PremiaDash | null>(null);

  useEffect(() => {
    csClient.auth.getSession().then(({ data }) => setSession(data.session ? 'in' : 'out'));
    const { data: sub } = csClient.auth.onAuthStateChange((_e, s) => setSession(s ? 'in' : 'out'));
    return () => sub.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (session !== 'in') return;
    setErr(''); setD(null);
    fetchPremiaDashboard(days).then(setD).catch((e: Error) => setErr(e.message));
  }, [session, days]);

  const doLogin = async () => {
    setBusy(true); setErr('');
    const { error } = await csClient.auth.signInWithPassword({ email: email.trim(), password: pwd });
    setBusy(false);
    if (error) setErr('Accesso non riuscito. Controlla email e password.'); else setPwd('');
  };
  const doGoogle = async () => {
    setBusy(true); setErr('');
    // redirectTo SENZA hash: Supabase appende la sessione come fragment (#access_token=...), un hash nostro lo romperebbe
    const { error } = await csClient.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin + import.meta.env.BASE_URL, queryParams: { hd: 'amimi.it', prompt: 'select_account' } } });
    if (error) { setBusy(false); setErr('Google non attivo: accedi con email e password.'); }
  };

  const header = (
    <header>
      <h1>Premia</h1>
      <button className="badge" onClick={onBack} type="button">&#8249; Home</button>
    </header>
  );

  if (session === 'loading') return <div className="screen">{header}<p className="muted center">Controllo l&#8217;accesso&#8230;</p></div>;
  if (session === 'out') return (
    <div className="screen">
      {header}
      <div className="cs-login">
        <div className="cs-logo">amimi<span>&#8217; premia</span></div>
        <div className="cs-lt">Come sta andando il programma fedelta&#8217;: accedi con il tuo account Amimi&#8217;</div>
        <button className="cs-btn" style={{ width: '100%', background: '#fff', border: '1px solid var(--line)', color: 'var(--dark)' }} onClick={doGoogle} disabled={busy} type="button">Accedi con Google</button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '14px 0 4px', color: 'var(--muted)', fontSize: 12 }}>
          <span style={{ flex: 1, height: 1, background: 'var(--line)' }} /> oppure con email <span style={{ flex: 1, height: 1, background: 'var(--line)' }} />
        </div>
        <div className="cs-fld"><label>Email (@amimi.it)</label>
          <input type="email" autoCapitalize="none" autoCorrect="off" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="info@amimi.it" /></div>
        <div className="cs-fld"><label>Password</label>
          <input type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') doLogin(); }} /></div>
        {err && <div className="err" style={{ marginBottom: 8 }}>{err}</div>}
        <button className="cs-btn cs-primary" style={{ width: '100%' }} onClick={doLogin} disabled={busy} type="button">{busy ? 'Accesso…' : 'Entra'}</button>
        <div className="cs-note">Stesso login dell&#8217;Assistenza: vale qualsiasi casella @amimi.it, si fa una volta per dispositivo.</div>
      </div>
    </div>
  );

  const periodo = (
    <div className="seg" style={{ marginBottom: 12 }}>
      {[7, 30, 90].map((n) => <button key={n} type="button" className={days === n ? 'on' : ''} onClick={() => setDays(n)}>{n} giorni</button>)}
    </div>
  );
  if (err) return <div className="screen">{header}{periodo}<div className="card err">{err}</div></div>;
  if (!d) return <div className="screen">{header}{periodo}<p className="muted center">Carico i numeri di Premia&#8230;</p></div>;

  // ---- salute ----
  const health = [...d.health].sort((a, b) => sevRank(a.severity) - sevRank(b.severity) || a.k.localeCompare(b.k));
  const worst = health.length ? health[0].severity : 'ok';
  const overall = worst === 'bad' || worst === 'error' ? 'error' : worst === 'warn' ? 'warn' : 'ok';
  const overallLabel = overall === 'error' ? 'Da sistemare' : overall === 'warn' ? 'Da tenere d’occhio' : 'Tutto in ordine';
  const oggi = d.to;
  const rigaSalute = (h: HealthItem) => (
    <li key={h.k} style={{ margin: '6px 0' }}>
      <span style={{ color: SEV_COLOR[h.severity] ?? 'var(--muted)', fontWeight: 700 }}>&bull;</span>{' '}
      <strong>{NOME[h.k] ?? h.k}</strong>: {h.label}{h.day < oggi ? <span className="muted"> (del {fmtDay(h.day)})</span> : null}
      {h.severity !== 'ok' && <div className="note" style={{ marginTop: 2 }}>{HINT[h.k] ?? 'Vedi LOYALTY_RUNBOOK in amimi-app/docs.'}</div>}
    </li>
  );

  // ---- uso ----
  const k = d.kpi_daily;
  const sum = (f: (r: KpiDay) => number) => k.reduce((s, r) => s + (f(r) || 0), 0);
  const visite = sum((r) => r.visite_clienti), coccole = sum((r) => r.coccole), memory = sum((r) => r.memory), riscatti = sum((r) => r.riscatti);

  // ---- premio ----
  const pool = d.pool[0];
  const ritmo = pool && pool.riscatti_14gg > 0 ? pool.riscatti_14gg / 14 : 0;
  const giorniPool = pool && ritmo > 0 ? Math.floor(pool.liberi / ritmo) : null;
  const a = d.amica12;

  // ---- funnel ----
  const trackOff = (d.flags.loyalty_track_enabled ?? 'off') === 'off';
  const f = d.funnel;

  return (
    <div className="screen">
      {header}
      {periodo}
      <p className="note" style={{ marginTop: 0 }}>Dal {fmtDay(d.from)} al {fmtDay(d.to)}. Numeri aggregati, nessun dato personale.</p>

      <section className="card" style={{ borderLeft: `4px solid ${SEV_COLOR[overall]}` }}>
        <h2>Salute: {overallLabel}</h2>
        <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0' }}>{health.map(rigaSalute)}</ul>
        <div className="pillrow">
          {FLAG_NOME.map(([key, label]) => {
            const v = d.flags[key] ?? 'off';
            return <span key={key} className={'pill ' + (v === 'on' ? 'ok' : v === 'test' ? 'warn' : 'muted')}>{label}: {v === 'on' ? 'acceso' : v === 'test' ? 'solo prova' : 'spento'}</span>;
          })}
        </div>
        <p className="note">Controlli ogni mattina verso le 8. Ultimo giro accrediti: {d.orders_last_run ? new Date(d.orders_last_run).toLocaleString('it-IT', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}.</p>
      </section>

      <section className="card">
        <h2>Uso dell&#8217;Area Membri</h2>
        <div className="kpis">
          <Kpi v={num(d.visitatori.periodo)} k="Clienti che l'hanno aperta" sub={`${num(d.visitatori.totale)} da quando esiste (${fmtDay(d.visitatori.dal)})`} tone="rose" />
          <Kpi v={num(visite)} k="Visite (cliente-giorno)" />
          <Kpi v={num(coccole + memory)} k="Coccole e giochi" sub={`${num(coccole)} coccole, ${num(memory)} giochi`} />
          <Kpi v={num(riscatti)} k="Riscatti" />
        </div>
        <Barre rows={k} />
      </section>

      <section className="card">
        <h2>Premio AMICA12 (100 punti = 12%)</h2>
        <div className="kpis">
          <Kpi v={pool ? num(pool.liberi) : '—'} k="Codici liberi" sub={giorniPool !== null ? `al ritmo attuale durano circa ${num(giorniPool)} giorni` : 'nessun riscatto negli ultimi 14 giorni'} tone={pool && pool.liberi < 50 ? 'red' : undefined} />
          <Kpi v={num(a.riscattati_periodo)} k="Riscattati nel periodo" sub={`${num(a.riscattati_totale)} in tutto`} />
          <Kpi v={num(a.ordini_periodo)} k="Usati al checkout" sub={`${num(a.ordini_totale)} in tutto, ${pct(a.ordini_totale, a.riscattati_totale)} dei riscattati`} tone="green" />
          <Kpi v={eur(a.lordo_totale)} k="Venduto con AMICA12" sub={`sconto dato ${eur(a.sconto_totale)}${a.con_reso ? `, ${num(a.con_reso)} con reso` : ''}`} />
        </div>
        <p className="note">&#8220;Usati al checkout&#8221; conta gli ordini Shopify con un codice AMICA12, letti dagli ordini sincronizzati: arriva con qualche ora di ritardo.</p>
      </section>

      <section className="card">
        <h2>Membri</h2>
        <div className="kpis">
          <Kpi v={num(d.members.totale)} k="Membri" />
          <Kpi v={num(d.members.ge100)} k="Possono riscattare" sub="saldo di almeno 100 punti" tone="green" />
          <Kpi v={num(d.members.b50_99)} k="Vicine al premio" sub="saldo fra 50 e 99" tone="accent" />
          <Kpi v={num(d.members.lt50)} k="Sotto 50 punti" />
        </div>
        <table className="dtable"><thead><tr><th>Livello</th><th style={R}>sul saldo</th><th style={R}>sui cumulati</th></tr></thead>
          <tbody>{['Amica', 'Amica Speciale', 'Amica del Cuore'].map((t) => (<tr key={t}><td>{t}</td><td style={R}>{num(d.members.tier_saldo[t] ?? 0)}</td><td style={R}>{num(d.members.tier_cumulato[t] ?? 0)}</td></tr>))}</tbody></table>
        <p className="note">{(d.flags.loyalty_tier_lifetime_enabled ?? 'off') === 'on' ? 'Il livello mostrato alle clienti segue i punti cumulati (flag acceso).' : 'Il livello mostrato alle clienti segue il saldo (flag “livello sui cumulati” spento).'}</p>
        <div className="kpis" style={{ marginTop: 12 }}>
          <Kpi v={num(d.second.finestre_aperte)} k="Seconda borsa: finestre aperte" sub={`${num(d.second.in_scadenza_14gg)} scadono entro 14 giorni`} />
          <Kpi v={num(d.second.bonus_dati)} k="Bonus +50 dati" sub={(d.flags.loyalty_bonus_second_enabled ?? 'off') === 'off' ? 'flag spento' : undefined} />
        </div>
      </section>

      <section className="card">
        <h2>Effetto sulle vendite</h2>
        <div className="kpis">
          <Kpi v={num(d.vendite.ordini_periodo)} k="Ordini online nel periodo" sub={eur(d.vendite.lordo_periodo)} />
          <Kpi v={num(d.vendite.ordini_dopo_visita)} k="Dopo una visita all'area" sub={`${eur(d.vendite.lordo_dopo_visita)} · ${pct(d.vendite.ordini_dopo_visita, d.vendite.ordini_periodo)} degli ordini`} tone="rose" />
        </div>
        <p className="note">&#8220;Dopo una visita&#8221; = la cliente aveva aperto l&#8217;Area Membri nei 30 giorni prima dell&#8217;ordine. E&#8217; una correlazione, non una prova di causa.
          Il confronto membri/ospiti non serve piu&#8217;: dopo il retroattivo del 21 settembre quasi ogni ordine e&#8217; di un membro
          ({d.uplift.map((u) => `${u.segmento === 'membro' ? 'membri' : 'ospiti'} ${num(u.ordini)}`).join(', ')}).</p>
      </section>

      <section className="card">
        <h2>Percorso nell&#8217;area (nel periodo)</h2>
        {trackOff && f.eventi === 0 ? (
          <p className="note" style={{ marginTop: 0 }}>Il tracciamento dei tap e&#8217; <strong>spento</strong> (flag loyalty_track_enabled): per ora si vedono solo aperture, riscatti e ordini. Si accende con l&#8217;OK dell&#8217;owner.</p>
        ) : null}
        <Funnel steps={[
          ['Hanno aperto l’area', f.aperture],
          ['Hanno visto la card del premio', f.visto_premio],
          ['...con punti sufficienti', f.premio_pronto],
          ['Hanno toccato Riscatta', f.tap_riscatta],
          ['Hanno riscattato', f.riscatti],
          ['Ordini con AMICA12', f.ordini_amica12],
        ]} />
        <p className="note">Clienti distinti per ogni passaggio. I passaggi 2-4 vengono dal tracciamento{f.dal ? ` (dati dal ${fmtDay(f.dal)})` : ''}; aperture e riscatti ci sono sempre.</p>
        {d.elementi.length > 0 && (
          <table className="dtable" style={{ marginTop: 10 }}><thead><tr><th>Elemento</th><th style={R}>Volte</th><th style={R}>Clienti</th></tr></thead>
            <tbody>{d.elementi.map((e) => (<tr key={e.event + (e.element ?? '')}><td>{ELEMENTO[e.element ?? ''] ?? `${e.event} ${e.element ?? ''}`}</td><td style={R}>{num(e.n)}</td><td style={R}>{num(e.clienti)}</td></tr>))}</tbody></table>
        )}
      </section>
    </div>
  );
}
