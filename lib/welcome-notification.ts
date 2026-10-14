import type { SupabaseClient, User } from "@supabase/supabase-js";
import { emailAddressFromConfig } from "@/lib/email-address";
import { enqueueNotification, escapeEmailHtml, notificationFrame, processNotifications } from "@/lib/notification-outbox";
import { getTrustedAppOrigin } from "@/lib/security.mjs";
import { onboardingEligible } from "@/lib/onboarding-cohort.mjs";
import { brandedEmailButton } from "@/lib/branded-email.mjs";

export function isNewConfirmedAccount(user: User) {
  return onboardingEligible(user);
}

export async function queueWelcomeNotification(admin: SupabaseClient, user: User) {
  if (!isNewConfirmedAccount(user) || !user.email) return;
  const appOrigin = getTrustedAppOrigin(process.env.NEXT_PUBLIC_APP_URL);
  if (!appOrigin) return;
  const spanish = user.user_metadata?.app_language === "es";
  const destination = `${appOrigin}/dashboard`;
  const planDestination = `${appOrigin}/profile#plan`;
  const support = emailAddressFromConfig(process.env.NEXT_PUBLIC_SUPPORT_EMAIL) || "support@workcraftai.com";
  const title = spanish ? "Bienvenido a WorkCraft AI" : "Welcome to WorkCraft AI";
  const intro = spanish
    ? "Tu cuenta está lista. Comienza con una cotización sencilla: agrega un cliente, el trabajo y tus precios; después revisa el enlace que verá el cliente."
    : "Your account is ready. Start with one simple estimate: add a customer, the work, and your prices; then preview the link your customer will see.";
  const button = spanish ? "Crear mi primera cotización" : "Create my first estimate";
  const steps = spanish
    ? ["Completa tu perfil y agrega tu logotipo.", "Agrega tus precios más usados al libro de precios.", "Crea una cotización y revisa lo que verá tu cliente."]
    : ["Complete your profile and add your logo.", "Add your most common rates to your price book.", "Create an estimate and preview what your customer will see."];
  const trialNote = spanish
    ? "Las cuentas aptas también pueden iniciar una prueba de Pro de 14 días desde Perfil o desde una oferta en la aplicación, sin tarjeta para comenzar. Agrega los datos de facturación antes de que termine para continuar a $9.99 al mes; si no, tu cuenta vuelve al plan Gratis y tus datos permanecen."
    : "Eligible accounts can also start one 14-day Pro trial from Profile or an offer shown in the app, with no card required to start. Add billing before it ends to continue at $9.99/month; otherwise, your account returns to Free and your saved data remains.";
  const planButton = spanish ? "Ver opciones de Pro" : "View Pro options";
  const queued = await enqueueNotification(admin, {
    user_id: user.id,
    source: "welcome",
    send_key: `welcome-${user.id}`,
    payload: {
      to: [user.email], reply_to: support, subject: title,
      text: `${title}\n\n${intro}\n\n${steps.map((step, index) => `${index + 1}. ${step}`).join("\n")}\n\n${button}: ${destination}\n\n${trialNote}\n${planButton}: ${planDestination}\n\n${spanish ? "¿Necesitas ayuda?" : "Need help?"} ${appOrigin}/help`,
      html: notificationFrame(spanish ? "es" : "en", title,
        `<p style="margin:0 0 18px;font-size:16px;line-height:1.65">${escapeEmailHtml(intro)}</p><p style="margin:0 0 12px;font-size:16px;font-weight:700">${spanish ? "Tus primeros pasos" : "Your first steps"}</p><ol style="margin:0 0 20px;padding-left:22px;color:#39483f;font-size:15px;line-height:1.75">${steps.map(step => `<li>${escapeEmailHtml(step)}</li>`).join("")}</ol>${brandedEmailButton(destination, button)}<p style="margin:0 0 16px;font-size:14px;line-height:1.65">${escapeEmailHtml(trialNote)}</p><p style="margin:0 0 16px;font-size:14px;line-height:1.6"><a href="${escapeEmailHtml(planDestination)}" style="color:#8b3b22;font-weight:700">${escapeEmailHtml(planButton)}</a></p><p style="margin:0;font-size:14px;line-height:1.6">${spanish ? "¿Necesitas una guía?" : "Need a hand?"} <a href="${escapeEmailHtml(`${appOrigin}/help`)}" style="color:#8b3b22">${spanish ? "Visita el centro de ayuda" : "Visit the help center"}</a>.</p>`),
    },
  });
  if (queued.status !== "sent") await processNotifications(admin, [queued.id], 1, 4_000);
}
