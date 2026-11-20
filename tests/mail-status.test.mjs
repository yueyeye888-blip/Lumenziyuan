import test from 'node:test';
import assert from 'node:assert/strict';
import { mailStatus } from '../lib/mail-status.mjs';
test('provider acceptance and historical sent rows never imply receipt', () => {
  for (const status of ['accepted', 'sent']) {
    assert.equal(mailStatus(status).code, 'accepted');
    assert.notEqual(mailStatus(status).tone, 'success');
    assert.equal(mailStatus(status).canRetry, false);
  }
  assert.equal(mailStatus('delivered').tone, 'success');
});
test('an unknown send result cannot trigger blind repetition', () => {
  assert.equal(mailStatus('unknown').canRetry, false);
  assert.equal(mailStatus('failed').canRetry, true);
  assert.equal(mailStatus('unrecognized').code, 'pending');
});
