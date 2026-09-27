// Fotografia finale dei 200 pronti: tier, fasce di punteggio, citta', nuovi rispetto ai primi 101 (score prima del 27-09 12:00).
import { supa } from '../lib.mjs';
import { leggiStato } from '../stato100.mjs';
const sb = await supa();
const { accounts, pronto } = await leggiStato(sb);
const all = async (q) => { let out = [], from = 0; for (;;) { const { data } = await q().range(from, from + 999); out = out.concat(data); if (data.length < 1000) break; from += 1000; } return out; };
const sc = await all(() => sb.from('lead_scores').select('account_id,totale,tier_proposto,created_at').order('created_at'));
const last = new Map(), first = new Map();
for (const s of sc) { last.set(s.account_id, s); if (!first.has(s.account_id)) first.set(s.account_id, s); }
const P = accounts.filter(pronto);
const ct = await all(() => sb.from('lead_contacts').select('account_id'));
const fascia = (t) => (t >= 75 ? 'A 75+' : t >= 65 ? 'B 65-74' : t >= 60 ? 'B 60-64' : 'B 55-59');
const out = { totale: P.length, fasce: {}, citta: {}, nuovi: 0, contatti: ct.length };
const nord = new Set(['Milano', 'Monza', 'Como', 'Bergamo', 'Brescia', 'Pavia', 'Varese', 'Torino', 'Genova', 'Venezia', 'Verona', 'Padova', 'Vicenza', 'Treviso', 'Udine', 'Trieste', 'Trento', 'Bolzano', 'Bologna', 'Modena', 'Parma', 'Reggio Emilia', 'Ferrara', 'Ravenna', 'Rimini', 'Novara', 'La Spezia', 'Santa Margherita Ligure', 'Portofino', 'Forte dei Marmi', 'Cortina d\'Ampezzo', 'Courmayeur', 'Bellagio']);
const area = { nord: 0, 'centro-sud e isole': 0 };
for (const a of P) {
  const s = last.get(a.id); out.fasce[fascia(s.totale)] = (out.fasce[fascia(s.totale)] || 0) + 1;
  out.citta[a.citta] = (out.citta[a.citta] || 0) + 1;
  const nuovo = first.get(a.id).created_at >= '2026-09-27T06:00:00'; if (nuovo) { out.nuovi++; out.nuoviArea ??= {}; const k = nord.has(a.citta) ? 'nord' : 'centro-sud e isole'; out.nuoviArea[k] = (out.nuoviArea[k] || 0) + 1; }
  area[nord.has(a.citta) ? 'nord' : 'centro-sud e isole']++;
}
out.area = area;
out.citta = Object.fromEntries(Object.entries(out.citta).sort((x, y) => y[1] - x[1]));
console.log(JSON.stringify(out, null, 1));
