"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MAX_BYOK_REWARD_TOTAL, type ByokRewardSettings } from "@/lib/byok-reward";

async function requestSettings(settings?: ByokRewardSettings): Promise<ByokRewardSettings> {
  const response = await fetch("/api/admin/byok-reward", settings ? {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  } : { cache: "no-store" });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Could not load reward settings.");
  return result;
}

export function ByokRewardPanel() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [total, setTotal] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    void requestSettings().then((settings) => {
      setEnabled(settings.enabled);
      setTotal(String(settings.total));
    }).catch((error) => setError(error.message));
  }, []);

  async function save() {
    if (enabled === null) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const settings = await requestSettings({ enabled, total: Number(total) });
      setEnabled(settings.enabled);
      setTotal(String(settings.total));
      setNotice("Reward settings saved.");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not save reward settings.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-10">
      <header className="mb-4">
        <h2 className="text-xl font-bold tracking-tight">BYOK setup reward</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          BYOK setup reward — engine credits a member earns as each setup connection lands. The existing 25 free generations on the links step count inside this total.
        </p>
      </header>
      <Card>
        <CardContent className="space-y-4 pt-6">
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
          {enabled !== null && (
            <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
              <div className="flex items-center gap-2">
                <Checkbox id="byok-reward-enabled" checked={enabled} disabled={busy} onCheckedChange={(checked) => { setEnabled(checked === true); setNotice(null); }} />
                <Label htmlFor="byok-reward-enabled">Enable setup rewards</Label>
              </div>
              <div className="max-w-xs space-y-2">
                <Label htmlFor="byok-reward-total">Total reward</Label>
                <Input id="byok-reward-total" type="number" min={0} max={MAX_BYOK_REWARD_TOTAL} step={1} required disabled={busy}
                  value={total} onChange={(event) => { setTotal(event.target.value); setNotice(null); }} />
              </div>
              <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
            </form>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
