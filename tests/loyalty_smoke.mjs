// tests/loyalty_smoke.mjs — smoke di PRODUZIONE in SOLA LETTURA del modulo Premia (Area Membri).
//   node tests/loyalty_smoke.mjs
// Nessuna scrittura, nessun segreto, nessun login: prova che le porte rispondano come da contratto.
// Va nel job `invarianti-produzione` (non bloccante: dipende dalla rete e da Shopify), come features.mjs.
// Scritto dalla quest audit 2026-09-21 (Fase 5). Se una riga diventa rossa e' il sistema, non il test.
const EDGE = 'https://imszbjeyplaiovylhkgl.supabase.co/functions/v1';
const SITE = 'https://amimi.it/apps/premia';

let ok = 0, ko = 0;
const t = (n, c, extra = '') => { if (c) { ok++; console.log('  ok  ' + n); } else { ko++; console.log('  KO  ' + n + (extra ? '  <- ' + String(extra).slice(0, 200) : '')); } };
const get = async (url, init) => {
  const r = await fetch(url, { redirect: 'manual', ...init });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* non json */ }
  return { status: r.status, ct: r.headers.get('content-type') || '', text, json };
};

console.log('\n== App Proxy (firma vera aggiunta da Shopify, nessun cliente loggato) ==');
{
  const s = await get(SITE + '/state');
  t('1  /apps/premia/state -> 200 login_required', s.status === 200 && s.json?.state === 'login_required', s.status + ' ' + s.text.slice(0, 80));
  const c = await get(SITE + '/club');
  t('2  /apps/premia/club -> 200 text/html (Liquid reso da Shopify)', c.status === 200 && /text\/html/.test(c.ct), c.status + ' ' + c.ct);
  t('2b la pagina e\' quella membri (titolo Premia)', /Premia/.test(c.text) && /<!DOCTYPE html>/i.test(c.text));
  const rw = await get(SITE + '/rewards');
  t('3  /apps/premia/rewards senza login -> login_required (identita\' prima del flag)', rw.status === 200 && rw.json?.state === 'login_required', rw.status + ' ' + rw.text.slice(0, 80));
}

console.log('\n== Edge dirette (senza App Proxy: la firma manca o e\' falsa) ==');
{
  const a = await get(EDGE + '/loyalty-proxy/state');
  t('4  loyalty-proxy senza firma -> 401 missing_signature', a.status === 401 && a.json?.error === 'missing_signature', a.status + ' ' + a.text.slice(0, 80));
  const b = await get(EDGE + '/loyalty-proxy/state?signature=deadbeef&logged_in_customer_id=1&timestamp=' + Math.floor(Date.now() / 1000));
  t('5  loyalty-proxy con firma falsa -> 401 bad_signature', b.status === 401 && b.json?.error === 'bad_signature', b.status + ' ' + b.text.slice(0, 80));
  const p = await get(EDGE + '/loyalty-page');
  t('6  loyalty-page diretta -> 200 application/liquid con il wrapper', p.status === 200 && /application\/liquid/.test(p.ct) && p.text.startsWith('{% layout none %}{% raw %}'), p.status + ' ' + p.ct);
  const o = await get(EDGE + '/loyalty-orders', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  t('7  loyalty-orders senza PIN -> 401 PIN errato (v3, T2: stessa posta delle altre edge del cron)', o.status === 401 && o.json?.error === 'PIN errato', o.status + ' ' + o.text.slice(0, 80));
  const g = await get(EDGE + '/loyalty-proxy-smoke');
  t('8  il clone smoke resta uno stub 410', g.status === 410, String(g.status));
}

console.log('\n' + ok + ' ok, ' + ko + ' KO');
process.exit(ko > 0 ? 1 : 0);
