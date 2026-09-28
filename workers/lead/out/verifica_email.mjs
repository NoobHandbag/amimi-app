// Verifica dei pronti: quali hanno solo email segnaposto dei template (xxx@, tu@email, example.com...) o PEC.
import { supa } from '../lib.mjs';
import { leggiStato } from '../stato100.mjs';
const FINTA = /^(xxx@|tu@email|tua@email|tua-email@|your@email|iltuo@|john\.doe@|email@example|utente@dominio|email@esempio|mymail@mailservice|nome@gmail|u003e)|@(example|esempio|dominio|email)\.(com|it|address)|sentry|wixpress|@pec\.|legalmail|dpo@|black@friday|@store\.tv$/i;
const sb = await supa();
const { accounts, pronto, ultimo } = await leggiStato(sb);
const all = async (q) => { let out = [], from = 0; for (;;) { const { data } = await q().range(from, from + 999); out = out.concat(data); if (data.length < 1000) break; from += 1000; } return out; };
const ev = await all(() => sb.from('lead_evidence').select('account_id,payload').in('tipo', ['site_meta', 'contatti_trovati']));
const ct = await all(() => sb.from('lead_contacts').select('account_id,email').not('email', 'is', null).eq('opt_out', false));
const mail = new Map();
for (const e of ev) for (const m of e.payload?.emails ?? []) (mail.get(e.account_id) ?? mail.set(e.account_id, new Set()).get(e.account_id)).add(m);
for (const c of ct) (mail.get(c.account_id) ?? mail.set(c.account_id, new Set()).get(c.account_id)).add(c.email);
const P = accounts.filter(pronto);
const soloFinte = P.filter((a) => { const m = [...(mail.get(a.id) ?? [])]; if (a.email_generica && !FINTA.test(a.email_generica)) return false; return m.length && m.every((x) => FINTA.test(x)); });
const tier = { A: 0, B: 0 }; for (const a of P) tier[ultimo.get(a.id).tier_proposto]++;
console.log('pronti', P.length, JSON.stringify(tier), 'solo email finte/PEC:', soloFinte.length);
for (const a of soloFinte) console.log(' -', a.nome, '|', [...(mail.get(a.id) ?? [])].join(', '));
