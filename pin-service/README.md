# Profile PIN service

Python API that changes the profile-lock PIN of a Netflix profile when its
rental has expired, so the previous customer can no longer use it. The Fast
Movie backend calls it; it reuses the login and profile code from
`../tools/netflix_login_checker`.

## Flow

1. The backend worker finds rentals that have expired, holds the slot
   (`reserved`, not for sale) and calls `POST /rotate-pin` with the master
   email, password, account PIN, profile name and a new 4-digit PIN.
2. This service logs in (skipped when the saved browser session is still
   signed in), opens the profile's Profile Lock settings and saves the new PIN.
3. On success the backend stores the new PIN, puts the slot back on sale,
   marks the rental `expired` and emails the customer. On failure it retries
   (3 attempts in total), then leaves the slot `reserved` for an admin.

## Profile email flow

- **Purchase:** right after a customer buys a slot, the backend worker calls
  `POST /profile-email` with `action: "add"` and the customer's account email.
  The service opens the profile's *Edit profile* page → email link → verifies
  identity → fills the email → "เพิ่มอีเมล" → "บันทึก". The backend keeps the
  email in `profiles.metadata.profileEmail` (3 attempts, then logged as
  `profile_email_add_failed` for an admin).
- **Expiry:** before rotating the PIN, the worker calls `action: "remove"`
  (email link → "ลบอีเมล" → "บันทึก"). A failure counts as a failed rotation
  and is retried; the slot stays `reserved` until both steps succeed.
- **Identity check:** if Netflix offers the password option it is used.
  Otherwise "ส่งรหัสทางอีเมล" is clicked and the 6-digit code is read from the
  master email's inbox over IMAP: codes received after the click are tried
  closest-in-time first (others cover a parallel request); if none work, the
  code is re-sent once. Mailbox login is the master email + its **Gmail App
  Password** (set per master email in the admin page), or a shared inbox that
  receives forwarded Netflix mail via `OTP_IMAP_USER` / `OTP_IMAP_PASSWORD`.

## Run

```bash
pip install -r pin-service/requirements.txt
python -m playwright install chromium
PIN_SERVICE_KEY=change-me python pin-service/run.py        # http://127.0.0.1:5055
```

Docker (from the repository root):

```bash
docker build -f pin-service/Dockerfile -t fastmovie-pin-service .
docker run -d --name fastmovie-pin-service -p 5055:5055 \
  -e PIN_SERVICE_KEY=change-me -v pin_profiles:/data/profiles fastmovie-pin-service
```

| Env | Default | |
|---|---|---|
| `PIN_SERVICE_KEY` | — (required) | shared secret, sent by the backend as `x-service-key` |
| `PIN_SERVICE_HOST` / `PIN_SERVICE_PORT` | `127.0.0.1` / `5055` | |
| `PIN_SERVICE_HEADLESS` | `true` | `false` to watch the browser |
| `PIN_SERVICE_PROFILES_DIR` | `.netflix_profiles` | saved browser sessions, one per master email |
| `PIN_SERVICE_PROXY` | — | e.g. `socks5://host:1080` |
| `PIN_SERVICE_PROXY_PREFER_STATIC` | `true` when `PIN_SERVICE_PROXY` is set | use `PIN_SERVICE_PROXY` instead of the proxy list |
| `PIN_SERVICE_PROXY_LIST_FILE` | — | JSON proxy list; when set, each request randomly uses a low-latency proxy from the list |
| `PIN_SERVICE_PROXY_PROTOCOLS` | `http,socks5` | protocols accepted from the proxy list |
| `PIN_SERVICE_PROXY_TOP_N` | `8` | randomize within the N lowest-latency usable proxies |
| `PIN_SERVICE_PROXY_RETRIES` | `5` with a proxy list, otherwise `1` | retry login with another proxy for timeout/network-like failures |
| `PIN_SERVICE_PROXY_MAX_LATENCY_MS` | `1500` | ignore proxies slower than this `timeout` value |
| `PIN_SERVICE_PROXY_COUNTRIES` | `TH,VN,ID,HK,TW,PH,KR,JP,SG` | optional comma-separated country codes |
| `PIN_SERVICE_PROXY_ALLOW_HOSTING` | `false` | include datacenter/hosting proxies from the list |
| `PIN_SERVICE_PROXY_BAD_TTL_SECONDS` | `1800` | avoid a failed proxy for this many seconds |
| `OTP_IMAP_HOST` | `imap.gmail.com` | mailbox for Netflix verification codes |
| `OTP_IMAP_USER` / `OTP_IMAP_PASSWORD` | — | shared inbox, used when a master email has no App Password |

Backend side (`backend/.env`): `PIN_SERVICE_URL=http://<host>:5055` and the same
`PIN_SERVICE_KEY`. The rotation worker stays off until both are set.

## API

`POST /rotate-pin` with header `x-service-key`:

```json
{ "masterEmail": "a@b.com", "masterPassword": "...", "accountPin": "1234",
  "profileName": "n4v7wi", "newPin": "5831" }
```

`POST /profile-email` with the same header:

```json
{ "action": "add", "masterEmail": "a@b.com", "masterPassword": "...", "accountPin": "1234",
  "mailboxPassword": "abcd efgh ijkl mnop", "profileName": "n4v7wi",
  "customerEmail": "buyer@example.com" }
```

`action: "remove"` takes the same fields without `customerEmail`.

Both return `200 {"success": true, "reason": "...", ...}` or an error status with
`{"success": false, "reason": "..."}`. `GET /health` reports whether a job is running.
