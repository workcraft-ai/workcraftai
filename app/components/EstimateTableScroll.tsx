"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { translate, useLanguage } from "@/app/components/LanguageProvider";

export default function EstimateTableScroll({ children }: { children: ReactNode }) {
  const { language } = useLanguage();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  const [atEnd, setAtEnd] = useState(false);

  useEffect(() => {
    const region = scrollRef.current;
    if (!region) return;
    const update = () => {
      setOverflowing(region.scrollWidth > region.clientWidth + 1);
      setAtEnd(region.scrollLeft + region.clientWidth >= region.scrollWidth - 1);
    };
    const frame = requestAnimationFrame(update);
    const observer = new ResizeObserver(update);
    observer.observe(region);
    if (region.firstElementChild) observer.observe(region.firstElementChild);
    region.addEventListener("scroll", update, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      region.removeEventListener("scroll", update);
    };
  }, []);

  const scrollToEdge = () => {
    const region = scrollRef.current;
    if (!region) return;
    region.scrollTo({
      left: atEnd ? 0 : region.scrollWidth - region.clientWidth,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  };

  return (
    <>
      {overflowing && (
        <div className="flex flex-wrap items-center justify-between gap-x-3 border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-700">
          <p id="estimate-scroll-hint" className="flex items-center gap-2">
            <svg aria-hidden="true" className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 12h16M8 8l-4 4 4 4M16 8l4 4-4 4" />
            </svg>
            {translate(language, atEnd ? "Swipe right to see customer details." : "Swipe left to see estimate actions, including View Estimate and Email client.")}
          </p>
          <button type="button" onClick={scrollToEdge} aria-controls="estimate-table-scroll" className="inline-flex min-h-12 items-center rounded-lg px-3 font-semibold text-blue-700 underline focus-visible:outline-2 focus-visible:outline-offset-2">
            {translate(language, atEnd ? "Show customer details" : "Show actions")}
          </button>
        </div>
      )}
      <div id="estimate-table-scroll" ref={scrollRef} role="region" aria-label={translate(language, "Estimates")} aria-describedby={overflowing ? "estimate-scroll-hint" : undefined} tabIndex={0} className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-blue-700">
        {children}
      </div>
    </>
  );
}
