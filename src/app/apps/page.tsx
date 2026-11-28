"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { stashRefFromUrl } from "@/lib/ref-stash";

export default function AppsPage() {
  const router = useRouter();
  useEffect(() => {
    stashRefFromUrl();
    router.replace("/" + window.location.search);
  }, [router]);
  return <main className="min-h-screen grid place-items-center bg-background text-muted-foreground">Taking you to the homepage…</main>;
}
