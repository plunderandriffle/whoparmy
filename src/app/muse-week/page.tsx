"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { clearStashedRef, readStashedRef, stashRefFromUrl } from "@/lib/ref-stash";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Bot, CheckCircle2, Coins, Copy, Download, KeyRound, Loader2, Lock, RefreshCw, ShieldOff } from "lucide-react";
import { museWeekCommand } from "@/lib/muse-week-command";
import { TelegramLinkCard } from "@/components/factory/telegram-link";
import { deriveWhopConnection, type WhopConnectionTone } from "@/lib/whop-connection";
import { deriveWhopHeader } from "@/lib/whop-header";
import { deriveCreditsDisplay, type BridgeByokView } from "@/lib/bridge-byok";

/**
 * ─── MUSE WEEK ───────────────────────────────────────────────────────
 * Dave's end result (2026-11-17): the member creates a Muse account,
 * copies ONE command from this page, and their Muse makes a week of
 * content through the bridge — on the member's own P&R credits.
 * The command text lives in src/lib/muse-week-command.ts (single
 * source — this page, Ralph chat, and MEMBER-ONE-COMMAND.md all
 * render the same text; change it there).
 */

interface BridgeAccount {
  connected: boolean;
  eligible: boolean;
  botPlan: string;
  credits: number | null;
  granted: number;
  period: string | null;
  /** BYOK recognition from the account view (null = not checked). */
  byok: BridgeByokView | null;
  brand: { name: string; website: string | null } | null;
  tokens: Array<{ id: string; budgetCredits: number; spentCredits: number; expiresAt: string; active: boolean }>;
  weekBudgetCredits: number;
  offers: Offer[];
  error: string | null;
  errorCode: string | null;
}

/** The slice of GET /api/auth/session the connection indicator reads. */
interface SessionState {
  connected: boolean;
  mode?: string;
  user: { name?: string | null; whopUsername?: string | null; planName?: string | null; plan?: string | null } | null;
}

const WHOP_DOT_CLASS: Record<WhopConnectionTone, string> = {
  checking: "bg-muted-foreground",
  disconnected: "bg-red-500",
  connected: "bg-emerald-500",
  unlinked: "bg-amber-500",
};

/**
 * Persistent Whop connection indicator (Dave, 2026-11-24) — visible in
 * every gate state, derived only from the session + bridge account
 * responses this page already fetches (see lib/whop-connection.ts).
 * The connect action reuses the teaser's own /api/auth/whop URL.
 */
function WhopConnectionPill({ session, account }: { session: SessionState | null; account: BridgeAccount | null }) {
  const state = deriveWhopConnection(session, account);
  const [signingOut, setSigningOut] = useState(false);
  // Dave, 2026-11-26: green when connected, greeted by first name,
  // with a Disconnect button — same contract as the site header.
  const welcome = session?.connected ? deriveWhopHeader(session).welcomeText : null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${WHOP_DOT_CLASS[state.tone]}`} aria-hidden />
      <span className="font-medium">{state.text}</span>
      {welcome && <span className="font-semibold text-emerald-400">{welcome}</span>}
      {state.tone === "disconnected" && (
        <Button size="sm" variant="outline" asChild>
          <a href="/api/auth/whop">Connect with Whop</a>
        </Button>
      )}
      {session?.connected && (
        <Button
          size="sm"
          variant="outline"
          disabled={signingOut}
          onClick={async () => {
            setSigningOut(true);
            try {
              await fetch("/api/auth/whop/logout", { method: "POST" });
            } finally {
              window.location.reload();
            }
          }}
        >
          {signingOut ? "Disconnecting…" : "Disconnect"}
        </Button>
      )}
    </div>
  );
}

type OfferId = "taste" | "week" | "opener";

interface Offer {
  id: OfferId;
  name: string;
  budgetCredits: number;
  blurb: string;
}

const FALLBACK_OFFERS: Offer[] = [
  { id: "taste", name: "The Taste", budgetCredits: 50, blurb: "One /before — Joe's video about your business, plus the starter pack." },
  { id: "week", name: "The Week", budgetCredits: 805, blurb: "Seven day-packs, one per day, seven angles." },
  { id: "opener", name: "Week + Opener", budgetCredits: 855, blurb: "The Week, plus a personalized /before pitch for your business." },
];

export default function MuseWeekPage() {
  const { toast } = useToast();
  const [gate, setGate] = useState<"loading" | "teaser" | "open">("loading");
  const [session, setSession] = useState<SessionState | null>(null);
  const [account, setAccount] = useState<BridgeAccount | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [offerId, setOfferId] = useState<OfferId>("week");
  const [memberLanguage, setMemberLanguage] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const loadAccount = useCallback(async () => {
    const res = await fetch("/api/bridge/account");
    if (res.ok) {
      const json = (await res.json()) as { account: BridgeAccount };
      setAccount(json.account);
    }
    // Member language (Phase 0): the pasted command speaks it too.
    try {
      const langRes = await fetch("/api/language");
      if (langRes.ok) {
        const langJson = (await langRes.json()) as { language?: { language?: string } };
        if (langJson.language?.language) setMemberLanguage(langJson.language.language);
      }
    } catch {
      // the command simply stays in its default language
    }
  }, []);

  // Referrer carry-through (Dave, 2026-11-24): members get their
  // links in Muse, so a referred visitor may connect HERE first —
  // stash any ?ref= on arrival, and once connected apply it set-once
  // (POST /api/referrals, same as /build) so their referrer is
  // credited whether they arrived direct or through the rotator.
  const attributedRef = useRef(false);
  useEffect(() => {
    stashRefFromUrl();
  }, []);
  useEffect(() => {
    if (!session?.connected || attributedRef.current) return;
    attributedRef.current = true;
    const refCode = new URLSearchParams(window.location.search).get("ref") ?? readStashedRef();
    if (!refCode) return;
    void fetch("/api/referrals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: refCode }) })
      .catch(() => undefined)
      .finally(() => clearStashedRef());
  }, [session]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/auth/session");
        const json = (await res.json()) as SessionState & { connected?: boolean };
        setSession({ connected: Boolean(json.connected), mode: json.mode, user: json.user ?? null });
        if (!json.connected) {
          setGate("teaser");
          return;
        }
        setGate("open");
        await loadAccount();
      } catch {
        setSession({ connected: false, user: null });
        setGate("teaser");
      }
    })();
  }, [loadAccount]);

  const generateCode = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/bridge/code", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ offer: offerId }) });
      const json = (await res.json()) as { code?: string; error?: string };
      if (!res.ok || !json.code) throw new Error(json.error || "Could not generate a code");
      setCode(json.code);
      setCopied(false);
      // Refresh the account so the connection indicator (and the token
      // list) reflect the token this code will issue, not first load.
      await loadAccount();
    } catch (err) {
      toast({ title: "Bridge code failed", description: err instanceof Error ? err.message : "Try again", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (tokenId: string) => {
    await fetch("/api/bridge/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tokenId }),
    });
    await loadAccount();
  };

  if (gate === "loading") {
    return (
      <main className="mx-auto max-w-3xl px-4 py-12 space-y-6">
        <WhopConnectionPill session={session} account={account} />
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Checking your connection…
        </p>
      </main>
    );
  }

  if (gate === "teaser") {
    return (
      <main className="mx-auto max-w-3xl px-4 py-12 space-y-6">
        <WhopConnectionPill session={session} account={account} />
        <h1 className="text-3xl font-bold">Your Muse makes your week</h1>
        <p className="text-muted-foreground">
          Create a Muse, paste one command from this page, and your agent makes 7 days of content for your business —
          on your own Plunder &amp; Riffle credits, through this bridge. Connect with Whop to see your command.
        </p>
        <p className="text-sm font-medium">No subscription is needed to connect your Muse. You get 100 free credits every month; packs cost one penny per credit.</p>
        <Button asChild>
          <a href="/api/auth/whop">Connect with Whop</a>
        </Button>
      </main>
    );
  }

  const creditsDisplay = deriveCreditsDisplay({ byok: account?.byok ?? null });
  const businessUrl = account?.brand?.website || "https://your-business-website.com";
  const offers = account?.offers?.length ? account.offers : FALLBACK_OFFERS;
  const selectedOffer = offers.find((o) => o.id === offerId) ?? offers[0];
  const budget = selectedOffer.budgetCredits;

  return (
    <main className="mx-auto max-w-3xl px-4 py-12 space-y-6">
      <WhopConnectionPill session={session} account={account} />
      <div>
        <h1 className="text-3xl font-bold">Your Muse makes your week</h1>
        <p className="mt-2 text-muted-foreground">
          One command. Seven days of content. Your credits, your agent, your approval before anything publishes.
        </p>
        <p className="mt-1 text-sm font-medium">No subscription is needed to connect your Muse. You get 100 free credits every month; packs cost one penny per credit.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Bot className="h-5 w-5" /> 1 · Your Muse
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            Don&apos;t have a Muse yet? Join with invite code <strong>S8IQY7</strong> — you get 1 billion tokens and
            so does the member who invited you (join within 48 hours of the invite for it to count).
          </p>
          <Button variant="outline" asChild>
            <a href="https://www.plunderandriffle.com/muse-invite" target="_blank" rel="noreferrer">
              Create your Muse
            </a>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Coins className="h-5 w-5" /> 2 · Your credits
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {!account && (
            <p className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Reading your P&amp;R balance…
            </p>
          )}
          {account?.connected && (
            <>
              <p>
                {creditsDisplay.balanceLabel}:{" "}
                <strong>{account.credits === -1 ? "Unlimited" : `${account.credits} credits`}</strong>
                {account.granted > 0 && <> · {account.granted} granted this cycle</>}
                {account.period && <> · cycle {account.period.replace("paid:", "")}</>}
              </p>
              {creditsDisplay.byok ? (
                <>
                  <p>
                    You run on your own keys — saved on your record: {creditsDisplay.savedLabels.join(", ")}. The
                    balance above is read live from the engine on this page load; it is your real position, not
                    the flat monthly allowance.
                  </p>
                  {creditsDisplay.llmSaved && (
                    <p className="text-muted-foreground">
                      With your own LLM key saved, generation calls run on it at 1 credit each.
                    </p>
                  )}
                  {creditsDisplay.ownWorker && (
                    <p className="text-muted-foreground">
                      Your own render worker is saved, so an MP4 render costs{" "}
                      {creditsDisplay.mp4QuoteCredits ?? 1} credit{creditsDisplay.mp4QuoteCredits === 1 ? "" : "s"}{" "}
                      instead of 25 on house servers.
                    </p>
                  )}
                </>
              ) : (
                <p className="text-muted-foreground">
                  These credits live on your own Plunder &amp; Riffle key, issued for your Whop account. Your Muse
                  spends them through this bridge — it never sees the key itself.
                </p>
              )}
            </>
          )}
          {account && !account.connected && (
            <p className="flex items-start gap-2 text-amber-500">
              <Lock className="mt-0.5 h-4 w-4 shrink-0" />
              {account.errorCode === "NO_WHOP_ID"
                ? "Sign in with Whop (not the operator fallback) so your account can be linked to its credits."
                : account.error ?? "The bridge is not reachable yet."}
            </p>
          )}
          {account && account.tokens.length > 0 && (
            <div className="space-y-1 pt-2">
              <p className="font-medium">Bridge tokens</p>
              {account.tokens.map((t) => (
                <p key={t.id} className="flex items-center justify-between gap-2 text-muted-foreground">
                  <span>
                    {t.active ? "Active" : "Dead"} · spent {t.spentCredits} of {t.budgetCredits} credits · expires{" "}
                    {new Date(t.expiresAt).toLocaleDateString()}
                  </span>
                  {t.active && (
                    <Button size="sm" variant="ghost" onClick={() => revoke(t.id)}>
                      <ShieldOff className="mr-1 h-3.5 w-3.5" /> Revoke
                    </Button>
                  )}
                </p>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Download className="h-5 w-5" /> 3 · One-click install
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            Install the Plunder &amp; Riffle skill into your Muse or ChatGPT in one click — no repo, no
            copy-paste prompts, and every update lands on your end automatically.
          </p>
          <Button variant="outline" asChild>
            <a href="https://app.skillsync.com/iammagicdave/plunder-and-riffle" target="_blank" rel="noreferrer">
              Install Plunder &amp; Riffle in one click
            </a>
          </Button>
          <p className="text-muted-foreground">
            The skill is free and Whop stays your home for credits, community and kits — the install just puts
            the engine one tap away inside your own agent, next to the bridge command below.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <KeyRound className="h-5 w-5" /> 4 · Your one command
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {!account?.brand?.website && account?.connected && (
            <p className="text-amber-500">
              Add a brand with your business website first (Brands, above) — the command below carries a placeholder
              URL until you do. You can also just tell your Muse the right URL when you paste it.
            </p>
          )}
          {!code ? (
            <>
              <div className="space-y-2">
                {offers.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => setOfferId(o.id)}
                    className={`w-full rounded-md border p-3 text-left ${o.id === offerId ? "border-primary bg-muted" : "border-border"}`}
                  >
                    <span className="font-medium">{o.name}</span> · {o.budgetCredits} credits
                    <span className="block text-muted-foreground">{o.blurb}</span>
                  </button>
                ))}
              </div>
              <Button onClick={generateCode} disabled={busy || !account?.connected}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <KeyRound className="mr-2 h-4 w-4" />}
                Generate my command
              </Button>
            </>
          ) : (
            <>
              <div className="rounded-md border border-primary/30 bg-primary/5 p-4 space-y-1.5">
                <p className="text-sm font-bold">Easiest: give any agent this link</p>
                <p className="text-sm break-all font-medium text-primary">
                  https://whop.plunderandriffle.com/connect/{code}
                </p>
                <p className="text-xs text-muted-foreground">
                  Muse or any AI agent opens it and gets the command below — no copy-paste, no login.
                  Works once, expires in 24 hours. Or paste the command yourself:
                </p>
              </div>
              <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-4 text-xs leading-relaxed">
                {museWeekCommand(code, businessUrl, budget, offerId, memberLanguage)}
              </pre>
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={async () => {
                    await navigator.clipboard.writeText(museWeekCommand(code, businessUrl, budget, offerId, memberLanguage));
                    setCopied(true);
                  }}
                >
                  {copied ? <CheckCircle2 className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
                  {copied ? "Copied" : "Copy the command"}
                </Button>
                <Button variant="outline" onClick={generateCode} disabled={busy}>
                  <RefreshCw className="mr-2 h-4 w-4" /> Fresh code (kills the old one)
                </Button>
              </div>
              <p className="text-muted-foreground">
                The code inside expires in 24 hours and works once. The token it issues lasts 7 days — one pairing,
                one run. Your agent researches first (free), quotes the exact cost, and waits for your
                &ldquo;go&rdquo; before spending anything.
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {/* Step 5 · Pair Telegram (Dave, 2026-11-24): the pairing card
          lived only inside the unrouted AccountView, leaving the live
          site with no Telegram door anywhere. It renders only in this
          open gate state — pairing mints a code against the member's
          real Whop session, so the teaser never shows it. The card is
          the existing TelegramLinkCard, reused as-is; its own mb-6 is
          harmless inside this space-y-6 stack. */}
      <TelegramLinkCard />
    </main>
  );
}
