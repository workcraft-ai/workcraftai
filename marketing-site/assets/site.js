const languageButton = document.querySelector("#language-toggle");
const menuButton = document.querySelector(".menu-toggle");
const mobileNavigation = document.querySelector("#mobile-navigation");
const currentLanguage = document.documentElement.lang === "es" ? "es" : "en";

function menuLabel(isOpen) {
  if (currentLanguage === "es") {
    return isOpen ? "Cerrar menú de navegación" : "Abrir menú de navegación";
  }
  return isOpen ? "Close navigation menu" : "Open navigation menu";
}

if (languageButton) {
  const languageTarget = languageButton.dataset.languageHref;
  languageButton.textContent = currentLanguage === "es" ? "EN" : "ES";
  languageButton.setAttribute(
    "aria-label",
    currentLanguage === "es" ? "Cambiar a inglés" : "Switch to Spanish",
  );
  languageButton.addEventListener("click", () => {
    if (languageTarget) window.location.assign(languageTarget);
  });
}

if (menuButton && mobileNavigation) {
  menuButton.setAttribute("aria-label", menuLabel(false));
  menuButton.addEventListener("click", () => {
    const isOpen = menuButton.getAttribute("aria-expanded") === "true";
    menuButton.setAttribute("aria-expanded", String(!isOpen));
    menuButton.setAttribute("aria-label", menuLabel(!isOpen));
    mobileNavigation.hidden = isOpen;
  });

  mobileNavigation.querySelectorAll("a").forEach((link) =>
    link.addEventListener("click", () => {
      mobileNavigation.hidden = true;
      menuButton.setAttribute("aria-expanded", "false");
      menuButton.setAttribute("aria-label", menuLabel(false));
    }),
  );

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      mobileNavigation.hidden = true;
      menuButton.setAttribute("aria-expanded", "false");
      menuButton.setAttribute("aria-label", menuLabel(false));
    }
  });
}

const mobileSignupCta = document.querySelector(".mobile-signup-cta");
const hero = document.querySelector(".hero");
const footer = document.querySelector(".site-footer");
if (mobileSignupCta && hero && footer && "IntersectionObserver" in window) {
  let heroVisible = true;
  let footerVisible = false;
  const updateMobileSignupCta = () => {
    mobileSignupCta.hidden = heroVisible || footerVisible || menuButton?.getAttribute("aria-expanded") === "true";
  };
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.target === hero) heroVisible = entry.isIntersecting;
      if (entry.target === footer) footerVisible = entry.isIntersecting;
    });
    updateMobileSignupCta();
  });
  observer.observe(hero);
  observer.observe(footer);
  menuButton?.addEventListener("click", updateMobileSignupCta);
}
