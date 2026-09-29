from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


@dataclass
class MasterEmailAccount:
    id: str
    email: str
    password: str
    package_name: str | None = None
    package_slug: str | None = None
    service: str = "netflix"
    profile_count: int = 0
    available_profiles: int = 0
    max_profiles: int | None = None


class BackendApiError(Exception):
    def __init__(self, message: str, *, status_code: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code


class BackendApiClient:
    def __init__(self, *, base_url: str, admin_key: str, timeout: int = 30) -> None:
        self.base_url = normalize_base_url(base_url)
        self.admin_key = admin_key
        self.timeout = timeout

    def fetch_master_emails(self, *, service: str = "netflix", email: str | None = None) -> list[MasterEmailAccount]:
        query: dict[str, str] = {"service": service}
        if email:
            query["email"] = email
        payload = self._request_json(
            "GET",
            f"/admin/automation/master-emails?{urlencode(query)}",
        )
        accounts = [
            MasterEmailAccount(
                id=str(item["id"]),
                email=str(item["email"]),
                password=str(item["password"]),
                package_name=item.get("packageName"),
                package_slug=item.get("packageSlug"),
                service=item.get("service") or "netflix",
                profile_count=int(item.get("profileCount") or 0),
                available_profiles=int(item.get("availableProfiles") or 0),
                max_profiles=int(item["maxProfiles"]) if item.get("maxProfiles") is not None else None,
            )
            for item in payload.get("masterEmails", [])
        ]
        if accounts:
            return accounts

        return self.fetch_inventory_master_emails(service=service, email=email)

    def fetch_inventory_master_emails(
        self,
        *,
        service: str = "netflix",
        email: str | None = None,
    ) -> list[MasterEmailAccount]:
        payload = self._request_json("GET", "/admin/inventory")
        normalized_email = email.strip().lower() if email else None
        accounts: list[MasterEmailAccount] = []
        for item in payload.get("masterEmails", []):
            item_email = str(item.get("email") or "")
            item_service = str(item.get("service") or "netflix")
            if service and item_service != service:
                continue
            if normalized_email and item_email.strip().lower() != normalized_email:
                continue
            accounts.append(
                MasterEmailAccount(
                    id=str(item["id"]),
                    email=item_email,
                    password="",
                    package_name=item.get("packageName"),
                    package_slug=item.get("packageSlug"),
                    service=item_service,
                    profile_count=int(item.get("profileCount") or 0),
                    available_profiles=int(item.get("availableProfiles") or 0),
                )
            )
        return accounts

    def find_master_email(self, *, email: str, service: str = "netflix") -> MasterEmailAccount | None:
        normalized_email = email.strip().lower()
        for account in self.fetch_master_emails(service=service, email=email.strip()):
            if account.email.strip().lower() == normalized_email:
                return account
        return None

    def find_master_email_id(self, *, email: str, service: str = "netflix") -> str | None:
        account = self.find_master_email(email=email, service=service)
        return account.id if account else None

    def save_profiles(
        self,
        *,
        master_email_id: str,
        profiles: list[dict[str, str | None]],
    ) -> list[dict[str, Any]]:
        cleaned_profiles = [profile for profile in profiles if profile.get("profileName")]
        if not cleaned_profiles:
            return []

        try:
            payload = self._request_json(
                "POST",
                "/admin/automation/profiles",
                {
                    "masterEmailId": master_email_id,
                    "profiles": cleaned_profiles,
                },
            )
            return list(payload.get("profiles", []))
        except BackendApiError as exc:
            if exc.status_code not in {404, 405}:
                raise

        created: list[dict[str, Any]] = []
        for profile in cleaned_profiles:
            payload = self._request_json(
                "POST",
                "/admin/profiles",
                {
                    "masterEmailId": master_email_id,
                    "profileName": profile.get("profileName"),
                    "pin": profile.get("pin") or None,
                    "status": profile.get("status") or "available",
                    "profileExpiresAt": profile.get("profileExpiresAt") or None,
                    "note": profile.get("note") or "Created by NetflixProfileCreator",
                },
            )
            created.append(payload)
        return created

    def _request_json(self, method: str, path: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
        if not self.base_url or not self.admin_key:
            raise BackendApiError("API URL และ Admin Key จำเป็นสำหรับการเชื่อม backend")

        data = None
        headers = {
            "Accept": "application/json, text/plain, */*",
            "Content-Type": "application/json",
            "Origin": "https://fastmovie.sysbright.dev",
            "Referer": "https://fastmovie.sysbright.dev/",
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/126.0.0.0 Safari/537.36"
            ),
            "x-admin-key": self.admin_key,
        }
        if body is not None:
            data = json.dumps(body).encode("utf-8")

        request = Request(
            f"{self.base_url}{path}",
            data=data,
            headers=headers,
            method=method,
        )

        try:
            with urlopen(request, timeout=self.timeout) as response:
                raw = response.read().decode("utf-8")
        except HTTPError as exc:
            message = exc.read().decode("utf-8", errors="replace")
            raise BackendApiError(f"Backend HTTP {exc.code}: {message}", status_code=exc.code) from exc
        except URLError as exc:
            raise BackendApiError(f"เชื่อม backend ไม่ได้: {exc.reason}") from exc

        if not raw:
            return {}
        try:
            return json.loads(raw)
        except json.JSONDecodeError as exc:
            raise BackendApiError(f"Backend response ไม่ใช่ JSON: {raw[:200]}") from exc


def normalize_base_url(base_url: str) -> str:
    normalized = (base_url or "").strip().rstrip("/")
    normalized = normalized.replace("://fastmovie.sysbright.dev", "://apifastmovie.sysbright.dev", 1)
    if normalized.endswith("/admin"):
        normalized = normalized[: -len("/admin")]
    return normalized
