// tests/lead_shot_formato.mjs — formato degli screenshot del collector lead_* (bucket lead-assets)
//   node tests/lead_shot_formato.mjs
//
// 30-10: gli screenshot in PNG pieno (home desktop a pagina intera fino a 14 MB) avevano portato lead-assets a 5,09 GB
// e Supabase ha bloccato l'org Caprotti (quota Free 1 GB, ogni API in 402). Dal 31-10 il collector salva JPEG
// qualita' 60 e taglia la home desktop a 4 schermate; questo test, sul sorgente, dice se torna un PNG pieno.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n');
let ok = 0, ko = 0;
const t = (n, c, extra = '') => { if (c) { ok++; console.log('  ok  ' + n); } else { ko++; console.log('  KO  ' + n + (extra ? '  <- ' + String(extra).slice(0, 160) : '')); } };

const src = read('workers/lead/collect.mjs');
console.log('== collect.mjs: screenshot ==');
const chiamate = [...src.matchAll(/\.screenshot\(([^)]*)\)/g)].map((m) => m[1].trim());
t('ci sono le 5 chiamate a screenshot (home desktop, mobile, IG, Maps, foto Maps)', chiamate.length === 5, chiamate.join(' | '));
t('ogni screenshot usa SHOT o SHOT_PAGE', chiamate.every((a) => a === 'SHOT' || a === 'SHOT_PAGE'), chiamate.join(' | '));
t('una sola pagina intera (la home desktop)', chiamate.filter((a) => a === 'SHOT_PAGE').length === 1);
const shot = src.match(/const SHOT = (\{[^}]*\});/)?.[1] || '';
t('SHOT e\' JPEG con qualita\' <= 70', /type: 'jpeg'/.test(shot) && Number(shot.match(/quality: (\d+)/)?.[1]) <= 70, shot);
const page = src.match(/const SHOT_PAGE = (.*);/)?.[1] || '';
const h = Number(page.match(/height: (\d+)/)?.[1]);
t('SHOT_PAGE parte da SHOT, e\' fullPage e tagliata in altezza (<= 4000 px)', /\.\.\.SHOT\b/.test(page) && /fullPage: true/.test(page) && h > 0 && h <= 4000, page);
t('nessun fullPage fuori da SHOT_PAGE', (src.match(/fullPage:/g) || []).length === 1);
t('saveShot carica .jpg con content type image/jpeg', /upload\(sb, `\$\{acc\.id\}\/\$\{tipo\}_\$\{Date\.now\(\)\}\.jpg`, buffer, 'image\/jpeg'\)/.test(src));
t('nessun path .png scritto dal collector', !/_\$\{Date\.now\(\)\}\.png/.test(src));

console.log('\n== judge_dump.mjs: estensione dal tipo vero ==');
const jd = read('workers/lead/judge_dump.mjs');
t('il file scaricato prende l\'estensione dal content type', /data\.type/.test(jd) && /'image\/webp': 'webp'/.test(jd) && /'image\/jpeg': 'jpg'/.test(jd));
t('niente piu\' .png fisso per ogni screenshot', !/\$\{e\.tipo\}\.png`/.test(jd));

console.log(`\n${ok} ok, ${ko} KO`);
process.exit(ko ? 1 : 0);
