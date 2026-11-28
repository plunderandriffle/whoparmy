import { db } from "@/lib/db";
import { AGENT_CATALOG } from "@/lib/agents";
import { getPlan } from "@/lib/plans";
import { countMonthlyUsage } from "@/lib/usage-server";
import { getTrending } from "@/lib/trends";
import { getLadder, starimgConfig } from "@/lib/llm-policy";
import { HOUSE_PERSON, mnemosCapture, mnemosPersonFor, mnemosRecall, mnemosSnapshot, mnemosSnapshotResult } from "@/lib/mnemos-bridge";
import { BridgeError, assertBridgeEligible, bridgeOffer, getMemberEngineKey, mintBridgeCode } from "@/lib/muse-bridge";
import { redactBridgeSecrets } from "@/lib/bridge-redact";
import { museWeekCommand } from "@/lib/muse-week-command";
import { getMemberLanguage } from "@/lib/member-language";
import { draftBlueprint, getBlueprint } from "@/lib/blueprint";
import { dailyBriefing } from "@/lib/briefing";
import { craftSetupPrompt } from "@/lib/setup-prompt";

/**
 * ─── RALPH — the one-click dispatcher inside Whoparmy ───────────────
 *
 * Dave's order (2026-11-18): a chat in Ralph with one-click buttons —
 * less typing, more agents. Ralph generates nothing himself; a tap
 * routes to the machinery that already exists (Create, the bot
 * catalog, campaigns, the /before audit lane) and his memory is the
 * member's own Mnemos scope. The first three actions are the three
 * end results the front door sells: free content, a free AI audit,
 * persistent memory. Publishing, sending and spending are NOT
 * reachable from here — those stay behind their existing approval UI.
 */

export type RalphActionId =
  | "make_content"
  | "free_audit"
  | "build_system"
  | "daily_brief"
  | "day_one"
  | "memory"
  | "trending"
  | "my_bots"
  | "my_plan"
  | "my_claude"
  | "campaigns";

export interface RalphAction {
  id: RalphActionId;
  label: string;
}

export interface RalphReply {
  text: string;
  actions: RalphActionId[];
  nav?: { view: "create" | "agents" | "campaigns" | "account" | "system"; memeTopic?: string };
  /** Trending picks: tapping one hands the topic to the member's Meme Smith as a job. */
  topics?: string[];
}

const LABELS: Record<string, Record<RalphActionId, string>> = {
  en: {
    make_content: "Make my free content",
    free_audit: "Run my free AI audit",
    build_system: "Build my AI system",
    daily_brief: "Manager briefing",
    day_one: "Day-1 setup prompt",
    memory: "What do you remember about my business?",
    trending: "What's trending today?",
    my_bots: "My bots & jobs",
    my_plan: "My plan & balance",
    my_claude: "Talk to my Muse",
    campaigns: "My campaigns",
  },
  es: {
    make_content: "Crear mi contenido gratis",
    free_audit: "Haz mi auditoría de IA gratis",
    build_system: "Crear mi sistema de IA",
    daily_brief: "Informe del gerente",
    day_one: "Prompt de instalación día 1",
    memory: "¿Qué recuerdas de mi negocio?",
    trending: "¿Qué es tendencia hoy?",
    my_bots: "Mis bots y trabajos",
    my_plan: "Mi plan y saldo",
    my_claude: "Hablar con mi Muse",
    campaigns: "Mis campañas",
  },
  ja: {
    make_content: "無料コンテンツを作る",
    free_audit: "無料AI監査を受ける",
    build_system: "AIシステムを作る",
    daily_brief: "マネージャー報告",
    day_one: "初日セットアップ",
    memory: "私のビジネスの何を覚えていますか？",
    trending: "今日のトレンドは？",
    my_bots: "マイbotとジョブ",
    my_plan: "プランと残高",
    my_claude: "自分のClaudeと話す",
    campaigns: "マイキャンペーン",
  },
  ru: {
    make_content: "Сделать бесплатный контент",
    free_audit: "Запустить бесплатный AI-аудит",
    build_system: "Собрать мою AI-систему",
    daily_brief: "Сводка менеджера",
    day_one: "Промпт запуска — день 1",
    memory: "Что ты помнишь о моём бизнесе?",
    trending: "Что сегодня в тренде?",
    my_bots: "Мои боты и задачи",
    my_plan: "Мой план и баланс",
    my_claude: "Поговорить с моим Muse",
    campaigns: "Мои кампании",
  },
};

export const RALPH_MENU: RalphActionId[] = [
  "make_content",
  "free_audit",
  "build_system",
  "daily_brief",
  "day_one",
  "memory",
  "trending",
  "my_bots",
  "my_plan",
  "my_claude",
  "campaigns",
];

export function ralphActions(locale: string, ids: RalphActionId[] = RALPH_MENU): RalphAction[] {
  const dict = LABELS[locale] ?? LABELS.en;
  return ids.map((id) => ({ id, label: dict[id] }));
}

const L = {
  greetingBrand: {
    en: (b: string) => `Hey — I'm Ralph. I run the floor here: bots, content, campaigns. Last I saw, we were working on ${b}. Pick a button and I'll get it moving — no typing needed.`,
    es: (b: string) => `Hola — soy Ralph. Yo llevo la planta aquí: bots, contenido, campañas. La última vez estábamos con ${b}. Toca un botón y lo pongo en marcha — sin escribir nada.`,
    ja: (b: string) => `やあ、Ralphです。ここではbotもコンテンツもキャンペーンも私が回しています。前回は ${b} に取り組んでいました。ボタンを押せばすぐ動きます — 入力は不要です。`,
    ru: (b: string) => `Привет — я Ральф. Я здесь за главного: боты, контент, кампании. В прошлый раз мы работали над ${b}. Нажми кнопку — и я всё запущу, печатать не нужно.`,
  },
  greetingPlain: {
    en: () => `Hey — I'm Ralph. I run the floor here: bots, content, campaigns. Everything below is one tap — pick what you want done and I'll route it to the right agent.`,
    es: () => `Hola — soy Ralph. Yo llevo la planta aquí: bots, contenido, campañas. Todo lo de abajo es un solo toque — elige qué quieres y lo envío al agente correcto.`,
    ja: (b?: string) => `やあ、Ralphです。ここではbotもコンテンツもキャンペーンも私が回しています。下のボタンはすべてワンタップ — やりたいことを選べば、担当エージェントに回します。`,
    ru: () => `Привет — я Ральф. Я здесь за главного: боты, контент, кампании. Всё ниже — в одно касание: выбери, что нужно сделать, и я отправлю это нужному агенту.`,
  },
  remembered: {
    en: (s: string) => `Here's what I hold on your business so far:\n\n${s}\n\nIf anything's off, just tell me in plain words and I'll correct it.`,
    es: (s: string) => `Esto es lo que guardo de tu negocio hasta ahora:\n\n${s}\n\nSi algo está mal, dímelo con tus palabras y lo corrijo.`,
    ja: (s: string) => `あなたのビジネスについて覚えているのはこちらです:\n\n${s}\n\n違うところがあれば、普通の言葉で教えてください。直します。`,
    ru: (s: string) => `Вот что я помню о твоём бизнесе:\n\n${s}\n\nЕсли что-то не так — просто скажи своими словами, и я исправлю.`,
  },
  noMemory: {
    en: () => `Honestly? Nothing yet — your memory with me starts now. Tell me one thing about your business (what you sell, who buys it) and I'll keep it for every agent who works for you. Or tap "Make my free content" and I'll learn as we go.`,
    es: () => `¿Sinceramente? Todavía nada — tu memoria conmigo empieza ahora. Cuéntame una cosa de tu negocio (qué vendes, quién te compra) y la guardaré para cada agente que trabaje para ti. O toca "Crear mi contenido gratis" y aprendo sobre la marcha.`,
    ja: (s?: string) => `正直に言うと、まだ何も。私との記憶は今から始まります。あなたのビジネスについて一つ教えてください（何を売っているか、誰が買うか）。あなたのために働く全エージェントが使えるよう保持します。`,
    ru: () => `Честно? Пока ничего — твоя память у меня начинается сейчас. Расскажи одну вещь о своём бизнесе (что продаёшь, кто покупает), и я сохраню это для каждого агента, который на тебя работает.`,
  },
  // The store couldn't be read. Saying "nothing yet" here would be a lie
  // about an outage — the member's memory is still there.
  memoryDown: {
    en: () => `I can't reach your memory right now — that doesn't mean it's empty, it's just not answering. Give it a few minutes and tap the memory button again.`,
    es: () => `Ahora mismo no puedo acceder a tu memoria — no significa que esté vacía, solo que no responde. Dale unos minutos y vuelve a tocar el botón de memoria.`,
    ja: () => `今はあなたの記憶にアクセスできません。空になったわけではなく、応答がないだけです。数分後にもう一度メモリーボタンを押してください。`,
    ru: () => `Сейчас не могу достучаться до твоей памяти — это не значит, что она пуста, она просто не отвечает. Подожди пару минут и снова нажми кнопку памяти.`,
  },
  // The model asked to remember a fact and the write did not land.
  notSaved: {
    en: () => `\n\n(Heads up: I couldn't save that to your memory just now — tell me again in a bit and I'll keep it.)`,
    es: () => `\n\n(Aviso: no pude guardar eso en tu memoria ahora mismo — dímelo otra vez en un rato y lo guardo.)`,
    ja: () => `\n\n（お知らせ: 今はそれを記憶に保存できませんでした。少し後でもう一度教えてください。保存します。）`,
    ru: () => `\n\n(Важно: сейчас не получилось сохранить это в твою память — повтори чуть позже, и я запомню.)`,
  },
} as const;

function pick<T extends Record<string, (...args: never[]) => string>>(table: T, locale: string) {
  return (table[locale] ?? table.en) as T["en"];
}

async function brandLine(userId: string): Promise<string | null> {
  const brand = await db.brandProfile.findFirst({ where: { userId }, orderBy: { updatedAt: "desc" } });
  if (!brand) return null;
  const bits = [brand.name, brand.industry, brand.description].filter(Boolean);
  return bits.join(" — ").slice(0, 240);
}

export async function ralphGreeting(userId: string, locale: string, house = false): Promise<RalphReply> {
  const [brand, snapshot] = await Promise.all([
    brandLine(userId),
    mnemosSnapshot(mnemosPersonFor(userId), house ? [HOUSE_PERSON] : []),
  ]);
  const base = brand ? pick(L.greetingBrand, locale)(brand) : pick(L.greetingPlain, locale)();
  const memoryNote =
    snapshot && snapshot.length > 20
      ? locale === "es"
        ? "\n\nY sí — me acuerdo de tu negocio. Toca el botón de memoria cuando quieras ver qué guardo."
        : locale === "ja"
          ? "\n\nそして、あなたのビジネスのことは覚えています。確認したくなったらメモリーボタンを押してください。"
          : locale === "ru"
            ? "\n\nИ да — я помню твой бизнес. Нажми кнопку памяти, когда захочешь посмотреть, что я храню."
            : "\n\nAnd yes — I remember your business. Tap the memory button any time to see what I hold."
      : "";
  return { text: base + memoryNote, actions: RALPH_MENU };
}

export async function ralphAction(userId: string, locale: string, actionId: RalphActionId, house = false): Promise<RalphReply> {
  const person = mnemosPersonFor(userId);
  switch (actionId) {
    case "make_content":
      return {
        text:
          locale === "es"
            ? "Vamos. Te llevo a Crear — tu marca y la tendencia de hoy ya pueden ir cargadas. Los bots hacen el trabajo; tú solo apruebas."
            : "Let's go. Taking you to Create — your brand and today's trend can ride along. The bots do the work; you just approve.",
        actions: ["free_audit", "trending", "memory"],
        nav: { view: "create" },
      };
    case "free_audit": {
      const assessor = AGENT_CATALOG.find((a) => a.key.toLowerCase().includes("assess"));
      return {
        text: assessor
          ? `Your free audit runs through ${assessor.name}: it builds a real pack for your business — your site, your offer, your gaps — and hands the work to your own Muse on your own pages. Taking you to the bot catalog now; rent The Assessor and follow the one command it gives you.`
          : "Your free audit builds a real pack for your business — your site, your offer, your gaps. Taking you to the bot catalog now.",
        actions: ["make_content", "my_bots", "memory"],
        nav: { view: "agents" },
      };
    }
    case "memory": {
      const snap = await mnemosSnapshotResult(person, house ? [HOUSE_PERSON] : []);
      if (snap.status === "ok" && snap.text.length > 20) {
        return { text: pick(L.remembered, locale)(snap.text.slice(0, 1800)), actions: ["make_content", "free_audit", "trending"] };
      }
      if (snap.status === "unavailable") {
        return { text: pick(L.memoryDown, locale)(), actions: ["make_content", "free_audit", "trending"] };
      }
      return { text: pick(L.noMemory, locale)(), actions: ["make_content", "free_audit", "trending"] };
    }
    case "trending": {
      const { topics } = await getTrending(locale === "ja" ? "ja" : locale === "es" ? "es" : "en");
      const top = topics.slice(0, 5);
      if (top.length === 0) {
        return { text: "No trend snapshot yet today — the floor is still warming up. Try again in a bit, or start from your brand instead.", actions: ["make_content", "free_audit"] };
      }
      const list = top.map((t, i) => `${i + 1}. ${t.title}`).join("\n");
      return {
        text: `Today's board:\n\n${list}\n\nTap a topic below and I'll hand it straight to your Meme Smith as a job.`,
        actions: ["make_content", "free_audit", "memory"],
        topics: top.map((t) => t.title),
      };
    }
    case "my_bots": {
      const [hires, jobs] = await Promise.all([
        db.hiredAgent.findMany({ where: { userId }, orderBy: { createdAt: "desc" } }),
        db.agentJob.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 5 }),
      ]);
      if (hires.length === 0) {
        return {
          text: "No agents on your floor yet — agents are free on every plan, no seats, no rentals. Set one up and it starts working your content, research, or audits. Taking you to the catalog.",
          actions: ["free_audit", "make_content"],
          nav: { view: "agents" },
        };
      }
      const lines = hires.map((h) => `• ${h.name} (${h.templateKey})`).join("\n");
      const jobLines = jobs.length
        ? "\n\nLatest jobs:\n" + jobs.map((j) => `• ${j.kind} — ${j.status}`).join("\n")
        : "";
      return { text: `Your floor:\n${lines}${jobLines}`, actions: ["make_content", "free_audit", "my_plan"] };
    }
    case "my_plan": {
      const user = await db.user.findUnique({ where: { id: userId }, select: { plan: true, freeGenBalance: true } });
      const plan = getPlan(user?.plan ?? "trial");
      const memesUsed = await countMonthlyUsage(userId);
      return {
        text:
          `You're on ${plan.name} (${plan.price}): agents unlimited — your plan meters generations, not seats. ` +
          `${memesUsed} of ${plan.monthlyItems} generations used this month, ${user?.freeGenBalance ?? 0} free generations banked. ` +
          `Your own key (BYOK) runs past the allowance any time — 1 credit per engine call.`,
        actions: ["my_bots", "make_content", "my_claude"],
      };
    }
    case "my_claude": {
      // Mint on the spot (Dave, 2026-11-18): Ralph generates the
      // bridge code right here and hands over the paste — no trip to
      // the Account page. Same machinery as /api/bridge/code (the
      // default scope), all signed-in members may connect, and the
      // member's engine link is proven before a code exists. The
      // token the code issues is content-only (Dave's decision):
      // publishing stays behind the in-app approve tap.
      // Minting is tap-only, never from free text: a fresh code
      // retires the member's older unused codes, so it must be a
      // deliberate tap, not a conversational side effect.
      const user = await db.user.findUnique({ where: { id: userId } });
      if (!user) {
        return { text: "I can't find your account to mint a command for. Try again from your Account page.", actions: ["my_plan"] };
      }
      try {
        assertBridgeEligible(user);
        await getMemberEngineKey(user);
        const member = await getMemberEngineKey(user);
        const minted = await mintBridgeCode(user.id, member.credits < 0 ? 5000 : member.credits);
        const brand = await db.brandProfile.findFirst({
          where: { userId, website: { not: null } },
          orderBy: { createdAt: "asc" },
          select: { website: true },
        });
        const businessUrl = brand?.website || "https://your-business-website.com";
        const memberLanguage = await getMemberLanguage(user.id).catch(() => null);
        const command = museWeekCommand(minted.code, businessUrl, minted.budgetCredits, "week", memberLanguage?.language);
        const link = `https://whop.plunderandriffle.com/connect/${minted.code}`;
        return {
          text:
            `Here's your agent link — minted just now, good for 24 hours, works once:\n\n${link}\n\n` +
            `Give it to Muse or any AI agent you use. The page hands the agent your connection and your business; it researches you free, quotes you the options (a Taste, a Week), and spends nothing without your "go". This connection is capped at ${minted.budgetCredits} credits, and publishing stays off — posting is your in-app tap.\n\n` +
            `Prefer to paste? Same thing as a command:\n\n${command}`,
          actions: ["my_plan", "make_content"],
        };
      } catch (err) {
        if (err instanceof BridgeError && err.code === "NOT_ELIGIBLE") {
          return {
            text: "Save an engine link to connect your Muse on your own credits, with no subscription needed.",
            actions: ["my_plan", "make_content"],
          };
        }
        const reason = err instanceof Error ? err.message : "the bridge is unreachable";
        return {
          text: `I couldn't mint your command just now — ${reason} The /bridge-code page is the other door, and it shows your live balance too. Taking you to Account.`,
          actions: ["my_plan", "make_content"],
          nav: { view: "account" },
        };
      }
    }
    case "build_system": {
      // The onboarding architect (Dave, 2026-11-19): Ralph drafts
      // the member's AI-system blueprint from research on file, or
      // reports its state. The full plan lives in My AI System.
      const user = await db.user.findUnique({
        where: { id: userId },
        select: { plan: true, whopId: true },
      });
      const actor = { id: userId, plan: user?.plan ?? "FREE", whopId: user?.whopId ?? null };
      const existing = await getBlueprint(userId);
      if (!existing) {
        const bp = await draftBlueprint(actor);
        return {
          text:
            `I drafted your AI-system blueprint from what's on file — top play: ${bp.opportunities[0]?.title ?? "daily content"}. ` +
            `It lines up ${bp.workforce.length} agents (${bp.workforce.map((a) => a.name).join(", ")}) for hire once you approve it. Taking you to My AI System to review.`,
          actions: ["make_content", "my_bots", "my_plan"],
          nav: { view: "system" },
        };
      }
      return {
        text:
          existing.status === "approved"
            ? "Your system is live — the blueprint is approved and your workforce is on the floor. Taking you to My AI System for the status board."
            : "Your blueprint is drafted and waiting on your approval — approving it hires the workforce. Taking you to it.",
        actions: ["my_bots", "make_content", "my_plan"],
        nav: { view: "system" },
      };
    }
    case "daily_brief": {
      // The manager briefing (Slice 2): real last-24h activity,
      // failures named, one recommendation. Read-only.
      const user = await db.user.findUnique({
        where: { id: userId },
        select: { plan: true, whopId: true },
      });
      const b = await dailyBriefing({ id: userId, plan: user?.plan ?? "FREE", whopId: user?.whopId ?? null });
      const lines = [
        `Last 24 hours: ${b.jobsDone} agent jobs done${b.jobsFailed ? `, ${b.jobsFailed} FAILED` : ""}${b.jobsRunning ? `, ${b.jobsRunning} running or queued` : ""}.`,
        `${b.assetsMade} assets made, ${b.generations} generations used, ${b.researchDone} research runs finished.`,
        b.attention.length ? `Needs attention: ${b.attention[0]}` : "Nothing needs attention.",
        `My recommendation: ${b.recommendation}`,
      ];
      return {
        text: lines.join("\n"),
        actions: ["build_system", "make_content", "my_bots"],
        nav: { view: "system" },
      };
    }
    case "day_one": {
      // Day-1 setup (Dave, 2026-11-19): Ralph crafts the master
      // prompt + fresh bridge link; the member pastes it to their
      // own Muse, which builds their agent management UI in
      // their stack. The full prompt lives in My AI System (too
      // long for chat); here Ralph hands over the link + summary.
      // Minting is tap-only — this is a button, never free text.
      const user = await db.user.findUnique({
        where: { id: userId },
        select: { plan: true, whopId: true },
      });
      const s = await craftSetupPrompt({ id: userId, plan: user?.plan ?? "FREE", whopId: user?.whopId ?? null });
      if (s.researchRequired) {
        const statusLine = s.researchState === "running"
          ? "Your deep research is still running; the prompt unlocks when it lands."
          : s.researchState === "failed"
            ? "The last deep-research run failed; run it again from Brand Profiles."
            : "Deep research has not run yet; start it from Brand Profiles first.";
        return {
          text: `Your Day-1 setup prompt comes after deep research on your business. ${statusLine}`,
          actions: ["build_system"],
          nav: { view: "system" },
        };
      }
      const lines = [
        "Your Day-1 setup prompt is crafted — it's in My AI System, ready to copy.",
        "Paste it to your Muse (or any agent you run): it connects through your bridge link, researches your business, builds your agent management UI in your own stack, and wires the workforce from your blueprint. Operating from day 1.",
      ];
      if (s.link) {
        lines.push(`Your fresh connect link (also inside the prompt): ${s.link}`);
      } else {
        lines.push("Connect links are available to every member with a saved engine link; no subscription is needed.");
      }
      return { text: lines.join("\n\n"), actions: ["build_system", "daily_brief"], nav: { view: "system" } };
    }
    case "campaigns":
      return {
        text: "Your campaigns — and their publishing state — live here. Taking you over.",
        actions: ["make_content", "trending"],
        nav: { view: "campaigns" },
      };
  }
}

const RALPH_SYSTEM = `You are Ralph, the floor manager inside Plunder & Riffle's Whoparmy app. You talk to a small-business owner who rents AI bots that make their marketing content. You are brisk, warm, concrete — a good foreman, not a chatbot. You route work; you never publish, send, or spend anything yourself, and you never promise earnings.

You may offer ONLY these actions (ids): make_content (open Create), free_audit (the free AI audit via The Assessor bot), build_system (their AI-system blueprint — draft it or open My AI System), daily_brief (the manager briefing: last 24h of system activity + one recommendation), day_one (craft the Day-1 setup prompt + bridge link their own Muse uses to build their management UI), memory (show what you remember), trending (today's trends), my_bots, my_plan, my_claude (their Muse bridge, on the Account page), campaigns.

Answer using the member's brand facts and remembered facts below when relevant, and say plainly when you're using something you remembered. Keep replies under 120 words. Reply in the member's language.

Return STRICT JSON only: {"reply": "...", "actions": ["id", ...up to 3], "remember": "one durable business fact the member just told you, or null"}. No markdown fences. If the member states a durable fact about their business (what they sell, where, who buys, their offer), you MUST put it in "remember" — telling them you'll remember it without setting the field is a lie, and Ralph doesn't lie.`;

export async function ralphFreeText(userId: string, locale: string, text: string, history: { role: string; text: string }[], house = false): Promise<RalphReply> {
  const person = mnemosPersonFor(userId);
  const [brand, recalledMember, recalledHouse] = await Promise.all([
    brandLine(userId),
    mnemosRecall(person, text),
    house ? mnemosRecall(HOUSE_PERSON, text) : Promise.resolve(null),
  ]);
  const recalled = [recalledMember, recalledHouse].filter(Boolean).join("\n") || null;
  const cfg = starimgConfig();
  if (!cfg) {
    return { text: "My language brain isn't wired on this deployment yet — but the buttons all work. Tap one and I'll route it.", actions: RALPH_MENU.slice(0, 3) };
  }
  const ladder = await getLadder("mid");
  // Bridge codes and tokens are minted IN this chat, so they sit in
  // the stored history. Redact them from the model-bound copy: the
  // prompt (and its logs) must never carry a live bridge secret.
  const context =
    `Member language: ${locale}\nBrand: ${brand ?? "(none on file)"}\nRemembered facts:\n${recalled ?? "(nothing recalled)"}\n\n` +
    `Recent conversation:\n${history.slice(-6).map((h) => `${h.role}: ${redactBridgeSecrets(h.text)}`).join("\n")}\n\nMember now says: ${redactBridgeSecrets(text)}`;
  for (const model of ladder) {
    try {
      const res = await fetch(`${cfg.base}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${cfg.key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages: [{ role: "system", content: RALPH_SYSTEM }, { role: "user", content: context }] }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) continue;
      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const raw = data.choices?.[0]?.message?.content?.trim();
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw.replace(/^```json?|```$/g, "").trim()) as { reply?: string; actions?: string[]; remember?: string | null };
        const reply = (parsed.reply ?? "").trim();
        if (!reply) continue;
        const actions = (parsed.actions ?? []).filter((a): a is RalphActionId => (RALPH_MENU as string[]).includes(a)).slice(0, 3);
        let saveNote = "";
        if (parsed.remember && parsed.remember.trim().length > 3) {
          // Awaited, not fire-and-forget: an un-awaited promise can be
          // cut when the route response completes, and then Ralph has
          // told the member "I'll remember" about a fact that never
          // landed. And the result is CHECKED: awaiting a failed write
          // and replying "I'll remember" anyway is the same lie.
          const saved = await mnemosCapture(
            person,
            parsed.remember.trim().slice(0, 500),
            "Fact the member told Ralph in chat",
            { timeoutMs: 8_000 },
          );
          if (!saved) {
            console.warn("[ralph] remember failed; telling the member");
            saveNote = pick(L.notSaved, locale)();
          }
        }
        return { text: reply + saveNote, actions: actions.length ? actions : ["make_content", "free_audit", "memory"] };
      } catch {
        return { text: raw.slice(0, 1200), actions: ["make_content", "free_audit", "memory"] };
      }
    } catch {
      continue;
    }
  }
  return { text: "My brain hiccuped — give it another tap, or use the buttons; they always work.", actions: RALPH_MENU.slice(0, 3) };
}
