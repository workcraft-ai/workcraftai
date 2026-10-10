import test from 'node:test';
import assert from 'node:assert/strict';
import {authResetOutcome} from '../lib/auth-reset-response.mjs';

test('password reset does not expose account existence or cooldowns', () => {
  for (const error of [null, {status:429}, {status:400}, {status:422}]) {
    assert.equal(authResetOutcome(error), 'accepted');
  }
});
test('password reset distinguishes CAPTCHA and service/network failures', () => {
  assert.equal(authResetOutcome({status:400,code:'captcha_failed'}), 'captcha');
  for (const status of [0,401,403,500,502,503]) {
    assert.equal(authResetOutcome({status}), 'unavailable');
  }
  assert.equal(authResetOutcome(new TypeError('Failed to fetch')), 'unavailable');
});
