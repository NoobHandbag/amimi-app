// Scelta manuale dei candidati nelle grandi citta' (indici di out/shortlist_citta.json del 27-09), in giri da 20.
// Esclusi per nome: pelletterie e marchi propri, catene (Vestopazzo, Libero Milano, Camomilla, Max&Co, Stefanel...), curvy, vintage.
// Uso: node out/pick_citta.cjs <lista 1..5> <numero giro>
const fs = require('fs');
const L = JSON.parse(fs.readFileSync('out/shortlist_citta.json'));
const scelti = [4,18,22,23,27,30,46,49,55,145,26,41,34,62,48,61,64,150,42,47,59,83,65,75,90,287,58,50,119,113,126,76,130,292,88,106,129,117,138,78,133,327,99,107,231,131,175,86,166,370,103,236,250,141,206,100,318,383,362,265,153,301,182,372,312,162,302,183,373,313,205,337,187,238,267,290,329]; // round-robin per citta, solo grandi e medie (Lombardia minore tolta su indicazione owner 27-09)
const n = Number(process.argv[2]);
const P = scelti.slice((n - 1) * 20, n * 20).map((i) => L[i]);
console.log(P.map((a) => `${a.nome} [${a.citta}]`).join(' | '));
fs.writeFileSync(`out/giro${process.argv[3]}_ids.txt`, P.map((a) => a.id).join(','));
