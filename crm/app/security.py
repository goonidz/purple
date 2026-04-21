"""Security helpers: rate-limiting, input sanitization, attachment rules.

Scope: defensive hardening for a single-user self-hosted webmail. We
aim for a reasonable baseline (no brute-force, no header injection,
no obvious tracking leak) not for enterprise-grade AV/sandboxing.
"""

from __future__ import annotations

import re
import threading
import time
import urllib.parse
from collections import defaultdict, deque
from pathlib import PurePosixPath


# --- Attachment extensions we treat as dangerous ------------------------
# Rendered with a big red warning; download requires an extra click with
# ``?confirm=1``. Lowercase, dot-prefixed.
DANGEROUS_EXTENSIONS: set[str] = {
    ".exe", ".scr", ".bat", ".cmd", ".com", ".cpl", ".dll",
    ".vbs", ".vbe", ".js", ".jse", ".wsf", ".wsh", ".ps1",
    ".hta", ".lnk", ".pif", ".reg", ".msi", ".msp",
    ".jar", ".apk", ".app", ".dmg", ".iso", ".img",
    # HTML/SVG can execute scripts in some browsers when opened locally.
    ".html", ".htm", ".svg", ".xhtml",
    # Office with macros.
    ".docm", ".xlsm", ".pptm", ".dotm", ".xltm", ".potm",
}

# Per-file and total upload caps (bytes). Mirror nginx's
# ``client_max_body_size 32M`` so the app rejects oversize uploads even
# if the proxy is misconfigured.
MAX_ATTACHMENT_SIZE = 25 * 1024 * 1024
MAX_TOTAL_UPLOAD = 32 * 1024 * 1024


def attachment_extension(filename: str) -> str:
    name = (filename or "").strip().lower()
    return PurePosixPath(name).suffix


def is_dangerous_attachment(filename: str) -> bool:
    return attachment_extension(filename) in DANGEROUS_EXTENSIONS


# --- Filename sanitization for Content-Disposition ----------------------
# RFC 5987: ``filename*=UTF-8''<pct-encoded>``. We also provide a fallback
# ASCII filename for ancient browsers.
_FILENAME_BAD = re.compile(r'[\r\n"\\/\x00]')


def safe_content_disposition(filename: str) -> str:
    """Return a Content-Disposition value that can't break the header."""
    name = (filename or "file").strip() or "file"
    # Strip anything that could terminate a quoted string or inject a header.
    ascii_name = _FILENAME_BAD.sub("_", name.encode("ascii", "replace").decode("ascii"))
    if not ascii_name:
        ascii_name = "file"
    # RFC 5987 encoded form for unicode names.
    encoded = urllib.parse.quote(name, safe="")
    return f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{encoded}"


# --- Global request rate-limit ------------------------------------------
# Supabase already enforces auth via JWT, but we still rate-limit per
# (user, IP) so a leaked token can't hammer IMAP providers. In-memory
# sliding window is plenty for a single-process uvicorn worker; if we
# scale to multiple workers, swap in Redis or a fail2ban rule on nginx.

_REQUESTS: dict[str, deque[float]] = defaultdict(deque)
_REQ_LOCK = threading.Lock()
_REQ_WINDOW_SECONDS = 60.0
_REQ_MAX_PER_WINDOW = 240  # 4 req/s sustained


def global_rate_limited(key: str) -> bool:
    """Return True when ``key`` should be rejected with HTTP 429.

    ``key`` is typically ``f"{user_id}:{ip}"`` so one user from two IPs
    gets two separate buckets and a bad actor from one IP can't starve
    a legit user from another.
    """
    now = time.time()
    with _REQ_LOCK:
        dq = _REQUESTS[key]
        cutoff = now - _REQ_WINDOW_SECONDS
        while dq and dq[0] < cutoff:
            dq.popleft()
        if len(dq) >= _REQ_MAX_PER_WINDOW:
            return True
        dq.append(now)
        return False


# --- HTML email: strip remote images + remote stylesheets --------------
# We do this to prevent tracking pixels / read receipts from leaking our
# IP and read time back to the sender. The iframe sandbox already blocks
# JS; this covers the passive ``<img>`` case.

_REMOTE_SRC_RE = re.compile(
    r'''(src|background|poster)\s*=\s*(["'])\s*(?:https?:|//)[^"']*\2''',
    re.IGNORECASE,
)
_REMOTE_URL_IN_CSS_RE = re.compile(
    r'''url\(\s*(["']?)\s*(?:https?:|//)[^)"']*\1\s*\)''',
    re.IGNORECASE,
)
_LINK_STYLESHEET_RE = re.compile(
    r'<link\b[^>]*rel\s*=\s*["\']?stylesheet["\']?[^>]*>',
    re.IGNORECASE,
)


def strip_remote_assets(html: str) -> tuple[str, int]:
    """Neutralise remote image/CSS references in an HTML email.

    Returns ``(safe_html, count_blocked)``. ``cid:`` and ``data:`` URIs
    are kept (they're the message itself).
    """
    if not html:
        return html, 0
    count = [0]

    def _sub_attr(m: re.Match) -> str:
        count[0] += 1
        attr = m.group(1)
        return f'{attr}=""'

    def _sub_css(m: re.Match) -> str:
        count[0] += 1
        return "url('')"

    out = _REMOTE_SRC_RE.sub(_sub_attr, html)
    out = _REMOTE_URL_IN_CSS_RE.sub(_sub_css, out)
    out, n = _LINK_STYLESHEET_RE.subn("", out)
    count[0] += n
    return out, count[0]
