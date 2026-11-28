/**
 * ─── THE ONE COMMAND (single source) ────────────────────────────────
 * The paste a member drops into their Muse to connect it to their
 * Plunder & Riffle account through the bridge. Three surfaces render
 * this exact text: the /connect briefs and Ralph chat (mint-on-the-spot,
 * Dave 2026-11-18). The /muse-week page surface retired 2026-11-28.
 * Change it here and update the doc — never fork the wording.
 *
 * The token the code issues is CONTENT-ONLY by Dave's decision
 * (2026-11-18): it makes packs and reads the account; publishing is
 * refused at the bridge, and posting happens only after the member's
 * in-app approve tap. The command text says so to the member's Muse.
 */

import { languageLabel } from "@/lib/languages";

export type MuseWeekOfferId = "taste" | "week" | "opener";

export interface SavedOfferLink {
  name: string;
  url: string;
}

/**
 * The member's saved offer links, rendered for an agent brief
 * (Dave, 2026-11-19: links saved on whop.plunderandriffle.com
 * bridge over to P&R with the member). The agent promotes with
 * THESE links, exactly as written — never a house link. Empty
 * string when the member has saved none, so briefs stay lean.
 */
export function savedLinksBrief(links: SavedOfferLink[]): string {
  const rows = links.filter((l) => l.url.trim());
  if (!rows.length) return "";
  return [
    "MY SAVED OFFER LINKS — when you promote any of these offers, use MY link exactly as written, never the house link or a guessed one:",
    ...rows.map((l) => `- ${l.name}: ${l.url}`),
  ].join("\n");
}

export function museWeekCommand(code: string, businessUrl: string, budget: number, offer: MuseWeekOfferId, languageCode?: string): string {
  // Member language (Phase 0, Dave 2026-11-19): when the member's
  // language is not English, the command tells their agent to make
  // content in it by default. English members see the exact text
  // they always have.
  const languageLine =
    languageCode && languageCode !== "en"
      ? `\n\nContent language: make my content in ${languageLabel(languageCode)} by default — captions, meme text, scripts and audio briefs — unless I ask for another language for a specific piece. Talk to me in ${languageLabel(languageCode)} too.`
      : "";
  const intro = `You are my content agent, connected to my Plunder & Riffle account through my bridge at whop.plunderandriffle.com. My credits are mine — never ask me for an API key; it stays on the engine side and I will never paste it anywhere.

1. My bridge code is ${code} (one-time, expires in 24 hours). Exchange it: POST https://whop.plunderandriffle.com/api/bridge/exchange with {"code": "${code}"}. You get a bridge token (7 days) and the MCP URL. Use the token as the Bearer credential for every MCP call. Never print the token back to me, and never store it past this week.
2. My business is ${businessUrl}. Research it first through the bridge MCP (research_brand, then create_campaign_from_research) — both are free. Work only from what the research actually found about my business; invent nothing.${languageLine}`;

  if (offer === "taste") {
    return `Make my /before — The Taste

${intro}
3. Quote me the Taste before you spend anything: my /before (create_before_pitch — Joe's video about my business, then the phones: two memes, a reply meme, an iMessage and a Top 10) built from the research, for my main offer. The Taste is approved for up to ${budget} credits. Tell me the exact credit cost and my remaining balance (get_account through the bridge), and wait for my "go". No go, no spend.
4. On my "go", write Joe's words first, from the research only: a short script for the video at the top of my /before — Joe introducing what he made for my business, conversational, first person, one sentence per line, about 100 words and under 800 characters, only facts the research actually found, no promises about views, sales or growth, ending by pointing at the pieces below the video. Then make the /before through the bridge MCP, passing the script as script to create_before_pitch, polling get_job_status until it's done. A failed piece refunds — if the whole pack fails, tell me and retry it once.
5. Deliver the /before's share-page link, what's in it, and the script you wrote for Joe's video. End with the receipt: credits spent, credits remaining. Do not publish anything and do not render MP4s — I'll approve the pieces I want first.
6. When the Taste is delivered or my token expires, stop. Next time I'll get a fresh code from https://whop.plunderandriffle.com/bridge-code.`;
  }

  if (offer === "opener") {
    return `Make my week of content — plus my Opener

${intro}
3. First, my Opener: quote me create_before_pitch for my business (my /before — Joe's video about my business, plus two memes, a reply meme, an iMessage and a Top 10), then the week below. The whole order — Opener plus the week — is approved for up to ${budget} credits. Tell me the exact credit cost and my remaining balance (get_account through the bridge), and wait for my "go". No go, no spend.
4. On my "go", make the Opener first, then all 7 day-packs (create_demo_pack — 5 memes, an iMessage, a Top 10 and a slideshow per day), one for each day, each on a different angle from the research: Day 1 my offer · Day 2 my customer's pain · Day 3 proof · Day 4 one product · Day 5 me vs. the alternative · Day 6 questions customers ask · Day 7 best-of + call to action. Poll get_job_status until each is done. A failed piece refunds — if a whole pack fails, tell me and retry it once.
5. Deliver my Opener's link first, then my week as a calendar: for each day, the pack's share-page link and what's in it. End with the receipt: credits spent, credits remaining. Do not publish anything and do not render MP4s — I'll approve the pieces I want first.
6. When the week is delivered or my token expires, stop. Next week I'll get a fresh code from https://whop.plunderandriffle.com/bridge-code.`;
  }

  return `Connect to my Plunder & Riffle account and make my content

${intro}
3. Quote me my options before you spend anything — the exact credit cost and my remaining balance (get_account through the bridge) for each: The Taste — my /before (create_before_pitch: Joe's video about my business, plus two memes, a reply meme, an iMessage and a Top 10) on my main offer, about 50 credits. The Week — 7 day-packs, one per day, each on a different angle from the research: Day 1 my offer · Day 2 my customer's pain · Day 3 proof · Day 4 one product · Day 5 me vs. the alternative · Day 6 questions customers ask · Day 7 best-of + call to action, about ${budget} credits. This connection is capped at ${budget} credits. Wait for my pick and my "go". No go, no spend.
4. On my "go", make what I picked through the bridge MCP, polling get_job_status until it's done. A failed piece refunds — if a whole pack fails, tell me and retry it once.
5. Deliver each pack's share-page link and what's in it — a week as a calendar, day by day. End with the receipt: credits spent, credits remaining. Do not publish anything and do not render MP4s — I'll approve the pieces I want first.
6. When the work is delivered or my token expires, stop. Next time I'll get a fresh code from https://whop.plunderandriffle.com/bridge-code.`;
}
