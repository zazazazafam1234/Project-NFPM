#!/usr/bin/env python3
"""Check whether a Netflix login succeeds using a real browser.

Usage:
    NETFLIX_EMAIL="you@example.com" NETFLIX_PASSWORD="..." \
        python scripts/netflix_login_check.py --headful

The script intentionally does not bypass CAPTCHA, MFA, or other account
protection challenges. Use it only with an account you own or are authorized
to test.
"""

from __future__ import annotations

import asyncio
import hashlib
import re
import shutil
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterable
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

PLAYWRIGHT_IMPORT_ERROR: ImportError | None = None

try:
    from playwright.sync_api import (
        Browser,
        BrowserContext,
        Error as PlaywrightError,
        Locator,
        Page,
        TimeoutError as PlaywrightTimeoutError,
        sync_playwright,
    )
except ImportError as exc:  # pragma: no cover - depends on local environment
    PLAYWRIGHT_IMPORT_ERROR = exc
    PlaywrightError = Exception
    PlaywrightTimeoutError = Exception
    sync_playwright = None


DEFAULT_LOGIN_URL = "https://www.netflix.com/th-en/login"
FALLBACK_LOGIN_URL = "https://www.netflix.com/login"
DEFAULT_SESSION_URL = "https://www.netflix.com/browse"
DEFAULT_PROFILES_DIR = ".netflix_profiles"
STALE_LOGIN_QUERY_KEYS = {"serverstate", "authurl", "state"}


@dataclass
class LoginResult:
    success: bool
    reason: str
    url: str
    profile: str | None = None


DebugCallback = Callable[[str], None]


def _has_running_asyncio_loop() -> bool:
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return False
    return True


def _run_in_plain_thread(function, *args, **kwargs):
    result: dict[str, object] = {}

    def target() -> None:
        try:
            result["value"] = function(*args, **kwargs)
        except BaseException as exc:  # pragma: no cover - re-raised in caller thread
            result["error"] = exc

    thread = threading.Thread(target=target, daemon=True)
    thread.start()
    thread.join()
    if "error" in result:
        raise result["error"]  # type: ignore[misc]
    return result.get("value")


def emit_debug(debug: DebugCallback | None, message: str) -> None:
    if debug:
        debug(message)


def wait_for_short_network_idle(page: Page, *, debug: DebugCallback | None = None, timeout_ms: int = 1000) -> None:
    try:
        page.wait_for_load_state("networkidle", timeout=timeout_ms)
        emit_debug(debug, f"network_idle timeout_ms={timeout_ms}")
    except PlaywrightTimeoutError:
        emit_debug(debug, f"network_idle_skipped timeout_ms={timeout_ms}")


def is_stale_login_state(page: Page) -> bool:
    has_state_query = bool(re.search(r"[?&](?:serverState|authURL|state)=", page.url, re.I))
    try:
        text = page.locator("body").first.inner_text(timeout=1000)
    except PlaywrightError:
        return False
    has_stale_error = bool(re.search(r"something went wrong|error code:\s*10\d{2}", text, re.I))
    return has_stale_error or (has_state_query and bool(re.search(r"try again in a few minutes", text, re.I)))


def clean_login_url(login_url: str | None) -> str:
    candidate = (login_url or DEFAULT_LOGIN_URL).strip() or DEFAULT_LOGIN_URL
    try:
        parsed = urlparse(candidate)
    except ValueError:
        return DEFAULT_LOGIN_URL

    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return DEFAULT_LOGIN_URL

    host = parsed.netloc.lower()
    if host == "netflix.com" or host.endswith(".netflix.com"):
        if "/login" in parsed.path.lower():
            query = [
                (key, value)
                for key, value in parse_qsl(parsed.query, keep_blank_values=True)
                if key.lower() not in STALE_LOGIN_QUERY_KEYS
            ]
            return urlunparse(
                (
                    parsed.scheme,
                    parsed.netloc,
                    parsed.path or "/login",
                    "",
                    urlencode(query, doseq=True),
                    "",
                )
            )

    return candidate


def login_retry_url(original_login_url: str, retry_index: int) -> str | None:
    candidates: list[str] = []
    for candidate in (clean_login_url(original_login_url), DEFAULT_LOGIN_URL, FALLBACK_LOGIN_URL):
        if candidate not in candidates:
            candidates.append(candidate)

    next_index = retry_index + 1
    if next_index >= len(candidates):
        return None
    return candidates[next_index]


def clear_persistent_profile(profile_dir: Path | None, *, debug: DebugCallback | None = None) -> bool:
    if not profile_dir or not profile_dir.exists():
        return False
    shutil.rmtree(profile_dir, ignore_errors=True)
    removed = not profile_dir.exists()
    emit_debug(debug, f"persistent_profile_reset profile={profile_dir} removed={removed}")
    return removed


def profile_name_for_identifier(identifier: str) -> str:
    digest = hashlib.sha256(identifier.strip().lower().encode("utf-8")).hexdigest()[:16]
    return f"acct-{digest}"


def resolve_profile_dir(
    *,
    profile_name: str | None,
    identifier: str,
    profiles_dir: str | Path = DEFAULT_PROFILES_DIR,
) -> Path:
    name = profile_name or profile_name_for_identifier(identifier)
    safe_name = re.sub(r"[^a-zA-Z0-9_.-]+", "_", name).strip("._")
    if not safe_name:
        safe_name = profile_name_for_identifier(identifier)
    return Path(profiles_dir).expanduser().resolve() / safe_name[:80]


def visible(locator: Locator, timeout_ms: int = 750) -> bool:
    try:
        locator.first.wait_for(state="visible", timeout=timeout_ms)
        return True
    except PlaywrightTimeoutError:
        return False


def can_receive_pointer(locator: Locator) -> bool:
    try:
        return bool(
            locator.first.evaluate(
                """element => {
                    const rect = element.getBoundingClientRect();
                    if (rect.width < 2 || rect.height < 2) return false;
                    const style = window.getComputedStyle(element);
                    if (style.visibility === 'hidden' || style.display === 'none') return false;
                    if (element.disabled) return false;

                    const x = Math.min(Math.max(rect.left + rect.width / 2, 0), window.innerWidth - 1);
                    const y = Math.min(Math.max(rect.top + rect.height / 2, 0), window.innerHeight - 1);
                    const topElement = document.elementFromPoint(x, y);
                    return topElement === element || element.contains(topElement);
                }"""
            )
        )
    except PlaywrightError:
        return False


def first_visible(page: Page, selectors: Iterable[str], timeout_ms: int = 1500) -> Locator | None:
    for selector in selectors:
        locator = page.locator(selector).first
        if visible(locator, timeout_ms):
            return locator
    return None


def first_interactable(page: Page, selectors: Iterable[str], timeout_ms: int = 1500) -> Locator | None:
    for selector in selectors:
        locator = page.locator(selector).first
        if visible(locator, timeout_ms) and can_receive_pointer(locator):
            return locator
    return None


def has_visible(page: Page, selectors: Iterable[str], timeout_ms: int = 250) -> bool:
    return first_visible(page, selectors, timeout_ms) is not None


def body_has(page: Page, pattern: str, timeout_ms: int = 1000) -> bool:
    try:
        text = page.locator("body").inner_text(timeout=timeout_ms)
    except PlaywrightError:
        return False
    return bool(re.search(pattern, text, re.I))


def click_first(page: Page, selectors: Iterable[str], timeout_ms: int = 1500) -> bool:
    locator = first_interactable(page, selectors, timeout_ms)
    if not locator:
        return False
    try:
        locator.click(timeout=timeout_ms)
        return True
    except PlaywrightError:
        return False


def force_click_first(page: Page, selectors: Iterable[str], timeout_ms: int = 1500) -> bool:
    locator = first_visible(page, selectors, timeout_ms)
    if not locator:
        return False
    try:
        locator.click(timeout=timeout_ms, force=True)
        return True
    except PlaywrightError:
        return False


def click_text_candidate(page: Page, pattern: str) -> bool:
    try:
        return bool(
            page.evaluate(
                """pattern => {
                    const regex = new RegExp(pattern, 'i');
                    const candidates = Array.from(document.querySelectorAll('button,a,[role="button"],[data-uia]'));
                    const match = candidates.find((element) => {
                        const text = (element.innerText || element.textContent || '').trim();
                        if (!regex.test(text)) return false;
                        const rect = element.getBoundingClientRect();
                        const style = window.getComputedStyle(element);
                        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
                    });
                    if (!match) return false;
                    match.click();
                    return true;
                }""",
                pattern,
            )
        )
    except PlaywrightError:
        return False


def fill_input_and_verify(
    page: Page,
    selectors: Iterable[str],
    value: str,
    timeout_ms: int = 5000,
    *,
    require_interactable: bool = True,
) -> bool:
    locator = first_visible(page, selectors, timeout_ms)
    if not locator:
        return False

    try:
        locator.scroll_into_view_if_needed(timeout=timeout_ms)
        locator.fill(value, timeout=timeout_ms, force=True)
    except PlaywrightError:
        pass

    try:
        if locator.input_value(timeout=1000) == value:
            return True
    except PlaywrightTimeoutError:
        pass

    try:
        locator.evaluate(
            """(element, value) => {
                const setter = Object.getOwnPropertyDescriptor(
                    window.HTMLInputElement.prototype,
                    'value'
                ).set;
                element.focus();
                setter.call(element, value);
                element.dispatchEvent(new InputEvent('input', {
                    bubbles: true,
                    inputType: 'insertText',
                    data: value
                }));
                element.dispatchEvent(new Event('change', { bubbles: true }));
            }""",
            value,
        )
    except PlaywrightError:
        pass

    try:
        if locator.input_value(timeout=1000) == value:
            return True
    except PlaywrightTimeoutError:
        pass

    try:
        locator.click(timeout=1000, force=True)
        locator.press("Meta+A", timeout=1000)
        locator.press("Control+A", timeout=1000)
        locator.type(value, delay=15, timeout=timeout_ms)
    except PlaywrightError:
        return False

    try:
        return locator.input_value(timeout=1000) == value
    except PlaywrightTimeoutError:
        return False


def ensure_email_still_filled(page: Page, email: str) -> bool:
    email_locator = first_visible(
        page,
        (
            'input[name="userLoginId"]',
            'input[type="email"]',
            'input[name="email"]',
        ),
        timeout_ms=750,
    )
    if not email_locator:
        return True

    try:
        if email_locator.input_value(timeout=1000) == email:
            return True
    except PlaywrightTimeoutError:
        pass

    return fill_input_and_verify(
        page,
        (
            'input[name="userLoginId"]',
            'input[type="email"]',
            'input[name="email"]',
        ),
        email,
        require_interactable=False,
    )


def wait_for_next_login_step(page: Page, timeout_ms: int) -> str:
    deadline = time.monotonic() + (timeout_ms / 1000)
    while time.monotonic() < deadline:
        if has_visible(
            page,
            (
                '[data-uia="collect-otp"]',
                '[data-uia="pin-entry"]',
                'input[name="challengeOtp"]',
                'input[autocomplete="one-time-code"]',
            ),
            timeout_ms=100,
        ):
            return "otp"
        if body_has(page, r"enter the code|enter a pin code|didn.t get a code", timeout_ms=250):
            return "otp"

        if first_visible(
            page,
            (
                'input[name="password"]',
                'input[type="password"]',
                '[data-uia="password-input"]',
            ),
            timeout_ms=250,
        ):
            return "password"

        if first_visible(
            page,
            (
                '[data-uia="usePasswordInsteadHelpMenuItem"]',
                'button:has-text("Use password instead")',
                'a:has-text("Use password instead")',
                'text=/Use password instead/i',
            ),
            timeout_ms=250,
        ):
            return "use_password"

        if has_visible_error(page):
            return "error"

        page.wait_for_timeout(300)

    return "timeout"


def maybe_click_use_password(page: Page) -> bool:
    use_password_selectors = (
        '[data-uia="usePasswordInsteadHelpMenuItem"]',
        '[data-uia="help-menu-item-0"]:has-text("Use password")',
        'button:has-text("Use password instead")',
        'a:has-text("Use password instead")',
        'text=/Use password instead/i',
    )
    if force_click_first(page, use_password_selectors, timeout_ms=500):
        return True
    if click_text_candidate(page, r"use password"):
        return True

    # Only open Netflix's specific login help menu. Do not click broad "help"
    # buttons, because those can navigate away before credentials are entered.
    force_click_first(
        page,
        (
            '[data-uia="help-menu-toggle-collapsed"]',
            '[data-uia="help-menu-toggle-expanded"]',
        ),
        timeout_ms=750,
    )

    deadline = time.monotonic() + 4
    while time.monotonic() < deadline:
        if force_click_first(page, use_password_selectors, timeout_ms=350):
            return True
        if click_text_candidate(page, r"use password"):
            return True
        page.wait_for_timeout(150)

    return False


def wait_for_password_ready(page: Page, timeout_ms: int) -> bool:
    deadline = time.monotonic() + (timeout_ms / 1000)
    password_selectors = (
        'input[name="password"]',
        'input[type="password"]',
        '[data-uia="password-input"]',
        '[data-uia="field-password"]',
    )
    while time.monotonic() < deadline:
        if first_visible(page, password_selectors, timeout_ms=150):
            return True
        page.wait_for_timeout(150)
    return False


def submit_password_form(page: Page, timeout_ms: int = 2500) -> bool:
    submit_selectors = (
        '[data-uia="sign-in-button"]',
        'button:has-text("Sign In")',
        'button:has-text("Sign in")',
        '[data-uia="continue-button"]',
        'button[type="submit"]',
    )
    if force_click_first(page, submit_selectors, timeout_ms=timeout_ms):
        return True

    password_input = first_visible(page, ('input[name="password"]', 'input[type="password"]'), timeout_ms=750)
    if not password_input:
        return False
    try:
        password_input.press("Enter", timeout=timeout_ms)
        return True
    except PlaywrightError:
        return False


def has_visible_error(page: Page) -> str | None:
    error_selectors = (
        '[data-uia*="error"]',
        ".ui-message-error",
        '[role="alert"]',
        'text=/incorrect password/i',
        'text=/can.t find an account/i',
        'text=/try again/i',
        'text=/wrong/i',
    )
    for selector in error_selectors:
        locator = page.locator(selector).first
        if visible(locator, timeout_ms=500):
            try:
                message = locator.inner_text(timeout=1000).strip()
            except PlaywrightTimeoutError:
                message = selector
            return message or selector
    return None


def is_challenge_page(page: Page) -> bool:
    challenge_text = re.compile(
        r"complete (?:the )?captcha|security check|unusual activity|"
        r"verify (?:that )?you(?:'re| are) human|verification required",
        re.I,
    )
    body = page.locator("body").first
    try:
        text = body.inner_text(timeout=1000)
    except PlaywrightTimeoutError:
        return False
    return bool(challenge_text.search(text))


def looks_logged_in(context: BrowserContext, page: Page) -> bool:
    success_url_patterns = ("/browse", "/profiles", "/latest", "/search")
    if any(pattern in page.url for pattern in success_url_patterns):
        return True

    success_selectors = (
        '[data-uia="profile-gate-screen"]',
        '[data-uia="profile-gate-label"]',
        '[data-uia*="profile"]',
        'a[href*="/browse"]',
        'text=/Who.s watching/i',
        'text=/เลือกผู้ชม/i',
    )
    if any(visible(page.locator(selector).first, timeout_ms=500) for selector in success_selectors):
        return True

    cookies = context.cookies(["https://www.netflix.com"])
    has_auth_cookie = any(cookie.get("name") == "NetflixId" for cookie in cookies)
    return has_auth_cookie and "/login" not in page.url


def wait_for_login_result(context: BrowserContext, page: Page, timeout_ms: int) -> LoginResult:
    deadline = time.monotonic() + (timeout_ms / 1000)
    while time.monotonic() < deadline:
        if looks_logged_in(context, page):
            return LoginResult(True, "login_success", page.url)

        error = has_visible_error(page)
        if error:
            if looks_logged_in(context, page):
                return LoginResult(True, "login_success", page.url)
            return LoginResult(False, f"login_failed: {error}", page.url)

        if is_challenge_page(page):
            return LoginResult(False, "login_challenge_required", page.url)

        page.wait_for_timeout(500)

    return LoginResult(False, "login_result_timeout", page.url)


def wait_for_manual_login(
    context: BrowserContext,
    page: Page,
    *,
    timeout_ms: int,
    debug: DebugCallback | None = None,
    reason: str = "manual_login_required",
) -> LoginResult:
    emit_debug(debug, f"manual_login_wait_start reason={reason} timeout_ms={timeout_ms}")
    deadline = time.monotonic() + (timeout_ms / 1000)
    while time.monotonic() < deadline:
        try:
            if looks_logged_in(context, page):
                emit_debug(debug, "manual_login_success")
                return LoginResult(True, "login_success_manual", page.url)
        except PlaywrightError as exc:
            emit_debug(debug, f"manual_login_browser_closed {exc}")
            return LoginResult(False, "manual_login_browser_closed", page.url)
        page.wait_for_timeout(1000)

    emit_debug(debug, "manual_login_timeout")
    return LoginResult(False, f"manual_login_timeout:{reason}", page.url)


def _launch_context(
    playwright,
    *,
    headless: bool,
    slow_mo_ms: int,
    profile_dir: Path | None,
    proxy_server: str | None,
    debug: DebugCallback | None,
) -> tuple[Browser | None, BrowserContext]:
    proxy = _proxy_options(proxy_server)
    if profile_dir:
        profile_dir.mkdir(parents=True, exist_ok=True)
        emit_debug(debug, f"launch_persistent_browser profile={profile_dir} proxy={_proxy_label(proxy_server)}")
        context = playwright.chromium.launch_persistent_context(
            str(profile_dir),
            headless=headless,
            slow_mo=slow_mo_ms,
            locale="en-US",
            viewport={"width": 1366, "height": 900},
            proxy=proxy,
        )
        return None, context

    emit_debug(debug, f"launch_browser proxy={_proxy_label(proxy_server)}")
    browser: Browser = playwright.chromium.launch(headless=headless, slow_mo=slow_mo_ms, proxy=proxy)
    context = browser.new_context(
        locale="en-US",
        viewport={"width": 1366, "height": 900},
    )
    return browser, context


def _proxy_options(proxy_server: str | None) -> dict | None:
    if not proxy_server:
        return None
    server = str(proxy_server).strip()
    if not server:
        return None
    return {"server": server}


def _proxy_label(proxy_server: str | None) -> str:
    return "enabled" if proxy_server and str(proxy_server).strip() else "disabled"


def _with_profile(result: LoginResult, profile: str | None) -> LoginResult:
    result.profile = profile
    return result


def check_netflix_session(
    **kwargs,
) -> LoginResult:
    if _has_running_asyncio_loop():
        return _run_in_plain_thread(_check_netflix_session_impl, **kwargs)
    return _check_netflix_session_impl(**kwargs)


def _check_netflix_session_impl(
    *,
    profile_name: str | None = None,
    email: str | None = None,
    profiles_dir: str | Path = DEFAULT_PROFILES_DIR,
    session_url: str = DEFAULT_SESSION_URL,
    headless: bool = True,
    timeout_ms: int = 30000,
    slow_mo_ms: int = 0,
    proxy_server: str | None = None,
    debug: DebugCallback | None = None,
) -> LoginResult:
    identifier = profile_name or email
    if not identifier:
        return LoginResult(False, "missing_profile: send profile_name or email", session_url)

    profile_dir = resolve_profile_dir(
        profile_name=profile_name,
        identifier=identifier,
        profiles_dir=profiles_dir,
    )
    emit_debug(debug, f"check_session_start url={session_url} headless={headless} profile={profile_dir}")

    if PLAYWRIGHT_IMPORT_ERROR:
        emit_debug(debug, "playwright_import_error")
        return LoginResult(
            False,
            "Playwright is not installed. Run: pip install -r requirements-netflix-login.txt && python -m playwright install chromium",
            session_url,
            str(profile_dir),
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
            emit_debug(debug, "goto_session_page")
            page.goto(session_url, wait_until="domcontentloaded")
            wait_for_short_network_idle(page, debug=debug)

            if looks_logged_in(context, page):
                emit_debug(debug, "session_valid")
                return LoginResult(True, "session_valid", page.url, str(profile_dir))

            emit_debug(debug, f"session_not_logged_in url={page.url}")
            return LoginResult(False, "session_not_logged_in", page.url, str(profile_dir))
        finally:
            emit_debug(debug, "close_browser")
            context.close()
            if browser:
                browser.close()


def login_netflix(
    email: str,
    password: str,
    **kwargs,
) -> LoginResult:
    if _has_running_asyncio_loop():
        return _run_in_plain_thread(_login_netflix_impl, email, password, **kwargs)
    return _login_netflix_impl(email, password, **kwargs)


def _login_netflix_impl(
    email: str,
    password: str,
    *,
    login_url: str = DEFAULT_LOGIN_URL,
    headless: bool = True,
    timeout_ms: int = 30000,
    slow_mo_ms: int = 0,
    clear_cache: bool | None = None,
    persistent_profile: bool = False,
    profile_name: str | None = None,
    profiles_dir: str | Path = DEFAULT_PROFILES_DIR,
    proxy_server: str | None = None,
    debug: DebugCallback | None = None,
    allow_manual_login: bool = False,
    manual_login_timeout_ms: int = 300000,
    _stale_reset_count: int = 0,
) -> LoginResult:
    original_login_url = login_url
    login_url = clean_login_url(login_url)
    profile_dir = None
    if persistent_profile:
        profile_dir = resolve_profile_dir(
            profile_name=profile_name,
            identifier=email,
            profiles_dir=profiles_dir,
        )
    if clear_cache is None:
        clear_cache = not persistent_profile

    emit_debug(
        debug,
        f"login_start url={login_url} headless={headless} timeout_ms={timeout_ms} "
        f"clear_cache={clear_cache} persistent_profile={persistent_profile} profile={profile_dir} "
        f"proxy={_proxy_label(proxy_server)} allow_manual_login={allow_manual_login}",
    )
    if login_url != original_login_url:
        emit_debug(debug, f"login_url_sanitized original={original_login_url} clean={login_url}")
    if PLAYWRIGHT_IMPORT_ERROR:
        emit_debug(debug, "playwright_import_error")
        return LoginResult(
            False,
            "Playwright is not installed. Run: pip install -r requirements-netflix-login.txt && python -m playwright install chromium",
            login_url,
            str(profile_dir) if profile_dir else None,
        )

    if clear_cache and persistent_profile and profile_dir:
        clear_persistent_profile(profile_dir, debug=debug)

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
        context_closed_for_retry = False

        def retry_after_stale_state(stage: str) -> LoginResult:
            nonlocal context_closed_for_retry
            stale_url = page.url
            emit_debug(debug, f"stale_login_state_detected stage={stage} url={stale_url}")
            next_login_url = login_retry_url(login_url, _stale_reset_count)
            if not next_login_url and allow_manual_login and not headless:
                return _with_profile(
                    wait_for_manual_login(
                        context,
                        page,
                        timeout_ms=manual_login_timeout_ms,
                        debug=debug,
                        reason=f"stale_login_state:{stage}",
                    ),
                    str(profile_dir) if profile_dir else None,
                )

            context.close()
            context_closed_for_retry = True
            if browser:
                browser.close()
            clear_persistent_profile(profile_dir, debug=debug)

            if not next_login_url:
                return LoginResult(
                    False,
                    f"stale_login_state_after_reset:{stage}",
                    stale_url,
                    str(profile_dir) if profile_dir else None,
                )

            emit_debug(debug, f"retry_clean_login_url url={next_login_url}")
            return login_netflix(
                email,
                password,
                login_url=next_login_url,
                headless=headless,
                timeout_ms=timeout_ms,
                slow_mo_ms=slow_mo_ms,
                clear_cache=True,
                persistent_profile=persistent_profile,
                profile_name=profile_name,
                profiles_dir=profiles_dir,
                proxy_server=proxy_server,
                debug=debug,
                allow_manual_login=allow_manual_login,
                manual_login_timeout_ms=manual_login_timeout_ms,
                _stale_reset_count=_stale_reset_count + 1,
            )

        try:
            if clear_cache:
                emit_debug(debug, "clear_browser_context_state")
                context.clear_cookies()
                context.clear_permissions()
                page.goto("about:blank")
                page.evaluate(
                    """async () => {
                        try { localStorage.clear(); } catch (_) {}
                        try { sessionStorage.clear(); } catch (_) {}
                        if ('caches' in window) {
                            const keys = await caches.keys();
                            await Promise.all(keys.map((key) => caches.delete(key)));
                        }
                    }"""
                )

            emit_debug(debug, "goto_login_page")
            page.goto(login_url, wait_until="domcontentloaded")
            wait_for_short_network_idle(page, debug=debug)

            if persistent_profile and is_stale_login_state(page):
                return retry_after_stale_state("initial_login_page")

            if looks_logged_in(context, page):
                emit_debug(debug, "already_logged_in_before_login")
                return LoginResult(True, "login_success_existing_session", page.url, str(profile_dir) if profile_dir else None)

            emit_debug(debug, "fill_email")
            if not fill_input_and_verify(
                page,
                (
                    'input[name="userLoginId"]',
                    'input[type="email"]',
                    'input[name="email"]',
                ),
                email,
                require_interactable=False,
            ):
                emit_debug(debug, "email_input_not_filled")
                return LoginResult(False, "email_input_not_filled", page.url, str(profile_dir) if profile_dir else None)

            emit_debug(debug, "click_continue_after_email")
            if not force_click_first(
                page,
                (
                    '[data-uia="continue-button"]',
                    'button:has-text("Continue")',
                    'button[type="submit"]',
                ),
            ):
                emit_debug(debug, "continue_button_not_found")
                return LoginResult(False, "continue_button_not_found", page.url, str(profile_dir) if profile_dir else None)

            wait_for_short_network_idle(page, debug=debug)

            if persistent_profile and is_stale_login_state(page):
                return retry_after_stale_state("after_email_continue")

            next_step = wait_for_next_login_step(page, timeout_ms)
            emit_debug(debug, f"next_login_step={next_step}")
            if next_step == "error":
                error = has_visible_error(page)
                emit_debug(debug, f"login_error_before_password={error}")
                if persistent_profile and is_stale_login_state(page):
                    return retry_after_stale_state("error_before_password")
                if allow_manual_login and not headless:
                    return _with_profile(
                        wait_for_manual_login(
                            context,
                            page,
                            timeout_ms=manual_login_timeout_ms,
                            debug=debug,
                            reason="error_before_password",
                        ),
                        str(profile_dir) if profile_dir else None,
                    )
                return LoginResult(False, f"login_failed: {error}", page.url, str(profile_dir) if profile_dir else None)
            if next_step == "otp":
                emit_debug(debug, "otp_page_open_use_password_menu")
                if not maybe_click_use_password(page):
                    emit_debug(debug, "use_password_instead_not_found")
                    return LoginResult(False, "use_password_instead_not_found", page.url, str(profile_dir) if profile_dir else None)
            elif next_step == "use_password":
                emit_debug(debug, "click_use_password_instead")
                if not maybe_click_use_password(page):
                    emit_debug(debug, "use_password_instead_not_clicked")
                    return LoginResult(False, "use_password_instead_not_clicked", page.url, str(profile_dir) if profile_dir else None)
            elif next_step == "timeout":
                emit_debug(debug, "next_login_step_timeout")
                if allow_manual_login and not headless:
                    return _with_profile(
                        wait_for_manual_login(
                            context,
                            page,
                            timeout_ms=manual_login_timeout_ms,
                            debug=debug,
                            reason="next_login_step_timeout",
                        ),
                        str(profile_dir) if profile_dir else None,
                    )
                return LoginResult(False, "next_login_step_timeout", page.url, str(profile_dir) if profile_dir else None)

            emit_debug(debug, "wait_for_password_ready")
            if not wait_for_password_ready(page, timeout_ms=7000):
                emit_debug(debug, "password_page_not_ready")
                return LoginResult(False, "password_page_not_ready", page.url, str(profile_dir) if profile_dir else None)

            emit_debug(debug, "ensure_email_still_filled")
            if not ensure_email_still_filled(page, email):
                emit_debug(debug, "email_input_reset_before_password")
                return LoginResult(False, "email_input_reset_before_password", page.url, str(profile_dir) if profile_dir else None)

            emit_debug(debug, "fill_password")
            if not fill_input_and_verify(
                page,
                (
                    'input[name="password"]',
                    'input[type="password"]',
                ),
                password,
                require_interactable=True,
            ):
                emit_debug(debug, "password_input_not_filled")
                return LoginResult(False, "password_input_not_filled", page.url, str(profile_dir) if profile_dir else None)

            if looks_logged_in(context, page):
                emit_debug(debug, "already_logged_in_after_password")
                return LoginResult(True, "login_success", page.url, str(profile_dir) if profile_dir else None)

            emit_debug(debug, "submit_password")
            if not submit_password_form(page):
                if looks_logged_in(context, page):
                    emit_debug(debug, "logged_in_after_submit_button_missing")
                    return LoginResult(True, "login_success", page.url, str(profile_dir) if profile_dir else None)
                emit_debug(debug, "password_submit_not_found")
                return LoginResult(False, "password_submit_not_found", page.url, str(profile_dir) if profile_dir else None)

            wait_for_short_network_idle(page, debug=debug)

            result = wait_for_login_result(context, page, timeout_ms)
            emit_debug(debug, f"login_result success={result.success} reason={result.reason} url={result.url}")
            if not result.success and allow_manual_login and not headless:
                result = wait_for_manual_login(
                    context,
                    page,
                    timeout_ms=manual_login_timeout_ms,
                    debug=debug,
                    reason=result.reason,
                )
            return _with_profile(result, str(profile_dir) if profile_dir else None)
        finally:
            emit_debug(debug, "close_browser")
            if not context_closed_for_retry:
                context.close()
            if browser and not context_closed_for_retry:
                browser.close()
