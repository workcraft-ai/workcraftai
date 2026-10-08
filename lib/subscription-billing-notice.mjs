function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

export function shouldSendPastDueNotice({ eventType, eventStatus, previousStatus, currentStatus }) {
  if (eventStatus !== "past_due" || currentStatus !== "past_due") return false;
  if (eventType === "customer.subscription.created") return true;
  return eventType === "customer.subscription.updated"
    && typeof previousStatus === "string"
    && previousStatus !== "past_due";
}

export function pastDueNoticeIdempotencyKey(eventId) {
  return `workcraft-pro-past-due-${eventId}`;
}

export function buildPastDueBillingEmail({ language, billingUrl, supportEmail }) {
  const isSpanish = language === "es";
  const safeBillingUrl = escapeHtml(billingUrl);
  const safeSupportEmail = escapeHtml(supportEmail);
  const supportHref = `mailto:${encodeURIComponent(supportEmail)}`;

  const subject = isSpanish
    ? "Tu suscripción a WorkCraft AI Pro está vencida"
    : "Your WorkCraft AI Pro subscription is past due";
  const preheader = isSpanish
    ? "Tu acceso Pro cambió al plan gratuito. Actualiza la facturación para restaurarlo; tus datos siguen guardados."
    : "Pro access moved to Free. Update billing to restore Pro; your saved data is preserved.";
  const title = isSpanish ? "Pago de Pro vencido" : "Pro payment past due";
  const paymentIssue = isSpanish
    ? "Stripe no pudo cobrar el pago más reciente de tu suscripción a WorkCraft AI Pro."
    : "Stripe could not collect the latest payment for your WorkCraft AI Pro subscription.";
  const accessChange = isSpanish
    ? "Tu acceso Pro cambió de inmediato al plan gratuito. Tus cotizaciones, trabajos y demás datos guardados permanecen en tu cuenta. No se eliminó nada."
    : "Your Pro access moved to the Free plan immediately. Your saved estimates, jobs, and other account data remain available. Nothing was deleted.";
  const instructions = isSpanish
    ? "Para restaurar Pro, inicia sesión, abre Perfil y selecciona Administrar facturación. Actualiza tu método de pago o paga la factura pendiente. Stripe restaurará el acceso Pro cuando confirme el pago."
    : "To restore Pro, sign in, open Profile, and select Manage billing. Update your payment method or pay the open invoice. Stripe will restore Pro access after it confirms payment.";
  const button = isSpanish ? "Actualizar facturación" : "Update billing";
  const scope = isSpanish
    ? "Este aviso corresponde únicamente a tu suscripción de WorkCraft AI. Los pagos que tus clientes hacen directamente a tu cuenta conectada de Stripe se administran en Stripe."
    : "This notice is only about your WorkCraft AI subscription. Payments your customers make directly to your connected Stripe account are managed through Stripe.";
  const contact = isSpanish ? "Si crees que esto es un error, contáctanos:" : "If you think this is a mistake, contact us:";

  const html = `<!doctype html><html lang="${isSpanish ? "es" : "en"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(subject)}</title></head><body style="margin:0;background:#f4f1e8;color:#1d2925;font-family:Arial,sans-serif"><div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(preheader)}</div><main style="box-sizing:border-box;max-width:640px;margin:0 auto;padding:28px 16px"><div style="background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:28px 24px"><p style="margin:0 0 22px;color:#1d2925;font-size:16px;font-weight:700">WorkCraft AI</p><h1 style="margin:0 0 18px;color:#1d2925;font-size:24px;line-height:1.3">${escapeHtml(title)}</h1><p style="font-size:16px;line-height:1.6">${escapeHtml(paymentIssue)}</p><p style="font-size:16px;line-height:1.6"><strong>${escapeHtml(accessChange)}</strong></p><p style="font-size:16px;line-height:1.6">${escapeHtml(instructions)}</p><p style="margin:24px 0"><a href="${safeBillingUrl}" style="display:inline-block;min-height:48px;box-sizing:border-box;border-radius:8px;background:#c85b2d;padding:14px 20px;color:#fff;font-size:16px;font-weight:700;line-height:20px;text-decoration:none">${escapeHtml(button)}</a></p><p style="font-size:13px;line-height:1.6;color:#52605a">${escapeHtml(scope)}</p><p style="font-size:13px;line-height:1.6;color:#52605a">${escapeHtml(contact)} <a href="${supportHref}" style="color:#8e3d1e">${safeSupportEmail}</a></p></div></main></body></html>`;
  const text = `${title}\n\n${paymentIssue}\n\n${accessChange}\n\n${instructions}\n\n${button}: ${billingUrl}\n\n${scope}\n\n${contact} ${supportEmail}`;

  return { subject, html, text };
}
