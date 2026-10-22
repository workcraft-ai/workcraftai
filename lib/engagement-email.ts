import { brandedEmailButton, brandedEmailTextFooter } from "@/lib/branded-email.mjs";
import { emailAddressFromConfig } from "@/lib/email-address";
import { escapeEmailHtml, notificationFrame, type NotificationMail } from "@/lib/notification-outbox";

export type EngagementCampaign = "first_estimate" | "preview_estimate" | "price_book" | "reactivation" | "monthly_tip";
export type EngagementCandidate = {
  user_id: string;
  email: string;
  language: "en" | "es";
  campaign: EngagementCampaign;
  anchor_at: string;
  estimate_id: string | null;
  trade: string | null;
};

function monthlyGuide(trade: string | null) {
  const value = (trade ?? "").toLowerCase();
  if (value.includes("plumb") || value.includes("plomer")) return "plumbing-estimate-example";
  if (value.includes("electric") || value.includes("eléctric")) return "electrical-estimate-checklist";
  if (value.includes("roof") || value.includes("tech")) return "roofing-estimate-scope-template";
  return "price-a-small-trade-job";
}

export function makeEngagementMail(
  candidate: EngagementCandidate,
  appOrigin: string,
  postalAddress: string,
  unsubscribeToken: string,
): NotificationMail {
  const es = candidate.language === "es";
  const guidePath = monthlyGuide(candidate.trade);
  const guide = `https://workcraftai.com/${es ? "es/" : ""}resources/${guidePath}/`;
  const content = {
    first_estimate: {
      subject: es ? "Tu primera cotización puede ser sencilla" : "Your first estimate can be simple",
      body: es ? "Comienza con el cliente, el trabajo y tus precios. Puedes agregar fotos, IA y otros detalles después." : "Start with the customer, the work, and your prices. Photos, AI, and other details can wait.",
      action: es ? "Crear una cotización" : "Create an estimate", href: `${appOrigin}/estimate/new`,
    },
    preview_estimate: {
      subject: es ? "Revisa lo que verá tu cliente" : "See what your customer will see",
      body: es ? "Ya guardaste una cotización. Revísala antes de compartirla para comprobar el alcance, los precios y los datos del cliente." : "You have an estimate saved. Review it before sharing to check the scope, prices, and customer details.",
      action: es ? "Revisar la cotización" : "Review the estimate", href: `${appOrigin}/estimate/${encodeURIComponent(candidate.estimate_id ?? "")}`,
    },
    price_book: {
      subject: es ? "Guarda un precio que usas a menudo" : "Save a rate you use often",
      body: es ? "Si cotizas el mismo servicio o material con frecuencia, guarda su precio en tu lista. Podrás reutilizarlo y ajustarlo para cada trabajo." : "If you quote the same service or material often, save its rate in your Price Book. You can reuse it and adjust it for each job.",
      action: es ? "Abrir la lista de precios" : "Open Price Book", href: `${appOrigin}/pricebook`,
    },
    reactivation: {
      subject: es ? "¿Listo para continuar donde lo dejaste?" : "Ready to pick up where you left off?",
      body: es ? "Tus cotizaciones y datos guardados siguen aquí. Cuando tengas otro trabajo para cotizar, puedes continuar a tu ritmo." : "Your saved estimates and details are here when you need them. Pick up at your own pace when the next job comes in.",
      action: es ? "Abrir mi panel" : "Open my dashboard", href: `${appOrigin}/dashboard`,
    },
    monthly_tip: {
      subject: es ? "Una guía útil para tu próxima cotización" : "A practical guide for your next estimate",
      body: es ? "Aquí tienes una guía breve para revisar el alcance y los precios antes de enviar tu próxima cotización." : "Here is a short guide to checking scope and pricing before you send your next estimate.",
      action: es ? "Leer la guía" : "Read the guide", href: guide,
    },
  }[candidate.campaign];
  const unsubscribe = `${appOrigin}/email-preferences/unsubscribe?token=${encodeURIComponent(unsubscribeToken)}&lang=${es ? "es" : "en"}`;
  const preference = `${appOrigin}/profile#email-preferences`;
  const support = emailAddressFromConfig(process.env.NEXT_PUBLIC_SUPPORT_EMAIL) || "support@workcraftai.com";
  const footer = es
    ? `Correo de producto de WorkCraft AI. Dejar de recibir consejos: ${unsubscribe}\nTambién puedes solicitar la baja o comunicar inquietudes a ${support}.\nPreferencias: ${preference}${postalAddress ? `\n${postalAddress}` : ""}`
    : `WorkCraft AI product email. Stop product tips: ${unsubscribe}\nYou can also request removal or raise concerns at ${support}.\nPreferences: ${preference}${postalAddress ? `\n${postalAddress}` : ""}`;
  const footerHtml = `<p style="margin:0 0 8px">${es ? "Puedes dejar de recibir consejos sin afectar avisos esenciales de tu cuenta." : "You can stop product tips without affecting essential account notices."}</p><p style="margin:0 0 8px"><a href="${escapeEmailHtml(unsubscribe)}">${es ? "Dejar de recibir consejos" : "Stop product tips"}</a> · <a href="${escapeEmailHtml(preference)}">${es ? "Preferencias" : "Preferences"}</a></p>${postalAddress ? `<p style="margin:0 0 8px">${escapeEmailHtml(postalAddress)}</p>` : ""}`;
  return {
    to: [candidate.email],
    reply_to: support,
    subject: content.subject,
    text: `${content.body}\n\n${content.action}: ${content.href}\n\n${footer}\n\n${brandedEmailTextFooter(candidate.language)}`,
    html: notificationFrame(candidate.language, content.subject,
      `<p style="font-size:16px;line-height:1.65">${escapeEmailHtml(content.body)}</p>${brandedEmailButton(content.href, content.action)}`, footerHtml),
  };
}
