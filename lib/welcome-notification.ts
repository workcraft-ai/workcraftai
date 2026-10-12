import type { SupabaseClient, User } from "@supabase/supabase-js";
import { emailAddressFromConfig } from "@/lib/email-address";
import { enqueueNotification, escapeEmailHtml, notificationFrame, processNotifications } from "@/lib/notification-outbox";
import { getTrustedAppOrigin } from "@/lib/security.mjs";
import { SIGNUP_TERMS_VERSION } from "@/lib/signup-terms";
import { brandedEmailButton } from "@/lib/branded-email.mjs";

export function isNewConfirmedAccount(user: User) {
  return user.user_metadata?.workcraft_terms_accepted === true &&
    user.user_metadata?.workcraft_terms_version === SIGNUP_TERMS_VERSION &&
    Boolean(user.email_confirmed_at && user.email);
}

export async function queueWelcomeNotification(admin: SupabaseClient, user: User) {
  if (!isNewConfirmedAccount(user) || !user.email) return;
  const appOrigin = getTrustedAppOrigin(process.env.NEXT_PUBLIC_APP_URL);
  if (!appOrigin) return;
  const spanish = user.user_metadata?.app_language === "es";
  const destination = `${appOrigin}/dashboard`;
  const support = emailAddressFromConfig(process.env.NEXT_PUBLIC_SUPPORT_EMAIL) || "support@workcraftai.com";
  const title = spanish ? "Bienvenido a WorkCraft AI" : "Welcome to WorkCraft AI";
  const intro = spanish
    ? "Tu cuenta está lista. Comienza con una cotización sencilla: agrega un cliente, el trabajo y tus precios; después revisa el enlace que verá el cliente."
    : "Your account is ready. Start with one simple estimate: add a customer, the work, and your prices; then preview the link your customer will see.";
  const button = spanish ? "Crear mi primera cotización" : "Create my first estimate";
  const steps = spanish
    ? ["Completa tu perfil y agrega tu logotipo.", "Agrega tus precios más usados al libro de precios.", "Crea una cotización y revisa lo que verá tu cliente."]
    : ["Complete your profile and add your logo.", "Add your most common rates to your price book.", "Create an estimate and preview what your customer will see."];
  const queued = await enqueueNotification(admin, {
    user_id: user.id,
    source: "welcome",
    send_key: `welcome-${user.id}`,
    payload: {
      to: [user.email], reply_to: support, subject: title,
      text: `${title}\n\n${intro}\n\n${steps.map((step, index) => `${index + 1}. ${step}`).join("\n")}\n\n${button}: ${destination}\n\n${spanish ? "¿Necesitas ayuda?" : "Need help?"} ${appOrigin}/help`,
      html: notificationFrame(spanish ? "es" : "en", title,
        `<p style="margin:0 0 18px;font-size:16px;line-height:1.65">${escapeEmailHtml(intro)}</p><p style="margin:0 0 12px;font-size:16px;font-weight:700">${spanish ? "Tus primeros pasos" : "Your first steps"}</p><ol style="margin:0 0 20px;padding-left:22px;color:#39483f;font-size:15px;line-height:1.75">${steps.map(step => `<li>${escapeEmailHtml(step)}</li>`).join("")}</ol>${brandedEmailButton(destination, button)}<p style="margin:0;font-size:14px;line-height:1.6">${spanish ? "¿Necesitas una guía?" : "Need a hand?"} <a href="${escapeEmailHtml(`${appOrigin}/help`)}" style="color:#8b3b22">${spanish ? "Visita el centro de ayuda" : "Visit the help center"}</a>.</p>`),
    },
  });
  if (queued.status !== "sent") await processNotifications(admin, [queued.id], 1, 4_000);
}
