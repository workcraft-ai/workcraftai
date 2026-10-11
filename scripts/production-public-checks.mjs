// Read-only public release checks. Invalid IDs cannot create customer records,
// emails or payments. No valid provider signatures or account cookies are used.
import assert from 'node:assert/strict';
const app = process.env.APP_BASE_URL || 'https://app.workcraftai.com';
const marketing = process.env.MARKETING_BASE_URL || 'https://workcraftai.com';
for (const value of [app, marketing]) assert.equal(new URL(value).protocol, 'https:');
const missing = '00000000-0000-4000-8000-000000000001';
const cases = [
  ['health','/api/health','GET',200],
  ['entitlements','/api/user/entitlements','GET',401],
  ['AI','/api/generate-estimate','GET',401],
  ['admin','/api/admin/me','GET',401],
  ['estimate',`/api/estimates/${missing}`,'GET',401],
  ['Stripe signature','/api/webhooks/stripe','POST',400],
  ['Resend signature','/api/webhooks/resend','POST',400],
  ['Auth hook signature','/api/auth/email-hook','POST',401],
  ['notification cron','/api/cron/notifications','GET',401],
  ['follow-up cron','/api/cron/followups','GET',401],
  ['invalid decline','/api/estimates/invalid/decline','POST',404],
  ['absent decline',`/api/estimates/${missing}/decline`,'POST',404],
  ['invalid acceptance','/api/estimates/invalid/accept','POST',404,{signatureName:'Audit Test'}],
  ['invalid question','/api/proposals/invalid/questions','POST',404,{name:'Audit Test',email:'nobody@example.invalid',message:'Invalid-link validation check'}],
  ['invalid checkout','/api/proposals/invalid/checkout','POST',404,{kind:'balance'}],
];
let passed=0;
for (const [name,path,method,expected,body={}] of cases) {
  const response=await fetch(new URL(path,app),{method,headers:method==='POST'?{'Content-Type':'application/json'}:{},...(method==='POST'?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000),redirect:'manual'});
  assert.equal(response.status,expected,`${name}: expected ${expected}, received ${response.status}`);
  assert.ok(response.headers.get('content-security-policy'),`${name}: enforced CSP missing`);
  if (name==='health') {const data=await response.json();assert.equal(data.status,'ok');assert.equal(data.checks.supabaseAuth,'ok');assert.equal(data.checks.supabaseDatabase,'ok');}
  passed++; console.log(`PASS ${name}`);
}
for (const origin of [marketing,app]) for (const path of ['/sitemap.xml','/robots.txt']) {
  const response=await fetch(new URL(path,origin),{signal:AbortSignal.timeout(15000)});
  assert.equal(response.status,200);
  assert.match(response.headers.get('content-type')??'',path.endsWith('.xml')?/xml/:/text\/plain/);
  passed++; console.log(`PASS ${new URL(origin).host}${path}`);
}
console.log(`${passed} public Production checks passed.`);
