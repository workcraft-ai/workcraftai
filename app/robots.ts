import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    // Keep crawling enabled so bots can see the noindex metadata on app routes.
    rules: { userAgent: "*", allow: "/" },
    sitemap: "https://app.workcraftai.com/sitemap.xml",
  };
}
