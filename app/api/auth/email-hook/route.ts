import {createHash} from "node:crypto";
import {NextResponse} from "next/server";
import {readLimitedText} from "@/lib/read-limited-body.mjs";
import {verifyResendWebhook} from "@/lib/resend-webhook.mjs";
import {getTrustedAppOrigin} from "@/lib/security.mjs";
import {getServiceSupabase} from "@/lib/stripe-server";
import {authEmailMessages} from "@/lib/auth-email.mjs";
import {enqueueNotification,processNotifications} from "@/lib/notification-outbox";
export async function POST(request:Request){
 const secret=process.env.SUPABASE_SEND_EMAIL_HOOK_SECRET?.replace(/^v1,/,"");
 const origin=getTrustedAppOrigin(process.env.NEXT_PUBLIC_APP_URL);
 if(!secret||!origin||!process.env.RESEND_API_KEY)return NextResponse.json({error:{http_code:503,message:"Email hook is not configured."}},{status:503});
 const raw=await readLimitedText(request,32000);
 if(!raw.ok)return NextResponse.json({error:{http_code:400,message:"Invalid email hook."}},{status:400});
 // Supabase uses Standard Webhooks; the signed content and v1 HMAC algorithm
 // match Svix. Map the header names without parsing/changing the signed body.
 if(!verifyResendWebhook(secret,raw.value,{"svix-id":request.headers.get("webhook-id")??"","svix-timestamp":request.headers.get("webhook-timestamp")??"","svix-signature":request.headers.get("webhook-signature")??""}))return NextResponse.json({error:{http_code:401,message:"Invalid hook signature."}},{status:401});
 try{
  const payload=JSON.parse(raw.value);const messages=authEmailMessages(payload,process.env.NEXT_PUBLIC_SUPABASE_URL!,origin);
  const admin=getServiceSupabase();const ids:string[]=[];
  for(const [index,mail] of messages.entries()){
   // Stable across signed-hook retries, without exposing OTPs in the send key.
   const digest=createHash("sha256").update(`${payload.user.id}:${payload.email_data.email_action_type}:${payload.email_data.token_hash}:${payload.email_data.token}:${index}`).digest("hex");
   const row=await enqueueNotification(admin,{user_id:payload.user.id,source:"auth",send_key:`auth-${digest}`,payload:mail});
   if(row.status!=="sent")ids.push(row.id);
  }
  const result=ids.length?await processNotifications(admin,ids,2,3000):{pending:0};
  if(result.pending)return NextResponse.json({error:{http_code:429,message:"Email is temporarily limited. Please try again later."}},{status:429});
  return NextResponse.json({});
 }catch{console.error("Auth email hook failed; no token or recipient logged.");return NextResponse.json({error:{http_code:503,message:"Email is temporarily unavailable."}},{status:503});}
}
