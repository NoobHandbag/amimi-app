"""
cowork_amimi.py — ponte Cowork (o qualsiasi Python/Node) ↔ app Amimì (Supabase).

L'API dell'app è HTTPS pubblica: letture via REST con la anon key (sola lettura), scritture via
l'edge function write-api (PIN-gated). Niente auth Google. Cowork esegue Python, quindi può usarlo
nei suoi scheduled task per leggere/scrivere l'app come fa Claude Code.

Le credenziali qui sotto NON sono segreti: la anon key è già nel bundle pubblico (sola lettura) e il
PIN è neutralizzato a 'x' per scelta (posture rilassata). I segreti veri (service-role, token Shopify,
chiave Gemini) restano lato server in app_config/app_flags e non passano mai di qui.

Esempi:
    from cowork_amimi import read, write, inventory
    inv = inventory()                                  # lista magazzino
    bassi = [p for p in inv if p["disponibili_da_vendere"] <= 2]
    write("expense_propose", {"operazione": "Meta Ads", "costo": 50, "categoria": "MARKETING",
                              "amimi": "si", "date_paid": "2026-06-25"}, chi="Cowork")
    ce = read("v_ce_amimi_summary", {"year": "eq.2026", "order": "month"})
"""
import json
import urllib.parse
import urllib.request

BASE = "https://imszbjeyplaiovylhkgl.supabase.co"
ANON = "sb_publishable_DP66FFObEGagJknhGOz8xw_8KO8WIgD"
PIN = "x"
_HDR = {"apikey": ANON, "authorization": f"Bearer {ANON}", "content-type": "application/json"}


def read(view_or_table: str, params: dict | None = None) -> list:
    """GET via PostgREST. params = filtri PostgREST, es. {'year':'eq.2026','order':'month','limit':'50'}.
    Default select=* se non specificato."""
    q = dict(params or {})
    q.setdefault("select", "*")
    url = f"{BASE}/rest/v1/{view_or_table}?{urllib.parse.urlencode(q)}"
    req = urllib.request.Request(url, headers=_HDR)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())


def write(action: str, payload: dict, chi: str = "Cowork") -> dict:
    """POST a write-api. action ∈ {purchase,count,gift,b2b,product,order,order_multi,arrival,
    product_verify,expense_manual,expense_propose,expense_approve,sale_correct,return,qromo_sale}.
    Solleva RuntimeError sull'errore applicativo (es. validazione)."""
    body = json.dumps({"action": action, "payload": payload, "pin": PIN, "chi": chi}).encode()
    req = urllib.request.Request(f"{BASE}/functions/v1/write-api", data=body, headers=_HDR, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        detail = e.read().decode()
        raise RuntimeError(f"write-api {e.code}: {detail}") from None


# --- convenienze comuni ---
def inventory() -> list:
    return read("v_inventory", {"order": "giacenza_attuale"})


def reorder() -> list:
    """Cosa riprodurre: venduto 60g + stock + in arrivo."""
    return read("v_reorder", {"venduto_60d": "gt.0", "order": "venduto_60d.desc"})


def expenses_pending() -> list:
    return read("v_expenses_pending")


def propose_expense(operazione: str, costo: float, categoria: str, amimi: bool = True,
                    date_paid: str | None = None, note: str = "") -> dict:
    return write("expense_propose", {"operazione": operazione, "costo": costo, "categoria": categoria,
                                     "amimi": "si" if amimi else "no", "date_paid": date_paid, "note": note})


if __name__ == "__main__":
    # smoke test: lettura sola
    inv = inventory()
    print(f"OK — {len(inv)} prodotti in inventario; primo: {inv[0]['codice'] if inv else 'n/d'}")
