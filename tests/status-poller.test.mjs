import test from 'node:test';
import assert from 'node:assert/strict';
import { createStatusPoller, StatusQueryError, readStatusJson } from '../lib/status-poller.mjs';
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise(r => setTimeout(r, 0));

test('status refreshes use GET only and report expired login explicitly', async t => {
  let count = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(options.method, 'GET'); assert.equal(options.body, undefined);
    count++; return Response.json({ error: 'Expired' }, { status: 401 });
  });
  await assert.rejects(readStatusJson('/api/status', new AbortController().signal), cause => cause.status === 401 && cause.message.includes('重新登录'));
  assert.equal(count, 1);
});

test('a hung request times out and releases the query button', async () => {
  const event = deferred(); let busy = true; let aborted = false;
  const poll = createStatusPoller({ timeoutMs: 20, intervalMs: 1000, load: signal => { signal.addEventListener('abort', () => { aborted = true; }); return new Promise(() => {}); }, onData: () => assert.fail('hung query must not succeed'), onError: event.resolve, onBusy: value => { busy = value; } });
  try { assert.match((await event.promise).message, /状态查询/); await tick(); assert.equal(busy, false); assert.equal(aborted, true); }
  finally { poll.stop(); }
});

test('rapid manual refreshes never overlap and a stopped query cannot update the page', async () => {
  const request = deferred(); let count = 0; let updates = 0;
  const poll = createStatusPoller({ load: () => { count++; return request.promise; }, onData: () => updates++, onError: () => assert.fail('stopped queries must be silent') });
  await tick(); await poll.refresh(); await poll.refresh(); assert.equal(count, 1);
  poll.stop(); request.resolve({ status: 'queued' }); await tick(); assert.equal(updates, 0);
});

test('authorization failures pause automatic polling but permit a manual status check', async () => {
  const event = deferred(); let count = 0;
  const poll = createStatusPoller({ intervalMs: 5, load: async () => { count++; throw new StatusQueryError('Login expired', 401); }, onData: () => {}, onError: event.resolve });
  try { await event.promise; await new Promise(r => setTimeout(r, 25)); assert.equal(count, 1); await poll.refresh(); assert.equal(count, 2); }
  finally { poll.stop(); }
});

test('a completion receipt stops automatic polling', async () => {
  const event = deferred(); let count = 0;
  const poll = createStatusPoller({ intervalMs: 5, load: async () => { count++; return { status: 'delivered' }; }, isTerminal: value => value.status === 'delivered', onData: event.resolve, onError: () => assert.fail() });
  try { await event.promise; await new Promise(r => setTimeout(r, 25)); assert.equal(count, 1); }
  finally { poll.stop(); }
});

test('an old response arriving after timeout cannot overwrite a newer result', async () => {
  const old = deferred(); const failed = deferred(); const records = []; let count = 0;
  const poll = createStatusPoller({ timeoutMs: 20, intervalMs: 1000, load: () => ++count === 1 ? old.promise : Promise.resolve('fresh'), onData: value => records.push(value), onError: failed.resolve });
  try { await failed.promise; await tick(); await poll.refresh(); old.resolve('old'); await tick(); assert.deepEqual(records, ['fresh']); }
  finally { poll.stop(); }
});
