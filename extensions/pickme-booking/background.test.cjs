const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function setup() {
  let listener, removed, nextId = 100;
  const store = {}, tabs = [];
  const chrome = {
    runtime: { onMessage: { addListener(fn) { listener = fn; } } },
    tabs: {
      async create(tab) { const item = { ...tab, id: nextId++ }; tabs.push(item); return item; },
      async update(id, values) { Object.assign(tabs.find(tab => tab.id === id), values); },
      async remove() {}, onRemoved: { addListener(fn) { removed = fn; } },
    },
    storage: { session: {
      async set(values) { Object.assign(store, values); },
      async get(key) { return { [key]: store[key] }; },
      async remove(key) { delete store[key]; },
    } },
  };
  vm.runInNewContext(fs.readFileSync(__dirname + '/background.js', 'utf8'), { chrome, URL, Date, Set, Error });
  return { store, tabs, removed: id => removed(id), send: (message, url, tabId = 1, frameId = 0) => new Promise(resolve => listener(message, { url, tab: { id: tabId }, frameId }, resolve)) };
}
const payload = { id: 'request1', service: 'RIDE', status: 'APPROVED', name: 'Test Passenger', phone: '0771234567', pickup: 'Office', destination: 'Factory', stopover: '', department: 'General', vehicle: 'THREE_WHEELER', pickupAt: '2026-12-01T06:00:00Z', passengerCount: 2 };
test('only approved rides from allowed CTMS origins can open a tab', async () => {
  const app = setup();
  for (const url of ['https://evil.example', 'http://localhost:9999', 'https://business.pickme.lk']) {
    assert.equal((await app.send({ type: 'OPEN', payload }, url)).ok, false);
  }
  assert.equal((await app.send({ type: 'OPEN', payload }, 'http://localhost:5173', 1, 1)).ok, false);
  for (const changes of [{ status: 'BOOKED' }, { service: 'FLASH' }, { passengerCount: 0 }, { phone: '' }]) {
    assert.equal((await app.send({ type: 'OPEN', payload: { ...payload, ...changes } }, 'http://localhost:5173')).ok, false);
  }
  assert.equal(app.tabs.length, 0);
});
test('concurrent requests stay isolated, expire, and clear on close', async () => {
  const app = setup();
  await Promise.all([app.send({ type: 'OPEN', payload }, 'http://localhost:5173'), app.send({ type: 'OPEN', payload: { ...payload, id: 'request2', name: 'Second Passenger' } }, 'http://127.0.0.1:5173')]);
  assert.equal(app.tabs.length, 2);
  assert.ok(app.tabs.every(tab => tab.url === 'https://business.pickme.lk/booknow/rides'));
  const url = 'https://business.pickme.lk/booknow/rides';
  assert.equal((await app.send({ type: 'GET' }, url, 100)).data.name, 'Test Passenger');
  assert.equal((await app.send({ type: 'GET' }, url, 101)).data.name, 'Second Passenger');
  assert.equal((await app.send({ type: 'GET' }, url, 102)).data, null);
  assert.equal((await app.send({ type: 'GET' }, 'https://evil.example', 100)).ok, false);
  app.store['100'].expires = 0;
  assert.equal((await app.send({ type: 'GET' }, url, 100)).data, null);
  app.removed(101);
  assert.equal(app.store['101'], undefined);
});
