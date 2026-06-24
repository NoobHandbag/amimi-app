import xlsx from 'xlsx';
import { fileURLToPath } from 'node:url';
const wb = xlsx.readFile(fileURLToPath(new URL('../fixtures/seed.xlsx', import.meta.url)), {cellDates:true});
const rows = n => xlsx.utils.sheet_to_json(wb.Sheets[n], {header:1, blankrows:false, defval:null});

{ const r=rows('DB Shopify'); const h=r[0]||[]; console.log('DB Shopify total cols='+h.length+' (showing idx>=78)');
  for(let i=78;i<h.length;i++) console.log('  ['+i+'] '+JSON.stringify(h[i])+'  ex1='+JSON.stringify(r[1]?.[i])+' ex2='+JSON.stringify(r[2]?.[i])); }

{ const r=rows('INVENTARIO_PRODOTTI'); console.log('\nINVENTARIO_PRODOTTI cols='+(r[0]?.length)+' rows='+r.length);
  (r[0]||[]).forEach((c,i)=>console.log('  ['+i+'] '+JSON.stringify(c)+'  ex='+JSON.stringify(r[1]?.[i]))); }

{ const r=rows('CE_AMIMI'); console.log('\nCE_AMIMI rows='+r.length+' (cols 0-5 + G=idx6)');
  for(let i=0;i<r.length;i++){ const a=r[i]||[]; console.log('  r'+i+' '+JSON.stringify(a.slice(0,6))+'  G='+JSON.stringify(a[6])); } }
