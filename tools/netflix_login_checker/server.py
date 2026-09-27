from __future__ import annotations

import argparse
import json
from dataclasses import asdict
from datetime import datetime
from uuid import uuid4

from flask import Flask, jsonify, request

from .core import DEFAULT_PROFILES_DIR, DEFAULT_SESSION_URL, check_netflix_session, login_netflix
from .post_login_workflow import run_post_login_workflow


def create_app() -> Flask:
    app = Flask(__name__)

    @app.get("/health")
    def health():
        return jsonify({"ok": True})

    @app.post("/check-netflix-login")
    def check_netflix_login():
        data = _request_json()
        request_id = uuid4().hex[:8]
        if data is None:
            return _json_response(
                {
                    "success": False,
                    "reason": "invalid_json: send a valid JSON object",
                    "url": "https://www.netflix.com/th-en/login",
                },
                400,
            )

        email = _clean_credential(data.get("email"))
        password = _clean_credential(data.get("password"))
        mode = str(data.get("mode") or "login").strip().lower()
        profile_name = _clean_credential(data.get("profile_name")) or None
        profiles_dir = data.get("profiles_dir") or DEFAULT_PROFILES_DIR
        proxy_server = _clean_credential(data.get("proxy_server") or data.get("proxy")) or None
        headless = _parse_bool(data.get("headless"), default=False)
        debug_enabled = _parse_bool(data.get("debug"), default=True)
        use_profile = _parse_bool(data.get("use_profile"), default=True)
        clear_cache = _parse_bool(data.get("clear_cache"), default=not use_profile)
        allow_manual_login = _parse_bool(data.get("allow_manual_login"), default=not headless)
        manual_login_timeout_ms = int(data.get("manual_login_timeout_ms", 300000))

        _server_debug(
            request_id,
            "request_received "
            f"mode={mode} email={_mask_email(email)} profile_name={profile_name or '-'} "
            f"headless={headless} debug={debug_enabled} use_profile={use_profile} "
            f"clear_cache={clear_cache} allow_manual_login={allow_manual_login}",
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
                proxy_server=proxy_server,
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
            proxy_server=proxy_server,
            clear_cache=clear_cache,
            persistent_profile=use_profile,
            profile_name=profile_name,
            profiles_dir=profiles_dir,
            debug=(lambda message: _server_debug(request_id, message)) if debug_enabled else None,
            allow_manual_login=allow_manual_login,
            manual_login_timeout_ms=manual_login_timeout_ms,
        )
        http_status = 200 if result.success else _status_for_failure(result.reason)
        _server_debug(
            request_id,
            f"request_finished status={http_status} success={result.success} reason={result.reason} url={result.url}",
        )
        return _json_response(asdict(result), http_status)

    @app.post("/doit")
    def doit():
        data = _request_json()
        request_id = uuid4().hex[:8]
        if data is None:
            return _json_response(
                {
                    "success": False,
                    "phase": "request",
                    "reason": "invalid_json: send a valid JSON object",
                    "url": "https://www.netflix.com/th-en/login",
                },
                400,
            )

        email = _clean_credential(data.get("email"))
        password = _clean_credential(data.get("password"))
        browser_profile_name = _clean_credential(data.get("profile_name")) or None
        profiles_dir = data.get("profiles_dir") or DEFAULT_PROFILES_DIR
        proxy_server = _clean_credential(data.get("proxy_server") or data.get("proxy")) or None
        headless = _parse_bool(data.get("headless"), default=False)
        debug_enabled = _parse_bool(data.get("debug"), default=True)
        clear_cache = _parse_bool(data.get("clear_cache"), default=False)
        allow_manual_login = _parse_bool(data.get("allow_manual_login"), default=not headless)
        manual_login_timeout_ms = int(data.get("manual_login_timeout_ms", 300000))
        timeout_ms = int(data.get("timeout_ms", 30000))
        slow_mo_ms = int(data.get("slow_mo_ms", 0))

        _server_debug(
            request_id,
            "doit_received "
            f"email={_mask_email(email)} profile_name={browser_profile_name or '-'} "
            f"headless={headless} debug={debug_enabled} clear_cache={clear_cache} "
            f"allow_manual_login={allow_manual_login}",
        )

        if not email or not password:
            return _json_response(
                {
                    "success": False,
                    "phase": "request",
                    "reason": "missing_credentials: send JSON email and password",
                    "url": data.get("login_url") or "https://www.netflix.com/th-en/login",
                },
                400,
            )

        debug = (lambda message: _server_debug(request_id, message)) if debug_enabled else None
        login_result = login_netflix(
            email,
            password,
            login_url=data.get("login_url") or "https://www.netflix.com/th-en/login",
            headless=headless,
            timeout_ms=timeout_ms,
            slow_mo_ms=slow_mo_ms,
            proxy_server=proxy_server,
            clear_cache=clear_cache,
            persistent_profile=True,
            profile_name=browser_profile_name,
            profiles_dir=profiles_dir,
            debug=debug,
            allow_manual_login=allow_manual_login,
            manual_login_timeout_ms=manual_login_timeout_ms,
        )
        if not login_result.success:
            http_status = _status_for_failure(login_result.reason)
            _server_debug(
                request_id,
                f"doit_login_failed status={http_status} reason={login_result.reason} url={login_result.url}",
            )
            return _json_response(
                {
                    **asdict(login_result),
                    "phase": "login",
                },
                http_status,
            )

        workflow_result = run_post_login_workflow(
            email=email,
            account_password=password,
            account_pin=_clean_credential(data.get("pin")) or None,
            browser_profile_name=browser_profile_name,
            profiles_dir=profiles_dir,
            session_url=data.get("session_url") or DEFAULT_SESSION_URL,
            new_profile_name=_clean_credential(data.get("new_profile_name")) or None,
            profile_lock_pin=_clean_credential(data.get("lock_pin")) or None,
            headless=headless,
            timeout_ms=timeout_ms,
            slow_mo_ms=slow_mo_ms,
            proxy_server=proxy_server,
            debug=debug,
        )
        http_status = 200 if workflow_result.success else _status_for_failure(workflow_result.reason)
        _server_debug(
            request_id,
            f"doit_finished status={http_status} success={workflow_result.success} "
            f"reason={workflow_result.reason} url={workflow_result.url}",
        )
        return _json_response(
            {
                **asdict(workflow_result),
                "phase": "workflow",
                "login": asdict(login_result),
            },
            http_status,
        )

    return app


def _request_json() -> dict | None:
    data = request.get_json(silent=True)
    if isinstance(data, dict):
        return data

    raw = request.get_data(as_text=True).strip()
    if not raw:
        return {}

    # Windows curl examples are often pasted with literal single quotes around
    # the JSON. Accept that shape so PowerShell callers get useful behavior.
    if len(raw) >= 2 and raw[0] == raw[-1] and raw[0] in {"'", '"'}:
        raw = raw[1:-1]

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


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
