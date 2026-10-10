"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import { translate, useLanguage } from "@/app/components/LanguageProvider";

type TurnstileOptions = {
  sitekey: string;
  language: string;
  theme: "auto";
  callback: (token: string) => void;
  "expired-callback": () => void;
  "error-callback": () => void;
};

type TurnstileApi = {
  render: (container: HTMLElement, options: TurnstileOptions) => string;
  reset: (widgetId?: string) => void;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() ?? "";
export const TURNSTILE_ENABLED = siteKey.length > 0;

export default function TurnstileCaptcha({
  onToken,
  resetSignal,
}: {
  onToken: (token: string | null) => void;
  resetSignal: number;
}) {
  const { language } = useLanguage();
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const previousResetSignal = useRef(resetSignal);
  const onTokenRef = useRef(onToken);
  const [scriptReady, setScriptReady] = useState(false);
  const [scriptError, setScriptError] = useState(false);
  const [widgetError, setWidgetError] = useState(false);
  const [verified, setVerified] = useState(false);

  useEffect(() => {
    onTokenRef.current = onToken;
  }, [onToken]);

  useEffect(() => {
    if (!siteKey || !scriptReady || !containerRef.current || !window.turnstile) return;

    try {
      const widgetId = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        language,
        theme: "auto",
        callback: (token) => {
          setWidgetError(false);
          setVerified(true);
          onTokenRef.current(token);
        },
        "expired-callback": () => {
          setVerified(false);
          onTokenRef.current(null);
        },
        "error-callback": () => {
          setWidgetError(true);
          setVerified(false);
          onTokenRef.current(null);
        },
      });
      widgetIdRef.current = widgetId;

      return () => {
        window.turnstile?.remove(widgetId);
        if (widgetIdRef.current === widgetId) widgetIdRef.current = null;
      };
    } catch {
      setWidgetError(true);
      onTokenRef.current(null);
    }
  }, [language, scriptReady]);

  useEffect(() => {
    if (previousResetSignal.current === resetSignal) return;
    previousResetSignal.current = resetSignal;
    setVerified(false);
    onTokenRef.current(null);
    if (widgetIdRef.current) window.turnstile?.reset(widgetIdRef.current);
  }, [resetSignal]);

  if (!siteKey) return null;

  return (
    <div className="space-y-2" role="group" aria-label={translate(language, "Security verification")}>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onReady={() => setScriptReady(true)}
        onError={() => setScriptError(true)}
      />
      <div ref={containerRef} />
      {!scriptReady && !scriptError && (
        <p className="text-xs text-slate-400">{translate(language, "Loading security check…")}</p>
      )}
      {scriptError && (
        <p role="alert" className="text-xs text-red-300">
          {translate(language, "Security check could not load. Check your connection and reload the page.")}
        </p>
      )}
      {widgetError && (
        <p role="alert" className="text-xs text-red-300">
          {translate(language, "Security verification did not complete. Please try again.")}
        </p>
      )}
      {!scriptError && !widgetError && !verified && (
        <p className="text-xs text-slate-400">
          {translate(language, "Complete the security check to continue.")}
        </p>
      )}
    </div>
  );
}
