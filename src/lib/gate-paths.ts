/**
 * ─── Site-gate exemptions + the sign-in return path (pure) ──────────
 *
 * While the site gate is ON, every page route redirects non-operators
 * to /gate (app/layout.tsx). A few pages must stay open anyway because
 * they are the hand-off from the BTC Experiment game into a member's
 * agent (Dave, 2026-11-20 — "the funnel is broken at the hand-off"):
 *
 *   /gate          the closed-door page itself
 *   /connect/<c>   the agent link — the code in the URL is the credential
 *   /bridge        the game's "ACTIVATE YOUR AGENT" target (?ref=)
 *   /claim         where a game win becomes free generations (?code=)
 *
 * /bridge and /claim carry their own sign-in: anonymous visitors see a
 * "Connect with Whop" card and no member data, and every API they call
 * is behind the session floor in middleware.ts. Opening the page is not
 * opening the app.
 *
 * The Whop OAuth callback used to always land on "/", which is gated —
 * so a player who signed in from /claim bounced to the closed door.
 * `safeReturnPath` lets /api/auth/whop carry the page the visitor came
 * from through the round trip, restricted to the exempt hand-off pages
 * so it can never become an open redirect.
 *
 * No imports: this runs in the root layout and in route handlers, and
 * is unit-tested directly (gate-paths.test.ts).
 */

/** Pages reachable while the site gate is ON. Exact path or `<path>/…`.
 *  /agents + /agent/{slug} are the Whop Army 2.0 public showcase
 *  (Slice 2): they render only rows the owner marked publicProfile,
 *  through the lib/agent-profile.ts serializer — no member data.
 *  /apps + /apps/{slug} are the Slice 3 applications showcase: same
 *  rule, only rows the owner marked public, through
 *  lib/application.ts — no member data.
 *  /rotator is the Slice 5 public rotator marketplace: it renders
 *  only the public-safe marketplace serialization from
 *  lib/rotator-market-server.ts (partner, display name, host) —
 *  no member data. */
export const GATE_EXEMPT_PATHS = ["/gate", "/connect", "/bridge", "/claim", "/agents", "/agent", "/apps", "/rotator"] as const;

/** Pages a sign-in may return to (a subset of the exempt ones, plus
 *  home). /build (Whop Army 2.0, Slice 4) is a member page, not a
 *  gate hand-off — it is NOT gate-exempt — but a member who signs in
 *  from its Connect card should land back on the flow, not home. */
const RETURN_PATHS = new Set(["/", "/bridge", "/claim", "/build", "/bridge-code", "/beta"]);

const MAX_RETURN_LENGTH = 1000;

export function isGateExempt(pathname: string): boolean {
  return GATE_EXEMPT_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * The post-sign-in destination, or null when `raw` is not a same-site
 * path to one of the hand-off pages. Keeps the query string (the claim
 * code, the ref) and drops any fragment.
 */
export function safeReturnPath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  // No trimming: a value with stray whitespace or control characters
  // did not come from our own sign-in links, so it is refused whole.
  const value = raw;
  if (!value || value.length > MAX_RETURN_LENGTH) return null;
  // Same-site paths only: one leading slash, no scheme-relative "//",
  // no backslash tricks browsers normalize to "//", no control chars.
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  if (/[\\\u0000-\u001f\u007f]/.test(value)) return null;
  let parsed: URL;
  try {
    parsed = new URL(value, "https://return.invalid");
  } catch {
    return null;
  }
  if (parsed.origin !== "https://return.invalid") return null;
  if (!RETURN_PATHS.has(parsed.pathname)) return null;
  return `${parsed.pathname}${parsed.search}`;
}
