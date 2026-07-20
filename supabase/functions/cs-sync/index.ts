// cs-sync — Tool assistenza clienti, FASE 0 (v1). Solo diagnostica: ZERO scritture DB.
// Azioni: ping (legge l'ultimo messaggio di info@amimi.it via Gmail API, service account con
// domain-wide delegation; chiave in app_flags.cs_gmail_sa_key, se assente -> needs_key) e
// status (stato config senza mai esporre i valori dei segreti). PIN-gated come le altre edge.
// Design: Cowork12/projects/Servizio_Clienti_2026-06/DESIGN_Tool_Assistenza_Amimi_V1_2026-07-20.md
import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
async function sha256hex(s: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const GMAIL_USER = 'info@amimi.it';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function pemToPkcs8(pem: string): Uint8Array {
  const raw = pem.replace('-----BEGIN PRIVATE KEY-----', '').replace('-----END PRIVATE KEY-----', '').replace(/\s+/g, '');
  const bin = atob(raw);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
// OAuth 2.0 JWT bearer grant: il service account impersona GMAIL_USER (domain-wide delegation).
async function googleAccessToken(sa: { client_email: string; private_key: string }): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const enc = new TextEncoder();
  const header = b64url(enc.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const claims = b64url(enc.encode(JSON.stringify({ iss: sa.client_email, sub: GMAIL_USER, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 })));
  const key = await crypto.subtle.importKey('pkcs8', pemToPkcs8(sa.private_key).buffer as ArrayBuffer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(`${header}.${claims}`)));
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${header}.${claims}.${b64url(sig)}` }),
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) throw new Error(`google_token ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
  return j.access_token;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const body = await req.json().catch(() => ({}));
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const { data: cfg } = await sb.from('app_config').select('pin_hash').eq('id', 1).single();
  if (!cfg?.pin_hash || !body.pin || (await sha256hex(String(body.pin))) !== cfg.pin_hash) return json({ error: 'PIN errato' }, 401);

  const flags: Record<string, string> = {};
  const { data: rows } = await sb.from('app_flags').select('key,value').in('key', ['cs_enabled', 'cs_last_history_id', 'cs_gmail_sa_key']);
  for (const r of rows ?? []) flags[r.key] = r.value ?? '';

  const action = String(body.action || 'status');

  if (action === 'status') {
    return json({ ok: true, cs_enabled: flags.cs_enabled === 'true', key_present: !!flags.cs_gmail_sa_key, last_history_id: flags.cs_last_history_id || '' });
  }

  if (action === 'ping') {
    if (!flags.cs_gmail_sa_key) return json({ ok: false, needs_key: true });
    let sa: { client_email?: string; private_key?: string };
    try { sa = JSON.parse(flags.cs_gmail_sa_key); } catch { return json({ ok: false, error: 'sa_key_invalid_json' }); }
    if (!sa.client_email || !sa.private_key) return json({ ok: false, error: 'sa_key_missing_fields' });
    try {
      const token = await googleAccessToken(sa as { client_email: string; private_key: string });
      const auth = { Authorization: `Bearer ${token}` };
      const list = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=1', { headers: auth });
      const lj = await list.json();
      if (!list.ok) return json({ ok: false, error: 'gmail_list ' + list.status, detail: JSON.stringify(lj).slice(0, 200) });
      const id = lj?.messages?.[0]?.id;
      if (!id) return json({ ok: true, empty: true });
      const msg = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`, { headers: auth });
      const mj = await msg.json();
      if (!msg.ok) return json({ ok: false, error: 'gmail_get ' + msg.status, detail: JSON.stringify(mj).slice(0, 200) });
      const h = (name: string) => ((mj?.payload?.headers ?? []) as { name?: string; value?: string }[]).find((x) => x.name?.toLowerCase() === name)?.value ?? '';
      return json({ ok: true, subject: h('subject'), from: h('from'), date: h('date') });
    } catch (e) {
      return json({ ok: false, error: 'google_auth_failed', detail: (e as Error).message.slice(0, 200) });
    }
  }

  return json({ error: 'azione sconosciuta: ' + action }, 422);
});
