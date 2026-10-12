import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { helpGuides } from "../guides";
import HelpArticle from "./HelpArticle";

export function generateStaticParams() { return helpGuides.map((guide) => ({ slug: guide.slug })); }

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const guide = helpGuides.find((item) => item.slug === slug);
  if (!guide) return {};
  return { title: `${guide.title.en} | WorkCraft AI Help`, description: guide.summary.en,
    alternates: { canonical: `https://app.workcraftai.com/help/${slug}` }, robots: { index: true, follow: true } };
}

export default async function HelpGuidePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const guide = helpGuides.find((item) => item.slug === slug);
  if (!guide) notFound();
  return <HelpArticle guide={guide} />;
}
