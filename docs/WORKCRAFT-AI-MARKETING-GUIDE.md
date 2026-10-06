# WorkCraft AI launch and low-cost marketing guide

This guide assumes the public brand is **WorkCraft AI**, the marketing site is `https://workcraftai.com`, and the app is `https://app.workcraftai.com`. The Vercel projects are named `workcraftai-company-site` and `workcraftai-app`; custom domains remain attached to those projects.

## Keep the first month simple

Start with Facebook, Instagram, LinkedIn, and Google Search Console. Create the accounts under an email address the company controls, enable two-factor authentication, save recovery codes in a password manager, and keep the owner account under the founder's control. Do not share passwords in a document or give a scheduler more permissions than it needs.

Publish useful, specific product education before spending on ads. A realistic first rhythm is two or three posts a week: one short product walkthrough, one practical estimating or job-admin tip, and one feature explanation. Reuse the idea across networks, but adjust the caption and format. Do not invent customer testimonials, savings, adoption numbers, guarantees, or capabilities that the app does not have.

## Step 1: Set up the company identity

1. The company domain is registered as `workcraftai.com` and attached to Vercel. Keep its renewal active and manage DNS from the provider currently hosting the domain's DNS records.
2. Use the same display name, short description, logo, and handle everywhere where available. Suggested handle: `@WorkCraftAI`. If that is taken, use one consistent variation such as `@WorkCraftAIApp`.
3. Use an owner-controlled email for account creation. A free mailbox is adequate to start; switch to an address on the new domain once business email is configured.
4. Enable two-factor authentication on every account. Save backup codes privately. Add a second trusted administrator only when needed.
5. Do a basic name and trademark conflict check before investing in signs, paid ads, or branded merchandise. A domain being available does not establish that a business name or social handle is legally or practically clear.

## Step 2: Create Facebook and Instagram

1. Sign in to Facebook using the founder's real account and create a **WorkCraft AI Page** from the Pages area. Use the selected domain, the same logo, and a short factual description: “AI-assisted estimates, proposals, jobs, and invoices for independent trade and service businesses.”
2. Create an Instagram account for WorkCraft AI, then switch it to a **professional business account** in Instagram's account settings.
3. Connect the Instagram professional account to the Facebook Page in Meta Accounts Center or Meta Business Suite. Confirm that both accounts appear in the same Business Suite workspace.
4. In Meta Business Suite, complete profile images, cover art, website links, and the business description. Schedule the first week's posts there; the free native scheduler is the simplest starting point for Facebook and Instagram.
5. Use a real app screen recording or a branded graphic built from the approved visual templates. Use only synthetic sample information in screenshots—never customer names, addresses, estimates, or invoices.

Meta's current Instagram publishing API is for professional accounts. API publishing requires an app and publishing permissions; the Meta documentation describes a linked professional account/Page flow for the Facebook Login path. Native scheduling is easier while the audience is small. [Meta's Instagram API documentation](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api)

## Step 3: Create a LinkedIn Company Page

1. Sign in to a personal LinkedIn profile that you control.
2. Open **For Business → Create a Company Page**, choose **Company**, and enter WorkCraft AI, `workcraftai.com`, the category that best fits business software, company size, logo, and tagline.
3. Complete the About section with accurate product details and add a link to `https://app.workcraftai.com`.
4. Publish product lessons and short founder updates there. Invite relevant professional contacts to follow the Page; avoid bulk invitations or unsolicited messages.

LinkedIn says a Company Page can be created for free and documents the Page creation steps in its [official Help Center](https://www.linkedin.com/help/linkedin/answer/a545752).

## Step 4: Set up Google discovery for free

1. Sign in to [Google Search Console](https://search.google.com/search-console/) with the company's Google account.
2. Add a **Domain property** for `workcraftai.com` and verify it by adding Google's TXT record at the domain's DNS provider.
3. After the site is attached and reachable, submit `https://workcraftai.com/sitemap.xml` in Search Console's **Sitemaps** report.
4. Check the Pages/Indexing and Performance reports monthly. Search Console can report crawl or indexing issues; sitemap submission is a hint and does not guarantee indexing. [Google's sitemap guide](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)
5. Do not create a Google Business Profile just to get a listing. Google's eligibility rules require in-person customer contact; online-only brands are ineligible. [Google Business Profile eligibility](https://support.google.com/business/answer/13763036?hl=en-en)

## Step 5: Make a small, reusable content library

Create a folder or a simple spreadsheet with columns for `topic`, `approved fact`, `post angle`, `platform`, `caption`, `image`, `link`, `publish date`, and `status`. Keep a short, reviewed fact sheet alongside it:

- WorkCraft AI supports estimates, proposals, jobs, price book management, reports, and invoices.
- AI can help draft estimate scope and line items; the contractor must verify details, quantities, rates, taxes, and terms.
- Down payments and full customer payments are Pro-only and require Stripe Connect setup. Do not advertise collection as live until the Stripe Connect production checks are complete.
- Do not claim integrations, customer outcomes, or automation that are not actually live.
- Demo content and screenshots must use fictional names and data.

Use repeatable themes so posts stay useful without inventing new product claims:

| Theme | Example post |
|---|---|
| Estimating tip | “Three scope details to confirm before you send a quote.” |
| Product walkthrough | A 20-second screen recording showing a fictional estimate moving to a proposal. |
| Feature explanation | How a saved price book can speed up a repeat estimate. |
| Founder/build update | A real, short update about what is being improved and why. |
| Customer education | A checklist a homeowner can use to compare proposals fairly. |

Link each post to a relevant page with a simple campaign tag, for example `https://workcraftai.com/?utm_source=instagram&utm_medium=organic_social&utm_campaign=launch`. Keep links short and consistent so you can tell which posts bring visits.

## Step 6: Automate creation, images, and publishing

### Low-cost setup to start

1. Store the approved fact sheet and content queue in a company-controlled Google Sheet or in a private repository. Do not include customer data.
2. Use an AI text API to draft a week's captions from only the approved facts. Google AI Studio currently lists a free tier for some models, but rates, quotas, eligibility, and data terms differ by model and can change. Review the [current Gemini API pricing and terms](https://ai.google.dev/gemini-api/docs/pricing) before connecting billing. Do not submit customer data or secrets.
3. Generate images from a fixed WorkCraft AI SVG/HTML template rather than asking an image model to invent a new design for every post. Fill in a short headline, one approved product screenshot or simple illustration, and a call to action; render the template to PNG at the dimensions required by the target platform. This keeps the visuals consistent and avoids per-image generation costs.
4. Start with the built-in Meta Business Suite scheduler for Facebook and Instagram. It costs nothing and avoids managing API tokens while validating the content rhythm.
5. Keep generated posts in a **review queue** for the first few weeks. Check that product claims are accurate, links work, spelling is clean, and the graphic is legible on a phone. Then mark posts approved and schedule them.

### Move routine posts to full automation after the trial

Once the review queue is consistently producing accurate posts, the same workflow can publish automatically:

1. A weekly scheduled GitHub Actions workflow reads the approved fact sheet and content themes.
2. It calls the selected text-generation API and returns structured posts: caption variants, platform, image headline, approved URL, and intended date.
3. A validation step rejects posts that contain unsupported claims, private data, missing links, or duplicate recent topics.
4. The workflow renders branded SVG templates into PNG images. Keep a library of approved backgrounds, screenshot frames, and icons; do not expose real user data in images.
5. A publishing job sends approved posts through the official platform APIs and records each post ID, result, timestamp, and error. Use the least-privileged permissions available, store tokens as GitHub Actions secrets, rotate them, and never put a token in the repository or generated content.
6. Alert the owner if generation or publishing fails. Do not silently skip a post, and do not retry indefinitely; use a small retry limit and a visible queue.

For Instagram API publishing, the account must be professional and the app needs the required permissions; other platforms have their own app review, access, media format, and token rules. This is more setup than Meta Business Suite, so automate Facebook/Instagram first and add other channels only after each official API is approved. [Meta's API guide](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api)

Do not use browser bots to imitate people posting or liking content, auto-comment on unrelated posts, scrape followers, or send unsolicited DMs. Use supported APIs and native publishing tools. Keep auto-publication limited to reviewed evergreen product education until the process has a reliable track record.

## Step 7: Launch without paid ads

1. Ask a small set of friends, family, and tradespeople who are willing to give honest feedback to visit the site and try the app.
2. Post a short screen-recorded walkthrough and link to the site from the company accounts. Ask for feedback, not endorsements; never present a friend as a customer unless they actually used the product and consented.
3. Share practical educational posts in communities only when the group permits business posts. Answer questions helpfully and disclose your affiliation.
4. Add useful text to the website for each real feature and keep a public demo video once it is ready. Search engines need crawlable page text; do not rely on text embedded only in images.
5. Review site visits, signups, and feedback weekly. Improve the onboarding and first estimate workflow before spending on Google or Meta ads.
6. When ready for a small ad test, choose one audience, one landing page, and one measurable action. Set a hard daily and total spend limit before launching. Ads are not part of the free plan.

## Current domain and Vercel project mapping

The domain cutover is complete. The verified production mappings are:

1. `workcraftai.com` and `www.workcraftai.com` → Vercel project `workcraftai-company-site`.
2. `app.workcraftai.com` → Vercel project `workcraftai-app`.

The project rename did not change the custom domains or DNS records. If you change a domain later, verify the Vercel project assignment and TLS status, the Supabase Auth Site URL and allowed redirect URLs, app email links, `robots.txt`, and `sitemap.xml` before announcing the change.

## Ready-to-use weekly content prompt

> Create three distinct social posts for WorkCraft AI, a software app for independent trade and service businesses. Use only these approved facts: it supports estimates, proposals, jobs, a price book, reports, and invoices; AI can help draft estimate scope and line items, but the contractor must verify quantities, scope, rates, taxes, and terms. Do not claim customer results, time savings, revenue growth, integrations, guarantees, or features that are not listed. Do not invent testimonials or customer stories. Use clear, plain language and a helpful, practical tone. Return one Facebook/Instagram caption, one LinkedIn variation, a short headline for a branded template graphic, alt text, and one call to action linking to https://workcraftai.com/?utm_source={platform}&utm_medium=organic_social&utm_campaign=launch. Use fictional examples only. Keep each post genuinely useful, varied, and non-repetitive.
