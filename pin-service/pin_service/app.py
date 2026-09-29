"""HTTP API the Fast Movie backend calls to rotate an expired profile's PIN.

POST /rotate-pin  (header x-service-key: $PIN_SERVICE_KEY)
{
  "masterEmail": "...", "masterPassword": "...", "accountPin": "1234" | null,
  "profileName": "n4v7wi", "newPin": "5831"
}
-> 200 {"success": true, "reason": "pin_changed", "profileName": ..., "steps": [...]}
-> 4xx/5xx {"success": false, "reason": "...", ...}
"""

from __future__ import annotations

import argparse
import hmac
import os
import threading
from dataclasses import asdict
from datetime import datetime
from uuid import uuid4

from flask import Flask, jsonify, request

from netflix_login_checker.core import DEFAULT_PROFILES_DIR, login_netflix

from .change_pin import change_profile_pin

# One browser at a time: jobs for the same master account share a browser profile.
_browser_lock = threading.Lock()


def create_app() -> Flask:
    app = Flask(__name__)
    service_key = os.environ.get("PIN_SERVICE_KEY", "")
    profiles_dir = os.environ.get("PIN_SERVICE_PROFILES_DIR", DEFAULT_PROFILES_DIR)
    headless = os.environ.get("PIN_SERVICE_HEADLESS", "true").strip().lower() not in {"0", "false", "no"}
    proxy_server = os.environ.get("PIN_SERVICE_PROXY") or None

    @app.get("/health")
    def health():
        return jsonify({"ok": True, "busy": _browser_lock.locked()})

    @app.post("/rotate-pin")
    def rotate_pin():
        if not service_key or not hmac.compare_digest(request.headers.get("x-service-key", ""), service_key):
            return _response(False, "unauthorized", 401)

        data = request.get_json(silent=True) or {}
        email = str(data.get("masterEmail") or "").strip()
        password = str(data.get("masterPassword") or "").rstrip("\r\n")
        account_pin = str(data.get("accountPin") or "").strip() or None
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
            login = login_netflix(
                email,
                password,
                headless=headless,
                persistent_profile=True,
                profiles_dir=profiles_dir,
                proxy_server=proxy_server,
                debug=debug,
                allow_manual_login=False,
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
                proxy_server=proxy_server,
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

    return app


def _response(success: bool, reason: str, status: int, **extra):
    return jsonify({"success": success, "reason": reason, **extra}), status


def _log(request_id: str, message: str) -> None:
    print(f"[{datetime.now().isoformat(timespec='seconds')}] [pin-service:{request_id}] {message}", flush=True)


def _mask_email(email: str) -> str:
    local, _, domain = email.partition("@")
    return f"{local[:2]}***@{domain}" if domain else "***"


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the profile PIN rotation API.")
    parser.add_argument("--host", default=os.environ.get("PIN_SERVICE_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("PIN_SERVICE_PORT", "5055")))
    args = parser.parse_args()
    if not os.environ.get("PIN_SERVICE_KEY"):
        raise SystemExit("Set PIN_SERVICE_KEY (shared secret with the backend) before starting.")
    # threaded: /health stays responsive while a rotation holds the browser lock.
    create_app().run(host=args.host, port=args.port, threaded=True)
