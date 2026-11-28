import { MemberFooterColumns } from "@/components/shell/member-chrome";

/**
 * SiteFooter — Design Engine kit footer pattern (2026-11-24).
 * Quiet grid + the standing honesty line, identical on every page.
 *
 * H2 nav demotion (2026-11-26): the member link columns come from
 * <MemberFooterColumns> (components/shell/member-chrome.tsx) and
 * render ONLY for a connected member. Logged-out visitors keep the
 * brand line and the honesty line — no member directory in the
 * public footer.
 */

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-border pt-8 text-xs text-muted-foreground">
      <div className="grid gap-8 pb-8 sm:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <p translate="no" className="font-display text-xs font-extrabold tracking-[0.14em] text-foreground">
            PLUNDER <span className="text-primary">&amp;</span> RIFFLE
          </p>
          <p className="mt-3 max-w-xs leading-relaxed">
            Your agent makes pieces for your business. Nothing goes out without your say-so.
          </p>
        </div>
        <MemberFooterColumns />
      </div>
      <p className="border-t border-border/60 pt-5 pb-1 leading-relaxed">
        Nothing publishes, sends or spends without your yes on that item. Affiliate and referral money shown anywhere is
        simulated until it&apos;s actually paid. Nothing is guaranteed.
      </p>
    </footer>
  );
}
