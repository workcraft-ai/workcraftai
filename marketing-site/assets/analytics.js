// Public-site measurement only. Never send account, customer, estimate, or URL query data.
const measurementId = "G-SNVSN55B8S";
const consentKey = "workcraftai-public-analytics-consent";
const isProduction = ["workcraftai.com", "www.workcraftai.com"].includes(location.hostname);
const copy = {
  en: {
    message: "Optional analytics help us see which public guides and signup links are useful. Google Analytics loads only if you agree.",
    accept: "Allow analytics",
    decline: "No thanks",
    choice: "Analytics choices",
    privacy: "Privacy policy",
  },
  es: {
    message: "Las estadísticas opcionales nos ayudan a saber qué guías públicas y enlaces de registro son útiles. Google Analytics solo se carga si aceptas.",
    accept: "Permitir estadísticas",
    decline: "No, gracias",
    choice: "Opciones de estadísticas",
    privacy: "Política de privacidad",
  },
};

let loaded = false;
let banner;
let sessionConsent = null;

function readConsent() {
  try { return localStorage.getItem(consentKey) ?? sessionConsent; } catch { return sessionConsent; }
}

function saveConsent(value) {
  sessionConsent = value;
  try { localStorage.setItem(consentKey, value); } catch {}
}

function gtag() {
  window.dataLayer.push(arguments);
}

function startAnalytics() {
  if (!isProduction || loaded) return;
  loaded = true;
  window.dataLayer = window.dataLayer || [];
  gtag("js", new Date());
  let referrer = "";
  try { referrer = document.referrer ? new URL(document.referrer).origin : ""; } catch {}
  gtag("config", measurementId, {
    page_location: `${location.origin}${location.pathname}`,
    page_referrer: referrer,
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
  });
  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`;
  document.head.append(script);
}

function clearAnalyticsCookies() {
  for (const entry of document.cookie.split(";")) {
    const name = entry.split("=")[0]?.trim();
    if (!name || !/^_ga(?:_|$)/.test(name)) continue;
    for (const domain of ["", "; domain=.workcraftai.com", "; domain=workcraftai.com"]) {
      document.cookie = `${name}=; Max-Age=0; path=/${domain}; SameSite=Lax`;
    }
  }
}

function label(key) {
  return copy[document.documentElement.lang === "es" ? "es" : "en"][key];
}

function updateCopy() {
  if (!banner) return;
  banner.setAttribute("aria-label", document.documentElement.lang === "es" ? "Preferencias de estadísticas" : "Analytics preferences");
  for (const element of banner.querySelectorAll("[data-analytics-label]")) {
    element.textContent = label(element.dataset.analyticsLabel);
  }
  const choice = document.querySelector(".analytics-choice");
  if (choice) choice.textContent = label("choice");
}

function setConsent(value) {
  const wasLoaded = loaded;
  saveConsent(value);
  banner.hidden = true;
  if (value === "granted") startAnalytics();
  else {
    if (wasLoaded) {
      gtag("consent", "update", { analytics_storage: "denied" });
      clearAnalyticsCookies();
      location.reload();
    }
  }
}

function makeButton(key, className, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.dataset.analyticsLabel = key;
  button.textContent = label(key);
  button.addEventListener("click", onClick);
  return button;
}

function renderChoice() {
  const footerLinks = document.querySelector(".footer-links");
  if (!footerLinks) return;
  const choice = makeButton("choice", "analytics-choice", () => { banner.hidden = false; });
  footerLinks.append(choice);

  banner = document.createElement("section");
  banner.className = "analytics-banner";
  banner.setAttribute("aria-label", "Analytics preferences");
  const message = document.createElement("p");
  const messageText = document.createElement("span");
  messageText.dataset.analyticsLabel = "message";
  messageText.textContent = label("message");
  const privacy = document.createElement("a");
  privacy.href = "https://app.workcraftai.com/privacy";
  privacy.dataset.analyticsLabel = "privacy";
  privacy.textContent = label("privacy");
  message.append(messageText, " ", privacy);
  const actions = document.createElement("div");
  actions.className = "analytics-actions";
  actions.append(
    makeButton("decline", "analytics-decline", () => setConsent("denied")),
    makeButton("accept", "analytics-accept", () => setConsent("granted")),
  );
  banner.append(message, actions);
  document.body.append(banner);
  banner.hidden = readConsent() === "granted" || readConsent() === "denied";
  updateCopy();
  new MutationObserver(updateCopy).observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
}

renderChoice();
if (readConsent() === "granted") startAnalytics();

document.addEventListener("click", (event) => {
  const link = event.target.closest?.('a[href="https://app.workcraftai.com/signup"]');
  if (!link || !loaded || readConsent() !== "granted") return;
  const placement = link.closest(".site-header") ? "header"
    : link.closest(".hero") ? "hero"
    : link.closest(".plan-card") ? "plan"
    : link.closest(".guide") ? "guide" : "other";
  gtag("event", "signup_click", { cta_placement: placement });
});
