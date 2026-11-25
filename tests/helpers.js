'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

function createChromeMock(initial = {}) {
  const areas = {
    sync: { ...(initial.sync || {}) },
    local: { ...(initial.local || {}) },
    session: { ...(initial.session || {}) },
  };
  const storageListeners = new Set();
  const alarmListeners = new Set();
  const alarms = new Map();

  const notify = (changes, areaName) => {
    if (!Object.keys(changes).length) return;
    for (const fn of storageListeners) fn(changes, areaName);
  };

  const makeArea = (name) => ({
    get(keys, cb) {
      const data = areas[name];
      let out = {};
      if (keys == null) {
        out = { ...data };
      } else if (typeof keys === 'string') {
        if (keys in data) out[keys] = data[keys];
      } else if (Array.isArray(keys)) {
        for (const k of keys) if (k in data) out[k] = data[k];
      } else if (typeof keys === 'object') {
        for (const [k, def] of Object.entries(keys)) out[k] = k in data ? data[k] : def;
      }
      if (typeof cb === 'function') cb(out);
      return Promise.resolve(out);
    },
    set(values, cb) {
      const changes = {};
      for (const [k, v] of Object.entries(values || {})) {
        const oldValue = areas[name][k];
        areas[name][k] = v;
        changes[k] = { oldValue, newValue: v };
      }
      notify(changes, name);
      if (typeof cb === 'function') cb();
      return Promise.resolve();
    },
    remove(keys, cb) {
      const list = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : [];
      const changes = {};
      for (const k of list) {
        if (k in areas[name]) {
          const oldValue = areas[name][k];
          delete areas[name][k];
          changes[k] = { oldValue, newValue: undefined };
        }
      }
      notify(changes, name);
      if (typeof cb === 'function') cb();
      return Promise.resolve();
    },
  });

  const chrome = {
    storage: {
      sync: makeArea('sync'),
      local: makeArea('local'),
      session: makeArea('session'),
      onChanged: {
        addListener(fn) { storageListeners.add(fn); },
        removeListener(fn) { storageListeners.delete(fn); },
      },
    },
    runtime: {
      id: 'test-extension-id',
      lastError: null,
      getManifest: () => ({ version: '3.7.0' }),
      getURL: (p) => `chrome-extension://test/${p}`,
      sendMessage: (msg, cb) => {
        if (typeof cb === 'function') cb({ _reqId: msg && msg._reqId, ok: true });
      },
      onMessage: { addListener() {} },
      onConnect: { addListener() {} },
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
    },
    alarms: {
      create(name, info) { alarms.set(name, info); },
      onAlarm: { addListener(fn) { alarmListeners.add(fn); } },
    },
    tabs: {
      query(q, cb) { if (typeof cb === 'function') cb([]); },
      sendMessage(id, msg, cb) { if (typeof cb === 'function') cb(); },
    },
    _areas: areas,
    _alarms: alarms,
  };

  return chrome;
}

function loadScripts(fileNames, overrides = {}) {
  const chrome = overrides.chrome || createChromeMock(overrides.initialStorage);
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    AbortController,
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    chrome,
    fetch: overrides.fetch || (async () => ({ ok: false, status: 500, text: async () => '', json: async () => ({}) })),
    ...(overrides.globals || {}),
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);

  for (const fileName of fileNames) {
    const code = fs.readFileSync(path.join(ROOT, fileName), 'utf8');
    vm.runInContext(code, ctx, { filename: fileName });
  }
  return { ctx, chrome };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

module.exports = { ROOT, createChromeMock, loadScripts, plain };
