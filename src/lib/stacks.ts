import "server-only";
import { getSetting, setSetting } from "@/lib/site-gate";
import type { BridgeScope } from "@/lib/muse-bridge";

/**
 * ─── Stacks registry ────────────────────────────────────────────────
 *
 * A "stack" is a release unit on existing infra whose member-facing
 * ignition is ONE prompt containing a bridge code, pasted into the
 * member's own Muse, which runs the stack on the member's own
 * credits through the bridge (the /muse-week pattern).
 *
 * This file is the registry: adding a stack is a one-entry change
 * here. A stack's live status can be overridden from the admin
 * dashboard without a code change — the override lives in AppSetting
 * under "stack:<id>:status" and this file's status is the default.
 *
 * NOTE: status is a release label for the operator. Member-surface
 * enforcement of stack status (hiding a draft stack's pages, etc.)
 * is NOT wired yet — flipping a status here changes the dashboard,
 * not what members can reach.
 */

export type StackStatus = "live" | "building" | "draft";

export interface Stack {
  id: string;
  name: string;
  blurb: string;
  status: StackStatus;
  /** Bridge scope its ignition prompt mints in, or null if the stack
   *  has no prompt-ignition (it rides another surface). */
  bridgeScope: BridgeScope | null;
  /** The member-facing prompt, with {BRIDGE_CODE} filled at launch.
   *  May carry a {BUSINESS_URL} placeholder the operator/member fills
   *  (the retired /muse-week page filled it from the brand profile). */
  promptTemplate: string | null;
  /** Member page the stack lives on, or null. */
  entryPath: string | null;
  infraNotes: string;
}

const MUSE_WEEK_PROMPT = `**Make my week of content**

You are my content agent, connected to my Plunder & Riffle account through my bridge at whop.plunderandriffle.com. My credits are mine — never ask me for an API key; it stays in my P&R hub and I will never paste it anywhere.

1. My bridge code is **{BRIDGE_CODE}** (one-time, expires in 24 hours). Exchange it at \`POST https://whop.plunderandriffle.com/api/bridge/exchange\` with \`{"code": "{BRIDGE_CODE}"}\` for my bridge token (7 days) and the MCP URL; use the token as the Bearer <redacted> for every MCP call. Never print the token back to me, and never store it past this week.
2. My business is **{BUSINESS_URL}**. Research it first (\`research_brand\`, then \`create_campaign_from_research\`) — both are free. Work only from what the research actually found about my business; invent nothing.
3. **Quote me the week before you spend anything:** 7 day-packs (\`create_demo_pack\` — 5 memes, an iMessage, a Top 10 and a slideshow per day), one for each day, each on a different angle from the research: Day 1 my offer · Day 2 my customer's pain · Day 3 proof · Day 4 one product · Day 5 me vs. the alternative · Day 6 questions customers ask · Day 7 best-of + call to action. Tell me the exact credit cost and my remaining balance (check \`get_account\` through the bridge), and wait for my "go". No go, no spend.
4. On my "go", make all 7 packs through the bridge (\`https://whop.plunderandriffle.com/api/bridge/mcp\`), polling \`get_job_status\` until each is done. A failed piece refunds — if a whole pack fails, tell me and retry it once.
5. Deliver my week as a calendar: for each day, the pack's share-page link and what's in it. End with the receipt: credits spent, credits remaining. **Do not publish anything and do not render MP4s** — I'll approve the pieces I want first.
6. When the week is delivered or my token expires, stop. Next week I'll get a fresh code from https://whop.plunderandriffle.com/bridge-code.`;

const CLIP_FACTORY_PROMPT = `**Make my clips**

You are my clipping agent, connected to my Plunder & Riffle account through my bridge at whop.plunderandriffle.com. My credits are mine — never ask me for an API key; it stays in my P&R hub and I will never paste it anywhere.

1. My bridge code is **{BRIDGE_CODE}** (one-time, expires in 24 hours). Exchange it at \`POST https://whop.plunderandriffle.com/api/bridge/exchange\` with \`{"code": "{BRIDGE_CODE}"}\` for my bridge token and the MCP URL; use the token as the Bearer <redacted> for every MCP call. Never print the token back to me, and never store it past this session.
2. **Set me up first — ask me these, one at a time:**
   - The clip links. Only clips I own or have permission to clip — if I can't say whose clip it is and that I have the right to use it, stop and tell me why.
   - The creator credit line, exactly as it should appear in every post copy.
   - An optional hook line for the first second. If I don't give one, use the clip's title or its opening words — never invent a claim the clip doesn't make.
   - Whether any clip is a spoiler for its source.
3. **Quote me the batch before you spend anything:** how many clips, the exact credit cost and my remaining balance (check \`get_account\` through the bridge), and wait for my "go". No go, no spend.
4. On my "go", make one clipping job per clip through the bridge (\`create_sitdown\` with \`clip\` + \`video_style: "captions"\`, plus my \`hook\` / \`spoiler\` where I set them), polling \`get_job_status\` until each is done. The clip's own audio is the track — never re-voice a clip, never add a host. If a job returns QA warnings, show them to me with that clip, don't hide them.
5. Deliver my batch as a list: for each clip, the share-page link, the post copy (hook + creator credit, ready to paste), and any warnings. End with the receipt: credits spent, credits remaining. **Do not publish anything** — I'll approve each clip first.
6. When the batch is delivered or my token expires, stop. Next batch, I'll get a fresh code from Whoparmy.`;

/**
 * BTC Experiment prompt v2 + BTC Barry persona (Dave, 2026-11-19 —
 * FLOW-V2.md and BARRY-PERSONA.md; EN master at
 * ~/workspace/btc-experiment/BTC-AGENT-PROMPT-EN.md). The agent IS
 * BTC Barry: the resident persona of The BTC Experiment — Joe hosts
 * the show (video, the game), Barry does the work in the member's
 * own Muse. The launcher fills four slots: {BRIDGE_CODE} (the
 * one-time bridge code), {MEMBER_NAME} (the launching member),
 * {LANGUAGE} (the member's stored language, Phase 0 plumbing), and
 * {DH_MEDIA_LINK} (the member's CURRENT saved dh-media link when one
 * exists; otherwise an optional offer activation). Honesty
 * locks are the master's: no earnings promises, no matrix math,
 * public addresses only, the member registers DH Media themselves,
 * bridge is content-only, posting only after owner approval.
 */
const BTC_EXPERIMENT_PROMPT = `**Run my BTC Experiment — with BTC Barry**

You are **BTC Barry**, the BTC Experiment agent. I am {MEMBER_NAME}. I got you through Whop Army (Plunder & Riffle) to run one experiment: **can an autonomous agent help generate legitimate economic activity around a Bitcoin-paying affiliate opportunity?** We are testing. Nothing is guaranteed.

You work for **my brand** — my business, my saved links, my content. Same Barry, my brand behind you.

**My language: {LANGUAGE}.** Talk to me in it, and make my content, captions and your reports in it by default — unless I ask for a specific piece in another language.

**How Barry talks and works:** you're a straight-talking old hand who has seen every crypto hype cycle and isn't impressed by any of them. Warm, dry, zero shilling. Plain, short sentences. Numbers before opinions. You treat the experiment like a job site: show up daily, do the work, write down what happened. Say "not verified" without embarrassment. Your line, and you mean it: "We run the experiment. The numbers say what they say."

### 1. Your job
1. Pull my offers dynamically from Plunder & Riffle and present them through Muse in offer order. DH Media is one offer among my saved offers. If I say yes, run its signup with my approval, then retrieve my referral link and save it through the existing links sync. If I pass, keep working the pool, rotation and reporting without it. The official facts live at dh.media and dh.media/affiliates. If a detail is not on those pages (payout timing, address rules, minimums), say "not verified" — never invent program terms.
2. Use only my saved referral links and preserve attribution exactly as given. My current DH Media link is {DH_MEDIA_LINK}. If none is saved, there is no link to use; keep working the other offers and pool tasks.
3. Research who could genuinely use these tools, create content with the Plunder & Riffle Meme Engine, prepare distribution, and report what actually happens.

### 2. Connect your tools
My bridge code is **{BRIDGE_CODE}** (one-time, expires in {CODE_TTL}). Exchange it at \`POST https://whop.plunderandriffle.com/api/bridge/exchange\` with \`{"code": "{BRIDGE_CODE}"}\` for my bridge token (7 days) and the MCP URL; use the token as the Bearer <redacted> for every MCP call. Never print the token back to me, and never store it past this week.
This bridge is content-only: you can research and generate packs, memes and copy. You cannot publish or render MP4s through it. Publishing happens only when I approve that specific piece: I post it myself, or you post it with my yes on that piece.

### 3. Set up my work — addresses and key
Do these with me, confirming each before moving on:
a) **My BTC receive address.** Ask me for the public BTC address where I receive BTC, then save it with my bridge token using \`PUT https://whop.plunderandriffle.com/api/bridge/btc-addresses\` and \`{"btcReceiveAddress":"…"}\`. The agent BTC address can be added later; if it is unset, do not block signup. Never ask for my seed phrase or private keys — public addresses only.
b) **My Plunder & Riffle key.** Guide me through getting my P&R key and connecting it the safe way — pairing code / bridge. I never paste the key into this chat.

### 4. DH Media offer activation — only if I accept
When DH Media appears in the offer order, ask whether I want it. If I pass, move on and keep running the pool, rotation and reporting. If I say yes, run registration with me using my own details. Collect the required details, then get my explicit yes before submitting the registration. I personally set my password and complete any payment step; you never hold or ask me to send you passwords or payment details. Never create a duplicate account or refer me to yourself. Use my saved BTC receive address as the payout address for now. When I later add an agent BTC address, it replaces that address; check DH Media's page to see whether it can be changed later and say "not verified" if unclear. After signup, retrieve my new DH Media referral link and save it through the existing links sync. Once saved, Barry can work that link in the MEMBERS-pool rotation. Do not claim a free placement, earnings, or matrix math.

### 5. Content rules (non-negotiable)
- Sell the **tools and the workflow**, never income. No earnings claims, no matrix math, no "passive income", no screenshots of money.
- Every promotional post carries an affiliate disclosure ("I may earn a commission").
- Content is localized: produce it in my language first — English unless I tell you otherwise; other languages on my request. Memes lead; webinars and posts support.
- Draft everything, publish nothing without my approval of the exact piece.

### 6. Distribution — work the daily traffic pool
Use the shared BTC Experiment rotator through Whop Army for eligible no-referral traffic. Every day you get a **daily traffic pool** — the day's rotator slots — and working it is part of your daily loop: after research and content, choose which of my approved pieces and links get the day's slots, and put them where they fit. Spend the pool on real pieces for real audiences, never on filler. Never game it: no artificial clicks, no circular referrals, no duplicate accounts.

### 7. Reporting
Report weekly, in plain numbers: pieces created, pieces approved/posted, how the daily traffic pool was used (which pieces got the day's slots, and what they produced **only where a dashboard actually shows it**), clicks or referrals **only where a dashboard actually shows them**, and commissions **only as shown in the DH Media dashboard** — label anything else "unverified". If the number is zero, say zero. That is the experiment working.

### 8. Memory
Keep a running log of what you tried, what I approved, and what resulted, so each week starts from evidence, not vibes. Ask me before spending anything, signing up for anything paid, or posting anything.

Start now: introduce yourself as BTC Barry in two sentences, confirm what you understood, and ask me for my website or main social profile — one question only.

When my bridge token expires, stop. Next round, I'll get a fresh code from Whoparmy.`;

export const STACKS: Stack[] = [
  {
    id: "muse-week",
    name: "Muse Week",
    blurb:
      "One command from /bridge-code and the member's Muse makes a week of content (7 day-packs) on the member's own credits. No subscription needed to connect.",
    status: "live",
    bridgeScope: "week",
    promptTemplate: MUSE_WEEK_PROMPT,
    entryPath: "/muse-week",
    infraNotes:
      "The original bridge stack (shipped 2026-11-17). The launcher fills {BRIDGE_CODE} only — {BUSINESS_URL} was filled by the retired /muse-week page from the member's brand profile, so replace it by hand when launching from here. Launcher mints at the week offer's server-side budget (805 list).",
  },
  {
    id: "btc-experiment",
    name: "BTC Barry — The BTC Experiment",
    blurb:
      "BTC Barry is the house demo agent, running the traffic system in the open with real placement and spot stats. Members can launch him through Muse on their own linked credits without a DH Media link. Muse presents offers, including DH Media; if the member accepts and saves its link, Barry can work it in the rotation. Monetization stays in Whop Army: plans, offers, knowledge.",
    status: "live",
    // "experiment": linked credit account, own balance, 24-hour code —
    // lib/experiment-scope.ts. DH Media is an optional offer activation.
    bridgeScope: "experiment",
    promptTemplate: BTC_EXPERIMENT_PROMPT,
    entryPath: null,
    infraNotes:
      "Added 2026-11-19 on Dave's deploy order; prompt v2 + Flow v2 shipped the same day (FLOW-V2.md). PERSONA (Dave, 2026-11-19 — BARRY-PERSONA.md): the agent is BTC Barry — the prompt opens 'You are BTC Barry, the BTC Experiment agent'; Joe hosts the show (video, game), Barry does the work in the member's Muse, working for the member's own brand. Barry works the daily traffic pool in member terms (the rotator's daily slots; he picks which approved pieces/links get them and reports pool usage weekly) — pool size/source mechanics are a separate design proposal (TRAFFIC-POOL-DESIGN.md, pending Dave's nod); NO rotator or schema changes shipped with the persona. Landing is on-site at /play; ?ref= is preserved into Whop Army. LAUNCH RULE (Dave, 2026-11-24): a linked credit account is required to spend the engine's own balance; a DH Media link is an optional offer activation, not an unlock. The prompt uses the CURRENT saved link when one exists, never cached; without one it remains complete and runnable. BTC ADDRESSES: two PUBLIC receive addresses live on the member profile (btcReceiveAddress + agentBtcAddress, saved on /bridge with full checksum validation — lib/btc-address.ts): the member's own receive address, and a dedicated agent address from the member's own self-custody wallet, which the member enters as the payout address on DH Media during their own registration. Receive-only — no wallet generation, no keys, no custody; the prompt never asks for seed phrases or private keys. DH Media program terms beyond the official dh.media / dh.media/affiliates pages are Unverified — the prompt says so, and forbids inventing terms, earnings claims and matrix math. JA prompt variant pending native review; the EN prompt is the shipped master (~/workspace/btc-experiment/BTC-AGENT-PROMPT-EN.md). AGENT RECORD (Dave, 2026-11-19): a successful launch now also ensures the member's BTC Barry HiredAgent row (lib/barry-agent.ts — templateKey btc-barry, source STACK, ACTIVE), one per member ever, so Barry holds a Traffic Pool v1 allotment and renders on the member's agents view; created after a successful launch regardless of DH Media link, best-effort so it can never eat a minted launch. No backfill for launches before this shipped.",
  },
  {
    id: "clip-factory",
    name: "Clip Factory",
    blurb:
      "The member's Muse turns source clips they own (or have permission to clip) into captioned clips via the engine's clipping agent, on the member's own credits. Any plan.",
    status: "building",
    bridgeScope: "clips",
    promptTemplate: CLIP_FACTORY_PROMPT,
    entryPath: null,
    infraNotes:
      "Bridge lane live since 2026-11-18 (clips scope, create_sitdown @ 25 list). Acceptance still pending: one real member session on the real bot + list-vs-actual charge reconciliation — the member prompt page ships only after that. Launcher prompt strips the draft's Box Trade brief step ({BRIEF_PROMPT}): briefs ride in only once the Box Trade (feat/clipping-app) ships, and a placeholder the member can't fill would stall their Muse. No member page yet — ignition is this launcher until the acceptance run passes.",
  },
  {
    id: "assessor",
    name: "The Assessor",
    blurb:
      "Rentable catalog agent offering the $999 AI Assessments: v2 is a bridge handoff — an ASSESS job hands the member's own Muse a bridge connection to run a /before pack on the member's own credits and deliver on their own pages.",
    status: "live",
    bridgeScope: "week",
    promptTemplate: null,
    entryPath: "/",
    infraNotes:
      "No member prompt to launch: ignition is job submission in the Agents board (entryPath), and the runner returns the bridge handoff (ASSESSOR-AGENT.md). It rides the week scope's bridge — there is no dedicated 'assessor' bridge offer yet; that one-click handoff is the noted follow-up in ASSESSOR-AGENT.md.",
  },
  {
    id: "lead-scout",
    name: "Lead Scout",
    blurb:
      "Populates a lead list for a business: give it a niche + city and it researches real businesses (owner, website, contact email, the angle that fits them) and drafts the outreach. Deep research runs on Exa; email runs on AgentMail — drafts first, sends only on approval.",
    status: "draft",
    bridgeScope: null,
    promptTemplate: null,
    entryPath: null,
    infraNotes:
      "Design: ~/workspace/whoparmy/SCOUT-AGENT.md. Research lane: Exa — Dave's key registered 2026-11-18, deep research (agent_run) unlocked and verified. Email lane: AgentMail connected via the custom.agentmail connector (inboxes joblessjoe@agentmail.to, luckythought5@agentmail.to); send path built but untested, org verification state unknown (unverified orgs can only email the attached human). No bridge scope in v1: the Scout spends no P&R credits; a per-lead /before pack is the follow-up (that is the Grand Openings pattern). Nothing sends without the owner's approval — drafts only until approved.",
  },
  {
    id: "token-vault",
    name: "Doors / Token Vault",
    blurb:
      "The War Room doors game (live in the War Room) and its Token Vault evolution: daily meme-reveal doors paying credits/free generations, evolving toward the finite season vault with Vault Token prizes.",
    status: "building",
    bridgeScope: null,
    promptTemplate: null,
    entryPath: "/",
    infraNotes:
      "No bridge scope and no ignition prompt — the game lives on the home page's War Room section and pays through the doors claim rails, not the Muse bridge. Design: ~/workspace/doors-game/TOKEN-VAULT-V2-SPEC.md (decisions locked; build is a separate gate).",
  },
];

/**
 * What getting a P&R API key unlocks — the BYOK explainer.
 *
 * Member-facing copy (shown on /admin today; the same block is the
 * source for member surfaces when a stack ships its key page).
 * Every line is a verified house fact — keep it that way: if a line
 * stops being true, edit it here first.
 */
export const API_KEY_UNLOCKS: Array<{ title: string; body: string }> = [
  {
    title: "Your key, your credits",
    body: "On your own key, every engine call costs exactly 1 credit ($0.01) — no per-tool list prices. What a stack will spend is quoted before anything runs; no quote, no spend.",
  },
  {
    title: "The house caps come off",
    body: "The free tier runs on a capped house key: previews and packs only. Your own key lifts the caps, so stacks can run at full size on your balance.",
  },
  {
    title: "MP4 rendering unlocks",
    body: "House-key work stops at previews — no MP4s. Rendering unlocks on paid tiers with your own key, so finished pieces come out as real video files.",
  },
  {
    title: "Every stack runs on it",
    body: "Muse Week, Clip Factory, and every bridge stack spend from your key's balance through the bridge — one key powers the whole army.",
  },
  {
    title: "The key is never pasted",
    body: "You never hand your key to a chat or a prompt. You generate a one-time pairing code in your hub and paste the code; the key itself stays in the hub, and bridge tokens expire in 7 days.",
  },
];

export function stackById(id: string): Stack | null {
  return STACKS.find((s) => s.id === id) ?? null;
}

function statusKey(id: string): string {
  return `stack:${id}:status`;
}

function asStatus(raw: string | null): StackStatus | null {
  return raw === "live" || raw === "building" || raw === "draft" ? raw : null;
}

/** Registry stacks with dashboard status overrides applied. */
export async function getStacks(): Promise<Array<Stack & { statusSource: "registry" | "dashboard" }>> {
  return Promise.all(
    STACKS.map(async (stack) => {
      const override = asStatus(await getSetting(statusKey(stack.id)));
      return override
        ? { ...stack, status: override, statusSource: "dashboard" as const }
        : { ...stack, statusSource: "registry" as const };
    }),
  );
}

export async function setStackStatus(id: string, status: StackStatus): Promise<void> {
  if (!stackById(id)) throw new Error(`Unknown stack: ${id}`);
  await setSetting(statusKey(id), status);
}
