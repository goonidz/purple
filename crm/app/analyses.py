"""Classification analyses — cache + daily pass orchestration.

Persists the result of ``ai.classify_email`` per ``(user, account,
folder, uid)`` so we only bill Gemini once per email. Never re-analyses
a message that already has a row, and never analyses messages older
than 7 days (see ``MAX_AGE_DAYS``).
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Iterable

from . import ai, cache
from .config import Account

log = logging.getLogger("crm.analyses")

MAX_AGE_DAYS = 7
PASS_COOLDOWN_HOURS = 24
AUTO_PASS_LIMIT = 100  # per-user per-day
MANUAL_PASS_LIMIT = 50  # per /analyze-pending call

# Guard: only one daily pass in-flight per user.
_pass_in_flight: set[str] = set()
_pass_guard = asyncio.Lock()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ----------------------------------------------------------- read APIs


def get_analysis(
    user_id: str, slug: str, folder: str, uid: int
) -> dict | None:
    row = cache._db.execute(
        "SELECT priority, category, reason, analyzed_at "
        "FROM email_analyses "
        "WHERE user_id=? AND account_slug=? AND folder=? AND uid=?",
        (user_id, slug, folder, int(uid)),
    ).fetchone()
    if row is None:
        return None
    return {
        "priority": row["priority"],
        "category": row["category"],
        "reason": row["reason"] or "",
        "analyzed_at": row["analyzed_at"],
    }


def list_analyses_for_uids(
    user_id: str, slug: str, folder: str, uids: Iterable[int]
) -> dict[int, dict]:
    uid_list = [int(u) for u in uids]
    if not uid_list:
        return {}
    placeholders = ",".join("?" for _ in uid_list)
    rows = cache._db.execute(
        f"SELECT uid, priority, category, reason FROM email_analyses "
        f"WHERE user_id=? AND account_slug=? AND folder=? "
        f"AND uid IN ({placeholders})",
        [user_id, slug, folder, *uid_list],
    ).fetchall()
    return {
        int(r["uid"]): {
            "priority": r["priority"],
            "category": r["category"],
            "reason": r["reason"] or "",
        }
        for r in rows
    }


# ---------------------------------------------------------- write APIs


def save_analysis(
    user_id: str,
    slug: str,
    folder: str,
    uid: int,
    priority: str,
    category: str,
    reason: str,
) -> None:
    with cache._lock:
        cache._db.execute(
            """INSERT OR IGNORE INTO email_analyses
                 (user_id, account_slug, folder, uid,
                  priority, category, reason, analyzed_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                user_id,
                slug,
                folder,
                int(uid),
                priority,
                category,
                reason,
                _now_iso(),
            ),
        )


def pending_uids(
    user_id: str,
    slug: str,
    folder: str,
    *,
    max_age_days: int = MAX_AGE_DAYS,
    limit: int,
) -> list[int]:
    """Return message UIDs that need to be classified.

    A UID is pending iff:
      - it exists in ``messages`` (already synced),
      - ``date_iso >= now - max_age_days``,
      - no matching row exists in ``email_analyses``.
    """
    cutoff = (
        datetime.now(timezone.utc) - timedelta(days=max_age_days)
    ).isoformat()
    rows = cache._db.execute(
        """SELECT m.uid
             FROM messages m
             LEFT JOIN email_analyses a
               ON a.user_id = m.user_id
              AND a.account_slug = m.account_slug
              AND a.folder = m.folder
              AND a.uid = m.uid
            WHERE m.user_id = ?
              AND m.account_slug = ?
              AND m.folder = ?
              AND m.date_iso >= ?
              AND a.uid IS NULL
            ORDER BY m.date_iso DESC
            LIMIT ?""",
        (user_id, slug, folder, cutoff, int(limit)),
    ).fetchall()
    return [int(r["uid"]) for r in rows]


def priority_stats(
    user_id: str, *, days: int = 7, folder: str = "INBOX"
) -> dict[str, int]:
    """Return ``{priority: count}`` for messages analysed in the last N days.

    Counts are based on the message's own ``date_iso`` (not the
    analysis time), so this is "priorité des mails reçus dans les 7j".
    """
    cutoff = (
        datetime.now(timezone.utc) - timedelta(days=days)
    ).isoformat()
    rows = cache._db.execute(
        """SELECT a.priority, COUNT(*) AS c
             FROM email_analyses a
             JOIN messages m
               ON a.user_id = m.user_id
              AND a.account_slug = m.account_slug
              AND a.folder = m.folder
              AND a.uid = m.uid
            WHERE a.user_id = ?
              AND a.folder = ?
              AND m.date_iso >= ?
            GROUP BY a.priority""",
        (user_id, folder, cutoff),
    ).fetchall()
    out = {"urgent": 0, "a_lire": 0, "spam": 0, "auto": 0}
    for r in rows:
        out[r["priority"]] = int(r["c"])
    return out


def category_stats(
    user_id: str, *, days: int = 7, folder: str = "INBOX"
) -> dict[str, int]:
    cutoff = (
        datetime.now(timezone.utc) - timedelta(days=days)
    ).isoformat()
    rows = cache._db.execute(
        """SELECT a.category, COUNT(*) AS c
             FROM email_analyses a
             JOIN messages m
               ON a.user_id = m.user_id
              AND a.account_slug = m.account_slug
              AND a.folder = m.folder
              AND a.uid = m.uid
            WHERE a.user_id = ?
              AND a.folder = ?
              AND m.date_iso >= ?
            GROUP BY a.category""",
        (user_id, folder, cutoff),
    ).fetchall()
    out = {"client": 0, "facture": 0, "support": 0, "perso": 0}
    for r in rows:
        out[r["category"]] = int(r["c"])
    return out


def top_urgent_messages(
    user_id: str,
    *,
    days: int = 7,
    folder: str = "INBOX",
    limit: int = 8,
) -> list[dict]:
    """Return urgent/à-lire messages from the last N days, unseen first.

    Each row carries the fields needed to render a clickable list on
    the home dashboard.
    """
    cutoff = (
        datetime.now(timezone.utc) - timedelta(days=days)
    ).isoformat()
    rows = cache._db.execute(
        """SELECT m.account_slug, m.folder, m.uid, m.subject,
                  m.from_name, m.from_email, m.date_display, m.date_iso,
                  m.flags_json, a.priority, a.category, a.reason
             FROM email_analyses a
             JOIN messages m
               ON a.user_id = m.user_id
              AND a.account_slug = m.account_slug
              AND a.folder = m.folder
              AND a.uid = m.uid
            WHERE a.user_id = ?
              AND a.folder = ?
              AND m.date_iso >= ?
              AND a.priority IN ('urgent', 'a_lire')
            ORDER BY
              CASE a.priority WHEN 'urgent' THEN 0 ELSE 1 END,
              m.date_iso DESC
            LIMIT ?""",
        (user_id, folder, cutoff, int(limit)),
    ).fetchall()
    import json as _json

    out = []
    for r in rows:
        flags = {
            f.lstrip("\\").lower()
            for f in _json.loads(r["flags_json"] or "[]")
        }
        out.append(
            {
                "account_slug": r["account_slug"],
                "folder": r["folder"],
                "uid": int(r["uid"]),
                "subject": r["subject"] or "(sans objet)",
                "from_name": r["from_name"] or "",
                "from_email": r["from_email"] or "",
                "date_display": r["date_display"] or "",
                "date_iso": r["date_iso"] or "",
                "priority": r["priority"],
                "category": r["category"],
                "reason": r["reason"] or "",
                "is_unseen": "seen" not in flags,
            }
        )
    return out


def _get_summary_row(
    user_id: str, slug: str, folder: str, uid: int
) -> dict | None:
    row = cache._db.execute(
        """SELECT subject, from_name, from_email, preview
             FROM messages
            WHERE user_id=? AND account_slug=? AND folder=? AND uid=?""",
        (user_id, slug, folder, int(uid)),
    ).fetchone()
    if row is None:
        return None
    return dict(row)


# ----------------------------------------------------------- pass state


def needs_daily_pass(user_id: str) -> bool:
    row = cache._db.execute(
        "SELECT last_pass_finished_at FROM email_analysis_state WHERE user_id=?",
        (user_id,),
    ).fetchone()
    if row is None or not row["last_pass_finished_at"]:
        return True
    try:
        last = datetime.fromisoformat(row["last_pass_finished_at"])
    except ValueError:
        return True
    if last.tzinfo is None:
        last = last.replace(tzinfo=timezone.utc)
    return (
        datetime.now(timezone.utc) - last
    ) >= timedelta(hours=PASS_COOLDOWN_HOURS)


def mark_pass_started(user_id: str) -> None:
    with cache._lock:
        cache._db.execute(
            """INSERT INTO email_analysis_state
                 (user_id, last_pass_started_at, last_pass_finished_at)
               VALUES (?, ?, NULL)
               ON CONFLICT(user_id) DO UPDATE SET
                 last_pass_started_at = excluded.last_pass_started_at""",
            (user_id, _now_iso()),
        )


def mark_pass_finished(user_id: str) -> None:
    with cache._lock:
        cache._db.execute(
            """INSERT INTO email_analysis_state
                 (user_id, last_pass_started_at, last_pass_finished_at)
               VALUES (?, ?, ?)
               ON CONFLICT(user_id) DO UPDATE SET
                 last_pass_finished_at = excluded.last_pass_finished_at""",
            (user_id, _now_iso(), _now_iso()),
        )


# ----------------------------------------------------------- the pass


async def _classify_one(
    api_key: str,
    user_id: str,
    slug: str,
    folder: str,
    uid: int,
    summary: dict,
) -> bool:
    """Classify a single message. Returns True on success."""
    try:
        result = await ai.classify_email(
            api_key,
            subject=summary.get("subject") or "",
            from_email=summary.get("from_email") or "",
            from_name=summary.get("from_name") or "",
            preview=summary.get("preview") or summary.get("subject") or "",
        )
    except Exception as e:
        log.info(
            "classify_email failed user=%s slug=%s uid=%s err=%s",
            user_id, slug, uid, e,
        )
        return False

    try:
        save_analysis(
            user_id,
            slug,
            folder,
            uid,
            result["priority"],
            result["category"],
            result.get("reason", ""),
        )
    except Exception as e:
        log.warning("save_analysis failed uid=%s err=%s", uid, e)
        return False
    return True


async def classify_account(
    api_key: str,
    user_id: str,
    account: Account,
    folder: str,
    *,
    limit: int,
) -> tuple[int, int]:
    """Classify pending messages for one account+folder.

    Returns ``(analyzed, skipped)``.
    """
    uids = pending_uids(
        user_id, account.slug, folder, limit=limit
    )
    if not uids:
        return 0, 0

    analyzed = 0
    skipped = 0
    summaries: dict[int, dict] = {}
    for uid in uids:
        s = _get_summary_row(user_id, account.slug, folder, uid)
        if s is None:
            skipped += 1
            continue
        summaries[uid] = s

    tasks = [
        _classify_one(api_key, user_id, account.slug, folder, uid, s)
        for uid, s in summaries.items()
    ]
    results = await asyncio.gather(*tasks, return_exceptions=False)
    for ok in results:
        if ok:
            analyzed += 1
        else:
            skipped += 1
    return analyzed, skipped


async def run_classification_pass(
    user_id: str,
    accounts: list[Account],
    *,
    manual: bool = False,
    slug_filter: str | None = None,
) -> dict:
    """Run the full pass for a given user.

    ``manual=True`` ignores the 24h cooldown, caps at ``MANUAL_PASS_LIMIT``
    per account, and is only scoped to ``slug_filter`` if provided.
    ``manual=False`` uses ``AUTO_PASS_LIMIT`` and updates the cooldown
    timestamp.
    """
    async with _pass_guard:
        if user_id in _pass_in_flight:
            return {"analyzed": 0, "skipped": 0, "already_running": True}
        _pass_in_flight.add(user_id)

    try:
        if not manual:
            mark_pass_started(user_id)

        api_key = await ai.fetch_user_gemini_key(user_id)
        if not api_key:
            log.info("no gemini key for user=%s, skipping pass", user_id)
            if not manual:
                mark_pass_finished(user_id)
            return {
                "analyzed": 0,
                "skipped": 0,
                "error": "no_gemini_key",
            }

        per_account_limit = MANUAL_PASS_LIMIT if manual else AUTO_PASS_LIMIT

        total_analyzed = 0
        total_skipped = 0
        for account in accounts:
            if slug_filter and account.slug != slug_filter:
                continue
            try:
                a, s = await classify_account(
                    api_key,
                    user_id,
                    account,
                    "INBOX",
                    limit=per_account_limit,
                )
                total_analyzed += a
                total_skipped += s
            except Exception as e:
                log.warning(
                    "classify_account crashed user=%s slug=%s err=%s",
                    user_id, account.slug, e,
                )

        if not manual:
            mark_pass_finished(user_id)

        return {
            "analyzed": total_analyzed,
            "skipped": total_skipped,
        }
    finally:
        _pass_in_flight.discard(user_id)
