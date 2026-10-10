import test from 'node:test';
import assert from 'node:assert/strict';
import { getInvoiceSubscriptionId } from '../lib/stripe-invoice.mjs';

test('invoice webhooks resolve current and legacy subscription references', () => {
  for (const reference of ['sub_fixture123', {id:'sub_fixture123'}]) {
    assert.equal(getInvoiceSubscriptionId({parent:{type:'subscription_details',subscription_details:{subscription:reference}}}), 'sub_fixture123');
    assert.equal(getInvoiceSubscriptionId({subscription:reference}), 'sub_fixture123');
  }
});

test('one-time invoices and malformed references do not sync subscriptions', () => {
  for (const invoice of [null, {}, {subscription:null}, {subscription:{id:'cus_fixture'}}, {parent:{type:'quote_details'}}, {parent:{type:'subscription_details',subscription_details:null}}]) {
    assert.equal(getInvoiceSubscriptionId(invoice), null);
  }
});
