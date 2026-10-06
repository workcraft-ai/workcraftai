# WorkCraft AI marketing site

Static marketing site intended to run as a **separate Vercel project** with `marketing-site/` as its Root Directory. It is isolated from the existing WorkCraft AI application project and does not change the app's routes, deployment, or environment variables.

## Before publishing

- The contact section points people to `https://app.workcraftai.com/support` for product FAQs and the support contact form.
- The demo section uses the supplied MP4 and a poster image with fictionalized dashboard records. Verify playback on mobile browsers before launch; add an accurate caption track if the video includes narration.
- The public company name is WorkCraft AI. The site uses `workcraftai.com`, and app links point to `https://app.workcraftai.com/`.
- `robots.txt` and `sitemap.xml` are ready for Google Search Console after the custom domain resolves.
- Review all product and company claims before connecting a custom domain or using the site in ads.

The current design is a dependency-free static site: `index.html`, `styles.css`, and `favicon.svg`. The header language control switches the site between English and Spanish, remembers the visitor's choice on that device, and defaults to Spanish when the browser language is Spanish. A Vercel project rooted at this directory can serve it without building the application's Next.js project.
