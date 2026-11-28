import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CLIP_TOOLS } from "@/lib/clips/tools";
import { CLIP_PACKS, pricePerClip } from "@/lib/clips/packs";

/**
 * /clips/connect — the Clipper's own front door.
 *
 * Two endpoints exist in this product and they are not interchangeable:
 *
 *   1. bot.plunderandriffle.com/api/mcp — the engine, on the member's own key.
 *      Ad creatives, memes, sit-downs. What the /muse page sells.
 *   2. whop.plunderandriffle.com/api/bridge/mcp — this app's bridge: an
 *      allowlist of engine tools PLUS the Clipper's own `clip_*` family, on a
 *      derived key with a weekly budget.
 *
 * Clipping lives on (2), deliberately: the queue, the approvals and the credit
 * ledger are rows in this app, and an approval that lives anywhere else can
 * disagree with the review desk. A member whose Muse points at (1) will not find
 * the Clipper, and this page has to say that plainly rather than let them
 * conclude clips do not exist.
 */

export const metadata = { title: "Connect Muse to the Clipper" };

export default function ConnectPage() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Connect Muse to the Clipper</h1>
        <p className="text-sm text-muted-foreground">
          Your agent does the asking. This page does the approvals. Four steps, and the fourth is the one
          people skip.
        </p>
      </header>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">1 · Which endpoint you need</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            <code className="rounded bg-muted px-1 py-0.5 text-xs">bot.plunderandriffle.com/api/mcp</code>{" "}
            — the engine on your own key. Ad creatives and memes. <strong>No Clipper tools.</strong>
          </p>
          <p>
            <code className="rounded bg-muted px-1 py-0.5 text-xs">
              whop.plunderandriffle.com/api/bridge/mcp
            </code>{" "}
            — this app's bridge. Engine tools on an allowlist, plus the Clipper.{" "}
            <strong>Use this one for clips.</strong>
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">2 · Get a bridge code</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            Open <code className="rounded bg-muted px-1 py-0.5 text-xs">/bridge-code</code> and generate a
            code. The code is shown once. Generating it also proves your engine link works, so a dead
            connection fails here instead of inside your agent.
          </p>
          <p className="text-xs text-muted-foreground">
            No subscription is needed to connect your Muse. The code runs on your own engine credits, capped at your current balance.
          </p>
          <Button size="sm" variant="outline" asChild>
            <a href="/bridge-code">Open /bridge-code</a>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">3 · Exchange it for a token</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>Your agent, not you, does this call:</p>
          <pre className="overflow-x-auto rounded bg-muted p-3 text-xs">
{`POST https://whop.plunderandriffle.com/api/bridge/exchange
{ "code": "the code from /bridge-code" }

→ { "bridge_token": "prb_…", "expires_at": "…",
    "budget_credits": 805, "mcp_url": "…/api/bridge/mcp" }`}
          </pre>
          <p className="text-xs text-muted-foreground">
            Seven days. It is not an engine key: it can only call the allowlisted tools, inside the budget,
            and you can revoke it from /bridge-code.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">4 · Point your agent at the bridge</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <pre className="overflow-x-auto rounded bg-muted p-3 text-xs">
{`URL     https://whop.plunderandriffle.com/api/bridge/mcp
Header  Authorization: Bearer prb_your_token`}
          </pre>
          <p>
            Then ask for the work in plain language — the brief you keep is the artefact:
          </p>
          <pre className="overflow-x-auto rounded bg-muted p-3 text-xs">
{`Set up a page called GTA 6 Daily, handle @gtadaily6, niche "news and
nostalgia", disclosure "Not affiliated with Rockstar Games".

Then queue these 5 links, 15 seconds each, crediting each creator on
their own line. Show me the queue when they are in.`}
          </pre>
        </CardContent>
      </Card>

      <section className="space-y-2">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          What your agent can call
        </h2>
        <ul className="space-y-1 text-sm">
          {CLIP_TOOLS.map((tool) => (
            <li key={tool.name} className="flex flex-wrap items-baseline gap-2">
              <code className="rounded bg-muted px-1 py-0.5 text-xs">{tool.name}</code>
              <span className="text-xs text-muted-foreground">
                {tool.description.split(".")[0]}.
              </span>
            </li>
          ))}
        </ul>
        <p className="text-sm">
          <Badge variant="secondary">Not available, by design</Badge>{" "}
          <span className="text-muted-foreground">
            approve · export · publish. Those are yours. The Clipper has no tool for them, so an agent cannot
            reach them even if it asks nicely.
          </span>
        </p>
      </section>

      <section className="space-y-1 text-xs text-muted-foreground">
        <h2 className="text-sm font-medium uppercase tracking-wide">If you run past your month</h2>
        {CLIP_PACKS.map((pack) => (
          <p key={pack.key}>
            {pack.name} — ${pack.priceUsd} (${pricePerClip(pack).toFixed(2)} a clip). {pack.blurb}
          </p>
        ))}
        <p>
          Or connect your own engine key and the clip cap goes away: about a cent a call, on your own
          infrastructure.
        </p>
      </section>
    </div>
  );
}
