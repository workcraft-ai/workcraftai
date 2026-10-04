"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@/app/utils/supabase/client";

export default function AccountActivityTracker() {
  const pathname = usePathname();
  const lastSentAt = useRef(0);

  useEffect(() => {
    let running = false;
    const record = async () => {
      if (running || document.visibilityState !== "visible" || Date.now() - lastSentAt.current < 6 * 60 * 60 * 1000) return;
      running = true;
      try {
        const { data: { session } } = await createClient().auth.getSession();
        if (!session) return;
        const response = await fetch("/api/user/activity", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", cache: "no-store" });
        if (response.ok) lastSentAt.current = Date.now();
      } catch {
        // Retry on a later navigation or visibility change.
      } finally {
        running = false;
      }
    };
    const onVisibility = () => { if (document.visibilityState === "visible") void record(); };
    const onFocus = () => void record();
    void record();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [pathname]);

  return null;
}
