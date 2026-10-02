"""HTTP API the Fast Movie backend calls to rotate an expired profile's PIN.

POST /rotate-pin  (header x-service-key: $PIN_SERVICE_KEY)
{
  "masterEmail": "...", "masterPassword": "...", "accountPin": "1234" | null,
  "profileName": "n4v7wi", "newPin": "5831"
}
-> 200 {"success": true, "reason": "pin_changed", "profileName": ..., "steps": [...]}
-> 4xx/5xx {"success": false, "reason": "...", ...}

POST /profile-email  (same header)
{
  "action": "add" | "remove", "masterEmail": "...", "masterPassword": "...",
  "accountPin": "1234" | null, "mailboxPassword": "<Gmail app password>" | null,
  "profileName": "n4v7wi", "customerEmail": "buyer@example.com"   (add only)
}
-> 200 {"success": true, "reason": "email_added" | "email_removed" | "email_already_...", ...}
"""

from __future__ import annotations

import argparse
import hmac
import json
import os
import random
import threading
from dataclasses import asdict
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse
from uuid import uuid4

from flask import Flask, jsonify, request
from werkzeug.exceptions import HTTPException

from netflix_login_checker.core import DEFAULT_PROFILES_DIR, login_netflix, short_error

from .change_pin import change_profile_pin
from .otp_mail import mailbox_for, now_utc, wait_for_otp_candidates
from .profile_email import update_profile_email
from .reset_profile import reset_profile

# One browser at a time: jobs for the same master account share a browser profile.
_browser_lock = threading.Lock()
_bad_proxy_lock = threading.Lock()
_bad_proxy_until: dict[str, float] = {}


def create_app() -> Flask:
    app = Flask(__name__)
    service_key = os.environ.get("PIN_SERVICE_KEY", "")
    profiles_dir = os.environ.get("PIN_SERVICE_PROFILES_DIR", DEFAULT_PROFILES_DIR)
    headless = os.environ.get("PIN_SERVICE_HEADLESS", "true").strip().lower() not in {"0", "false", "no"}
    proxy_server = os.environ.get("PIN_SERVICE_PROXY") or None
    timeout_ms = _env_int("PIN_SERVICE_TIMEOUT_MS", 60000 if proxy_server else 30000)
    prefer_static_proxy = _env_bool("PIN_SERVICE_PROXY_PREFER_STATIC", bool(proxy_server))
    proxy_candidates = [] if prefer_static_proxy and proxy_server else _load_proxy_candidates()
    proxy_retries = _env_int("PIN_SERVICE_PROXY_RETRIES", 3 if proxy_candidates else 1)
    proxy_bad_ttl_s = _env_int("PIN_SERVICE_PROXY_BAD_TTL_SECONDS", 1800)

    @app.get("/health")
    def health():
        return jsonify({"ok": True, "busy": _browser_lock.locked()})

    @app.errorhandler(Exception)
    def unhandled_error(exc: Exception):
        request_id = uuid4().hex[:8]
        if isinstance(exc, HTTPException):
            reason = exc.description or exc.name
            _log(request_id, f"http_error status={exc.code} reason={short_error(exc)} path={request.path}")
            return _response(False, reason, exc.code or 500)

        reason = short_error(exc)
        _log(request_id, f"unhandled_error type={exc.__class__.__name__} reason={reason} path={request.path}")
        return _response(False, f"pin_service_error: {reason}", 502)

    @app.post("/rotate-pin")
    def rotate_pin():
        if not service_key or not hmac.compare_digest(request.headers.get("x-service-key", ""), service_key):
            return _response(False, "unauthorized", 401)

        data = request.get_json(silent=True) or {}
        email = str(data.get("masterEmail") or "").strip()
        password = str(data.get("masterPassword") or "").rstrip("\r\n")
        account_pin = str(data.get("accountPin") or "").strip() or None
        mailbox_password = str(data.get("mailboxPassword") or "").strip() or None
        profile_name = str(data.get("profileName") or "").strip()
        new_pin = str(data.get("newPin") or "").strip()
        if not email or not password or not profile_name:
            return _response(False, "missing_fields: masterEmail, masterPassword, profileName", 400)
        if not (len(new_pin) == 4 and new_pin.isdigit()):
            return _response(False, "newPin must be 4 digits", 400)

        request_id = uuid4().hex[:8]
        debug = lambda message: _log(request_id, message)  # noqa: E731
        _log(request_id, f"rotate_pin_received email={_mask_email(email)} profile={profile_name}")

        with _browser_lock:
            login, selected_proxy = _login_with_proxy_retries(
                email=email,
                password=password,
                headless=headless,
                profiles_dir=profiles_dir,
                static_proxy=proxy_server,
                proxy_candidates=proxy_candidates,
                max_attempts=proxy_retries,
                bad_ttl_s=proxy_bad_ttl_s,
                timeout_ms=timeout_ms,
                otp_code_provider=_login_otp_provider(email, mailbox_password, debug),
                debug=debug,
            )
            if not login.success:
                return _response(False, f"login_failed: {login.reason}", 502, profileName=profile_name)

            outcome = change_profile_pin(
                email=email,
                account_password=password,
                account_pin=account_pin,
                profile_name=profile_name,
                new_pin=new_pin,
                profiles_dir=profiles_dir,
                headless=headless,
                proxy_server=selected_proxy,
                timeout_ms=timeout_ms,
                debug=debug,
            )

        payload = asdict(outcome)
        return _response(
            outcome.success,
            outcome.reason,
            200 if outcome.success else 502,
            profileName=payload.pop("profile_name"),
            url=payload["url"],
            steps=payload["steps"],
        )

    @app.post("/profile-email")
    def profile_email():
        if not service_key or not hmac.compare_digest(request.headers.get("x-service-key", ""), service_key):
            return _response(False, "unauthorized", 401)

        data = request.get_json(silent=True) or {}
        action = str(data.get("action") or "").strip()
        email = str(data.get("masterEmail") or "").strip()
        password = str(data.get("masterPassword") or "").rstrip("\r\n")
        account_pin = str(data.get("accountPin") or "").strip() or None
        mailbox_password = str(data.get("mailboxPassword") or "").strip() or None
        profile_name = str(data.get("profileName") or "").strip()
        customer_email = str(data.get("customerEmail") or "").strip() or None
        if action not in ("add", "remove"):
            return _response(False, "action must be add or remove", 400)
        if not email or not password or not profile_name:
            return _response(False, "missing_fields: masterEmail, masterPassword, profileName", 400)
        if action == "add" and (not customer_email or "@" not in customer_email):
            return _response(False, "customerEmail required for add", 400)

        request_id = uuid4().hex[:8]
        debug = lambda message: _log(request_id, message)  # noqa: E731
        _log(
            request_id,
            f"profile_email_received action={action} email={_mask_email(email)} profile={profile_name}"
            + (f" customer={_mask_email(customer_email)}" if customer_email else ""),
        )

        with _browser_lock:
            login, selected_proxy = _login_with_proxy_retries(
                email=email,
                password=password,
                headless=headless,
                profiles_dir=profiles_dir,
                static_proxy=proxy_server,
                proxy_candidates=proxy_candidates,
                max_attempts=proxy_retries,
                bad_ttl_s=proxy_bad_ttl_s,
                timeout_ms=timeout_ms,
                otp_code_provider=_login_otp_provider(email, mailbox_password, debug),
                debug=debug,
            )
            if not login.success:
                return _response(False, f"login_failed: {login.reason}", 502, profileName=profile_name)

            outcome = update_profile_email(
                action=action,
                email=email,
                account_password=password,
                account_pin=account_pin,
                profile_name=profile_name,
                customer_email=customer_email,
                mailbox_password=mailbox_password,
                profiles_dir=profiles_dir,
                headless=headless,
                proxy_server=selected_proxy,
                timeout_ms=timeout_ms,
                debug=debug,
            )

        payload = asdict(outcome)
        return _response(
            outcome.success,
            outcome.reason,
            200 if outcome.success else 502,
            profileName=payload.pop("profile_name"),
            url=payload["url"],
            steps=payload["steps"],
        )

    @app.post("/reset-profile")
    def reset_profile_endpoint():
        if not service_key or not hmac.compare_digest(request.headers.get("x-service-key", ""), service_key):
            return _response(False, "unauthorized", 401)

        data = request.get_json(silent=True) or {}
        email = str(data.get("masterEmail") or "").strip()
        password = str(data.get("masterPassword") or "").rstrip("\r\n")
        account_pin = str(data.get("accountPin") or "").strip() or None
        mailbox_password = str(data.get("mailboxPassword") or "").strip() or None
        old_profile_name = str(data.get("profileName") or data.get("oldProfileName") or "").strip()
        new_profile_name = str(data.get("newProfileName") or "").strip() or None
        new_pin = str(data.get("newPin") or "").strip() or None
        if not email or not password or not old_profile_name:
            return _response(False, "missing_fields: masterEmail, masterPassword, profileName", 400)
        if new_pin is not None and not (len(new_pin) == 4 and new_pin.isdigit()):
            return _response(False, "newPin must be 4 digits", 400)

        request_id = uuid4().hex[:8]
        debug = lambda message: _log(request_id, message)  # noqa: E731
        _log(
            request_id,
            f"reset_profile_received email={_mask_email(email)} old_profile={old_profile_name}"
            + (f" new_profile={new_profile_name}" if new_profile_name else ""),
        )

        with _browser_lock:
            login, selected_proxy = _login_with_proxy_retries(
                email=email,
                password=password,
                headless=headless,
                profiles_dir=profiles_dir,
                static_proxy=proxy_server,
                proxy_candidates=proxy_candidates,
                max_attempts=proxy_retries,
                bad_ttl_s=proxy_bad_ttl_s,
                timeout_ms=timeout_ms,
                otp_code_provider=_login_otp_provider(email, mailbox_password, debug),
                debug=debug,
            )
            if not login.success:
                return _response(False, f"login_failed: {login.reason}", 502, profileName=old_profile_name)

            outcome = reset_profile(
                email=email,
                account_password=password,
                account_pin=account_pin,
                old_profile_name=old_profile_name,
                new_profile_name=new_profile_name,
                new_pin=new_pin,
                profiles_dir=profiles_dir,
                headless=headless,
                proxy_server=selected_proxy,
                timeout_ms=timeout_ms,
                otp_code_provider=_login_otp_provider(email, mailbox_password, debug, lengths=(6,)),
                debug=debug,
            )

        payload = asdict(outcome)
        return _response(
            outcome.success,
            outcome.reason,
            200 if outcome.success else 502,
            profileName=payload.pop("new_profile_name"),
            oldProfileName=payload.pop("old_profile_name"),
            newProfileName=outcome.new_profile_name,
            newPin=outcome.new_pin if outcome.success else None,
            url=payload["url"],
            steps=payload["steps"],
        )

    return app


def _response(success: bool, reason: str, status: int, **extra):
    return jsonify({"success": success, "reason": reason, **extra}), status


def _log(request_id: str, message: str) -> None:
    print(f"[{datetime.now().isoformat(timespec='seconds')}] [pin-service:{request_id}] {message}", flush=True)


def _login_otp_provider(email: str, mailbox_password: str | None, debug, *, lengths: tuple[int, ...] = (4,)):
    """Codes from the master mailbox: 4 digits for sign-in, 6 for account-change checks."""
    mailbox = mailbox_for(email, mailbox_password)
    if not mailbox:
        return None

    def provide_codes() -> list[str]:
        sent_at = now_utc()
        debug(f"login_otp_mail_wait mailbox={_mask_email(mailbox.user)} recipient={_mask_email(mailbox.recipient) if mailbox.recipient else '-'}")
        candidates = wait_for_otp_candidates(mailbox, sent_at, timeout_s=90, debug=debug)
        codes: list[str] = []
        seen: set[str] = set()
        for candidate in candidates:
            if len(candidate.code) not in lengths or candidate.code in seen:
                continue
            seen.add(candidate.code)
            codes.append(candidate.code)
            if len(codes) >= 5:
                break
        debug(f"login_otp_mail_codes count={len(codes)} source_count={len(candidates)}")
        return codes

    return provide_codes


def _login_with_proxy_retries(
    *,
    email: str,
    password: str,
    headless: bool,
    profiles_dir: str,
    static_proxy: str | None,
    proxy_candidates: list[dict],
    max_attempts: int,
    bad_ttl_s: int,
    timeout_ms: int,
    otp_code_provider,
    debug,
):
    attempts = max(1, max_attempts)
    tried: set[str] = set()
    last_login = None
    last_proxy = static_proxy

    for attempt in range(1, attempts + 1):
        selected = _choose_proxy(proxy_candidates, tried) if proxy_candidates else None
        proxy_server = selected["proxy"] if selected else static_proxy
        if proxy_server:
            tried.add(proxy_server)
        if selected:
            debug(
                "proxy_selected "
                f"attempt={attempt}/{attempts} server={_mask_proxy(proxy_server)} "
                f"protocol={selected.get('protocol') or '-'} country={selected.get('country') or '-'} "
                f"latency_ms={selected.get('latency_ms'):.1f} uptime={selected.get('uptime'):.1f}"
            )
        elif proxy_server:
            debug(f"proxy_selected attempt={attempt}/{attempts} server={_mask_proxy(proxy_server)} source=static")
        else:
            debug(f"proxy_selected attempt={attempt}/{attempts} server=disabled")

        login = login_netflix(
            email,
            password,
            headless=headless,
            persistent_profile=True,
            profiles_dir=profiles_dir,
            proxy_server=proxy_server,
            timeout_ms=timeout_ms,
            otp_code_provider=otp_code_provider,
            debug=debug,
            allow_manual_login=False,
        )
        last_login = login
        last_proxy = proxy_server
        if login.success or not proxy_candidates or not _is_retryable_login_failure(login.reason):
            if login.success and proxy_server:
                _clear_bad_proxy(proxy_server)
            return login, proxy_server
        if proxy_server:
            _mark_bad_proxy(proxy_server, bad_ttl_s)
        debug(f"proxy_retry reason={login.reason}")

    return last_login, last_proxy


def _load_proxy_candidates() -> list[dict]:
    path = os.environ.get("PIN_SERVICE_PROXY_LIST_FILE")
    inline_json = os.environ.get("PIN_SERVICE_PROXY_LIST_JSON")
    raw = None
    source = None
    try:
        if inline_json:
            raw = json.loads(inline_json)
            source = "env"
        elif path and Path(path).exists():
            raw = json.loads(Path(path).read_text(encoding="utf-8"))
            source = path
    except (OSError, json.JSONDecodeError) as exc:
        print(f"[pin-service] proxy_list_load_failed source={path or 'env'} reason={short_error(exc)}", flush=True)
        return []

    if raw is None:
        return []
    records = raw.get("proxies", raw) if isinstance(raw, dict) else raw
    if not isinstance(records, list):
        return []

    protocols = _env_set("PIN_SERVICE_PROXY_PROTOCOLS", {"http", "socks4", "socks5"})
    countries = _env_set("PIN_SERVICE_PROXY_COUNTRIES", None)
    require_ssl = _env_bool("PIN_SERVICE_PROXY_REQUIRE_SSL", True)
    allow_hosting = _env_bool("PIN_SERVICE_PROXY_ALLOW_HOSTING", True)
    max_latency = _env_float("PIN_SERVICE_PROXY_MAX_LATENCY_MS", 1500.0)
    min_uptime = _env_float("PIN_SERVICE_PROXY_MIN_UPTIME", 0.0)

    candidates: list[dict] = []
    for item in records:
        candidate = _normalize_proxy_candidate(item)
        if not candidate:
            continue
        if candidate.get("alive") is False:
            continue
        if require_ssl and candidate.get("ssl") is False:
            continue
        if protocols and candidate["protocol"] not in protocols:
            continue
        if countries and candidate.get("country") not in countries:
            continue
        if not allow_hosting and candidate.get("hosting") is True:
            continue
        if candidate["latency_ms"] > max_latency:
            continue
        if candidate.get("uptime", 0.0) < min_uptime:
            continue
        candidates.append(candidate)

    candidates.sort(key=lambda item: (item["latency_ms"], -item.get("uptime", 0.0)))
    limit = _env_int("PIN_SERVICE_PROXY_POOL_LIMIT", 200)
    candidates = candidates[:limit]
    print(
        f"[pin-service] proxy_list_loaded source={source} usable={len(candidates)} "
        f"max_latency_ms={max_latency} require_ssl={require_ssl}",
        flush=True,
    )
    return candidates


def _normalize_proxy_candidate(item) -> dict | None:
    if isinstance(item, str):
        proxy = item.strip()
        parsed = urlparse(proxy)
        if not parsed.scheme or not parsed.hostname:
            return None
        return {
            "proxy": proxy,
            "protocol": parsed.scheme.lower(),
            "country": None,
            "latency_ms": 999999.0,
            "uptime": 0.0,
            "alive": True,
            "ssl": True,
            "hosting": None,
        }
    if not isinstance(item, dict):
        return None

    proxy = str(item.get("proxy") or "").strip()
    protocol = str(item.get("protocol") or urlparse(proxy).scheme or "").strip().lower()
    ip = str(item.get("ip") or "").strip()
    port = item.get("port")
    if not proxy and protocol and ip and port:
        proxy = f"{protocol}://{ip}:{port}"
    if not proxy:
        return None
    parsed = urlparse(proxy)
    protocol = (protocol or parsed.scheme).lower()
    if protocol not in {"http", "https", "socks4", "socks5"}:
        return None

    ip_data = item.get("ip_data") if isinstance(item.get("ip_data"), dict) else {}
    latency = _number(item.get("timeout"), _number(item.get("average_timeout"), 999999.0))
    return {
        "proxy": proxy,
        "protocol": protocol,
        "country": ip_data.get("countryCode"),
        "latency_ms": latency,
        "uptime": _number(item.get("uptime"), 0.0),
        "alive": item.get("alive"),
        "ssl": item.get("ssl"),
        "hosting": ip_data.get("hosting"),
    }


def _choose_proxy(candidates: list[dict], tried: set[str]) -> dict | None:
    now = datetime.now().timestamp()
    remaining = [
        item
        for item in candidates
        if item["proxy"] not in tried and not _is_bad_proxy(item["proxy"], now)
    ]
    if not remaining:
        remaining = [item for item in candidates if item["proxy"] not in tried]
    if not remaining:
        remaining = [item for item in candidates if not _is_bad_proxy(item["proxy"], now)]
    if not remaining:
        remaining = candidates
    if not remaining:
        return None
    top_n = min(len(remaining), _env_int("PIN_SERVICE_PROXY_TOP_N", 25))
    return random.choice(remaining[:top_n])


def _mark_bad_proxy(proxy: str, ttl_s: int) -> None:
    with _bad_proxy_lock:
        _bad_proxy_until[proxy] = datetime.now().timestamp() + max(ttl_s, 1)


def _clear_bad_proxy(proxy: str) -> None:
    with _bad_proxy_lock:
        _bad_proxy_until.pop(proxy, None)


def _is_bad_proxy(proxy: str, now: float | None = None) -> bool:
    now = now or datetime.now().timestamp()
    with _bad_proxy_lock:
        until = _bad_proxy_until.get(proxy)
        if not until:
            return False
        if until <= now:
            _bad_proxy_until.pop(proxy, None)
            return False
        return True


def _is_retryable_login_failure(reason: str) -> bool:
    reason = reason.lower()
    return any(
        token in reason
        for token in (
            "timeout",
            "playwright_error",
            "something went wrong",
            "password_submit_not_found",
            "button_not_found",
            "page_not_ready",
            "input_not_filled",
            "session_not_logged_in",
        )
    )


def _mask_proxy(proxy: str | None) -> str:
    if not proxy:
        return "disabled"
    parsed = urlparse(proxy)
    if not parsed.hostname:
        return "***"
    host = parsed.hostname
    if host.replace(".", "").isdigit():
        parts = host.split(".")
        host = ".".join(parts[:2] + ["***", "***"]) if len(parts) == 4 else "***"
    else:
        pieces = host.split(".")
        host = f"{pieces[0][:2]}***.{'.'.join(pieces[1:])}" if len(pieces) > 1 else "***"
    port = f":{parsed.port}" if parsed.port else ""
    return f"{parsed.scheme}://{host}{port}"


def _mask_email(email: str) -> str:
    local, _, domain = email.partition("@")
    return f"{local[:2]}***@{domain}" if domain else "***"


def _env_int(name: str, default: int) -> int:
    value = os.environ.get(name)
    if not value:
        return default
    try:
        parsed = int(value)
    except ValueError:
        return default
    return parsed if parsed > 0 else default


def _env_float(name: str, default: float) -> float:
    value = os.environ.get(name)
    if not value:
        return default
    try:
        parsed = float(value)
    except ValueError:
        return default
    return parsed if parsed >= 0 else default


def _env_bool(name: str, default: bool) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() not in {"0", "false", "no", "off"}


def _env_set(name: str, default: set[str] | None) -> set[str] | None:
    value = os.environ.get(name)
    if not value:
        return default
    items = {item.strip().upper() for item in value.split(",") if item.strip()}
    if name == "PIN_SERVICE_PROXY_PROTOCOLS":
        return {item.lower() for item in items}
    return items or default


def _number(value, default: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the profile PIN rotation API.")
    parser.add_argument("--host", default=os.environ.get("PIN_SERVICE_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("PIN_SERVICE_PORT", "5055")))
    args = parser.parse_args()
    if not os.environ.get("PIN_SERVICE_KEY"):
        raise SystemExit("Set PIN_SERVICE_KEY (shared secret with the backend) before starting.")
    # threaded: /health stays responsive while a rotation holds the browser lock.
    create_app().run(host=args.host, port=args.port, threaded=True)
