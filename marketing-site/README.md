# WorkCraft AI marketing site

Static marketing site intended to run as a **separate Vercel project** with `marketing-site/` as its Root Directory. It is isolated from the existing WorkCraft AI application project and does not change the app's routes, deployment, or environment variables.

## Before publishing

- The contact section points people to `https://app.workcraftai.com/support` for product FAQs and the support contact form.
- The demo section uses the supplied MP4 and a poster image with fictionalized dashboard records. Verify playback on mobile browsers before launch; add an accurate caption track if the video includes narration.
- The public company name is WorkCraft AI. The site uses `workcraftai.com`, and app links point to `https://app.workcraftai.com/`.
- The marketing site has a canonical home page, a Resources hub, and individual guides. `sitemap.xml` lists each public page; `robots.txt` allows the public site to be crawled and advertises that sitemap.
- The app publishes its own sitemap at `https://app.workcraftai.com/sitemap.xml` for the public support and legal pages. App tools and customer/account pages inherit `noindex` metadata and are excluded from that sitemap.
- After the domains resolve, verify `workcraftai.com` as a Domain property in Google Search Console and submit both the marketing-site and app sitemaps. See [the Search Console setup steps](../docs/WORKCRAFT-AI-MARKETING-GUIDE.md#step-4-set-up-google-discovery-for-free).
- Review all product and company claims before connecting a custom domain or using the site in ads.

The current design is a dependency-free static site: `index.html`, `styles.css`, `favicon.svg`, and the Resources pages. English pages have stable, crawlable Spanish counterparts under `/es/`, including the Resources hub, every published guide, and the trade estimate pages. Each language URL has its own translated title and description, canonical URL, reciprocal `hreflang` links, and sitemap alternates. The language control navigates to the matching page in the other language. Run `node scripts/generate-trade-pages.mjs` from this directory to regenerate the trade pages and their sitemap entries. A Vercel project rooted at this directory can serve it without building the application's Next.js project. Its `vercel.json` applies an enforced Content Security Policy, browser permissions headers, and the permanent `www` to apex redirect for this separate project.

The optional public-site Google Analytics tag uses measurement ID `G-SNVSN55B8S`. `assets/analytics.js` loads Google only after the visitor selects **Allow analytics**; the footer lets them change that choice. It records page views and `signup_click` with a fixed CTA placement, strips URL queries from the page location, and does not run inside the app. After deployment, confirm a consented visit and signup click in the matching GA4 property's Realtime view. A browser blocker or declined analytics choice will prevent those events, so these counts are not a full visitor census.
