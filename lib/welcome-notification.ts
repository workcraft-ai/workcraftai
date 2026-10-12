import type { SupabaseClient, User } from "@supabase/supabase-js";
import { emailAddressFromConfig } from "@/lib/email-address";
import { enqueueNotification, escapeEmailHtml, notificationFrame, processNotifications } from "@/lib/notification-outbox";
import { getTrustedAppOrigin } from "@/lib/security.mjs";
import { SIGNUP_TERMS_VERSION } from "@/lib/signup-terms";

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
  const queued = await enqueueNotification(admin, {
    user_id: user.id,
    source: "welcome",
    send_key: `welcome-${user.id}`,
    payload: {
      to: [user.email], reply_to: support, subject: title,
      text: `${title}\n\n${intro}\n\n${button}: ${destination}\n\n${spanish ? "¿Necesitas ayuda?" : "Need help?"} ${appOrigin}/help`,
      html: notificationFrame(spanish ? "es" : "en", title,
        `<p>${escapeEmailHtml(intro)}</p><p><a href="${escapeEmailHtml(destination)}" style="display:inline-block;background:#9a3b21;color:#fff;padding:14px 18px;border-radius:8px;text-decoration:none;font-weight:bold">${escapeEmailHtml(button)}</a></p><p><a href="${escapeEmailHtml(`${appOrigin}/help`)}">${spanish ? "Centro de ayuda" : "Help center"}</a></p>`),
    },
  });
  if (queued.status !== "sent") await processNotifications(admin, [queued.id], 1, 4_000);
}
