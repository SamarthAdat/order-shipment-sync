# order-shipment-sync

A small Node.js service that receives a store's `orders/create` webhook and
creates **exactly one** shipment per order with a courier, even though the
courier fails, rate-limits, and sometimes times out *after* creating the
shipment, and even though the store can send the same webhook more than once.

No dependencies: only Node.js built-ins (`node:http`, `node:sqlite`,
`node:crypto`, `node:test`, `fetch`).

## Run it

Requires **Node.js 22.13 or newer**. Nothing to install.

```bash
npm start
```

This starts the mock courier on `:4000` and the service on `:3000`. In a
second terminal:

```bash
npm run send-webhook
```

It sends a signed webhook, the same webhook again, and one with a bad
signature:

```
1. new webhook   -> 200 {"ok":true}
2. duplicate     -> 200 {"ok":true,"duplicate":true}
3. bad signature -> 401 {"error":"invalid signature"}
```

Then watch the first terminal: the worker creates the shipment, retrying
through the courier's errors.

Other commands:

| Command | What it does |
|---|---|
| `npm test` | runs the tests |
| `npm run reconcile` | fixes orders stuck without a confirmed shipment |
| `npm run replay` | lists parked (failed) orders |
| `npm run replay -- <orderId>` | puts a parked order back in the queue |

Settings (all optional):

| Env var | Default |
|---|---|
| `WEBHOOK_SECRET` | `dev-secret` (local only, set a real one) |
| `PORT` | `3000` |
| `COURIER_PORT` | `4000` |
| `COURIER_URL` | `http://localhost:4000` |
| `DB_PATH` | `orders.db` |

On Node 22 you'll see an `ExperimentalWarning` for SQLite. It's harmless.

### With curl

In bash (on Windows, Git Bash works):

```bash
SECRET=dev-secret
BODY='{"id":1001,"shipping_address":{"city":"Bengaluru"},"line_items":[{"sku":"A1","quantity":1}]}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -binary | base64)

# send it twice: the second reply says "duplicate": true
for i in 1 2; do
  curl -s -X POST localhost:3000/webhooks/orders-create \
    -H "Content-Type: application/json" \
    -H "X-Shop-Webhook-Id: demo-1001" \
    -H "X-Shop-Hmac-Sha256: $SIG" \
    -d "$BODY"; echo
done
```

## How it works

```
store --webhook--> server --saves order (status: pending)--> SQLite
                                                               |
                     courier <--check, then create-- worker <--+
```

**Webhook** (`src/server.js`)
1. Check the HMAC signature over the raw body. Wrong or missing gives `401`.
2. In one transaction, save the webhook id and the order. If either was
   already saved, it's a duplicate: reply `200` and do nothing else.
3. Reply `200`. No courier call happens here, so it takes milliseconds.

**Worker** (`src/worker.js`), every 500 ms, one order at a time:
1. **Check first:** `GET /shipments?reference=<orderId>`. If a shipment
   exists, record it. Done.
2. Otherwise `POST /shipments`, with a 5 s timeout.
3. On `201`, record the shipment. Otherwise:

| Courier result | What happens |
|---|---|
| `429` | wait `Retry-After` seconds, then retry |
| `5xx`, timeout, network error | retry after 1s, 2s, 4s, 8s (max 60s) |
| other `4xx` | park now (retrying won't fix a bad request) |

After 5 failed attempts the order is **parked** (`status = 'failed'`, with
the last error saved). `npm run replay` shows parked orders and puts them
back.

**Reconcile** (`src/reconcile.js`) finds orders still `pending` or
`processing` after 5 minutes (for example, the service crashed mid-call).
For each one it asks the courier by reference: if the shipment exists, it
records it; if not, it puts the order back in the queue for the worker.

## Design decisions

- **Queue: SQLite table, not BullMQ/Redis or an in-memory queue.** An
  in-memory queue loses jobs on restart. BullMQ is solid but needs Redis
  running, which is a lot for one job type. A table in the same database
  survives restarts, needs nothing extra, and lets me save the order and
  queue the job in **one transaction**, so they can never disagree. The cost:
  the worker polls (up to 500 ms delay), and it's built for one worker
  process. More workers would need proper row locking (e.g. Postgres
  `FOR UPDATE SKIP LOCKED`) or a real queue.
- **The order row is the job.** `status`, `attempts` and `next_attempt_at`
  live on the order. There's one table to look at, and "where is my order?"
  has one answer.
- **Idempotency from unique keys.** `webhooks.webhook_id` and `orders.id` are
  primary keys, and inserts use `INSERT OR IGNORE`. A duplicate webhook (same
  webhook id *or* same order id) is ignored at the database level, so there's
  no race between "check" and "insert". Order ids are stored as text, so
  `123` and `"123"` are the same order.
- **Check before every create.** The courier isn't idempotent, and a timeout
  doesn't tell us whether the shipment was made. So every attempt first asks
  `GET /shipments?reference=<orderId>`. A shipment created before a timeout
  is found on the next attempt and never created twice.
- **Only the worker creates shipments.** Reconcile and replay never call
  `POST`; they only record a found shipment or hand the order back to the
  worker. One place creates shipments, so there's one place to get right.
- **Duplicates get `200`, not an error.** A non-2xx reply makes the store
  re-send, which is the opposite of what we want.
- **Mock courier change:** the random failures apply only to `POST`. `GET`
  always works, so the lookup is reliable. It's in the repo as
  `mock-courier.js`.

## What I'd do next with another day

- Add jitter to the backoff, so many orders failing at once don't retry in
  lockstep.
- Run reconcile on a schedule inside the service instead of by hand.
- Move to Postgres with `SKIP LOCKED` (or BullMQ) to run several workers.
- Alert when the number of parked orders goes up, and add basic metrics.
- Limit request body size and add structured (JSON) logs.
- A small authenticated endpoint to list and replay parked orders.

## What I left out on purpose

- Docker / docker-compose: with no dependencies and SQLite, `npm start` is
  already one command.
- TypeScript, Express, validation or queue libraries, to keep it small.
- Multiple workers and horizontal scaling (see the queue trade-off above).
- A UI or auth for replay: it's a CLI script.

## Tests

`npm test` runs 39 tests. They focus on what's most likely to break:
signature checks, duplicate webhooks, the courier timing out after creating
a shipment, `429`/`5xx` retries, parking, and reconcile. Most use an
in-memory database and a fake courier. The courier client tests run against
the real mock courier with its randomness fixed.

## Time spent

About X hours.
