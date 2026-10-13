import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, createHash, createCipheriv } from "node:crypto";
import { sendAuthMessages } from "../lib/auth-email-send.mjs";
import { onboardingEligible } from "../lib/onboarding-cohort.mjs";
import { encryptToken, decryptToken } from "../lib/share-encryption.mjs";
const message = {mail:{to:["owner@example.test"],html:"confirmation"},sendKey:"signed-request-key"};
function sender(overrides={}) {
 const retired=[];const finished=[];
 return {retired,finished,options:{messages:[message],apiKey:"test-value",prepare:async()=>({id:"claim",allowed:true,sent:false}),finish:async(...args)=>finished.push(args),retire:async(id)=>retired.push(id),providerFetch:async()=>Response.json({id:"mail-id"}),...overrides}};
}
test("Auth send records success without background retry",async()=>{const s=sender();await sendAuthMessages(s.options);assert.equal(s.finished.length,1);assert.equal(s.retired.length,0);});
test("Auth transient rejection retires payload instead of queueing it",async()=>{const s=sender({providerFetch:async()=>new Response(null,{status:429})});await assert.rejects(sendAuthMessages(s.options));assert.deepEqual(s.retired,["claim"]);});
test("Auth uncertain timeout and bookkeeping failure never schedule later delivery",async()=>{for(const overrides of [{providerFetch:async()=>{throw new Error("timeout");}},{finish:async()=>{throw new Error("write failed");}}]){const s=sender(overrides);await assert.rejects(sendAuthMessages(s.options));assert.deepEqual(s.retired,["claim"]);}});
test("Auth duplicate skips provider, busy lease does not retire another sender",async()=>{for(const claim of [{sent:true,allowed:true,id:"claim"},{sent:false,allowed:false,id:"claim"}]){const s=sender({prepare:async()=>claim,providerFetch:async()=>{assert.fail("provider must not be called");}});if(claim.sent)await sendAuthMessages(s.options);else await assert.rejects(sendAuthMessages(s.options));assert.equal(s.retired.length,0);}});
test("Auth email-change pair waits for both bounded results",async()=>{const s=sender({messages:[message,{...message,sendKey:"second-request-key"}]});await sendAuthMessages(s.options);assert.equal(s.finished.length,2);});
test("Onboarding survives future legal versions without enrolling legacy or unconfirmed users",()=>{const user={email:"owner@example.test",email_confirmed_at:"confirmed",user_metadata:{workcraft_terms_accepted:true,workcraft_terms_version:"2026-10-11"}};assert.equal(onboardingEligible(user),true);assert.equal(onboardingEligible({...user,user_metadata:{...user.user_metadata,workcraft_terms_version:"2027-01-01"}}),true);assert.equal(onboardingEligible({...user,email_confirmed_at:null}),false);assert.equal(onboardingEligible({...user,user_metadata:{workcraft_terms_version:"2026-10-10",workcraft_terms_accepted:true}}),false);});
test("Versioned share encryption survives service credential rotation and rejects tampering",()=>{const key=randomBytes(32).toString("base64"),token=randomBytes(32).toString("base64url"),cipher=encryptToken(token,key);assert.equal(decryptToken(cipher,key,"rotated-credential"),token);assert.throws(()=>decryptToken(cipher,randomBytes(32).toString("base64"),"old-credential"));assert.throws(()=>decryptToken(cipher.slice(0,-2)+"AA",key,"old-credential"));});
test("Legacy shares migrate without changing customer token",()=>{const token=randomBytes(32).toString("base64url"),credential="legacy-test-credential",key=randomBytes(32).toString("base64"),iv=randomBytes(12);const c=createCipheriv("aes-256-gcm",createHash("sha256").update(`workcraft-proposal-sharing-v1:${credential}`).digest(),iv);const body=Buffer.concat([c.update(token),c.final()]);const old=Buffer.concat([iv,c.getAuthTag(),body]).toString("base64url");assert.equal(decryptToken(old,key,credential),token);const modern=encryptToken(decryptToken(old,key,credential),key);assert.equal(decryptToken(modern,key,"different-credential"),token);});

// Execute the actual small TypeScript helpers without introducing a test runner.
const { readFile } = await import('node:fs/promises');
const ts = await import('typescript');
async function helper(file) {
 const code=ts.transpileModule(await readFile(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
 return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}
test('Complete account pagination covers 1001 rows and refuses partial failures',async()=>{
 const {readAllPages}=await helper('../lib/read-all-pages.ts');const rows=Array.from({length:1001},(_,id)=>({id}));const ranges=[];
 const result=await readAllPages(async(from,to)=>{ranges.push([from,to]);return {data:rows.slice(from,to+1),error:null};});
 assert.equal(result.data.length,1001);assert.deepEqual(ranges,[[0,499],[500,999],[1000,1499]]);
 const failure=await readAllPages(async(from,to)=>from===0?{data:rows.slice(from,to+1),error:null}:{data:null,error:{message:'unavailable'}});
 assert.equal(failure.data,null);assert.ok(failure.error);
});
test('Shared deadline aborts real Stripe fetch adapter and prevents late requests',async()=>{
 const {createBoundedFetch}=await helper('../lib/bounded-fetch.ts');const {default:Stripe}=await import('stripe');const {setTimeout:sleep}=await import('node:timers/promises');
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async(_url,init)=>{calls++;return new Promise((_resolve,reject)=>{if(init.signal.aborted)reject(init.signal.reason);else init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true});});};
 try {
  const deadline=Date.now()+15;
  const stripe=new Stripe('test-value',{timeout:8000,maxNetworkRetries:0,httpClient:Stripe.createFetchHttpClient(createBoundedFetch(8000,deadline))});
  const completed=stripe.customers.retrieve('cus_fixture').then(()=>false,()=>true);
  await sleep(40);assert.equal(await completed,true);assert.equal(calls,1);
  await assert.rejects(createBoundedFetch(8000,deadline)('https://example.invalid'));assert.equal(calls,1);
 } finally {globalThis.fetch=original;}
});
