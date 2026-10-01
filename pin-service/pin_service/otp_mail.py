"""Read the Netflix verification code ("ยืนยันการเปลี่ยนแปลงข้อมูลในบัญชีโดยใช้รหัสนี้")
from the master account's mailbox over IMAP.

Mailbox login: the master email itself with its Gmail App Password (sent by the
backend per master account), or a shared inbox that receives forwarded mail
(OTP_IMAP_USER / OTP_IMAP_PASSWORD). In the shared inbox, only mail addressed
to the master email counts.
"""

from __future__ import annotations

import email
import imaplib
import os
import re
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from email.header import decode_header, make_header
from email.utils import parsedate_to_datetime

from netflix_login_checker.core import DebugCallback, emit_debug

# The code sits on its own line/cell; SRC ids, links and phone numbers do not.
CODE_LINE_PATTERN = re.compile(r"^\s*(\d{6})\s*$", re.M)
CODE_PATTERN = re.compile(r"(?<!\d)(\d{6})(?!\d)")
# Mail received this long before the "send code" click still counts (clock drift).
EARLY_SLACK = timedelta(seconds=60)


@dataclass(frozen=True)
class MailboxLogin:
    host: str
    user: str
    password: str
    # Set when the inbox is shared: only mail sent to this address is used.
    recipient: str | None


@dataclass(frozen=True)
class OtpCandidate:
    code: str
    received_at: datetime


def mailbox_for(master_email: str, mailbox_password: str | None) -> MailboxLogin | None:
    host = os.environ.get("OTP_IMAP_HOST", "imap.gmail.com")
    if mailbox_password:
        return MailboxLogin(host, master_email, mailbox_password.replace(" ", ""), None)
    user = os.environ.get("OTP_IMAP_USER")
    password = os.environ.get("OTP_IMAP_PASSWORD")
    if user and password:
        recipient = None if user.lower() == master_email.lower() else master_email
        return MailboxLogin(host, user, password.replace(" ", ""), recipient)
    return None


def fetch_otp_candidates(mailbox: MailboxLogin, sent_at: datetime, *, debug: DebugCallback | None = None) -> list[OtpCandidate]:
    """Netflix codes received since `sent_at`, closest to `sent_at` first."""
    since = (sent_at - timedelta(days=1)).strftime("%d-%b-%Y")
    candidates: list[OtpCandidate] = []
    with imaplib.IMAP4_SSL(mailbox.host) as imap:
        imap.login(mailbox.user, mailbox.password)
        imap.select("INBOX", readonly=True)
        status, data = imap.search(None, "FROM", '"netflix"', "SINCE", since)
        if status != "OK":
            return []
        ids = data[0].split()[-20:]
        for message_id in reversed(ids):
            status, parts = imap.fetch(message_id, "(INTERNALDATE RFC822)")
            if status != "OK" or not parts or not isinstance(parts[0], tuple):
                continue
            received_at = _internal_date(parts[0][0]) or sent_at
            if received_at < sent_at - EARLY_SLACK:
                continue
            message = email.message_from_bytes(parts[0][1])
            if mailbox.recipient and not _addressed_to(message, mailbox.recipient):
                continue
            code = _extract_code(message)
            if code:
                candidates.append(OtpCandidate(code, received_at))
    candidates.sort(key=lambda item: abs((item.received_at - sent_at).total_seconds()))
    emit_debug(debug, f"otp_mail_candidates count={len(candidates)}")
    return candidates


def wait_for_otp_candidates(
    mailbox: MailboxLogin,
    sent_at: datetime,
    *,
    timeout_s: float = 120,
    debug: DebugCallback | None = None,
) -> list[OtpCandidate]:
    deadline = time.monotonic() + timeout_s
    while True:
        try:
            candidates = fetch_otp_candidates(mailbox, sent_at, debug=debug)
        except (imaplib.IMAP4.error, OSError) as exc:
            emit_debug(debug, f"otp_mail_error {exc}")
            candidates = []
        if candidates or time.monotonic() >= deadline:
            return candidates
        time.sleep(5)


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _internal_date(fetch_header: bytes) -> datetime | None:
    match = re.search(rb'INTERNALDATE "([^"]+)"', fetch_header)
    if not match:
        return None
    try:
        return parsedate_to_datetime(match.group(1).decode()).astimezone(timezone.utc)
    except (TypeError, ValueError):
        try:
            return datetime.strptime(match.group(1).decode(), "%d-%b-%Y %H:%M:%S %z").astimezone(timezone.utc)
        except ValueError:
            return None


def _addressed_to(message: email.message.Message, recipient: str) -> bool:
    headers = " ".join(str(message.get(name, "")) for name in ("To", "Delivered-To", "X-Original-To", "Cc"))
    return recipient.lower() in headers.lower()


def _extract_code(message: email.message.Message) -> str | None:
    subject = str(make_header(decode_header(message.get("Subject", ""))))
    match = CODE_LINE_PATTERN.search(_message_text(message)) or CODE_PATTERN.search(subject)
    return match.group(1) if match else None


def _message_text(message: email.message.Message) -> str:
    plain: list[str] = []
    html: list[str] = []
    for part in message.walk():
        content_type = part.get_content_type()
        if content_type not in ("text/plain", "text/html"):
            continue
        payload = part.get_payload(decode=True) or b""
        text = payload.decode(part.get_content_charset() or "utf-8", errors="replace")
        (plain if content_type == "text/plain" else html).append(text)
    if plain:
        return "\n".join(plain)
    text = re.sub(r"<(style|script)[^>]*>.*?</\1>", " ", "\n".join(html), flags=re.S | re.I)
    return re.sub(r"<[^>]+>", "\n", text).replace("&nbsp;", " ")
