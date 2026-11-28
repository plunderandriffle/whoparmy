"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, Copy, KeyRound, Loader2, Lock, ShieldOff } from "lucide-react";
import { bridgeAgentBrief } from "@/lib/bridge-agent-brief";
import { deriveWhopConnection, type WhopConnectionTone } from "@/lib/whop-connection";
import { deriveWhopHeader } from "@/lib/whop-header";

interface BridgeAccount {
  connected: boolean;
  credits: number | null;
  granted: number;
  period: string | null;
  tokens: Array<{ id: string; budgetCredits: number; spentCredits: number; expiresAt: string; active: boolean }>;
  error: string | null;
  errorCode: string | null;
}
interface SessionState {
  connected: boolean;
  mode?: string;
  user: { name?: string | null; whopUsername?: string | null; planName?: string | null; plan?: string | null } | null;
}
const WHOP_DOT_CLASS: Record<WhopConnectionTone, string> = {
  checking: "bg-muted-foreground", disconnected: "bg-red-500", connected: "bg-emerald-500", unlinked: "bg-amber-500",
};

function WhopConnectionPill({ session, account }: { session: SessionState | null; account: BridgeAccount | null }) {
  const state = deriveWhopConnection(session, account);
  const [signingOut, setSigningOut] = useState(false);
  const welcome = session?.connected ? deriveWhopHeader(session).welcomeText : null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${WHOP_DOT_CLASS[state.tone]}`} aria-hidden />
      <span className="font-medium">{state.text}</span>
      {welcome && <span className="font-semibold text-emerald-400">{welcome}</span>}
      {state.tone === "disconnected" && <Button size="sm" variant="outline" asChild><a href="/api/auth/whop?next=/bridge-code">Connect with Whop</a></Button>}
      {session?.connected && <Button size="sm" variant="outline" disabled={signingOut} onClick={async () => {
        setSigningOut(true);
        try { await fetch("/api/auth/whop/logout", { method: "POST" }); } finally { window.location.reload(); }
      }}>{signingOut ? "Disconnecting…" : "Disconnect"}</Button>}
    </div>
  );
}

export default function BridgeCodePage() {
  const { toast } = useToast();
  const [gate, setGate] = useState<"loading" | "teaser" | "open">("loading");
  const [session, setSession] = useState<SessionState | null>(null);
  const [account, setAccount] = useState<BridgeAccount | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [budgetCredits, setBudgetCredits] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const loadAccount = useCallback(async () => {
    const res = await fetch("/api/bridge/account");
    if (res.ok) {
      const json = (await res.json()) as { account: BridgeAccount };
      setAccount(json.account);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/auth/session");
        const json = (await res.json()) as SessionState;
        setSession({ connected: Boolean(json.connected), mode: json.mode, user: json.user ?? null });
        if (!json.connected) { setGate("teaser"); return; }
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
      const res = await fetch("/api/bridge/code", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      const json = (await res.json()) as { code?: string; expiresAt?: string; budgetCredits?: number; error?: string };
      if (!res.ok || !json.code) throw new Error(json.error || "Could not generate a code");
      setCode(json.code);
      setExpiresAt(json.expiresAt ?? null);
      setBudgetCredits(json.budgetCredits ?? null);
      setCopied(null);
      await loadAccount();
    } catch (err) {
      toast({ title: "Bridge code failed", description: err instanceof Error ? err.message : "Try again", variant: "destructive" });
    } finally { setBusy(false); }
  };

  const revoke = async (tokenId: string) => {
    await fetch("/api/bridge/revoke", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tokenId }) });
    await loadAccount();
  };

  const copy = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
    } catch {
      toast({ title: "Copy failed", description: "Your browser could not copy this text.", variant: "destructive" });
    }
  };

  if (gate === "loading") return <main className="mx-auto max-w-3xl space-y-6 px-4 py-12"><WhopConnectionPill session={session} account={account} /><p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Checking your connection…</p></main>;

  if (gate === "teaser") return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-12">
      <WhopConnectionPill session={session} account={account} />
      <h1 className="text-3xl font-bold">Your bridge code</h1>
      <p className="text-muted-foreground">Any AI agent you use — Muse, ChatGPT, or another — connects to your Plunder &amp; Riffle account with this code, on your own credits.</p>
      <Button asChild><a href="/api/auth/whop?next=/bridge-code">Connect with Whop</a></Button>
    </main>
  );

  const instructions = code ? bridgeAgentBrief(code) : "";
  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-12">
      <WhopConnectionPill session={session} account={account} />
      <h1 className="text-3xl font-bold">Your bridge code</h1>
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-lg"><Lock className="h-5 w-5" /> Your credits</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          {!account && <p className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Reading your P&amp;R balance…</p>}
          {account?.connected && <p>Balance: <strong>{account.credits === -1 ? "Unlimited" : `${account.credits} credits`}</strong>{account.granted > 0 && <> · {account.granted} granted this cycle</>}{account.period && <> · cycle {account.period.replace("paid:", "")}</>}</p>}
          {account && !account.connected && <p className="flex items-start gap-2 text-amber-500"><Lock className="mt-0.5 h-4 w-4 shrink-0" />{account.errorCode === "NO_WHOP_ID" ? "Sign in with Whop (not the operator fallback) so your account can be linked to its credits." : account.error ?? "The bridge is not reachable yet."}</p>}
          {account && account.tokens.length > 0 && <div className="space-y-1 pt-2"><p className="font-medium">Bridge tokens</p>{account.tokens.map((t) => <p key={t.id} className="flex items-center justify-between gap-2 text-muted-foreground"><span>{t.active ? "Active" : "Dead"} · spent {t.spentCredits} of {t.budgetCredits} credits · expires {new Date(t.expiresAt).toLocaleDateString()}</span>{t.active && <Button size="sm" variant="ghost" onClick={() => revoke(t.id)}><ShieldOff className="mr-1 h-3.5 w-3.5" /> Revoke</Button>}</p>)}</div>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-lg"><KeyRound className="h-5 w-5" /> Your bridge code</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          {!code ? <><p>This code works once, expires in 24 hours, and generating a fresh one kills the previous unused code.</p><Button onClick={generateCode} disabled={busy || !account?.connected}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Generate my bridge code</Button></> : <>
            <p className="break-all font-mono text-2xl font-bold">{code}</p>
            <p className="text-muted-foreground">Expires {expiresAt ? new Date(expiresAt).toLocaleString() : "in 24 hours"} · budget {budgetCredits ?? "—"} credits</p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => copy("code", code)}>{copied === "code" ? <CheckCircle2 className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}{copied === "code" ? "Copied" : "Copy code"}</Button>
              <Button variant="outline" onClick={() => copy("link", `https://whop.plunderandriffle.com/connect/${code}`)}>{copied === "link" ? "Copied" : "Copy agent link"}</Button>
              <Button variant="outline" onClick={() => copy("instructions", instructions)}>{copied === "instructions" ? "Copied" : "Copy instructions for my agent"}</Button>
            </div>
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-4 text-xs leading-relaxed">{instructions}</pre>
            <Button variant="outline" onClick={generateCode} disabled={busy}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Fresh code (kills the old one)</Button>
          </>}
          <p className="text-muted-foreground">Give the code — or just the link — to your agent. The link shows the same instructions; viewing it does not use the code.</p>
        </CardContent>
      </Card>
    </main>
  );
}
