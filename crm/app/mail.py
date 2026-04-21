from __future__ import annotations

import smtplib
import ssl
import threading
import time
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime, timezone
from email.message import EmailMessage
from email.utils import formataddr, make_msgid
from typing import Iterator

from imap_tools import AND, MailBox, MailMessage

from . import cache
from .config import Account


_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)

# --------------------------------------------------------------------- helpers


def _sort_key(dt: datetime | None) -> datetime:
    if dt is None:
        return _EPOCH
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _fmt_date(msg: MailMessage) -> tuple[str, str]:
    if msg.date is None:
        return "", ""
    dt = _sort_key(msg.date)
    iso = dt.isoformat()
    display = dt.astimezone().strftime("%d %b %Y %H:%M")
    return iso, display


# ------------------------------------------------------------- data classes


@dataclass
class MessageSummary:
    uid: str
    subject: str
    from_name: str
    from_email: str
    to: list[str]
    date_iso: str
    date_display: str
    flags: list[str]
    has_attachments: bool
    preview: str
    account_slug: str
    folder: str

    @property
    def is_unseen(self) -> bool:
        normalized = {f.lstrip("\\").lower() for f in (self.flags or [])}
        return "seen" not in normalized


@dataclass
class AttachmentInfo:
    filename: str
    content_type: str
    size: int
    payload: bytes = field(repr=False, default=b"")


@dataclass
class FullMessage:
    uid: str
    subject: str
    from_name: str
    from_email: str
    to: list[str]
    cc: list[str]
    date_iso: str
    date_display: str
    text: str
    html: str
    attachments: list[AttachmentInfo]
    message_id: str
    in_reply_to: str
    references: str
    account_slug: str
    folder: str


@dataclass
class OutgoingAttachment:
    filename: str
    content_type: str
    payload: bytes


# -------------------------------------------------------- connection pool
#
# One persistent IMAP connection per (user_id, account_slug) so users
# never share a live IMAP session. A per-key lock serialises access.

PoolKey = tuple[str, str]  # (user_id, account_slug)

_pool: dict[PoolKey, MailBox] = {}
_locks: dict[PoolKey, threading.Lock] = {}
_pool_lock = threading.Lock()

_current_folder: dict[PoolKey, str] = {}
_last_used: dict[PoolKey, float] = {}

_INITIAL_SYNC_LIMIT = 200
_NOOP_SKIP_SECONDS = 30.0


def _key(account: Account) -> PoolKey:
    return (account.user_id, account.slug)


def _get_lock(key: PoolKey) -> threading.Lock:
    with _pool_lock:
        lock = _locks.get(key)
        if lock is None:
            lock = threading.Lock()
            _locks[key] = lock
        return lock


def _is_alive(box: MailBox) -> bool:
    try:
        box.noop()
        return True
    except Exception:
        return False


def _drop(key: PoolKey) -> None:
    box = _pool.pop(key, None)
    _current_folder.pop(key, None)
    _last_used.pop(key, None)
    if box is not None:
        try:
            box.logout()
        except Exception:
            pass


@contextmanager
def _use(account: Account) -> Iterator[MailBox]:
    """Yield a logged-in MailBox for this (user_id, account)."""
    key = _key(account)
    lock = _get_lock(key)
    lock.acquire()
    try:
        box = _pool.get(key)
        now = time.time()
        if box is not None:
            recent = now - _last_used.get(key, 0) < _NOOP_SKIP_SECONDS
            if not recent and not _is_alive(box):
                _drop(key)
                box = None
        if box is None:
            box = MailBox(account.imap_host, port=account.imap_port)
            box.login(account.email, account.password)
            _pool[key] = box
            _current_folder.pop(key, None)
        try:
            yield box
            _last_used[key] = time.time()
        except Exception:
            _drop(key)
            raise
    finally:
        lock.release()


def _select(box: MailBox, account: Account, folder: str) -> None:
    key = _key(account)
    if _current_folder.get(key) != folder:
        box.folder.set(folder)
        _current_folder[key] = folder


# --------------------------------------------------------------- folders

_folders_cache: dict[PoolKey, tuple[float, list[str]]] = {}
_FOLDERS_TTL = 600.0


def list_folders(account: Account) -> list[str]:
    key = _key(account)
    cached = _folders_cache.get(key)
    now = time.time()
    if cached and now - cached[0] < _FOLDERS_TTL:
        return cached[1]
    with _use(account) as box:
        names = [f.name for f in box.folder.list()]
    _folders_cache[key] = (now, names)
    return names


# ------------------------------------------------------- sync + listing


def _folder_status(box: MailBox, folder: str) -> tuple[int, int, int]:
    try:
        s = box.folder.status(folder, ["UIDVALIDITY", "UIDNEXT", "MESSAGES"])
        return (
            int(s.get("UIDVALIDITY", 0)),
            int(s.get("UIDNEXT", 0)),
            int(s.get("MESSAGES", 0)),
        )
    except Exception:
        return (0, 0, 0)


def _fetch_new_envelopes(
    box: MailBox, account: Account, folder: str, uids: list[int]
) -> None:
    if not uids:
        return
    BATCH = 100
    for i in range(0, len(uids), BATCH):
        chunk = uids[i : i + BATCH]
        uid_str = ",".join(str(u) for u in chunk)
        rows: list[dict] = []
        for msg in box.fetch(
            AND(uid=uid_str), mark_seen=False, bulk=True, headers_only=True
        ):
            iso, display = _fmt_date(msg)
            rows.append(
                {
                    "account_slug": account.slug,
                    "folder": folder,
                    "uid": int(msg.uid) if msg.uid else 0,
                    "subject": msg.subject or "(sans objet)",
                    "from_name": msg.from_values.name if msg.from_values else "",
                    "from_email": msg.from_values.email
                    if msg.from_values
                    else (msg.from_ or ""),
                    "to": list(msg.to or []),
                    "date_iso": iso,
                    "date_display": display,
                    "preview": "",
                    "flags": list(msg.flags or []),
                    "has_attachments": False,
                }
            )
        cache.upsert_messages(account.user_id, rows)


def sync_folder(
    account: Account, folder: str = "INBOX", *, full: bool = False
) -> None:
    with _use(account) as box:
        uidvalidity, uidnext, _msg_count = _folder_status(box, folder)
        prev_state = cache.get_folder_state(account.user_id, account.slug, folder)

        if prev_state is not None and uidvalidity and prev_state[0] != uidvalidity:
            cache.clear_folder(account.user_id, account.slug, folder)
            prev_state = None

        if (
            not full
            and prev_state is not None
            and uidnext
            and uidnext == prev_state[1] + 1
            and prev_state[1] > 0
        ):
            return

        _select(box, account, folder)

        if full:
            server_uids_str = box.uids()
            server_uids = {int(u) for u in server_uids_str}

            cached_uids = cache.get_cached_uids(
                account.user_id, account.slug, folder
            )
            gone = cached_uids - server_uids
            if gone:
                cache.delete_uids(account.user_id, account.slug, folder, gone)

            new_uids = sorted(server_uids - cached_uids, reverse=True)
        elif prev_state is None:
            server_uids_str = box.uids()
            server_uids = {int(u) for u in server_uids_str}
            new_uids = sorted(server_uids, reverse=True)[:_INITIAL_SYNC_LIMIT]
        else:
            start = prev_state[1] + 1
            criteria = f"UID {start}:*"
            try:
                server_uids_str = box.uids(criteria)
            except Exception:
                server_uids_str = []
            new_uids = sorted({int(u) for u in server_uids_str}, reverse=True)

        _fetch_new_envelopes(box, account, folder, new_uids)

        if full:
            remaining = cache.get_cached_uids(
                account.user_id, account.slug, folder
            )
            recent = sorted(remaining, reverse=True)[:200]
            _refresh_flags(box, account, folder, recent)

        new_max = cache.get_max_cached_uid(
            account.user_id, account.slug, folder
        )
        effective_uidnext = max(uidnext - 1 if uidnext else 0, new_max)
        cache.set_folder_state(
            account.user_id, account.slug, folder, uidvalidity, effective_uidnext
        )


def _refresh_flags(
    box: MailBox, account: Account, folder: str, uids: list[int]
) -> None:
    if not uids:
        return
    BATCH = 200
    for i in range(0, len(uids), BATCH):
        chunk = uids[i : i + BATCH]
        uid_str = ",".join(str(u) for u in chunk)
        for msg in box.fetch(
            AND(uid=uid_str), mark_seen=False, bulk=True, headers_only=True
        ):
            try:
                cache.update_flags(
                    account.user_id,
                    account.slug,
                    folder,
                    int(msg.uid),
                    list(msg.flags or []),
                )
            except Exception:
                pass


def list_messages(
    account: Account,
    folder: str = "INBOX",
    limit: int = 50,
    offset: int = 0,
    *,
    resync: bool = False,
    apply_filter: bool = True,
) -> list[MessageSummary]:
    """Return messages for display. Syncs with the IMAP server first."""
    try:
        sync_folder(account, folder, full=resync)
    except Exception:
        if (
            cache.count_cached(
                account.user_id, account.slug, folder, apply_filter=False
            )
            == 0
        ):
            raise
    rows = cache.list_cached(
        account.user_id,
        account.slug,
        folder,
        limit=limit,
        offset=offset,
        apply_filter=apply_filter,
    )
    return [
        MessageSummary(
            uid=r["uid"],
            subject=r["subject"],
            from_name=r["from_name"],
            from_email=r["from_email"],
            to=r["to"],
            date_iso=r["date_iso"],
            date_display=r["date_display"],
            flags=r["flags"],
            has_attachments=r["has_attachments"],
            preview=r["preview"],
            account_slug=account.slug,
            folder=folder,
        )
        for r in rows
    ]


def count_messages(account: Account, folder: str = "INBOX") -> int:
    return cache.count_cached(account.user_id, account.slug, folder)


# --------------------------------------------------------- single message


def fetch_message(
    account: Account, folder: str, uid: str, mark_seen: bool = True
) -> FullMessage | None:
    with _use(account) as box:
        _select(box, account, folder)
        for msg in box.fetch(AND(uid=uid), mark_seen=mark_seen, limit=1):
            iso, display = _fmt_date(msg)
            attachments = [
                AttachmentInfo(
                    filename=a.filename or "attachment",
                    content_type=a.content_type or "application/octet-stream",
                    size=len(a.payload or b""),
                    payload=a.payload or b"",
                )
                for a in msg.attachments
                if a.filename
            ]
            if mark_seen:
                flags = list(msg.flags or [])
                if "\\Seen" not in flags and "Seen" not in flags:
                    flags.append("\\Seen")
                try:
                    cache.update_flags(
                        account.user_id, account.slug, folder, int(uid), flags
                    )
                except Exception:
                    pass
            return FullMessage(
                uid=str(msg.uid),
                subject=msg.subject or "(sans objet)",
                from_name=msg.from_values.name if msg.from_values else "",
                from_email=msg.from_values.email
                if msg.from_values
                else (msg.from_ or ""),
                to=list(msg.to or []),
                cc=list(msg.cc or []),
                date_iso=iso,
                date_display=display,
                text=msg.text or "",
                html=msg.html or "",
                attachments=attachments,
                message_id=msg.headers.get("message-id", ("",))[0]
                if msg.headers
                else "",
                in_reply_to=msg.headers.get("in-reply-to", ("",))[0]
                if msg.headers
                else "",
                references=msg.headers.get("references", ("",))[0]
                if msg.headers
                else "",
                account_slug=account.slug,
                folder=folder,
            )
    return None


def mark_flag(
    account: Account, folder: str, uid: str, flag: str, value: bool
) -> None:
    with _use(account) as box:
        _select(box, account, folder)
        box.flag(uid, flag, value)
    try:
        existing = {
            int(r["uid"]): r
            for r in cache.list_cached(
                account.user_id, account.slug, folder, limit=100000, offset=0
            )
        }
        row = existing.get(int(uid))
        if row:
            flags = set(row["flags"])
            if value:
                flags.add(flag)
            else:
                flags.discard(flag)
            cache.update_flags(
                account.user_id,
                account.slug,
                folder,
                int(uid),
                sorted(flags),
            )
    except Exception:
        pass


def delete_message(account: Account, folder: str, uid: str) -> None:
    with _use(account) as box:
        _select(box, account, folder)
        box.delete(uid)
    try:
        cache.delete_uids(
            account.user_id, account.slug, folder, [int(uid)]
        )
    except Exception:
        pass


# ----------------------------------------------------------------- send


def send_message(
    account: Account,
    to: list[str],
    subject: str,
    body_text: str,
    body_html: str | None = None,
    cc: list[str] | None = None,
    bcc: list[str] | None = None,
    in_reply_to: str | None = None,
    references: str | None = None,
    attachments: list[OutgoingAttachment] | None = None,
) -> str:
    msg = EmailMessage()
    msg["From"] = formataddr((account.display_name, account.email))
    msg["To"] = ", ".join(to)
    if cc:
        msg["Cc"] = ", ".join(cc)
    msg["Subject"] = subject
    msg["Message-ID"] = make_msgid(domain=account.email.split("@")[-1])
    if in_reply_to:
        msg["In-Reply-To"] = in_reply_to
    if references:
        msg["References"] = references

    msg.set_content(body_text or "")
    if body_html:
        msg.add_alternative(body_html, subtype="html")

    for att in attachments or []:
        maintype, _, subtype = att.content_type.partition("/")
        if not maintype:
            maintype, subtype = "application", "octet-stream"
        msg.add_attachment(
            att.payload,
            maintype=maintype,
            subtype=subtype or "octet-stream",
            filename=att.filename,
        )

    all_rcpt = list(to) + list(cc or []) + list(bcc or [])

    ctx = ssl.create_default_context()
    if account.smtp_ssl:
        with smtplib.SMTP_SSL(account.smtp_host, account.smtp_port, context=ctx) as smtp:
            smtp.login(account.email, account.password)
            smtp.send_message(msg, from_addr=account.email, to_addrs=all_rcpt)
    else:
        with smtplib.SMTP(account.smtp_host, account.smtp_port) as smtp:
            smtp.starttls(context=ctx)
            smtp.login(account.email, account.password)
            smtp.send_message(msg, from_addr=account.email, to_addrs=all_rcpt)

    append_to_sent(account, msg)
    return msg["Message-ID"]


def append_to_sent(account: Account, msg: EmailMessage) -> None:
    """Save a copy of the sent message in the Sent folder via IMAP APPEND."""
    sent_folder_candidates = ["Sent", "INBOX.Sent", "Sent Items", "Sent Messages"]
    raw = msg.as_bytes()
    with _use(account) as box:
        folders = {f.name for f in box.folder.list()}
        target = next((c for c in sent_folder_candidates if c in folders), None)
        if target:
            try:
                box.append(raw, target, flag_set=("\\Seen",))
            except Exception:
                pass


# ----------------------------------------------------------- probe helper


def test_account(account: Account) -> None:
    """Try to log in to IMAP and SMTP once without persisting anything.

    Raises on failure with an explanatory message. Used by the
    ``/api/test-account`` endpoint when the user clicks "Tester la
    connexion" in their profile.
    """
    # IMAP probe.
    try:
        box = MailBox(account.imap_host, port=account.imap_port)
        box.login(account.email, account.password)
        try:
            box.folder.list()
        finally:
            try:
                box.logout()
            except Exception:
                pass
    except Exception as e:
        raise RuntimeError(f"IMAP login échoué ({account.imap_host}) : {e}") from e

    # SMTP probe: auth only, no message sent.
    ctx = ssl.create_default_context()
    try:
        if account.smtp_ssl:
            with smtplib.SMTP_SSL(
                account.smtp_host, account.smtp_port, context=ctx, timeout=15
            ) as smtp:
                smtp.login(account.email, account.password)
        else:
            with smtplib.SMTP(
                account.smtp_host, account.smtp_port, timeout=15
            ) as smtp:
                smtp.starttls(context=ctx)
                smtp.login(account.email, account.password)
    except Exception as e:
        raise RuntimeError(f"SMTP login échoué ({account.smtp_host}) : {e}") from e
