import type { SupabaseClient } from "@supabase/supabase-js";
import { getWorkCraftNoReplySender } from "@/lib/email-senders";
import { reserveAppEmail, releaseAppEmail } from "@/lib/email-quota";
import { getTrustedAppOrigin } from "@/lib/security.mjs";

export type NotificationMail = { from?: string; to: string[]; reply_to?: string; subject: string; text: string; html: string };
type Notification = { id: string; user_id: string | null; estimate_id: string | null; job_id: string | null; source: "estimate"|"proposal_question"|"invoice"|"follow_up"|"billing"|"auth"; send_key: string; payload: Partial<NotificationMail>; attempts: number; reservation_id: string | null; first_attempt_at: string | null; created_at: string };
export const escapeEmailHtml = (value: string) => value.replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]!);
export function notificationFrame(language: "en"|"es", title: string, content: string) {
  return `<html lang="${language}"><body style="margin:0;background:#f5f3ed;padding:24px;font-family:Arial,sans-serif;color:#1d2925"><div style="max-width:600px;margin:auto;background:white;border-radius:12px;padding:26px"><p style="font-weight:bold;font-size:20px">WorkCraft <span style="color:#a34223">AI</span></p><h1 style="font-size:22px">${escapeEmailHtml(title)}</h1>${content}</div></body></html>`;
}
export async function enqueueNotification(admin: SupabaseClient, value: {user_id?: string; estimate_id?: string|null; job_id?:string; source:Notification["source"]; send_key:string; payload:NotificationMail}) {
  const { data: existing, error: lookup } = await admin.from("notification_outbox").select("id,status,provider_email_id").eq("send_key",value.send_key).maybeSingle();
  if (lookup) throw new Error("Notification lookup failed.");
  if (existing) return existing as {id:string;status:string;provider_email_id:string|null};
  const {data,error}=await admin.from("notification_outbox").insert(value).select("id,status,provider_email_id").single();
  if(error?.code==="23505") {
    const {data: duplicate,error: retryError}=await admin.from("notification_outbox").select("id,status,provider_email_id").eq("send_key",value.send_key).single();
    if(retryError)throw new Error("Notification could not be queued.");return duplicate as {id:string;status:string;provider_email_id:string|null};
  }
  if(error)throw new Error("Notification could not be queued.");
  return data as {id:string;status:string;provider_email_id:string|null};
}
async function questionMail(admin:SupabaseClient,row:Notification):Promise<NotificationMail|null>{
 const questionId=row.send_key.replace(/^proposal-question-/,"");
 const [{data:q,error:questionError},{data:e,error:estimateError},{data:owner,error:ownerError}]=await Promise.all([
  admin.from("proposal_questions").select("customer_name,customer_email,message").eq("id",questionId).eq("user_id",row.user_id!).single(),
  admin.from("estimates").select("reference_number,client_name").eq("id",row.estimate_id!).single(),
  admin.auth.admin.getUserById(row.user_id!),
 ]);
 if(questionError||estimateError||ownerError||!owner.user?.email)throw new Error("question_lookup");
 const es=owner.user.user_metadata?.app_language==="es";const language=es?"es":"en";
 const reference=e.reference_number||"";const subject=es?`Nueva pregunta · ${reference} · ${q.customer_name}`:`New question · ${reference} · ${q.customer_name}`;
 const link=new URL(`/estimate/${row.estimate_id}`,getTrustedAppOrigin(process.env.NEXT_PUBLIC_APP_URL)!).href;
 const text=es?`${q.customer_name} (${q.customer_email}) hizo una pregunta sobre ${reference} para ${e.client_name}.\n\n${q.message}\n\n${link}\n\nResponde a este correo para contestarle al cliente.`:`${q.customer_name} (${q.customer_email}) asked about ${reference} for ${e.client_name}.\n\n${q.message}\n\n${link}\n\nReply to this email to respond to the customer.`;
 return {to:[owner.user.email],reply_to:q.customer_email,subject:subject.replace(/[\r\n]/g," ").slice(0,200),text,html:notificationFrame(language,es?"Nueva pregunta del cliente":"New customer question",`<p><strong>${escapeEmailHtml(reference)}</strong> · ${escapeEmailHtml(e.client_name||"")}</p><p>${escapeEmailHtml(q.customer_name)} · ${escapeEmailHtml(q.customer_email)}</p><blockquote>${escapeEmailHtml(q.message).replace(/\n/g,"<br>")}</blockquote><p><a href="${escapeEmailHtml(link)}">${es?"Abrir cotización":"Open estimate"}</a></p><p>${es?"Responde a este correo para contestarle al cliente.":"Reply to this email to respond to the customer."}</p>`)};
}
export async function processNotifications(admin:SupabaseClient, ids?:string[], limit=10, timeoutMs=8000){
 const apiKey=process.env.RESEND_API_KEY;
 if(!apiKey)return {sent:0,pending:ids?.length??0,results:[] as Array<{id:string;sent:boolean;quota?:unknown}>};
 const {data,error}=await admin.rpc("workcraft_claim_notifications",{p_limit:limit,p_ids:ids??null});
 if(error)throw new Error("Notification claim failed.");
 const rows=(data??[]) as Notification[];
 const results:Array<{id:string;sent:boolean;quota?:unknown}>=[];
 async function retry(row:Notification,reason:string,permanent=false,waitSeconds?:number){
  const age=row.first_attempt_at?Date.now()-new Date(row.first_attempt_at).getTime():0;
  // Resend only retains idempotency keys for 24h. Never automatically resend an
  // uncertain delivery after that window; retain a reviewable failure instead.
  const failed=permanent||age>=23*3600000||row.attempts>=10;
  const {error:updateError}=await admin.from("notification_outbox").update({status:failed?"failed":"pending",lease_until:null,last_error:reason,next_attempt_at:new Date(Date.now()+(waitSeconds??Math.min(3600,30*2**Math.min(row.attempts,7)))*1000).toISOString(),...(failed?{payload:{}}:{})}).eq("id",row.id);
  if(updateError)console.error("Notification retry bookkeeping failed.");
 }
 for(let offset=0;offset<rows.length;offset+=4){
  await Promise.all(rows.slice(offset,offset+4).map(async row=>{
   let quota:unknown;
   try{
    if(row.source==="auth"&&Date.now()-new Date(row.created_at).getTime()>10*60000){await retry(row,"auth_link_expired",true);results.push({id:row.id,sent:false});return;}
    if(row.first_attempt_at&&Date.now()-new Date(row.first_attempt_at).getTime()>=23*3600000){await retry(row,"idempotency_window_expired",true);results.push({id:row.id,sent:false});return;}
    const mail=row.source==="proposal_question"?await questionMail(admin,row):row.payload as NotificationMail;
    if(!mail?.to?.length||!mail.subject||!mail.html){await retry(row,"invalid_mail",true);results.push({id:row.id,sent:false});return;}
    if(!row.reservation_id){
     const {reservation,error:reserveError}=await reserveAppEmail(admin,row.source,row.user_id??undefined,row.source==="invoice"?undefined:row.estimate_id??undefined,row.job_id??undefined);
     if(reserveError||!reservation?.allowed||!reservation.reservation_id){await retry(row,reserveError?"quota_lookup":reservation?.reason??"quota_lookup",false,3600);results.push({id:row.id,sent:false});return;}
     quota=reservation;
     const {error:saveError}=await admin.from("notification_outbox").update({reservation_id:reservation.reservation_id,first_attempt_at:new Date().toISOString()}).eq("id",row.id);
     if(saveError){await releaseAppEmail(admin,reservation.reservation_id);throw new Error("quota_save");}
     row.reservation_id=reservation.reservation_id;
    }
    const response=await fetch("https://api.resend.com/emails",{method:"POST",signal:AbortSignal.timeout(timeoutMs),headers:{Authorization:`Bearer ${apiKey}`,"Content-Type":"application/json","Idempotency-Key":row.send_key},body:JSON.stringify({...mail,from:mail.from||getWorkCraftNoReplySender()})});
    if(!response.ok){
     const permanent=response.status>=400&&response.status<500&&![408,409,425,429].includes(response.status);
     if(permanent&&row.reservation_id)await releaseAppEmail(admin,row.reservation_id);
     await retry(row,`provider_${response.status}`,permanent);results.push({id:row.id,sent:false,quota});return;
    }
    const result=await response.json();
    if(typeof result.id!=="string")throw new Error("provider_id_missing");
    const {error:finishError}=await admin.rpc("workcraft_finish_notification",{p_id:row.id,p_email_id:result.id,p_recipient:mail.to[0]});
    if(finishError)throw new Error("sent_bookkeeping");
    results.push({id:row.id,sent:true,quota});
   }catch(error){await retry(row,error instanceof Error&&/^[a-z_]+$/.test(error.message)?error.message:"request_uncertain");results.push({id:row.id,sent:false,quota});}
  }));
 }
 return {sent:results.filter(r=>r.sent).length,pending:results.filter(r=>!r.sent).length,results};
}
