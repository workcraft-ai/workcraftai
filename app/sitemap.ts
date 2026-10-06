import type { MetadataRoute } from "next";

const PUBLIC_APP_URLS = ["/support", "/privacy", "/terms"] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_APP_URLS.map((path) => ({
    url: `https://app.workcraftai.com${path}`,
  }));
}
