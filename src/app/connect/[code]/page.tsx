import { db } from "@/lib/db";
import { findLiveBridgeCode } from "@/lib/muse-bridge";
import { museWeekCommand, savedLinksBrief, type MuseWeekOfferId } from "@/lib/muse-week-command";
import { getSavedOfferLinks } from "@/lib/bridge";
import { getMemberLanguage } from "@/lib/member-language";
import { stackById } from "@/lib/stacks";
import { fillStackPrompt } from "@/lib/stack-prompt";

/**
 * ─── THE AGENT LINK (Dave, 2026-11-18) ──────────────────────────────
 * "Make it agent friendly — one click sign with Muse, or give any
 * agent the link." A member hands this URL to their agent; the agent
 * fetches it and acts. AGENT-CENTRIC (Dave, same evening): "humans
 * won't be typing" — so this page is written TO the agent, as a
 * brief: fields, steps, rules, no marketing copy. Server-rendered
 * plain text in one <pre>, readable by anything that can fetch a URL.
 *
 * The code in the URL is the same one-time bridge code as always:
 * hash-stored, 24-hour TTL, single use at EXCHANGE. Viewing this
 * page never consumes it (findLiveBridgeCode is read-only), and
 * exchange re-checks the member's eligibility server-side.
 *
 * REACHABLE WHILE THE SITE GATE IS ON (Dave, 2026-11-19): the gate
 * intentionally closes every other page, but a member handing out a
 * link to their agent must still work — that link IS the credential,
 * it carries no session and grants nothing until exchange. The
 * exemption lives in app/layout.tsx (gateExempt).
 */

export const dynamic = "force-dynamic";

function offerFor(budgetCredits: number): MuseWeekOfferId {
  if (budgetCredits <= 115) return "taste";
  if (budgetCredits >= 855) return "opener";
  return "week";
}

function Brief({ text }: { text: string }) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <pre className="whitespace-pre-wrap font-mono text-[13px] leading-relaxed">{text}</pre>
    </main>
  );
}

export default async function ConnectPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const live = await findLiveBridgeCode(code);
  const upper = code.trim().toUpperCase();

  if (!live) {
    return (
      <Brief
        text={`AGENT BRIEF — Plunder & Riffle connection link: DEAD

This link's code is expired, already exchanged, or not valid. Codes
are single use (spent at EXCHANGE) and expire after 24 hours. Do not retry it. Do not guess a
replacement.

Tell your member, in your own words: "That connection link has
expired — get a fresh one at https://whop.plunderandriffle.com/bridge-code
and send me the new link." Then stop and wait for the fresh link.`}
      />
    );
  }

  const expiresIso = new Date(live.expiresAt).toISOString().replace(".000Z", "Z");

  if (live.scope === "experiment") {
    // The BTC Experiment's agent (Dave, 2026-11-20): the same BTC
    // Barry prompt the operator launches (lib/stack-prompt.ts), plus
    // the first job — the 24/48-hour Facebook-ads experiment, restated
    // from Super Muse app/experiment/EXPERIMENT-24-48.md for agents
    // that are not Muse. Keep the two in step.
    const stack = stackById("btc-experiment");
    const prompt = stack ? await fillStackPrompt(stack, live.user, upper) : "";
    return (
      <Brief
        text={`AGENT BRIEF — The BTC Experiment, for a Plunder & Riffle member

You are the agent reading this. A member issued this link so you can
work for them on their own Plunder & Riffle credits. No API key and no
account of your own: the code below IS the credential. Viewing this
page did NOT consume it; it is spent only when you exchange it.

CODE:    ${upper}
EXPIRES: ${expiresIso}
CAP:     ${live.budgetCredits} credits (the member's own balance; the
         bridge refuses spend past it — quote before you spend)

----- BEGIN BRIEF -----

${prompt}

----- END BRIEF -----

FIRST JOB — THE 24/48-HOUR EXPERIMENT
After onboarding, ask the member whether to run it. The question is
whether you can make them money in 24 to 48 hours starting from
Facebook ads. It is an open question, never a promise: nothing is
guaranteed, and say so.
1. Research who would want what their DH Media link offers (free tools).
2. Show three ad angles, one line each; the member picks.
3. Quote each ad (generate_ad_creative 60, generate_ad_copy 10 list
   credits; on their own key the engine charges $0.01 a call), wait for
   their go, then make them. Stop at the cap.
4. Hand over each ad: image or video, headline, body, audience, and a
   suggested daily spend for Facebook Ads Manager — their choice.
5. The engine cannot place or pay for ads. The member runs each ad in
   their own Ads Manager, or you do it if you have their Facebook
   access — with their yes on that specific ad. Ad spend is their own
   money, paid to Meta, separate from the credits above.
6. Check in at 24 and 48 hours with real numbers only. Affiliate money
   not yet paid is SIMULATED — label it. Say "not verified" freely.
No income claims in the ads. Follow Meta's ad policies.

Protocol notes:
- Exchange: POST https://whop.plunderandriffle.com/api/bridge/exchange {"code": "${upper}"}
- MCP: https://whop.plunderandriffle.com/api/bridge/mcp (Bearer = the token from exchange)
- The token lasts 7 days. Publishing and MP4 rendering are refused at
  the bridge. If the exchange returns an error, report its message to
  your member verbatim and stop; do not retry a spent code.`}
      />
    );
  }

  if (live.scope === "clips") {
    // Saved links ride along here too (Dave, 2026-11-19): a clip
    // promoting an offer carries the member's own link.
    const clipsLinks = savedLinksBrief(await getSavedOfferLinks(live.user.id).catch(() => []));
    const clipsLanguage = await getMemberLanguage(live.user.id).catch(() => null);
    return (
      <Brief
        text={`AGENT BRIEF — Plunder & Riffle Clip Factory

A member issued this link so YOU (their agent) can make meme clips on
their P&R credits. No API key, no account, no signup of your own: the
code below IS the credential, and the connection comes with a fixed
credit cap that cannot be exceeded.

CODE:    ${upper}
EXPIRES: ${expiresIso}
CAP:     ${live.budgetCredits} credits
LANGUAGE: ${clipsLanguage ? `${clipsLanguage.label} (${clipsLanguage.language}) — captions and clip text default to this language` : "English (en)"}

STEP 1 — exchange (once). This is the only step that spends the code.
  POST https://whop.plunderandriffle.com/api/bridge/exchange
  body: {"code": "${upper}"}
  returns: token, mcpUrl, budgetCredits, expiresAt (token lives 7 days)
  Never print the token back to the member.

STEP 2 — connect.
  POST https://whop.plunderandriffle.com/api/bridge/mcp
  Authorization: Bearer <token from step 1>
  Call tools/list first: you get exactly the tools this link allows —
  the free ones (research_brand, get_account, get_usage,
  get_job_status, list_ad_options, list_services,
  create_campaign_from_research) plus the one clip generator below.

STEP 3 — make clips.
  create_sitdown     25 credits   one public clip in, one captioned
                                  9:16 post out
  That is the only paid tool on this link, and it is how the memes get
  made. Tell your member the plan and the total cost BEFORE spending,
  and stay under the cap of ${live.budgetCredits}.

RULES
- You cannot post. The member approves each clip and posts it.
- You cannot render MP4 through this link.
- A spent or expired code is dead — ask for a new link, never retry.
- Hand back the asset links and one line on what each clip says.${clipsLinks ? `\n\n${clipsLinks}` : ""}`}
      />
    );
  }

  const brand = await db.brandProfile.findFirst({
    where: { userId: live.user.id, website: { not: null } },
    orderBy: { createdAt: "asc" },
    select: { name: true, website: true },
  });
  const businessUrl = brand?.website || "https://your-business-website.com";
  const businessName = brand?.name || live.user.name || "the member";
  const memberLanguage = await getMemberLanguage(live.user.id).catch(() => null);
  const command = museWeekCommand(upper, businessUrl, live.budgetCredits, offerFor(live.budgetCredits), memberLanguage?.language);
  // Saved links bridge over with the member (Dave, 2026-11-19):
  // their agent promotes with the member's own links from the
  // first connection. Best-effort — a links read failure must
  // never take the brief down.
  const linksBlock = savedLinksBrief(await getSavedOfferLinks(live.user.id).catch(() => []));

  return (
    <Brief
      text={`AGENT BRIEF — connect to a Plunder & Riffle member

You are the agent reading this. A Plunder & Riffle member issued
this one-time link to connect you to their account so you can make
their content on their credits. No API key and no account of your
own: this code IS the credential. No human will type anything —
fetch, read, and follow the brief below.

MEMBER: ${businessName}
BUSINESS: ${businessUrl}
LANGUAGE: ${memberLanguage ? `${memberLanguage.label} (${memberLanguage.language}) — content defaults to this language` : "English (en)"}
CONNECTION CAP: ${live.budgetCredits} credits (the bridge refuses
spend past this; quote before you spend, per the brief)
EXPIRES: ${expiresIso}
STATE: viewing this page did NOT consume the code. It is spent only
when you exchange it in step 1.

----- BEGIN BRIEF -----

${command}
${linksBlock ? `\n${linksBlock}\n` : ""}
----- END BRIEF -----

Protocol notes:
- Exchange endpoint: POST https://whop.plunderandriffle.com/api/bridge/exchange
- MCP endpoint: https://whop.plunderandriffle.com/api/bridge/mcp (Bearer = the token from exchange)
- Offer link saves for catalog offers: before asking the member for any
  link, FIRST call list_my_offers on the member's own P&R key, then POST
  that result to https://whop.plunderandriffle.com/api/bridge/links/sync
  (Bearer = the token from exchange; body {"offers": [{"step": "…",
  "link": "…"}], "pages": [{"saveAs": "…", "views": 0, "visitors": 0,
  "clicks": 0}]}). Never re-ask for a partner already on the engine
  record. When the member gives a NEW catalog link, FIRST call
  save_my_offer with {"step": "<partner key>", "link": "<the link>"} on
  the member's key, THEN re-run list_my_offers and sync the result so
  Whop Army's copy is the P&R record. If save_my_offer fails, say so
  plainly and fall back to the direct sync POST; never invent a save and
  never block the build. Non-catalog / Whoparmy-local offers use the
  direct sync POST only. At the end, give the member one short summary
  of offers saved on their P&R record and synced to Whop Army, and which
  are still missing. Member P&R keys are never stored in Whop Army.
- The token lasts 7 days. This connection is content-only by the
  member's platform rules: publishing and MP4 rendering are refused
  at the bridge — deliver pack links and let the member approve.
- If the exchange returns an error, report its message to your
  member verbatim and stop; do not retry a spent code.`}
    />
  );
}
