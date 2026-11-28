"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { stashRefFromUrl } from "@/lib/ref-stash";

export default function YourLinksPage() {
  const router = useRouter();
  useEffect(() => {
    stashRefFromUrl();
    router.replace("/bridge-code" + window.location.search);
  }, [router]);
  return <main className="min-h-screen grid place-items-center bg-background text-muted-foreground">Taking you to your agent…</main>;
}
