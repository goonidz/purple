"""Gemini integration for the CRM.

All calls use the user's own Gemini key stored in Supabase Vault under
``user_api_key_<user_id>_gemini`` (same slot as the rest of VideoFlow).
We fetch it via the SECURITY DEFINER RPC ``get_user_api_key_for_service``
using the service role key — no new secrets required.

Model: ``gemini-3.1-flash-lite-preview`` (same default as the edge
functions in ``supabase/functions/_shared/gemini.ts``). Can be
overridden via the ``GEMINI_TEXT_MODEL`` env var.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time
from typing import Any

import httpx

from .config import SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL, _rest_headers

log = logging.getLogger("crm.ai")

GEMINI_MODEL = os.getenv("GEMINI_TEXT_MODEL", "gemini-3.1-flash-lite-preview")
GEMINI_ENDPOINT = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    f"{GEMINI_MODEL}:generateContent"
)

# Rate-limit guard: Google free tier is 15 RPM.
_GEMINI_SEMAPHORE = asyncio.Semaphore(5)
_GEMINI_MIN_INTERVAL = 0.5  # seconds between launches per worker

# In-memory cache of resolved Gemini keys so we don't hit Supabase on
# every single classify_email call during a batch pass.
_KEY_CACHE: dict[str, tuple[float, str | None]] = {}
_KEY_CACHE_TTL = 600.0  # 10 minutes


ALLOWED_PRIORITIES = {"urgent", "a_lire", "spam", "auto"}
ALLOWED_CATEGORIES = {"important", "autre"}


class GeminiError(RuntimeError):
    """Raised when Gemini returns an error we can't auto-recover from."""


# ------------------------------------------------------------------ key


async def fetch_user_gemini_key(user_id: str) -> str | None:
    """Return the user's Gemini API key, or None if unset.

    Uses the service-role RPC because the CRM backend has no ``auth.uid``
    context (it's running with the project-wide service role key).
    """
    now = time.time()
    cached = _KEY_CACHE.get(user_id)
    if cached and now - cached[0] < _KEY_CACHE_TTL:
        return cached[1]

    if not (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY):
        return None

    url = f"{SUPABASE_URL}/rest/v1/rpc/get_user_api_key_for_service"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                url,
                headers=_rest_headers(),
                json={"target_user_id": user_id, "key_name": "gemini"},
            )
    except Exception as e:
        log.warning("gemini key fetch failed user=%s err=%s", user_id, e)
        return None

    if resp.status_code != 200:
        log.warning(
            "gemini key RPC status=%s body=%s user=%s",
            resp.status_code,
            resp.text[:200],
            user_id,
        )
        return None

    try:
        key = resp.json()
        if isinstance(key, str) and key.strip():
            _KEY_CACHE[user_id] = (now, key)
            return key
    except Exception:
        pass

    _KEY_CACHE[user_id] = (now, None)
    return None


# ------------------------------------------------------------- low-level


async def _call_gemini(
    api_key: str,
    prompt: str,
    *,
    response_schema: dict | None = None,
    expect_json: bool = False,
    max_output_tokens: int = 1024,
) -> str:
    """POST /generateContent and return the model's text reply.

    If ``response_schema`` is provided, Gemini enforces a strict JSON
    shape. One automatic retry on 429/5xx with a short backoff.
    """
    generation_config: dict[str, Any] = {
        "temperature": 0.3,
        "maxOutputTokens": max_output_tokens,
    }
    if expect_json:
        generation_config["responseMimeType"] = "application/json"
    if response_schema is not None:
        generation_config["responseSchema"] = response_schema

    body = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": generation_config,
    }

    headers = {
        "Content-Type": "application/json",
        "x-goog-api-key": api_key,
    }

    async with _GEMINI_SEMAPHORE:
        last_err: Exception | None = None
        for attempt in range(2):
            try:
                async with httpx.AsyncClient(timeout=30.0) as client:
                    resp = await client.post(
                        GEMINI_ENDPOINT, headers=headers, json=body
                    )
            except Exception as e:
                last_err = e
                await asyncio.sleep(1.0 + attempt * 2.0)
                continue

            if resp.status_code in (429, 500, 502, 503, 504):
                await asyncio.sleep(1.5 + attempt * 2.0)
                last_err = GeminiError(
                    f"gemini {resp.status_code}: {resp.text[:200]}"
                )
                continue

            if resp.status_code != 200:
                raise GeminiError(
                    f"gemini {resp.status_code}: {resp.text[:500]}"
                )

            data = resp.json()
            try:
                text = data["candidates"][0]["content"]["parts"][0]["text"]
            except (KeyError, IndexError, TypeError) as e:
                raise GeminiError(
                    f"gemini malformed response: {str(data)[:300]}"
                ) from e
            await asyncio.sleep(_GEMINI_MIN_INTERVAL)
            return text

        raise GeminiError(f"gemini exhausted retries: {last_err}")


def _parse_json_reply(text: str) -> dict:
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        # Gemini sometimes wraps JSON in ```json fences even with
        # responseMimeType=application/json when the prompt nudges it.
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if match:
            return json.loads(match.group(0))
        raise


# ----------------------------------------------------------- classify


_CLASSIFY_SCHEMA = {
    "type": "object",
    "properties": {
        "priority": {
            "type": "string",
            "enum": ["urgent", "a_lire", "spam", "auto"],
        },
        "category": {
            "type": "string",
            "enum": ["important", "autre"],
        },
        "reason": {"type": "string"},
    },
    "required": ["priority", "category"],
}


async def classify_email(
    api_key: str,
    *,
    subject: str,
    from_email: str,
    from_name: str,
    preview: str,
) -> dict:
    """Return ``{'priority', 'category', 'reason'}`` for one email."""
    safe_subject = (subject or "")[:200]
    safe_from = f"{from_name} <{from_email}>"[:200]
    safe_preview = _strip_noise(preview or "")[:500]

    prompt = (
        "Tu es un assistant de triage d'emails pour un service client. "
        "Tous les expéditeurs sont des clients ou prospects (ne jamais "
        "classer comme 'perso'). Analyse l'email ci-dessous et réponds "
        "UNIQUEMENT en JSON avec deux champs obligatoires (priority, "
        "category) et un champ optionnel (reason, 1 phrase en français).\n\n"
        "priority :\n"
        "  - 'urgent' : action immédiate attendue (deadline, panne, client fâché, réclamation)\n"
        "  - 'a_lire' : important à lire mais pas bloquant\n"
        "  - 'spam' : publicité, phishing, newsletter commerciale non sollicitée\n"
        "  - 'auto' : notification automatique système banale (livraison, confirmation, rappel)\n\n"
        "category :\n"
        "  - 'important' : vraie demande du client qui attend une réponse de notre part "
        "(question, demande d'aide, réclamation, bug, demande de devis, négociation)\n"
        "  - 'autre' : tout le reste — réponse automatique, accusé de réception, "
        "« merci », réponse à une de NOS newsletters sans question, out-of-office, "
        "bounce, transfert informatif qui n'appelle pas de réponse\n\n"
        "Ne classe 'important' que si un humain doit vraiment répondre. "
        "Un simple 'merci beaucoup' = 'autre'.\n\n"
        f"Expéditeur : {safe_from}\n"
        f"Objet : {safe_subject}\n"
        f"Extrait : {safe_preview}\n"
    )

    text = await _call_gemini(
        api_key,
        prompt,
        response_schema=_CLASSIFY_SCHEMA,
        expect_json=True,
        max_output_tokens=256,
    )
    data = _parse_json_reply(text)
    priority = str(data.get("priority", "a_lire")).lower()
    category = str(data.get("category", "autre")).lower()
    if priority not in ALLOWED_PRIORITIES:
        priority = "a_lire"
    if category not in ALLOWED_CATEGORIES:
        category = "autre"
    reason = str(data.get("reason", ""))[:300]
    return {"priority": priority, "category": category, "reason": reason}


# ------------------------------------------------------------- drafts


_DRAFTS_SCHEMA = {
    "type": "object",
    "properties": {
        "professionnel": {"type": "string"},
        "amical": {"type": "string"},
        "ferme": {"type": "string"},
    },
    "required": ["professionnel", "amical", "ferme"],
}


async def generate_reply_drafts(
    api_key: str,
    *,
    subject: str,
    from_name: str,
    from_email: str,
    body_text: str,
    user_display_name: str,
) -> dict:
    """Return three reply drafts keyed by tone."""
    safe_body = _strip_noise(body_text or "")[:4000]
    prompt = (
        "Tu es l'assistant de rédaction d'emails. On te fournit un email reçu et "
        "le nom de la personne qui va répondre. Rédige TROIS brouillons de "
        "réponse en français, chacun avec un ton différent. "
        "Chaque brouillon doit :\n"
        " - faire 3 à 8 lignes,\n"
        " - commencer par une formule d'appel adaptée,\n"
        " - se terminer par une signature sobre : "
        "\"{name}\",\n"
        " - ne pas inclure d'objet, ne pas inclure les citations du message d'origine.\n\n"
        "Tons demandés :\n"
        "  - 'professionnel' : poli, cadré, efficace, vouvoiement\n"
        "  - 'amical' : chaleureux, tutoiement, détendu\n"
        "  - 'ferme' : direct, concis, sans hostilité mais sans fioritures\n\n"
        "Réponds en JSON strict avec les clés 'professionnel', 'amical', 'ferme'.\n\n"
        f"Auteur de la réponse : {user_display_name}\n"
        f"Expéditeur du mail reçu : {from_name} <{from_email}>\n"
        f"Objet : {subject}\n"
        f"Message reçu :\n{safe_body}\n"
    ).replace("{name}", user_display_name)

    text = await _call_gemini(
        api_key,
        prompt,
        response_schema=_DRAFTS_SCHEMA,
        expect_json=True,
        max_output_tokens=1500,
    )
    data = _parse_json_reply(text)
    return {
        "professionnel": str(data.get("professionnel", "")).strip(),
        "amical": str(data.get("amical", "")).strip(),
        "ferme": str(data.get("ferme", "")).strip(),
    }


# -------------------------------------------------------- translation


async def translate_to_english(api_key: str, text: str) -> str:
    """Translate French (or any language) email body to English."""
    safe = (text or "")[:10000]
    prompt = (
        "Translate the email body below to English. Keep the layout "
        "(line breaks, lists, quoted replies with >) exactly as-is. "
        "Do not add any introduction, commentary, or quotation marks. "
        "Return only the translated text.\n\n"
        "---\n"
        f"{safe}\n"
        "---"
    )
    reply = await _call_gemini(
        api_key,
        prompt,
        expect_json=False,
        max_output_tokens=2500,
    )
    return reply.strip()


# ---------------------------------------------------------------- util


_WS = re.compile(r"\s+")
_URLS = re.compile(r"https?://\S+")


def _strip_noise(text: str) -> str:
    """Tone down tracking pixels / long URLs / multi-blank lines for prompts."""
    cleaned = _URLS.sub("[url]", text)
    cleaned = _WS.sub(" ", cleaned).strip()
    return cleaned
