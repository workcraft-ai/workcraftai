"use client";

import { translate, useLanguage } from "@/app/components/LanguageProvider";

export default function LocalizedText({ text }: { text: string }) {
  const { language } = useLanguage();
  return translate(language, text);
}
