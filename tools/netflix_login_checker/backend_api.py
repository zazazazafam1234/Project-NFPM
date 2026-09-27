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


class BackendApiError(Exception):
    pass


class BackendApiClient:
    def __init__(self, *, base_url: str, admin_key: str, timeout: int = 30) -> None:
        self.base_url = base_url.rstrip("/")
        self.admin_key = admin_key
        self.timeout = timeout

    def fetch_master_emails(self, *, service: str = "netflix") -> list[MasterEmailAccount]:
        payload = self._request_json(
            "GET",
            f"/admin/automation/master-emails?{urlencode({'service': service})}",
        )
        return [
            MasterEmailAccount(
                id=str(item["id"]),
                email=str(item["email"]),
                password=str(item["password"]),
                package_name=item.get("packageName"),
                package_slug=item.get("packageSlug"),
                service=item.get("service") or "netflix",
                profile_count=int(item.get("profileCount") or 0),
                available_profiles=int(item.get("availableProfiles") or 0),
            )
            for item in payload.get("masterEmails", [])
        ]

    def save_profiles(
        self,
        *,
        master_email_id: str,
        profiles: list[dict[str, str | None]],
    ) -> list[dict[str, Any]]:
        payload = self._request_json(
            "POST",
            "/admin/automation/profiles",
            {
                "masterEmailId": master_email_id,
                "profiles": profiles,
            },
        )
        return list(payload.get("profiles", []))

    def _request_json(self, method: str, path: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
        if not self.base_url or not self.admin_key:
            raise BackendApiError("API URL และ Admin Key จำเป็นสำหรับการเชื่อม backend")

        data = None
        headers = {
            "Content-Type": "application/json",
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
            raise BackendApiError(f"Backend HTTP {exc.code}: {message}") from exc
        except URLError as exc:
            raise BackendApiError(f"เชื่อม backend ไม่ได้: {exc.reason}") from exc

        if not raw:
            return {}
        try:
            return json.loads(raw)
        except json.JSONDecodeError as exc:
            raise BackendApiError(f"Backend response ไม่ใช่ JSON: {raw[:200]}") from exc
