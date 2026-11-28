/**
 * BYOK recognition for the bridge account view (Dave, 2026-11-24).
 *
 * A member who has saved their own keys on their engine record (the
 * unlock saves: links, LLM, Giphy, Fish, here.now, render worker) runs
 * on their own keys — generation bills 1 credit per call against their
 * live balance, and an MP4 on their own render worker costs 1 credit
 * instead of 25. /muse-week must recognize that state and show the
 * member's LIVE balance as their balance, never the flat monthly
 * allowance figure.
 *
 * The state comes from the engine's own check_my_unlock tool, called
 * server-side with the member's derived key (see muse-bridge.ts). Its
 * structured payload (bot unlock-diagnosis) is:
 *   { unlocks: { links: { saved, count }, llm: { saved },
 *                giphy: { saved }, fish: { saved },
 *                herenow: { saved }, renderer: { saved } },
 *     mp4: { creditsIfRenderedNow: 1 | 25, basis } }
 * This module only maps that payload and derives display state — pure
 * functions, no I/O — so it is testable in the repo's node:test style.
 *
 * Note: the payload also carries member.fullByokPossible, which reads
 * false for bridge members (negative member ids) even when their saves
 * are real — a known label defect. Nothing here reads it; the saved
 * flags themselves are the truth.
 */

export interface BridgeByokView {
  /** True when at least one unlock is saved on the member's record. */
  anySaved: boolean;
  saved: {
    links: boolean;
    llm: boolean;
    giphy: boolean;
    fish: boolean;
    herenow: boolean;
    renderer: boolean;
  };
  /** An own render worker is saved (the renderer unlock) — MP4s bill 1 credit. */
  ownWorker: boolean;
  /** The engine's dry-run MP4 quote in credits (1 with own worker, else 25). */
  mp4QuoteCredits: number | null;
}

export const SAVED_KEYS = ["links", "llm", "giphy", "fish", "herenow", "renderer"] as const;
type SavedKey = (typeof SAVED_KEYS)[number];

function savedFlag(unlocks: Record<string, unknown>, key: SavedKey): boolean {
  const entry = unlocks[key];
  return typeof entry === "object" && entry !== null && (entry as { saved?: unknown }).saved === true;
}

/**
 * Map a check_my_unlock payload to the view's BYOK block. Returns null
 * for anything that is not a recognizable unlock payload — the account
 * view degrades to its non-BYOK presentation rather than guessing.
 */
export function byokViewFromUnlockPayload(payload: unknown): BridgeByokView | null {
  if (typeof payload !== "object" || payload === null) return null;
  const unlocks = (payload as { unlocks?: unknown }).unlocks;
  if (typeof unlocks !== "object" || unlocks === null) return null;
  const u = unlocks as Record<string, unknown>;
  const saved: BridgeByokView["saved"] = {
    links: savedFlag(u, "links"),
    llm: savedFlag(u, "llm"),
    giphy: savedFlag(u, "giphy"),
    fish: savedFlag(u, "fish"),
    herenow: savedFlag(u, "herenow"),
    renderer: savedFlag(u, "renderer"),
  };
  const mp4 = (payload as { mp4?: unknown }).mp4;
  const quote =
    typeof mp4 === "object" && mp4 !== null ? (mp4 as { creditsIfRenderedNow?: unknown }).creditsIfRenderedNow : undefined;
  return {
    anySaved: SAVED_KEYS.some((k) => saved[k]),
    saved,
    ownWorker: saved.renderer,
    mp4QuoteCredits: typeof quote === "number" ? quote : null,
  };
}

/** Display names for the saved unlocks, in save-flow order. */
export const BYOK_SAVED_LABELS: Record<SavedKey, string> = {
  links: "offer links",
  llm: "LLM key",
  giphy: "Giphy key",
  fish: "Fish Audio key",
  herenow: "here.now key",
  renderer: "render worker",
};

export interface CreditsDisplay {
  /** True when the member runs on their own saved keys. */
  byok: boolean;
  /** "Your balance · BYOK" for BYOK members, plain "Balance" otherwise. */
  balanceLabel: string;
  /** Human list of what is saved, e.g. ["LLM key", "render worker"]. */
  savedLabels: string[];
  /**
   * The member's own LLM key is saved — the engine's BYOK pricing path
   * (1 credit per generation call) keys off this save specifically, so
   * the page may only claim that rate when it is true.
   */
  llmSaved: boolean;
  ownWorker: boolean;
  mp4QuoteCredits: number | null;
}

/**
 * Derive the /muse-week credits-card presentation from the account
 * view. BYOK members (anySaved) get their live balance under a BYOK
 * marker; everyone else keeps the allowance presentation untouched —
 * for them the monthly grant IS the balance, so it stays honest.
 */
export function deriveCreditsDisplay(account: { byok: BridgeByokView | null }): CreditsDisplay {
  const byok = account.byok;
  if (!byok || !byok.anySaved) {
    return { byok: false, balanceLabel: "Balance", savedLabels: [], llmSaved: false, ownWorker: false, mp4QuoteCredits: null };
  }
  return {
    byok: true,
    balanceLabel: "Your balance · BYOK",
    savedLabels: SAVED_KEYS.filter((k) => byok.saved[k]).map((k) => BYOK_SAVED_LABELS[k]),
    llmSaved: byok.saved.llm,
    ownWorker: byok.ownWorker,
    mp4QuoteCredits: byok.mp4QuoteCredits,
  };
}
