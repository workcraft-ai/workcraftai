# WorkCraft AI marketing site

Static marketing site intended to run as a **separate Vercel project** with `marketing-site/` as its Root Directory. It is isolated from the existing WorkCraft AI application project and does not change the app's routes, deployment, or environment variables.

## Before publishing

- The contact section points people to `https://app.workcraftai.com/support` for product FAQs and the support contact form.
- The demo section uses the supplied MP4 and a poster image with fictionalized dashboard records. Verify playback on mobile browsers before launch; add an accurate caption track if the video includes narration.
- The public company name is WorkCraft AI. The site uses `workcraftai.com`, and app links point to `https://app.workcraftai.com/`.
- The marketing site has one canonical HTML page; its other sections are fragment links, so `sitemap.xml` correctly lists only `https://workcraftai.com/`. `robots.txt` allows the public site to be crawled and advertises that sitemap.
- The app publishes its own sitemap at `https://app.workcraftai.com/sitemap.xml` for the public support and legal pages. App tools and customer/account pages inherit `noindex` metadata and are excluded from that sitemap.
- After the domains resolve, verify `workcraftai.com` as a Domain property in Google Search Console and submit both the marketing-site and app sitemaps. See [the Search Console setup steps](../docs/WORKCRAFT-AI-MARKETING-GUIDE.md#step-4-set-up-google-discovery-for-free).
- Review all product and company claims before connecting a custom domain or using the site in ads.

The current design is a dependency-free static site: `index.html`, `styles.css`, and `favicon.svg`. The header language control switches the site between English and Spanish, remembers the visitor's choice on that device, and defaults to Spanish when the browser language is Spanish. A Vercel project rooted at this directory can serve it without building the application's Next.js project.
