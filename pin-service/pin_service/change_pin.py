"""Change the profile-lock PIN of one existing Netflix profile.

Runs after a successful login with the same persistent browser profile. The
page flow is handled as a small state machine because Netflix shows the
password check, the lock options and the PIN entry in varying order.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from pathlib import Path

from netflix_login_checker.core import (
    DEFAULT_PROFILES_DIR,
    MANAGE_PROFILES_URL,
    PLAYWRIGHT_IMPORT_ERROR,
    DebugCallback,
    PlaywrightError,
    _has_running_asyncio_loop,
    _launch_context,
    _run_in_plain_thread,
    click_text_candidate,
    emit_debug,
    first_visible,
    force_click_first,
    has_email_field,
    has_visible_error,
    resolve_profile_dir,
    sync_playwright,
    wait_for_short_network_idle,
)
from netflix_login_checker.post_login_workflow import (
    _clean_pin,
    _ensure_manage_profiles_mode,
    _fill_and_submit_profile_lock_pin,
    _handle_account_pin_prompt,
    _is_profile_lock_pin_entry,
    _is_profile_settings_page,
    _submit_account_password,
    _wait_for_profile_guid,
)

PASSWORD_INPUT_SELECTORS = (
    'input[name="challengePassword"][data-uia="collect-password-input-modal-entry"]',
    '[data-uia="collect-password-input-modal-entry"]',
    'input[name="challengePassword"]',
)
# Buttons that lead to the PIN entry page when a lock already exists (or not yet).
EDIT_LOCK_SELECTORS = (
    '[data-uia="profile-lock-on+edit-button"]',
    '[data-uia="profile-lock-on+change-pin-button"]',
    '[data-uia*="profile-lock"][data-uia*="edit"]',
    '[data-uia="profile-lock-off+add-button"]',
)


@dataclass
class PinChangeResult:
    success: bool
    reason: str
    url: str
    profile_name: str
    steps: list[str] = field(default_factory=list)


def change_profile_pin(**kwargs) -> PinChangeResult:
    if _has_running_asyncio_loop():
        return _run_in_plain_thread(_change_profile_pin_impl, **kwargs)
    return _change_profile_pin_impl(**kwargs)


def _change_profile_pin_impl(
    *,
    email: str,
    account_password: str,
    account_pin: str | None,
    profile_name: str,
    new_pin: str,
    profiles_dir: str | Path = DEFAULT_PROFILES_DIR,
    headless: bool = True,
    timeout_ms: int = 30000,
    slow_mo_ms: int = 0,
    proxy_server: str | None = None,
    debug: DebugCallback | None = None,
) -> PinChangeResult:
    steps: list[str] = []

    def result(success: bool, reason: str, url: str) -> PinChangeResult:
        emit_debug(debug, f"change_pin_result success={success} reason={reason}")
        return PinChangeResult(success, reason, url, profile_name, steps)

    def step(name: str) -> None:
        steps.append(name)
        emit_debug(debug, f"change_pin_step={name}")

    if PLAYWRIGHT_IMPORT_ERROR:
        return result(False, "playwright_not_installed", MANAGE_PROFILES_URL)
    if not _clean_pin(new_pin) or len(new_pin) != 4:
        return result(False, "invalid_new_pin", MANAGE_PROFILES_URL)

    profile_dir = resolve_profile_dir(profile_name=None, identifier=email, profiles_dir=profiles_dir)
    with sync_playwright() as playwright:
        browser, context = _launch_context(
            playwright,
            headless=headless,
            slow_mo_ms=slow_mo_ms,
            profile_dir=profile_dir,
            proxy_server=proxy_server,
            debug=debug,
        )
        page = context.pages[0] if context.pages else context.new_page()
        page.set_default_timeout(timeout_ms)
        try:
            step("open_manage_profiles")
            page.goto(MANAGE_PROFILES_URL, wait_until="domcontentloaded")
            wait_for_short_network_idle(page, debug=debug)
            if has_email_field(page, timeout_ms=3000):
                return result(False, "session_not_logged_in", page.url)

            step("handle_account_pin_if_prompted")
            pin_status = _handle_account_pin_prompt(page, account_pin, debug=debug)
            if pin_status != "ok":
                return result(False, pin_status, page.url)

            step("find_profile")
            _ensure_manage_profiles_mode(page, debug=debug)
            profile_guid = _wait_for_profile_guid(page, profile_name, timeout_ms=10000)
            if not profile_guid:
                return result(False, "profile_not_found", page.url)

            step("open_profile_settings")
            page.goto(
                f"https://www.netflix.com/settings/{profile_guid}?referrer=ManageProfiles",
                wait_until="domcontentloaded",
            )
            wait_for_short_network_idle(page, debug=debug)
            if _handle_account_pin_prompt(page, account_pin, debug=debug) != "ok":
                return result(False, "account_pin_required", page.url)
            if not _is_profile_settings_page(page):
                return result(False, "profile_settings_page_not_opened", page.url)

            step("open_profile_lock")
            if not force_click_first(
                page,
                ('[data-uia="menu-card+profile-lock"]', '[data-uia="menu-card+profile-lock+item"]'),
                timeout_ms=5000,
            ):
                return result(False, "profile_lock_button_not_found", page.url)
            wait_for_short_network_idle(page, debug=debug)

            step("reach_pin_entry")
            reached = _reach_pin_entry(page, account_password, debug=debug, timeout_ms=max(timeout_ms, 45000))
            if reached != "ok":
                return result(False, reached, page.url)

            step("save_new_pin")
            if not _save_new_pin(page, new_pin, debug=debug):
                error = has_visible_error(page)
                return result(False, f"pin_not_saved{': ' + error if error else ''}", page.url)
            return result(True, "pin_changed", page.url)
        except PlaywrightError as exc:
            return result(False, f"playwright_error: {exc}", page.url)
        finally:
            emit_debug(debug, "change_pin_close_browser")
            context.close()
            if browser:
                browser.close()


def _reach_pin_entry(page, account_password: str, *, debug: DebugCallback | None, timeout_ms: int) -> str:
    """Returns "ok" once the PIN entry page shows, otherwise a failure reason."""
    deadline = time.monotonic() + (timeout_ms / 1000)
    password_submitted = False
    while time.monotonic() < deadline:
        if _is_profile_lock_pin_entry(page):
            return "ok"

        if password_submitted:
            error = has_visible_error(page)
            if error:
                return f"account_password_rejected: {error}"

        if not password_submitted and first_visible(page, PASSWORD_INPUT_SELECTORS, timeout_ms=300):
            emit_debug(debug, "change_pin_submit_account_password")
            password_submitted = _submit_account_password(page, account_password)
            wait_for_short_network_idle(page, debug=debug)
            continue

        if force_click_first(page, ('[data-uia="account-mfa-button-PASSWORD"] button',), timeout_ms=300):
            emit_debug(debug, "change_pin_choose_password_verification")
            wait_for_short_network_idle(page, debug=debug)
            continue

        if force_click_first(page, EDIT_LOCK_SELECTORS, timeout_ms=300) or click_text_candidate(
            page, r"edit pin|change pin|แก้ไข\s*pin|เปลี่ยน\s*pin"
        ):
            emit_debug(debug, "change_pin_open_pin_editor")
            wait_for_short_network_idle(page, debug=debug)
            continue

        page.wait_for_timeout(300)
    return "pin_entry_not_reached"


def _save_new_pin(page, new_pin: str, *, debug: DebugCallback | None) -> bool:
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        if _fill_and_submit_profile_lock_pin(page, new_pin):
            emit_debug(debug, "change_pin_submitted")
            break
        page.wait_for_timeout(250)
    else:
        return False

    # Saved once Netflix leaves the PIN entry page without an error.
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        if has_visible_error(page):
            return False
        if not _is_profile_lock_pin_entry(page):
            return True
        page.wait_for_timeout(300)
    return False
