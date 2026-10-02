"""Delete an expired Netflix profile and recreate a fresh locked profile."""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from pathlib import Path

from netflix_login_checker.core import (
    DEFAULT_PROFILES_DIR,
    MANAGE_PROFILES_URL,
    PLAYWRIGHT_IMPORT_ERROR,
    DebugCallback,
    LoginOtpProvider,
    PlaywrightError,
    PlaywrightTimeoutError,
    _has_running_asyncio_loop,
    _launch_context,
    _run_in_plain_thread,
    capture_page_debug,
    click_text_candidate,
    emit_debug,
    first_visible,
    force_click_first,
    resolve_profile_dir,
    short_error,
    sync_playwright,
    wait_for_short_network_idle,
)
from netflix_login_checker.post_login_workflow import (
    _clean_pin,
    _clean_profile_name,
    _click_add_profile,
    _click_profile_tile_for_settings,
    _ensure_manage_profiles_mode,
    _generate_lock_pin,
    _generate_profile_name,
    _handle_account_pin_prompt,
    _is_profile_settings_page,
    _save_new_profile,
    _save_profile_lock_pin,
    _wait_and_fill_new_profile_name,
    _wait_for_profile_guid,
    verify_identity_for_profile_lock,
)


@dataclass
class ResetProfileResult:
    success: bool
    reason: str
    url: str
    old_profile_name: str
    new_profile_name: str
    new_pin: str
    steps: list[str] = field(default_factory=list)


def reset_profile(**kwargs) -> ResetProfileResult:
    if _has_running_asyncio_loop():
        return _run_in_plain_thread(_reset_profile_impl, **kwargs)
    return _reset_profile_impl(**kwargs)


def _reset_profile_impl(
    *,
    email: str,
    account_password: str,
    account_pin: str | None,
    old_profile_name: str,
    new_profile_name: str | None = None,
    new_pin: str | None = None,
    profiles_dir: str | Path = DEFAULT_PROFILES_DIR,
    headless: bool = True,
    timeout_ms: int = 30000,
    slow_mo_ms: int = 0,
    proxy_server: str | None = None,
    otp_code_provider: LoginOtpProvider | None = None,
    debug: DebugCallback | None = None,
) -> ResetProfileResult:
    replacement_name = _clean_profile_name(new_profile_name) or _generate_profile_name()
    replacement_pin = _clean_pin(new_pin) or _generate_lock_pin()
    profile_dir = resolve_profile_dir(profile_name=None, identifier=email, profiles_dir=profiles_dir)
    steps: list[str] = []

    def step(name: str) -> None:
        steps.append(name)
        emit_debug(debug, f"reset_profile_step={name}")

    def result(success: bool, reason: str, url: str) -> ResetProfileResult:
        emit_debug(debug, f"reset_profile_result success={success} reason={reason} old={old_profile_name} new={replacement_name}")
        return ResetProfileResult(success, reason, url, old_profile_name, replacement_name, replacement_pin, steps)

    if PLAYWRIGHT_IMPORT_ERROR:
        return result(False, "playwright_not_installed", MANAGE_PROFILES_URL)

    with sync_playwright() as playwright:
        try:
            browser, context = _launch_context(
                playwright,
                headless=headless,
                slow_mo_ms=slow_mo_ms,
                profile_dir=profile_dir,
                proxy_server=proxy_server,
                debug=debug,
            )
        except PlaywrightError as exc:
            return result(False, f"playwright_error: {short_error(exc)}", MANAGE_PROFILES_URL)

        page = context.pages[0] if context.pages else context.new_page()
        page.set_default_timeout(timeout_ms)
        context.set_default_navigation_timeout(timeout_ms)
        page.set_default_navigation_timeout(timeout_ms)

        try:
            step("open_manage_profiles")
            page.goto(MANAGE_PROFILES_URL, wait_until="domcontentloaded")
            wait_for_short_network_idle(page, debug=debug)
            if _handle_account_pin_prompt(page, account_pin, debug=debug) != "ok":
                return result(False, "account_pin_required_or_rejected", page.url)
            _ensure_manage_profiles_mode(page, debug=debug)

            # A retry resumes where the earlier attempt stopped: the backend sends the same
            # new name, so an existing new profile means delete/create already happened.
            step("find_old_profile")
            old_guid = _wait_for_profile_guid(page, old_profile_name, timeout_ms=timeout_ms)
            new_exists = _wait_for_profile_guid(page, replacement_name, timeout_ms=3000) is not None
            if not old_guid and not new_exists:
                emit_debug(debug, "reset_profile_old_missing_creating_new")
            if old_guid:
                step("delete_old_profile")
                if not _delete_profile(page, old_guid, old_profile_name, account_pin, debug=debug):
                    return result(False, "old_profile_not_deleted", page.url)

            if new_exists:
                emit_debug(debug, "reset_profile_new_profile_exists_resume_lock")
            else:
                step("create_new_profile")
                page.goto(MANAGE_PROFILES_URL, wait_until="domcontentloaded")
                wait_for_short_network_idle(page, debug=debug)
                _ensure_manage_profiles_mode(page, debug=debug)
                if not _click_add_profile(page, debug=debug):
                    return result(False, "add_profile_button_not_found", page.url)
                if _handle_account_pin_prompt(page, account_pin, debug=debug) != "ok":
                    return result(False, "account_pin_required_or_rejected", page.url)
                if not _wait_and_fill_new_profile_name(page, replacement_name, timeout_ms=timeout_ms):
                    return result(False, "new_profile_name_input_not_found", page.url)
                if not _save_new_profile(page, replacement_name, debug=debug):
                    return result(False, "new_profile_save_button_not_found", page.url)
                wait_for_short_network_idle(page, debug=debug)

            step("lock_new_profile")
            locked = _lock_profile(
                page,
                replacement_name,
                replacement_pin,
                account_password,
                account_pin,
                otp_code_provider=otp_code_provider,
                timeout_ms=timeout_ms,
                debug=debug,
            )
            if locked != "ok":
                emit_debug(debug, f"reset_profile_lock_page {_page_summary(page)}")
                capture_page_debug(page, debug=debug, label="reset_profile_lock_failed", profile_dir=profile_dir)
                return result(False, f"new_profile_lock_not_created: {locked}", page.url)

            return result(True, "profile_recreated", page.url)
        except PlaywrightError as exc:
            capture_page_debug(page, debug=debug, label="reset_profile_playwright_error", profile_dir=profile_dir)
            return result(False, f"playwright_error: {short_error(exc)}", page.url)
        finally:
            emit_debug(debug, "reset_profile_close_browser")
            context.close()
            if browser:
                browser.close()


def _delete_profile(page, profile_guid: str, profile_name: str, account_pin: str | None, *, debug: DebugCallback | None) -> bool:
    page.goto(f"https://www.netflix.com/settings/{profile_guid}?referrer=ManageProfiles", wait_until="domcontentloaded")
    wait_for_short_network_idle(page, debug=debug)
    if _handle_account_pin_prompt(page, account_pin, debug=debug) != "ok":
        return False

    deadline = time.monotonic() + 25
    while time.monotonic() < deadline:
        if _click_delete_profile(page, debug=debug):
            if _confirm_delete_profile(page, debug=debug):
                return _wait_profile_removed(page, profile_name, timeout_ms=10000)
            return False

        if _open_delete_area(page, debug=debug):
            continue

        page.wait_for_timeout(400)
    return False


def _open_delete_area(page, *, debug: DebugCallback | None) -> bool:
    selectors = (
        '[data-uia="menu-card+edit-profile"]',
        '[data-uia*="menu-card"][data-uia*="edit-profile"]',
        '[data-uia="menu-card+delete-profile"]',
        '[data-uia*="delete-profile"]',
    )
    if force_click_first(page, selectors, timeout_ms=700):
        emit_debug(debug, "reset_profile_open_delete_area_selector")
        wait_for_short_network_idle(page, debug=debug)
        return True
    if click_text_candidate(page, r"แก้ไขข้อมูลส่วนตัว|ข้อมูลติดต่อ|edit profile|delete profile|ลบโปรไฟล์"):
        emit_debug(debug, "reset_profile_open_delete_area_text")
        wait_for_short_network_idle(page, debug=debug)
        return True
    return False


def _click_delete_profile(page, *, debug: DebugCallback | None) -> bool:
    selectors = (
        '[data-uia="edit-profile-page+delete-profile-button"]',
        '[data-uia="profile-delete-button"]',
        '[data-uia="profile-settings-page+delete-profile"]',
        '[data-uia="menu-card+delete-profile"]',
        '[data-uia*="delete-profile"] button',
        'button:has-text("Delete Profile")',
        'button:has-text("ลบโปรไฟล์")',
    )
    if force_click_first(page, selectors, timeout_ms=1000):
        emit_debug(debug, "reset_profile_delete_clicked_selector")
        wait_for_short_network_idle(page, debug=debug)
        return True
    if click_text_candidate(page, r"^(ลบโปรไฟล์|delete profile)$"):
        emit_debug(debug, "reset_profile_delete_clicked_text")
        wait_for_short_network_idle(page, debug=debug)
        return True
    return False


def _confirm_delete_profile(page, *, debug: DebugCallback | None) -> bool:
    deadline = time.monotonic() + 12
    while time.monotonic() < deadline:
        if force_click_first(
            page,
            (
                '[data-uia="delete-profile-confirmation+delete-button"]',
                '[data-uia="profile-delete-confirmation+delete-button"]',
                '[data-uia*="delete"][data-uia*="confirm"]',
                '[role="dialog"] button:has-text("Delete Profile")',
                '[role="dialog"] button:has-text("ลบโปรไฟล์")',
                'button:has-text("Delete Profile")',
                'button:has-text("ลบโปรไฟล์")',
            ),
            timeout_ms=700,
        ):
            emit_debug(debug, "reset_profile_delete_confirmed_selector")
            wait_for_short_network_idle(page, debug=debug)
            return True
        if click_text_candidate(page, r"^(ลบโปรไฟล์|delete profile|ลบ|delete)$"):
            emit_debug(debug, "reset_profile_delete_confirmed_text")
            wait_for_short_network_idle(page, debug=debug)
            return True
        page.wait_for_timeout(300)
    return False


def _wait_profile_removed(page, profile_name: str, *, timeout_ms: int) -> bool:
    deadline = time.monotonic() + timeout_ms / 1000
    while time.monotonic() < deadline:
        try:
            page.goto(MANAGE_PROFILES_URL, wait_until="domcontentloaded")
        except PlaywrightError:
            pass
        if _wait_for_profile_guid(page, profile_name, timeout_ms=1200) is None:
            return True
        page.wait_for_timeout(500)
    return False


def _lock_profile(
    page,
    profile_name: str,
    profile_pin: str,
    account_password: str,
    account_pin: str | None,
    *,
    otp_code_provider: LoginOtpProvider | None,
    timeout_ms: int,
    debug: DebugCallback | None,
) -> str:
    """Returns "ok" once the new profile has its lock PIN, otherwise a failure reason."""
    profile_guid = _wait_for_profile_guid(page, profile_name, timeout_ms=timeout_ms)
    _ensure_manage_profiles_mode(page, debug=debug)
    if profile_guid and _click_profile_tile_for_settings(page, profile_guid, profile_name):
        wait_for_short_network_idle(page, debug=debug)
    if profile_guid and not _is_profile_settings_page(page):
        page.goto(f"https://www.netflix.com/settings/{profile_guid}?referrer=ManageProfiles", wait_until="domcontentloaded")
        wait_for_short_network_idle(page, debug=debug)
    if not _is_profile_settings_page(page):
        return "profile_settings_page_not_opened"
    if _handle_account_pin_prompt(page, account_pin, debug=debug) != "ok":
        return "account_pin_required"
    if not force_click_first(
        page,
        (
            '[data-uia="menu-card+profile-lock"]',
            '[data-uia="menu-card+profile-lock+item"]',
        ),
        timeout_ms=5000,
    ):
        return "profile_lock_button_not_found"
    wait_for_short_network_idle(page, debug=debug)
    if not force_click_first(page, ('[data-uia="profile-lock-off+add-button"]',), timeout_ms=7000):
        return "create_profile_lock_button_not_found"
    verified = verify_identity_for_profile_lock(
        page,
        account_password,
        otp_code_provider=otp_code_provider,
        debug=debug,
    )
    if verified != "ok":
        return verified
    wait_for_short_network_idle(page, debug=debug)
    if not _save_profile_lock_pin(page, profile_pin):
        return "profile_lock_pin_not_saved"
    wait_for_short_network_idle(page, debug=debug)
    return "ok"


def _page_summary(page) -> str:
    """URL, heading and visible data-uia hooks, so an unknown page can be handled later."""
    try:
        info = page.evaluate(
            """() => {
                const visible = (el) => {
                    const r = el.getBoundingClientRect();
                    return r.width > 0 && r.height > 0;
                };
                const uia = Array.from(document.querySelectorAll('[data-uia]'))
                    .filter(visible)
                    .map((el) => el.getAttribute('data-uia'))
                    .filter((name) => !name.startsWith('footer'));
                const heading = Array.from(document.querySelectorAll('h1,h2')).filter(visible).map((el) => el.innerText.trim());
                return { heading: heading.slice(0, 3), uia: Array.from(new Set(uia)).slice(0, 40) };
            }"""
        )
    except PlaywrightError as exc:
        return f"url={page.url} unreadable={exc}"
    return f"url={page.url} heading={info.get('heading')} uia={info.get('uia')}"
