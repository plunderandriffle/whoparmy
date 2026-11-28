"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { stashRefFromUrl } from "@/lib/ref-stash";

/**
 * /muse-week retired 2026-11-28 at Dave's order; /bridge-code is the
 * connection spot. This redirect keeps already-pasted prompts and old
 * links working.
 */
export default function MuseWeekPage() {
  const router = useRouter();
  useEffect(() => {
    stashRefFromUrl();
    router.replace("/bridge-code" + window.location.search);
  }, [router]);
  return <main className="min-h-screen grid place-items-center bg-background text-muted-foreground">Taking you to your bridge code…</main>;
}
