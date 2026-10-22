export const escapeEmailHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]);

export function brandedEmailButton(url, label) {
  return `<table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin:26px 0 22px;border-collapse:separate"><tr><td bgcolor="#9a3b21" style="border-radius:9px;background:#9a3b21"><a href="${escapeEmailHtml(url)}" style="display:inline-block;box-sizing:border-box;min-height:48px;padding:15px 24px;border-radius:9px;color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:700;line-height:20px;text-decoration:none">${escapeEmailHtml(label)}</a></td></tr></table>`;
}

const socialLinks = [
  ["Facebook", "https://www.facebook.com/profile.php?id=61595227071773", "facebook.png"],
  ["Instagram", "https://www.instagram.com/workcraftai/", "instagram.png"],
  ["LinkedIn", "https://www.linkedin.com/company/workcraft-ai", "linkedin.png"],
];

export function brandedEmailFooter(language, extra = "") {
  const spanish = language === "es";
  const links = [
    [spanish ? "Ayuda" : "Help", "https://app.workcraftai.com/help"],
    [spanish ? "Privacidad" : "Privacy", "https://app.workcraftai.com/privacy"],
    [spanish ? "Términos" : "Terms", "https://app.workcraftai.com/terms"],
    [spanish ? "Contacto" : "Contact", "mailto:support@workcraftai.com"],
  ];
  const anchor = ([label, url]) => `<a href="${escapeEmailHtml(url)}" style="color:#315746;text-decoration:underline">${escapeEmailHtml(label)}</a>`;
  const socialCells = socialLinks.map(([label, url, image]) => `<td style="padding:0 9px"><a href="${escapeEmailHtml(url)}" aria-label="${escapeEmailHtml(label)}" style="display:inline-block"><img src="https://app.workcraftai.com/email/social/${image}" alt="${escapeEmailHtml(label)}" width="24" height="24" border="0" style="display:block;width:24px;height:24px;border:0"></a></td>`).join("");
  return `<div style="margin-top:28px;padding-top:18px;border-top:1px solid #e4e8e1;color:#59675e;font-size:12px;line-height:1.7;text-align:center"><p style="margin:0 0 8px">© ${new Date().getUTCFullYear()} WorkCraft AI · ${spanish ? "Sigue haciendo buen trabajo." : "Keep good work moving."}</p><p style="margin:0 0 12px">${links.map(anchor).join(" &nbsp;·&nbsp; ")}</p>${extra}<table role="presentation" align="center" border="0" cellpadding="0" cellspacing="0" style="margin:12px auto 0;border-collapse:collapse"><tr>${socialCells}</tr></table></div>`;
}

export function brandedEmailTextFooter(language) {
  const spanish = language === "es";
  return `© ${new Date().getUTCFullYear()} WorkCraft AI\n${spanish ? "Ayuda" : "Help"}: https://app.workcraftai.com/help · ${spanish ? "Privacidad" : "Privacy"}: https://app.workcraftai.com/privacy · ${spanish ? "Términos" : "Terms"}: https://app.workcraftai.com/terms\n${spanish ? "Contacto" : "Contact"}: support@workcraftai.com\n${socialLinks.map(([label, url]) => `${label}: ${url}`).join(" · ")}`;
}

export function brandedEmailFrame({ language, title, preheader, eyebrow, content, footerExtra = "" }) {
  const lang = language === "es" ? "es" : "en";
  const tagline = lang === "es" ? "Para quienes hacen el trabajo." : "For the people who get the work done.";
  return `<!doctype html><html lang="${lang}" dir="ltr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeEmailHtml(title)}</title></head><body style="margin:0;padding:0;background:#f4f2ec;color:#1d2925;font-family:Arial,Helvetica,sans-serif"><div lang="${lang}" dir="ltr" style="margin:0;padding:0"><div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all">${escapeEmailHtml(preheader || title)}</div><table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;background:#f4f2ec"><tr><td align="center" style="padding:28px 14px 36px"><table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="width:100%;max-width:600px;border-collapse:separate;border-spacing:0"><tr><td style="padding:20px 26px;background:#1d3029;border-radius:14px 14px 0 0"><p style="margin:0;color:#ffffff;font-size:22px;font-weight:800;line-height:1.2;letter-spacing:-.3px">WorkCraft <span style="color:#f5ad83">AI</span></p><p style="margin:5px 0 0;color:#d5e0d6;font-size:12px;line-height:1.5">${tagline}</p></td></tr><tr><td style="padding:30px 28px 28px;background:#ffffff;border:1px solid #d9dfd8;border-top:0;border-radius:0 0 14px 14px"><p style="margin:0 0 12px;color:#8b3b22;font-size:12px;font-weight:700;line-height:1.4;letter-spacing:1.4px;text-transform:uppercase">${escapeEmailHtml(eyebrow || (lang === "es" ? "Actualización de WorkCraft AI" : "WorkCraft AI update"))}</p><h1 style="margin:0 0 18px;color:#1d2925;font-size:25px;line-height:1.3;font-weight:800">${escapeEmailHtml(title)}</h1>${content}${brandedEmailFooter(lang, footerExtra)}</td></tr></table></td></tr></table></div></body></html>`;
}
