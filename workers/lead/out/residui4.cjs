// Candidati dello sweep 4 non ancora scelti da pick_italia4 (liste 1-8): indice, nome, citta', query, recensioni.
const fs = require('fs');
const L = JSON.parse(fs.readFileSync('out/shortlist_italia4.json'));
const src = fs.readFileSync('out/pick_italia4.cjs', 'utf8');
const presi = new Set((src.match(/\[[\d, ]+\]/g) || []).flatMap((s) => JSON.parse(s)));
const R = L.map((a, i) => ({ i, ...a })).filter((a) => !presi.has(a.i) && /multimarca/.test(a.q));
const by = {};
R.forEach((a) => (by[a.citta] ??= []).push(`${a.i}:${a.nome.slice(0, 32)}(${a.rec})`));
console.log(R.length);
for (const c in by) console.log(c + ': ' + by[c].join(' | '));
