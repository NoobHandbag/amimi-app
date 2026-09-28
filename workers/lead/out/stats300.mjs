// Fotografia finale dei 300 pronti: tier, fasce, citta', area, e i "nuovi" della fase 3 (28-09).
// Nuovo = pronto oggi che non lo era a inizio fase 3: ultimo score o un contatto email scritti dopo l'inizio della fase
// (primo score dei giri 33, cioe' il primo lotto della fase). Solo letture. Uso: node out/stats300.mjs
import { readFileSync } from 'node:fs';
import { supa } from '../lib.mjs';
import { leggiStato } from '../stato100.mjs';
const sb = await supa();
const { accounts, pronto, ultimo } = await leggiStato(sb);
const all = async (q) => { let out = [], from = 0; for (;;) { const { data } = await q().range(from, from + 999); out = out.concat(data); if (data.length < 1000) break; from += 1000; } return out; };
const ids33 = readFileSync('out/giro33_ids.txt', 'utf8').split(',').map((s) => s.trim()).filter(Boolean);
const { data: s33 } = await sb.from('lead_scores').select('created_at').in('account_id', ids33).order('created_at').limit(1);
const T = s33[0].created_at;
const ct = await all(() => sb.from('lead_contacts').select('account_id,email,created_at'));
const ctNuovi = new Set(ct.filter((c) => c.email && c.created_at >= T).map((c) => c.account_id));
const P = accounts.filter(pronto);
const tot = new Map(); for (const r of await all(() => sb.from('lead_scores').select('account_id,totale,created_at').order('created_at'))) tot.set(r.account_id, Number(r.totale));
const nord = new Set(['Milano', 'Monza', 'Como', 'Bergamo', 'Brescia', 'Pavia', 'Varese', 'Torino', 'Genova', 'Venezia', 'Verona', 'Padova', 'Vicenza', 'Treviso', 'Udine', 'Trieste', 'Trento', 'Bolzano', 'Bologna', 'Modena', 'Parma', 'Reggio Emilia', 'Ferrara', 'Ravenna', 'Rimini', 'Novara', 'La Spezia', 'Mantova', 'Cremona', 'Lodi', 'Cuneo', 'Pordenone', 'Gorizia', 'Imperia', 'Savona', 'Verbano Cusio Ossola', 'Vercelli', 'Santa Margherita Ligure', 'Portofino', 'Cortina d\'Ampezzo', 'Courmayeur', 'Bellagio']);
const fascia = (t) => (t >= 75 ? 'A 75+' : t >= 65 ? 'B 65-74' : t >= 60 ? 'B 60-64' : 'B 55-59');
const out = { inizio_fase3: T, totale: P.length, fasce: {}, area: { nord: 0, 'centro-sud e isole': 0 }, nuovi: 0, nuovi_fasce: {}, nuovi_area: { nord: 0, 'centro-sud e isole': 0 }, nuovi_fonte: {}, nuovi_citta: {}, contatti_email_fase3: ctNuovi.size };
for (const a of P) {
  const s = ultimo.get(a.id); const k = nord.has(a.citta) ? 'nord' : 'centro-sud e isole';
  out.fasce[fascia(tot.get(a.id))] = (out.fasce[fascia(tot.get(a.id))] || 0) + 1; out.area[k]++;
  if (s.created_at >= T || ctNuovi.has(a.id)) {
    out.nuovi++; out.nuovi_area[k]++;
    out.nuovi_fasce[fascia(tot.get(a.id))] = (out.nuovi_fasce[fascia(tot.get(a.id))] || 0) + 1;
    const f = (a.fonte_seed || '').replace(/^maps:.*/, 'maps'); out.nuovi_fonte[f] = (out.nuovi_fonte[f] || 0) + 1;
    out.nuovi_citta[a.citta] = (out.nuovi_citta[a.citta] || 0) + 1;
  }
}
out.nuovi_citta = Object.fromEntries(Object.entries(out.nuovi_citta).sort((x, y) => y[1] - x[1]));
console.log(JSON.stringify(out, null, 1));
