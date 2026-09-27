# Fast Movie API contract

Set `NEXT_PUBLIC_API_URL` to your API root. The frontend sends cookies using `credentials: "include"`; configure CORS to allow the web origin and credentials, and issue the session cookie as `HttpOnly`, `Secure` in production, and `SameSite=Lax`.

## Authentication

### `GET /auth/google?redirectTo={url}`

Starts Google OAuth on the server. On success, create a session cookie and redirect to `redirectTo`.

### `GET /auth/session`

Returns the logged-in account and the current point balance.

```json
{
  "user": {
    "id": "usr_123",
    "name": "Jane Doe",
    "email": "jane@example.com",
    "image": "https://...",
    "points": 320
  }
}
```

Return `{ "user": null }` for a guest.

### `POST /auth/logout`

Clears the session cookie and returns `204` or JSON.

## Checkout

### `GET /catalog/packages`

Returns active streaming packages with live stock calculated from available profiles under active master emails.

```json
[
  {
    "id": "pkg_uuid",
    "slug": "netflix-week",
    "name": "Netflix รายสัปดาห์",
    "service": "netflix",
    "durationDays": 7,
    "priceAmount": 49,
    "currency": "THB",
    "availableStock": 3
  }
]
```

### `POST /subscriptions`

New streaming-profile purchase flow.

```json
{
  "packageSlug": "netflix-week",
  "paymentMethod": "points"
}
```

For `points`, the server locks the user row, selects one available profile using `FOR UPDATE SKIP LOCKED`, deducts points, creates a subscription, and returns credentials only after the transaction succeeds.

```json
{
  "subscriptionId": "sub_uuid",
  "status": "active",
  "startedAt": "2026-09-27T07:00:00.000Z",
  "expiresAt": "2026-10-04T07:00:00.000Z",
  "points": 271,
  "credentials": {
    "email": "account@example.com",
    "password": "decrypted-once",
    "profileName": "Profile 1",
    "pin": "1234"
  }
}
```

### `POST /subscriptions/:id/renew`

Creates a renewal subscription for the same profile. The database prevents overlapping rental periods for the same profile.

### `POST /orders`

Legacy Room/Plan checkout flow used by the current UI.


```json
{
  "roomId": "room-1",
  "planId": "week",
  "paymentMethod": "points"
}
```

Allowed `paymentMethod`: `points`, `promptpay`, `wallet`.

For `points`, verify room availability and balance server-side, atomically deduct points, create the order, then return the new balance. Never trust the point balance or price sent by the client.

```json
{
  "orderId": "ord_123",
  "status": "paid",
  "points": 271
}
```

For PromptPay/Wallet, create a pending order and return your payment payload/QR reference.

## Point top-up

### `POST /points/top-ups`

```json
{
  "points": 150,
  "amount": 150,
  "paymentMethod": "promptpay"
}
```

Allowed `paymentMethod`: `promptpay`, `wallet`. Create a pending top-up and return the QR/payment reference. Only add points after your payment provider or slip-verification flow confirms the payment server-side.

## Point history (for the Profile page)

`GET /profile/transactions`

Return transactions with `id`, `type`, `amount`, `description`, and `createdAt`.

## Admin

All `/admin/*` endpoints must require an admin role on the server. Never rely on hiding frontend routes as authorization.

- `GET /admin/overview` — metrics, room status, live activity
- `GET /admin/rooms`, `POST /admin/rooms`, `PATCH /admin/rooms/:id`
- `GET /admin/users`
- `GET /admin/config`, `PATCH /admin/config`
- `GET /admin/point-packages`, `PATCH /admin/point-packages/:id`
- `GET /admin/promotions`, `PATCH /admin/promotions/:id`
