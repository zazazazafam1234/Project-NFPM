# Streaming Inventory Design

This backend now supports the newer streaming-profile inventory model alongside the existing Room/Plan flow.

## Data Model

- `packages`: storefront packages such as Netflix weekly/monthly. A package has `service`, `duration_days`, `price_amount`, and lifecycle status.
- `master_emails`: real parent streaming accounts. Passwords are stored in `password_ciphertext`, not plaintext.
- `profiles`: rentable profiles under one `master_email`. Profile PIN/password is stored in `profile_pin_ciphertext`.
- `subscriptions`: purchase/rental records tying a `User`, `profile`, and `package` together.
- `subscription_events`: append-only event history for creation and renewal.
- `admin_audit_logs`: reserved for admin inventory/security actions.

The old `"Room"`, `"Plan"`, and `"Order"` tables are intentionally left in place for compatibility with the current UI.

## Stock Query

Use:

```http
GET /api/catalog/packages
```

It returns only active packages and calculates `availableStock` from profiles that:

- are `available`
- are not soft-deleted
- belong to an active, non-expired `master_email`
- can remain valid through the full package duration
- do not have a pending/active subscription overlapping the current time

## Purchase Flow

Use:

```http
POST /api/subscriptions
Content-Type: application/json

{
  "packageSlug": "netflix-week",
  "paymentMethod": "points"
}
```

The endpoint runs inside one PostgreSQL transaction:

1. Lock the user row with `FOR UPDATE`.
2. Validate point balance.
3. Pick one available profile using `FOR UPDATE OF p SKIP LOCKED`.
4. Deduct points.
5. Mark the profile as `rented`.
6. Insert a `subscriptions` row.
7. Insert a debit `Transaction`.
8. Return decrypted credentials only in this success response.

`SKIP LOCKED` lets concurrent buyers skip a profile already being purchased and take the next valid profile instead of waiting or double-booking.

## Renewal Flow

Use:

```http
POST /api/subscriptions/:id/renew
```

Renewal creates a new `subscriptions` row with `parent_subscription_id`, starting from the later of `now()` or the current subscription expiry. PostgreSQL also enforces `subscriptions_no_profile_time_overlap`, an exclusion constraint that prevents overlapping rental windows for the same profile.

## Credential Encryption

Encryption is handled at the application layer with AES-256-GCM in `src/crypto.ts`.

Recommended production setup:

- Set `CREDENTIAL_ENCRYPTION_KEY` to a random 32-byte base64 key.
- Store this key outside Git, for example in Docker/host secrets.
- Rotate by adding a new versioned encryption helper before re-encrypting old records.
- Never log decrypted master passwords, profile PINs, request bodies containing secrets, or API responses containing secrets.
- Return credentials only immediately after a successful purchase, or from a dedicated authenticated endpoint that verifies ownership and rate-limits access.

`pgcrypto` is enabled for UUID generation and future DB-side crypto support, but keeping decrypt permissions in Hono.js keeps plaintext out of SQL logs and makes key management easier to isolate from the database.
