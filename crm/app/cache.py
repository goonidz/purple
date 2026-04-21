"""SQLite cache of message envelopes — scoped per Supabase user.

Stores one row per message (user_id + account_slug + folder + uid) with
just what the inbox list needs: subject, from, date, flags, short
preview. The full message body, HTML and attachments are always fetched
fresh from IMAP when a specific message is opened — only the envelope is
cached.

The ``user_id`` column is the Supabase ``auth.users.id`` UUID as a
string. Every query filters on it so one user's cache entries are never
visible to another, even if two users happen to share the same account
slug (which shouldn't happen because slugs are derived from per-user
account UUIDs, but we belt-and-suspenders it).
"""

from __future__ import annotations

import json
import sqlite3
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Iterable

from . import filters
from .config import BASE_DIR

DB_PATH: Path = BASE_DIR / "cache.sqlite"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS messages (
    user_id      TEXT NOT NULL,
    account_slug TEXT NOT NULL,
    folder       TEXT NOT NULL,
    uid          INTEGER NOT NULL,
    subject      TEXT,
    from_name    TEXT,
    from_email   TEXT,
    to_json      TEXT,
    date_iso     TEXT,
    date_display TEXT,
    preview      TEXT,
    flags_json   TEXT,
    has_attachments INTEGER,
    PRIMARY KEY (user_id, account_slug, folder, uid)
);
CREATE INDEX IF NOT EXISTS idx_msg_date
    ON messages (user_id, account_slug, folder, date_iso DESC);

CREATE TABLE IF NOT EXISTS folder_state (
    user_id      TEXT NOT NULL,
    account_slug TEXT NOT NULL,
    folder       TEXT NOT NULL,
    uidvalidity  INTEGER NOT NULL,
    max_uid      INTEGER NOT NULL DEFAULT 0,
    last_sync_at TEXT,
    PRIMARY KEY (user_id, account_slug, folder)
);
"""

_lock = threading.Lock()


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(
        str(DB_PATH), check_same_thread=False, isolation_level=None
    )
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    return conn


_db = _connect()


def _migrate() -> None:
    """Idempotent migration: add user_id to pre-existing tables.

    Old installs (before this refactor) stored rows without a user_id.
    We add the column with a sentinel so the app keeps booting; those
    rows will be re-synced on the first call and get the real user_id.
    """
    with _lock:
        _db.executescript(_SCHEMA)
        for table in ("messages", "folder_state"):
            try:
                cols = {
                    r["name"]
                    for r in _db.execute(f"PRAGMA table_info({table})").fetchall()
                }
            except Exception:
                cols = set()
            if cols and "user_id" not in cols:
                try:
                    _db.execute(
                        f"ALTER TABLE {table} ADD COLUMN user_id TEXT NOT NULL DEFAULT ''"
                    )
                except sqlite3.OperationalError:
                    pass


_migrate()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------- folder state ----------


def get_folder_state(
    user_id: str, slug: str, folder: str
) -> tuple[int, int] | None:
    """Return (uidvalidity, max_uid) or None if unknown."""
    row = _db.execute(
        "SELECT uidvalidity, max_uid FROM folder_state "
        "WHERE user_id=? AND account_slug=? AND folder=?",
        (user_id, slug, folder),
    ).fetchone()
    if row is None:
        return None
    return int(row["uidvalidity"]), int(row["max_uid"])


def set_folder_state(
    user_id: str, slug: str, folder: str, uidvalidity: int, max_uid: int
) -> None:
    with _lock:
        _db.execute(
            """INSERT INTO folder_state (user_id, account_slug, folder,
                                          uidvalidity, max_uid, last_sync_at)
               VALUES (?,?,?,?,?,?)
               ON CONFLICT(user_id, account_slug, folder) DO UPDATE SET
                   uidvalidity = excluded.uidvalidity,
                   max_uid     = excluded.max_uid,
                   last_sync_at= excluded.last_sync_at""",
            (user_id, slug, folder, uidvalidity, max_uid, _now_iso()),
        )


def clear_folder(user_id: str, slug: str, folder: str) -> None:
    with _lock:
        _db.execute(
            "DELETE FROM messages "
            "WHERE user_id=? AND account_slug=? AND folder=?",
            (user_id, slug, folder),
        )
        _db.execute(
            "DELETE FROM folder_state "
            "WHERE user_id=? AND account_slug=? AND folder=?",
            (user_id, slug, folder),
        )


# ---------- messages ----------


def get_cached_uids(user_id: str, slug: str, folder: str) -> set[int]:
    rows = _db.execute(
        "SELECT uid FROM messages "
        "WHERE user_id=? AND account_slug=? AND folder=?",
        (user_id, slug, folder),
    ).fetchall()
    return {int(r["uid"]) for r in rows}


def get_max_cached_uid(user_id: str, slug: str, folder: str) -> int:
    row = _db.execute(
        "SELECT COALESCE(MAX(uid), 0) AS m FROM messages "
        "WHERE user_id=? AND account_slug=? AND folder=?",
        (user_id, slug, folder),
    ).fetchone()
    return int(row["m"] or 0)


def upsert_messages(user_id: str, rows: Iterable[dict]) -> None:
    payload = [
        (
            user_id,
            r["account_slug"],
            r["folder"],
            int(r["uid"]),
            r["subject"],
            r["from_name"],
            r["from_email"],
            json.dumps(r.get("to") or []),
            r["date_iso"],
            r["date_display"],
            r["preview"],
            json.dumps(r.get("flags") or []),
            1 if r.get("has_attachments") else 0,
        )
        for r in rows
    ]
    if not payload:
        return
    with _lock:
        _db.executemany(
            """INSERT INTO messages (user_id, account_slug, folder, uid,
                                     subject, from_name, from_email,
                                     to_json, date_iso, date_display,
                                     preview, flags_json, has_attachments)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
               ON CONFLICT(user_id, account_slug, folder, uid) DO UPDATE SET
                   subject        = excluded.subject,
                   from_name      = excluded.from_name,
                   from_email     = excluded.from_email,
                   to_json        = excluded.to_json,
                   date_iso       = excluded.date_iso,
                   date_display   = excluded.date_display,
                   preview        = excluded.preview,
                   flags_json     = excluded.flags_json,
                   has_attachments= excluded.has_attachments""",
            payload,
        )


def delete_uids(
    user_id: str, slug: str, folder: str, uids: Iterable[int]
) -> None:
    data = [(user_id, slug, folder, int(u)) for u in uids]
    if not data:
        return
    with _lock:
        _db.executemany(
            "DELETE FROM messages "
            "WHERE user_id=? AND account_slug=? AND folder=? AND uid=?",
            data,
        )


def update_flags(
    user_id: str, slug: str, folder: str, uid: int, flags: list[str]
) -> None:
    with _lock:
        _db.execute(
            "UPDATE messages SET flags_json=? "
            "WHERE user_id=? AND account_slug=? AND folder=? AND uid=?",
            (json.dumps(flags), user_id, slug, folder, int(uid)),
        )


def list_cached(
    user_id: str,
    slug: str,
    folder: str,
    limit: int,
    offset: int,
    *,
    apply_filter: bool = True,
) -> list[dict]:
    where = "user_id=? AND account_slug=? AND folder=?"
    params: list = [user_id, slug, folder]
    if apply_filter:
        clause, extra = filters.build_exclusion_clause()
        if clause:
            where += f" AND {clause}"
            params.extend(extra)
    params.extend([limit, offset])
    rows = _db.execute(
        f"""SELECT uid, subject, from_name, from_email, to_json,
                  date_iso, date_display, preview, flags_json, has_attachments
           FROM messages
           WHERE {where}
           ORDER BY date_iso DESC, uid DESC
           LIMIT ? OFFSET ?""",
        params,
    ).fetchall()
    result = []
    for r in rows:
        result.append(
            {
                "uid": str(r["uid"]),
                "subject": r["subject"] or "",
                "from_name": r["from_name"] or "",
                "from_email": r["from_email"] or "",
                "to": json.loads(r["to_json"] or "[]"),
                "date_iso": r["date_iso"] or "",
                "date_display": r["date_display"] or "",
                "preview": r["preview"] or "",
                "flags": json.loads(r["flags_json"] or "[]"),
                "has_attachments": bool(r["has_attachments"]),
            }
        )
    return result


def count_cached(
    user_id: str, slug: str, folder: str, *, apply_filter: bool = True
) -> int:
    where = "user_id=? AND account_slug=? AND folder=?"
    params: list = [user_id, slug, folder]
    if apply_filter:
        clause, extra = filters.build_exclusion_clause()
        if clause:
            where += f" AND {clause}"
            params.extend(extra)
    row = _db.execute(
        f"SELECT COUNT(*) AS c FROM messages WHERE {where}",
        params,
    ).fetchone()
    return int(row["c"] or 0)


def count_hidden(user_id: str, slug: str, folder: str) -> int:
    """Count messages that would be hidden by the active filters."""
    clause, params = filters.build_exclusion_clause()
    if not clause:
        return 0
    row = _db.execute(
        f"SELECT COUNT(*) AS c FROM messages "
        f"WHERE user_id=? AND account_slug=? AND folder=? AND NOT ({clause})",
        [user_id, slug, folder, *params],
    ).fetchone()
    return int(row["c"] or 0)


def count_unseen(
    user_id: str,
    slug: str,
    folder: str = "INBOX",
    *,
    apply_filter: bool = True,
) -> int:
    """Count cached messages that don't carry the ``\\Seen`` IMAP flag."""
    where = "user_id=? AND account_slug=? AND folder=?"
    params: list = [user_id, slug, folder]
    if apply_filter:
        clause, extra = filters.build_exclusion_clause()
        if clause:
            where += f" AND {clause}"
            params.extend(extra)
    rows = _db.execute(
        f"SELECT flags_json FROM messages WHERE {where}",
        params,
    ).fetchall()
    total = 0
    for r in rows:
        flags = {
            f.lstrip("\\").lower() for f in (json.loads(r["flags_json"] or "[]"))
        }
        if "seen" not in flags:
            total += 1
    return total


def get_home_stats(
    user_id: str, days: int = 7, folder: str = "INBOX"
) -> dict[str, dict]:
    """Return per-account stats for the home dashboard."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()

    where = "user_id=? AND folder=?"
    params: list = [user_id, folder]
    clause, extra = filters.build_exclusion_clause()
    if clause:
        where += f" AND {clause}"
        params.extend(extra)

    rows = _db.execute(
        f"SELECT account_slug, date_iso, flags_json FROM messages WHERE {where}",
        params,
    ).fetchall()

    stats: dict[str, dict] = {}
    for r in rows:
        slug = r["account_slug"]
        s = stats.setdefault(
            slug,
            {
                "received_week": 0,
                "unread_total": 0,
                "unread_week": 0,
                "answered_week": 0,
                "unanswered_week": 0,
                "total": 0,
            },
        )
        s["total"] += 1
        flags = {
            f.lstrip("\\").lower() for f in json.loads(r["flags_json"] or "[]")
        }
        seen = "seen" in flags
        answered = "answered" in flags
        is_week = (r["date_iso"] or "") >= cutoff
        if not seen:
            s["unread_total"] += 1
            if is_week:
                s["unread_week"] += 1
        if is_week:
            s["received_week"] += 1
            if answered:
                s["answered_week"] += 1
            else:
                s["unanswered_week"] += 1
    return stats


def unseen_counts_by_account(
    user_id: str, folder: str = "INBOX", *, apply_filter: bool = True
) -> dict[str, int]:
    """Return a dict ``{account_slug: unseen_count}`` for the given folder."""
    where = "user_id=? AND folder=?"
    params: list = [user_id, folder]
    if apply_filter:
        clause, extra = filters.build_exclusion_clause()
        if clause:
            where += f" AND {clause}"
            params.extend(extra)
    rows = _db.execute(
        f"SELECT account_slug, flags_json FROM messages WHERE {where}",
        params,
    ).fetchall()
    out: dict[str, int] = {}
    for r in rows:
        flags = {
            f.lstrip("\\").lower() for f in (json.loads(r["flags_json"] or "[]"))
        }
        if "seen" not in flags:
            out[r["account_slug"]] = out.get(r["account_slug"], 0) + 1
    return out
