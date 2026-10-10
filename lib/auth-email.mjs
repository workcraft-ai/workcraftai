/** Build Auth mail only from a verified Supabase hook. Never trust caller hosts. */
export function authEmailMessages(payload, supabaseUrl, appOrigin) {
 const user=payload.user;const e=payload.email_data;
 if(!user||typeof user.email!=="string"||!e||typeof e.email_action_type!=="string")throw new Error("INVALID_AUTH_MAIL");
 const action=e.email_action_type;const es=user.user_metadata?.app_language==="es";
 const subjects={signup:["Confirm your WorkCraft AI email","Confirma tu correo de WorkCraft AI"],recovery:["Reset your WorkCraft AI password","Restablece tu contraseña de WorkCraft AI"],invite:["Your WorkCraft AI invitation","Tu invitación a WorkCraft AI"],magiclink:["Sign in to WorkCraft AI","Inicia sesión en WorkCraft AI"],email_change:["Confirm your email change","Confirma el cambio de correo"],email:["Verify your email","Verifica tu correo"],reauthentication:["Your verification code","Tu código de verificación"]};
 const title=subjects[action]?.[es?1:0]??(es?"Aviso de seguridad de WorkCraft AI":"WorkCraft AI security notification");
 const escape=v=>String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
 let redirect=new URL("/auth/confirm",appOrigin).href;
 if(typeof e.redirect_to==="string"){const candidate=new URL(e.redirect_to);if(candidate.origin===new URL(appOrigin).origin)redirect=candidate.href;}
 const messages=[];
 const build=(recipient,hash,code)=>{
  if(typeof recipient!=="string"||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)||recipient.length>320)throw new Error("INVALID_AUTH_RECIPIENT");
  let link="";
  if(hash){if(typeof hash!=="string"||! /^[a-zA-Z0-9_-]{16,256}$/.test(hash))throw new Error("INVALID_AUTH_TOKEN");const url=new URL("/auth/v1/verify",supabaseUrl);url.searchParams.set("token",hash);url.searchParams.set("type",action);url.searchParams.set("redirect_to",redirect);link=url.href;}
  const instruction=es?"Si solicitaste esta acción, usa el enlace o código. Si no, puedes ignorar este correo y contactar a soporte.":"If you requested this action, use the link or code. Otherwise, ignore this email and contact support.";
  const details=link?`${es?"Continuar":"Continue"}: ${link}`:typeof code==="string"&&/^\d{6,10}$/.test(code)?code:es?"Se realizó un cambio de seguridad en tu cuenta. Contacta a soporte si no lo solicitaste.":"A security change was made to your account. Contact support if you did not request it.";
  messages.push({to:[recipient],reply_to:"support@workcraftai.com",subject:title,text:`${title}\n\n${instruction}\n\n${details}`,html:`<html lang="${es?"es":"en"}"><body style="font-family:Arial,sans-serif;color:#1d2925;padding:24px"><p style="font-size:20px;font-weight:bold">WorkCraft AI</p><h1 style="font-size:22px">${escape(title)}</h1><p>${escape(instruction)}</p>${link?`<p><a href="${escape(link)}">${es?"Continuar":"Continue"}</a></p>`:`<p>${escape(details)}</p>`}</body></html>`});
 };
 if(action==="email_change"){
  if(e.token_hash_new)build(user.email,e.token_hash_new,e.token);
  build(user.new_email,e.token_hash,e.token_new||e.token);
 }else if(["signup","recovery","invite","magiclink","email"].includes(action))build(user.email,e.token_hash,e.token);
 else if(action==="reauthentication")build(user.email,null,e.token);
 else if(action.endsWith("_notification"))build(user.email,null,null);
 else throw new Error("UNSUPPORTED_AUTH_ACTION");
 return messages;
}
