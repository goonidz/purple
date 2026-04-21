from __future__ import annotations

import hashlib
import logging
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import httpx
from dotenv import load_dotenv

load_dotenv()

log = logging.getLogger("crm.config")

BASE_DIR = Path(__file__).resolve().parent.parent


@dataclass
class Account:
    """In-memory representation of an email account.

    The ``id`` and ``user_id`` fields come from the Supabase
    ``user_email_accounts`` row; ``password`` is fetched on demand from
    the Vault RPC ``get_user_email_account_password``. ``slug`` is
    derived from the account id so that it stays unique per user even
    when the same email address is used under two different users'
    profiles (unlikely but possible).
    """

    id: str
    user_id: str
    name: str
    email: str
    password: str
    display_name: str
    imap_host: str
    imap_port: int
    smtp_host: str
    smtp_port: int
    smtp_ssl: bool

    @property
    def slug(self) -> str:
        # Short stable slug derived from the UUID: keeps URLs compact
        # while guaranteeing cross-user uniqueness.
        return hashlib.sha1(self.id.encode("utf-8")).hexdigest()[:16]


# --- environment -----------------------------------------------------------

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
SUPABASE_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET", "")

SESSION_SECRET = os.getenv("SESSION_SECRET", "change_me_too_please")
HOST = os.getenv("HOST", "127.0.0.1")
PORT = int(os.getenv("PORT", "8002"))
ROOT_PATH = os.getenv("ROOT_PATH", "/crm")

UPLOAD_DIR = BASE_DIR / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)


def _rest_headers() -> dict[str, str]:
    return {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
    }


def _require_supabase() -> None:
    if not (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY):
        raise RuntimeError(
            "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in the "
            "environment for the CRM backend to load user email accounts."
        )


def _fetch_password(account_id: str, user_id: str) -> Optional[str]:
    """Call the SECURITY DEFINER RPC to decrypt the Vault password.

    We call via the REST API using the service role key and pass
    ``p_user_id`` so the RPC can still enforce ownership even when
    ``auth.uid()`` is null (service role session).
    """
    url = f"{SUPABASE_URL}/rest/v1/rpc/get_user_email_account_password"
    with httpx.Client(timeout=10.0) as client:
        resp = client.post(
            url,
            headers=_rest_headers(),
            json={"account_id": account_id, "p_user_id": user_id},
        )
    if resp.status_code != 200:
        log.warning(
            "get_user_email_account_password failed account=%s status=%s body=%s",
            account_id,
            resp.status_code,
            resp.text[:200],
        )
        return None
    try:
        return resp.json()
    except Exception:
        return None


def load_accounts_for_user(user_id: str) -> list[Account]:
    """Return every email account the given Supabase user owns.

    The password is pulled from Vault for each row; rows without a
    stored password are skipped (the user hasn't finished setting them
    up yet).
    """
    _require_supabase()
    url = f"{SUPABASE_URL}/rest/v1/user_email_accounts"
    params = {
        "user_id": f"eq.{user_id}",
        "select": (
            "id,user_id,name,email,display_name,"
            "imap_host,imap_port,smtp_host,smtp_port,smtp_ssl,"
            "password_secret_id"
        ),
        "order": "created_at.asc",
    }
    with httpx.Client(timeout=10.0) as client:
        resp = client.get(url, headers=_rest_headers(), params=params)
    if resp.status_code != 200:
        log.warning(
            "user_email_accounts fetch failed user=%s status=%s body=%s",
            user_id,
            resp.status_code,
            resp.text[:200],
        )
        return []

    accounts: list[Account] = []
    for row in resp.json() or []:
        if not row.get("password_secret_id"):
            continue
        password = _fetch_password(row["id"], user_id)
        if not password:
            continue
        accounts.append(
            Account(
                id=row["id"],
                user_id=row["user_id"],
                name=row["name"],
                email=row["email"],
                password=password,
                display_name=row.get("display_name") or row["name"],
                imap_host=row.get("imap_host") or "mail.privateemail.com",
                imap_port=int(row.get("imap_port") or 993),
                smtp_host=row.get("smtp_host") or "mail.privateemail.com",
                smtp_port=int(row.get("smtp_port") or 465),
                smtp_ssl=bool(row.get("smtp_ssl", True)),
            )
        )
    return accounts
