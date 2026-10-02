from __future__ import annotations

import secrets
import string
import time
from dataclasses import dataclass, field
from pathlib import Path

from .core import (
    DEFAULT_PROFILES_DIR,
    DEFAULT_SESSION_URL,
    MANAGE_PROFILES_URL,
    DebugCallback,
    LoginOtpProvider,
    PLAYWRIGHT_IMPORT_ERROR,
    PlaywrightError,
    PlaywrightTimeoutError,
    _launch_context,
    _has_running_asyncio_loop,
    _run_in_plain_thread,
    click_text_candidate,
    emit_debug,
    fill_input_and_verify,
    first_visible,
    force_click_first,
    has_visible_error,
    looks_logged_in,
    resolve_profile_dir,
    sync_playwright,
    wait_for_short_network_idle,
)


@dataclass
class WorkflowResult:
    success: bool
    reason: str
    url: str
    profile_name: str | None = None
    profile_pin: str | None = None
    browser_profile: str | None = None
    steps: list[str] = field(default_factory=list)


def run_post_login_workflow(
    **kwargs,
) -> WorkflowResult:
    if _has_running_asyncio_loop():
        return _run_in_plain_thread(_run_post_login_workflow_impl, **kwargs)
    return _run_post_login_workflow_impl(**kwargs)


def _run_post_login_workflow_impl(
    *,
    email: str,
    account_password: str,
    account_pin: str | None = None,
    browser_profile_name: str | None = None,
    profiles_dir: str | Path = DEFAULT_PROFILES_DIR,
    session_url: str = MANAGE_PROFILES_URL,
    new_profile_name: str | None = None,
    profile_lock_pin: str | None = None,
    headless: bool = True,
    timeout_ms: int = 30000,
    slow_mo_ms: int = 0,
    proxy_server: str | None = None,
    otp_code_provider: LoginOtpProvider | None = None,
    debug: DebugCallback | None = None,
) -> WorkflowResult:
    """Create a Netflix profile and lock it after login has succeeded."""
    profile_dir = resolve_profile_dir(
        profile_name=browser_profile_name,
        identifier=email,
        profiles_dir=profiles_dir,
    )
    generated_profile_name = _clean_profile_name(new_profile_name) or _generate_profile_name()
    generated_lock_pin = _clean_pin(profile_lock_pin) or _generate_lock_pin()
    steps: list[str] = []

    def step(name: str) -> None:
        steps.append(name)
        emit_debug(debug, f"workflow_step={name}")

    emit_debug(
        debug,
        f"workflow_start session_url={session_url} headless={headless} profile={profile_dir} "
        f"new_profile_name={generated_profile_name}",
    )

    if PLAYWRIGHT_IMPORT_ERROR:
        emit_debug(debug, "playwright_import_error")
        return WorkflowResult(
            False,
            "Playwright is not installed. Run: pip install -r requirements-netflix-login.txt && python -m playwright install chromium",
            session_url,
            generated_profile_name,
            generated_lock_pin,
            str(profile_dir),
            steps,
        )

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
            step("open_session")
            page.goto(session_url, wait_until="domcontentloaded")
            wait_for_short_network_idle(page, debug=debug)

            if not looks_logged_in(context, page):
                return WorkflowResult(
                    False,
                    "session_not_logged_in_after_login",
                    page.url,
                    generated_profile_name,
                    generated_lock_pin,
                    str(profile_dir),
                    steps,
                )

            step("click_add_profile")
            if not _click_add_profile(page, debug=debug):
                return WorkflowResult(
                    False,
                    "add_profile_button_not_found",
                    page.url,
                    generated_profile_name,
                    generated_lock_pin,
                    str(profile_dir),
                    steps,
                )

            step("handle_account_pin_if_prompted")
            pin_status = _handle_account_pin_prompt(page, account_pin, debug=debug)
            if pin_status != "ok":
                return WorkflowResult(
                    False,
                    pin_status,
                    page.url,
                    generated_profile_name,
                    generated_lock_pin,
                    str(profile_dir),
                    steps,
                )

            step("fill_new_profile_name")
            if not _wait_and_fill_new_profile_name(page, generated_profile_name, timeout_ms=timeout_ms):
                return WorkflowResult(
                    False,
                    "new_profile_name_input_not_found",
                    page.url,
                    generated_profile_name,
                    generated_lock_pin,
                    str(profile_dir),
                    steps,
                )

            step("save_new_profile")
            if not _save_new_profile(page, generated_profile_name, debug=debug):
                return WorkflowResult(
                    False,
                    "new_profile_save_button_not_found",
                    page.url,
                    generated_profile_name,
                    generated_lock_pin,
                    str(profile_dir),
                    steps,
                )
            wait_for_short_network_idle(page, debug=debug)

            step("open_new_profile_settings")
            profile_guid = _wait_for_profile_guid(page, generated_profile_name, timeout_ms=timeout_ms)
            _ensure_manage_profiles_mode(page, debug=debug)
            if profile_guid and _click_profile_tile_for_settings(page, profile_guid, generated_profile_name):
                wait_for_short_network_idle(page, debug=debug)
            if profile_guid and not _is_profile_settings_page(page):
                page.goto(f"https://www.netflix.com/settings/{profile_guid}?referrer=ManageProfiles", wait_until="domcontentloaded")
                wait_for_short_network_idle(page, debug=debug)
            if not _is_profile_settings_page(page):
                return WorkflowResult(
                    False,
                    "profile_settings_page_not_opened",
                    page.url,
                    generated_profile_name,
                    generated_lock_pin,
                    str(profile_dir),
                    steps,
                )

            step("open_profile_lock")
            if not force_click_first(
                page,
                (
                    '[data-uia="menu-card+profile-lock"]',
                    '[data-uia="menu-card+profile-lock+item"]',
                ),
                timeout_ms=5000,
            ):
                return WorkflowResult(
                    False,
                    "profile_lock_button_not_found",
                    page.url,
                    generated_profile_name,
                    generated_lock_pin,
                    str(profile_dir),
                    steps,
                )
            wait_for_short_network_idle(page, debug=debug)

            step("create_profile_lock")
            if not force_click_first(
                page,
                ('[data-uia="profile-lock-off+add-button"]',),
                timeout_ms=7000,
            ):
                return WorkflowResult(
                    False,
                    "create_profile_lock_button_not_found",
                    page.url,
                    generated_profile_name,
                    generated_lock_pin,
                    str(profile_dir),
                    steps,
                )

            step("verify_identity")
            verified = verify_identity_for_profile_lock(
                page,
                account_password,
                otp_code_provider=otp_code_provider,
                allow_manual_otp=not headless,
                debug=debug,
            )
            if verified != "ok":
                return WorkflowResult(
                    False,
                    verified,
                    page.url,
                    generated_profile_name,
                    generated_lock_pin,
                    str(profile_dir),
                    steps,
                )
            wait_for_short_network_idle(page, debug=debug)

            step("save_profile_lock_pin")
            if not _save_profile_lock_pin(page, generated_lock_pin):
                return WorkflowResult(
                    False,
                    "profile_lock_pin_not_saved",
                    page.url,
                    generated_profile_name,
                    generated_lock_pin,
                    str(profile_dir),
                    steps,
                )
            wait_for_short_network_idle(page, debug=debug)

            return WorkflowResult(
                True,
                "workflow_success",
                page.url,
                generated_profile_name,
                generated_lock_pin,
                str(profile_dir),
                steps,
            )
        finally:
            emit_debug(debug, "workflow_close_browser")
            context.close()
            if browser:
                browser.close()


def _click_add_profile(page, *, debug: DebugCallback | None) -> bool:
    if force_click_first(page, ('[data-uia="profile-selector+add"]',), timeout_ms=5000):
        return True

    emit_debug(debug, "add_profile_not_visible_goto_browse")
    page.goto(DEFAULT_SESSION_URL, wait_until="domcontentloaded")
    wait_for_short_network_idle(page, debug=debug)
    return force_click_first(page, ('[data-uia="profile-selector+add"]',), timeout_ms=5000)


def _handle_account_pin_prompt(page, account_pin: str | None, *, debug: DebugCallback | None) -> str:
    pin_input = first_visible(
        page,
        (
            'input[name="PIN"][data-uia="profile-gate-pin+input"]',
            '[data-uia="profile-gate-pin+input"]',
        ),
        timeout_ms=2500,
    )
    if not pin_input:
        return "ok"

    cleaned_pin = _clean_pin(account_pin)
    if not cleaned_pin:
        return "account_pin_required"

    emit_debug(debug, "fill_account_pin")
    if not fill_input_and_verify(
        page,
        (
            'input[name="PIN"][data-uia="profile-gate-pin+input"]',
            '[data-uia="profile-gate-pin+input"]',
        ),
        cleaned_pin,
        timeout_ms=3000,
        require_interactable=False,
    ):
        return "account_pin_input_not_filled"

    try:
        pin_input.press("Enter", timeout=1000)
    except PlaywrightError:
        pass
    wait_for_short_network_idle(page, debug=debug)
    return "ok"


def _wait_and_fill_new_profile_name(page, profile_name: str, *, timeout_ms: int) -> bool:
    deadline = time.monotonic() + (timeout_ms / 1000)
    selectors = (
        'input[name="name"][data-uia="profile-gate-add-profile-modal+name-input"]',
        '[data-uia="profile-gate-add-profile-modal+name-input"]',
    )
    while time.monotonic() < deadline:
        if fill_input_and_verify(page, selectors, profile_name, timeout_ms=1500, require_interactable=False):
            return True
        page.wait_for_timeout(250)
    return False


def _save_new_profile(page, profile_name: str, *, debug: DebugCallback | None) -> bool:
    deadline = time.monotonic() + 10
    save_selectors = (
        '[data-uia="profile-gate-add-profile-modal+primary-button"]:not([disabled])',
        'button[data-uia="profile-gate-add-profile-modal+primary-button"]',
        'button[type="submit"]',
    )

    while time.monotonic() < deadline:
        clicked = False
        if _click_enabled_visible_save_button(page):
            emit_debug(debug, "new_profile_save_clicked_js")
            clicked = True
        elif force_click_first(page, save_selectors, timeout_ms=500):
            emit_debug(debug, "new_profile_save_clicked_selector")
            clicked = True

        if not clicked:
            name_input = first_visible(
                page,
                (
                    'input[name="name"][data-uia="profile-gate-add-profile-modal+name-input"]',
                    '[data-uia="profile-gate-add-profile-modal+name-input"]',
                ),
                timeout_ms=500,
            )
        else:
            name_input = None

        if not clicked and name_input:
            try:
                if name_input.input_value(timeout=500) != profile_name:
                    fill_input_and_verify(
                        page,
                        (
                            'input[name="name"][data-uia="profile-gate-add-profile-modal+name-input"]',
                            '[data-uia="profile-gate-add-profile-modal+name-input"]',
                        ),
                        profile_name,
                        timeout_ms=1000,
                        require_interactable=False,
                    )
                name_input.press("Enter", timeout=500)
                emit_debug(debug, "new_profile_save_pressed_enter")
                clicked = True
            except PlaywrightError:
                pass

        if clicked and _new_profile_save_finished(page, profile_name, timeout_ms=5000):
            return True

        page.wait_for_timeout(250)

    return False


def _new_profile_save_finished(page, profile_name: str, *, timeout_ms: int) -> bool:
    deadline = time.monotonic() + (timeout_ms / 1000)
    while time.monotonic() < deadline:
        if _profile_guid_for_name(page, profile_name):
            return True
        if first_visible(
            page,
            ('[data-uia="profile-gate-add-profile-modal"]',),
            timeout_ms=250,
        ) is None:
            return True
        page.wait_for_timeout(250)
    return False


def _click_enabled_visible_save_button(page) -> bool:
    try:
        return bool(
            page.evaluate(
                """() => {
                    const buttons = Array.from(document.querySelectorAll(
                        'button[data-uia="profile-gate-add-profile-modal+primary-button"], button[type="submit"]'
                    ));
                    const button = buttons.find((element) => {
                        const text = (element.innerText || element.textContent || '').trim();
                        const rect = element.getBoundingClientRect();
                        const style = window.getComputedStyle(element);
                        return !element.disabled
                            && rect.width > 0
                            && rect.height > 0
                            && style.visibility !== 'hidden'
                            && style.display !== 'none'
                            && (!text || /save|บันทึก/i.test(text));
                    });
                    if (!button) return false;
                    button.scrollIntoView({ block: 'center', inline: 'center' });
                    button.click();
                    return true;
                }"""
            )
        )
    except PlaywrightError:
        return False


def _wait_for_profile_guid(page, profile_name: str, *, timeout_ms: int) -> str | None:
    deadline = time.monotonic() + (timeout_ms / 1000)
    while time.monotonic() < deadline:
        guid = _profile_guid_for_name(page, profile_name)
        if guid:
            return guid
        page.wait_for_timeout(300)
    return None


def _profile_guid_for_name(page, profile_name: str) -> str | None:
    try:
        return page.evaluate(
            """profileName => {
                const tiles = Array.from(document.querySelectorAll('[data-uia^="profile-selector+tile-"]'));
                const tile = tiles.find((element) => {
                    const text = (element.innerText || element.textContent || '').trim();
                    return text.split(/\\s+/).includes(profileName) || text === profileName;
                });
                if (!tile) return null;
                const dataUia = tile.getAttribute('data-uia') || '';
                const match = dataUia.match(/^profile-selector\\+tile-(.+)$/);
                return match ? match[1] : null;
            }""",
            profile_name,
        )
    except PlaywrightError:
        return None


def _ensure_manage_profiles_mode(page, *, debug: DebugCallback | None) -> bool:
    if _is_profile_settings_page(page):
        return True
    if first_visible(page, ('[data-uia="profile-gate-screen+done"]',), timeout_ms=750):
        emit_debug(debug, "manage_profiles_mode_already_active")
        return True

    manage_selectors = (
        '[data-uia="profile-gate-screen+manage-profiles"]',
        '[data-uia*="manage-profile"]',
        'button:has-text("จัดการโปรไฟล์")',
        'button:has-text("Manage Profiles")',
    )
    if force_click_first(page, manage_selectors, timeout_ms=1500) or click_text_candidate(page, r"จัดการโปรไฟล์|manage profiles"):
        emit_debug(debug, "manage_profiles_clicked")
        wait_for_short_network_idle(page, debug=debug)
        try:
            page.wait_for_selector('[data-uia="profile-gate-screen+done"], [data-uia$="+edit"]', timeout=5000)
        except PlaywrightTimeoutError:
            pass
        return True

    emit_debug(debug, "manage_profiles_button_not_visible")
    return False


def _click_profile_tile_for_settings(page, profile_guid: str, profile_name: str) -> bool:
    edit_selector = f'[data-uia="profile-selector+tile-{profile_guid}+edit"]'
    if force_click_first(page, (edit_selector,), timeout_ms=1500):
        return True

    try:
        return bool(
            page.evaluate(
                """({ profileGuid, profileName }) => {
                    const edit = document.querySelector(`[data-uia="profile-selector+tile-${profileGuid}+edit"]`);
                    if (edit) {
                        edit.click();
                        return true;
                    }
                    const tiles = Array.from(document.querySelectorAll('[data-uia^="profile-selector+tile-"]'));
                    const tile = tiles.find((element) => {
                        const text = (element.innerText || element.textContent || '').trim();
                        return text.split(/\\s+/).includes(profileName) || text === profileName;
                    });
                    if (!tile) return false;
                    tile.click();
                    return true;
                }""",
                {"profileGuid": profile_guid, "profileName": profile_name},
            )
        )
    except PlaywrightError:
        return False


def _is_profile_settings_page(page) -> bool:
    return first_visible(
        page,
        (
            '[data-uia="profile-settings-page"]',
            '[data-uia="menu-card+profile-lock"]',
        ),
        timeout_ms=1500,
    ) is not None


MFA_PASSWORD_BUTTON = '[data-uia="account-mfa-button-PASSWORD"] button'
MFA_OTP_EMAIL_BUTTON = '[data-uia="account-mfa-button-OTP_EMAIL"] button'
CHALLENGE_PASSWORD_INPUTS = (
    'input[name="challengePassword"][data-uia="collect-password-input-modal-entry"]',
    '[data-uia="collect-password-input-modal-entry"]',
    'input[name="challengePassword"]',
)
CHALLENGE_OTP_INPUT = '[data-uia="collect-otp-input-entry"]'
CHALLENGE_SUBMIT = '[data-uia="collect-input-submit-cta"]'


def verify_identity_for_profile_lock(
    page,
    account_password: str,
    *,
    otp_code_provider: LoginOtpProvider | None = None,
    allow_manual_otp: bool = False,
    debug: DebugCallback | None = None,
    timeout_ms: int = 180000,
) -> str:
    """Gets from "add profile lock" to the PIN entry page.

    Netflix asks for the account password or, when it only offers it, a code
    mailed to the account ("ส่งรหัสทางอีเมล"). Codes come from
    `otp_code_provider`; without one, a headed browser waits for a person to
    type the code. Returns "ok" or a failure reason.
    """
    deadline = time.monotonic() + timeout_ms / 1000
    password_submitted = False
    tried_codes: set[str] = set()
    waiting_for_manual = False

    while time.monotonic() < deadline:
        if _is_profile_lock_pin_entry(page):
            return "ok"

        if first_visible(page, (CHALLENGE_OTP_INPUT,), timeout_ms=300):
            if otp_code_provider:
                try:
                    codes = [str(code) for code in otp_code_provider() if str(code) not in tried_codes]
                except Exception as exc:  # provider owns mailbox IO
                    return f"profile_lock_otp_provider_error: {exc}"
                if not codes:
                    return "profile_lock_otp_not_received"
                for code in codes:
                    tried_codes.add(code)
                    emit_debug(debug, f"profile_lock_otp_try length={len(code)}")
                    if _submit_challenge_otp(page, code):
                        break
                continue
            if not allow_manual_otp:
                return "profile_lock_otp_required"
            if not waiting_for_manual:
                waiting_for_manual = True
                emit_debug(debug, "profile_lock_otp_waiting_manual กรุณากรอกรหัสจากอีเมลในหน้าต่าง browser แล้วกดส่ง")
            page.wait_for_timeout(1000)
            continue

        if first_visible(page, CHALLENGE_PASSWORD_INPUTS, timeout_ms=300):
            if password_submitted:
                error = has_visible_error(page)
                if error:
                    return f"account_password_rejected: {error}"
                page.wait_for_timeout(500)
                continue
            emit_debug(debug, "profile_lock_submit_account_password")
            if not _submit_account_password(page, account_password):
                return "account_password_prompt_not_filled"
            password_submitted = True
            wait_for_short_network_idle(page, debug=debug)
            continue

        if force_click_first(page, (MFA_PASSWORD_BUTTON,), timeout_ms=300):
            emit_debug(debug, "profile_lock_choose_password")
            wait_for_short_network_idle(page, debug=debug)
            continue

        if force_click_first(page, (MFA_OTP_EMAIL_BUTTON,), timeout_ms=300):
            emit_debug(debug, "profile_lock_choose_email_otp")
            wait_for_short_network_idle(page, debug=debug)
            continue

        page.wait_for_timeout(300)

    return "profile_lock_otp_timeout" if waiting_for_manual else "profile_lock_pin_entry_not_reached"


def _submit_challenge_otp(page, code: str) -> bool:
    """True once Netflix leaves the code entry page."""
    if not fill_input_and_verify(page, (CHALLENGE_OTP_INPUT,), code, timeout_ms=5000, require_interactable=False):
        return False
    if not force_click_first(page, (CHALLENGE_SUBMIT, 'button[type="submit"]'), timeout_ms=2000):
        return False
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        if not first_visible(page, (CHALLENGE_OTP_INPUT,), timeout_ms=300):
            return True
        if has_visible_error(page):
            return False
        page.wait_for_timeout(300)
    return False


def _choose_password_verification(page, *, debug: DebugCallback | None) -> bool:
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        if _is_profile_lock_pin_entry(page):
            emit_debug(debug, "password_verification_skipped_pin_entry_ready")
            return True
        if force_click_first(page, ('[data-uia="account-mfa-button-PASSWORD"] button',), timeout_ms=500):
            return True
        if first_visible(page, ('[data-uia="collect-password-input-modal-entry"]',), timeout_ms=500):
            return True
        if click_text_candidate(page, r"password"):
            return True
        if click_text_candidate(page, r"ยืนยันรหัสผ่าน"):
            return True
        page.wait_for_timeout(250)
    emit_debug(debug, "password_verification_not_found")
    return False


def _submit_account_password(page, account_password: str) -> bool:
    if _is_profile_lock_pin_entry(page):
        return True

    if not fill_input_and_verify(
        page,
        (
            'input[name="challengePassword"][data-uia="collect-password-input-modal-entry"]',
            '[data-uia="collect-password-input-modal-entry"]',
            'input[name="challengePassword"]',
            'input[type="password"]',
        ),
        account_password,
        timeout_ms=7000,
        require_interactable=False,
    ):
        return False

    if force_click_first(page, ('[data-uia="collect-input-submit-cta"]', 'button[type="submit"]'), timeout_ms=3000):
        return True

    password_input = first_visible(page, ('input[name="challengePassword"]', 'input[type="password"]'), timeout_ms=1000)
    if not password_input:
        return False
    try:
        password_input.press("Enter", timeout=1000)
        return True
    except PlaywrightError:
        return False


def _save_profile_lock_pin(page, profile_lock_pin: str) -> bool:
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        if _fill_and_submit_profile_lock_pin(page, profile_lock_pin):
            return True
        page.wait_for_timeout(250)
    return False


def _fill_and_submit_profile_lock_pin(page, profile_lock_pin: str) -> bool:
    if not fill_input_and_verify(
        page,
        (
            'input[name="PIN"][data-uia="profile-lock+pin-input"]',
            '[data-uia="profile-lock+pin-input"]',
        ),
        profile_lock_pin,
        timeout_ms=7000,
        require_interactable=False,
    ):
        return False

    if force_click_first(page, ('[data-uia="profile-lock-pin-entry-page+save-button"]',), timeout_ms=3000):
        return True

    pin_input = first_visible(page, ('[data-uia="profile-lock+pin-input"]', 'input[name="PIN"]'), timeout_ms=1000)
    if not pin_input:
        return False
    try:
        pin_input.press("Enter", timeout=1000)
        return True
    except PlaywrightError:
        return False


def _is_profile_lock_pin_entry(page) -> bool:
    if "/settings/lock/pinEntry/" in page.url:
        return True
    return first_visible(
        page,
        (
            '[data-uia="profile-lock-pin-entry-page"]',
            '[data-uia="profile-lock+pin-input"]',
            'input[name="PIN"][data-uia="profile-lock+pin-input"]',
        ),
        timeout_ms=500,
    ) is not None


def _generate_profile_name() -> str:
    alphabet = string.ascii_lowercase + string.digits
    return "n" + "".join(secrets.choice(alphabet) for _ in range(5))


def _generate_lock_pin() -> str:
    return "".join(secrets.choice(string.digits) for _ in range(4))


def _clean_profile_name(value: str | None) -> str:
    if not value:
        return ""
    cleaned = "".join(ch for ch in str(value).strip() if ch.isalnum())
    return cleaned[:6]


def _clean_pin(value: str | None) -> str:
    if not value:
        return ""
    cleaned = "".join(ch for ch in str(value).strip() if ch.isdigit())
    return cleaned[:4] if len(cleaned) >= 4 else ""
