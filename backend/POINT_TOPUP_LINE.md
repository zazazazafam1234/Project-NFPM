# PromptPay + LINE Top-up Flow

## Services

- `backend`: creates pending PromptPay top-ups and exposes `/api/points/top-ups`.
- `line-worker`: runs separately in Docker, listens to LINE bank notifications, matches incoming transfer amounts, and credits points.
- Admin `ตั้งค่าระบบ`: manages payment accounts. Each account stores encrypted PromptPay ID, encrypted LINE cookie, and QR expiry minutes. One active account can be selected as the default top-up account.

## Required Environment

```env
CREDENTIAL_ENCRYPTION_KEY="base64-encoded-32-byte-key"
LINE_REVISION_DIR="/app/data"
LINE_ACCOUNTS_RELOAD_MS=30000
```

PromptPay ID, LINE cookie, and QR expiry are stored in `payment_accounts` from Admin. The worker reloads active accounts periodically, so adding or editing an account does not require a rebuild.

## User Flow

1. User selects an integer point package, for example `150`.
2. Backend selects the default active payment account and creates `point_topups` with a unique decimal ref for that account, for example `150.37`.
3. Backend returns PromptPay QR payload/image and pending status.
4. Frontend polls `/api/points/top-ups/:id`.
5. `line-worker` receives bank LINE message from the matching account cookie and parses incoming amount.
6. Backend saves every incoming transfer notification to `line_transfer_events` with revision, amount, LINE transaction date, destination account, sender name, balance, raw message, and match status.
7. If the incoming amount exactly matches a pending `payable_amount_cents` for that payment account, backend marks it `paid`, links the transfer event to the top-up, inserts a `Transaction`, and adds points to the user.
8. Frontend poll sees `paid`, refreshes the session, and alerts success.

Amounts are stored and matched in satang integer units to avoid floating point rounding bugs.
