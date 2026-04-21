"""Filters to hide automatic/noisy emails from the inbox list.

Patterns are matched case-insensitively with SQL ``LIKE``. ``%`` means
"any characters" (like ``*`` in glob). Users can edit this file to add
or remove rules — no code change required elsewhere.

When a message matches any pattern it is hidden from:
- the inbox listing
- the unread counter in the sidebar

The message still exists in the IMAP folder and in the local cache —
just not shown. Passing ``?show_all=1`` in the URL temporarily reveals
everything.
"""

from __future__ import annotations

# LIKE patterns matched against the subject (lowercased).
HIDDEN_SUBJECT_PATTERNS: list[str] = [
    "%dmarc%",
    "report domain:%",
    "dmarc aggregate report%",
    "dmarc failure report%",
    "dmarc forensic report%",
]

# LIKE patterns matched against the sender address (lowercased).
HIDDEN_FROM_PATTERNS: list[str] = [
    "%dmarc%",          # noreply@dmarc.yahoo.com, dmarc-support@...
    "postmaster@%",     # postmaster@amazonses.com, etc.
    "mailer-daemon@%",
    "noreply-dmarc@%",
]


def build_exclusion_clause() -> tuple[str, list[str]]:
    """Return a SQL fragment + params that excludes hidden messages.

    The fragment is suitable for appending to a WHERE clause with ``AND``.
    Example: ``AND NOT (LOWER(subject) LIKE ? OR ... OR LOWER(from_email) LIKE ? OR ...)``.
    """
    conds: list[str] = []
    params: list[str] = []
    for p in HIDDEN_SUBJECT_PATTERNS:
        conds.append("LOWER(subject) LIKE ?")
        params.append(p)
    for p in HIDDEN_FROM_PATTERNS:
        conds.append("LOWER(from_email) LIKE ?")
        params.append(p)
    if not conds:
        return "", []
    return "NOT (" + " OR ".join(conds) + ")", params
