import type { Metadata } from "next";
import UnsubscribeClient from "./UnsubscribeClient";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function UnsubscribePage({ searchParams }: { searchParams: Promise<{ token?: string; lang?: string }> }) {
  const params = await searchParams;
  return <UnsubscribeClient token={params.token ?? ""} es={params.lang === "es"} />;
}
