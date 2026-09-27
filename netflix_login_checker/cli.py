from __future__ import annotations

import argparse
import json
import os
from dataclasses import asdict

from .core import DEFAULT_LOGIN_URL, login_netflix


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Return whether a Netflix login succeeds.")
    parser.add_argument("--email", default=os.environ.get("NETFLIX_EMAIL"))
    parser.add_argument("--password", default=os.environ.get("NETFLIX_PASSWORD"))
    parser.add_argument("--login-url", default=os.environ.get("NETFLIX_LOGIN_URL", DEFAULT_LOGIN_URL))
    parser.add_argument("--headful", action="store_true", help="Show the browser window.")
    parser.add_argument("--timeout-ms", type=int, default=30000)
    parser.add_argument("--slow-mo-ms", type=int, default=0)
    parser.add_argument("--proxy-server", default=os.environ.get("NETFLIX_PROXY_SERVER"))
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    email = args.email.rstrip("\r\n") if args.email else args.email
    password = args.password.rstrip("\r\n") if args.password else args.password

    if not email or not password:
        print(
            json.dumps(
                {
                    "success": False,
                    "reason": "missing_credentials: set NETFLIX_EMAIL and NETFLIX_PASSWORD or pass --email/--password",
                    "url": args.login_url,
                },
                ensure_ascii=True,
            )
        )
        return 2

    result = login_netflix(
        email,
        password,
        login_url=args.login_url,
        headless=not args.headful,
        timeout_ms=args.timeout_ms,
        slow_mo_ms=args.slow_mo_ms,
        proxy_server=args.proxy_server,
    )
    print(json.dumps(asdict(result), ensure_ascii=True))
    return 0 if result.success else 1


if __name__ == "__main__":
    raise SystemExit(main())
