from __future__ import annotations

import argparse
from dataclasses import asdict
from datetime import datetime
from uuid import uuid4

from flask import Flask, jsonify, request

from .core import DEFAULT_PROFILES_DIR, DEFAULT_SESSION_URL, check_netflix_session, login_netflix


def create_app() -> Flask:
    app = Flask(__name__)

    @app.get("/health")
    def health():
        return jsonify({"ok": True})

    @app.post("/check-netflix-login")
    def check_netflix_login():
        data = request.get_json(silent=True) or {}
        request_id = uuid4().hex[:8]
        email = _clean_credential(data.get("email"))
        password = _clean_credential(data.get("password"))
        mode = str(data.get("mode") or "login").strip().lower()
        profile_name = _clean_credential(data.get("profile_name")) or None
        profiles_dir = data.get("profiles_dir") or DEFAULT_PROFILES_DIR
        headless = _parse_bool(data.get("headless"), default=False)
        debug_enabled = _parse_bool(data.get("debug"), default=True)
        use_profile = _parse_bool(data.get("use_profile"), default=True)
        clear_cache = _parse_bool(data.get("clear_cache"), default=not use_profile)

        _server_debug(
            request_id,
            "request_received "
            f"mode={mode} email={_mask_email(email)} profile_name={profile_name or '-'} "
            f"headless={headless} debug={debug_enabled} use_profile={use_profile} clear_cache={clear_cache}",
        )

        if mode == "check_session":
            if not email and not profile_name:
                return _json_response(
                    {
                        "success": False,
                        "reason": "missing_profile: send email or profile_name",
                        "url": data.get("session_url") or DEFAULT_SESSION_URL,
                    },
                    400,
                )

            result = check_netflix_session(
                email=email or None,
                profile_name=profile_name,
                profiles_dir=profiles_dir,
                session_url=data.get("session_url") or DEFAULT_SESSION_URL,
                headless=headless,
                timeout_ms=int(data.get("timeout_ms", 30000)),
                slow_mo_ms=int(data.get("slow_mo_ms", 0)),
                debug=(lambda message: _server_debug(request_id, message)) if debug_enabled else None,
            )
            http_status = 200 if result.success else _status_for_failure(result.reason)
            _server_debug(
                request_id,
                f"request_finished status={http_status} success={result.success} reason={result.reason} url={result.url}",
            )
            return _json_response(asdict(result), http_status)

        if mode != "login":
            return _json_response(
                {
                    "success": False,
                    "reason": "invalid_mode: use login or check_session",
                    "url": data.get("login_url") or "https://www.netflix.com/th-en/login",
                },
                400,
            )

        if not email or not password:
            return _json_response(
                {
                    "success": False,
                    "reason": "missing_credentials: send JSON email and password",
                    "url": data.get("login_url") or "https://www.netflix.com/th-en/login",
                },
                400,
            )

        result = login_netflix(
            email,
            password,
            login_url=data.get("login_url") or "https://www.netflix.com/th-en/login",
            headless=headless,
            timeout_ms=int(data.get("timeout_ms", 30000)),
            slow_mo_ms=int(data.get("slow_mo_ms", 0)),
            clear_cache=clear_cache,
            persistent_profile=use_profile,
            profile_name=profile_name,
            profiles_dir=profiles_dir,
            debug=(lambda message: _server_debug(request_id, message)) if debug_enabled else None,
        )
        http_status = 200 if result.success else _status_for_failure(result.reason)
        _server_debug(
            request_id,
            f"request_finished status={http_status} success={result.success} reason={result.reason} url={result.url}",
        )
        return _json_response(asdict(result), http_status)

    return app


def _clean_credential(value: object) -> str:
    if value is None:
        return ""
    return str(value).rstrip("\r\n")


def _status_for_failure(reason: str) -> int:
    if "Playwright is not installed" in reason:
        return 500
    return 401


def _json_response(payload: dict, http_status: int):
    body = {
        "status": _status_label(payload.get("success", False), http_status),
        "http_status": http_status,
        **payload,
    }
    return jsonify(body), http_status


def _status_label(success: bool, http_status: int) -> str:
    if success:
        return "success"
    if http_status >= 500:
        return "error"
    return "failed"


def _parse_bool(value: object, *, default: bool) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"1", "true", "yes", "y", "on"}:
            return True
        if normalized in {"0", "false", "no", "n", "off"}:
            return False
    return default


def _server_debug(request_id: str, message: str) -> None:
    timestamp = datetime.now().isoformat(timespec="seconds")
    print(f"[{timestamp}] [netflix-login:{request_id}] {message}", flush=True)


def _mask_email(email: str) -> str:
    if "@" not in email:
        return "***"
    local, domain = email.split("@", 1)
    if not local:
        return f"***@{domain}"
    return f"{local[:2]}***@{domain}"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the Netflix login checker Flask server.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=5000)
    parser.add_argument("--debug", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    app = create_app()
    app.run(host=args.host, port=args.port, debug=args.debug)


if __name__ == "__main__":
    main()
