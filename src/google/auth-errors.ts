import { GoogleApiError } from "./api";

/**
 * Maps Google OAuth failures to short, actionable messages. Pure (no `obsidian`
 * import) so it stays unit-testable and mobile-safe. The token endpoint returns
 * JSON like `{ "error": "redirect_uri_mismatch", "error_description": "..." }`;
 * the obsidian:// callback instead hands us a bare error code string.
 */

export interface OAuthErrorInfo {
    code?: string;
    description?: string;
}

/** OAuth error codes we can give specific guidance for. */
const KNOWN_CODES = [
    "redirect_uri_mismatch",
    "invalid_client",
    "invalid_grant",
    "access_denied",
    "unauthorized_client",
    "invalid_request",
    "invalid_scope",
] as const;

function matchKnownCode(text: string): string | undefined {
    return KNOWN_CODES.find((c) => text.includes(c));
}

/** Pull an OAuth error code/description out of whatever the auth flow threw. */
export function extractOAuthError(err: unknown): OAuthErrorInfo {
    const body = err instanceof GoogleApiError ? err.body : undefined;
    if (body && typeof body === "object") {
        const b = body as Record<string, unknown>;
        const code = typeof b.error === "string" ? b.error : undefined;
        const description =
            typeof b.error_description === "string" ? b.error_description : undefined;
        if (code || description) return { code, description };
    }
    if (typeof body === "string") {
        const fromText = matchKnownCode(body);
        if (fromText) return { code: fromText, description: body };
    }
    if (typeof err === "string") {
        const fromText = matchKnownCode(err);
        return fromText ? { code: fromText, description: err } : { description: err };
    }
    if (err instanceof Error) {
        const fromText = matchKnownCode(err.message);
        return fromText
            ? { code: fromText, description: err.message }
            : { description: err.message };
    }
    return {};
}

/** A short, actionable explanation for a known OAuth error code, or null. */
export function describeOAuthError(code: string | undefined): string | null {
    switch (code) {
        case "redirect_uri_mismatch":
            return "redirect_uri_mismatch — the redirect bridge URL doesn't exactly match the one on your Google OAuth client. Check for a missing or extra trailing slash, http vs https, and that the client type is Web application.";
        case "invalid_client":
            return "invalid_client — the OAuth client ID or secret is wrong, or a Desktop client was pasted into this Web application flow. Re-copy both from Google Cloud → Clients.";
        case "invalid_grant":
            return "invalid_grant — the sign-in expired or was already used, or the saved session was revoked. Run Connect to Google again.";
        case "access_denied":
            return "access_denied — Google blocked the sign-in. Add your own Google address under Test users (Audience) while the app is in Testing.";
        case "unauthorized_client":
            return "unauthorized_client — this OAuth client can't use this flow. Confirm its type is Web application.";
        case "invalid_scope":
            return "invalid_scope — the requested Calendar/Tasks permissions were rejected. Confirm both APIs are enabled and the scopes are listed under Data access.";
        case "invalid_request":
            return "invalid_request — Google rejected the request. Re-check the redirect bridge URL and client values.";
        default:
            return null;
    }
}

/** Build a user-facing auth-failure message from any error or bare error code. */
export function friendlyAuthError(err: unknown): string {
    const { code, description } = extractOAuthError(err);
    const known = describeOAuthError(code);
    if (known) return known;
    if (code) return description ? `${code}: ${description}` : code;
    if (description) return description;
    return "unknown error";
}
