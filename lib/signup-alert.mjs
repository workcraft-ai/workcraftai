import { brandedEmailFrame, escapeEmailHtml } from "./branded-email.mjs";

export function buildSignupAlert(user) {
  const created = new Date(user.created_at).toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" });
  const verification = user.email_confirmed_at ? "Verified" : "Not yet verified";
  const title = "New WorkCraft AI account";
  return {
    to: ["alerts@workcraftai.com"], subject: title,
    text: `A new account was created.\n\nEmail: ${user.email}\nSigned up: ${created} Eastern Time\nEmail verification: ${verification} (when this alert was sent)`,
    html: brandedEmailFrame({ language: "en", title, preheader: title, eyebrow: "WORKCRAFT AI UPDATE",
      content: `<p>A new account was created.</p><p><strong>Email:</strong> ${escapeEmailHtml(user.email)}<br><strong>Signed up:</strong> ${escapeEmailHtml(created)} Eastern Time<br><strong>Email verification:</strong> ${verification} (when this alert was sent)</p>` }),
  };
}
