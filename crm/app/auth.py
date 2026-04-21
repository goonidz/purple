"""Supabase JWT authentication for the CRM webmail backend.

The React SPA (served from the main VideoFlow frontend) is the only
client. Supabase stores the access token in ``localStorage`` by default
and exposes it as a cookie when configured so; we accept either:

- Header ``Authorization: Bearer <jwt>`` (explicit, used by fetch/XHR).
- Cookie ``sb-access-token`` (Supabase JS default when cookies are on).
- Cookie ``sb-<ref>-auth-token`` (current supabase-js localStorage key
  mirrored into a cookie by our SPA bootstrap - see frontend).

Validation is HS256 with ``SUPABASE_JWT_SECRET``. On success the
user's UUID (``sub`` claim) is attached to ``request.state.user_id``.
"""

from __future__ import annotations

import json
import logging
from typing import Optional

import jwt
from fastapi import Request

from .config import SUPABASE_JWT_SECRET

log = logging.getLogger("crm.auth")

# Cookies supabase-js can set out of the box. We also accept a custom
# cookie the React app explicitly writes when bootstrapping so that
# same-site navigation to /crm/ ships a credential.
_COOKIE_NAMES = (
    "sb-access-token",
    "videoflow-sb-access-token",
)


def _extract_token(request: Request) -> Optional[str]:
    auth_header = request.headers.get("authorization", "")
    if auth_header.lower().startswith("bearer "):
        token = auth_header.split(" ", 1)[1].strip()
        if token:
            return token

    for name in _COOKIE_NAMES:
        val = request.cookies.get(name)
        if val:
            return val.strip()

    # supabase-js localStorage uses keys like sb-<ref>-auth-token containing
    # a JSON blob with access_token. If a client mirrored it into a cookie,
    # unwrap it here too.
    for k, v in request.cookies.items():
        if k.startswith("sb-") and k.endswith("-auth-token"):
            try:
                obj = json.loads(v)
                tok = obj.get("access_token") if isinstance(obj, dict) else None
                if tok:
                    return tok
            except Exception:
                if v:
                    return v.strip()
    return None


def verify_token(token: str) -> Optional[dict]:
    if not SUPABASE_JWT_SECRET:
        log.error("SUPABASE_JWT_SECRET is empty — refusing to accept any token")
        return None
    try:
        # Supabase sets ``aud=authenticated`` on user tokens.
        return jwt.decode(
            token,
            SUPABASE_JWT_SECRET,
            algorithms=["HS256"],
            audience="authenticated",
            options={"require": ["exp", "sub"]},
        )
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError as e:
        log.debug("invalid jwt: %s", e)
        return None


def get_user_id(request: Request) -> Optional[str]:
    """Return the Supabase user id if the request carries a valid JWT."""
    cached = getattr(request.state, "user_id", None)
    if cached:
        return cached
    token = _extract_token(request)
    if not token:
        return None
    payload = verify_token(token)
    if not payload:
        return None
    user_id = payload.get("sub")
    if user_id:
        request.state.user_id = user_id
        request.state.jwt_payload = payload
    return user_id


def is_authenticated(request: Request) -> bool:
    return get_user_id(request) is not None
