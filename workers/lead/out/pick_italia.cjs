// Scelta manuale dei candidati dallo sweep Maps centro-sud e medie citta' del 27-09 (indici di out/shortlist_italia.json),
// 6 per citta', round-robin per citta' in giri da 20. Esclusi per nome: catene, sport, pelletterie, sposa, luxury, stock.
// Uso: node out/pick_italia.cjs <lista 1..6> <numero giro>
const fs = require('fs');
const L = JSON.parse(fs.readFileSync('out/shortlist_italia.json'));
const perCitta = {
  Napoli: [54, 97, 106, 134, 179, 200], Trieste: [121, 142, 258, 283, 296, 306], Palermo: [11, 41, 119, 152, 180, 111],
  Perugia: [36, 37, 84, 89, 120, 175], Catania: [17, 50, 88, 100, 102, 122], Pisa: [112, 113, 198, 278, 391, 236],
  Lecce: [108, 109, 157, 254, 193, 130], Cagliari: [26, 30, 51, 101, 266, 310], Pescara: [154, 184, 217, 267, 287, 293],
  'Reggio Emilia': [65, 110, 212, 220, 230, 52], Lucca: [116, 129, 213, 226, 232, 308], Padova: [45, 95, 131, 224, 288, 204],
  Parma: [83, 93, 298, 414, 455, 177], Ancona: [71, 123, 167, 197, 223, 155], Trento: [92, 151, 285, 402, 424, 67],
  Bari: [87, 145, 161, 181, 195, 374], Rimini: [85, 144, 147, 148, 163, 188], Salerno: [94, 331, 387, 533, 511, 588],
};
const scelti = []; for (let r = 0; r < 6; r++) for (const c in perCitta) scelti.push(perCitta[c][r]);
const n = Number(process.argv[2]);
const P = scelti.slice((n - 1) * 20, n * 20).map((i) => L[i]);
console.log(P.map((a) => `${a.nome} [${a.citta}]`).join(' | '));
fs.writeFileSync(`out/giro${process.argv[3]}_ids.txt`, P.map((a) => a.id).join(','));
