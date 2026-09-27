from __future__ import annotations

import secrets
import string
import time
from dataclasses import dataclass, field
from pathlib import Path

from .core import (
    DEFAULT_PROFILES_DIR,
    DEFAULT_SESSION_URL,
    DebugCallback,
    PLAYWRIGHT_IMPORT_ERROR,
    PlaywrightError,
    PlaywrightTimeoutError,
    _launch_context,
    click_text_candidate,
    emit_debug,
    fill_input_and_verify,
    first_visible,
    force_click_first,
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
    *,
    email: str,
    account_password: str,
    account_pin: str | None = None,
    browser_profile_name: str | None = None,
    profiles_dir: str | Path = DEFAULT_PROFILES_DIR,
    session_url: str = DEFAULT_SESSION_URL,
    new_profile_name: str | None = None,
    profile_lock_pin: str | None = None,
    headless: bool = True,
    timeout_ms: int = 30000,
    slow_mo_ms: int = 0,
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
            if profile_guid and _click_profile_tile_by_name(page, generated_profile_name):
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

            step("choose_password_verification")
            if _is_profile_lock_pin_entry(page):
                emit_debug(debug, "already_on_profile_lock_pin_entry")
            elif not _choose_password_verification(page, debug=debug):
                return WorkflowResult(
                    False,
                    "password_verification_button_not_found",
                    page.url,
                    generated_profile_name,
                    generated_lock_pin,
                    str(profile_dir),
                    steps,
                )

            step("submit_account_password")
            if _is_profile_lock_pin_entry(page):
                emit_debug(debug, "skip_account_password_already_on_pin_entry")
            elif not _submit_account_password(page, account_password):
                return WorkflowResult(
                    False,
                    "account_password_prompt_not_filled",
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


def _click_profile_tile_by_name(page, profile_name: str) -> bool:
    try:
        return bool(
            page.evaluate(
                """profileName => {
                    const tiles = Array.from(document.querySelectorAll('[data-uia^="profile-selector+tile-"]'));
                    const tile = tiles.find((element) => {
                        const text = (element.innerText || element.textContent || '').trim();
                        return text.split(/\\s+/).includes(profileName) || text === profileName;
                    });
                    if (!tile) return false;
                    tile.click();
                    return true;
                }""",
                profile_name,
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
