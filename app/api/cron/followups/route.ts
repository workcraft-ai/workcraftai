import { customerShareUrl } from "@/lib/proposal-sharing";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { getTrustedAppOrigin } from "@/lib/security.mjs";
import { enqueueNotification, processNotifications, notificationFrame, escapeEmailHtml } from "@/lib/notification-outbox";

export const maxDuration = 60;
export async function POST(request: Request) {
 const secret=process.env.CRON_SECRET;
 if(!secret||!process.env.SUPABASE_SERVICE_ROLE_KEY||!process.env.RESEND_API_KEY)return NextResponse.json({error:"Email service is not configured."},{status:503});
 if(request.headers.get("authorization")!==`Bearer ${secret}`)return NextResponse.json({error:"Unauthorized."},{status:401});
 const origin=getTrustedAppOrigin(process.env.NEXT_PUBLIC_APP_URL);
 if(!origin)return NextResponse.json({error:"App URL is not configured."},{status:503});
 const admin=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false},global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(5000)})}});
 try{
  // At most 4 old and 4 newly scheduled notifications: each batch uses four
  // workers with an 8s provider timeout, comfortably below the 60s budget.
  const pending=await processNotifications(admin,undefined,4,6000);
  const {data:due,error}=await admin.rpc("workcraft_claim_estimate_followups",{p_limit:4});
  if(error)throw new Error("followup_claim");
  const ids:string[]=[];
  for(const estimate of due??[]){
   const {data:owner,error:ownerError}=await admin.auth.admin.getUserById(estimate.user_id);
   if(ownerError||!owner.user?.email){await admin.rpc("workcraft_finish_estimate_followup",{p_estimate_id:estimate.id,p_sent:false});continue;}
   const es=estimate.proposal_language==="es";const language=es?"es":"en";
   let link:string;
   try { link=await customerShareUrl(admin,estimate.id); }
   catch { await admin.rpc("workcraft_finish_estimate_followup",{p_estimate_id:estimate.id,p_sent:false}); continue; }
   const title=es?`Seguimiento de tu cotización ${estimate.reference_number}`:`Following up on your estimate ${estimate.reference_number}`;
   const intro=es?`Hola ${estimate.client_name||""}, ¿tienes alguna pregunta sobre tu cotización?`:`Hi ${estimate.client_name||"there"}, do you have any questions about your estimate?`;
   const action=es?"Ver cotización":"View estimate";
   const queued=await enqueueNotification(admin,{user_id:estimate.user_id,estimate_id:estimate.id,source:"follow_up",send_key:`estimate-followup-${estimate.id}`,payload:{to:[estimate.client_email],reply_to:owner.user.email,subject:title,text:`${intro}\n\n${action}: ${link}`,html:notificationFrame(language,title,`<p>${escapeEmailHtml(intro)}</p><p><a href="${escapeEmailHtml(link)}">${action}</a></p>`)}});
   ids.push(queued.id);
  }
  const scheduled=ids.length?await processNotifications(admin,ids,4,6000):{sent:0,pending:0};
  // Bounded retention: no indefinite storage of notification contents/tokens.
  await admin.from("email_delivery_inbox").delete().lt("received_at",new Date(Date.now()-7*86400000).toISOString());
  await admin.from("notification_outbox").delete().in("status",["sent","failed"]).lt("created_at",new Date(Date.now()-90*86400000).toISOString());
  return NextResponse.json({sent:pending.sent+scheduled.sent,pending:pending.pending+scheduled.pending,checked:(due??[]).length});
 }catch{console.error("Scheduled notifications could not complete.");return NextResponse.json({error:"Scheduled notifications are temporarily unavailable."},{status:503});}
}
// Vercel Cron invokes GET. Both methods require the same secret.
export const GET = POST;
