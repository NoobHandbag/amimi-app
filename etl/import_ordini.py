"""Import current supplier-order state from the freshest 'Amimi_Ordini_Fornitori_Completo' export
into supplier_orders. Robust: resolves columns by HEADER NAME (the two supplier sheets differ in
layout), skips ARCHIVIO sheets, groups by (fornitore + data_ordine). Emits UTF-8 SQL to stdout-file.
supplier_orders is order-tracking only (v_inventory reads `purchases`), so this never touches stock.
Usage: python import_ordini.py "<xlsx path>" > _import_ordini.sql
"""
import sys, datetime, openpyxl

f = sys.argv[1]
wb = openpyxl.load_workbook(f, data_only=True, read_only=True)

def find(headers, *needles):
    for i, h in enumerate(headers):
        hs = str(h or '').strip().lower()
        if all(n.lower() in hs for n in needles):
            return i
    return None

def sql_str(v):
    if v is None or v == '':
        return 'NULL'
    return "'" + str(v).replace("'", "''").strip() + "'"

def sql_num(v):
    try:
        if v is None or v == '':
            return 'NULL'
        return str(float(v))
    except Exception:
        return 'NULL'

def sql_date(v):
    if isinstance(v, (datetime.datetime, datetime.date)):
        return "DATE '" + v.strftime('%Y-%m-%d') + "'"
    return 'NULL'

rows = []
summary = {}
for name in wb.sheetnames:
    if 'ARCHIVIO' in name.upper():
        continue
    ws = wb[name]
    data = list(ws.iter_rows(values_only=True))
    # find header row (the one containing 'Data ordine')
    hi = next((i for i, r in enumerate(data) if r and str(r[0] or '').strip().lower() == 'data ordine'), None)
    if hi is None:
        continue
    H = data[hi]
    ci = {
        'data_ordine': 0,
        'item': find(H, 'modello'),
        'variant': find(H, 'variant'),
        'nuovo': find(H, 'nuovo o riordino'),
        'qty_ord': find(H, 'ordinata'),
        'qty_arr': find(H, 'ricevuta'),
        'costo': find(H, 'costo unitario'),
        'consegna': find(H, 'data consegna'),
        'note': find(H, 'note'),
        'codice': find(H, 'codice amiimi'),
    }
    forn = name.strip()
    n_open = n_arr = 0
    for r in data[hi + 1:]:
        if not r:
            continue
        item = r[ci['item']] if ci['item'] is not None else None
        if not item or not str(item).strip():
            continue
        qo = r[ci['qty_ord']] if ci['qty_ord'] is not None else None
        if qo in (None, ''):
            continue
        do = r[0]
        gk = forn + '|' + (do.strftime('%Y-%m-%d') if isinstance(do, (datetime.datetime, datetime.date)) else 'na')
        qa = r[ci['qty_arr']] if ci['qty_arr'] is not None else None
        codice = r[ci['codice']] if ci['codice'] is not None else None
        variant = r[ci['variant']] if ci['variant'] is not None else None
        rec = (
            gk,
            sql_str(codice), sql_str(item), sql_str(variant), sql_str(forn),
            sql_num(qo), sql_num(qa if qa not in (None, '') else 0),
            sql_date(do), sql_date(r[ci['consegna']] if ci['consegna'] is not None else None),
            sql_num(r[ci['costo']] if ci['costo'] is not None else None),
            sql_str(r[ci['nuovo']] if ci['nuovo'] is not None else None),
            sql_str(r[ci['note']] if ci['note'] is not None else None),
        )
        rows.append(rec)
        try:
            if float(qa or 0) >= float(qo or 0):
                n_arr += 1
            else:
                n_open += 1
        except Exception:
            n_open += 1
    summary[forn] = (n_open, n_arr)

out = []
out.append("INSERT INTO suppliers (name) VALUES ('Sarte Milano (tessuto)') ON CONFLICT (name) DO NOTHING;")
out.append("DELETE FROM supplier_orders WHERE source = 'import-ordini-fresh';")
out.append("WITH raw(group_key, codice, item, variant, fornitore, qty_ordered, qty_arrived, data_ordine, data_consegna, costo_unitario, nuovo_riordino, note) AS (")
out.append("  VALUES")
vals = []
for r in rows:
    vals.append("  (" + ", ".join([sql_str(r[0])] + list(r[1:])) + ")")
out.append(",\n".join(vals))
out.append("),")
# one uuid PER distinct group_key (DISTINCT over gen_random_uuid() does NOT dedupe -> quadratic blowup)
out.append("keys AS (SELECT DISTINCT group_key FROM raw),")
out.append("g AS (SELECT group_key, gen_random_uuid() AS gruppo FROM keys)")
out.append("INSERT INTO supplier_orders (gruppo, codice, item, variant, fornitore, qty_ordered, qty_arrived, data_ordine, data_consegna, costo_unitario, nuovo_riordino, note, source, chi)")
out.append("SELECT g.gruppo, r.codice, r.item, r.variant, r.fornitore, r.qty_ordered, r.qty_arrived, r.data_ordine, r.data_consegna, r.costo_unitario, r.nuovo_riordino, r.note, 'import-ordini-fresh', 'Ale'")
out.append("FROM raw r JOIN g ON g.group_key = r.group_key;")

with open(sys.argv[2], 'w', encoding='utf-8') as fh:
    fh.write("\n".join(out) + "\n")

print("RIGHE:", len(rows))
for k, (o, a) in summary.items():
    print(f"  {k}: {o} aperte, {a} arrivate")
