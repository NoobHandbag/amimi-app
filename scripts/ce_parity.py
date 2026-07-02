# Check di coerenza CE: Master (export 03-07) vs viste live amimi-app, riga per riga, mesi 1-6 (+7 info).
import io, sys, json, urllib.request

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
SB = 'https://imszbjeyplaiovylhkgl.supabase.co/rest/v1'
KEY = 'sb_publishable_DP66FFObEGagJknhGOz8xw_8KO8WIgD'

def rest(path):
    req = urllib.request.Request(f'{SB}/{path}', headers={'apikey': KEY, 'Authorization': f'Bearer {KEY}'})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)

mx = json.load(open('master_extract.json', encoding='utf-8'))
va = {r['month']: r for r in rest('v_ce_amimi_summary?year=eq.2026&order=month&select=*')}
vt = {r['month']: r for r in rest('v_ce_totale?year=eq.2026&order=month&select=*')}

def n(v):
    try: return float(v)
    except (TypeError, ValueError): return 0.0

def line(ce, label_sub, row_hint=None):
    # trova la voce per (pezzo di) label; opzionale disambiguazione per riga
    matches = [l for l in ce if label_sub in l['label']]
    if row_hint is not None:
        matches = [l for l in matches if l['row'] == row_hint] or matches
    return matches[0] if matches else None

# mapping: (nome, label Master, funzione che estrae il valore dalla vista)
MAP = [
    ('Online Pezzi',        'OnlinePezzi',                        lambda v: n(v['online_pezzi']), 10),
    ('Online Fatt. Lordo',  'OnlineFatturato Lordo',              lambda v: n(v['online_lordo']), None),
    ('Online Fatt. Netto',  'OnlineFatturato Netto',              lambda v: n(v['online_netto']), None),
    ('Offline Pezzi',       'Offline Pezzi',                      lambda v: n(v['offline_pezzi']), None),
    ('Offline Fatt. Lordo', 'Offline Fatturato Lordo',            lambda v: n(v['offline_lordo']), None),
    ('Offline Fatt. Netto', 'Offline Fatturato Netto',            lambda v: n(v['offline_netto']), None),
    ('Omni Pezzi',          'OmnichannelPezzi',                   lambda v: n(v['online_pezzi'])+n(v['offline_pezzi'])+n(v['b2b_pezzi']), None),
    ('Omni Fatt. Netto',    'OmnichannelFatturato Netto',         lambda v: n(v['omni_netto']), None),
    ('COGS',                'VariabiliCOGS',                      lambda v: n(v['cogs']), None),
    ('Packaging',           'VariabiliPackaging',                 lambda v: n(v['packaging']), None),
    ('Commissioni',         'VariabiliCommissioni',               lambda v: n(v['commissioni']), None),
    ('Logistica var',       'VariabiliLogistica',                 lambda v: n(v['logistica_var']), None),
    ('Resi',                'VariabiliResi',                      lambda v: n(v['resi']), None),
    ('MARGINE 1 (MC1)',     'Margine di Contribuzione_1',         lambda v: n(v['mc1']), None),
    ('Salari',              'FissiSALARI',                        lambda v: n(v['salari']), None),
    ('Tasse',               'FissiTASSE',                         lambda v: n(v['tasse']), None),
    ('Logistica fissa',     'FissiLOGISTICA',                     lambda v: n(v['logistica_mag']), None),
    ('Opex',                'FissiOPEX',                          lambda v: n(v['opex']), None),
    ('Eventi',              'FissiEVENTI',                        lambda v: n(v['eventi']), None),
    ('Marketing',           'FissiMARKETING',                     lambda v: n(v['marketing']), None),
    ('MARGINE 2 (MC2)',     'Margine di Contribuzione_2',         lambda v: n(v['mc2']), None),
]

def compare(name, ce_lines, views):
    print('=' * 110)
    print(f'### {name} — Master (export 03-07) vs vista live')
    print('=' * 110)
    issues = []
    for label_nice, label_sub, getter, row_hint in MAP:
        l = line(ce_lines, label_sub, row_hint)
        if l is None:
            print(f'{label_nice:22} | voce NON trovata nel Master (label "{label_sub}")')
            continue
        cells = []
        for m in range(1, 8):
            mv = l['vals'].get(str(m), l['vals'].get(m, 0))
            mv = n(mv)
            av = getter(views[m]) if m in views else 0.0
            d = av - mv
            tag = 'OK' if abs(d) <= 0.015 else ('~' if abs(d) <= max(0.01 * abs(mv), 5) else 'X')
            cells.append((m, mv, av, d, tag))
        bad = [c for c in cells[:6] if c[4] == 'X']
        near = [c for c in cells[:6] if c[4] == '~']
        if not bad and not near:
            print(f'{label_nice:22} | GEN-GIU ESATTO (<=1 cent)')
        else:
            det = ' | '.join(f'M{c[0]}: xls={c[1]:.2f} app={c[2]:.2f} (d{c[3]:+.2f}){c[4]}' for c in cells[:6] if c[4] != 'OK')
            print(f'{label_nice:22} | {det}')
            issues.extend((label_nice, c) for c in bad)
        # luglio info
        c7 = cells[6]
        if abs(c7[1]) > 0.01 or abs(c7[2]) > 0.01:
            print(f'{"":22} | LUG (live): xls={c7[1]:.2f} app={c7[2]:.2f}')
    return issues

iA = compare('CE AMIMI', mx['ce_amimi'], va)
iT = compare('CE TOTALE', mx['ce_totale'], vt)
print()
print('VOCI FUORI TOLLERANZA (>1% e >5 EUR):', len(iA), 'Amimi,', len(iT), 'Totale')
