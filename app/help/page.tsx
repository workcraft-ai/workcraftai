import type { Metadata } from "next";
import HelpIndex from "./HelpIndex";

export const metadata: Metadata = {
  title: "WorkCraft AI Help | Step-by-step guides",
  description: "Short guides for estimates, pricing, customer proposals, invoices, Stripe payments, and account access.",
  alternates: { canonical: "https://app.workcraftai.com/help" },
  robots: { index: true, follow: true },
};

export default function HelpPage() { return <HelpIndex />; }
