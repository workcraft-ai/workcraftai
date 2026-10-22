import { brandedEmailButton, brandedEmailFrame, brandedEmailTextFooter, escapeEmailHtml } from "./branded-email.mjs";

const emailCopy = {
  signup: {
    en: ["Confirm your WorkCraft AI email", "ACCOUNT SETUP", "One quick step, then you're ready to get to work.", "Confirm email", "Confirm your email to finish creating your account."],
    es: ["Confirma tu correo de WorkCraft AI", "CONFIGURACIÓN DE LA CUENTA", "Un paso más y podrás empezar a trabajar.", "Confirmar correo", "Confirma tu correo para terminar de crear tu cuenta."],
  },
  recovery: {
    en: ["Reset your WorkCraft AI password", "ACCOUNT SECURITY", "A secure way back into your account.", "Reset password", "We received a request to reset your password. Use the button below to choose a new one."],
    es: ["Restablece tu contraseña de WorkCraft AI", "SEGURIDAD DE LA CUENTA", "Vuelve a acceder a tu cuenta de forma segura.", "Restablecer contraseña", "Recibimos una solicitud para restablecer tu contraseña. Usa el botón para elegir una nueva."],
  },
  invite: {
    en: ["Your WorkCraft AI invitation", "YOU'RE INVITED", "Your WorkCraft AI invitation is ready.", "Accept invitation", "You've been invited to join WorkCraft AI. Open your invitation to get started."],
    es: ["Tu invitación a WorkCraft AI", "TIENES UNA INVITACIÓN", "Tu invitación a WorkCraft AI está lista.", "Aceptar invitación", "Te invitaron a WorkCraft AI. Abre tu invitación para comenzar."],
  },
  magiclink: {
    en: ["Sign in to WorkCraft AI", "SECURE SIGN-IN", "Your sign-in link is ready.", "Sign in", "Use this secure link to sign in to your WorkCraft AI account."],
    es: ["Inicia sesión en WorkCraft AI", "INICIO DE SESIÓN SEGURO", "Tu enlace para iniciar sesión está listo.", "Iniciar sesión", "Usa este enlace seguro para iniciar sesión en tu cuenta de WorkCraft AI."],
  },
  email_change: {
    en: ["Confirm your email change", "ACCOUNT SECURITY", "Confirm this change to keep your account current.", "Confirm email change", "A change to your account email was requested. Confirm this address to complete the change."],
    es: ["Confirma el cambio de correo", "SEGURIDAD DE LA CUENTA", "Confirma este cambio para mantener tu cuenta actualizada.", "Confirmar cambio de correo", "Se solicitó cambiar el correo de tu cuenta. Confirma esta dirección para completar el cambio."],
  },
  email: {
    en: ["Verify your email", "ACCOUNT SECURITY", "Verify this email address for your account.", "Verify email", "Use the button below to verify this email address for WorkCraft AI."],
    es: ["Verifica tu correo", "SEGURIDAD DE LA CUENTA", "Verifica esta dirección de correo para tu cuenta.", "Verificar correo", "Usa el botón para verificar esta dirección de correo para WorkCraft AI."],
  },
  reauthentication: {
    en: ["Your verification code", "ACCOUNT SECURITY", "Use this code to finish your security check.", "Verification code", "Enter the code below in WorkCraft AI to confirm this sensitive action."],
    es: ["Tu código de verificación", "SEGURIDAD DE LA CUENTA", "Usa este código para terminar la verificación.", "Código de verificación", "Ingresa el siguiente código en WorkCraft AI para confirmar esta acción."],
  },
  notification: {
    en: ["WorkCraft AI security notification", "ACCOUNT SECURITY", "An account security update.", "", "A security change was made to your account."],
    es: ["Aviso de seguridad de WorkCraft AI", "SEGURIDAD DE LA CUENTA", "Una actualización de seguridad de tu cuenta.", "", "Se realizó un cambio de seguridad en tu cuenta."],
  },
};

/** Build Auth mail only from a verified Supabase hook. Never trust caller hosts. */
export function authEmailMessages(payload, supabaseUrl, appOrigin) {
  const user = payload.user;
  const emailData = payload.email_data;
  if (!user || typeof user.email !== "string" || !emailData || typeof emailData.email_action_type !== "string") {
    throw new Error("INVALID_AUTH_MAIL");
  }
  const action = emailData.email_action_type;
  const language = user.user_metadata?.app_language === "es" ? "es" : "en";
  const copy = emailCopy[action] || (action.endsWith("_notification") ? emailCopy.notification : null);
  if (!copy) throw new Error("UNSUPPORTED_AUTH_ACTION");
  const [title, eyebrow, preheader, buttonLabel, intro] = copy[language];
  const appUrl = new URL(appOrigin);
  const supportUrl = new URL("/support", appUrl).href;
  let redirect = new URL("/auth/confirm", appUrl).href;
  if (typeof emailData.redirect_to === "string") {
    const candidate = new URL(emailData.redirect_to);
    if (candidate.origin === appUrl.origin) redirect = candidate.href;
  }
  const messages = [];
  const build = (recipient, hash, code) => {
    if (typeof recipient !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient) || recipient.length > 320) {
      throw new Error("INVALID_AUTH_RECIPIENT");
    }
    let link = "";
    if (hash) {
      if (typeof hash !== "string" || !/^[a-zA-Z0-9_-]{16,256}$/.test(hash)) throw new Error("INVALID_AUTH_TOKEN");
      const url = new URL("/auth/v1/verify", supabaseUrl);
      url.searchParams.set("token", hash);
      url.searchParams.set("type", action);
      url.searchParams.set("redirect_to", redirect);
      link = url.href;
    }
    const validCode = typeof code === "string" && /^\d{6,10}$/.test(code) ? code : "";
    const notRequested = language === "es"
      ? "¿No solicitaste esto? Puedes ignorar este correo. Si te preocupa la seguridad de tu cuenta, contacta a soporte."
      : "Didn't request this? You can ignore this email. If you're concerned about your account, contact support.";
    const fallback = language === "es"
      ? "Si el botón no funciona, copia este enlace y pégalo en tu navegador:"
      : "If the button doesn't work, copy and paste this link into your browser:";
    const codeHtml = validCode
      ? `<p style="margin:22px 0 8px;color:#59675e;font-size:14px;line-height:1.5">${language === "es" ? "Tu código de verificación:" : "Your verification code:"}</p><p style="margin:0 0 22px;color:#1d3029;font-size:28px;font-weight:700;letter-spacing:5px">${validCode}</p>`
      : "";
    const linkHtml = link
      ? `${brandedEmailButton(link, buttonLabel)}<p style="margin:0 0 8px;color:#59675e;font-size:13px;line-height:1.6">${fallback}</p><p style="margin:0 0 24px;font-size:13px;line-height:1.6;overflow-wrap:anywhere;word-break:break-word"><a href="${escapeEmailHtml(link)}" style="color:#8b3b22;text-decoration:underline">${escapeEmailHtml(link)}</a></p>`
      : "";
    const html = brandedEmailFrame({
      language, title, preheader, eyebrow,
      content: `<p style="margin:0 0 14px;color:#1d2925;font-size:16px;line-height:1.65">${escapeEmailHtml(intro)}</p>${linkHtml}${codeHtml}<p style="margin:24px 0 10px;color:#59675e;font-size:14px;line-height:1.6">${escapeEmailHtml(notRequested)}</p><p style="margin:0;color:#59675e;font-size:14px;line-height:1.6"><a href="${escapeEmailHtml(supportUrl)}" style="color:#8b3b22;text-decoration:underline">${language === "es" ? "Contactar a soporte" : "Contact support"}</a></p>`,
    });
    const text = [
      title, intro,
      link ? `${buttonLabel}: ${link}` : "",
      validCode ? `${language === "es" ? "Código de verificación" : "Verification code"}: ${validCode}` : "",
      notRequested, `${language === "es" ? "Soporte" : "Support"}: ${supportUrl}`,
      brandedEmailTextFooter(language),
    ].filter(Boolean).join("\n\n");
    messages.push({ to: [recipient], reply_to: "support@workcraftai.com", subject: title, text, html });
  };
  if (action === "email_change") {
    if (emailData.token_hash_new) build(user.email, emailData.token_hash_new, emailData.token);
    build(user.new_email, emailData.token_hash, emailData.token_new || emailData.token);
  } else if (["signup", "recovery", "invite", "magiclink", "email"].includes(action)) {
    build(user.email, emailData.token_hash, emailData.token);
  } else if (action === "reauthentication") {
    build(user.email, null, emailData.token);
  } else {
    build(user.email, null, null);
  }
  return messages;
}
