import test from 'node:test';
import assert from 'node:assert/strict';
import { setup } from '../tui.js';
import { RenameRPC } from '../rename-rpc.js';

function harness({ state, rpcFailure = false, status = 'idle', permission = [], forms = [] } = {}) {
  const listeners = new Map();
  const rpcListeners = new Set();
  const sent = [];
  let title = 'New Session';
  let getStateCalls = 0;
  const session = {
    get: () => ({ title, agent: 'build', directory: '/tmp/project' }),
    root: (id) => id,
    status: () => status,
    message: () => [],
    sync: async () => {},
    permission: { list: () => permission, sync: async () => {} },
    form: { list: () => forms, sync: async () => {} },
  };
  const context = {
    location: { directory: '/tmp/project' },
    data: {
      session,
      on(type, callback) {
        const set = listeners.get(type) ?? new Set(); set.add(callback); listeners.set(type, set);
        return () => set.delete(callback);
      },
    },
    client: { rpc(definition) {
      assert.equal(definition.id, RenameRPC.id);
      if (rpcFailure) throw new Error('RPC unavailable');
      return {
        async getState(input) { getStateCalls++; if (input.sessionID !== 'root' || !input.executionID) throw Error('bad RPC key'); return state ? state(input) : { ...input, status: 'pending', title: '' }; },
        events: { on(name, callback) { assert.equal(name, 'state'); rpcListeners.add(callback); return () => rpcListeners.delete(callback); } },
      };
    } },
  };
  const emit = (type, event) => { for (const callback of listeners.get(type) ?? []) callback(event); };
  const terminal = (executionID, status = 'renamed', newTitle = 'Fresh title') => {
    title = newTitle;
    for (const callback of [...rpcListeners]) callback({ data: { sessionID: 'root', executionID, status, title: newTitle } });
  };
  const start = async (options = {}) => setup(context, { send: (notification) => sent.push(notification), startIpc: () => ({ close() {} }), completionDelayMs: 1, pendingDelayMs: 1, batchWindowMs: 3, renameWaitMs: 25, raceRetryMs: 5, ...options });
  return { context, emit, terminal, sent, start, setTitle: (value) => { title = value; }, setStatus: (value) => { status = value; }, setPermission: (value) => { permission = value; }, setForms: (value) => { forms = value; }, get getStateCalls() { return getStateCalls; }, rpcListeners, listeners };
}

const pause = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms));
const succeeded = (id) => ({ id, type: 'session.execution.succeeded', data: { sessionID: 'root' } });

test('installed 2.0.20 RPC contract requires the public execution event identity on query and event', () => {
  assert.equal(RenameRPC.id, 'local-session-rename');
  assert.deepEqual(RenameRPC.methods.getState.input.required, ['sessionID', 'executionID']);
  assert.deepEqual(RenameRPC.methods.getState.output.required, ['sessionID', 'executionID', 'status', 'title']);
  assert.deepEqual(RenameRPC.events.state.schema.required, ['sessionID', 'executionID', 'status', 'title']);
});

test('slow rename finishes before batch captures the refreshed title', async () => {
  const h = harness();
  const dispose = await h.start();
  h.emit('session.execution.succeeded', succeeded('exec-slow'));
  await pause();
  assert.equal(h.sent.length, 0);
  h.setTitle('Renamed after completion');
  h.terminal('exec-slow', 'renamed', 'Renamed after completion');
  await pause(15);
  assert.match(h.sent[0].message, /Renamed after completion/);
  await dispose();
});

test('terminal event and snapshot are correlated by execution ID; old terminal cannot release newer completion', async () => {
  const h = harness();
  const dispose = await h.start();
  h.emit('session.execution.succeeded', succeeded('exec-old'));
  await pause();
  h.emit('session.execution.started', { id: 'start-new', data: { sessionID: 'root' } });
  h.emit('session.execution.succeeded', succeeded('exec-new'));
  await pause();
  h.terminal('exec-old');
  await pause();
  assert.equal(h.sent.length, 0);
  h.terminal('exec-new', 'renamed', 'Newest title');
  await pause(15);
  assert.match(h.sent[0].message, /Newest title/);
  await dispose();
});

test('new busy execution invalidates a delayed old completion before stale idle cache can notify', async () => {
  const h = harness();
  const dispose = await h.start();
  h.emit('session.execution.succeeded', succeeded('exec-before-busy'));
  h.emit('session.execution.started', { id: 'start-new', data: { sessionID: 'root' } });
  await pause(15);
  assert.equal(h.getStateCalls, 0);
  assert.equal(h.sent.length, 0);
  await dispose();
});

test('already-terminal snapshot and terminal-event-before-query races notify once', async () => {
  const h = harness({ state: () => ({ sessionID: 'root', executionID: 'exec-done', status: 'renamed', title: 'Already done' }) });
  const dispose = await h.start();
  h.emit('session.execution.succeeded', succeeded('exec-done'));
  await pause(15);
  assert.match(h.sent[0].message, /Already done/);
  await dispose();

  let resolveState;
  const racing = harness({ state: () => new Promise((resolve) => { resolveState = resolve; }) });
  const stop = await racing.start();
  racing.emit('session.execution.succeeded', succeeded('exec-race'));
  await pause();
  racing.terminal('exec-race', 'renamed', 'Event won race');
  resolveState({ sessionID: 'root', executionID: 'exec-race', status: 'pending', title: '' });
  await pause(15);
  assert.match(racing.sent[0].message, /Event won race/);
  await stop();
});

test('RPC absence, errors, terminal skipped/failed, and bounded timeout still fall back', async (t) => {
  for (const mode of ['absent', 'failed', 'skipped', 'timeout']) {
    await t.test(mode, async () => {
      const h = harness({ rpcFailure: mode === 'absent', state: (input) => {
        if (mode === 'failed') throw Error('server disconnected');
        if (mode === 'skipped') return { ...input, status: 'skipped', title: '' };
        if (mode === 'timeout') return { ...input, status: 'pending', title: '' };
        return { ...input, status: 'pending', title: '' };
      } });
      const dispose = await h.start({ renameWaitMs: 15, raceRetryMs: 1 });
      h.emit('session.execution.succeeded', succeeded('exec-x'));
      await pause(35);
      assert.equal(h.sent.length, 1);
      await dispose();
    });
  }
});

test('after waiting, busy status or pending permission suppresses completion', async (t) => {
  for (const reason of ['busy', 'permission', 'form']) {
    await t.test(reason, async () => {
      const h = harness();
      const dispose = await h.start();
      h.emit('session.execution.succeeded', succeeded(`exec-${reason}`));
      await pause();
      if (reason === 'busy') h.setStatus('running');
      else if (reason === 'permission') h.setPermission([{ id: 'perm-still-open' }]);
      else h.setForms([{ id: 'form-still-open' }]);
      h.terminal(`exec-${reason}`);
      await pause(15);
      assert.equal(h.sent.length, 0);
      await dispose();
    });
  }
});

test('permission and form alerts bypass completion RPC; cleanup releases pending RPC event waits', async () => {
  const h = harness({ forms: [{ id: 'form1' }] });
  const dispose = await h.start();
  h.setPermission([{ id: 'perm1' }]);
  h.emit('permission.asked', { data: { sessionID: 'root', id: 'perm1' } });
  h.emit('form.created', { data: { sessionID: 'root', id: 'form1' } });
  await pause(15);
  assert.equal(h.getStateCalls, 0);
  assert.equal(h.sent.length, 1);
  h.setPermission([]); h.setForms([]);
  h.emit('session.execution.succeeded', succeeded('exec-cleanup'));
  await pause();
  assert.equal(h.rpcListeners.size, 1);
  await dispose();
  assert.equal(h.rpcListeners.size, 0);
  assert.equal(h.listeners.get('session.execution.succeeded').size, 0);
});
