"use client";

import Image from "next/image";
import Link from "next/link";
import { translate, useLanguage } from "@/app/components/LanguageProvider";

export default function Footer() {
  const { language } = useLanguage();
  const currentYear = new Date().getUTCFullYear();

  return (
    <footer className="print:hidden bg-[#e9e7df] text-[#56615a]">
      <div className="mx-auto grid min-h-[83px] w-[calc(100%-38px)] grid-cols-[1fr_auto] items-center gap-x-3 gap-y-[3px] border-b border-[#d4d7ce] py-4 sm:flex sm:min-h-[85px] sm:w-[calc(100%-64px)] sm:justify-between sm:gap-6 sm:py-0 lg:max-w-[1192px]">
        <a
          href="https://workcraftai.com/"
          aria-label={translate(language, "WorkCraft AI home")}
          className="focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[#a94727]"
        >
          <Image
            src="/brand/workcraft-ai-logo.svg"
            alt=""
            width={760}
            height={180}
            className="h-auto w-[165px] sm:w-[205px]"
          />
        </a>
        <p className="col-start-1 row-start-2 m-0 text-[9px] leading-[1.5] text-[#747d74] sm:text-[11px]">
          {translate(language, "For the people who get the work done.")}
          <br />
          {translate(language, "Keep good work moving.")}
        </p>
        <a
          href="https://app.workcraftai.com/"
          className="col-start-2 row-start-1 row-span-2 text-[9px] font-bold transition-colors hover:text-[#a94727] focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[#a94727] sm:text-[11px]"
        >
          {translate(language, "Go to the app")} <span className="ml-1 text-[#a94727]" aria-hidden="true">↗</span>
        </a>
      </div>

      <div className="mx-auto flex min-h-[55px] w-[calc(100%-38px)] flex-wrap items-center justify-between gap-x-3 gap-y-2 py-3 text-[8px] text-[#56615a] sm:min-h-[52px] sm:w-[calc(100%-64px)] sm:flex-nowrap sm:gap-4 sm:py-0 sm:text-[9px] lg:max-w-[1192px]">
        <span>© {currentYear} WorkCraft AI. {translate(language, "All rights reserved.")}</span>
        <nav
          aria-label={translate(language, "Legal and support")}
          className="order-3 flex basis-full items-center justify-center gap-4 pt-[3px] font-semibold sm:order-none sm:basis-auto sm:gap-4 sm:pt-0"
        >
          <Link href="/privacy" className="transition-colors hover:text-[#a94727] focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[#a94727]">
            {translate(language, "Privacy")}
          </Link>
          <Link href="/terms" className="transition-colors hover:text-[#a94727] focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[#a94727]">
            {translate(language, "Terms")}
          </Link>
          <Link href="/support" className="transition-colors hover:text-[#a94727] focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[#a94727]">
            {translate(language, "Support")}
          </Link>
        </nav>
        <span className="ml-auto text-right sm:ml-0">
          {translate(language, "Built for the work that keeps things moving.")}
        </span>
      </div>
    </footer>
  );
}
