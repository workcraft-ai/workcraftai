import type { MetadataRoute } from "next";
import { helpGuides } from "@/app/help/guides";

const PUBLIC_APP_URLS = ["/support", "/privacy", "/terms", "/help", ...helpGuides.map((guide) => `/help/${guide.slug}`)];

export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_APP_URLS.map((path) => ({
    url: `https://app.workcraftai.com${path}`,
  }));
}
