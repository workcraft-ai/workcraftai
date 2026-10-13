import { createHash, timingSafeEqual } from "node:crypto";
import { encryptToken, decryptToken } from "@/lib/share-encryption.mjs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createUserSupabaseClient } from "@/app/utils/supabase/server";
import { getTrustedAppOrigin } from "@/lib/security.mjs";
import { isValidEstimateId, requestShareTokenHash } from "@/lib/proposal-share-token.mjs";
export { requestShareTokenHash } from "@/lib/proposal-share-token.mjs";

type ShareState={user_id:string;share_token_hash:string|null;share_revoked_at:string|null;share_expires_at:string|null};
export function encryptShareToken(token:string){return encryptToken(token,process.env.PROPOSAL_SHARE_ENCRYPTION_KEY);}
function decryptShareToken(value:string){return decryptToken(value,process.env.PROPOSAL_SHARE_ENCRYPTION_KEY,process.env.SUPABASE_SERVICE_ROLE_KEY);}
export async function customerShareAllowed(admin:SupabaseClient,id:string,request:Request,allowOwner=false){
 if(!isValidEstimateId(id))return false;
 const {data,error}=await admin.from("estimates").select("user_id,share_token_hash,share_revoked_at,share_expires_at").eq("id",id).maybeSingle();
 if(error)throw new Error("Share validation failed.");if(!data)return false;
 const state=data as ShareState;
 if(allowOwner&&request.headers.has("cookie")){
  const userClient=await createUserSupabaseClient();const {data:{user}}=await userClient.auth.getUser();
  if(user?.id===state.user_id)return true;
 }
 if(state.share_revoked_at||(state.share_expires_at&&new Date(state.share_expires_at).getTime()<=Date.now()))return false;
 if(!state.share_token_hash)return true; // Existing UUID links survive until the owner replaces/disables them.
 const hash=requestShareTokenHash(request);
 if(!hash)return false;
 return timingSafeEqual(Buffer.from(state.share_token_hash,"hex"),Buffer.from(hash,"hex"));
}
export async function customerShareUrl(admin:SupabaseClient,id:string){
 const {data,error}=await admin.from("estimates").select("share_token_hash,share_revoked_at,share_expires_at").eq("id",id).single();
 if(error||data.share_revoked_at||(data.share_expires_at&&new Date(data.share_expires_at).getTime()<=Date.now()))throw new Error("Customer sharing is disabled or expired.");
 const url=new URL(`/estimate/${id}`,getTrustedAppOrigin(process.env.NEXT_PUBLIC_APP_URL)!);
 if(data.share_token_hash){const {data:encrypted,error:secretError}=await admin.rpc("workcraft_get_proposal_share_secret",{p_estimate_id:id});if(secretError||typeof encrypted!=="string")throw new Error("Share link unavailable.");const token=decryptShareToken(encrypted);if(createHash("sha256").update(token).digest("hex")!==data.share_token_hash)throw new Error("Share link unavailable.");if(!encrypted.startsWith("v2:")){const {error}=await admin.rpc("workcraft_upgrade_share_secret",{p_id:id,p_previous:encrypted,p_current:encryptShareToken(token)});if(error)throw new Error("Share upgrade unavailable.");}url.searchParams.set("token",token);}
 return url.href;
}
/** Bounded CAS re-encryption never changes the public link or authorization hash. */
export async function upgradeLegacyShareSecrets(admin:SupabaseClient){
 if(!process.env.PROPOSAL_SHARE_ENCRYPTION_KEY)throw new Error("Share encryption is not configured.");
 const {data,error}=await admin.rpc("workcraft_legacy_share_secrets",{p_limit:10});
 if(error)throw new Error("Share migration lookup failed.");
 let upgraded=0;
 for(const row of data??[]){
  const token=decryptShareToken(row.encrypted_token);
  if(createHash("sha256").update(token).digest("hex")!==row.share_token_hash)throw new Error("Share integrity check failed.");
  const {data:changed,error:saveError}=await admin.rpc("workcraft_upgrade_share_secret",{p_id:row.estimate_id,p_previous:row.encrypted_token,p_current:encryptShareToken(token)});
  if(saveError)throw new Error("Share migration write failed.");
  if(changed)upgraded++;
 }
 return upgraded;
}
