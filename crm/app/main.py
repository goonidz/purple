from __future__ import annotations

import asyncio
import io
import logging
from pathlib import Path
from typing import Annotated

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from . import ai, analyses, auth, cache, mail, security
from .config import Account, ROOT_PATH, load_accounts_for_user
from .mail import OutgoingAttachment

log = logging.getLogger("crm.main")

BASE_DIR = Path(__file__).resolve().parent

app = FastAPI(
    title="VideoFlow CRM",
    docs_url=None,
    redoc_url=None,
    root_path=ROOT_PATH,
)
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")
templates = Jinja2Templates(directory=BASE_DIR / "templates")


# Captured at startup so sync routes (running in the threadpool) can
# still schedule background coroutines onto the main event loop.
_main_loop: asyncio.AbstractEventLoop | None = None


@app.on_event("startup")
async def _capture_main_loop() -> None:
    global _main_loop
    _main_loop = asyncio.get_running_loop()


# --------------------------------------------------------------- helpers


def _user_id(request: Request) -> str:
    uid = auth.get_user_id(request)
    if not uid:
        raise HTTPException(status_code=401, detail="not authenticated")
    return uid


def get_accounts(user_id: str) -> list[Account]:
    try:
        return load_accounts_for_user(user_id)
    except Exception:
        return []


def find_account(slug: str, accounts: list[Account]) -> Account:
    for a in accounts:
        if a.slug == slug:
            return a
    raise HTTPException(status_code=404, detail="Compte inconnu")


_SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "geolocation=(), microphone=(), camera=()",
    # CSP: inline styles allowed (our templates) + data: for the iframe
    # srcdoc mechanism. Script sources are limited to our own origin
    # and the iframe rendering email HTML has sandbox="" so any <script>
    # in the email body is inert.
    "Content-Security-Policy": (
        "default-src 'self'; "
        "img-src 'self' data:; "
        "style-src 'self' 'unsafe-inline'; "
        "script-src 'self'; "
        "frame-src 'self' data:; "
        "frame-ancestors 'none'; "
        "base-uri 'none'; "
        "form-action 'self'"
    ),
}


def _is_https(request: Request) -> bool:
    if request.url.scheme == "https":
        return True
    # Trust X-Forwarded-Proto from the reverse proxy (nginx).
    xfp = request.headers.get("x-forwarded-proto", "")
    return xfp.lower() == "https"


# ------------------------------------------------------- middlewares


@app.middleware("http")
async def security_middleware(request: Request, call_next):
    path = request.url.path

    # /static is public; everything else requires a valid Supabase JWT.
    public = path.startswith("/static")
    if not public:
        uid = auth.get_user_id(request)
        if not uid:
            # Redirect browser requests back to the VideoFlow auth page.
            accept = request.headers.get("accept", "")
            if "text/html" in accept:
                return RedirectResponse("/auth", status_code=303)
            return JSONResponse(
                {"error": "not authenticated"}, status_code=401
            )
        # Global rate-limit per (user, IP) to make credential abuse hurt
        # even if someone stole a valid token.
        ip = _client_ip(request)
        if security.global_rate_limited(f"{uid}:{ip}"):
            return JSONResponse(
                {"error": "rate limited"}, status_code=429
            )

    response: Response = await call_next(request)
    for k, v in _SECURITY_HEADERS.items():
        response.headers.setdefault(k, v)
    if _is_https(request):
        response.headers.setdefault(
            "Strict-Transport-Security",
            "max-age=31536000; includeSubDomains",
        )
    return response


def _maybe_trigger_daily_pass(user_id: str, accounts: list[Account]) -> None:
    """Fire-and-forget the daily classification pass if cooldown expired.

    Runs in the background — the HTTP response never waits for it. If
    the user has no Gemini key, the pass is a cheap no-op.
    """
    if not accounts:
        return
    try:
        if not analyses.needs_daily_pass(user_id):
            return
    except Exception:
        return
    loop = _main_loop
    if loop is None:
        return
    try:
        asyncio.run_coroutine_threadsafe(
            _safe_run_pass(user_id, accounts, manual=False),
            loop,
        )
    except Exception as e:
        log.warning("failed to schedule daily pass user=%s err=%s", user_id, e)


async def _safe_run_pass(
    user_id: str, accounts: list[Account], *, manual: bool,
    slug_filter: str | None = None,
) -> dict | None:
    try:
        return await analyses.run_classification_pass(
            user_id, accounts, manual=manual, slug_filter=slug_filter
        )
    except Exception as e:
        log.warning(
            "classification_pass crashed user=%s manual=%s err=%s",
            user_id, manual, e,
        )
        return None


def _client_ip(request: Request) -> str:
    xff = request.headers.get("x-forwarded-for", "")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


# ---------------------------------------------------------------- routes


@app.get("/health")
def health():
    return {"ok": True}


@app.get("/", response_class=HTMLResponse)
def index(request: Request):
    user_id = _user_id(request)
    accounts = get_accounts(user_id)
    if not accounts:
        return templates.TemplateResponse(
            "empty.html", {"request": request, "accounts": []}
        )
    # Sync INBOX for each account; swallow per-account failures.
    for a in accounts:
        try:
            mail.sync_folder(a, "INBOX")
        except Exception:
            pass

    _maybe_trigger_daily_pass(user_id, accounts)

    stats = cache.get_home_stats(user_id, days=7, folder="INBOX")
    totals = {
        "received_week": 0,
        "unread_total": 0,
        "unread_week": 0,
        "answered_week": 0,
        "unanswered_week": 0,
    }
    for s in stats.values():
        for k in totals:
            totals[k] += s.get(k, 0)
    unseen_counts = cache.unseen_counts_by_account(user_id, "INBOX")
    priority_counts = analyses.priority_stats(user_id, days=7)
    category_counts = analyses.category_stats(user_id, days=7)
    urgent_list = analyses.top_urgent_messages(user_id, days=7, limit=8)
    slug_to_account = {a.slug: a for a in accounts}
    for item in urgent_list:
        acc = slug_to_account.get(item["account_slug"])
        item["account_name"] = acc.name if acc else item["account_slug"]
    return templates.TemplateResponse(
        "home.html",
        {
            "request": request,
            "accounts": accounts,
            "account": None,
            "folders": [],
            "folder": "INBOX",
            "stats": stats,
            "totals": totals,
            "unseen_counts": unseen_counts,
            "priority_counts": priority_counts,
            "category_counts": category_counts,
            "urgent_list": urgent_list,
        },
    )


@app.get("/mailbox/{slug}", response_class=HTMLResponse)
def mailbox(
    request: Request,
    slug: str,
    folder: str = "INBOX",
    page: int = 1,
    resync: int = 0,
    show_all: int = 0,
    error: str | None = None,
):
    user_id = _user_id(request)
    accounts = get_accounts(user_id)
    account = find_account(slug, accounts)
    page = max(1, page)
    per_page = 50
    apply_filter = not bool(show_all)
    messages = []
    folders: list[str] = []
    err = error
    try:
        folders = mail.list_folders(account)
        messages = mail.list_messages(
            account,
            folder=folder,
            limit=per_page,
            offset=(page - 1) * per_page,
            resync=bool(resync),
            apply_filter=apply_filter,
        )
    except Exception as e:
        err = f"Impossible de contacter {account.email} : {e}"

    # Attach cached priority/category badges.
    if messages:
        uids = [int(m.uid) for m in messages]
        analysis_map = analyses.list_analyses_for_uids(
            user_id, account.slug, folder, uids
        )
        for m in messages:
            row = analysis_map.get(int(m.uid))
            if row:
                m.priority = row["priority"]
                m.category = row["category"]
                m.reason = row["reason"]

    _maybe_trigger_daily_pass(user_id, accounts)

    unseen_counts = cache.unseen_counts_by_account(
        user_id, "INBOX", apply_filter=True
    )
    hidden_count = (
        cache.count_hidden(user_id, account.slug, folder) if apply_filter else 0
    )
    return templates.TemplateResponse(
        "inbox.html",
        {
            "request": request,
            "accounts": accounts,
            "account": account,
            "folders": folders,
            "folder": folder,
            "messages": messages,
            "page": page,
            "error": err,
            "unseen_counts": unseen_counts,
            "show_all": bool(show_all),
            "hidden_count": hidden_count,
        },
    )


@app.get("/mailbox/{slug}/message/{uid}", response_class=HTMLResponse)
def view_message(
    request: Request,
    slug: str,
    uid: int,
    folder: str = "INBOX",
    show_images: int = 0,
):
    user_id = _user_id(request)
    accounts = get_accounts(user_id)
    account = find_account(slug, accounts)
    msg = mail.fetch_message(account, folder, str(uid), mark_seen=True)
    if not msg:
        raise HTTPException(status_code=404, detail="Message introuvable")
    blocked_assets = 0
    display_html = msg.html
    if msg.html and not show_images:
        display_html, blocked_assets = security.strip_remote_assets(msg.html)
    analysis = analyses.get_analysis(user_id, account.slug, folder, int(uid))
    return templates.TemplateResponse(
        "message.html",
        {
            "request": request,
            "accounts": accounts,
            "account": account,
            "folder": folder,
            "msg": msg,
            "display_html": display_html,
            "blocked_assets": blocked_assets,
            "show_images": bool(show_images),
            "analysis": analysis,
            "unseen_counts": cache.unseen_counts_by_account(user_id, "INBOX"),
        },
    )


@app.get("/mailbox/{slug}/message/{uid}/attachment/{idx}")
def download_attachment(
    request: Request,
    slug: str,
    uid: int,
    idx: int,
    folder: str = "INBOX",
    confirm: int = 0,
):
    user_id = _user_id(request)
    accounts = get_accounts(user_id)
    account = find_account(slug, accounts)
    msg = mail.fetch_message(account, folder, str(uid), mark_seen=False)
    if not msg or idx >= len(msg.attachments):
        raise HTTPException(status_code=404)
    att = msg.attachments[idx]

    if security.is_dangerous_attachment(att.filename) and not confirm:
        return templates.TemplateResponse(
            "attachment_warning.html",
            {
                "request": request,
                "accounts": accounts,
                "account": account,
                "folder": folder,
                "msg": msg,
                "att": att,
                "idx": idx,
                "ext": security.attachment_extension(att.filename),
                "unseen_counts": cache.unseen_counts_by_account(
                    user_id, "INBOX"
                ),
            },
            status_code=200,
        )

    return StreamingResponse(
        io.BytesIO(att.payload),
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": security.safe_content_disposition(att.filename),
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "sandbox; default-src 'none'",
        },
    )


@app.post("/mailbox/{slug}/message/{uid}/delete")
def delete_message_route(
    request: Request,
    slug: str,
    uid: int,
    folder: str = Form("INBOX"),
):
    user_id = _user_id(request)
    accounts = get_accounts(user_id)
    account = find_account(slug, accounts)
    try:
        mail.delete_message(account, folder, str(uid))
    except Exception as e:
        return RedirectResponse(
            f"/mailbox/{slug}?folder={folder}&error={e}", status_code=303
        )
    return RedirectResponse(f"/mailbox/{slug}?folder={folder}", status_code=303)


@app.get("/compose", response_class=HTMLResponse)
def compose_get(
    request: Request,
    from_slug: str | None = None,
    reply_to_slug: str | None = None,
    reply_to_folder: str | None = None,
    reply_to_uid: str | None = None,
    reply_all: int = 0,
    draft: str | None = None,
):
    user_id = _user_id(request)
    accounts = get_accounts(user_id)
    if not accounts:
        raise HTTPException(status_code=400, detail="Aucun compte configuré")

    selected = accounts[0]
    if from_slug:
        selected = find_account(from_slug, accounts)

    prefill = {
        "to": "",
        "cc": "",
        "subject": "",
        "body": "",
        "in_reply_to": "",
        "references": "",
        "reply_source_slug": "",
        "reply_source_folder": "",
        "reply_source_uid": "",
    }

    reply_context = None
    if reply_to_slug and reply_to_folder and reply_to_uid:
        src_account = find_account(reply_to_slug, accounts)
        original = mail.fetch_message(
            src_account, reply_to_folder, reply_to_uid, mark_seen=False
        )
        if original:
            selected = src_account
            prefill["to"] = original.from_email
            if reply_all:
                others = [
                    addr for addr in original.to if addr.lower() != src_account.email.lower()
                ]
                prefill["cc"] = ", ".join(original.cc + others)
            subj = original.subject or ""
            prefill["subject"] = (
                subj if subj.lower().startswith("re:") else f"Re: {subj}"
            )
            quoted = "\n".join(f"> {line}" for line in (original.text or "").splitlines())
            prefill["body"] = (
                f"\n\n\nLe {original.date_display}, "
                f"{original.from_name or original.from_email} a écrit :\n{quoted}"
            )
            prefill["in_reply_to"] = original.message_id
            prefill["references"] = (
                (original.references + " " if original.references else "")
                + original.message_id
            ).strip()
            prefill["reply_source_slug"] = reply_to_slug
            prefill["reply_source_folder"] = reply_to_folder
            prefill["reply_source_uid"] = reply_to_uid

            preview = (original.text or _html_to_text(original.html or ""))
            preview = preview.strip()
            if len(preview) > 600:
                preview = preview[:600].rstrip() + "…"
            reply_context = {
                "from_name": original.from_name or original.from_email,
                "from_email": original.from_email,
                "subject": original.subject or "(sans objet)",
                "date_display": original.date_display,
                "account_email": src_account.email,
                "slug": reply_to_slug,
                "folder": reply_to_folder,
                "uid": reply_to_uid,
                "preview": preview,
            }

    if draft:
        # Gemini-generated draft overrides the quoted-reply body.
        prefill["body"] = draft

    return templates.TemplateResponse(
        "compose.html",
        {
            "request": request,
            "accounts": accounts,
            "selected": selected,
            "prefill": prefill,
            "reply_context": reply_context,
            "unseen_counts": cache.unseen_counts_by_account(user_id, "INBOX"),
        },
    )


@app.post("/compose")
async def compose_post(
    request: Request,
    from_slug: Annotated[str, Form()],
    to: Annotated[str, Form()],
    subject: Annotated[str, Form()],
    body: Annotated[str, Form()],
    cc: Annotated[str, Form()] = "",
    bcc: Annotated[str, Form()] = "",
    in_reply_to: Annotated[str, Form()] = "",
    references: Annotated[str, Form()] = "",
    reply_source_slug: Annotated[str, Form()] = "",
    reply_source_folder: Annotated[str, Form()] = "",
    reply_source_uid: Annotated[str, Form()] = "",
    attachments: Annotated[list[UploadFile] | None, File()] = None,
):
    user_id = _user_id(request)
    accounts = get_accounts(user_id)
    account = find_account(from_slug, accounts)

    def _split(addrs: str) -> list[str]:
        return [a.strip() for a in addrs.replace(";", ",").split(",") if a.strip()]

    outgoing: list[OutgoingAttachment] = []
    total_size = 0
    for up in attachments or []:
        if not up.filename:
            continue
        data = await up.read()
        if not data:
            continue
        if len(data) > security.MAX_ATTACHMENT_SIZE:
            raise HTTPException(
                status_code=413,
                detail=(
                    f"Pièce jointe « {up.filename} » trop volumineuse "
                    f"({len(data) // 1024} Ko > {security.MAX_ATTACHMENT_SIZE // (1024 * 1024)} Mo)."
                ),
            )
        total_size += len(data)
        if total_size > security.MAX_TOTAL_UPLOAD:
            raise HTTPException(
                status_code=413,
                detail="Taille totale des pièces jointes trop élevée.",
            )
        outgoing.append(
            OutgoingAttachment(
                filename=up.filename,
                content_type=up.content_type or "application/octet-stream",
                payload=data,
            )
        )

    try:
        mail.send_message(
            account,
            to=_split(to),
            subject=subject,
            body_text=body,
            cc=_split(cc) or None,
            bcc=_split(bcc) or None,
            in_reply_to=in_reply_to or None,
            references=references or None,
            attachments=outgoing,
        )
        if reply_source_slug and reply_source_folder and reply_source_uid:
            try:
                src = find_account(reply_source_slug, accounts)
                mail.mark_flag(
                    src,
                    reply_source_folder,
                    reply_source_uid,
                    "\\Answered",
                    True,
                )
            except Exception:
                pass
    except Exception as e:
        return templates.TemplateResponse(
            "compose.html",
            {
                "request": request,
                "accounts": accounts,
                "selected": account,
                "prefill": {
                    "to": to,
                    "cc": cc,
                    "subject": subject,
                    "body": body,
                    "in_reply_to": in_reply_to,
                    "references": references,
                },
                "error": f"Échec de l'envoi : {e}",
                "unseen_counts": cache.unseen_counts_by_account(
                    user_id, "INBOX"
                ),
            },
            status_code=500,
        )

    return RedirectResponse(f"/mailbox/{account.slug}?sent=1", status_code=303)


# -------------------------------------------------- test account JSON API


@app.post("/api/test-account")
async def test_account(request: Request):
    """Validate IMAP+SMTP login for a candidate account.

    Used by the React UI when the user clicks "Tester la connexion"
    in their profile. The frontend sends the full connection details
    (password included, since the account might not be saved yet) and
    we try to log in once. Nothing is persisted.
    """
    user_id = _user_id(request)
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="invalid json")

    required = (
        "email", "password", "imap_host", "imap_port",
        "smtp_host", "smtp_port",
    )
    missing = [k for k in required if not payload.get(k)]
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"missing fields: {', '.join(missing)}",
        )

    candidate = Account(
        id="probe",
        user_id=user_id,
        name=payload.get("name", payload["email"]),
        email=payload["email"],
        password=payload["password"],
        display_name=payload.get("display_name") or payload["email"],
        imap_host=payload["imap_host"],
        imap_port=int(payload["imap_port"]),
        smtp_host=payload["smtp_host"],
        smtp_port=int(payload["smtp_port"]),
        smtp_ssl=bool(payload.get("smtp_ssl", True)),
    )

    try:
        mail.test_account(candidate)
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=200)
    return {"ok": True}


# -------------------------------------------------------------- AI API


def _missing_gemini_response() -> JSONResponse:
    return JSONResponse(
        {
            "error": "missing_gemini_key",
            "message": (
                "Configure ta clé Gemini dans ton profil VideoFlow "
                "(Profil → Clés API → Gemini)."
            ),
        },
        status_code=400,
    )


@app.post("/api/messages/{slug}/{folder}/{uid}/drafts")
async def drafts_for_message(
    request: Request, slug: str, folder: str, uid: int
):
    """Generate 3 reply drafts (pro/amical/ferme) for this message."""
    user_id = _user_id(request)
    accounts = get_accounts(user_id)
    account = find_account(slug, accounts)

    api_key = await ai.fetch_user_gemini_key(user_id)
    if not api_key:
        return _missing_gemini_response()

    msg = mail.fetch_message(account, folder, str(uid), mark_seen=False)
    if not msg:
        raise HTTPException(status_code=404, detail="Message introuvable")

    body_text = msg.text or _html_to_text(msg.html or "")
    try:
        drafts = await ai.generate_reply_drafts(
            api_key,
            subject=msg.subject or "",
            from_name=msg.from_name or "",
            from_email=msg.from_email or "",
            body_text=body_text,
            user_display_name=account.display_name or account.email,
        )
    except ai.GeminiError as e:
        return JSONResponse(
            {"error": "gemini_error", "message": str(e)}, status_code=502
        )
    except Exception as e:
        log.warning("drafts failed user=%s uid=%s err=%s", user_id, uid, e)
        return JSONResponse(
            {"error": "drafts_failed", "message": str(e)}, status_code=500
        )

    return {"drafts": drafts}


@app.post("/api/translate")
async def translate_text(request: Request):
    """Translate arbitrary text to English (used by the composer)."""
    user_id = _user_id(request)
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="invalid json")

    text = (payload.get("text") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="missing text")

    api_key = await ai.fetch_user_gemini_key(user_id)
    if not api_key:
        return _missing_gemini_response()

    try:
        translated = await ai.translate_to_english(api_key, text)
    except ai.GeminiError as e:
        return JSONResponse(
            {"error": "gemini_error", "message": str(e)}, status_code=502
        )
    except Exception as e:
        log.warning("translate failed user=%s err=%s", user_id, e)
        return JSONResponse(
            {"error": "translate_failed", "message": str(e)}, status_code=500
        )
    return {"translated": translated}


@app.post("/api/polish")
async def polish_text_api(request: Request):
    """Proofread / reformat the composer body in its own language."""
    user_id = _user_id(request)
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="invalid json")

    text = (payload.get("text") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="missing text")

    api_key = await ai.fetch_user_gemini_key(user_id)
    if not api_key:
        return _missing_gemini_response()

    try:
        polished = await ai.polish_text(api_key, text)
    except ai.GeminiError as e:
        return JSONResponse(
            {"error": "gemini_error", "message": str(e)}, status_code=502
        )
    except Exception as e:
        log.warning("polish failed user=%s err=%s", user_id, e)
        return JSONResponse(
            {"error": "polish_failed", "message": str(e)}, status_code=500
        )
    return {"polished": polished}


@app.post("/api/mailbox/{slug}/analyze-pending")
async def analyze_pending(request: Request, slug: str):
    """Manually classify the account's recent unanalyzed messages."""
    user_id = _user_id(request)
    accounts = get_accounts(user_id)
    account = find_account(slug, accounts)

    api_key = await ai.fetch_user_gemini_key(user_id)
    if not api_key:
        return _missing_gemini_response()

    try:
        mail.sync_folder(account, "INBOX")
    except Exception:
        pass

    result = await analyses.run_classification_pass(
        user_id, accounts, manual=True, slug_filter=slug
    )
    return result


@app.post("/api/messages/{slug}/{folder}/{uid}/done")
async def mark_message_done(
    request: Request, slug: str, folder: str, uid: int
):
    """Mark a message as handled/processed by the user.

    Independent of the IMAP \\Seen / \\Answered flags — lets the user
    clear a message from the "À traiter en priorité" list once they
    have dealt with it (replied, forwarded, read and dismissed, ...).
    """
    user_id = _user_id(request)
    accounts = get_accounts(user_id)
    find_account(slug, accounts)  # 404 if slug doesn't belong to user
    analyses.mark_done(user_id, slug, folder, uid)
    return {"ok": True, "done": True}


@app.delete("/api/messages/{slug}/{folder}/{uid}/done")
async def unmark_message_done(
    request: Request, slug: str, folder: str, uid: int
):
    """Undo mark-as-done so the message reappears in the priority list."""
    user_id = _user_id(request)
    accounts = get_accounts(user_id)
    find_account(slug, accounts)
    analyses.unmark_done(user_id, slug, folder, uid)
    return {"ok": True, "done": False}


@app.post("/api/analyze-all-pending")
async def analyze_all_pending(request: Request):
    """Manually classify unanalyzed messages across all user accounts."""
    user_id = _user_id(request)
    accounts = get_accounts(user_id)
    if not accounts:
        return {"analyzed": 0, "skipped": 0}

    api_key = await ai.fetch_user_gemini_key(user_id)
    if not api_key:
        return _missing_gemini_response()

    for a in accounts:
        try:
            mail.sync_folder(a, "INBOX")
        except Exception:
            pass

    result = await analyses.run_classification_pass(
        user_id, accounts, manual=True
    )
    return result


# ---------------------------------------------------------------- util


import re as _re

_HTML_TAG = _re.compile(r"<[^>]+>")


def _html_to_text(html: str) -> str:
    """Coarse HTML → text for Gemini prompts."""
    if not html:
        return ""
    text = _HTML_TAG.sub(" ", html)
    return _re.sub(r"\s+", " ", text).strip()
