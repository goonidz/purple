// Shared auth helper for Edge Functions that distinguish "internal backend
// call" (image-worker, pipeline-orchestrator, video-render-service, …) from
// "end-user call".
//
// Background — May 2026:
//   Functions used to do `authHeader === \`Bearer ${SUPABASE_SERVICE_ROLE_KEY}\``
//   to detect the internal case. That broke the day Supabase changed the
//   value auto-injected into the function under that env name.
//
//   Per the official Supabase docs (https://supabase.com/docs/guides/api/api-keys.md):
//     "You cannot send a publishable or secret key in the
//      `Authorization: Bearer ...` header, except if the value exactly
//      equals the `apikey` header."
//     "Edge Functions only support JWT verification via the `anon` and
//      `service_role` JWT-based API keys. You will need to use the
//      `--no-verify-jwt` option when using publishable and secret keys.
//      The Supabase platform does not verify the `apikey` header when
//      using Edge Functions in this way. Implement your own
//      `apikey`-header authorization logic inside the Edge Function code
//      itself."
//
//   So:
//     - For legacy JWT-based service_role keys, we can read `Authorization`.
//     - For new sb_secret_* keys, we MUST read the `apikey` header (the
//       gateway rejects them in Authorization unless they match apikey).
//     - In any case we accept BOTH headers in the helper, so callers can
//       send either or both.
//
// We accept all of the following as "internal service call":
//   - SUPABASE_SERVICE_ROLE_KEY        (legacy JWT, auto-injected)
//   - SUPABASE_SECRET_KEYS             (new sb_secret_* keys, comma-separated,
//                                       auto-injected)
//   - SERVICE_KEY_ALLOWLIST            (manual override / extra keys, comma-
//                                       separated; useful when rotating
//                                       or when SECRET_KEYS isn't injected)

function splitList(value: string | undefined | null): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function getValidServiceTokens(): string[] {
  const tokens = new Set<string>();
  const single = (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '').trim();
  if (single) tokens.add(single);
  for (const k of splitList(Deno.env.get('SUPABASE_SECRET_KEYS'))) tokens.add(k);
  for (const k of splitList(Deno.env.get('SERVICE_KEY_ALLOWLIST'))) tokens.add(k);
  return [...tokens];
}

function stripBearer(value: string | null | undefined): string {
  if (!value) return '';
  return value.replace(/^bearer\s+/i, '').trim();
}

/**
 * Returns true if the incoming request is a known internal service call.
 *
 * Pass the whole `req` (or a `{ headers }`-shaped object). The helper checks
 * BOTH the `Authorization` and `apikey` headers and accepts the request as
 * internal as long as ANY of them matches a configured service-role token.
 *
 * For backwards compat, this still accepts a raw Authorization header string
 * as the argument (legacy call sites) — in that case only that header is
 * checked.
 */
export function isInternalServiceCall(
  reqOrAuthHeader:
    | Request
    | { headers: Headers | { get: (name: string) => string | null } }
    | string
    | null
    | undefined,
): boolean {
  let candidates: string[] = [];

  if (!reqOrAuthHeader) return false;

  if (typeof reqOrAuthHeader === 'string') {
    candidates.push(stripBearer(reqOrAuthHeader));
  } else {
    const headers = (reqOrAuthHeader as { headers: Headers }).headers;
    if (!headers) return false;
    const get = (name: string) =>
      typeof (headers as Headers).get === 'function'
        ? (headers as Headers).get(name)
        : ((headers as unknown as Record<string, string>)[name] ?? null);
    candidates.push(stripBearer(get('Authorization') || get('authorization')));
    candidates.push(stripBearer(get('apikey') || get('Apikey') || get('APIKEY')));
  }

  candidates = candidates.filter(Boolean);
  if (candidates.length === 0) return false;

  const valid = getValidServiceTokens();
  if (valid.length === 0) return false;

  return candidates.some((c) => valid.includes(c));
}
