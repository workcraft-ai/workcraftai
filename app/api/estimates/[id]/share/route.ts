import {createHash,randomBytes} from "node:crypto";
import {NextResponse} from "next/server";
import {createUserSupabaseClient} from "@/app/utils/supabase/server";
import {getServiceSupabase} from "@/lib/stripe-server";
import {sameOrigin} from "@/lib/admin-support";
import {readLimitedJsonObject} from "@/lib/read-limited-body.mjs";
import {customerShareUrl,encryptShareToken} from "@/lib/proposal-sharing";
const headers={"Cache-Control":"private, no-store"};
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 if(!sameOrigin(request))return NextResponse.json({error:"Invalid request origin."},{status:403,headers});
 const {id}=await params;const client=await createUserSupabaseClient();const {data:{user}}=await client.auth.getUser();
 if(!user)return NextResponse.json({error:"Sign in to manage sharing."},{status:401,headers});
 const {data:estimate}=await client.from("estimates").select("id").eq("id",id).eq("user_id",user.id).maybeSingle();
 if(!estimate)return NextResponse.json({error:"Estimate not found."},{status:404,headers});
 const parsed=await readLimitedJsonObject(request,1000);if(!parsed.ok)return NextResponse.json({error:"Invalid sharing request."},{status:400,headers});
 const body=parsed.value;const action=body.action;
 if(!["copy","replace","disable"].includes(String(action)))return NextResponse.json({error:"Invalid sharing request."},{status:400,headers});
 try{
  const admin=getServiceSupabase();
  if(action!=="copy"){
   const days=body.expiresInDays===null?null:Number(body.expiresInDays??30);
   if(days!==null&&(!Number.isInteger(days)||days<1||days>365))return NextResponse.json({error:"Choose a valid expiration."},{status:400,headers});
   const token=randomBytes(32).toString("base64url");
   const {data:changed,error}=await admin.rpc("workcraft_set_proposal_share",{p_estimate_id:id,p_user_id:user.id,p_hash:createHash("sha256").update(token).digest("hex"),p_encrypted:encryptShareToken(token),p_expires:days===null?null:new Date(Date.now()+days*86400000).toISOString(),p_revoke:action==="disable"});
   if(error||!changed)throw new Error("share_update");
  }
  return NextResponse.json(action==="disable"?{disabled:true}:{url:await customerShareUrl(admin,id)},{headers});
 }catch{return NextResponse.json({error:"Could not update the customer link. Refresh and try again."},{status:503,headers});}
}
