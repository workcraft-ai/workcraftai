import { createHash, createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createUserSupabaseClient } from "@/app/utils/supabase/server";
import { getTrustedAppOrigin } from "@/lib/security.mjs";

type ShareState={user_id:string;share_token_hash:string|null;share_revoked_at:string|null;share_expires_at:string|null};
const encryptionKey=()=>createHash("sha256").update(`workcraft-proposal-sharing-v1:${process.env.SUPABASE_SERVICE_ROLE_KEY}`).digest();
export function encryptShareToken(token:string){const iv=randomBytes(12);const cipher=createCipheriv("aes-256-gcm",encryptionKey(),iv);const encrypted=Buffer.concat([cipher.update(token,"utf8"),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString("base64url");}
function decryptShareToken(value:string){const data=Buffer.from(value,"base64url");const cipher=createDecipheriv("aes-256-gcm",encryptionKey(),data.subarray(0,12));cipher.setAuthTag(data.subarray(12,28));return Buffer.concat([cipher.update(data.subarray(28)),cipher.final()]).toString("utf8");}
export async function customerShareAllowed(admin:SupabaseClient,id:string,request:Request,allowOwner=false){
 const {data,error}=await admin.from("estimates").select("user_id,share_token_hash,share_revoked_at,share_expires_at").eq("id",id).maybeSingle();
 if(error)throw new Error("Share validation failed.");if(!data)return false;
 const state=data as ShareState;
 if(allowOwner&&request.headers.has("cookie")){
  const userClient=await createUserSupabaseClient();const {data:{user}}=await userClient.auth.getUser();
  if(user?.id===state.user_id)return true;
 }
 if(state.share_revoked_at||(state.share_expires_at&&new Date(state.share_expires_at).getTime()<=Date.now()))return false;
 if(!state.share_token_hash)return true; // Existing UUID links survive until the owner replaces/disables them.
 const token=new URL(request.url).searchParams.get("token")??"";
 if(!/^[A-Za-z0-9_-]{43}$/.test(token))return false;
 return timingSafeEqual(Buffer.from(state.share_token_hash,"hex"),createHash("sha256").update(token).digest());
}
export async function customerShareUrl(admin:SupabaseClient,id:string){
 const {data,error}=await admin.from("estimates").select("share_token_hash,share_revoked_at,share_expires_at").eq("id",id).single();
 if(error||data.share_revoked_at||(data.share_expires_at&&new Date(data.share_expires_at).getTime()<=Date.now()))throw new Error("Customer sharing is disabled or expired.");
 const url=new URL(`/estimate/${id}`,getTrustedAppOrigin(process.env.NEXT_PUBLIC_APP_URL)!);
 if(data.share_token_hash){const {data:encrypted,error:secretError}=await admin.rpc("workcraft_get_proposal_share_secret",{p_estimate_id:id});if(secretError||typeof encrypted!=="string")throw new Error("Share link unavailable.");url.searchParams.set("token",decryptShareToken(encrypted));}
 return url.href;
}
