import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { isValidEstimateId, requestShareTokenHash } from '../lib/proposal-share-token.mjs';

test('malformed proposal identifiers are rejected before the database read', () => {
  for (const id of [null,undefined,{},'invalid','00000000-0000-0000-0000-000000000000','1'.repeat(36)]) assert.equal(isValidEstimateId(id),false);
  assert.equal(isValidEstimateId('00000000-0000-4000-8000-000000000001'),true);
});
test('only a complete URL-safe proposal token is hashed for atomic authorization', () => {
  for (const suffix of ['', '?token=', '?token=short', `?token=${'a'.repeat(44)}`, `?token=${'a'.repeat(42)}%2B`]) assert.equal(requestShareTokenHash(new Request('https://example.test/'+suffix)),null);
  const token='a'.repeat(43);
  assert.equal(requestShareTokenHash(new Request('https://example.test/?token='+token)),createHash('sha256').update(token).digest('hex'));
});
