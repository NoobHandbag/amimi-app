// _shared/push.ts: il secondo canale degli avvisi di ce-guard e sales-guard: la notifica dell'app (Web Push) via push-api.
// PR B delle notifiche native (17-10-2026, brief Cowork12/_CLAUDE_CODE_INBOX/2026-10-17_BRIEF_notifiche_guardie_PR_B.md).
// I guardiani NON importano web-push: chiamano push-api (azione `invia`, chiave di servizio) con un POST, e la spedizione
// ai telefoni resta tutta li'. L'interruttore e' app_flags.push_canale_guardie ('ntfy' | 'entrambi' | 'push', nasce 'ntfy');
// a push_enabled spento vale sempre 'ntfy'.
// Nessun import: i test lo caricano coi tipi tolti e lo guidano con spedizioni e fetch finti (tests/shopify_sync_guardie.mjs).

export type Canale = 'ntfy' | 'entrambi' | 'push';
export type EsitoPush = {
  ok: boolean; inviati: number; falliti: number; destinatari: number | null; status: number | null;
  skipped?: string; dryRun?: boolean; errore?: string;
};
export type MsgPush = { tema: string; titolo: string; testo: string; url?: string; urgente?: boolean; dryRun?: boolean };

export const APP_URL = 'https://noobhandbag.github.io/amimi-app/';
// push-api spedisce in sequenza con 10 s al massimo per telefono (giro intero al massimo 100 s) e le sue letture possono
// ritentare dopo 1,5 s: con i tre telefoni del team il caso peggiore e' di circa 35 s (di solito meno di un secondo a
// telefono). Oltre il tetto la push puo' arrivare lo stesso (push-api va avanti) ma per il guardiano conta come non
// arrivata: in modalita' `push` partirebbe anche ntfy (Gate 2 del 17-10, C2).
export const TIMEOUT_PUSH_MS = 40000;

// Stessa regola di flagVero in push-api: acceso SOLO con la stringa 'true' (maiuscole e spazi tollerati).
export function canaleEffettivo(pushEnabled: unknown, canale: unknown): Canale {
  if (typeof pushEnabled !== 'string' || pushEnabled.trim().toLowerCase() !== 'true') return 'ntfy';
  const c = typeof canale === 'string' ? canale.trim().toLowerCase() : '';
  return c === 'entrambi' || c === 'push' ? c : 'ntfy';
}

// Quando l'avviso conta come consegnato, cioe' quando il guardiano salva lo stato (altrimenti il giro dopo riprova).
// ntfyOk null = ntfy non e' partito (nessun topic, o in 'push' perche' la push e' arrivata). In 'entrambi' decide ntfy,
// il canale di riferimento del pilota (OK di Dan sul brief, 17-10): una push fallita non fa ripetere ntfy ogni ora.
export function consegnata(canale: Canale, ntfyOk: boolean | null, push: EsitoPush | null): boolean {
  const pushOk = push?.ok === true;
  if (canale === 'push') return pushOk || ntfyOk === true;
  if (canale === 'entrambi') return ntfyOk === null ? pushOk : ntfyOk === true;
  return ntfyOk === true;
}

// Chi parte e in che ordine. 'entrambi': tutti e due insieme. 'push': ntfy solo se la push non e' arrivata a nessun
// telefono. Le spedizioni arrivano da fuori; una che lancia conta come fallita, e questa funzione non lancia mai.
export async function consegnaAvviso(canale: Canale, mandaNtfy: () => Promise<boolean | null>, mandaPush: () => Promise<EsitoPush>):
  Promise<{ ntfyOk: boolean | null; push: EsitoPush | null; consegnata: boolean }> {
  const ntfy = async (): Promise<boolean | null> => { try { return await mandaNtfy(); } catch { return false; } };
  const push = async (): Promise<EsitoPush> => { try { return await mandaPush(); } catch (e) { return esitoFallito(testoErrore(e, '')); } };
  let ntfyOk: boolean | null = null;
  let esito: EsitoPush | null = null;
  if (canale === 'entrambi') [ntfyOk, esito] = await Promise.all([ntfy(), push()]);
  else if (canale === 'push') {
    esito = await push();
    if (!esito.ok) ntfyOk = await ntfy();
  } else ntfyOk = await ntfy();
  return { ntfyOk, push: esito, consegnata: consegnata(canale, ntfyOk, esito) };
}

function esitoFallito(errore: string, status: number | null = null): EsitoPush {
  return { ok: false, inviati: 0, falliti: 0, destinatari: null, status, errore };
}

// Nome e testo dell'errore su una riga, al massimo 200 caratteri; la chiave, se mai ci finisse dentro, diventa [chiave].
function testoErrore(e: unknown, chiave: string): string {
  const o = (e && typeof e === 'object' ? e : { message: e }) as { name?: unknown; message?: unknown };
  let t = [o.name, o.message].filter((x) => typeof x === 'string' && x).join(': ') || String(e);
  if (chiave) t = t.split(chiave).join('[chiave]');
  return t.replace(/[\u0000-\u001f\u007f]+/g, ' ').slice(0, 200);
}

// La risposta di push-api diventa un esito. ok solo con 2xx, ok:true e almeno un telefono raggiunto (in dryRun push-api
// mette ok = destinatari >= 1 e non spedisce). Nessun dato dei telefoni: push-api non restituisce mai endpoint o chiavi.
export function esitoDaRisposta(status: number, corpo: unknown): EsitoPush {
  const o = (corpo && typeof corpo === 'object' && !Array.isArray(corpo) ? corpo : {}) as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
  const ok2xx = status >= 200 && status < 300;
  const dry = o.dryRun === true;
  const e: EsitoPush = {
    ok: ok2xx && o.ok === true && (dry || n(o.inviati) >= 1),
    inviati: n(o.inviati), falliti: n(o.falliti),
    destinatari: typeof o.destinatari === 'number' ? n(o.destinatari) : null,
    status,
  };
  if (typeof o.skipped === 'string') e.skipped = o.skipped.slice(0, 40);
  if (dry) e.dryRun = true;
  if (!ok2xx) e.errore = typeof o.error === 'string' && o.error ? o.error.slice(0, 200) : `push-api ha risposto ${status}`;
  return e;
}

// POST a push-api con la chiave di servizio del guardiano (nell'ambiente delle edge e' la sb_secret, CONOSCENZA 15-10: la
// stessa che push-api confronta). Non lancia mai: rete, timeout, risposta non JSON diventano un esito con `errore`.
// `env` e `fetchFn` servono ai test; in produzione si leggono SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.
export async function inviaPush(msg: MsgPush, env?: { url?: string; key?: string }, fetchFn: typeof fetch = fetch): Promise<EsitoPush> {
  let key = '';
  try {
    const url = env ? env.url : Deno.env.get('SUPABASE_URL');
    key = (env ? env.key : Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) ?? '';
    if (!url || !key) return esitoFallito('SUPABASE_URL o chiave di servizio mancanti nell\'ambiente');
    const res = await fetchFn(url.replace(/\/+$/, '') + '/functions/v1/push-api', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({
        action: 'invia', tema: msg.tema, titolo: msg.titolo, testo: msg.testo, url: msg.url ?? APP_URL, urgente: msg.urgente === true,
        ...(msg.dryRun === true ? { dryRun: true } : {}),
      }),
      signal: AbortSignal.timeout(TIMEOUT_PUSH_MS),
    });
    const corpo = await res.json().catch(() => null);
    return esitoDaRisposta(res.status, corpo);
  } catch (e) {
    return esitoFallito(testoErrore(e, key));
  }
}
