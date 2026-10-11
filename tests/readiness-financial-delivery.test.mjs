import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { amountToCents, calculateEstimateMoney, percentageOfCents } from '../lib/estimate-money.mjs';

async function loadTypescript(file) {
  const source = await readFile(new URL(file, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
}
const { latestEstimateEmailEvents } = await loadTypescript('../lib/email-delivery-status.ts');
const { syncStripeSubscription } = await loadTypescript('../lib/stripe-subscription-sync.ts');

test('decimal monetary boundaries match PostgreSQL half-away-from-zero rounding', () => {
  assert.equal(amountToCents(1.005), 101);
  assert.equal(amountToCents(-1.005), -101);
  assert.equal(amountToCents('1e-2'), 1);
  assert.deepEqual(calculateEstimateMoney({}, [{quantity: .15, unit_price: 2.3}, {quantity: .25, unit_price: .58}]).lineItemCents, [35, 15]);
  assert.equal(percentageOfCents(101, '50'), 51);
  assert.equal(calculateEstimateMoney({markup_percentage: '1.005', tax_rate: '7.1255'}, [{quantity: 1, unit_price: 100}]).markupCents, 101);
  assert.equal(calculateEstimateMoney({tax_rate: '7.1255'}, [{quantity: 1, unit_price: 100}]).taxCents, 713);
  assert.equal(calculateEstimateMoney({package_options: [{name:'zero', total:0}]}, [{quantity:1, unit_price:100}], 'zero').totalCents, 0);
});

test('email status follows latest send and preserves terminal outcomes across reordered events', () => {
  const row = (mail, event, date) => ({estimate_id:'estimate', provider_email_id:mail, event, created_at:date});
  const sent = row('new', 'sent', '2026-10-10T12:00:00Z');
  const events = [row('old','failed','2026-10-10T14:00:00Z'), row('new','delivery_delayed','2026-10-10T14:00:00Z'), row('new','suppressed','2026-10-10T13:00:00Z'), sent, row('old','sent','2026-10-10T11:00:00Z')];
  assert.deepEqual(latestEstimateEmailEvents(events), {estimate:'suppressed'});
  assert.deepEqual(latestEstimateEmailEvents(events.toReversed()), {estimate:'suppressed'});
  assert.deepEqual(latestEstimateEmailEvents([...events, row('newer','sent','2026-10-10T15:00:00Z')]), {estimate:'sent'});
  assert.deepEqual(latestEstimateEmailEvents([sent, row('new','failed','2026-10-10T13:00:00Z')]), {estimate:'failed'});
});

function subscriptionHarness({currentId='sub_new', acquired=true, applyError=null}={}) {
  const order=[]; let retrievals=0;
  const stripe={subscriptions:{async retrieve(id){order.push(`retrieve:${id}`); retrievals++; return {id,metadata:{user_id:'owner'},customer:'cus_fixture',created:200,status:retrievals === 1 ? 'canceled' : 'active',items:{data:[{current_period_end:1900000000}]}};}}};
  const admin={from(){return {select(){return {eq(){return {async maybeSingle(){order.push('read'); return {data:{stripe_subscription_id:currentId,stripe_subscription_created_at:100}};}};}};}};}, async rpc(name, args){order.push(name); if(name==='workcraft_claim_subscription_sync') return {data:acquired}; if(name==='workcraft_apply_subscription_sync'){assert.equal(args.p_status,'active'); return {data:true,error:applyError};} return {};}};
  return {admin,stripe,order};
}
test('superseded subscription cannot update current entitlement and always releases lease', async () => {
  const h=subscriptionHarness();
  assert.equal(await syncStripeSubscription(h.admin,h.stripe,'sub_old'),null);
  assert.deepEqual(h.order,['retrieve:sub_old','workcraft_claim_subscription_sync','read','workcraft_release_subscription_sync']);
});
test('subscription state is re-fetched after lease acquisition', async () => {
  const h=subscriptionHarness();
  assert.equal((await syncStripeSubscription(h.admin,h.stripe,'sub_new')).subscription.status,'active');
  assert.deepEqual(h.order,['retrieve:sub_new','workcraft_claim_subscription_sync','read','retrieve:sub_new','workcraft_apply_subscription_sync','workcraft_release_subscription_sync']);
});
test('busy subscription refresh requests retry without applying state', async () => {
  const h=subscriptionHarness({acquired:false});
  await assert.rejects(syncStripeSubscription(h.admin,h.stripe,'sub_new'),/busy/);
  assert.deepEqual(h.order,['retrieve:sub_new','workcraft_claim_subscription_sync']);
});
test('failed subscription commit releases the lease and propagates retryable error', async () => {
  const h=subscriptionHarness({applyError:new Error('SUBSCRIPTION_LEASE_EXPIRED')});
  await assert.rejects(syncStripeSubscription(h.admin,h.stripe,'sub_new'),/LEASE_EXPIRED/);
  assert.equal(h.order.at(-1),'workcraft_release_subscription_sync');
});
