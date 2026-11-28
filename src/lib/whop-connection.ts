/**
 * Whop connection indicator — pure state derivation for /bridge-code.
 *
 * The indicator is driven ONLY by the two real responses the page
 * already fetches (Dave, 2026-11-24 — no invented state):
 *   - GET /api/auth/session → { connected, user: { planName, ... } }
 *   - GET /api/bridge/account → { connected, credits, errorCode, ... }
 *
 * `session === null` means the session fetch has not resolved yet.
 * In the open gate, `account === null` means the bridge account fetch
 * did not return an account (non-OK / unreachable) — that is honestly
 * "signed in, engine not linked", never "connected".
 */

export type WhopConnectionTone = "checking" | "disconnected" | "connected" | "unlinked";

export interface WhopSessionLike {
  connected: boolean;
  user: { planName?: string | null } | null;
}

export interface BridgeAccountLike {
  connected: boolean;
  credits: number | null;
  errorCode: string | null;
  /** BYOK recognition from the account view; null/absent = not checked. */
  byok?: { anySaved: boolean } | null;
}

export interface WhopConnectionState {
  tone: WhopConnectionTone;
  /** The full pill text, e.g. "Whop · Connected · Creator · 120 credits". */
  text: string;
}

export function deriveWhopConnection(
  session: WhopSessionLike | null | undefined,
  account: BridgeAccountLike | null | undefined,
): WhopConnectionState {
  if (!session) {
    return { tone: "checking", text: "Whop · Checking…" };
  }
  if (!session.connected) {
    return { tone: "disconnected", text: "Whop · Not connected" };
  }
  if (account?.connected) {
    let text = "Whop · Connected";
    const planName = session.user?.planName;
    if (planName) text += ` · ${planName}`;
    if (typeof account.credits === "number") {
      // The bridge uses -1 as its unlimited sentinel (same convention
      // the bridge-code credits card renders as "Unlimited").
      text += account.credits === -1 ? " · Unlimited credits" : ` · ${account.credits} credits`;
    }
    // A member running on their own saved keys is marked as such —
    // their credit figure is their live balance, not the allowance.
    if (account.byok?.anySaved) text += " · BYOK";
    return { tone: "connected", text };
  }
  let text = "Whop · Signed in — engine not linked";
  if (account?.errorCode) text += ` · ${account.errorCode}`;
  return { tone: "unlinked", text };
}
