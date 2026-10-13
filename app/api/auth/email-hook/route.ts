import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { readLimitedText } from "@/lib/read-limited-body.mjs";
import { verifyResendWebhook } from "@/lib/resend-webhook.mjs";
import { getTrustedAppOrigin } from "@/lib/security.mjs";
import { getServiceSupabase } from "@/lib/stripe-server";
import { authEmailMessages } from "@/lib/auth-email.mjs";
import { sendAuthMessages } from "@/lib/auth-email-send.mjs";
import { createBoundedFetch } from "@/lib/bounded-fetch";
import { getWorkCraftNoReplySender } from "@/lib/email-senders";
export const runtime = "nodejs";
export const maxDuration = 10;
export async function POST(request: Request) {
 const deadlineAt = Date.now() + 4_300;
 const secret = process.env.SUPABASE_SEND_EMAIL_HOOK_SECRET?.replace(/^v1,/, "");
 const origin = getTrustedAppOrigin(process.env.NEXT_PUBLIC_APP_URL);
 const apiKey = process.env.RESEND_API_KEY;
 if (!secret || !origin || !apiKey) return failure("Email hook is not configured.");
 const raw = await readLimitedText(request, 32_000, 500);
 if (!raw.ok) return failure("Invalid email hook.", 400);
 if (!verifyResendWebhook(secret, raw.value, {"svix-id":request.headers.get("webhook-id")??"", "svix-timestamp":request.headers.get("webhook-timestamp")??"", "svix-signature":request.headers.get("webhook-signature")??""})) return failure("Invalid hook signature.",401);
 try {
  const payload=JSON.parse(raw.value);
  const messages=authEmailMessages(payload,process.env.NEXT_PUBLIC_SUPABASE_URL!,origin).map((mail,index)=>({mail:{...mail,from:getWorkCraftNoReplySender()},sendKey:`auth-${createHash("sha256").update(`${payload.user.id}:${payload.email_data.email_action_type}:${payload.email_data.token_hash}:${payload.email_data.token}:${index}`).digest("hex")}`}));
  const admin=getServiceSupabase(900,deadlineAt);
  await sendAuthMessages({messages,apiKey,providerFetch:createBoundedFetch(1_800,deadlineAt),
   prepare:async(sendKey:string)=>{const {data,error}=await admin.rpc("workcraft_prepare_auth_email",{p_send_key:sendKey});if(error)throw new Error("Auth admission unavailable.");return data;},
   finish:async(id:string,emailId:string,recipient:string)=>{const {data,error}=await admin.rpc("workcraft_finish_notification",{p_id:id,p_email_id:emailId,p_recipient:recipient});if(error||data!==true)throw new Error("Auth recording unavailable.");},
   retire:async(id:string)=>{await admin.from("notification_outbox").update({status:"failed",payload:{},lease_until:null,last_error:"auth_request_failed"}).eq("id",id).neq("status","sent");},
  });
  return NextResponse.json({});
 } catch {console.error("Synchronous Auth email failed; no token or recipient logged.");return failure("Email is temporarily unavailable. Please try again later.");}
}
function failure(message:string,status=503){return NextResponse.json({error:{http_code:status,message}},{status});}
