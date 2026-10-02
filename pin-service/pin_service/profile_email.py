"""Add or remove the email on one Netflix profile (Edit profile > Contact info).

Add (after a purchase): edit profile > email link > verify identity (password,
or a code mailed to the master email, read over IMAP) > fill the customer's
email > "เพิ่มอีเมล" > back on edit profile > "บันทึก".
Remove (when the rental ends): same path, then "ลบอีเมล" > "บันทึก".
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from datetime import datetime
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
    capture_page_debug,
    click_text_candidate,
    click_text_candidate_in_container,
    emit_debug,
    fill_input_and_verify,
    first_visible,
    force_click_first,
    has_email_field,
    has_visible_error,
    resolve_profile_dir,
    short_error,
    sync_playwright,
    wait_for_short_network_idle,
)
from netflix_login_checker.post_login_workflow import (
    _ensure_manage_profiles_mode,
    _handle_account_pin_prompt,
    _submit_account_password,
    _wait_for_profile_guid,
)

from .change_pin import PASSWORD_INPUT_SELECTORS
from .otp_mail import MailboxLogin, mailbox_for, now_utc, wait_for_otp_candidates

NETFLIX = "https://www.netflix.com"
EMAIL_LINK = '[data-uia="card+edit-profile-page+email-link"]'
EDIT_PROFILE_SAVE = '[data-uia="edit-profile-page+submit-button"]'
EDIT_PROFILE_PAGE = ('[data-uia="edit-profile-page+page-title+heading"]', EMAIL_LINK, EDIT_PROFILE_SAVE)
NEW_EMAIL_INPUT = '[data-uia="profile-email-page+new-email-input"]'
EMAIL_PAGE_SUBMIT = '[data-uia="profile-email-page+submit-button"]'
EMAIL_PAGE_DELETE = '[data-uia="profile-email-page+delete-button"]'
NO_PROMO_CHECKBOX = '[data-uia="email-consents+email-checkbox"]'
MFA_PASSWORD = '[data-uia="account-mfa-button-PASSWORD"] button'
MFA_OTP_EMAIL = '[data-uia="account-mfa-button-OTP_EMAIL"] button'
OTP_INPUT = '[data-uia="collect-otp-input-entry"]'
OTP_SUBMIT = '[data-uia="collect-input-submit-cta"]'
OTP_RESEND = '[data-uia="collect-input-resend-cta"]'
CONFIRM_DIALOG = ('[role="dialog"]', '[role="alertdialog"]')


@dataclass
class ProfileEmailResult:
    success: bool
    reason: str
    url: str
    profile_name: str
    steps: list[str] = field(default_factory=list)


def update_profile_email(**kwargs) -> ProfileEmailResult:
    if _has_running_asyncio_loop():
        return _run_in_plain_thread(_update_profile_email_impl, **kwargs)
    return _update_profile_email_impl(**kwargs)


def _update_profile_email_impl(
    *,
    action: str,
    email: str,
    account_password: str,
    account_pin: str | None,
    profile_name: str,
    customer_email: str | None,
    mailbox_password: str | None = None,
    profiles_dir: str | Path = DEFAULT_PROFILES_DIR,
    headless: bool = True,
    timeout_ms: int = 30000,
    slow_mo_ms: int = 0,
    proxy_server: str | None = None,
    debug: DebugCallback | None = None,
) -> ProfileEmailResult:
    steps: list[str] = []

    def result(success: bool, reason: str, url: str) -> ProfileEmailResult:
        emit_debug(debug, f"profile_email_result action={action} success={success} reason={reason}")
        return ProfileEmailResult(success, reason, url, profile_name, steps)

    def step(name: str) -> None:
        steps.append(name)
        emit_debug(debug, f"profile_email_step={name}")

    if PLAYWRIGHT_IMPORT_ERROR:
        return result(False, "playwright_not_installed", MANAGE_PROFILES_URL)
    if action not in ("add", "remove"):
        return result(False, "invalid_action", MANAGE_PROFILES_URL)
    if action == "add" and not customer_email:
        return result(False, "missing_customer_email", MANAGE_PROFILES_URL)

    mailbox = mailbox_for(email, mailbox_password)
    profile_dir = resolve_profile_dir(profile_name=None, identifier=email, profiles_dir=profiles_dir)
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
            if has_email_field(page, timeout_ms=3000):
                return result(False, "session_not_logged_in", page.url)
            pin_status = _handle_account_pin_prompt(page, account_pin, debug=debug)
            if pin_status != "ok":
                return result(False, pin_status, page.url)

            step("find_profile")
            _ensure_manage_profiles_mode(page, debug=debug)
            profile_guid = _wait_for_profile_guid(page, profile_name, timeout_ms=10000)
            if not profile_guid:
                return result(False, "profile_not_found", page.url)

            step("open_edit_profile")
            if not _open_edit_profile(page, profile_guid, account_pin, debug=debug):
                return result(False, "edit_profile_page_not_opened", page.url)

            link = first_visible(page, (EMAIL_LINK,), timeout_ms=5000)
            href = (link.get_attribute("href") or "") if link else ""
            has_email = "updateProfileEmail" in href
            current_text = _safe_text(link) if link else ""
            emit_debug(debug, f"profile_email_current has_email={has_email}")
            if action == "remove" and link and not has_email:
                return result(True, "email_already_removed", page.url)
            if action == "add" and has_email and customer_email.lower() in current_text.lower():
                return result(True, "email_already_set", page.url)

            step("open_email_page")
            if link:
                link.click(force=True)
            else:
                page.goto(f"{NETFLIX}/account/profile/newProfileEmail/{profile_guid}", wait_until="domcontentloaded")
            wait_for_short_network_idle(page, debug=debug)

            step("verify_and_submit_email")
            outcome = _verify_and_submit(
                page,
                action=action,
                customer_email=customer_email,
                account_password=account_password,
                mailbox=mailbox,
                debug=debug,
                timeout_ms=max(timeout_ms, 240000),
            )
            if outcome != "ok":
                return result(False, outcome, page.url)

            step("save_profile")
            if not _save_edit_profile(page, debug=debug):
                error = has_visible_error(page)
                return result(False, f"profile_not_saved{': ' + error if error else ''}", page.url)
            return result(True, "email_added" if action == "add" else "email_removed", page.url)
        except PlaywrightError as exc:
            capture_page_debug(page, debug=debug, label="profile_email_playwright_error", profile_dir=profile_dir)
            return result(False, f"playwright_error: {short_error(exc)}", page.url)
        finally:
            emit_debug(debug, "profile_email_close_browser")
            context.close()
            if browser:
                browser.close()


def _open_edit_profile(page, profile_guid: str, account_pin: str | None, *, debug: DebugCallback | None) -> bool:
    page.goto(f"{NETFLIX}/settings/{profile_guid}?referrer=ManageProfiles", wait_until="domcontentloaded")
    wait_for_short_network_idle(page, debug=debug)
    if _handle_account_pin_prompt(page, account_pin, debug=debug) != "ok":
        return False

    # "แก้ไขข้อมูลส่วนตัวและข้อมูลติดต่อ" card on the profile settings page.
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        if first_visible(page, EDIT_PROFILE_PAGE, timeout_ms=300):
            return True
        if force_click_first(
            page,
            ('[data-uia="menu-card+edit-profile"]', '[data-uia*="menu-card"][data-uia*="edit-profile"]'),
            timeout_ms=300,
        ) or click_text_candidate(page, r"แก้ไขข้อมูลส่วนตัว|ข้อมูลติดต่อ|edit personal|contact info"):
            wait_for_short_network_idle(page, debug=debug)
            continue
        page.wait_for_timeout(300)
    return False


def _verify_and_submit(
    page,
    *,
    action: str,
    customer_email: str | None,
    account_password: str,
    mailbox: MailboxLogin | None,
    debug: DebugCallback | None,
    timeout_ms: int,
) -> str:
    """Walks identity checks and the email form in whatever order Netflix shows them."""
    deadline = time.monotonic() + timeout_ms / 1000
    password_submitted = False
    otp_sent_at: datetime | None = None
    tried_codes: set[str] = set()
    resent = False
    submitted = False

    while time.monotonic() < deadline:
        if submitted and first_visible(page, (EDIT_PROFILE_SAVE,), timeout_ms=300):
            return "ok"

        if first_visible(page, (OTP_INPUT,), timeout_ms=300):
            if not mailbox:
                return "otp_mailbox_not_configured"
            sent_at = otp_sent_at or now_utc()
            candidates = [
                item
                for item in wait_for_otp_candidates(mailbox, sent_at, timeout_s=90, debug=debug)
                if item.code not in tried_codes
            ]
            if not candidates:
                if resent:
                    return "otp_not_received"
                # Nothing usable arrived: ask Netflix for a fresh code once.
                if force_click_first(page, (OTP_RESEND,), timeout_ms=1000):
                    resent = True
                    otp_sent_at = now_utc()
                    emit_debug(debug, "profile_email_otp_resent")
                    continue
                return "otp_not_received"
            # Closest to the click first; others cover codes from a parallel request.
            for candidate in candidates:
                tried_codes.add(candidate.code)
                emit_debug(debug, f"profile_email_try_otp received_at={candidate.received_at.isoformat()}")
                if _submit_otp(page, candidate.code, debug=debug):
                    break
            continue

        if first_visible(page, PASSWORD_INPUT_SELECTORS, timeout_ms=300):
            if password_submitted:
                error = has_visible_error(page)
                if error:
                    return f"account_password_rejected: {error}"
                page.wait_for_timeout(500)
                continue
            emit_debug(debug, "profile_email_submit_account_password")
            password_submitted = _submit_account_password(page, account_password)
            wait_for_short_network_idle(page, debug=debug)
            continue

        if force_click_first(page, (MFA_PASSWORD,), timeout_ms=300):
            emit_debug(debug, "profile_email_choose_password_verification")
            wait_for_short_network_idle(page, debug=debug)
            continue

        if first_visible(page, (MFA_OTP_EMAIL,), timeout_ms=300):
            otp_sent_at = now_utc()
            force_click_first(page, (MFA_OTP_EMAIL,), timeout_ms=1000)
            emit_debug(debug, "profile_email_otp_requested")
            wait_for_short_network_idle(page, debug=debug)
            continue

        if not submitted and action == "add" and first_visible(page, (NEW_EMAIL_INPUT,), timeout_ms=300):
            if not fill_input_and_verify(page, (NEW_EMAIL_INPUT,), customer_email or "", timeout_ms=5000):
                return "email_input_not_filled"
            checkbox = first_visible(page, (NO_PROMO_CHECKBOX,), timeout_ms=300)
            if checkbox:
                try:
                    if not checkbox.is_checked():
                        checkbox.check(force=True, timeout=2000)
                except PlaywrightError:
                    pass
            if not force_click_first(page, (EMAIL_PAGE_SUBMIT,), timeout_ms=2000):
                return "add_email_button_not_found"
            submitted = True
            emit_debug(debug, "profile_email_add_submitted")
            wait_for_short_network_idle(page, debug=debug)
            continue

        if not submitted and action == "remove" and first_visible(page, (EMAIL_PAGE_DELETE,), timeout_ms=300):
            force_click_first(page, (EMAIL_PAGE_DELETE,), timeout_ms=2000)
            submitted = True
            emit_debug(debug, "profile_email_delete_clicked")
            wait_for_short_network_idle(page, debug=debug)
            continue

        if submitted:
            # A confirm dialog may follow "ลบอีเมล"; an error stays on the email page.
            if (
                action == "remove"
                and first_visible(page, CONFIRM_DIALOG, timeout_ms=300)
                and click_text_candidate_in_container(
                    page, ", ".join(CONFIRM_DIALOG), r"^(ลบ|ลบอีเมล|ยืนยัน|delete|remove|confirm)( email)?$"
                )
            ):
                emit_debug(debug, "profile_email_delete_confirmed")
                wait_for_short_network_idle(page, debug=debug)
                continue
            if first_visible(page, (NEW_EMAIL_INPUT, EMAIL_PAGE_DELETE), timeout_ms=300):
                error = has_visible_error(page)
                if error:
                    return f"email_rejected: {error}"

        page.wait_for_timeout(300)
    return "email_page_timeout"


def _submit_otp(page, code: str, *, debug: DebugCallback | None) -> bool:
    """True once Netflix leaves the code entry page."""
    if not fill_input_and_verify(page, (OTP_INPUT,), code, timeout_ms=5000, require_interactable=False):
        return False
    if not force_click_first(page, (OTP_SUBMIT, 'button[type="submit"]'), timeout_ms=2000):
        return False
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        if not first_visible(page, (OTP_INPUT,), timeout_ms=300):
            emit_debug(debug, "profile_email_otp_accepted")
            return True
        if has_visible_error(page):
            emit_debug(debug, "profile_email_otp_rejected")
            return False
        page.wait_for_timeout(300)
    return False


def _save_edit_profile(page, *, debug: DebugCallback | None) -> bool:
    if not force_click_first(page, (EDIT_PROFILE_SAVE,), timeout_ms=5000):
        return False
    emit_debug(debug, "profile_email_save_clicked")
    # Saved once Netflix leaves the edit profile page without an error.
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        if has_visible_error(page):
            return False
        if not first_visible(page, (EDIT_PROFILE_SAVE,), timeout_ms=300):
            return True
        page.wait_for_timeout(300)
    # Some layouts keep the form open after saving; no error means it was accepted.
    return not has_visible_error(page)


def _safe_text(locator) -> str:
    try:
        return locator.inner_text(timeout=1000)
    except PlaywrightError:
        return ""
