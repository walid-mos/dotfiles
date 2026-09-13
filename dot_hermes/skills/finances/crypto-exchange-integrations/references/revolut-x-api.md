# Revolut X API — validated notes (2026-09)

Status: keypair generated and ready; API key from the account owner **not yet received**, so
authenticated calls are UNTESTED. Everything below is from official docs (developer.revolut.com,
github.com/revolut-engineering/revolut-x-api) and web search — treat signing code as verified-in-design,
the end-to-end flow as pending first live call.

## Auth model

- Base URL: `https://revx.revolut.com/api/1.0` (prod); dev: `https://revx.revolut.codes/api/1.0`
- Three headers on every authenticated request:
  - `X-Revx-API-Key` — 64-char alphanumeric key created by the account owner in Revolut X web
  - `X-Revx-Timestamp` — Unix ms
  - `X-Revx-Signature` — Ed25519 signature, base64
- Message to sign (no separators): `{timestamp}{HTTP_METHOD}{path}{query}{body}`
  - path starts at `/api`, e.g. `/api/1.0/balances`; query without `?`; body = minified JSON (empty for GET)
- Public endpoints (`/public/...`) need no auth (market data, order books).

## Key generation (macOS — system openssl CANNOT do ed25519)

`openssl genpkey -algorithm ed25519` fails on macOS LibreSSL with `Algorithm ed25519 not found`.
Use Python `cryptography` (PEP 668 → needs venv; a venv exists at `~/Documents/Hermes/revolut-x-tracker/.venv`):

```python
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives import serialization
key = Ed25519PrivateKey.generate()
priv = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
pub  = key.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
open('private.pem','wb').write(priv); open('public.pem','wb').write(pub)
```

Keypair already generated at `~/Documents/Hermes/revolut-x-tracker/keys/{private,public}.pem` (2026-09-01).
Public key handed to Walid's sister for pasting into Revolut X (Profile → API keys → + New).
Do NOT regenerate without need — the public key may already be registered in her Revolut X account.

## Endpoints needed for tracking

- `GET /balances` — all crypto + fiat balances (available/reserved/total per currency). This is the core one.
- `GET /configuration/currencies`, `GET /configuration/pairs` — instrument metadata
- `GET /orders/active`, `DELETE /orders` — order management (NOT needed for read-only tracking)
- Trade history endpoints exist (`revx trade private`) for realized P/L later.

## revx CLI quick reference (official, `npm install -g @revolut/revolut-x-cli`)

```
revx configure                 # set API key + private key path
revx account balances          # non-zero balances
revx account balances --currencies BTC,ETH,USD
revx market tickers            # live prices from the exchange itself
revx monitor price BTC-USD --direction above --threshold 100000
```

There is also an official MCP server and a community one (`Bilel-Eljaamii/revolutx-mcp`, env vars
`REVOLUTX_API_KEY` + `REVOLUTX_PRIVATE_KEY`) if Hermes MCP integration is preferred over CLI calls.

## Signing sketch (Python, untested against live API)

```python
import base64, time
from cryptography.hazmat.primitives import serialization
priv = serialization.load_pem_private_key(open('keys/private.pem','rb').read(), password=None)
ts = str(int(time.time()*1000))
msg = f"{ts}GET/api/1.0/balances".encode()
sig = base64.b64encode(priv.sign(msg)).decode()
# headers: X-Revx-API-Key, X-Revx-Timestamp: ts, X-Revx-Signature: sig
```

## First-call checklist

1. Get the 64-char API key from the sister.
2. `revx configure` (or test the signing sketch) with key + `keys/private.pem`.
3. `GET /balances` → expect 200 with a bare JSON array of `AccountBalanceEntry`.
4. 401/403 → timestamp skew (check ms clock), wrong message string, or key permissions.
