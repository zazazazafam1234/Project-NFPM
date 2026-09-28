# PromptPay + LINE Top-up Flow

## Services

- `backend`: creates pending PromptPay top-ups and exposes `/api/points/top-ups`.
- `line-worker`: runs separately in Docker, listens to LINE bank notifications, matches incoming transfer amounts, and credits points.

## Required Environment

```env
PROMPTPAY_ID="0812345678"
TOPUP_EXPIRES_MINUTES=15
LINE_COOKIE="lct=..."
LINE_REVISION_FILE="/app/data/line_revision.txt"
```

If `LINE_COOKIE` is empty, the Docker service stays alive but disabled so the rest of the app can run.

## User Flow

1. User selects an integer point package, for example `150`.
2. Backend creates `point_topups` with a unique decimal ref, for example `150.37`.
3. Backend returns PromptPay QR payload/image and pending status.
4. Frontend polls `/api/points/top-ups/:id`.
5. `line-worker` receives bank LINE message and parses incoming amount.
6. If the incoming amount exactly matches a pending `payable_amount_cents`, backend marks it `paid`, inserts a `Transaction`, and adds points to the user.
7. Frontend poll sees `paid`, refreshes the session, and alerts success.

Amounts are stored and matched in satang integer units to avoid floating point rounding bugs.
