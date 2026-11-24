// ==UserScript==
// @name         Moodle Quiz Bot + 3-Cat Squad
// @namespace    https://github.com/ambotlangnimo/moodle-quiz-bot
// @version      3.5.2
// @description  Auto-answers Moodle quizzes, harvests study sites, syncs with GitHub Question Bank, and features a 3-Cat Pixel Squad.
// @match        *://*/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM_addValueChangeListener
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @connect      api.github.com
// @connect      raw.githubusercontent.com
// @connect      generativelanguage.googleapis.com
// @connect      api.deepseek.com
// @connect      openrouter.ai
// @connect      127.0.0.1
// @connect      localhost
// @connect      amauoed.com
// @connect      *
// @updateURL    https://raw.githubusercontent.com/ambotlangnimo/moodle-quiz-bot/main/moodle-quiz-bot.user.js
// @downloadURL  https://raw.githubusercontent.com/ambotlangnimo/moodle-quiz-bot/main/moodle-quiz-bot.user.js
// @run-at       document-idle
// ==/UserScript==
(function () {
'use strict';

const QB_TM_MANIFEST = {"manifest_version":3,"name":"Moodle Quiz Bot","version":"3.5.2","description":"Moodle quiz bot + universal Q&A harvester with a pure-JS pixel-art cat mascot on every site.","permissions":["storage","tabs","unlimitedStorage"],"host_permissions":["<all_urls>"],"content_scripts":[{"matches":["https://*.amaes.com/*"],"css":["hud.css"],"js":["config.js","storage.js","providers.js","content.js","mascot.js"],"run_at":"document_idle","all_frames":false},{"matches":["<all_urls>"],"exclude_matches":["https://*.amaes.com/*"],"css":["hud.css"],"js":["config.js","storage.js","universal-harvester.js","mascot.js"],"run_at":"document_idle","all_frames":false}],"web_accessible_resources":[{"resources":["hud.css"],"matches":["<all_urls>"]}],"background":{"service_worker":"background.js"},"options_page":"options.html","action":{"default_popup":"popup.html","default_title":"Moodle Quiz Bot"}};
const QB_TM_HUD_CSS = "/* ─────────────────────────────────────────────────────────────────────────────\n   hud.css — Quiz Bot HUD panel (Shadow-DOM-scoped styles)\n   Never intercepts page clicks except its own buttons.\n\n   Layout: the HUD host sits 165px from the right edge so the standalone\n   roaming mascot (extension/mascot.js, a 130 px pixel-art canvas, parked\n   bottom-right and wandering Shimeji-style) can never cover the Run / Stop /\n   Clear / Harvest buttons. All mascot styling lives in mascot.js — this file\n   only styles the closed-shadow HUD plus the light-DOM harvester HUD below.\n   ───────────────────────────────────────────────────────────────────────────── */\n\n/* The mascot is a 96×96 pixel-art canvas scaled up: keep every sprite pixel a\n   crisp square even if a host page tries to smooth images globally. The rule is\n   a no-op for every other element (mascot.js styles him too). */\n#qb-mascot-wrap canvas {\n  image-rendering: crisp-edges;\n  image-rendering: pixelated;\n}\n\n:host {\n  all: initial;\n  display: block;\n  position: fixed;\n  z-index: 2147483647;\n  bottom: 20px;\n  right: 165px;\n  width: 380px;\n  max-width: calc(100vw - 205px);\n  max-height: calc(100vh - 40px);\n  font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;\n  font-size: 13px;\n  line-height: 1.4;\n  color: #e0e0e0;\n  pointer-events: none;\n}\n\n:host(.active) {\n  pointer-events: auto;\n}\n\n/* --- Speech-bubble HUD panel --- */\n#hud-root,\n#qb-hud,\n.qb-panel {\n  position: absolute;\n  right: 0;\n  bottom: 0;\n  width: 380px;\n  max-width: calc(100vw - 205px);\n  box-sizing: border-box;\n  background: linear-gradient(135deg, #1e2a47 0%, #0f3460 100%);\n  border: 1px solid #16213e;\n  border-radius: 12px;\n  box-shadow: 0 12px 48px rgba(0,0,0,0.5);\n  overflow: hidden;\n  display: flex;\n  flex-direction: column;\n  max-height: calc(100vh - 40px);\n  pointer-events: auto;\n}\n\n/* Narrow viewports: stack the panel above the mascot instead of beside it. */\n@media (max-width: 564px) {\n  :host {\n    right: 20px;\n    bottom: 20px;\n    width: calc(100vw - 40px);\n    max-width: calc(100vw - 40px);\n  }\n  #hud-root,\n  #qb-hud,\n  .qb-panel {\n    right: 0;\n    bottom: 148px;\n    width: 100%;\n    max-width: calc(100vw - 40px);\n    max-height: calc(100vh - 260px);\n  }\n}\n\n:host(.active) #hud-root { pointer-events: auto; }\n\n#hud-header {\n  background: linear-gradient(135deg, #082040 0%, #1a3a5c 100%);\n  padding: 10px 12px;\n  display: flex;\n  align-items: center;\n  gap: 10px;\n  cursor: move;\n  user-select: none;\n  flex-shrink: 0;\n  border-bottom: 1px solid #16213e;\n}\n\n#hud-title {\n  flex: 1;\n  font-weight: 600;\n  font-size: 13px;\n  color: #ffb347;\n  white-space: nowrap;\n  overflow: hidden;\n  text-overflow: ellipsis;\n}\n\n#hud-status {\n  font-size: 11px;\n  padding: 2px 8px;\n  border-radius: 10px;\n  background: #16213e;\n  white-space: nowrap;\n}\n\n#hud-status.running { color: #4ade80; }\n#hud-status.stopped { color: #f87171; }\n#hud-status.waiting { color: #fbbf24; }\n#hud-status.reviewing { color: #f5b74f; }\n\n#hud-minimize-btn {\n  width: 28px;\n  height: 28px;\n  background: #16213e;\n  border: 1px solid #4a5568;\n  border-radius: 6px;\n  color: #a0aec0;\n  font-size: 16px;\n  font-weight: bold;\n  cursor: pointer;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  pointer-events: auto;\n  flex-shrink: 0;\n}\n\n#hud-minimize-btn:hover { background: #2d3748; color: #e2e8f0; }\n\n#hud-minimize-btn.collapsed { background: #3182ce; color: white; }\n\n/* Speech bubble pointing to mascot */\n#hud-bubble {\n  position: relative;\n  margin: 8px 12px;\n  padding: 10px 12px;\n  background: rgba(255,255,255,0.08);\n  backdrop-filter: blur(12px);\n  border-radius: 18px;\n  border: 1px solid rgba(255,255,255,0.15);\n  box-shadow: 0 4px 20px rgba(0,0,0,0.3);\n  pointer-events: auto;\n  max-width: 85%;\n  word-break: break-word;\n}\n\n#hud-bubble::after {\n  content: \"\";\n  position: absolute;\n  bottom: -10px;\n  right: 20px;\n  border-width: 10px 10px 0;\n  border-style: solid;\n  border-color: rgba(255,255,255,0.08) transparent;\n  display: block;\n  width: 0;\n  z-index: 1;\n  pointer-events: none;\n}\n\n/* Latest status line */\n#hud-status-line {\n  font-size: 11px;\n  opacity: 0.7;\n  margin-top: 6px;\n  color: #7f8c8d;\n}\n\n/* Log box */\n#hud-body {\n  padding: 8px 12px;\n  overflow-y: auto;\n  flex: 1;\n  max-height: 220px;\n  scrollbar-width: thin;\n  scrollbar-color: #0f3460 #16213e;\n}\n\n#hud-body::-webkit-scrollbar { width: 4px; }\n#hud-body::-webkit-scrollbar-track { background: #16213e; }\n#hud-body::-webkit-scrollbar-thumb { background: #0f3460; border-radius: 2px; }\n\n.hud-entry {\n  padding: 4px 0;\n  border-bottom: 1px solid rgba(255,255,255,0.08);\n  font-size: 12px;\n  display: flex;\n  align-items: center;\n  gap: 6px;\n}\n\n.hud-entry:last-child { border-bottom: none; }\n\n.hud-entry .q-text {\n  color: #cbd5e0;\n  flex: 1;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.hud-entry .q-tier {\n  font-size: 10px;\n  background: #0f3460;\n  padding: 1px 6px;\n  border-radius: 6px;\n  color: #60a5fa;\n  white-space: nowrap;\n}\n\n.hud-entry .q-answer {\n  color: #4ade80;\n  flex: 1;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.hud-entry .q-score {\n  font-size: 10px;\n  color: #7f8c8d;\n}\n\n/* Button row */\n#hud-footer {\n  padding: 8px 12px;\n  display: flex;\n  gap: 6px;\n  flex-shrink: 0;\n  border-top: 1px solid rgba(255,255,255,0.08);\n  background: rgba(0,0,0,0.1);\n}\n\n.hud-btn {\n  pointer-events: auto;\n  border: none;\n  border-radius: 6px;\n  padding: 5px 12px;\n  font-size: 12px;\n  font-weight: 500;\n  cursor: pointer;\n  transition: background 0.15s;\n  flex: 1;\n}\n\n#hud-stop-btn {\n  background: #e53e3e;\n  color: white;\n}\n#hud-stop-btn:hover { background: #c53030; }\n\n#hud-clear-btn {\n  background: #374151;\n  color: #d1d5db;\n}\n#hud-clear-btn:hover { background: #4b5563; }\n\n#hud-harvest-btn {\n  background: #0f766e;\n  color: white;\n}\n#hud-harvest-btn:hover { background: #0d5f59; }\n\n#hud-toggle-btn {\n  background: #3182ce;\n  color: white;\n}\n#hud-toggle-btn:hover { background: #2c5282; }\n#hud-toggle-btn.active { background: #38bdf8; }\n\n/* Log line styles */\n.hud-log-line {\n  font-size: 11px;\n  color: #64748b;\n  padding: 1px 0;\n  border-bottom: 1px solid rgba(22,33,62,0.3);\n}\n\n.hud-log-line.info { color: #94a3b8; }\n.hud-log-line.success { color: #4ade80; }\n.hud-log-line.warn { color: #fbbf24; }\n.hud-log-line.error { color: #f87171; }\n\n/* --- Minimized mode: hide the panel (the standalone mascot stays visible) --- */\n:host(.minimized) #hud-root { display: none; }\n\n/* ─────────────────────────────────────────────────────────────────────────────\n   Universal Harvester HUD (universal-harvester.js)\n\n   This block is the *page-level* twin of the Shadow-DOM HUD above: manifest.json\n   injects hud.css into every site, so #qb-hud lives in the normal light DOM and\n   is styled directly. The `:host` rules above only ever match inside the closed\n   shadow root on amaes.com and are harmless here.\n\n   Status chips reuse the Moodle class names (running / stopped / waiting /\n   reviewing) and log rows reuse .hud-log-line.<level>, so the standalone mascot\n   recognises harvest progress and narrates it with its harvesting / review\n   pixel animations.\n   ───────────────────────────────────────────────────────────────────────────── */\n\n#qb-hud {\n  position: fixed;\n  right: 165px;\n  bottom: 20px;\n  z-index: 2147483646;\n  width: 372px;\n  max-width: calc(100vw - 40px);\n  box-sizing: border-box;\n  display: flex;\n  flex-direction: column;\n  font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;\n  font-size: 13px;\n  line-height: 1.4;\n  color: #e2e8f0;\n  background: linear-gradient(135deg, rgba(30, 42, 71, 0.94) 0%, rgba(15, 52, 96, 0.94) 100%);\n  -webkit-backdrop-filter: blur(16px) saturate(140%);\n  backdrop-filter: blur(16px) saturate(140%);\n  border: 1px solid rgba(255, 255, 255, 0.14);\n  border-radius: 14px;\n  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.48), inset 0 1px 0 rgba(255, 255, 255, 0.06);\n  overflow: hidden;\n  pointer-events: auto;\n  transition: width 0.22s ease, border-radius 0.22s ease, box-shadow 0.22s ease;\n}\n\n/* Compact pill on general sites (auto-expanded on study domains). */\n#qb-hud.qb-collapsed {\n  width: auto;\n  min-width: 0;\n  border-radius: 999px;\n}\n#qb-hud.qb-collapsed #qb-hud-body,\n#qb-hud.qb-collapsed #qb-actions {\n  display: none;\n}\n#qb-hud.qb-collapsed #qb-hud-header {\n  border-bottom: none;\n  padding: 8px 10px 8px 14px;\n}\n#qb-hud.qb-collapsed #qb-hud-title {\n  font-size: 12px;\n}\n#qb-hud.qb-collapsed #qb-status {\n  display: none;\n}\n\n#qb-hud-header {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  padding: 10px 12px;\n  background: linear-gradient(135deg, rgba(8, 32, 64, 0.92) 0%, rgba(26, 58, 92, 0.72) 100%);\n  border-bottom: 1px solid rgba(255, 255, 255, 0.09);\n  cursor: move;\n  user-select: none;\n  -webkit-user-select: none;\n}\n\n#qb-hud-title {\n  flex: 1;\n  min-width: 0;\n  font-weight: 600;\n  color: #ffb347;\n  white-space: nowrap;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  letter-spacing: 0.2px;\n}\n\n#qb-status {\n  flex-shrink: 0;\n  font-size: 11px;\n  padding: 2px 8px;\n  border-radius: 10px;\n  background: rgba(22, 33, 62, 0.9);\n  color: #94a3b8;\n  white-space: nowrap;\n}\n\n#qb-status.running { color: #4ade80; }\n#qb-status.stopped { color: #f87171; }\n#qb-status.waiting { color: #fbbf24; }\n#qb-status.reviewing { color: #f5b74f; }\n\n#qb-minimize-btn {\n  flex-shrink: 0;\n  width: 28px;\n  height: 26px;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  background: rgba(22, 33, 62, 0.9);\n  border: 1px solid rgba(255, 255, 255, 0.18);\n  border-radius: 8px;\n  color: #cbd5e0;\n  font-size: 14px;\n  font-weight: 700;\n  line-height: 1;\n  cursor: pointer;\n  padding: 0;\n}\n#qb-minimize-btn:hover { background: #2d3748; color: #ffffff; }\n#qb-minimize-btn:active { transform: scale(0.96); }\n\n#qb-hud-body {\n  padding: 8px 12px;\n  max-height: 190px;\n  overflow-y: auto;\n  scrollbar-width: thin;\n  scrollbar-color: #0f3460 rgba(22, 33, 62, 0.4);\n}\n#qb-hud-body::-webkit-scrollbar { width: 4px; }\n#qb-hud-body::-webkit-scrollbar-track { background: rgba(22, 33, 62, 0.4); }\n#qb-hud-body::-webkit-scrollbar-thumb { background: #0f3460; border-radius: 2px; }\n\n#qb-log {\n  display: flex;\n  flex-direction: column;\n  gap: 1px;\n  min-height: 34px;\n}\n\n/* Log rows: same classes as the Moodle HUD (see .hud-log-line below). */\n#qb-log .hud-log-line {\n  font-size: 11px;\n  line-height: 1.45;\n  padding: 2px 0;\n  overflow-wrap: anywhere;\n  word-break: break-word;\n}\n\n#qb-hud-hint {\n  padding: 0 12px 8px;\n  font-size: 10.5px;\n  color: #7f8c8d;\n  user-select: none;\n}\n\n#qb-actions {\n  display: flex;\n  gap: 6px;\n  padding: 8px 12px;\n  border-top: 1px solid rgba(255, 255, 255, 0.09);\n  background: rgba(0, 0, 0, 0.16);\n}\n\n#qb-hud .qb-btn {\n  flex: 1;\n  min-width: 0;\n  border: none;\n  border-radius: 8px;\n  padding: 6px 8px;\n  font-family: inherit;\n  font-size: 11.5px;\n  font-weight: 600;\n  line-height: 1.3;\n  color: #ffffff;\n  cursor: pointer;\n  white-space: nowrap;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  transition: filter 0.15s ease, transform 0.1s ease;\n}\n#qb-hud .qb-btn:hover:not(:disabled) { filter: brightness(1.15); }\n#qb-hud .qb-btn:active:not(:disabled) { transform: translateY(1px); }\n#qb-hud .qb-btn:disabled { opacity: 0.45; cursor: not-allowed; }\n\n#qb-harvest-page { background: linear-gradient(135deg, #0f766e 0%, #0d9488 100%); }\n#qb-harvest-course { background: linear-gradient(135deg, #1d4ed8 0%, #2563eb 100%); }\n#qb-stop { background: linear-gradient(135deg, #b91c1c 0%, #dc2626 100%); flex: 0 0 76px; }\n\n/* Wide/short viewports: keep the pill clear of the gaming/browser edges. */\n@media (max-width: 564px) {\n  #qb-hud {\n    right: 16px;\n    bottom: 168px;\n    width: calc(100vw - 32px);\n    max-width: calc(100vw - 32px);\n  }\n  #qb-hud.qb-collapsed {\n    width: auto;\n    max-width: calc(100vw - 32px);\n  }\n}\n";
const QB_TM_LOCAL_PREFIX = 'qb_tm_local:';
const QB_TM_SYNC_PREFIX = 'qb_tm_sync:';
const QB_TM_REGISTRY_PREFIX = 'qb_tm_registry:';
let qbTmLastError = null;
const qbTmStorageListeners = new Set();
const qbTmWatched = new Set();
const qbTmRuntimeListeners = new Set();

function qbTmGMGet(key, fallback) {
  return Promise.resolve(GM_getValue(key, fallback));
}

function qbTmStoragePrefix(area) {
  return area === 'sync' ? QB_TM_SYNC_PREFIX : QB_TM_LOCAL_PREFIX;
}

function qbTmWatchKey(area, key) {
  const gmKey = qbTmStoragePrefix(area) + key;
  if (qbTmWatched.has(gmKey)) return;
  qbTmWatched.add(gmKey);
  GM_addValueChangeListener(gmKey, (name, oldValue, newValue, remote) => {
    if (!remote) return;
    const change = {};
    change[key] = { oldValue, newValue };
    qbTmNotifyStorage(change, area);
  });
}

function qbTmWatchRegistry(area) {
  const registryKey = QB_TM_REGISTRY_PREFIX + area;
  GM_addValueChangeListener(registryKey, (name, oldValue, newValue) => {
    for (const key of Array.isArray(newValue) ? newValue : []) qbTmWatchKey(area, key);
  });
  Promise.resolve(GM_listValues()).then((keys) => {
    const prefix = qbTmStoragePrefix(area);
    for (const key of keys) {
      if (key.startsWith(prefix)) qbTmWatchKey(area, key.slice(prefix.length));
    }
    return qbTmGMGet(registryKey, []);
  }).then((keys) => {
    for (const key of Array.isArray(keys) ? keys : []) qbTmWatchKey(area, key);
  });
}

function qbTmNotifyStorage(changes, area) {
  for (const listener of qbTmStorageListeners) {
    try { listener(changes, area); } catch (error) { console.error('[Quiz Bot] storage listener failed:', error); }
  }
}

function qbTmGetKeys(keys, area) {
  const prefix = qbTmStoragePrefix(area);
  let names;
  if (keys == null) {
    names = Promise.resolve(GM_listValues()).then((all) => all
      .filter((name) => name.startsWith(prefix))
      .map((name) => name.slice(prefix.length)));
  } else if (typeof keys === 'string') {
    names = Promise.resolve([keys]);
  } else if (Array.isArray(keys)) {
    names = Promise.resolve(keys);
  } else if (typeof keys === 'object') {
    names = Promise.resolve(Object.keys(keys));
  } else {
    names = Promise.resolve([]);
  }
  return names.then(async (selected) => {
    const result = {};
    for (const key of selected) {
      qbTmWatchKey(area, key);
      const fallback = keys && !Array.isArray(keys) && typeof keys === 'object' && keys[key] !== undefined
        ? keys[key]
        : undefined;
      const value = await qbTmGMGet(prefix + key, fallback);
      if (value !== undefined) result[key] = value;
    }
    if (area === 'sync' && keys == null) {
      const deepseekKey = await qbTmGMGet(prefix + 'DEEPSEEK_API_KEY', '');
      if (deepseekKey && !result.CUSTOM_API_KEY) {
        result.CUSTOM_API_KEY = deepseekKey;
        result.CUSTOM_API_BASE_URL = 'https://api.deepseek.com/v1';
        result.CUSTOM_MODEL = 'deepseek-chat';
      }
    }
    return result;
  });
}

function qbTmStorageArea(area) {
  const prefix = qbTmStoragePrefix(area);
  return {
    get(keys, callback) {
      const promise = qbTmGetKeys(keys, area);
      if (typeof callback === 'function') {
        promise.then((value) => callback(value), (error) => {
          qbTmLastError = { message: error.message || String(error) };
          callback({});
          qbTmLastError = null;
        });
      }
      return promise;
    },
    set(values, callback) {
      const promise = (async () => {
        const changes = {};
        const registryKey = QB_TM_REGISTRY_PREFIX + area;
        const registry = await qbTmGMGet(registryKey, []);
        const known = new Set(Array.isArray(registry) ? registry : []);
        for (const [key, value] of Object.entries(values || {})) {
          const gmKey = prefix + key;
          const oldValue = await qbTmGMGet(gmKey, undefined);
          await Promise.resolve(GM_setValue(gmKey, value));
          qbTmWatchKey(area, key);
          known.add(key);
          changes[key] = { oldValue, newValue: value };
        }
        await Promise.resolve(GM_setValue(registryKey, Array.from(known)));
        if (Object.keys(changes).length) qbTmNotifyStorage(changes, area);
      })();
      if (typeof callback === 'function') promise.then(() => callback(), (error) => {
        qbTmLastError = { message: error.message || String(error) };
        callback();
        qbTmLastError = null;
      });
      return promise;
    },
    remove(keys, callback) {
      const selected = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : [];
      const promise = (async () => {
        const changes = {};
        for (const key of selected) {
          const gmKey = prefix + key;
          const oldValue = await qbTmGMGet(gmKey, undefined);
          await Promise.resolve(GM_deleteValue(gmKey));
          changes[key] = { oldValue, newValue: undefined };
        }
        if (Object.keys(changes).length) qbTmNotifyStorage(changes, area);
      })();
      if (typeof callback === 'function') promise.then(() => callback(), (error) => {
        qbTmLastError = { message: error.message || String(error) };
        callback();
        qbTmLastError = null;
      });
      return promise;
    },
    clear(callback) {
      const promise = qbTmGetKeys(null, area).then((values) => this.remove(Object.keys(values)));
      if (typeof callback === 'function') promise.then(() => callback(), (error) => {
        qbTmLastError = { message: error.message || String(error) };
        callback();
        qbTmLastError = null;
      });
      return promise;
    },
  };
}

qbTmWatchRegistry('local');
qbTmWatchRegistry('sync');

function qbTmRequest(options) {
  return new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
      method: options.method || 'GET',
      url: options.url,
      headers: options.headers || {},
      data: options.data,
      timeout: options.timeout || 30000,
      responseType: options.responseType,
      onload: (response) => resolve({
        status: response.status,
        responseText: response.responseText || '',
        response: response.response,
        responseHeaders: response.responseHeaders || '',
        finalUrl: response.finalUrl || options.url,
      }),
      onerror: (error) => reject(new Error('Network request failed' + (error && error.status ? ' (HTTP ' + error.status + ')' : ''))),
      ontimeout: () => reject(new Error('Request timed out: ' + options.url)),
      onabort: () => reject(new Error('Request aborted: ' + options.url)),
    });
  });
}

function qbTmParseJson(text, label) {
  try { return JSON.parse(text); }
  catch (error) { throw new Error(label + ' returned invalid JSON: ' + error.message); }
}

function qbTmUtf8FromBase64(value) {
  const binary = atob(String(value || '').replace(/\s/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new TextDecoder('utf-8').decode(bytes);
}

function qbTmBase64FromUtf8(value) {
  const bytes = new TextEncoder().encode(String(value));
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)));
  }
  return btoa(binary);
}

async function qbTmGitHubSettings(payload) {
  const settings = await chrome.storage.sync.get([
    'GITHUB_BANK_OWNER', 'GITHUB_BANK_REPO', 'GITHUB_BANK_PATH',
    'GITHUB_SYNC_TOKEN', 'GITHUB_BANK_TOKEN',
  ]);
  return {
    owner: String(payload.owner || settings.GITHUB_BANK_OWNER || '').trim(),
    repo: String(payload.repo || settings.GITHUB_BANK_REPO || '').trim(),
    path: String(payload.path || settings.GITHUB_BANK_PATH || 'bank.json').trim() || 'bank.json',
    token: String(payload.token || settings.GITHUB_SYNC_TOKEN || settings.GITHUB_BANK_TOKEN || '').trim(),
  };
}

function qbTmGitHubHeaders(token) {
  const headers = { Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  return headers;
}

async function qbTmGitHubGetFile(settings) {
  const encodedPath = settings.path.split('/').map(encodeURIComponent).join('/');
  const url = 'https://api.github.com/repos/' + encodeURIComponent(settings.owner) + '/'
    + encodeURIComponent(settings.repo) + '/contents/' + encodedPath;
  const response = await qbTmRequest({ url, headers: qbTmGitHubHeaders(settings.token), timeout: 45000 });
  if (response.status === 404) return { missing: true, content: {}, sha: null };
  if (response.status < 200 || response.status >= 300) {
    throw new Error('GitHub GET failed: HTTP ' + response.status + ' ' + response.responseText.slice(0, 300));
  }
  const meta = qbTmParseJson(response.responseText, 'GitHub Contents API');
  let text = '';
  if (typeof meta.content === 'string' && meta.encoding === 'base64') {
    text = qbTmUtf8FromBase64(meta.content);
  } else if (meta.sha) {
    const blobUrl = 'https://api.github.com/repos/' + encodeURIComponent(settings.owner) + '/'
      + encodeURIComponent(settings.repo) + '/git/blobs/' + encodeURIComponent(meta.sha);
    const blobResponse = await qbTmRequest({
      url: blobUrl,
      headers: qbTmGitHubHeaders(settings.token),
      timeout: 90000,
    });
    if (blobResponse.status < 200 || blobResponse.status >= 300) {
      throw new Error('GitHub Blob API failed: HTTP ' + blobResponse.status);
    }
    const blob = qbTmParseJson(blobResponse.responseText, 'GitHub Blob API');
    if (blob.encoding !== 'base64' || typeof blob.content !== 'string') {
      throw new Error('GitHub Blob API did not return base64 content');
    }
    text = qbTmUtf8FromBase64(blob.content);
  } else if (meta.download_url) {
    const rawResponse = await qbTmRequest({
      url: meta.download_url,
      headers: settings.token ? { Authorization: 'Bearer ' + settings.token } : {},
      timeout: 90000,
    });
    if (rawResponse.status < 200 || rawResponse.status >= 300) {
      throw new Error('GitHub raw download failed: HTTP ' + rawResponse.status);
    }
    text = rawResponse.responseText;
  } else {
    throw new Error('GitHub returned no file content or blob SHA');
  }
  return {
    missing: false,
    sha: meta.sha || null,
    size: Number(meta.size) || text.length,
    content: qbTmParseJson(text, 'Question bank'),
  };
}

function qbTmBankQuestions(bank) {
  if (bank && bank.questions && typeof bank.questions === 'object' && !Array.isArray(bank.questions)) {
    return bank.questions;
  }
  return bank && typeof bank === 'object' && !Array.isArray(bank) ? bank : null;
}

function qbTmBankSignature(hit, key) {
  const question = typeof hit === 'string' ? key : hit && hit.question || key;
  const answer = typeof hit === 'string' ? hit : hit && hit.answer || '';
  return String(question).toLowerCase().replace(/\s+/g, ' ').trim()
    + '|' + String(answer).toLowerCase().replace(/\s+/g, ' ').trim();
}

async function qbTmMergeBank(remote) {
  const bankStorage = window.__qbTmBankStorage;
  if (bankStorage && typeof bankStorage.mergeRemoteBankIntoLocal === 'function') {
    await bankStorage.mergeRemoteBankIntoLocal(remote);
  }
  const questions = qbTmBankQuestions(remote);
  if (!questions) throw new Error('Question bank must contain a JSON object');
  const local = bankStorage && typeof bankStorage.answerKeyGetAll === 'function'
    ? await bankStorage.answerKeyGetAll()
    : (await chrome.storage.local.get('answerkey_cache')).answerkey_cache || {};
  const merged = { ...questions };
  const remoteKeyByNorm = new Map(Object.keys(merged).map((key) => [key.toLowerCase().replace(/\s+/g, ' ').trim(), key]));
  for (const [key, value] of Object.entries(local)) {
    const targetKey = remoteKeyByNorm.get(key.toLowerCase().replace(/\s+/g, ' ').trim()) || key;
    const remoteEntry = merged[targetKey];
    const localEntry = value;
    const remoteHits = Array.isArray(remoteEntry) && Array.isArray(remoteEntry[1]) ? remoteEntry[1].slice()
      : remoteEntry == null ? [] : [remoteEntry];
    const localHits = (Array.isArray(localEntry) && Array.isArray(localEntry[1]) ? localEntry[1]
      : localEntry == null ? [] : [localEntry])
      .filter((hit) => hit && hit.verified === true && typeof hit.answer === 'string' && hit.answer.trim());
    if (!localHits.length) continue;
    const seen = new Set(remoteHits.map((hit) => qbTmBankSignature(hit, targetKey)));
    for (const hit of localHits) {
      const signature = qbTmBankSignature(hit, targetKey);
      if (!seen.has(signature)) {
        seen.add(signature);
        remoteHits.push(hit);
      }
    }
    if (remoteHits.length) {
      const remoteTime = Array.isArray(remoteEntry) ? Number(remoteEntry[0]) || 0 : 0;
      const localTime = Array.isArray(localEntry) ? Number(localEntry[0]) || 0 : 0;
      merged[targetKey] = [Math.max(remoteTime, localTime, Date.now() / 1000), remoteHits];
    }
    remoteKeyByNorm.set(targetKey.toLowerCase().replace(/\s+/g, ' ').trim(), targetKey);
  }
  return merged;
}

async function qbTmGitHubPut(settings, bank, sha) {
  const encodedPath = settings.path.split('/').map(encodeURIComponent).join('/');
  const url = 'https://api.github.com/repos/' + encodeURIComponent(settings.owner) + '/'
    + encodeURIComponent(settings.repo) + '/contents/' + encodedPath;
  const body = {
    message: 'Moodle Quiz Bot: auto-sync from Tampermonkey',
    content: qbTmBase64FromUtf8(JSON.stringify(bank, null, 2)),
  };
  if (sha) body.sha = sha;
  const response = await qbTmRequest({
    method: 'PUT',
    url,
    headers: qbTmGitHubHeaders(settings.token),
    data: JSON.stringify(body),
    timeout: 90000,
  });
  if (response.status < 200 || response.status >= 300) {
    const error = new Error('GitHub PUT failed: HTTP ' + response.status + ' ' + response.responseText.slice(0, 300));
    error.status = response.status;
    throw error;
  }
  return qbTmParseJson(response.responseText, 'GitHub Contents API');
}

async function qbTmPullBank(settings) {
  const meta = await qbTmGitHubGetFile(settings);
  if (meta.missing) return { status: 'missing', added: 0, questions: 0, sha: null };
  const bankStorage = window.__qbTmBankStorage;
  if (!bankStorage || typeof bankStorage.mergeRemoteBankIntoLocal !== 'function') {
    throw new Error('Question bank storage is not ready');
  }
  const result = await bankStorage.mergeRemoteBankIntoLocal(meta.content);
  return { status: 'ok', added: result.added, questions: result.questions, sha: meta.sha, size: meta.size };
}

async function qbTmSyncBank(payload) {
  const settings = await qbTmGitHubSettings(payload || {});
  if (!settings.owner || !settings.repo) return { status: 'skipped' };
  let meta = await qbTmGitHubGetFile(settings);
  let remote = meta.missing ? {} : meta.content;
  if (!meta.missing && !qbTmBankQuestions(remote)) throw new Error('Remote question bank is not a JSON object');
  let questions = await qbTmMergeBank(remote);
  let bank = remote && remote.questions && typeof remote.questions === 'object'
    ? { ...remote, questions, updatedAt: new Date().toISOString() }
    : questions;
  try {
    await qbTmGitHubPut(settings, bank, meta.sha);
  } catch (error) {
    if (error.status !== 409 && error.status !== 422) throw error;
    meta = await qbTmGitHubGetFile(settings);
    remote = meta.missing ? {} : meta.content;
    if (!meta.missing && !qbTmBankQuestions(remote)) throw new Error('Remote question bank is not a JSON object');
    questions = await qbTmMergeBank(remote);
    bank = remote && remote.questions && typeof remote.questions === 'object'
      ? { ...remote, questions, updatedAt: new Date().toISOString() }
      : questions;
    await qbTmGitHubPut(settings, bank, meta.sha);
  }
  const count = Object.keys(questions).filter((key) => !['questions', 'updatedAt', 'format', 'version', 'exportedAt'].includes(key)).length;
  return { status: 'ok', added: 0, pushed: count, questions: count };
}

async function qbTmProviderRequest(action, payload) {
  const settings = await chrome.storage.sync.get([
    'OPENROUTER_API_KEY', 'OPENROUTER_MODEL', 'OPENROUTER_API_URL',
    'GEMINI_API_KEY', 'GEMINI_MODEL',
    'CUSTOM_API_KEY', 'CUSTOM_API_BASE_URL', 'CUSTOM_MODEL', 'DEEPSEEK_API_KEY',
    'OLLAMA_URL', 'OLLAMA_MODEL', 'OLLAMA_API_KEY',
  ]);
  const data = payload || {};
  if (action === 'postOpenRouter') {
    const url = settings.OPENROUTER_API_URL || 'https://openrouter.ai/api/v1/chat/completions';
    const response = await qbTmRequest({
      method: 'POST', url,
      headers: {
        Authorization: 'Bearer ' + (settings.OPENROUTER_API_KEY || ''),
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://moodle-quiz-bot.local',
        'X-Title': 'Moodle Quiz Bot',
      },
      data: JSON.stringify(data.body || {}),
      timeout: data.timeout || 30000,
    });
    const json = qbTmParseJson(response.responseText, 'OpenRouter');
    return response.status >= 200 && response.status < 300
      ? { ...json, _reqId: data._reqId }
      : { _reqId: data._reqId, status: response.status, error: 'HTTP ' + response.status + ': ' + response.responseText.slice(0, 300) };
  }
  if (action === 'postCustomApi') {
    const deepseekDirect = !settings.CUSTOM_API_KEY && !!settings.DEEPSEEK_API_KEY;
    const base = String(deepseekDirect
      ? 'https://api.deepseek.com/v1'
      : settings.CUSTOM_API_BASE_URL || '').replace(/\/$/, '');
    if (!base) return { _reqId: data._reqId, error: 'Custom API base URL is not configured' };
    const headers = { 'Content-Type': 'application/json' };
    const apiKey = settings.CUSTOM_API_KEY || settings.DEEPSEEK_API_KEY;
    if (apiKey) headers.Authorization = 'Bearer ' + apiKey;
    const body = data.body || {};
    if (deepseekDirect && (!body.model || body.model === 'auto')) body.model = 'deepseek-chat';
    const response = await qbTmRequest({
      method: 'POST', url: base + '/chat/completions', headers,
      data: JSON.stringify(body), timeout: data.timeout || 30000,
    });
    const json = qbTmParseJson(response.responseText, 'Custom API');
    return response.status >= 200 && response.status < 300
      ? { ...json, _reqId: data._reqId }
      : { _reqId: data._reqId, status: response.status, error: 'HTTP ' + response.status + ': ' + response.responseText.slice(0, 300) };
  }
  if (action === 'postGemini') {
    const keys = String(settings.GEMINI_API_KEY || '').split(/[\s,;]+/).filter(Boolean);
    if (!keys.length) return { _reqId: data._reqId, error: 'Gemini API key is missing' };
    const model = encodeURIComponent(data.model || settings.GEMINI_MODEL || 'gemini-3.8-flash');
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model
      + ':generateContent?key=' + encodeURIComponent(keys[0]);
    const response = await qbTmRequest({
      method: 'POST', url, headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify({ contents: data.contents || [], generationConfig: data.generationConfig }),
      timeout: data.timeout || 30000,
    });
    const json = qbTmParseJson(response.responseText, 'Gemini');
    if (response.status < 200 || response.status >= 300) {
      return { _reqId: data._reqId, status: response.status, error: 'Gemini HTTP ' + response.status + ': ' + response.responseText.slice(0, 300) };
    }
    return {
      _reqId: data._reqId,
      text: (json.candidates && json.candidates[0] && json.candidates[0].content && json.candidates[0].content.parts || [])
        .map((part) => part.text || '').join('').trim(),
    };
  }
  if (action === 'postOllama') {
    const url = String(settings.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, '') + '/api/generate';
    const headers = { 'Content-Type': 'application/json' };
    if (settings.OLLAMA_API_KEY) headers.Authorization = 'Bearer ' + settings.OLLAMA_API_KEY;
    const response = await qbTmRequest({
      method: 'POST', url, headers, data: JSON.stringify(data.payload || {}),
      timeout: data.timeout || 60000,
    });
    const json = qbTmParseJson(response.responseText, 'Ollama');
    return response.status >= 200 && response.status < 300
      ? { ...json, _reqId: data._reqId }
      : { _reqId: data._reqId, status: response.status, error: 'HTTP ' + response.status + ': ' + response.responseText.slice(0, 300) };
  }
  return null;
}

async function qbTmAskAI(payload) {
  const input = payload || {};
  const prompt = String(input.prompt || input.question || input.text || '');
  const messages = Array.isArray(input.messages) ? input.messages : [{ role: 'user', content: prompt }];
  const settings = await chrome.storage.sync.get(['GEMINI_API_KEY', 'OPENROUTER_API_KEY', 'CUSTOM_API_KEY', 'DEEPSEEK_API_KEY']);
  if (settings.OPENROUTER_API_KEY) {
    const result = await qbTmProviderRequest('postOpenRouter', {
      body: { model: input.model || 'deepseek/deepseek-chat', messages, temperature: input.temperature || 0.1, max_tokens: input.maxTokens || 512 },
      timeout: input.timeout || 30000,
    });
    if (!result.error && result.choices) return { text: result.choices[0] && result.choices[0].message && result.choices[0].message.content || '', response: result };
  }
  if (settings.GEMINI_API_KEY) {
    const result = await qbTmProviderRequest('postGemini', {
      contents: messages.map((message) => ({
        role: message.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: typeof message.content === 'string' ? message.content : JSON.stringify(message.content) }],
      })),
      timeout: input.timeout || 30000,
    });
    if (!result.error) return { text: result.text || '', response: result };
  }
  if (settings.CUSTOM_API_KEY || settings.DEEPSEEK_API_KEY) {
    const result = await qbTmProviderRequest('postCustomApi', {
      body: { model: input.model || 'auto', messages, temperature: input.temperature || 0.1, max_tokens: input.maxTokens || 512 },
      timeout: input.timeout || 30000,
    });
    if (!result.error) return { text: result.choices && result.choices[0] && result.choices[0].message && result.choices[0].message.content || '', response: result };
  }
  throw new Error('Configure an OpenRouter/DeepSeek, Gemini, or custom API key in Quiz Bot Settings');
}

function qbTmSearchWeb(query, maxResults) {
  const term = String(query || '').replace(/\s+/g, ' ').trim();
  if (!term) return Promise.resolve({ text: '' });
  const limit = Math.min(Math.max(Number(maxResults) || 3, 1), 5);
  return qbTmRequest({
    url: 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(term.slice(0, 400)),
    headers: { Accept: 'text/html' }, timeout: 10000,
  }).then((response) => {
    if (response.status < 200 || response.status >= 300) return { text: '' };
    const html = response.responseText;
    const snippets = [];
    const seen = new Set();
    const pattern = /<(?:a|div)[^>]*class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|div)>/gi;
    let match;
    while ((match = pattern.exec(html)) && snippets.length < limit) {
      const snippet = match[1].replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
        .replace(/\s+/g, ' ').trim().slice(0, 400);
      if (snippet && !seen.has(snippet)) {
        seen.add(snippet);
        snippets.push((snippets.length + 1) + '. ' + snippet);
      }
    }
    return { text: snippets.join('\n') };
  }).catch(() => ({ text: '' }));
}

async function qbTmHandleMessage(message) {
  const action = message && (message.action || message.type);
  const payload = message && (message.payload || message);
  const reqId = message && message._reqId;
  if (action === 'GET_CURRENT_TAB_ID') {
    const key = '__qb_tm_tab_id';
    let id = 0;
    try { id = Number(sessionStorage.getItem(key)) || 0; } catch (error) { /* unavailable */ }
    if (!id) {
      id = Math.floor(Date.now() + Math.random() * 1000000);
      try { sessionStorage.setItem(key, String(id)); } catch (error) { /* unavailable */ }
    }
    return { _reqId: reqId, tabId: id };
  }
  if (action === 'SYNC_GITHUB_BANK') {
    try { return { _reqId: reqId, ...await qbTmSyncBank(payload) }; }
    catch (error) { return { _reqId: reqId, error: error.message || String(error) }; }
  }
  if (action === 'GITHUB_BANK_PULL') {
    try {
      const settings = await qbTmGitHubSettings(payload);
      if (!settings.owner || !settings.repo) return { _reqId: reqId, status: 'skipped' };
      return { _reqId: reqId, ...await qbTmPullBank(settings) };
    } catch (error) { return { _reqId: reqId, error: error.message || String(error) }; }
  }
  if (action === 'FETCH_URL') {
    try {
      const url = payload.url || message.url;
      if (!url) throw new Error('FETCH_URL requires a URL');
      const response = await qbTmRequest({
        method: payload.method || 'GET',
        url,
        headers: payload.headers || {},
        data: payload.body,
        timeout: payload.timeout || 30000,
      });
      return { _reqId: reqId, ...response, text: response.responseText };
    } catch (error) { return { _reqId: reqId, error: error.message || String(error) }; }
  }
  if (action === 'SEARCH_WEB_SNIPPETS') {
    const result = await qbTmSearchWeb(payload.query, payload.maxResults);
    return { _reqId: reqId, ...result };
  }
  if (action === 'ASK_AI') {
    try { return { _reqId: reqId, ...await qbTmAskAI(payload) }; }
    catch (error) { return { _reqId: reqId, error: error.message || String(error) }; }
  }
  if (action === 'postOpenRouter' || action === 'postGemini' || action === 'postCustomApi' || action === 'postOllama') {
    try { return await qbTmProviderRequest(action, { ...payload, _reqId: reqId }); }
    catch (error) { return { _reqId: reqId, error: error.message || String(error) }; }
  }
  if (action === 'log' || action === 'CHECK_EXTENSION_UPDATE' || action === 'AUTO_HARVEST') {
    return { _reqId: reqId, status: 'unavailable' };
  }
  return { _reqId: reqId, error: 'Unsupported userscript action: ' + String(action || '') };
}

function qbTmDispatchMessage(message, callback) {
  const pending = qbTmHandleMessage(message);
  if (typeof callback === 'function') {
    pending.then((response) => callback(response), (error) => {
      qbTmLastError = { message: error.message || String(error) };
      callback({ error: qbTmLastError.message, _reqId: message && message._reqId });
      qbTmLastError = null;
    });
  }
  return pending;
}

function qbTmRuntimeEvent() {
  const listeners = new Set();
  return {
    addListener(listener) { listeners.add(listener); },
    removeListener(listener) { listeners.delete(listener); },
    hasListener(listener) { return listeners.has(listener); },
    _listeners: listeners,
  };
}

const qbTmChrome = window.chrome || {};
qbTmChrome.storage = qbTmChrome.storage || {};
qbTmChrome.storage.local = qbTmStorageArea('local');
qbTmChrome.storage.sync = qbTmStorageArea('sync');
qbTmChrome.storage.onChanged = {
  addListener(listener) { qbTmStorageListeners.add(listener); },
  removeListener(listener) { qbTmStorageListeners.delete(listener); },
  hasListener(listener) { return qbTmStorageListeners.has(listener); },
};
qbTmChrome.runtime = qbTmChrome.runtime || {};
qbTmChrome.runtime.id = qbTmChrome.runtime.id || 'moodle-quiz-bot-userscript';
qbTmChrome.runtime.lastError = null;
qbTmChrome.runtime.sendMessage = qbTmDispatchMessage;
qbTmChrome.runtime.onMessage = qbTmRuntimeEvent();
qbTmChrome.runtime.onConnect = qbTmRuntimeEvent();
qbTmChrome.runtime.getManifest = () => QB_TM_MANIFEST;
qbTmChrome.runtime.getURL = (name) => {
  if (name === 'hud.css') return 'data:text/css;charset=utf-8,' + encodeURIComponent(QB_TM_HUD_CSS);
  return 'https://raw.githubusercontent.com/ambotlangnimo/moodle-quiz-bot/main/' + encodeURIComponent(name);
};
try { window.chrome = qbTmChrome; } catch (error) { Object.assign(window.chrome, qbTmChrome); }
try {
  Object.defineProperty(qbTmChrome.runtime, 'lastError', {
    configurable: true,
    get() { return qbTmLastError; },
  });
} catch (error) { /* a partial browser chrome object may expose a non-configurable property */ }

const QB_TM_SETTINGS = [
  ['GITHUB_BANK_OWNER', 'GitHub owner'],
  ['GITHUB_BANK_REPO', 'Question bank repository'],
  ['GITHUB_BANK_PATH', 'Question bank file path'],
  ['GITHUB_SYNC_TOKEN', 'GitHub token (repo contents access)'],
  ['OPENROUTER_API_KEY', 'OpenRouter API key'],
  ['DEEPSEEK_API_KEY', 'DeepSeek API key'],
  ['OPENROUTER_MODEL', 'OpenRouter / DeepSeek model'],
  ['GEMINI_API_KEY', 'Gemini API key(s)'],
  ['CUSTOM_API_BASE_URL', 'Custom API base URL'],
  ['CUSTOM_API_KEY', 'Custom API key'],
  ['CUSTOM_MODEL', 'Custom API model'],
];

function qbTmOpenSettings() {
  let overlay = document.getElementById('qb-tm-settings-overlay');
  if (overlay) { overlay.style.display = 'flex'; return; }
  overlay = document.createElement('div');
  overlay.id = 'qb-tm-settings-overlay';
  const dialog = document.createElement('section');
  dialog.id = 'qb-tm-settings-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'qb-tm-settings-title');
  const heading = document.createElement('h2');
  heading.id = 'qb-tm-settings-title';
  heading.textContent = 'Quiz Bot Settings & GitHub Sync';
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = '×';
  close.setAttribute('aria-label', 'Close settings');
  close.className = 'qb-tm-close';
  close.addEventListener('click', () => { overlay.style.display = 'none'; });
  const form = document.createElement('div');
  form.id = 'qb-tm-settings-fields';
  const status = document.createElement('p');
  status.id = 'qb-tm-settings-status';
  status.setAttribute('role', 'status');
  const actions = document.createElement('div');
  actions.className = 'qb-tm-actions';
  const save = document.createElement('button');
  save.type = 'button';
  save.textContent = 'Save Settings';
  save.className = 'qb-tm-primary';
  const sync = document.createElement('button');
  sync.type = 'button';
  sync.textContent = 'Sync Now';
  sync.className = 'qb-tm-secondary';
  actions.append(save, sync);
  dialog.append(close, heading, form, status, actions);
  overlay.appendChild(dialog);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) overlay.style.display = 'none';
  });
  document.body.appendChild(overlay);

  GM_addStyle('#qb-tm-settings-overlay{position:fixed;inset:0;z-index:2147483647;background:rgba(2,6,23,.78);display:flex;align-items:center;justify-content:center;padding:20px;font:14px system-ui,sans-serif;color:#e2e8f0}#qb-tm-settings-dialog{position:relative;width:min(620px,100%);max-height:90vh;overflow:auto;background:#111b31;border:1px solid #475569;border-radius:14px;padding:24px;box-shadow:0 20px 70px #000b}#qb-tm-settings-title{margin:0 40px 18px 0;color:#ffb347;font-size:20px}.qb-tm-close{position:absolute;right:14px;top:12px;background:#253550;color:#fff;border:0;border-radius:6px;font-size:22px;width:34px;height:34px;cursor:pointer}#qb-tm-settings-fields{display:grid;grid-template-columns:1fr 1fr;gap:12px}.qb-tm-field{display:flex;flex-direction:column;gap:5px;color:#cbd5e1}.qb-tm-field input{box-sizing:border-box;width:100%;padding:9px 10px;border:1px solid #475569;border-radius:7px;background:#0b1220;color:#f8fafc;font:inherit}.qb-tm-field:nth-child(4),.qb-tm-field:nth-child(5),.qb-tm-field:nth-child(7),.qb-tm-field:nth-child(8),.qb-tm-field:nth-child(9),.qb-tm-field:nth-child(10){grid-column:1/-1}.qb-tm-actions{display:flex;gap:10px;justify-content:flex-end;margin-top:18px}.qb-tm-actions button{border:0;border-radius:7px;padding:10px 16px;color:#fff;font-weight:600;cursor:pointer}.qb-tm-primary{background:#2563eb}.qb-tm-secondary{background:#0f766e}#qb-tm-settings-status{min-height:1.4em;margin:12px 0 0;color:#86efac}#qb-tm-settings-status.error{color:#fca5a5}@media(max-width:560px){#qb-tm-settings-fields{grid-template-columns:1fr}.qb-tm-field{grid-column:1/-1}}');
  for (const [key, label] of QB_TM_SETTINGS) {
    const wrapper = document.createElement('label');
    wrapper.className = 'qb-tm-field';
    const caption = document.createElement('span');
    caption.textContent = label;
    const input = document.createElement('input');
    input.dataset.key = key;
    input.type = /TOKEN|API_KEY/.test(key) ? 'password' : 'text';
    input.autocomplete = 'off';
    input.spellcheck = false;
    wrapper.append(caption, input);
    form.appendChild(wrapper);
  }
  const fill = async () => {
    try {
      for (const input of form.querySelectorAll('input[data-key]')) {
        input.value = await qbTmGMGet(QB_TM_SYNC_PREFIX + input.dataset.key, '');
        if (input.dataset.key === 'GITHUB_BANK_PATH' && !input.value) input.value = 'bank.json';
        if (input.dataset.key === 'OPENROUTER_MODEL' && !input.value) input.value = 'deepseek/deepseek-v4.1-flash';
        if (input.dataset.key === 'CUSTOM_API_BASE_URL' && !input.value) input.value = 'https://api.freellmapi.com/v1';
      }
    } catch (error) {
    status.textContent = 'Could not load settings: ' + error.message;
    status.classList.add('error');
    }
  };
  const collect = () => {
    const values = {};
    for (const input of form.querySelectorAll('input[data-key]')) values[input.dataset.key] = input.value.trim();
    return values;
  };
  save.addEventListener('click', async () => {
    save.disabled = true;
    status.classList.remove('error');
    status.textContent = 'Saving settings...';
    try {
      await chrome.storage.sync.set(collect());
      if (typeof window.__qbTmReloadConfig === 'function') await window.__qbTmReloadConfig();
      status.textContent = 'Settings saved across your Tampermonkey tabs.';
    } catch (error) {
      status.textContent = 'Save failed: ' + error.message;
      status.classList.add('error');
    } finally { save.disabled = false; }
  });
  sync.addEventListener('click', async () => {
    sync.disabled = true;
    status.classList.remove('error');
    status.textContent = 'Syncing question bank with GitHub...';
    try {
      await chrome.storage.sync.set(collect());
      if (typeof window.__qbTmReloadConfig === 'function') await window.__qbTmReloadConfig();
      const result = await qbTmHandleMessage({ action: 'SYNC_GITHUB_BANK' });
      if (result.error) throw new Error(result.error);
      status.textContent = result.status === 'skipped'
        ? 'Enter a GitHub owner and repository, then save or sync again.'
        : 'Sync complete: ' + (result.pushed || 0) + ' question(s) in GitHub bank.';
    } catch (error) {
      status.textContent = 'Sync failed: ' + error.message;
      status.classList.add('error');
    } finally { sync.disabled = false; }
  });
  void fill();
}

try {
  GM_registerMenuCommand('⚙️ Quiz Bot Settings & GitHub Sync', qbTmOpenSettings);
} catch (error) { console.warn('[Quiz Bot] Could not register settings menu:', error); }

function qbTmAddGearButton(header) {
  if (!header || header.querySelector('.qb-tm-settings-gear')) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'qb-tm-settings-gear';
  button.textContent = '⚙️';
  button.title = 'Quiz Bot Settings & GitHub Sync';
  button.setAttribute('aria-label', button.title);
  button.style.cssText = 'flex:0 0 auto;border:1px solid #64748b;border-radius:6px;background:#16213e;color:#fff;padding:4px 7px;cursor:pointer;line-height:1.2';
  button.addEventListener('mousedown', (event) => event.stopPropagation());
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    qbTmOpenSettings();
  });
  header.appendChild(button);
}

GM_addStyle(QB_TM_HUD_CSS);

const qbTmIsAmaes = location.hostname.toLowerCase() === 'amaes.com'
  || location.hostname.toLowerCase().endsWith('.amaes.com');
if (qbTmIsAmaes) {
  (function () {

;
// ─────────────────────────────────────────────────────────────────────────────
//  CONFIG — defaults + chrome.storage.sync overlay
//  Ported verbatim from bot.py + answerkey.py environment variables.
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULTS = Object.freeze({
  // Moodle
  MOODLE_URL: 'https://amaes.com',

  // FreeLLMAPI / Custom OpenAI-compatible endpoint
  CUSTOM_API_BASE_URL: 'https://api.freellmapi.com/v1',
  CUSTOM_API_KEY: '',
  CUSTOM_MODEL: 'auto',

  // GitHub Question Bank
  GITHUB_BANK_OWNER: '',
  GITHUB_BANK_REPO: '',
  GITHUB_BANK_PATH: 'bank.json',
  GITHUB_SYNC_TOKEN: '',
  // Legacy alias. The options page writes `GITHUB_SYNC_TOKEN`; the sync code
  // accepts either (the primary key wins) so older saved settings keep working.
  GITHUB_BANK_TOKEN: '',

  // OpenRouter
  OPENROUTER_API_KEY: '',
  OPENROUTER_MODEL: 'deepseek/deepseek-v4.1-flash',
  OPENROUTER_VISION_MODEL: '',
  OPENROUTER_COOLDOWN: 180,
  OPENROUTER_API_URL: 'https://openrouter.ai/api/v1/chat/completions',
  OPENROUTER_WEB_ENABLED: false, // web plugin is billed per search; off = much cheaper

  // Gemini (`GEMINI_API_KEY` accepts comma/newline separated backup keys)
  GEMINI_API_KEY: '',
  GEMINI_MODEL: 'gemini-3.8-flash',
  GEMINI_KEY_COOLDOWN: 180,

  // Ollama
  OLLAMA_URL: 'http://127.0.0.1:11434',
  OLLAMA_MODEL: 'qwen2.5:7b',
  OLLAMA_VISION_MODEL: '',
  OLLAMA_API_KEY: '',
  OLLAMA_NUM_CTX: 4096,
  OLLAMA_KEEP_ALIVE: '10m',
  OLLAMA_TIMEOUT_MS: 60000,

  // Behaviour
  PAUSE_AFTER_ANSWER: 300,
  PAUSE_AFTER_NEXT: 500,
  AUTO_CLICK_NEXT: true,
  AUTO_SUBMIT: true,
  SCAN_INTERVAL: 300,
  NAV_WAIT_MS: 900,
  MAX_SUBMIT_TRIES: 4,
  AUTO_REATTEMPT: false,

  // Short-answer
  SHORT_ANSWER_ENABLED: true,
  TYPE_DELAY_MS: 8,
  MAX_TEXT_RETRIES: 2,
  TYPE_ON_FAILURE: true,

  // Multi-answer
  MULTI_ENABLED: true,
  MULTI_MAX_PICKS: 4,

  // Matching
  MATCHING_ENABLED: true,
  MATCHING_MIN_MATCHED: 0.6,
  MATCHING_OPTION_FLOOR: 0.45,

  // True/False
  BOOL_QUESTION_MIN_SCORE: 0.55,

  // Vision
  VISION_ENABLED: true,
  MAX_QUESTION_IMAGES: 2,

  // Answer key (amauoed.com)
  ANSWER_KEY_ENABLED: true,
  ANSWER_KEY_TIMEOUT: 4,
  ANSWER_KEY_MIN_SCORE: 0.72,
  ANSWER_KEY_TEXT_MIN_SCORE: 0.82,
  ANSWER_KEY_MATCH_MIN_SCORE: 0.8,
  ANSWER_KEY_MAX_HITS: 4,

  // Web search
  WEB_SEARCH_ENABLED: true,
  WEB_SEARCH_MAX_RESULTS: 3,
  WEB_SEARCH_DOMAINS: 'amauoed.com,studocu.com,coursehero.com,docsity.com',

  // Limits
  MAX_Q_CHARS: 1200,
  WEB_Q_CHARS: 380,
  MAX_RUN_HOURS: 8,
  MANUAL_TIMEOUT: 300,

  // Answer key cache
  CACHE_TTL: 0,
  CACHE_MAX: 50000,

  // Extension specific
  BOT_ENABLED: true,
});

const PLACEHOLDER_RE = /answer\s*\d+\s*[\.\)]?\s*question\s*\d+/gi;

// In-memory merged config.
let _merged = { ...DEFAULTS };

/**
 * Load settings from chrome.storage.sync and merge with defaults.
 * Called once at startup by background.js and content.js.
 */
async function loadConfig() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(null, (items) => {
      if (chrome.runtime.lastError) {
        console.warn('[config] storage.sync error:', chrome.runtime.lastError.message);
        resolve({ ...DEFAULTS });
        return { ...DEFAULTS };
      }
      _merged = { ...DEFAULTS };
      for (const [k, v] of Object.entries(items)) {
        if (k in DEFAULTS && v !== undefined && v !== null) {
          _merged[k] = v;
        }
      }
      const geminiModel = String(_merged.GEMINI_MODEL || '').trim();
      if (!geminiModel || geminiModel === 'gemini-2.5-flash') {
        _merged.GEMINI_MODEL = 'gemini-3.8-flash';
        chrome.storage.sync.set({ GEMINI_MODEL: _merged.GEMINI_MODEL });
      }
      const ollamaUrl = String(_merged.OLLAMA_URL || '').trim();
      const ollamaModel = String(_merged.OLLAMA_MODEL || '').trim();
      const ollamaUpdates = {};
      if (!ollamaUrl) {
        _merged.OLLAMA_URL = DEFAULTS.OLLAMA_URL;
        ollamaUpdates.OLLAMA_URL = _merged.OLLAMA_URL;
      }
      if (!ollamaModel || ollamaModel === 'gemma4:e2b') {
        _merged.OLLAMA_MODEL = DEFAULTS.OLLAMA_MODEL;
        ollamaUpdates.OLLAMA_MODEL = _merged.OLLAMA_MODEL;
      }
      if (Object.keys(ollamaUpdates).length) chrome.storage.sync.set(ollamaUpdates);
      resolve(_merged);
    });
  });
}

/**
 * Save a set of config keys to storage.sync.
 */
async function saveConfig(updates) {
  return new Promise((resolve) => {
    const filtered = {};
    for (const [k, v] of Object.entries(updates)) {
      if (k in DEFAULTS) {
        filtered[k] = v;
        _merged[k] = v;
      }
    }
    chrome.storage.sync.set(filtered, () => {
      resolve();
    });
  });
}

/**
 * Get a single config value (synchronous, from in-memory copy).
 */
function cfg(key) {
  return _merged[key];
}

/**
 * Get all config.
 */
function getAllConfig() {
  return { ..._merged };
}

/**
 * Ollama timeout in ms: accepts seconds (< 1000) or ms, never below 30 s.
 */
function ollamaTimeoutMs(value) {
  let ms = Number(value) || Number(_merged.OLLAMA_TIMEOUT_MS) || 60000;
  if (ms < 1000) ms *= 1000;
  return Math.max(ms, 30000);
}

;
// ─────────────────────────────────────────────────────────────────────────────
//  STORAGE — promise-mutex serialized read-modify-write cycle
//  chrome.storage.local for answer key cache, wrong cache, search cache.
//  In-memory mirror for hot-path lookups.
// ─────────────────────────────────────────────────────────────────────────────

// ── Promise-mutex serialiser ────────────────────────────────────────────────
let _queue = Promise.resolve();

/**
 * Serialise a read-modify-write cycle end to end.
 * fn receives the current data dict, must return the new data dict (or same).
 */
async function mutex(fn) {
  _queue = _queue.then(fn, fn);
  return _queue;
}

// ── In-memory mirrors ───────────────────────────────────────────────────────
let _answerKeyMem = {};
let _wrongMem = {};
let _searchMem = {};

const STORAGE_KEYS = {
  ANSWER_KEY: 'answerkey_cache',
  WRONG: 'wrong_cache',
  SEARCH: 'search_cache',
};

/**
 * Validate shape of loaded data; drop malformed entries.
 */
function validateAnswerKey(data) {
  if (typeof data !== 'object' || data === null) return {};
  const out = {};
  for (const [rawKey, value] of Object.entries(data)) {
    const key = normText(rawKey);
    if (!key) continue;
    const entry = normalizeAnswerEntry(rawKey, value);
    if (!entry) continue;
    if (!out[key]) {
      out[key] = entry;
      continue;
    }
    const hits = out[key][1];
    for (const hit of entry[1]) {
      if (!hits.some((existing) =>
        normText(existing.question) === normText(hit.question) &&
        normText(existing.answer) === normText(hit.answer)
      )) hits.push(hit);
    }
    out[key][0] = Math.max(out[key][0], entry[0]);
  }
  return out;
}

function normalizeAnswerEntry(question, value) {
  let timestamp = Date.now() / 1000;
  let rawHits;
  if (Array.isArray(value) && value.length === 2 &&
      typeof value[0] === 'number' && Array.isArray(value[1])) {
    timestamp = value[0];
    rawHits = value[1];
  } else if (typeof value === 'string' || (value && typeof value === 'object')) {
    rawHits = [value];
  } else {
    return null;
  }

  const hits = [];
  for (const rawHit of rawHits) {
    const hit = typeof rawHit === 'string' ? { answer: rawHit } : rawHit;
    if (!hit || typeof hit.answer !== 'string' || !hit.answer.trim()) continue;
    const normalized = {
      question: typeof hit.question === 'string' && hit.question.trim()
        ? hit.question.trim()
        : question,
      answer: hit.answer.trim(),
      course: typeof hit.course === 'string' ? hit.course : 'imported',
      verified: hit.verified === true,
    };
    // Keep an explicit "known wrong" marker so it can be purged on the next write.
    if (hit.wrong === true) normalized.wrong = true;
    hits.push(normalized);
  }
  return [timestamp, hits];
}

function validateWrong(data) {
  if (typeof data !== 'object' || data === null) return {};
  const out = {};
  for (const [k, v] of Object.entries(data)) {
    if (Array.isArray(v)) {
      out[k] = v.filter((x) => typeof x === 'string');
    }
  }
  return out;
}

function validateSearch(data) {
  if (typeof data !== 'object' || data === null) return {};
  const out = {};
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

// ── Load all caches into memory on first access ────────────────────────────
let _loaded = false;
let _loadPromise = null;

function ensureLoaded() {
  if (!_loadPromise) {
    _loadPromise = (async () => {
      await loadConfig();
      const result = await chrome.storage.local.get([
        STORAGE_KEYS.ANSWER_KEY,
        STORAGE_KEYS.WRONG,
        STORAGE_KEYS.SEARCH,
      ]);
      _answerKeyMem = validateAnswerKey(result[STORAGE_KEYS.ANSWER_KEY] || {});
      _wrongMem = validateWrong(result[STORAGE_KEYS.WRONG] || {});
      _searchMem = validateSearch(result[STORAGE_KEYS.SEARCH] || {});
      _loaded = true;
    })();
  }
  return _loadPromise;
}

// ── Dirty tracking: several contexts (worker, tabs, options) share storage, so
//    a flush merges only the keys this context changed instead of overwriting.
const _dirty = { ak: new Set(), wrong: new Set(), search: new Set() };
const _deleted = { ak: new Set(), wrong: new Set(), search: new Set() };

function markKey(kind, key, removed = false) {
  if (!key) return;
  (removed ? _deleted : _dirty)[kind].add(key);
  (removed ? _dirty : _deleted)[kind].delete(key);
}

function overlayPending(kind, base, mem) {
  const out = base && typeof base === 'object' ? { ...base } : {};
  for (const key of _dirty[kind]) if (key in mem) out[key] = mem[key];
  for (const key of _deleted[kind]) delete out[key];
  return out;
}

// Keep the in-memory mirror in sync with writes from other contexts.
if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !_loaded) return;
    if (changes[STORAGE_KEYS.ANSWER_KEY]) {
      _answerKeyMem = overlayPending('ak', changes[STORAGE_KEYS.ANSWER_KEY].newValue, _answerKeyMem);
    }
    if (changes[STORAGE_KEYS.WRONG]) {
      _wrongMem = overlayPending('wrong', changes[STORAGE_KEYS.WRONG].newValue, _wrongMem);
    }
    if (changes[STORAGE_KEYS.SEARCH]) {
      _searchMem = overlayPending('search', changes[STORAGE_KEYS.SEARCH].newValue, _searchMem);
    }
  });
}

// ── Debounced cache flush ────────────────────────────────────────────────────
let _flushTimer = null;
const FLUSH_DEBOUNCE_MS = 500;

function scheduleFlush() {
  if (_flushTimer) clearTimeout(_flushTimer);
  _flushTimer = setTimeout(doFlush, FLUSH_DEBOUNCE_MS);
}

async function flushNow() {
  if (_flushTimer) clearTimeout(_flushTimer);
  _flushTimer = null;
  await doFlush();
}
// ── Answer key cache ────────────────────────────────────────────────────────
async function answerKeyGet(key, options = {}) {
  await ensureLoaded();
  key = normText(key);
  const entry = _answerKeyMem[key];
  if (!entry) return null;
  const ts = entry[0];
  const ttl = cfg('CACHE_TTL');
  const permanent = entry[1].some((hit) => hit && (
    hit.course === 'learned-review' ||
    hit.course === 'imported' ||
    (typeof hit.course === 'string' && hit.course.startsWith('harvested-'))
  ));
  if (ttl > 0 && !permanent && Date.now() / 1000 - ts > ttl) {
    delete _answerKeyMem[key];
    markKey('ak', key, true);
    scheduleFlush();
    return null;
  }
  const wrong = (await getWrongAnswers(key)).map((answer) => normText(answer)).filter(Boolean);
  const includeUnverified = options && options.includeUnverified === true;
  return entry[1].filter((hit) => {
    if (!hit || hit.wrong === true) return false;
    if (!includeUnverified && hit.verified !== true) return false;
    const answer = hitAnswerNorm(hit);
    return !answer || !wrong.some((knownWrong) =>
      answer === knownWrong || similarity(answer, knownWrong) >= 0.9
    );
  });
}

function hitAnswerNorm(hit) {
  if (!hit || typeof hit !== 'object' || typeof hit.answer !== 'string') return '';
  return normText(hit.answer);
}

// Verified answers always outrank unverified ones and conflicting guesses are
// purged: as soon as a question has a `verified: true` hit, every hit with a
// different answer is dropped and the verified hit is moved to index 0.
// Hits flagged `wrong: true` never survive a write.
function rankHits(hits) {
  if (!Array.isArray(hits)) return [];
  const verified = [];
  const unverified = [];
  const other = [];
  const seen = new Set();
  for (const hit of hits) {
    if (hit && typeof hit === 'object' && hit.wrong === true) continue;
    const answerNorm = hitAnswerNorm(hit);
    if (!answerNorm) { other.push(hit); continue; }
    if (seen.has(answerNorm)) continue;
    seen.add(answerNorm);
    if (hit.verified === true) verified.push(hit);
    else unverified.push(hit);
  }
  if (!verified.length) return unverified.concat(other);
  const verifiedNorms = verified.map(hitAnswerNorm);
  const kept = unverified.filter((hit) => {
    const answerNorm = hitAnswerNorm(hit);
    // Keep unverified hits that are only a spacing/punctuation variant of a
    // verified answer; everything else is a conflicting guess and is purged.
    return verifiedNorms.some((norm) => norm === answerNorm || similarity(answerNorm, norm) >= 0.9);
  });
  return verified.concat(kept, other);
}

// `opts.replaceVerified` is for single-answer keys (one matching statement, one
// MCQ prompt): a freshly graded verified answer retires older verified hits that
// now contradict it, so a stale pair can never outrank Moodle's latest result.
async function answerKeyPut(key, hits, course = 'learned-review', opts = {}) {
  await ensureLoaded();
  const verified = !!(opts && opts.verified);
  const replaceVerified = !!(opts && opts.replaceVerified);
  if (typeof hits === 'string') {
    const question = key;
    key = normText(question);
    const answer = hits.replace(/<[^>]+>/g, '').trim();
    if (!key || !answer) return;
    const answerNorm = normText(answer);
    hits = (_answerKeyMem[key]?.[1] || []).slice();
    if (verified && replaceVerified) {
      hits = hits.filter((hit) => !hit || typeof hit !== 'object' ||
        hit.verified !== true || normText(hit.answer) === answerNorm);
    }
    const existing = hits.find((hit) => hit && normText(hit.answer) === answerNorm);
    if (existing) {
      if (verified && !existing.verified) existing.verified = true;
    } else {
      const hit = { question: question.trim(), answer, course };
      if (verified) hit.verified = true;
      hits.push(hit);
    }
    await wrongDeleteFuzzy(key, answerNorm);
  } else if (Array.isArray(hits) && verified) {
    hits = hits.map((hit) => (hit && typeof hit === 'object') ? { ...hit, verified: true } : hit);
  }
  key = normText(key);
  if (!key || !Array.isArray(hits) || !hits.length) return;

  // Verified answers are authoritative: purge them out of the wrong cache so a
  // stale "wrong" record can never outvote what Moodle confirmed on review.
  const verifiedNorms = [];
  for (const hit of hits) {
    if (!hit || typeof hit !== 'object' || hit.verified !== true) continue;
    const answerNorm = hitAnswerNorm(hit);
    if (answerNorm && !verifiedNorms.includes(answerNorm)) verifiedNorms.push(answerNorm);
  }
  for (const answerNorm of verifiedNorms) await wrongDeleteFuzzy(key, answerNorm);

  // Purge unverified hits that the wrong cache already knows are incorrect, then
  // force verified hits to index 0 so lookups always see them first.
  const knownWrong = (await getWrongAnswers(key)).map((item) => normText(item)).filter(Boolean);
  if (knownWrong.length) {
    hits = hits.filter((hit) => {
      if (!hit || typeof hit !== 'object' || hit.verified === true) return true;
      const answerNorm = hitAnswerNorm(hit);
      if (!answerNorm) return true;
      return !knownWrong.some((item) => item === answerNorm || similarity(answerNorm, item) >= 0.9);
    });
  }
  hits = rankHits(hits);
  if (!hits.length) {
    // Everything stored for this question was a known-wrong guess: drop the key
    // instead of keeping a poisoned entry around.
    if (_answerKeyMem[key]) {
      delete _answerKeyMem[key];
      markKey('ak', key, true);
      scheduleFlush();
    }
    return;
  }

  _answerKeyMem[key] = [Date.now() / 1000, hits];
  markKey('ak', key);
  evictAnswerKeys();
  scheduleFlush();
}

function evictAnswerKeys() {
  const max = cfg('CACHE_MAX');
  const keys = Object.keys(_answerKeyMem);
  if (keys.length <= max) return;
  keys.sort((a, b) => (_answerKeyMem[a][0] || 0) - (_answerKeyMem[b][0] || 0));
  for (let i = 0; i < keys.length - max; i++) {
    delete _answerKeyMem[keys[i]];
    markKey('ak', keys[i], true);
  }
}

async function saveLocalAnswer(question, answer, course = 'learned-review') {
  const key = normText(question);
  const value = (answer || '').replace(/<[^>]+>/g, '').trim();
  if (!key || !value) return;
  const hits = (await answerKeyGet(key, { includeUnverified: true })) || [];
  const answerNorm = normText(value);
  if (!hits.some((hit) => hit && normText(hit.answer) === answerNorm)) {
    hits.push({
      question: (question || '').trim(),
      answer: value,
      course,
    });
  }
  await answerKeyPut(key, hits);
}

async function answerKeyImport(imported) {
  await ensureLoaded();
  const questions = unwrapBankQuestions(imported);
  if (!questions) {
    throw new Error('Question bank JSON must contain a question map.');
  }
  let added = 0;
  for (const [rawKey, entry] of Object.entries(questions)) {
    if (BANK_META_KEYS.has(rawKey)) continue;
    const key = normText(rawKey);
    const normalized = normalizeAnswerEntry(rawKey, entry);
    if (!key || !normalized) continue;
    const existing = _answerKeyMem[key] || [normalized[0], []];
    const hits = existing[1].slice();
    const seen = new Set(hits.filter((hit) => hit && hit.answer).map((hit) =>
      `${normText(hit.question || rawKey)}|${normText(hit.answer)}`));
    for (const hit of normalized[1]) {
      const signature = `${normText(hit.question || rawKey)}|${normText(hit.answer)}`;
      if (seen.has(signature)) continue;
      seen.add(signature);
      hits.push(hit);
      added++;
    }
    if (hits.length) {
      _answerKeyMem[key] = [Math.max(existing[0] || 0, normalized[0]), hits];
      markKey('ak', key);
    }
  }
  evictAnswerKeys();
  scheduleFlush();
  return { added, questions: Object.keys(_answerKeyMem).length };
}

// Keys a bank file may carry that are not questions themselves. They must never be
// imported as question entries (a bare map without the `questions` wrapper still
// sometimes ships `updatedAt` alongside the questions).
const BANK_META_KEYS = new Set(['questions', 'updatedAt', 'format', 'version', 'exportedAt']);

/**
 * Extract the question map out of a bank payload.
 *
 * GitHub banks are written either as `{ "questions": { ... }, "updatedAt": "..." }`
 * (the wrapper used by the Python harvester and by this extension's exporter) or as
 * a bare `{ question: [timestamp, hits] }` map. Unwrap before iterating over the
 * question keys. Returns null when the payload is not a question map at all.
 */
function unwrapBankQuestions(bankJson) {
  const entriesMap = (bankJson && typeof bankJson.questions === 'object' && !Array.isArray(bankJson.questions))
    ? bankJson.questions
    : bankJson;
  if (!entriesMap || typeof entriesMap !== 'object' || Array.isArray(entriesMap)) return null;
  return entriesMap;
}

/**
 * Merge a GitHub bank payload into chrome.storage.local (the pull direction).
 *
 * Shared by the options page ("Sync Now") and the service worker (push sync), so
 * both accept every bank shape and count new answers identically.
 * Returns { added, questions }: newly stored answers and the resulting total.
 */
async function mergeRemoteBankIntoLocal(bankJson) {
  const entriesMap = unwrapBankQuestions(bankJson);
  if (!entriesMap) return { added: 0, questions: await answerKeyCount() };

  const pullMap = {};
  for (const [rawKey, value] of Object.entries(entriesMap)) {
    if (!rawKey || BANK_META_KEYS.has(rawKey)) continue;
    const normalized = normalizeAnswerEntry(rawKey, value);
    if (!normalized || !normalized[1].length) continue;
    pullMap[rawKey] = normalized;
  }
  const pulled = await answerKeyImport({ questions: pullMap });
  // Persist right away so the service worker and content scripts see the merged
  // answers without waiting for the 500 ms flush debounce.
  try {
    await flushNow();
  } catch (error) {
    // Merged in memory; the scheduled flush retries the storage write.
  }
  return { added: pulled.added, questions: pulled.questions };
}

async function answerKeyDelete(key) {
  await ensureLoaded();
  delete _answerKeyMem[key];
  markKey('ak', key, true);
  scheduleFlush();
}

async function answerKeyDeleteFuzzy(qNorm) {
  await ensureLoaded();
  for (const storedKey of Object.keys(_answerKeyMem)) {
    const ratio = similarity(qNorm, storedKey);
    const fuzzy = ratio >= 0.85 ||
      (storedKey.length >= 20 && (storedKey.includes(qNorm) || qNorm.includes(storedKey)));
    if (storedKey === qNorm || fuzzy) {
      delete _answerKeyMem[storedKey];
      markKey('ak', storedKey, true);
    }
  }
  scheduleFlush();
}

// ── Wrong cache ─────────────────────────────────────────────────────────────
async function wrongGetAll(qNorm) {
  await ensureLoaded();
  const combined = [];
  for (const [storedKey, values] of Object.entries(_wrongMem)) {
    const ratio = similarity(qNorm, storedKey);
    const fuzzy = ratio >= 0.85 ||
      (storedKey.length >= 20 && (storedKey.includes(qNorm) || qNorm.includes(storedKey)));
    if (storedKey === qNorm || fuzzy) {
      for (const v of values) {
        if (typeof v === 'string' && v.trim()) combined.push(v);
      }
    }
  }
  const seen = new Set();
  return combined.filter((v) => {
    const n = normText(v);
    if (!n || seen.has(n)) return false;
    seen.add(n);
    return true;
  });
}

async function wrongSet(key, values) {
  await ensureLoaded();
  if (typeof values === 'string') {
    key = normText(key);
    const answer = normText(values);
    if (!key || !answer) return;
    values = [...(_wrongMem[key] || []), answer];
  } else {
    key = normText(key);
  }
  if (!key) return;
  _wrongMem[key] = [...new Set(values)];
  markKey('wrong', key);
  scheduleFlush();
}

async function getWrongAnswers(question) {
  const key = normText(question);
  return key ? wrongGetAll(key) : [];
}

async function learnWrong(question, answer) {
  const key = normText(question);
  const value = normText(answer);
  if (!key || !value) return;
  await answerKeyDeleteFuzzy(key);
  const previous = await wrongGetAll(key);
  if (!previous.some((item) => normText(item) === value)) {
    previous.push(value);
  }
  await wrongSet(key, previous);
}

async function learnCorrect(question, answer) {
  const key = normText(question);
  const value = (answer || '').replace(/<[^>]+>/g, '').trim();
  if (!key || !value) return;
  await saveLocalAnswer(question, value);
  await wrongDeleteFuzzy(key, normText(value));
}

async function wrongDeleteFuzzy(qNorm, answerNorm) {
  await ensureLoaded();
  for (const storedKey of Object.keys(_wrongMem)) {
    const ratio = similarity(qNorm, storedKey);
    const fuzzy = ratio >= 0.85 ||
      (storedKey.length >= 20 && (storedKey.includes(qNorm) || qNorm.includes(storedKey)));
    if (storedKey === qNorm || fuzzy) {
      const filtered = _wrongMem[storedKey].filter((item) => normText(item) !== answerNorm);
      if (filtered.length === _wrongMem[storedKey].length) continue;
      if (filtered.length) {
        _wrongMem[storedKey] = filtered;
        markKey('wrong', storedKey);
      } else {
        delete _wrongMem[storedKey];
        markKey('wrong', storedKey, true);
      }
    }
  }
  scheduleFlush();
}

async function answerKeyGetAll() {
  await ensureLoaded();
  return { ..._answerKeyMem };
}

async function answerKeyCount() {
  await ensureLoaded();
  return Object.keys(_answerKeyMem).length;
}

async function wrongDeleteKey(key) {
  await ensureLoaded();
  delete _wrongMem[key];
  markKey('wrong', key, true);
  scheduleFlush();
}

async function searchGet(key) {
  await ensureLoaded();
  return _searchMem[key] || null;
}

async function searchPut(key, text) {
  await ensureLoaded();
  _searchMem[key] = text;
  markKey('search', key);
  scheduleFlush();
}

// ── Bundled starter bank (default_bank.json) ───────────────────────────────
//    Imported once per extension version; import is merge-only and idempotent.
async function seedDefaultBank(force = false) {
  const version = chrome.runtime.getManifest().version;
  const flag = await chrome.storage.local.get('default_bank_version');
  if (!force && flag.default_bank_version === version) return null;
  const response = await fetch(chrome.runtime.getURL('default_bank.json'));
  if (!response.ok) throw new Error(`default_bank.json HTTP ${response.status}`);
  const result = await answerKeyImport(await response.json());
  await flushNow();
  await chrome.storage.local.set({ default_bank_version: version });
  return result;
}

// ── Superscript / subscript / Moodle image normalization ────────────────────
//  `cleanDOMToAI` in the reference toolkit turns <sup>/<sub> markup into the
//  real unicode characters so "2<sup>3</sup>" reads exactly like a typed "2³".
//  `unscriptDigits()` then folds both forms back to plain digits for matching,
//  and attempt-specific pluginfile.php URLs collapse into a stable
//  `[moodle-asset:<filename>]` token, so the same item matches across attempts.
const SUP_MAP = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
  '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', 'n': 'ⁿ', 'i': 'ⁱ', 'x': 'ˣ', 'y': 'ʸ', 'm': 'ᵐ',
  'a': 'ᵃ', 'b': 'ᵇ', 'c': 'ᶜ',
};
const SUB_MAP = {
  '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
  '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎', 'a': 'ₐ', 'e': 'ₑ', 'o': 'ₒ', 'x': 'ₓ', 'i': 'ᵢ',
  'j': 'ⱼ', 'n': 'ₙ', 'p': 'ₚ',
};

const UNSCRIPT_DIGITS = {
  '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9',
  '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9',
};

/** Fold unicode superscript/subscript digits (2³, 10₂) back to ASCII digits. */
function unscriptDigits(str) {
  if (!str) return '';
  return String(str).replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹₀₁₂₃₄₅₆₇₈₉]/g, (ch) => UNSCRIPT_DIGITS[ch] || ch);
}

// Moodle rewrites the context/attempt id inside every pluginfile.php URL, so the
// raw src can never match between attempts — the filename is stable. The path
// prefix varies (`/pluginfile.php`, `/2612/pluginfile.php`, ...).
const MOODLE_ASSET_SRC = '(?:https?:\\/\\/[^\\s"\']*?)?\\/pluginfile\\.php\\/\\d+\\/question\\/(?:answer|questiontext|feedback)\\/\\d+(?:\\/\\d+)?\\/([^?#\\s"\']+)';
const MOODLE_ASSET_RE = new RegExp(MOODLE_ASSET_SRC, 'i');
// Full URL form: the `?forcedownload=1` / `#...` tail is attempt noise too.
const MOODLE_ASSET_ANY_RE = new RegExp(MOODLE_ASSET_SRC + '(?:[?#][^\\s"\']*)?', 'gi');

/** Stable `[moodle-asset:<filename>]` token for a Moodle question file URL. */
function moodleAssetToken(src) {
  const text = String(src || '');
  const match = text.match(MOODLE_ASSET_RE);
  if (!match || !match[1]) return '';
  let name = match[1];
  try { name = decodeURIComponent(name); } catch (error) { /* keep the raw name */ }
  return `[moodle-asset:${name}]`;
}

// ── Utility: norm_text port ────────────────────────────────────────────────
function normText(s) {
  s = (s || '').toLowerCase();
  // Attempt-independent image token (URL or already-written token form).
  s = s.replace(MOODLE_ASSET_ANY_RE, ' moodle asset $1 ');
  s = s.replace(/\[\s*moodle\s*-\s*asset\s*:\s*([^\]]+)\]/g, ' moodle asset $1 ');
  // 2³ / 10₂ must fold to 23 / 102 before non-ASCII characters are stripped.
  s = unscriptDigits(s);
  s = s.replace(/^(question\s*)?\d+[.)]\s*/, '');
  s = s.replace(/\bselect one\b|\bchoose\.\.\.|\btrue or false\b/g, '');
  s = s.replace(/[_\-]{2,}/g, ' ');
  s = s.replace(/[^a-z0-9 ]/g, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

// ── Simple string similarity (bigram Dice) ────────────────────────────────
function similarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const bigrams = (s) => {
    const m = new Map();
    for (let i = 0; i < s.length - 1; i++) {
      const bg = s.substring(i, i + 2);
      m.set(bg, (m.get(bg) || 0) + 1);
    }
    return m;
  };
  const m1 = bigrams(a);
  const m2 = bigrams(b);
  let intersection = 0;
  for (const [bg, c1] of m1) {
    const c2 = m2.get(bg) || 0;
    intersection += Math.min(c1, c2);
  }
  const total = [...m1.values()].reduce((s, c) => s + c, 0) +
                [...m2.values()].reduce((s, c) => s + c, 0);
  return total === 0 ? 0 : (2 * intersection) / total;
}

// ── GitHub Contents API helpers ─────────────────────────────────────────────
//  Shared by the service worker (background.js) and the options page
//  (options.js), both of which include this file.
//
//  Three GitHub quirks matter here:
//   1. The metadata endpoint must be requested with the JSON media type
//      (`application/vnd.github+json`); requesting `...raw+json` returns the
//      file body instead of the JSON envelope, so `data.sha` is missing and the
//      subsequent PUT fails with 422 "sha wasn't supplied".
//   2. Base64 payloads carry UTF-8 bytes. `atob()` yields one char per byte, so
//      decoding with TextDecoder (and encoding with TextEncoder) keeps `²`,
//      `₂`, emoji, etc. intact instead of producing mojibake.
//   3. GET /contents only inlines `content` for files up to 1 MB. Above that
//      GitHub answers with `"encoding": "none"` and an empty `content`, so the
//      body has to come from the Git blobs API (up to 100 MB) or `download_url`.

const GITHUB_API_ROOT = 'https://api.github.com';

/** Decode a Base64 payload (Contents API / Git blob API) into a UTF-8 string. */
function decodeBase64Utf8(b64) {
  const bin = atob(String(b64 || '').replace(/\s+/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}

/** Encode a UTF-8 string into Base64 (btoa alone throws on non-Latin1 input). */
function encodeBase64Utf8(str) {
  const bytes = new TextEncoder().encode(str == null ? '' : String(str));
  const CHUNK = 0x8000; // String.fromCharCode.apply() has an argument-count limit
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

// Legacy names kept so older call sites keep working.
function b64ToUtf8(b64) { return decodeBase64Utf8(b64); }
function utf8ToB64(text) { return encodeBase64Utf8(text); }

/** Common GitHub headers: JSON media type plus the token when one is set. */
function gitHubHeaders(token, accept) {
  const headers = { Accept: accept || 'application/vnd.github+json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  return headers;
}

/** Pull the human-readable message out of a failed GitHub response body. */
async function gitHubErrorDetail(resp) {
  try {
    const text = (await resp.text()).trim();
    if (!text) return '';
    try {
      const parsed = JSON.parse(text);
      const message = parsed && (parsed.message || parsed.error);
      return String(message || text.slice(0, 300)).trim();
    } catch (error) {
      return text.slice(0, 300);
    }
  } catch (error) {
    return '';
  }
}

/**
 * Read the raw text behind a Contents API metadata response.
 * Inline Base64 is used when GitHub sends it; files over 1 MB (`encoding:
 * "none"`) are read from the Git blobs API, with `download_url` as a fallback.
 * Every failure reason is collected so the caller can surface it verbatim.
 */
async function gitHubReadFileText(owner, repo, token, meta) {
  if (meta.contentB64) {
    return { text: decodeBase64Utf8(meta.contentB64), source: 'contents' };
  }

  const failures = [];

  if (meta.sha) {
    try {
      const blobUrl = `${GITHUB_API_ROOT}/repos/${owner}/${repo}/git/blobs/${encodeURIComponent(meta.sha)}`;
      const blobResp = await fetch(blobUrl, { headers: gitHubHeaders(token), cache: 'no-store' });
      if (!blobResp.ok) {
        const detail = await gitHubErrorDetail(blobResp);
        failures.push(`Git blob fetch failed: HTTP ${blobResp.status}${detail ? ' — ' + detail : ''}`);
      } else {
        const blob = await blobResp.json();
        if (blob && typeof blob.content === 'string' && blob.content) {
          return blob.encoding === 'base64'
            ? { text: decodeBase64Utf8(blob.content), source: 'blob' }
            : { text: blob.content, source: 'blob' };
        }
        failures.push('Git blob response contained no content');
      }
    } catch (error) {
      failures.push(`Git blob fetch failed: ${error.message}`);
    }
  }

  if (meta.downloadUrl) {
    try {
      // raw.githubusercontent.com serves the file as text; the token is still
      // required for private repositories.
      const rawResp = await fetch(meta.downloadUrl, {
        headers: token ? { Authorization: 'Bearer ' + token } : {},
        cache: 'no-store',
      });
      if (!rawResp.ok) {
        failures.push(`raw download failed: HTTP ${rawResp.status}`);
      } else {
        return { text: await rawResp.text(), source: 'download_url' };
      }
    } catch (error) {
      failures.push(`raw download failed: ${error.message}`);
    }
  }

  throw new Error(failures.join('; ') || `GitHub returned no file content for ${meta.sha || 'this file'}`);
}

/**
 * Read a JSON file from a GitHub repo via the Contents API.
 *
 * Returns { sha, content, missing, parseError, size, source }:
 *  - `content` is the parsed JSON object (null when absent or unparsable)
 *  - `parseError` carries the exact JSON.parse/HTTP/decoding failure, never
 *    masked as "unparsable"
 *  - `missing` is true on 404 and `source` records where the body came from
 *    ('contents' | 'blob' | 'download_url' | 'empty' | 'error' | 'missing')
 *
 * Throws only when the metadata request itself fails (non-404 HTTP error).
 */
async function gitHubGetFile(owner, repo, path, token) {
  const url = `${GITHUB_API_ROOT}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?t=${Date.now()}`;
  const resp = await fetch(url, { headers: gitHubHeaders(token), cache: 'no-store' });
  if (resp.status === 404) {
    return { sha: null, content: null, missing: true, parseError: '', size: 0, source: 'missing' };
  }
  if (!resp.ok) {
    const detail = await gitHubErrorDetail(resp);
    const failure = new Error(`GitHub API error: HTTP ${resp.status}${detail ? ' — ' + detail : ''}`);
    failure.status = resp.status;
    failure.detail = detail;
    throw failure;
  }

  const data = (await resp.json()) || {};
  const meta = {
    sha: data.sha || null,
    size: Number(data.size) || 0,
    encoding: data.encoding || '',
    contentB64: typeof data.content === 'string' ? data.content : '',
    downloadUrl: data.download_url || '',
  };

  let text = '';
  let source = 'empty';
  try {
    const read = await gitHubReadFileText(owner, repo, token, meta);
    text = read.text;
    source = read.source;
  } catch (error) {
    return {
      sha: meta.sha, content: null, missing: false,
      parseError: error.message, size: meta.size, source: 'error',
    };
  }

  if (!text.trim()) {
    return {
      sha: meta.sha, content: null, missing: false,
      parseError: `GitHub returned an empty body (size ${meta.size} bytes, read from ${source})`,
      size: meta.size, source,
    };
  }

  try {
    return {
      sha: meta.sha, content: JSON.parse(text), missing: false,
      parseError: '', size: meta.size, source,
    };
  } catch (error) {
    const preview = text.trim().slice(0, 80).replace(/\s+/g, ' ');
    return {
      sha: meta.sha, content: null, missing: false,
      parseError: `${error.message} (${text.length} chars from ${source}, starts with "${preview}")`,
      size: meta.size, source,
    };
  }
}

/**
 * Create or update a JSON file via the Contents API.
 * Always sends the current `sha` when updating (omit only for a brand-new
 * file). If the server rejects the stale sha with 409/422, re-fetch the latest
 * sha once and retry. Returns { ok, status, message }.
 */
async function gitHubPutJson(owner, repo, path, token, data, message, sha) {
  const headers = gitHubHeaders(token);
  headers['Content-Type'] = 'application/json';
  const url = `${GITHUB_API_ROOT}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`;
  // UTF-8 aware: multi-byte characters (², ₂, emoji) survive the round trip.
  const content = encodeBase64Utf8(JSON.stringify(data, null, 2));

  const doPut = (fileSha) => {
    const payload = { message, content };
    if (fileSha) payload.sha = fileSha; // Omit only when creating a new file.
    return fetch(url, { method: 'PUT', headers, body: JSON.stringify(payload) });
  };

  let resp = await doPut(sha);
  if (resp.status === 409 || resp.status === 422) {
    // Stale sha: re-fetch the latest metadata once and retry the PUT.
    let latestSha = null;
    try {
      latestSha = (await gitHubGetFile(owner, repo, path, token)).sha;
    } catch (e) {
      latestSha = null;
    }
    resp = await doPut(latestSha);
  }

  if (resp.ok) return { ok: true, status: resp.status, message: '' };
  const apiMessage = await gitHubErrorDetail(resp);
  const hint = resp.status === 413 ? ' (file is too large for the Contents API)' : '';
  return { ok: false, status: resp.status, message: `${apiMessage}${hint}`.trim() };
}

function doFlush() {
  _flushTimer = null;
  return mutex(async () => {
    const pending = ['ak', 'wrong', 'search'].some((kind) => _dirty[kind].size || _deleted[kind].size);
    if (!pending) return;
    const stored = await chrome.storage.local.get([
      STORAGE_KEYS.ANSWER_KEY,
      STORAGE_KEYS.WRONG,
      STORAGE_KEYS.SEARCH,
    ]);
    // Synchronous merge section: no await between merge and set().
    _answerKeyMem = overlayPending('ak', validateAnswerKey(stored[STORAGE_KEYS.ANSWER_KEY] || {}), _answerKeyMem);
    _wrongMem = overlayPending('wrong', validateWrong(stored[STORAGE_KEYS.WRONG] || {}), _wrongMem);
    _searchMem = overlayPending('search', validateSearch(stored[STORAGE_KEYS.SEARCH] || {}), _searchMem);
    for (const kind of ['ak', 'wrong', 'search']) {
      _dirty[kind].clear();
      _deleted[kind].clear();
    }
    await chrome.storage.local.set({
      [STORAGE_KEYS.ANSWER_KEY]: _answerKeyMem,
      [STORAGE_KEYS.WRONG]: _wrongMem,
      [STORAGE_KEYS.SEARCH]: _searchMem,
    });
  });
}

;
// PROVIDERS
const BOOL_TRUE = new Set(['true','1','yes','t']);
const BOOL_FALSE = new Set(['false','0','no','f']);
const FIG_HINTS = ['see fig','figure','see the diagram','refer to the image'];
const BLANK_RE = /[_\-]{3,}/;
const MAX_Q_CHARS = 1200; const WEB_Q_CHARS = 380;
const RETRY_VARIANTS = ['','Your earlier answer was wrong. Give a DIFFERENT concept.','Your earlier answers were wrong. Answer with the FULL formal name.','Your earlier answers were wrong. Identify the broader topic.','Your earlier answers were wrong. Answer with the most standard textbook term.'];
const ACRO_RE = /^[A-Z]{2,6}$/;
const STOP_WORDS = new Set(['this','that','these','those','is','are','was','were','the','a','an','also','called','which','what','it','its','of','in','on','for','to','and','or','be','by','with','as','at','from','not','can','does']);
let _orCooldownUntil = 0; let _orWebDisabled = false; let _orDisabled = false;
let _geminiCooldownUntil = 0; let _geminiDisabled = false;
function orCooling(){return !String(cfg('OPENROUTER_API_KEY')||'').trim()||_orDisabled||Date.now()/1000<_orCooldownUntil;}
function orTriggerCooldown(){_orCooldownUntil=Date.now()/1000+(Number(cfg('OPENROUTER_COOLDOWN'))||180);}
function geminiCooling(){return !String(cfg('GEMINI_API_KEY')||'').trim()||_geminiDisabled||Date.now()/1000<_geminiCooldownUntil;}
// `GEMINI_API_KEY` may hold several backup keys (comma/newline separated); the
// background worker rotates to the next ready key whenever one is rate-limited.
function geminiKeyCount(){
  const keys=String(cfg('GEMINI_API_KEY')||'').split(/[\s,;]+/).map((key)=>key.trim()).filter(Boolean);
  return keys.length;
}

// Every transport failure is recorded here (provider + HTTP status + reason) so
// askAiText() can report which provider was tried and why it produced nothing,
// instead of the HUD ending on a bare "No AI answer (check API key/credits...)".
let _lastProviderFailure = null;
function _recordProviderFailure(name,status,reason){
  _lastProviderFailure={name:String(name||''),status:Number(status)||0,reason:String(reason||'').trim()||'unknown error',at:Date.now()};
}
function _providerFailure(name,since){
  const failure=_lastProviderFailure;
  if(!failure||failure.name!==name||failure.at<since)return'';
  return (failure.status?'HTTP '+failure.status+' - ':'')+failure.reason;
}
function _skipReason(disabled,until){
  if(disabled)return'disabled for this session after a key/credits error';
  const left=Math.ceil(until-Date.now()/1000);
  return left>0?'cooling down for '+left+'s after a recent error':'';
}

async function bgFetch(action,payload={},timeout=60000){return new Promise((resolve,reject)=>{const id=Date.now()+'_'+Math.random().toString(36).slice(2,8);let settled=false;const timer=setTimeout(()=>{settled=true;reject(new Error(action+' timed out'));},timeout);chrome.runtime.sendMessage({action,payload,_reqId:id},(response)=>{if(settled)return;settled=true;clearTimeout(timer);if(chrome.runtime.lastError){reject(new Error(chrome.runtime.lastError.message));return;}if(!response){reject(new Error(action+' returned no response'));return;}if(response.error){const error=new Error(response.error);error.status=response.status;error.allKeysLimited=response.allKeysLimited===true;error.keysTried=response.keysTried||0;error.keyCount=response.keyCount||0;reject(error);return;}if(response._reqId!==id){reject(new Error(action+' returned a mismatched response'));return;}resolve(response);});});}

function _warnOpenRouter(message,quiet){console.warn('[OpenRouter] '+message);if(!quiet&&typeof logHUD==='function')logHUD('warn','OpenRouter: '+message);}
async function postOpenRouter(messages,opts={}){
  if(orCooling())return null;
  const model=opts.model||cfg('OPENROUTER_MODEL');
  const maxTokens=opts.maxTokens||64;
  const temperature=opts.temperature??0.1;
  const timeoutSeconds=opts.timeout||25;
  const body={model,messages,temperature,max_tokens:maxTokens};
  if(opts.plugins)body.plugins=opts.plugins;
  if(!String(cfg('OPENROUTER_API_KEY')||'').trim())return null;
  const webPlugin=Boolean(opts.plugins&&opts.plugins.some((plugin)=>plugin.id==='web'));
  for(let attempt=0;attempt<2;attempt++){
    try{
      const response=await bgFetch('postOpenRouter',{body,timeout:timeoutSeconds*1000},(timeoutSeconds+5)*1000);
      if(response.error||[400,401,402,429].includes(response.status)){
        const error=new Error(typeof response.error==='string'?response.error:JSON.stringify(response.error||'OpenRouter request failed'));
        error.status=response.status;
        throw error;
      }
      return response;
    }catch(error){
      const status=error.status||Number((error.message.match(/\bHTTP\s+(\d{3})\b/i)||[])[1])||0;
      const reason=error.message||'Unknown OpenRouter error';
      _recordProviderFailure('OpenRouter',status,reason);
      if(status===401){
        _orDisabled=true;
        _orWebDisabled=true;
        _warnOpenRouter(`Invalid API key (${reason}); OpenRouter disabled for this session.`,opts.quiet);
        return null;
      }
      if(status===402){
        _orDisabled=true;
        _orWebDisabled=true;
        _warnOpenRouter(`Insufficient credits (${reason}); OpenRouter disabled for this session.`,opts.quiet);
        return null;
      }
      if(webPlugin&&status===400){
        _orWebDisabled=true;
        _warnOpenRouter(`web plugin failed (${reason}); disabling it and falling back to standard OpenRouter.`,opts.quiet);
        return null;
      }
      if(status===429){
        if(attempt===0){
          _warnOpenRouter(`Rate limited (${reason}); retrying once in 2.5 seconds.`,opts.quiet);
          await new Promise((resolve)=>setTimeout(resolve,2500));
          continue;
        }
        orTriggerCooldown();
        _warnOpenRouter(`Still rate limited (${reason}); cooling down and falling back to local Ollama.`,opts.quiet);
        return null;
      }
      if(status===503){
        orTriggerCooldown();
        _warnOpenRouter(`Service unavailable (${reason}); cooling down and falling back to local Ollama.`,opts.quiet);
        return null;
      }
      _warnOpenRouter(reason,opts.quiet);
      return null;
    }
  }
  return null;
}
async function postGemini(messages,opts={}){
  if(geminiCooling())return null;
  const contents=[];
  for(const message of messages){
    const parts=[];
    const items=Array.isArray(message.content)?message.content:[{type:'text',text:message.content||''}];
    for(const item of items){
      if(item.type==='image_url'){
        const url=item.image_url&&item.image_url.url||'';
        const image=url.match(/^data:([^;]+);base64,(.+)$/);
        if(image)parts.push({inlineData:{mimeType:image[1],data:image[2]}});
      }else if(item.text)parts.push({text:item.text});
    }
    if(parts.length)contents.push({role:message.role==='assistant'?'model':'user',parts});
  }
  try{
    const timeoutSeconds=opts.timeout||30;
    const response=await bgFetch('postGemini',{
      model:cfg('GEMINI_MODEL'),
      contents,
      generationConfig:{temperature:opts.temperature??0.1,maxOutputTokens:opts.maxTokens||128},
      timeout:timeoutSeconds*1000,
    },(timeoutSeconds+5)*1000);
    return {choices:[{message:{content:response.text||''}}]};
  }catch(error){
    const status=error.status||Number((error.message.match(/\bHTTP\s+(\d{3})\b/i)||[])[1])||0;
    const keyCount=geminiKeyCount();
    if(status===401||status===402)_geminiDisabled=true;
    if(status===429||status===503){
      const base=Number(cfg('GEMINI_KEY_COOLDOWN'))||Number(cfg('OPENROUTER_COOLDOWN'))||180;
      // The worker already rotated through every key: with backups configured,
      // retry soon instead of cooling Gemini down for the whole window.
      _geminiCooldownUntil=Date.now()/1000+(keyCount>1?Math.min(base,30):base);
    }
    const rotated=keyCount>1&&error.allKeysLimited
      ? ' All '+keyCount+' Gemini keys are rate-limited or invalid; rotation resumes automatically.'
      : '';
    const fallback=status===401||status===402
      ? ' Gemini disabled for this session; trying the next fallback.'
      : status===429||status===503
        ? ' Gemini cooling down; trying the next fallback.'
        : '';
    console.warn('[Gemini] '+error.message+fallback+rotated);
    _recordProviderFailure('Gemini',status,error.message);
    if(!opts.quiet&&typeof logHUD==='function')logHUD('warn','Gemini: '+error.message+fallback+rotated);
    return null;
  }
}
async function postOllama(prompt,opts={}){const model=opts.model||cfg('OLLAMA_MODEL');const numPredict=opts.numPredict||120;const temperature=Number(opts.temperature??0.1)||0.1;const rawTimeout = Number(cfg('OLLAMA_TIMEOUT_MS'));const to = rawTimeout < 1000 ? Math.max(rawTimeout * 1000, 30000) : Math.max(rawTimeout, 30000);const numCtx = parseInt(cfg('OLLAMA_NUM_CTX'), 10) || 4096;const images=opts.images||[];const payload={model,prompt,stream:false,keep_alive:cfg('OLLAMA_KEEP_ALIVE'),options:{temperature, num_ctx:numCtx, num_predict:numPredict}};if(images.length)payload.images=images;try{return await bgFetch('postOllama',{payload,timeout:to});}catch(e){console.warn('[Ollama] '+e.message);_recordProviderFailure('Ollama',e.status,e.message);if(!opts.quiet&&typeof logHUD==='function')logHUD('warn','Ollama fallback: '+e.message);return null;}}

let _customCooldownUntil = 0; let _customDisabled = false;
function customCooling(){return !String(cfg('CUSTOM_API_KEY')||'').trim()||_customDisabled||Date.now()/1000<_customCooldownUntil;}
function customTriggerCooldown(){_customCooldownUntil=Date.now()/1000+(Number(cfg('OPENROUTER_COOLDOWN'))||180);}

async function postCustomApi(messages,opts={}){
  if(customCooling())return null;
  const customModel = opts.model || cfg('CUSTOM_MODEL') || 'auto';
  const maxTokens = opts.maxTokens || 64;
  const temperature = opts.temperature ?? 0.1;
  const timeoutSeconds = opts.timeout || 25;
  const baseUrl = cfg('CUSTOM_API_BASE_URL') || 'https://api.freellmapi.com/v1';
  const body = {model: customModel, messages, temperature, max_tokens: maxTokens};
  const isAutoModel = (customModel === 'auto' || !customModel);
  if(!opts.quiet&&typeof logHUD==='function') logHUD('info', 'FreeLLMAPI: querying '+baseUrl+' (model: '+(isAutoModel?'auto':customModel)+')...');
  for(let attempt=0; attempt<2; attempt++){
    try{
      const response = await bgFetch('postCustomApi',{body,timeout:timeoutSeconds*1000},(timeoutSeconds+5)*1000);
      if(response.error || [400,401,402,429].includes(response.status)){
        const status = response.status || 0;
        const errorText = response.error ? (typeof response.error==='string'?response.error:JSON.stringify(response.error)) : 'Custom API request failed';
        const error = new Error(errorText);
        error.status = status;
        error.body = response.body;
        throw error;
      }
      return response;
    }catch(error){
      const status = error.status || Number((error.message.match(/\bHTTP\s+(\d{3})\b/i)||[])[1]) || 0;
      const reason = error.message || 'Unknown Custom API error';
      _recordProviderFailure('FreeLLMAPI',status,reason+(error.body?' | '+error.body:''));
      if(!opts.quiet&&typeof logHUD==='function') logHUD('warn', 'FreeLLMAPI error: HTTP '+status+' - '+reason+(error.body?' | '+error.body:''));
      if(status===401){
        _customDisabled=true;
        console.warn('[CustomAPI] Invalid API key ('+reason+'); Custom API disabled for this session.');
        return null;
      }
      if(status===402){
        _customDisabled=true;
        console.warn('[CustomAPI] Insufficient credits ('+reason+'); Custom API disabled for this session.');
        return null;
      }
      if(status===429){
        if(attempt===0){
          console.warn('[CustomAPI] Rate limited ('+reason+'); retrying once in 2.5 seconds.');
          await new Promise((resolve)=>setTimeout(resolve,2500));
          continue;
        }
        customTriggerCooldown();
        console.warn('[CustomAPI] Still rate limited ('+reason+'); cooling down and falling back.');
        return null;
      }
      if(status===503){
        customTriggerCooldown();
        console.warn('[CustomAPI] Service unavailable ('+reason+'); cooling down and falling back.');
        return null;
      }
      if(isAutoModel && (status===400 || status===404)){
        if(!opts.quiet&&typeof logHUD==='function') logHUD('info', 'FreeLLMAPI: "auto" model failed, will try to resolve model from /models endpoint');
        const resolved = await resolveCustomModel();
        if(resolved){
          body.model = resolved;
          if(!opts.quiet&&typeof logHUD==='function') logHUD('info', 'FreeLLMAPI: resolved model to '+resolved+', retrying...');
          continue;
        }
      }
      console.warn('[CustomAPI] '+reason);
      return null;
    }
  }
  return null;
}

async function resolveCustomModel(){
  const baseUrl = (cfg('CUSTOM_API_BASE_URL') || 'https://api.freellmapi.com/v1').replace(/\/+$/,'');
  const url = baseUrl + '/models';
  const apiKey = cfg('CUSTOM_API_KEY');
  const headers = { 'Content-Type': 'application/json' };
  if(apiKey) headers['Authorization'] = 'Bearer ' + apiKey;
  try{
    const response = await fetch(url, { headers, timeout: 10000 });
    if(!response.ok) return null;
    const data = await response.json();
    const models = data?.data || data?.models || [];
    for(const m of models){
      const id = m.id || m.name || m.model;
      if(id && typeof id === 'string') return id;
    }
    return null;
  }catch(e){
    console.warn('[CustomAPI] Failed to resolve model from /models:', e.message);
    return null;
  }
}

function _excludedNote(list){const arr=[...new Set((list||[]).map((x)=>String(x||'').trim()).filter(Boolean))];return arr.length?'Excluded wrong answers (DO NOT choose these): '+arr.join(', '):'';}
function _optionNorm(text){text=unscriptDigits(String(text||'')).toLowerCase().replace(/[^a-z0-9 ]/g,' ');return text.replace(/\s+/g,' ').trim();}
function _wrongOptionIndices(options,wrongAnswers){const n=new Set((wrongAnswers||[]).map(a=>_optionNorm(a)).filter(Boolean));if(!n.size)return new Set();const idx=[];for(let i=0;i<options.length;i++)if(n.has(_optionNorm(options[i])))idx.push(i);return new Set(idx);}
function _readBool(raw){const text=(raw||'').trim().toLowerCase();if(/\b(true|yes|correct)\b/.test(text))return true;if(/\b(false|no|incorrect)\b/.test(text))return false;return null;}
function _boolIndex(options,wantTrue){const wanted=wantTrue?BOOL_TRUE:BOOL_FALSE;return options.findIndex((option)=>wanted.has((option||'').trim().toLowerCase()));}
function _isBoolQuestion(options){return options.length===2&&options.every((option)=>BOOL_TRUE.has(option.trim().toLowerCase())||BOOL_FALSE.has(option.trim().toLowerCase()));}
function _interpretFilteredAnswer(raw,options,originalIndices){const index=_interpretAnswer(raw,options);if(index!==-1)return index;const match=(raw||'').match(/^\s*(?:option\s*)?(\d{1,2})\s*[.)]?\s*$/i);if(!match)return-1;const originalIndex=parseInt(match[1],10)-1;return originalIndices.indexOf(originalIndex);}
function _interpretMulti(raw,options,excluded){if(!raw)return[];const blocked=new Set(excluded||[]),picked=new Set();for(const match of raw.matchAll(/\b(\d{1,2})\b/g)){const index=parseInt(match[1],10)-1;if(index>=0&&index<options.length&&!blocked.has(index))picked.add(index);}if(!picked.size){for(const match of raw.matchAll(/(?<![A-Za-z])([A-Za-z])(?![A-Za-z])/g)){const index=match[1].toUpperCase().charCodeAt(0)-65;if(index>=0&&index<options.length&&!blocked.has(index))picked.add(index);}}if(!picked.size){const text=raw.toLowerCase();for(let i=0;i<options.length;i++)if(!blocked.has(i)&&options[i]&&text.includes(options[i].toLowerCase()))picked.add(i);}return[...picked].sort((a,b)=>a-b);}
function _domainNote(question){const text=(question||'').toLowerCase();if(/\b(computer|network|software|database|program|technical|server|internet|protocol)\b/.test(text))return'This is a technical/IT item — use precise technical terminology.';if(/\b(history|society|culture|politic|economic|philosoph|psycholog|sociolog|humanit)\b/.test(text))return'This is a social/humanities item — use the standard scholarly term.';return'Use the standard textbook term or phrase.';}
function _cleanTyped(raw,blank){let text=(raw||'').trim().replace(/^```[a-zA-Z]*\s*|\s*```$/g,'').trim().split('\n')[0]||'';text=text.replace(/^(answer|ans|correct answer)\s*[:-]\s*/i,'').replace(/^[*\-\u2022]\s+/,'').replace(/^\d+[.)]\s+/,'').trim().replace(/^["'`*]+|["'`*]+$/g,'').replace(/\s+/g,' ');if(blank){text=text.replace(/\s\([^)]*\)\s*$/,'').trim();if(text.length>40)text=text.replace(/\s*[-–—/]\s*.*$/,'').trim();}if(text.length>160)text=text.split(/(?<=[.!?])\s/)[0]||text.slice(0,160);text=text.replace(/[.]$/,'').trim();return /^(none|unknown|n\/a)$/i.test(text)?'':text;}
function _echoesQuestion(answer,question){const text=(answer||'').trim();if(!/^[A-Z]{2,6}$/.test(text))return false;const initials=(question||'').match(/[A-Za-z]+/g)||[];return initials.map((word)=>word[0].toUpperCase()).join('').includes(text);}
function _searchQuery(question){const text=(question||'').replace(/[_-]{2,}/g,' ').replace(/\b(select one|select one or more|choose\.{0,3}|true or false|answer\s*\d+\s*[.)]?\s*question\s*\d+)\b/gi,' ');const words=(text.match(/[A-Za-z0-9-]+/g)||[]).filter((word)=>!STOP_WORDS.has(word.toLowerCase()));return words.slice(0,14).join(' ').slice(0,120)||text.replace(/\s+/g,' ').trim().slice(0,120);}
async function ollamaWebSearch(query){const clean=_searchQuery(query);if(!clean)return'';const key=normText(clean);const cached=await searchGet(key);if(cached)return cached;const result=await bgFetch('searchWeb',{query:clean,maxResults:cfg('WEB_SEARCH_MAX_RESULTS')});const text=result.text||'';if(text)await searchPut(key,text);return text;}
// Fast DuckDuckGo snippet fallback for short answers that exist in neither the
// local bank nor amauoed.com. The request runs in the background worker (CORS +
// host_permissions) with a hard 4 s cap there and a 5 s guard here, so it can
// never hang or fail askAiText(): any error/timeout just yields '' and the AI
// stage runs exactly as it did before. Results are cached in the same
// persistent search cache ollamaWebSearch() uses — prefixed key, so the two
// never collide — meaning a repeated question costs no network at all.
function _snippetKey(question){return 'snip:'+normText(question).slice(0,180);}
async function webSnippetLookup(question){
  const term=(question||'').replace(/\s+/g,' ').trim();
  if(term.length<12)return'';
  const key=_snippetKey(term);
  try{
    const cached=await searchGet(key);
    if(cached)return cached;
  }catch(error){/* a cache miss must never matter */}
  const query=term.slice(0,WEB_Q_CHARS)+' studocu OR amauoed OR quizlet';
  try{
    const result=await bgFetch('SEARCH_WEB_SNIPPETS',{query,maxResults:3},5000);
    const snippets=String((result&&result.text)||'').trim().slice(0,1500);
    if(snippets){try{await searchPut(key,snippets);}catch(error){/* caching is optional */}}
    return snippets;
  }catch(error){
    console.warn('[providers] Web snippet lookup failed:',error.message);
    return'';
  }
}


function _normalizeBankHits(value,question){
  if(value===null||value===undefined)return[];
  let rawHits=value;
  if(Array.isArray(value)&&value.length===2&&typeof value[0]==='number'&&Array.isArray(value[1]))rawHits=value[1];
  else if(!Array.isArray(value))rawHits=[value];
  const hits=[];
  for(const rawHit of rawHits){
    const hit=typeof rawHit==='string'?{answer:rawHit}:rawHit;
    if(!hit||typeof hit.answer!=='string'||!hit.answer.trim())continue;
    const normalized={question:typeof hit.question==='string'&&hit.question.trim()?hit.question:question,answer:hit.answer,course:hit.course||'imported',verified:hit.verified===true};
    if(hit.wrong===true)normalized.wrong=true;
    hits.push(normalized);
  }
  return hits;
}
// A stored hit is a "wrong hit" when it is flagged wrong or its text matches the
// wrong-answer cache for the same question (exact or ≥0.9 similar).
function _hitIsWrong(answer,wrong){const value=normText(answer);if(!value)return false;for(const item of wrong||[])if(value===item||similarity(value,item)>=0.9)return true;return false;}
// Verified answers are always offered before unverified ones (stable order).
function _rankBankHits(hits){const verified=[],rest=[];for(const hit of hits||[])(hit&&hit.verified===true?verified:rest).push(hit);return verified.concat(rest);}
async function localBankAnswerHits(question){
  const key=normText(question);
  if(!key)return null;
  const wrong=(await getWrongAnswers(question)).map((item)=>normText(item)).filter(Boolean);
  const clean=(hits)=>{
    const kept=(hits||[]).filter((hit)=>hit&&typeof hit.answer==='string'&&hit.answer.trim()&&hit.wrong!==true&&(hit.verified===true||!_hitIsWrong(hit.answer,wrong)));
    return _rankBankHits(kept);
  };
  const direct=await answerKeyGet(key);
  const directHits=clean(_normalizeBankHits(direct,question));
  if(directHits.length)return directHits;
  const all=await answerKeyGetAll();
  let bestHits=null,bestScore=0;
  for(const [storedKey,value] of Object.entries(all)){
    const score=similarity(key,normText(storedKey));
    if(score<0.80||score<=bestScore)continue;
    const hits=clean(_normalizeBankHits(value,storedKey));
    if(!hits.length)continue;
    bestHits=hits;
    bestScore=score;
  }
  if(bestHits)return bestHits;
  return direct!==null?[]:null;
}
async function localBankOptionMatches(question,options){
  const hits=await localBankAnswerHits(question);
  if(!hits||!options||!options.length)return[];
  const matches=[];
  const used=new Set();
  for(const hit of hits){
    const answer=normText(hit.answer);
    let bestIndex=-1,bestScore=0;
    for(let i=0;i<options.length;i++){
      if(used.has(i))continue;
      const option=normText(options[i]);
      const score=answer&&option?similarity(answer,option):0;
      if(score>bestScore){bestScore=score;bestIndex=i;}
    }
    if(bestIndex!==-1&&bestScore>=0.75){
      used.add(bestIndex);
      matches.push({index:bestIndex,option:options[bestIndex],answer:hit.answer,verified:hit.verified===true,wrong:hit.wrong===true});
    }
  }
  return _rankBankHits(matches);
}
async function _keyHits(question,options){
  const key=normText(question);
  if(!key)return[];
  const local=await localBankAnswerHits(question);
  if(local!==null)return local;
  if(key.length<8||FIG_HINTS.some((hint)=>(question||'').toLowerCase().includes(hint)))return[];
  try{
    const result=await bgFetch('getAnswerKey',{question:(question||'').slice(0,300),options:options||[]},(cfg('ANSWER_KEY_TIMEOUT')||4)*1000+5000);
    const hits=result.hits||[];
    await answerKeyPut(key,hits);
    return hits;
  }catch(error){
    console.warn('[providers] Answer-key lookup failed:',error.message);
    if(typeof logHUD==='function')logHUD('warn','Answer-key lookup failed: '+error.message);
    return[];
  }
}
function _answerOptionScore(answer,options){const value=normText(answer);let score=0;for(const option of options||[]){const candidate=normText(option);if(candidate&&(value===candidate))score=Math.max(score,1);else if(candidate&&(value.includes(candidate)||candidate.includes(value)))score=Math.max(score,0.85);}return score;}
function _bestKeyHit(question,hits,minScore,options){
  const query=normText(question);
  let best=null,bestQuestionScore=0,bestRank=-1,bestVerified=false;
  for(const hit of hits||[]){
    const questionScore=similarity(query,normText(hit.question));
    const optionScore=Math.max(hit.optionScore||0,_answerOptionScore(hit.answer,options));
    const qualifies=questionScore>=minScore||(options&&optionScore>=0.95&&questionScore>=minScore*0.65);
    if(!qualifies)continue;
    const rank=questionScore+optionScore*0.15;
    const verified=hit.verified===true;
    // verified: true always outranks an unverified hit; ties use the closest match.
    const better=verified===bestVerified?rank>bestRank:verified;
    if(better){best=hit;bestQuestionScore=questionScore;bestRank=rank;bestVerified=verified;}
  }
  return best&&bestQuestionScore>=minScore?best:best&&options&&_answerOptionScore(best.answer,options)>=0.95?best:null;
}
function _pickKeyAnswer(answer,options){const value=normText(answer);if(!value)return-1;if(BOOL_TRUE.has(value)||BOOL_FALSE.has(value)){const index=_boolIndex(options,BOOL_TRUE.has(value));if(index!==-1)return index;}let best=-1,score=0;for(let i=0;i<options.length;i++){const candidate=similarity(value,normText(options[i]));if(candidate>score){best=i;score=candidate;}}return score>=0.6?best:-1;}
async function keyIndex(question,options,minScore){const hits=(await _keyHits(question,options)).filter((hit)=>hit&&hit.verified===true);const hit=_bestKeyHit(question,hits,minScore===undefined?cfg('ANSWER_KEY_MIN_SCORE'):minScore,options);if(!hit)return-1;const answer=normText(hit.answer);const wrong=await getWrongAnswers(question);if(wrong.some((item)=>answer===normText(item)||similarity(answer,normText(item))>=0.9))return-1;return _pickKeyAnswer(hit.answer,options);}
async function keyAnswer(question){const hits=(await _keyHits(question)).filter((hit)=>hit&&hit.verified===true);const hit=_bestKeyHit(question,hits,cfg('ANSWER_KEY_TEXT_MIN_SCORE'));if(!hit)return'';const answer=_cleanTyped(hit.answer);const wrong=await getWrongAnswers(question);return wrong.some((item)=>normText(item)===normText(answer)||similarity(normText(item),normText(answer))>=0.9)?'':answer;}
async function keyMatchAnswer(question){const hits=(await _keyHits(question)).filter((hit)=>hit&&hit.verified===true);const hit=_bestKeyHit(question,hits,cfg('ANSWER_KEY_MATCH_MIN_SCORE'));return hit?_cleanTyped(hit.answer):'';}
async function hintText(question){const hits=await _keyHits(question);if(!_bestKeyHit(question,hits,0.35))return'';const lines=hits.slice(0,3).map((hit)=>'- '+(hit.question||'').slice(0,200)+'\n  KEY: '+(hit.answer||''));return'REFERENCE KEYS from amauoed.com (user-submitted, may be wrong — prefer them only if they fit the question):\n'+lines.join('\n');}
function _interpretAnswer(raw,options,excluded){if(!raw)return-1;const t=raw.trim(),n=options.length,e=new Set(excluded||[]),el=[];for(let i=0;i<n;i++)if(!e.has(i))el.push(i);const ue=el.length?el:[...Array(n).keys()];const m=t.match(/\b(\d{1,2})\b/);if(m){const i=parseInt(m[1],10)-1;if(i>=0&&i<n&&ue.includes(i))return i;}let lm=t.match(/^\s*[\(\[\{]?\s*([A-Za-z])\s*[\)\]\.:\-]/);if(!lm)lm=t.match(/^\s*([A-Za-z])\s*$/);if(lm){const i=lm[1].toUpperCase().charCodeAt(0)-65;if(i>=0&&i<n&&ue.includes(i))return i;}const lw=t.toLowerCase();let b=-1,s=0;for(let i=0;i<n;i++){if(e.has(i))continue;const o=options[i].toLowerCase().trim();if(!o)continue;if(o===lw)return i;let sc=similarity(lw,o);if(o.includes(lw)||lw.includes(o))sc=Math.max(sc,0.85);if(sc>s){b=i;s=sc;}}return s>=0.6?b:-1;}async function askBoolClaim(q,o,ex){const p='Decide whether the statement below is TRUE or FALSE.\nJudge it on the standard definition.\n\nStatement: '+q+'\n\nReply with ONLY TRUE or FALSE.';if(cfg('OPENROUTER_API_KEY')&&!orCooling()){const r=await postOpenRouter([{role:'user',content:p}],{maxTokens:64,temperature:0.1,timeout:25});if(r){const m=r.choices?.[0]?.message||{};const ra=((m.content||m.reasoning||'')).trim();const v=_readBool(ra);if(v!==null){const i=_boolIndex(o,v);const ee=new Set(ex||[]);if(i!==-1&&(ee.size>=o.length||!ee.has(i)))return i;}}}try{const r=await postOllama(p,{numPredict:16,temperature:0.1,timeout:30});if(r&&r.response){const v=_readBool(r.response.trim());if(v!==null){const i=_boolIndex(o,v);const ee=new Set(ex||[]);if(i!==-1&&(ee.size>=o.length||!ee.has(i)))return i;}}}catch(e){}return-1;}
async function _askGeminiPrompt(prompt,opts={}){const response=await postGemini([{role:'user',content:prompt}],opts);return response&&response.choices?.[0]?.message?.content||'';}
async function askGemini(q,o,ex,oi){if(!cfg('GEMINI_API_KEY'))return-1;const options=o.map((option,i)=>`${i+1}. ${option}`).join('\n');const prompt='You are an expert tutor answering an exam question. Select the BEST answer.\n\nQuestion: '+q+'\n\nOptions:\n'+options+'\n\nReply with ONLY the number.';const raw=await _askGeminiPrompt(prompt,{maxTokens:64,temperature:0.2,timeout:30});return oi?_interpretFilteredAnswer(raw,o,oi):_interpretAnswer(raw,o,ex);}
async function askGeminiVision(q,o,images){if(!cfg('GEMINI_API_KEY')||!images.length)return-1;const content=[{type:'text',text:_visionPrompt(q,o)},...images.map((image)=>({type:'image_url',image_url:{url:'data:image/png;base64,'+image}}))];const response=await postGemini([{role:'user',content}],{maxTokens:64,temperature:0.1,timeout:45});const raw=response?.choices?.[0]?.message?.content||'';return _interpretAnswer(raw,o,_wrongOptionIndices(o,await getWrongAnswers(q)));}
async function askGeminiMulti(q,o,excluded,note){if(!cfg('GEMINI_API_KEY'))return[];const forbidden=(excluded||[]).map((index)=>o[index]).filter(Boolean);const raw=await _askGeminiPrompt(_multiPrompt(q,o,note,forbidden),{maxTokens:64,temperature:0.2,timeout:30});return _interpretMulti(raw,o,excluded);}
async function askGeminiText(q,blank,forbidden,temperature,variant,note,force,courseContext){if(!cfg('GEMINI_API_KEY'))return'';const raw=await _askGeminiPrompt(_textPrompt(q,forbidden,variant,note,force,courseContext),{maxTokens:80,temperature:temperature??0.1,timeout:30,quiet:true});return _cleanTyped(raw,blank);}
async function askBoolClaim(q,o,ex){const p='Decide whether the statement below is TRUE or FALSE.\nJudge it on the standard definition.\n\nStatement: '+q+'\n\nReply with ONLY TRUE or FALSE.';if(cfg('GEMINI_API_KEY')){const raw=await _askGeminiPrompt(p,{maxTokens:32,temperature:0.1,timeout:30});const verdict=_readBool(raw);if(verdict!==null){const index=_boolIndex(o,verdict);const excluded=new Set(ex||[]);if(index!==-1&&(excluded.size>=o.length||!excluded.has(index)))return index;}}if(cfg('OPENROUTER_API_KEY')&&!orCooling()){const r=await postOpenRouter([{role:'user',content:p}],{maxTokens:64,temperature:0.1,timeout:25});if(r){const m=r.choices?.[0]?.message||{};const ra=((m.content||m.reasoning||'')).trim();const v=_readBool(ra);if(v!==null){const i=_boolIndex(o,v);const ee=new Set(ex||[]);if(i!==-1&&(ee.size>=o.length||!ee.has(i)))return i;}}}try{const r=await postOllama(p,{numPredict:16,temperature:0.1,timeout:30});if(r&&r.response){const v=_readBool(r.response.trim());if(v!==null){const i=_boolIndex(o,v);const ee=new Set(ex||[]);if(i!==-1&&(ee.size>=o.length||!ee.has(i)))return i;}}}catch(e){}return-1;}
async function askOpenRouter(q,o,ex,oi){if(!cfg('OPENROUTER_API_KEY')||orCooling())return-1;const ot=o.map((x,i)=>`${i+1}. ${x}`).join('\n');const p='You are an expert tutor answering an exam question. Select the BEST answer.\n\nQuestion: '+q+'\n\nOptions:\n'+ot+'\n\nReply with ONLY the number.';try{const r=await postOpenRouter([{role:'user',content:p}],{maxTokens:64,temperature:0.3,timeout:25});if(!r)return-1;const m=r.choices?.[0]?.message||{};const t=((m.content||m.reasoning||'')).trim();const idx=oi?_interpretFilteredAnswer(t,o,oi):_interpretAnswer(t,o,ex);if(idx!==-1)return idx;return-1;}catch(e){return-1;}}
async function askOpenRouterWeb(q,o,oi){if(!cfg('OPENROUTER_API_KEY')||_orWebDisabled||orCooling())return-1;const options=o.map((option,index)=>`${index+1}. ${option}`).join('\n');const prompt='Use web search results to answer this exam question.\n\nQuestion: '+q.slice(0,WEB_Q_CHARS)+'\n\nOptions:\n'+options+'\n\nReply with ONLY the option number.';const response=await postOpenRouter([{role:'user',content:prompt}],{plugins:[{id:'web',engine:'exa',max_results:cfg('WEB_SEARCH_MAX_RESULTS'),search_prompt:'Exact question and answer.'}],maxTokens:100,temperature:0.1,timeout:45});if(!response)return-1;const message=response.choices?.[0]?.message||{};const first=((message.content||message.reasoning||'').trim().split('\n')[0]||'');return oi?_interpretFilteredAnswer(first,o,oi):_interpretAnswer(first,o);}
async function askOllama(q,o,ex,oi){const ot=o.map((x,i)=>`${i+1}. ${x}`).join('\n');const p='You are an expert tutor answering an exam question accurately.\n\nQuestion: '+q+'\n\nOptions:\n'+ot+'\n\nReply with ONLY the number.';try{const r=await postOllama(p,{numPredict:32,temperature:0.1,timeout:60});if(r&&r.response){const t=r.response.trim();const idx=oi?_interpretFilteredAnswer(t,o,oi):_interpretAnswer(t,o,ex);if(idx!==-1)return idx;}return-1;}catch(e){return-1;}}
async function askCustomApi(q,o,ex,oi){if(!cfg('CUSTOM_API_KEY')||customCooling())return-1;const ot=o.map((x,i)=>`${i+1}. ${x}`).join('\n');const p='You are an expert tutor answering an exam question. Select the BEST answer.\n\nQuestion: '+q+'\n\nOptions:\n'+ot+'\n\nReply with ONLY the number.';try{const r=await postCustomApi([{role:'user',content:p}],{maxTokens:64,temperature:0.1,timeout:25});if(!r)return-1;const m=r.choices?.[0]?.message||{};const t=((m.content||m.reasoning||'')).trim();const idx=oi?_interpretFilteredAnswer(t,o,oi):_interpretAnswer(t,o,ex);if(idx!==-1)return idx;return-1;}catch(e){return-1;}}
function _visionPrompt(q,o){const ot=o.map((x,i)=>`${i+1}. ${x}`).join('\n');return'You are an expert tutor. The question refers to image(s).\n\nQuestion: '+q+'\n\nOptions:\n'+ot+'\n\nReply with ONLY the number.';}
async function askOpenRouterVision(q,o,im){if(!(cfg('OPENROUTER_API_KEY')&&im.length)||orCooling())return-1;const m=cfg('OPENROUTER_VISION_MODEL').trim()||cfg('OPENROUTER_MODEL');const c=[{type:'text',text:_visionPrompt(q,o)}];for(const b64 of im)c.push({type:'image_url',image_url:{url:'data:image/png;base64,'+b64}});try{const r=await postOpenRouter([{role:'user',content:c}],{model:m,maxTokens:64,temperature:0.1,timeout:45});if(!r)return-1;const msg=r.choices?.[0]?.message||{};const raw=((msg.content||msg.reasoning||'')).trim();const w=await getWrongAnswers(q);const ex=_wrongOptionIndices(o,w);return _interpretAnswer(raw,o,ex);}catch(e){return-1;}}



async function askOllamaVision(q,o,im){if(!im.length)return -1;try{const r=await postOllama(_visionPrompt(q,o),{model:cfg('OLLAMA_VISION_MODEL')||cfg('OLLAMA_MODEL'),numPredict:40,temperature:0.1,images:im,timeout:45});if(r&&r.response){const raw=r.response.trim();const w=await getWrongAnswers(q);const ex=_wrongOptionIndices(o,w);return _interpretAnswer(raw,o,ex);}return -1;}catch(e){return -1;}}
async function askVision(q,o,im){if(!(cfg('VISION_ENABLED')&&im.length))return -1;console.log('Vision');if(cfg('GEMINI_API_KEY')){const i=await askGeminiVision(q,o,im);if(i!==-1)return i;}if(cfg('OPENROUTER_API_KEY')&&!orCooling()){const i=await askOpenRouterVision(q,o,im);if(i!==-1)return i;}const i=await askOllamaVision(q,o,im);if(i!==-1)return i;return -1;}
function _multiPrompt(q,o,n,f){const ot=o.map((x,i)=>(i+1)+'. '+x).join('\n');let p='';if(f&&f.length)p+='Do NOT pick these, already wrong: '+[...f].sort().join(', ')+'\n\n';if(n)p+=n+'\n\n';return p+'You are an expert tutor answering a multiple-answer question. MORE THAN ONE is correct.\n\nQuestion: '+q+'\n\nOptions:\n'+ot+'\n\nReply with ONLY numbers separated by commas.';}
function _parsePartialMultiSelectCombo(value){
  const marker=normText(value);
  const prefix='multiselect partial combo ';
  if(!marker.startsWith(prefix))return null;
  let rest=marker.slice(prefix.length),choices=[];
  while(rest){
    const lengthMatch=rest.match(/^(\d+)\s/);
    if(!lengthMatch)return null;
    const length=Number(lengthMatch[1]),start=lengthMatch[0].length;
    if(!Number.isSafeInteger(length)||length<1||start+length>rest.length)return null;
    choices.push(rest.slice(start,start+length));
    rest=rest.slice(start+length).trim();
  }
  return choices.sort();
}
function _parseMultiSelectResponse(raw,options,wrongOptions,partialCombos){
  const text=String(raw||'');
  const start=text.indexOf('['),end=text.lastIndexOf(']');
  if(start<0||end<start)return[];
  let parsed;
  try{parsed=JSON.parse(text.slice(start,end+1));}catch(error){return[];}
  if(!Array.isArray(parsed))return[];
  const wrong=(wrongOptions||[]).map((value)=>normText(value)).filter(Boolean);
  const indexes=[];
  for(const value of parsed){
    if(typeof value!=='string')continue;
    const answer=normText(value);
    if(!answer||wrong.some((item)=>item===answer||similarity(item,answer)>=0.9))continue;
    const index=options.findIndex((option)=>normText(option)===answer);
    if(index!==-1&&!indexes.includes(index))indexes.push(index);
  }
  const selection=indexes.map((index)=>normText(options[index])).sort();
  if((partialCombos||[]).some((combo)=>combo.length===selection.length&&combo.every((choice,index)=>choice===selection[index])))return[];
  return indexes;
}
async function askAiMultiSelect(question,options){
  const wrong=await getWrongAnswers(question);
  const partial=wrong.map(_parsePartialMultiSelectCombo).filter(Boolean);
  const wrongOptions=wrong.filter((value)=>!normText(value).startsWith('multiselect partial '));
  const prompt="This is a multiple-answer checkbox question ('Select one or more'). Carefully evaluate EVERY option and return ONLY a JSON array containing ALL correct option strings verbatim (typically 2 to 4 options).\n\nQuestion: "+question+"\n\nOptions:\n"+options.map((option)=>'- '+option).join('\n');
  const context=[];
  if(partial.length)context.push('Previously recorded partial selections (do not repeat an exact combination): '+partial.map((combo)=>'['+combo.join(', ')+']').join('; ')+'.');
  if(wrongOptions.length)context.push('Options already confirmed wrong: '+wrongOptions.join(', ')+'.');
  const requestPrompt=context.length?prompt+'\n\n'+context.join('\n'):prompt;
  const parse=(raw)=>_parseMultiSelectResponse(raw,options,wrongOptions,partial);
  if(cfg('CUSTOM_API_KEY')&&!customCooling()){
    try{
      const response=await postCustomApi([{role:'user',content:requestPrompt}],{maxTokens:220,temperature:0.1,timeout:30});
      const raw=response&&response.choices&&response.choices[0]&&response.choices[0].message
        ?response.choices[0].message.content||response.choices[0].message.reasoning||'':'';
      const picks=parse(raw);if(picks.length)return picks;
    }catch(error){_recordProviderFailure('FreeLLMAPI',error.status,error.message);}
  }
  if(cfg('GEMINI_API_KEY')){
    try{const picks=parse(await _askGeminiPrompt(requestPrompt,{maxTokens:220,temperature:0.1,timeout:30}));if(picks.length)return picks;}
    catch(error){_recordProviderFailure('Gemini',error.status,error.message);}
  }
  if(cfg('OPENROUTER_API_KEY')&&!orCooling()){
    try{
      const response=await postOpenRouter([{role:'user',content:requestPrompt}],{maxTokens:220,temperature:0.1,timeout:30});
      const message=response&&response.choices&&response.choices[0]&&response.choices[0].message||{};
      const picks=parse(message.content||message.reasoning||'');if(picks.length)return picks;
    }catch(error){_recordProviderFailure('OpenRouter',error.status,error.message);}
  }
  try{
    const response=await postOllama(requestPrompt,{numPredict:220,temperature:0.1,timeout:45});
    const picks=parse(response&&response.response||'');if(picks.length)return picks;
  }catch(error){_recordProviderFailure('Ollama',error.status,error.message);}
  return[];
}
async function askOpenRouterMulti(q,o,ex,n){if(!cfg('OPENROUTER_API_KEY')||orCooling())return[];const f=(ex||[]).map(i=>o[i]).filter(Boolean);try{const r=await postOpenRouter([{role:'user',content:_multiPrompt(q,o,n,f)}],{maxTokens:64,temperature:0.2,timeout:25});if(!r)return[];const m=r.choices?.[0]?.message||{};const ra=((m.content||m.reasoning||'')).trim();let p=_interpretMulti(ra,o,ex);if(!p.length)p=_interpretMulti(ra,o);return p;}catch(e){return[];}}
async function askOpenRouterWebMulti(q,o,ex){if(!cfg('OPENROUTER_API_KEY')||_orWebDisabled||orCooling())return[];const excluded=(ex||[]).map((index)=>o[index]).filter(Boolean);const prompt=_multiPrompt(q,o,'Use web search results to select the correct options.',excluded);const response=await postOpenRouter([{role:'user',content:prompt}],{plugins:[{id:'web',engine:'exa',max_results:cfg('WEB_SEARCH_MAX_RESULTS'),search_prompt:'Exact question and answers.'}],maxTokens:100,temperature:0.1,timeout:45});if(!response)return[];const message=response.choices?.[0]?.message||{};const first=((message.content||message.reasoning||'').trim().split('\n')[0]||'');return _interpretMulti(first,o,ex);}
async function askOllamaMulti(q,o,ex,n){const f=(ex||[]).map(i=>o[i]).filter(Boolean);try{const r=await postOllama(_multiPrompt(q,o,n,f),{numPredict:48,temperature:0.1,timeout:45});if(r&&r.response){const ra=r.response.trim();let p=_interpretMulti(ra,o,ex);if(!p.length)p=_interpretMulti(ra,o);return p;}return[];}catch(e){return[];}}
async function askCustomApiMulti(q,o,ex,n){if(!cfg('CUSTOM_API_KEY')||customCooling())return[];const f=(ex||[]).map(i=>o[i]).filter(Boolean);try{const r=await postCustomApi([{role:'user',content:_multiPrompt(q,o,n,f)}],{maxTokens:64,temperature:0.2,timeout:25});if(!r)return[];const m=r.choices?.[0]?.message||{};const ra=((m.content||m.reasoning||'')).trim();let p=_interpretMulti(ra,o,ex);if(!p.length)p=_interpretMulti(ra,o);return p;}catch(e){return[];}}
async function askWebMulti(q,o,ex){
  if(!cfg('WEB_SEARCH_ENABLED'))return[];
  try{
    const searchResults=await ollamaWebSearch(_searchQuery(q));
    if(!searchResults)return[];
    const text=' '+_optionNorm(searchResults)+' ';
    return o.map((option,index)=>({option,index})).filter(({option})=>{
      const normalized=_optionNorm(option);
      return normalized.length>=3&&text.includes(' '+normalized+' ');
    }).map(({index})=>index).filter((index)=>!(ex||[]).includes(index));
  }catch(error){console.warn('[providers] Non-AI multi-answer search failed:',error.message);return[];}
}
async function askAiMulti(q,o,im){im=im||[];const w=await getWrongAnswers(q);const b=new Set(w.map(x=>normText(x)));const isWrong=(option)=>{const on=normText(option);if(!on)return false;if(b.has(on))return true;for(const x of b)if(similarity(on,x)>=0.9)return true;return false;};const local=await localBankOptionMatches(q,o);const localOk=local.filter((match)=>match.verified===true&&!isWrong(o[match.index]));if(localOk.length)return localOk.map((match)=>match.index);const vp=[];for(let i=0;i<o.length;i++){const on=normText(o[i]);if(!(b.has(on)||[...b].some(x=>similarity(on,x)>=0.9)))vp.push(i);}if(!vp.length)for(let i=0;i<o.length;i++)vp.push(i);const fo=vp.map(i=>o[i]);const kp=[];if(cfg('ANSWER_KEY_ENABLED')){const ki=await keyIndex(q,fo,0.72);if(ki!==-1)kp.push(ki);const e=await keyAnswer(q);if(e){for(const i of _interpretMulti(e,fo))if(!kp.includes(i))kp.push(i);}}if(cfg('WEB_SEARCH_ENABLED')){const wp=await askWebMulti(q,fo);if(wp.length)return wp.map(p=>vp[p]).filter(p=>p<vp.length);}let nt='';if(kp.length)nt='Key suggests '+kp.map(p=>String(p+1)).join(', ')+'.';const exNote=_excludedNote(w);if(exNote)nt=(nt?nt+' ':'')+exNote;if(cfg('CUSTOM_API_KEY')&&!customCooling()){const picks=await askCustomApiMulti(q,fo,null,nt);if(picks.length)return picks.map(p=>vp[p]).filter(p=>p<vp.length);}if(cfg('GEMINI_API_KEY')){const picks=await askGeminiMulti(q,fo,null,nt);if(picks.length)return picks.map(p=>vp[p]).filter(p=>p<vp.length);}if(cfg('OPENROUTER_API_KEY')&&!_orWebDisabled&&!orCooling()){const webPicks=await askOpenRouterWebMulti(q,fo);if(webPicks.length)return webPicks.map(p=>vp[p]).filter(p=>p<vp.length);}if(cfg('OPENROUTER_API_KEY')&&!orCooling()){const pk=await askOpenRouterMulti(q,fo,null,nt);if(pk.length)return pk.map(p=>vp[p]).filter(p=>p<vp.length);}try{const pk=await askOllamaMulti(q,fo,null,nt);if(pk.length)return pk.map(p=>vp[p]).filter(p=>p<vp.length);}catch(e){}if(kp.length)return kp.map(p=>vp[p]).filter(p=>p<vp.length);return[];}
async function askWeb(q,o,oi){
  if(!cfg('WEB_SEARCH_ENABLED'))return-1;
  try{
    const searchResults=await ollamaWebSearch(_searchQuery((q||'').slice(0,WEB_Q_CHARS)));
    if(!searchResults)return-1;
    const text=' '+_optionNorm(searchResults)+' ';
    const matches=o.map((option,index)=>({option,index})).filter(({option})=>{
      const normalized=_optionNorm(option);
      return normalized.length>=3&&text.includes(' '+normalized+' ');
    });
    if(matches.length!==1)return-1;
    return matches[0].index;
  }catch(error){console.warn('[providers] Non-AI web search failed:',error.message);return-1;}
}
function _textPrompt(q,f,v,n,force,courseContext){
  const hasBlank=BLANK_RE.test(q);
  const asksAcronym=/\b(?:abbreviation|acronym)\b/i.test(q||'');
  let prompt='';
  const exNote=_excludedNote(f);
  if(exNote)prompt+=exNote+' ';
  if(f&&f.length)prompt+='CRITICAL: Do NOT answer with: '+[...new Set(f)].sort().join(', ')+'.\n\n';
  if(v)prompt+=RETRY_VARIANTS[Math.min(v,RETRY_VARIANTS.length-1)]+'\n\n';
  if(n)prompt=n+'\n\n'+prompt;
  const blankRules=hasBlank
    ? '\nTHE QUESTION HAS A ______ BLANK.\nReturn ONLY the exact concise missing module term (1-3 words). Do not write a full sentence, quotation marks, labels, explanations, or thinking preambles.\n'
    : '\nReturn ONLY the exact concise module term (1-3 words). Never write sentences, labels, explanations, or thinking preambles.\n';
  const acronymRule=asksAcronym
    ? '\nThe question asks for an abbreviation or acronym: output ONLY the uppercase acronym (for example CPU, IDS, or OSI).\n'
    : '';
  const termRule='\nDo not append filler words such as "Attack" or "Data" unless they are specifically part of the exact term. Examples: "Buffer Overflow", "Phishing", "Integrity", "Software".\n';
  const unknownRule=force?'- NONE is not allowed.\n':'- If unknown, reply NONE\n';
  const contextLine = courseContext ? '\nCourse/Subject: '+courseContext+'\n' : '';
  return prompt+'You are an expert tutor.\n'+_domainNote(q)+contextLine+'\n'+unknownRule+blankRules+acronymRule+termRule+'Question: '+q+'\n\nReply with ONLY the exact answer.';
}
function _conciseTextAnswer(answer,question){
  const value=String(answer||'').trim();
  if(!value)return'';
  if(/\b(?:abbreviation|acronym)\b/i.test(question||'')){
    return /^[A-Za-z0-9][A-Za-z0-9./+-]*$/.test(value)?value.toUpperCase():'';
  }
  return value.split(/\s+/).length<=3?value:'';
}
async function askOpenRouterText(q,bl,f,t,v,n,force,courseContext){if(!cfg('OPENROUTER_API_KEY')||orCooling())return'';try{const r=await postOpenRouter([{role:'user',content:_textPrompt(q,f,v,n,force,courseContext)}],{maxTokens:80,temperature:t??0.1,timeout:25,quiet:true});if(!r)return'';const m=r.choices?.[0]?.message||{};const ra=((m.content||m.reasoning||'')).trim();return _cleanTyped(ra,bl);}catch(e){_recordProviderFailure('OpenRouter',e.status,e.message);return'';}}
async function askOllamaText(q,bl,f,t,v,n,force,courseContext){try{const r=await postOllama(_textPrompt(q,f,v,n,force,courseContext),{numPredict:60,temperature:t??0.1,timeout:35,quiet:true});if(r&&r.response)return _cleanTyped(r.response.trim(),bl);return'';}catch(e){_recordProviderFailure('Ollama',e.status,e.message);return'';}}
async function askCustomApiText(q,bl,f,t,v,n,force,courseContext){if(!cfg('CUSTOM_API_KEY')||customCooling())return'';try{const r=await postCustomApi([{role:'user',content:_textPrompt(q,f,v,n,force,courseContext)}],{maxTokens:80,temperature:t??0.1,timeout:25,quiet:true});if(!r)return'';const m=r.choices?.[0]?.message||{};const ra=((m.content||m.reasoning||'')).trim();return _cleanTyped(ra,bl);}catch(e){_recordProviderFailure('FreeLLMAPI',e.status,e.message);return'';}}
async function askWebText(q){
  if(!cfg('WEB_SEARCH_ENABLED'))return'';
  try{
    const question=(q||'').includes('\n\n')?(q||'').split('\n\n').pop():q;
    return await ollamaWebSearch(_searchQuery(question));
  }catch(error){console.warn('[providers] Non-AI text search failed:',error.message);return'';}
}

// -- matching + askAiText + askAi --

async function askAiText(q){
  const bl=BLANK_RE.test(q);
  const w=await getWrongAnswers(q);
  const b=new Set(w.map(x=>normText(x)));
  const local=await localBankAnswerHits(q);
  if(local&&local.length){
    const ok=local.find((hit)=>hit.verified===true&&!b.has(normText(hit.answer)));
    if(ok)return _cleanTyped(ok.answer,bl);
  }
  const chq=(q||'').replace(/[_\-]{2,}/g,' ').replace(/\s+/g,' ').trim();
  // Neither the local bank nor (checked next) amauoed.com knew this question,
  // so the DuckDuckGo snippet lookup starts right now: it downloads while the
  // answer-key request is in flight, which keeps the extra latency at ~0.
  const snippetLookup=webSnippetLookup(chq);
  if(cfg('ANSWER_KEY_ENABLED')){const ka=await keyAnswer(chq);if(ka&&!b.has(normText(ka)))return ka;}
  if(cfg('WEB_SEARCH_ENABLED')){const results=await askWebText(q);if(results)q+='\n\nNon-AI web search snippets (reference only):\n'+results.slice(0,2000);}
  const snippets=await snippetLookup;
  if(snippets)q+='\n\nReference search snippets:\n'+snippets+'\n\nBased on the question and reference snippets above, reply ONLY with the exact concise module term (1-3 words), with no explanation.';

  if(cfg('ANSWER_KEY_ENABLED')){const h=await hintText(chq);if(h)q+='\n\n'+h;}

  const courseContext = getCourseContext();
  let lg='',nt='';
  const tp=async(name,fn)=>{
    const ep=[...b].some(x=>_echoesQuestion(x,q))?1:0;
    for(let r=0;r<cfg('MAX_TEXT_RETRIES');r++){
      const v=Math.min(ep+r,RETRY_VARIANTS.length-1);
      const temps=[0.1,0.5,0.75,0.95];
      let a=await fn(q,bl,b.size?[...b]:null,temps[r%4],v,nt,false,courseContext);
      if(!a)continue;
      a=_conciseTextAnswer(a,q);
      if(!a){
        if(typeof logHUD==='function')logHUD('warn',name+': rejected answer outside the concise 1-3 word format');
        continue;
      }
      if(isConversationalFiller(a) || a.length > 60){
        if(typeof logHUD==='function') logHUD('warn', name+': rejected conversational/long answer ('+a.length+' chars): '+a.slice(0,80));
        continue;
      }
      lg=a;
      if(b.has(normText(a))){nt='Do NOT answer: '+[...b].sort().join(', ')+'.';continue;}
      if(_echoesQuestion(a,q)&&r<cfg('MAX_TEXT_RETRIES')-1){nt='The answer echoes the question.';b.add(normText(a));continue;}
      return a;
    }
    return '';
  };
  // Provider waterfall — exactly the order askAi() uses for MCQ questions:
  // Local Bank (above) → FreeLLMAPI / Custom OpenAI-compatible endpoint →
  // Gemini → OpenRouter → local Ollama. Web search already ran above and its
  // snippets are folded into the prompt, so there is no extra web stage here.
  // Each step announces which provider is being asked and, when it produces
  // nothing, why it was skipped or failed (HTTP status / error message) so the
  // HUD never ends on a bare "No AI answer (...)".
  const tlog=(level,message)=>{if(typeof logHUD==='function')logHUD(level,message);};
  const skipNote=(name)=>{
    if(name==='FreeLLMAPI')return _skipReason(_customDisabled,_customCooldownUntil);
    if(name==='Gemini')return _skipReason(_geminiDisabled,_geminiCooldownUntil);
    if(name==='OpenRouter')return _skipReason(_orDisabled,_orCooldownUntil);
    return '';
  };
  const askTextProvider=async(name,keyName,fn)=>{
    if(keyName&&!String(cfg(keyName)||'').trim()){tlog('warn',name+' skipped: '+keyName+' not set');return'';}
    const cooling=skipNote(name);
    if(cooling){tlog('warn',name+' skipped: '+cooling);return'';}
    tlog('info','AI text lookup via '+name+'...');
    const startedAt=Date.now();
    let answer='';
    try{
      answer=await tp(name,fn);
    }catch(error){
      const status=Number(error&&(error.status||(String(error.message||'').match(/\bHTTP\s+(\d{3})\b/i)||[])[1]))||0;
      _recordProviderFailure(name,status,(error&&error.message)||String(error));
    }
    if(answer)return answer;
    tlog('warn',name+' failed: '+(_providerFailure(name,startedAt)||'no usable answer returned'));
    return '';
  };
  let answer=await askTextProvider('FreeLLMAPI','CUSTOM_API_KEY',askCustomApiText);if(answer)return answer;
  answer=await askTextProvider('Gemini','GEMINI_API_KEY',askGeminiText);if(answer)return answer;
  answer=await askTextProvider('OpenRouter','OPENROUTER_API_KEY',askOpenRouterText);if(answer)return answer;
  answer=await askTextProvider('Ollama','',askOllamaText);if(answer)return answer;
  try{const f=_conciseTextAnswer(await askOllamaText(q,bl,b.size?[...b]:null,0.3,RETRY_VARIANTS.length-1,nt,true,courseContext),q);if(f&&!b.has(normText(f))&&!isConversationalFiller(f)&&f.length<=60)return f;}catch(e){}
  if(cfg('TYPE_ON_FAILURE')&&lg&&!b.has(normText(lg))&&!isConversationalFiller(lg)&&lg.length<=60)return lg;
  return '';
}

function getCourseContext(){
  if(typeof document==='undefined') return '';
  const breadcrumb = document.querySelector('.breadcrumb a[href*="/course/view.php"]');
  const heading = document.querySelector('.page-header-headings h1, h1');
  const parts = [];
  if(breadcrumb && breadcrumb.textContent) parts.push(breadcrumb.textContent.trim());
  if(heading && heading.textContent) parts.push(heading.textContent.trim());
  if(document.title) parts.push(document.title.trim());
  const ctx = parts.filter(Boolean).join(' > ');
  return ctx.slice(0, 120);
}

function isConversationalFiller(text){
  const t = (text||'').toLowerCase();
  const phrases = ["user's request","cannot","sorry","as an ai","i cannot","i'm unable","i am unable","i'm not able","i am not able","we need","please provide","let me know","happy to help","how can i","here is","here's the","the answer is","answer:","response:","explanation:"];
  return phrases.some(p => t.includes(p));
}
const _LINE_RE=/^\s*(\d{1,2})\s*[.)-:]?\s*(.+)$/;const _PROSE_LETTER_RE=/(?<![.\d])(\d{1,2})\s*[.)-:]\s*([A-Z])(?![A-Za-z])/g;
function _parseMapping(raw,options,n,skip,used){
  used=new Set(used||[]);
  const skipped=new Set(skip||[]);
  const idxs=new Array(n).fill(-1);
  let matched=0;
  const letters={};
  for(let i=0;i<options.length;i++)letters[String.fromCharCode(65+i)]=i;
  const take=(i,j)=>{if(j===-1||used.has(j)||idxs[i]!==-1)return false;idxs[i]=j;used.add(j);matched++;return true;};
  for(const rawLine of(raw||'').split('\n')){
    const line=rawLine.trim().replace(/[*_]/g,'').trim();
    if(!line)continue;
    const match=line.match(_LINE_RE);
    if(!match)continue;
    const i=parseInt(match[1],10)-1;
    if(i<0||i>=n||idxs[i]!==-1||skipped.has(i))continue;
    const rest=match[2].trim().replace(/[*' ]/g,'').trim();
    if(!rest||/^NONE/i.test(rest))continue;
    let j=-1;
    const token=rest.replace(/[ .)\-:]/g,'').trim();
    if(token.length===1&&token.toUpperCase()in letters&&!used.has(letters[token.toUpperCase()]))j=letters[token.toUpperCase()];
    if(j===-1){
      let best=-1,score=0;
      for(let k=0;k<options.length;k++){if(used.has(k))continue;const candidate=similarity(rest.toLowerCase(),options[k].toLowerCase());if(candidate>score){best=k;score=candidate;}}
      if(best!==-1&&score>=0.45)j=best;
    }
    take(i,j);
  }
  if(matched===0){
    let match;
    _PROSE_LETTER_RE.lastIndex=0;
    while((match=_PROSE_LETTER_RE.exec(raw||''))!==null){
      const i=parseInt(match[1],10)-1;
      if(i<0||i>=n||skipped.has(i)||idxs[i]!==-1)continue;
      const candidate=letters[match[2]];
      if(candidate!==undefined)take(i,candidate);
    }
  }
  if(matched===0){
    const bare=(raw||'').split('\n').map((line)=>line.trim().replace(/[*`']/g,'').trim()).filter(Boolean);
    if(bare.length===n){
      for(let i=0;i<n;i++){
        if(skipped.has(i))continue;
        let best=-1,score=0;
        for(let k=0;k<options.length;k++){if(used.has(k))continue;const candidate=similarity(bare[i].toLowerCase(),options[k].toLowerCase());if(candidate>score){best=k;score=candidate;}}
        if(best!==-1&&score>=0.5)take(i,best);
      }
    }
  }
  return{idxs,matched};
}
function _matchingOk(matched,remaining){if(remaining<=0)return true;return matched>=Math.max(1,Math.round(remaining*cfg('MATCHING_MIN_MATCHED')));}
function _bestOptionIndex(text,options,used){let best=-1,score=0;const t=(text||'').toLowerCase().trim();if(!t)return -1;for(let k=0;k<options.length;k++){if(used.has(k))continue;const o=options[k].toLowerCase();let s=similarity(t,o);if(t===o)s=1;else if(t.includes(o)||o.includes(t))s=Math.max(s,0.9);if(s>score){best=k;score=s;}}return score>=cfg('MATCHING_OPTION_FLOOR')?best:-1;}
function _matchingPrompt(header,statements,options,n,locked){const letters=options.map((_,i)=>String.fromCharCode(65+i));const items=letters.map((l,i)=>l+'. '+options[i]).join('\n');const numbered=statements.map((s,i)=>i+1+'. '+(s||'[blank]')).join('\n');let fixed='';if(locked&&locked.length)fixed='\nALREADY ANSWERED:\n'+locked.map(([i,j])=>i+1+'. '+String.fromCharCode(65+j)).join('\n')+'\n';const head=header?header+'\n\n':'';return 'You are completing a matching exam question.\n\n'+head+'STATEMENTS:\n'+numbered+'\n\nITEMS:\n'+items+fixed+'\nReply with exactly '+n+' lines using ONLY letters.\n1. B\n2. E\n...';}
async function askAiMatching(header,statements,options,n,locked,used){used=new Set(used||[]);const skip=new Set((locked||[]).map(x=>x[0]));const remaining=n-skip.size;let prompt=_matchingPrompt(header,statements,options,n,locked);if(cfg('WEB_SEARCH_ENABLED')){try{const context=await ollamaWebSearch(_searchQuery([header,...statements,...options].join(' ')));if(context)prompt+='\n\nNon-AI web search snippets (reference only):\n'+context.slice(0,2000);}catch(error){console.warn('[providers] Matching web search failed:',error.message);}}let bestIdxs=null,bestMatched=0;const consider=(idxs,matched)=>{if(matched>bestMatched){bestIdxs=idxs;bestMatched=matched;}};if(cfg('GEMINI_API_KEY')){const raw=await _askGeminiPrompt(prompt,{maxTokens:260,temperature:0.1,timeout:30});if(raw){const result=_parseMapping(raw,options,n,skip,used);if(_matchingOk(result.matched,remaining))return result;consider(result.idxs,result.matched);}}if(cfg('OPENROUTER_API_KEY')&&!orCooling()){try{const r=await postOpenRouter([{role:'user',content:prompt}],{maxTokens:260,temperature:0.1,timeout:30});if(r){const msg=r.choices?.[0]?.message||{};const raw=((msg.content||msg.reasoning||'')).trim();const result=_parseMapping(raw,options,n,skip,used);if(_matchingOk(result.matched,remaining))return result;consider(result.idxs,result.matched);}}catch(e){}}try{const r=await postOllama(prompt,{numPredict:300,temperature:0.1,timeout:45});if(r&&r.response){const result=_parseMapping(r.response.trim(),options,n,skip,used);if(_matchingOk(result.matched,remaining))return result;consider(result.idxs,result.matched);}}catch(e){}if(bestIdxs!==null&&bestMatched>0)return{idxs:bestIdxs,matched:bestMatched};return{idxs:new Array(n).fill(-1),matched:0};}
async function resolveMatching(header,statements,options,n){const idxs=new Array(n).fill(-1);const src=new Array(n).fill('');const used=new Set();let keyed=0;for(let i=0;i<n;i++){if(!statements[i])continue;const matches=await localBankOptionMatches(statements[i],options);const match=matches.find((item)=>!used.has(item.index));if(!match)continue;idxs[i]=match.index;src[i]='key';used.add(match.index);keyed++;}if(cfg('ANSWER_KEY_ENABLED')){for(let i=0;i<n;i++){if(idxs[i]!==-1||!statements[i])continue;const ans=await keyMatchAnswer(statements[i]);if(!ans)continue;const j=_bestOptionIndex(ans,options,used);if(j===-1)continue;idxs[i]=j;src[i]='key';used.add(j);keyed++;}}if(keyed===n)return{idxs,src,keyed,aiMatched:0};const openBlanks=[];for(let i=0;i<n;i++)if(idxs[i]===-1)openBlanks.push(i);const locked=[];for(let i=0;i<n;i++)if(idxs[i]!==-1)locked.push([i,idxs[i]]);let aiMatched=0;if(openBlanks.length&&used.size<options.length){const res=await askAiMatching(header,statements,options,n,locked,used);for(const i of openBlanks){if(res.idxs[i]!==-1&&!used.has(res.idxs[i])){idxs[i]=res.idxs[i];src[i]='ai';used.add(res.idxs[i]);aiMatched++;}}}const unused=[];for(let j=0;j<options.length;j++)if(!used.has(j))unused.push(j);for(let i=0;i<n;i++)if(idxs[i]===-1&&unused.length){idxs[i]=unused.shift();src[i]='elim';}return{idxs,src,keyed,aiMatched};}
// ── Matching questions: one batch request for every unanswered row ──────────
// `rows` is [{ rowIndex, subStatement }] where rowIndex is the 1-based row
// number shown to the model. The model answers with a strict JSON object that
// maps that same number (as a string) to an exact item from `options`, so the
// whole dropdown block is resolved with a single request instead of one call
// per row.
function _matchingBatchPrompt(rows, options, header) {
  const rowLines=rows.map((row)=>'ROW '+row.rowIndex+': '+(row.subStatement||'[statement unavailable]')).join('\n');
  const itemLines=options.map((option,index)=>(index+1)+'. '+option).join('\n');
  const headerLine=header?'QUESTION: '+header+'\n':'';
  return 'You are completing one matching exam question. Each row is a statement with a missing term and must be matched to exactly one item from the shared ITEMS list.\n\n'+
    headerLine+
    'ROWS:\n'+rowLines+'\n\n'+
    'ITEMS:\n'+itemLines+'\n\n'+
    'Rules:\n'+
    '- Reply with one strict JSON object and nothing else (no prose, no markdown fences).\n'+
    '- Keys are ROW numbers as strings; values are the EXACT item text copied character-for-character from ITEMS.\n'+
    '- Assign each item to at most one row and prefer a one-to-one assignment.\n'+
    '- Omit a row when no item clearly fits instead of guessing.\n'+
    '- Some items differ by small words ("information security" vs "also information security"); copy the exact one that fits the statement.\n'+
    '- Example shape: {"1": "first item text", "2": "second item text"}';
}
function _extractJsonObject(raw) {
  const text=String(raw||'').replace(/```(?:json)?/gi,'').trim();
  if(!text)return null;
  const start=text.indexOf('{');
  const end=text.lastIndexOf('}');
  if(start===-1||end<=start)return null;
  const slice=text.slice(start,end+1);
  const shape=(value)=>value&&typeof value==='object'&&!Array.isArray(value)?value:null;
  try{return shape(JSON.parse(slice));}catch(error){}
  try{
    const repaired=slice.replace(/,\s*([}\]])/g,'$1').replace(/[\u201c\u201d]/g,'"');
    return shape(JSON.parse(repaired));
  }catch(error){return null;}
}
// Resolve one returned item text onto the shared option list. Exact text wins;
// near-duplicates ("also X") and close phrasings are matched only against items
// that are still unassigned so a row can never steal another row's item.
function _batchOptionIndex(value, options, taken) {
  const target=normText(value);
  if(!target)return -1;
  const blocked=taken||new Set();
  const variants=[target];
  const stripped=target.replace(/^(?:also|the)\s+/,'');
  if(stripped&&stripped!==target)variants.push(stripped);
  for(const variant of variants){
    let exactSeen=false;
    for(let index=0;index<options.length;index++){
      if(normText(options[index])!==variant)continue;
      exactSeen=true;
      if(!blocked.has(index))return index;
    }
    // The exact item exists but another row already claimed it: leave this row
    // unanswered instead of silently matching a near-duplicate of it.
    if(exactSeen)return -1;
  }
  for(const variant of variants){
    for(let index=0;index<options.length;index++){
      if(blocked.has(index))continue;
      const candidate=normText(options[index]);
      if(!candidate)continue;
      if((candidate.startsWith(variant)||variant.startsWith(candidate))&&similarity(variant,candidate)>=0.6)return index;
    }
  }
  let best=-1,bestScore=0;
  for(let index=0;index<options.length;index++){
    if(blocked.has(index))continue;
    const score=similarity(target,normText(options[index]));
    if(score>bestScore){best=index;bestScore=score;}
  }
  const floor=Number(cfg('MATCHING_OPTION_FLOOR'))||0.45;
  return best!==-1&&bestScore>=Math.max(floor,0.6)?best:-1;
}
function _batchAssignments(parsed, rows, options) {
  const allowed=new Set((rows||[]).map((row)=>String(row.rowIndex)));
  const assignments={};
  const taken=new Set();
  let matched=0;
  for(const [rawKey,rawValue] of Object.entries(parsed||{})){
    const key=String(rawKey).trim().replace(/^row\s*/i,'').replace(/[^0-9]/g,'');
    if(!allowed.has(key)||assignments[key]!==undefined)continue;
    const index=_batchOptionIndex(typeof rawValue==='string'?rawValue:(rawValue&&rawValue.answer)||'',options,taken);
    if(index===-1)continue;
    assignments[key]=options[index];
    taken.add(index);
    matched++;
  }
  return{assignments,matched};
}

async function resolveMatchingBatch(rows, options, header) {
  const entries=(Array.isArray(rows)?rows:[])
    .filter((row)=>row&&Number.isFinite(Number(row.rowIndex)))
    .map((row)=>({rowIndex:Number(row.rowIndex),subStatement:String(row.subStatement||'').replace(/\s+/g,' ').trim()}));
  const items=(Array.isArray(options)?options:[])
    .map((option)=>String(option||'').replace(/\s+/g,' ').trim())
    .filter(Boolean);
  const empty={assignments:{},matched:0,source:''};
  if(!entries.length||items.length<2)return empty;

  let prompt=_matchingBatchPrompt(entries,items,String(header||'').replace(/\s+/g,' ').trim().slice(0,300));
  if(cfg('WEB_SEARCH_ENABLED')){
    try{
      const context=await ollamaWebSearch(_searchQuery([header,...entries.map((row)=>row.subStatement),...items].join(' ')));
      if(context)prompt+='\n\nNon-AI web search snippets (reference only):\n'+context.slice(0,2000);
    }catch(error){console.warn('[providers] Matching batch web search failed:',error.message);}
  }

  const wanted=entries.length;
  let best=empty;
  const accept=(raw,source)=>{
    const parsed=_extractJsonObject(raw);
    if(!parsed)return false;
    const result=_batchAssignments(parsed,entries,items);
    if(result.matched>best.matched)best={assignments:result.assignments,matched:result.matched,source};
    return _matchingOk(result.matched,wanted);
  };
  const messageOf=(response)=>(response&&response.choices&&response.choices[0]?(response.choices[0].message||{}):{});

  if(cfg('CUSTOM_API_KEY')&&!customCooling()){
    try{
      const response=await postCustomApi([{role:'user',content:prompt}],{maxTokens:400,temperature:0.1,timeout:30});
      const message=messageOf(response);
      if(accept(message.content||message.reasoning||'','custom'))return best;
    }catch(error){}
  }
  if(cfg('GEMINI_API_KEY')){
    const raw=await _askGeminiPrompt(prompt,{maxTokens:400,temperature:0.1,timeout:30});
    if(accept(raw,'gemini'))return best;
  }
  if(cfg('OPENROUTER_API_KEY')&&!orCooling()){
    try{
      const response=await postOpenRouter([{role:'user',content:prompt}],{maxTokens:400,temperature:0.1,timeout:30});
      const message=messageOf(response);
      if(accept(message.content||message.reasoning||'','openrouter'))return best;
    }catch(error){}
  }
  try{
    const response=await postOllama(prompt,{numPredict:500,temperature:0.1,timeout:45});
    if(response&&response.response)accept(response.response,'ollama');
  }catch(error){}
  return best.matched?best:empty;
}

async function askAiMatching(header,statements,options,n,locked,used){used=new Set(used||[]);const skip=new Set((locked||[]).map(x=>x[0]));const remaining=n-skip.size;let prompt=_matchingPrompt(header,statements,options,n,locked);if(cfg('WEB_SEARCH_ENABLED')){try{const context=await ollamaWebSearch(_searchQuery([header,...statements,...options].join(' ')));if(context)prompt+='\n\nNon-AI web search snippets (reference only):\n'+context.slice(0,2000);}catch(error){console.warn('[providers] Matching web search failed:',error.message);}}let bestIdxs=null,bestMatched=0;const consider=(idxs,matched)=>{if(matched>bestMatched){bestIdxs=idxs;bestMatched=matched;}};if(cfg('CUSTOM_API_KEY')&&!customCooling()){try{const r=await postCustomApi([{role:'user',content:prompt}],{maxTokens:260,temperature:0.1,timeout:30});if(r){const msg=r.choices?.[0]?.message||{};const raw=((msg.content||msg.reasoning||'')).trim();const result=_parseMapping(raw,options,n,skip,used);if(_matchingOk(result.matched,remaining))return result;consider(result.idxs,result.matched);}}catch(e){}}if(cfg('GEMINI_API_KEY')){const raw=await _askGeminiPrompt(prompt,{maxTokens:260,temperature:0.1,timeout:30});if(raw){const result=_parseMapping(raw,options,n,skip,used);if(_matchingOk(result.matched,remaining))return result;consider(result.idxs,result.matched);}}if(cfg('OPENROUTER_API_KEY')&&!orCooling()){try{const r=await postOpenRouter([{role:'user',content:prompt}],{maxTokens:260,temperature:0.1,timeout:30});if(r){const msg=r.choices?.[0]?.message||{};const raw=((msg.content||msg.reasoning||'')).trim();const result=_parseMapping(raw,options,n,skip,used);if(_matchingOk(result.matched,remaining))return result;consider(result.idxs,result.matched);}}catch(e){}}try{const r=await postOllama(prompt,{numPredict:300,temperature:0.1,timeout:45});if(r&&r.response){const result=_parseMapping(r.response.trim(),options,n,skip,used);if(_matchingOk(result.matched,remaining))return result;consider(result.idxs,result.matched);}}catch(e){}if(bestIdxs!==null&&bestMatched>0)return{idxs:bestIdxs,matched:bestMatched};return{idxs:new Array(n).fill(-1),matched:0};}
async function askAi(q,o,im){im=im||[];const w=await getWrongAnswers(q);const b=new Set(w.map(x=>normText(x)));const isWrong=(option)=>{const on=normText(option);if(!on)return false;if(b.has(on))return true;for(const x of b)if(similarity(on,x)>=0.9)return true;return false;};const local=await localBankOptionMatches(q,o);const localOk=local.find((match)=>!isWrong(o[match.index]));if(localOk)return localOk.index;const bq=_isBoolQuestion(o);const vp=[];for(let i=0;i<o.length;i++){const on=normText(o[i]);if(!(b.has(on)||[...b].some(x=>similarity(on,x)>=0.9)))vp.push({origIdx:i,opt:o[i]});}if(!vp.length)for(let i=0;i<o.length;i++)vp.push({origIdx:i,opt:o[i]});if(vp.length===1){console.log('Only 1 untried option');return vp[0].origIdx;}const fo=vp.map(p=>p.opt);if(cfg('ANSWER_KEY_ENABLED')){const ki=await keyIndex(q,fo,cfg('BOOL_QUESTION_MIN_SCORE'));if(ki!==-1)return vp[ki].origIdx;}if(cfg('WEB_SEARCH_ENABLED')){const wi=await askWeb(q,fo,vp.map(p=>p.origIdx));if(wi!==-1)return vp[wi].origIdx;}if(bq){const i=await askBoolClaim(q,fo);if(i!==-1)return vp[i].origIdx;}if(im.length){const i=await askVision(q,fo,im);if(i!==-1)return vp[i].origIdx;}let eq=q;if(cfg('ANSWER_KEY_ENABLED')){const h=await hintText(q);if(h)eq+='\n\n'+h;}const exNote=_excludedNote(w);if(exNote)eq+=' '+exNote;if(cfg('CUSTOM_API_KEY')&&!customCooling()){const r=await askCustomApi(eq,fo,null,vp.map(p=>p.origIdx));if(r!==-1)return vp[r].origIdx;}if(cfg('GEMINI_API_KEY')){const r=await askGemini(eq,fo,null,vp.map(p=>p.origIdx));if(r!==-1)return vp[r].origIdx;}if(cfg('OPENROUTER_API_KEY')&&!_orWebDisabled&&!orCooling()){const web=await askOpenRouterWeb(eq,fo,vp.map(p=>p.origIdx));if(web!==-1)return vp[web].origIdx;}if(cfg('OPENROUTER_API_KEY')&&!orCooling()){const r=await askOpenRouter(eq,fo,null,vp.map(p=>p.origIdx));if(r!==-1)return vp[r].origIdx;}try{const r=await askOllama(eq,fo,null,vp.map(p=>p.origIdx));if(r!==-1)return vp[r].origIdx;}catch(e){}return -1;}



;
let _stopRequested = false, _loopActive = false, _hudShadow = null, _hudRoot = null, _lastExtractionWarning = '';
// Set by extractQuestionData() when the only remaining `.que` block(s) are
// matching questions whose dropdowns are already complete: startLoop() then
// advances instead of re-detecting the block as unanswered.
let _lastScanMatchingAnswered = false;
const _autoHarvestRequested = new Set();
const HARVEST_STOP_WORDS = new Set([
  'a', 'an', 'and', 'of', 'the', 'for', 'in', 'its', 'to', 'with',
  'introduction', 'principles', 'applications', 'fundamentals',
]);

// ── Enable/disable + run generation ──────────────────────────────────────────
// `_botEnabled` mirrors BOT_ENABLED from storage (the popup switch). `_runToken`
// is bumped on every start/stop: a cancelled loop can still be parked in a long
// await (AI request, manual wait), so it compares its own token before it clicks
// anything. That is what lets Stop → Run work without an F5.
let _botEnabled = true;
let _runToken = 0;
let _activeRunToken = 0;
let _botEnabledWatched = false;


// ── Update banner (GitHub) ───────────────────────────────────────────────────
// The service worker compares its manifest version with the repo's manifest.json
// (cached 6 h). When GitHub has something newer, a green "Update vX.Y.Z" badge
// appears in the HUD header and downloads the ZIP in one click. Fully cosmetic.
const UPDATE_ZIP_URL = 'https://github.com/ambotlangnimo/moodle-quiz-bot/archive/refs/heads/main.zip';
let _updateInfo = null;

// Reveal the green badge. Safe to call before createHUD(): the info is cached and
// replayed once the HUD exists.
function showUpdateBadge(info) {
  if (!info || !info.latestVersion) return;
  _updateInfo = info;
  const badge = _hudShadow?.getElementById('hud-update-badge');
  if (!badge) return;
  const version = String(info.latestVersion).trim().replace(/^v/i, '');
  if (!version) return;
  badge.href = info.downloadUrl || UPDATE_ZIP_URL;
  badge.textContent = 'Update v' + version;
  badge.title = 'Download v' + version + ' ZIP (installed v' + (info.currentVersion || '?') + ')';
  badge.hidden = false;
}

// Ask the service worker for the GitHub status. force=true skips its 6-hour cache.
function requestUpdateCheck(force) {
  try {
    chrome.runtime.sendMessage({ action: 'CHECK_EXTENSION_UPDATE', force: !!force }, (response) => {
      if (chrome.runtime.lastError || !response) return;
      if (response.updateAvailable) showUpdateBadge(response);
    });
  } catch (error) { /* background restarting: the next page load retries */ }
}

function createHUD() {
  if (_hudRoot) return;
  _hudRoot = document.createElement('div');
  _hudRoot.id = 'moodle-quiz-bot-hud';
  _hudShadow = _hudRoot.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  fetch(chrome.runtime.getURL('hud.css')).then(r=>r.text()).then(c=>{style.textContent=c;}).catch(()=>{});
  _hudShadow.appendChild(style);
  const root = document.createElement('div'); root.id = 'hud-root';
  root.innerHTML = '<div id="hud-header"><span id="hud-title">Quiz Bot</span><a id="hud-update-badge" href="https://github.com/ambotlangnimo/moodle-quiz-bot/archive/refs/heads/main.zip" target="_blank" rel="noopener" hidden>Update</a><span id="hud-status">idle</span></div><div id="hud-body"></div><div id="hud-footer"><button class="hud-btn" id="hud-stop-btn">Stop</button><button class="hud-btn" id="hud-clear-btn">Clear</button><button class="hud-btn" id="hud-harvest-btn">Harvest</button><button class="hud-btn" id="hud-toggle-btn">Run</button></div>';
  _hudShadow.appendChild(root); document.body.appendChild(_hudRoot);
  // Badge styling lives here (not hud.css) so the banner still looks right if the
  // stylesheet fetch is slow or fails.
  const updateStyle = document.createElement('style');
  updateStyle.textContent = `
#hud-update-badge {
  flex-shrink: 0;
  padding: 2px 8px;
  border-radius: 10px;
  background: #16a34a;
  color: #ffffff;
  font-size: 11px;
  font-weight: 600;
  line-height: 1.6;
  text-decoration: none;
  white-space: nowrap;
  cursor: pointer;
  pointer-events: auto;
}
#hud-update-badge:hover { background: #15803d; }
#hud-update-badge:active { background: #166534; }`;
  _hudShadow.appendChild(updateStyle);
  const updateBadge = _hudShadow.getElementById('hud-update-badge');
  if (updateBadge) {
    // Stop the header drag handler from swallowing the click.
    updateBadge.onmousedown = (event) => event.stopPropagation();
    updateBadge.onclick = () => {
      const info = _updateInfo || {};
      const version = String(info.latestVersion || '').trim().replace(/^v/i, '') || 'latest';
      // The anchor href itself opens the ZIP download in a new tab.
      logHUD('success', 'Update v' + version + ' downloaded! Extract over your extension folder and click Reload in brave://extensions.');
    };
  }
  if (_updateInfo) showUpdateBadge(_updateInfo);
  requestUpdateCheck(false);
  _hudShadow.getElementById('hud-stop-btn').onclick = () => { stopLoop('Bot stopped.'); };
  _hudShadow.getElementById('hud-clear-btn').onclick = () => { _hudShadow.getElementById('hud-body').innerHTML = ''; };
  _hudShadow.getElementById('hud-harvest-btn').onclick = () => { requestCourseHarvest(true); harvestCourseReviews(true); };
  // Run ↔ Stop toggle. Run clears every stale flag first, so it always starts a
  // fresh scan — clicking Stop and then Run never needs a page refresh.
  _hudShadow.getElementById('hud-toggle-btn').onclick = () => {
    if (_loopActive) { stopLoop('Bot stopped.'); return; }
    _stopRequested = false;
    _runToken += 1;        // orphan anything still winding down
    startLoop();
  };
  let dg = false, sx, sy, ox, oy;
  const hdr = _hudShadow.getElementById('hud-header');
  hdr.onmousedown = (e) => { dg = true; sx = e.clientX; sy = e.clientY; ox = _hudRoot.offsetLeft; oy = _hudRoot.offsetTop; document.onmousemove = (me) => { if (!dg) return; _hudRoot.style.left = (ox+me.clientX-sx)+'px'; _hudRoot.style.top = (oy+me.clientY-sy)+'px'; _hudRoot.style.right='auto'; _hudRoot.style.bottom='auto'; }; document.onmouseup = () => { dg = false; document.onmousemove=null; document.onmouseup=null; }; };
  // The popup switch may already be off when this tab loads: stay hidden until
  // BOT_ENABLED flips back on.
  setHudVisible(_botEnabled);
}

function logHUD(lvl, txt) {
  const b = _hudShadow?.getElementById('hud-body'); if (!b) return;
  const e = document.createElement('div'); e.className='hud-log-line '+lvl; e.textContent='['+new Date().toLocaleTimeString()+'] '+txt;
  b.appendChild(e); b.scrollTop = b.scrollHeight;
  console.log('[HUD/'+lvl+'] '+txt);
  try { chrome.runtime.sendMessage({action:'log',level:lvl,text:txt}); } catch(ex) {}
}

/* ── Instant enable/disable (BOT_ENABLED) ──────────────────────────────────── */
// popup.js writes BOT_ENABLED to chrome.storage.local and mirrors it to .sync
// (config.js reads .sync). Local wins when present; `!== false` means enabled.
function readBotEnabled(callback) {
  const done = (value) => { try { callback(value !== false); } catch (error) { /* caller bug */ } };
  try {
    chrome.storage.local.get('BOT_ENABLED', (local) => {
      if (chrome.runtime.lastError) { done(true); return; }
      if (local && local.BOT_ENABLED !== undefined) { done(local.BOT_ENABLED); return; }
      try {
        chrome.storage.sync.get('BOT_ENABLED', (sync) => {
          if (chrome.runtime.lastError) { done(true); return; }
          done(sync ? sync.BOT_ENABLED : undefined);
        });
      } catch (error) { done(true); }
    });
  } catch (error) { done(true); }
}

// Promise form for the async paths (startLoop).
function readBotEnabledAsync() {
  return new Promise((resolve) => readBotEnabled(resolve));
}

// display:none takes the whole shadow host off the page instantly; restoring
// hands the layout back to hud.css (:host is a fixed-position block).
function setHudVisible(visible) {
  if (!_hudRoot) return;
  _hudRoot.style.display = visible ? 'block' : 'none';
}

// True once the run that called us was cancelled (Stop, a new Run, or Disable).
function runCancelled() {
  return _stopRequested || !_botEnabled || _activeRunToken !== _runToken;
}

// Stop: release the lock immediately and invalidate the in-flight loop. Run then
// only has to flip `_stopRequested` back and call startLoop() again.
function stopLoop(reason) {
  const wasActive = _loopActive || !_stopRequested;
  _stopRequested = true;
  _runToken += 1;        // a parked loop can never click after this line
  _loopActive = false;   // ← without this Run was ignored until an F5
  if (_hudRoot) _hudRoot.classList.remove('active');
  setHUDStatus('stopped');
  if (wasActive) logHUD('error', reason || 'Bot stopped.');
  return wasActive;
}

// `initial` is the first read on page load: nothing is running yet, so it must
// not log a stop into a HUD that never started.
function applyBotEnabled(enabled, initial) {
  const next = enabled !== false;
  const changed = next !== _botEnabled;
  _botEnabled = next;
  if (!next) {
    if (_loopActive) stopLoop('Bot stopped — disabled from the popup.');
    // `changed` guards against the popup's second write (.sync after .local):
    // the duplicate event must not overwrite the "stopped" pill with "idle".
    else if (changed && !initial) { _stopRequested = true; setHUDStatus('idle'); }
    setHudVisible(false);
    return;
  }
  // Re-enabled: bring the HUD back. The loop itself waits for Run (nothing is
  // restarted behind the user's back).
  if (changed) logHUD('info', 'Bot enabled — press Run to continue.');
  setHudVisible(true);
}

function watchBotEnabled() {
  if (_botEnabledWatched) return;
  _botEnabledWatched = true;
  try {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.onChanged) return;
    chrome.storage.onChanged.addListener((changes, areaName) => {
      try {
        if (areaName !== 'local' && areaName !== 'sync') return;
        if (!changes || !changes.BOT_ENABLED) return;
        const value = changes.BOT_ENABLED.newValue;
        applyBotEnabled(value === undefined ? true : value, false);
      } catch (error) { /* never break the page */ }
    });
  } catch (error) { /* storage events unavailable */ }
}

chrome.runtime.onMessage.addListener((message) => {
  if (message && message.type === 'AUTO_HARVEST_PROGRESS') {
    logHUD(message.level || 'info', message.text || 'Course answer harvesting is running.');
  }
  // Service-worker broadcast: a newer build is on GitHub right now.
  if (message && message.type === 'EXTENSION_UPDATE_AVAILABLE' && message.updateAvailable !== false) {
    showUpdateBadge(message);
  }
});

function cleanCourseTitle(value) {
  return (value || '')
    .replace(/\bUGRD-[A-Z0-9-]+\b/gi, ' ')
    .replace(/\bSEMESTRALEXAM\s+\d{4}[A-Z]?\b/gi, ' ')
    .replace(/\s*(?:[-–—]\s*)?\b\d{4}[A-Z]?\s*$/i, ' ')
    .replace(/\s*[|–—]\s*Moodle\s*$/i, '')
    .replace(/\(\s*\)|\[\s*\]/g, ' ')
    .replace(/^\s*[-:|–—]+\s*|\s*[-|]+\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeReviewText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

// ── Superscript / subscript / Moodle image normalization ────────────────────
// Moodle renders exponents and indices as <sup>/<sub> nodes. Converting them to
// real unicode characters ("2<sup>3</sup>" -> "2³", "10<sub>2</sub>" -> "10₂")
// means a typed "2³" and a marked-up one produce the same bank key, and
// `normText()` folds both back to plain digits. pluginfile.php URLs carry an
// attempt-specific id, so images become the stable `[moodle-asset:file]` token.
function scriptToken(tagName, raw) {
  const text = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const tag = String(tagName || '').toUpperCase();
  const map = tag === 'SUB' ? SUB_MAP : SUP_MAP;
  if ([...text].every((ch) => Object.prototype.hasOwnProperty.call(map, ch))) {
    return [...text].map((ch) => map[ch]).join('');
  }
  return (tag === 'SUB' ? '_{' : '^{') + text + '}';
}

function imageTokenFor(img) {
  if (!img) return '';
  const src = img.getAttribute('src') || img.getAttribute('data-src') || img.src || '';
  const alt = String(img.getAttribute('alt') || '').trim();
  const token = moodleAssetToken(src);
  if (token) return alt ? `[Image: ${alt} - ${token}]` : `[Image: ${token}]`;
  return alt ? `[Image: ${alt}]` : '';
}

// Replace <sup>/<sub>/<img> inside a cloned DOM node with their text equivalents.
function replaceScriptsAndImages(root) {
  if (!root || !root.querySelectorAll) return root;
  const doc = root.ownerDocument || document;
  root.querySelectorAll('sup').forEach((node) => {
    node.replaceWith(doc.createTextNode(scriptToken('SUP', node.textContent || '')));
  });
  root.querySelectorAll('sub').forEach((node) => {
    node.replaceWith(doc.createTextNode(scriptToken('SUB', node.textContent || '')));
  });
  root.querySelectorAll('img').forEach((img) => {
    const token = imageTokenFor(img);
    img.replaceWith(doc.createTextNode(token ? ' ' + token + ' ' : ''));
  });
  return root;
}

// Clean text of one DOM node: strips helper markup, folds sup/sub/images, then
// collapses whitespace. Used for statements, choices and answers so the stored
// key and the next attempt's prompt are produced by the same code path.
function cleanNodeText(node, stripSelector) {
  if (!node) return '';
  const clone = node.cloneNode(true);
  if (stripSelector && clone.querySelectorAll) {
    clone.querySelectorAll(stripSelector).forEach((child) => child.remove());
  }
  replaceScriptsAndImages(clone);
  return normalizeReviewText(clone.innerText || clone.textContent || '');
}

// Parse a Moodle 4.x review question. Normalises whitespace in ".info"/".grade"
// before matching "Mark X out of Y", and falls back to the correctness
// indicators used by AMA's theme (.que.correct, "Your answer is correct",
// .qnbutton.correct / title containing "Correct").
// Returns { earned, max, correct } or null when there is no signal at all.
function parseGradeFromReview(scope) {
  const root = scope || document;
  let infoText = '';
  for (const node of root.querySelectorAll('.info, .grade')) {
    infoText += ' ' + (node.innerText || node.textContent || '');
  }
  infoText = normalizeReviewText(infoText);
  if (!infoText && root.innerText) infoText = normalizeReviewText(root.innerText);

  let earned = null;
  let max = null;
  const m = infoText.match(/Mark\s*([0-9.]+)\s*out of\s*([0-9.]+)/i);
  if (m) {
    earned = parseFloat(m[1]);
    max = parseFloat(m[2]);
  }

  // Grade numbers are authoritative when present: 1.00/1.00 -> right, 0.00/1.00 -> wrong.
  let correct = null;
  if (earned !== null && max !== null && !Number.isNaN(earned) && !Number.isNaN(max)) {
    correct = earned !== 0 && earned >= max;
  }

  // Fallback indicators when the numeric grade is missing or unparsable.
  if (correct === null) {
    const text = normalizeReviewText(root.innerText || root.textContent || '');
    const cls = new Set(String((root !== document && root.className) || '').toLowerCase().split(/\s+/));
    if (/Your answer is correct/i.test(text)) correct = true;
    else if (/Your answer is (?:incorrect|partially correct)/i.test(text)) correct = false;
    else if (root.querySelector('.que.correct')) correct = true;
    else if (cls.has('correct') && !cls.has('partiallycorrect')) correct = true;
    else if (cls.has('incorrect') || cls.has('partiallycorrect')) correct = false;
    else {
      const nav = root.querySelector ? root.querySelector('.qnbutton') : null;
      if (nav) {
        const navCls = String(nav.className || '').toLowerCase();
        const title = nav.getAttribute('title') || '';
        if (/partiallycorrect|incorrect/.test(navCls) || /incorrect/i.test(title)) correct = false;
        else if (/correct/.test(navCls) || /correct/i.test(title)) correct = true;
      }
    }
  }

  if (earned === null && correct === null) return null;
  return { earned, max, correct };
}

function isReviewPage(){
  return location.pathname.includes('/mod/quiz/review.php');
}

async function saveCorrectAnswerFromReview(question, answer){
  if(!answer||!answer.trim())return false;
  const key = normText(question);
  const value = answer.trim();
  if(!key||!value)return false;
  const hits = await answerKeyGet(key);
  const answerNorm = normText(value);
  if(!hits.some((hit) => hit && normText(hit.answer)===answerNorm)){
    await answerKeyPut(key, value, 'learned-review', { verified: true });
    return true;
  }
  return false;
}

// Ask the background worker to push the (verified) local bank to GitHub.
// Debounced so a burst of learned answers results in a single push.
let _gitHubPushTimer = null;
function requestGitHubBankPush(){
  if (_gitHubPushTimer) return;
  _gitHubPushTimer = setTimeout(async () => {
    _gitHubPushTimer = null;
    try {
      await flushNow();
      chrome.runtime.sendMessage({ action: 'SYNC_GITHUB_BANK' }, (resp) => {
        if (chrome.runtime.lastError) return;
        if (!resp) return;
        if (resp.error) { logHUD('warn', 'GitHub push: ' + resp.error); return; }
        if (resp.status === 'ok') logHUD('info', `GitHub bank pushed (${resp.pushed || 0} questions)`);
      });
    } catch (e) { /* extension context may have been invalidated */ }
  }, 1000);
}

function isGenericHarvestTitle(value) {
  const raw = String(value || '');
  const title = cleanCourseTitle(raw);
  const normalized = normText(title);
  return !normalized ||
    /^\s*UGRD-[A-Z0-9-]+\s*$/i.test(raw) ||
    /^(?:(?:quiz|seatwork|assignment)\s+)?(?:prelim|midterm|final)\s+exam(?:\s+\d+)?$/.test(normalized) ||
    /^(?:quiz|seatwork|assignment)(?:\s+\d+)?$/.test(normalized) ||
    /^2612s?$/.test(normalized);
}

function courseIdFromHref(href) {
  try {
    return new URL(href, location.origin).searchParams.get('id') || '';
  } catch (error) {
    return '';
  }
}

function visibleCourseTopics() {
  const topics = [];
  const seen = new Set();
  for (const node of document.querySelectorAll('.sectionname, .activityname')) {
    let visible = false;
    try {
      const style = getComputedStyle(node);
      visible = style.display !== 'none' && style.visibility !== 'hidden' && node.getClientRects().length > 0;
    } catch (error) {
      visible = node.getClientRects().length > 0;
    }
    if (!visible) continue;
    const topic = cleanCourseTitle(node.textContent || node.innerText);
    const key = normText(topic);
    if (!key || isGenericHarvestTitle(topic) || seen.has(key)) continue;
    seen.add(key);
    topics.push(topic);
    if (topics.length === 5) break;
  }
  return topics;
}

function buildHarvestKeywords(values) {
  const keywords = [];
  const seen = new Set();
  for (const value of values) {
    if (isGenericHarvestTitle(value)) continue;
    const words = cleanCourseTitle(value).toLowerCase()
      .replace(/&/g, ' ')
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/);
    for (const word of words) {
      if (word.length < 4 || HARVEST_STOP_WORDS.has(word) || seen.has(word)) continue;
      seen.add(word);
      keywords.push(word);
      if (keywords.length === 15) return keywords;
    }
  }
  return keywords;
}

async function saveCourseTitlesFromLinks() {
  const stored = await chrome.storage.local.get('courseTitlesMap');
  const courseTitlesMap = stored.courseTitlesMap && typeof stored.courseTitlesMap === 'object'
    ? stored.courseTitlesMap
    : {};
  const titles = { ...courseTitlesMap };
  for (const link of document.querySelectorAll('a[href*="/course/view.php?id="]')) {
    const courseId = courseIdFromHref(link.href);
    const title = cleanCourseTitle(link.textContent || link.innerText || link.getAttribute('aria-label'));
    if (!courseId || isGenericHarvestTitle(title)) continue;
    titles[courseId] = title;
  }
  await chrome.storage.local.set({ courseTitlesMap: titles });
  return titles;
}

async function saveCourseMetadata(courseId, title, topics) {
  if (!courseId || !title) return;
  const stored = await chrome.storage.local.get(['courseTitlesMap', 'courseTopicsMap']);
  const courseTitlesMap = {
    ...(stored.courseTitlesMap && typeof stored.courseTitlesMap === 'object' ? stored.courseTitlesMap : {}),
    [courseId]: title,
  };
  const courseTopicsMap = {
    ...(stored.courseTopicsMap && typeof stored.courseTopicsMap === 'object' ? stored.courseTopicsMap : {}),
  };
  if (topics && topics.length) courseTopicsMap[courseId] = topics;
  await chrome.storage.local.set({ courseTitlesMap, courseTopicsMap });
}

async function courseHarvestInfo() {
  const pathname = location.pathname || '';
  // Use .includes()/.endsWith() so term-prefixed paths (e.g. /2612/my/) match too.
  if (pathname === '/my' || pathname.includes('/my/') || pathname.endsWith('/my')) {
    await saveCourseTitlesFromLinks();
    return null;
  }
  const isGradesPage = pathname.includes('/grade/report/user/index.php');
  const isCoursePage = pathname.includes('/course/view.php') || isGradesPage;
  const isQuizPage = pathname.includes('/mod/quiz/view.php') || pathname.includes('/mod/quiz/attempt.php');
  if (!isCoursePage && !isQuizPage) return null;
  if (isCoursePage) await saveCourseTitlesFromLinks();
  const heading = document.querySelector('.page-header-headings h1');
  const breadcrumb = document.querySelector('.breadcrumb a[href*="/course/view.php"]');
  const courseUrl = isCoursePage
    ? location.href
    : breadcrumb && breadcrumb.href;
  const courseId = courseIdFromHref(courseUrl || '');
  const stored = await chrome.storage.local.get(['courseTitlesMap', 'courseTopicsMap']);
  const courseTitlesMap = stored.courseTitlesMap && typeof stored.courseTitlesMap === 'object'
    ? stored.courseTitlesMap
    : {};
  const courseTopicsMap = stored.courseTopicsMap && typeof stored.courseTopicsMap === 'object'
    ? stored.courseTopicsMap
    : {};
  let title = '';
  const candidates = isCoursePage
    ? [heading && heading.textContent, courseTitlesMap[courseId],
      breadcrumb && breadcrumb.textContent, document.title]
    : [courseTitlesMap[courseId],
      breadcrumb && breadcrumb.textContent, heading && heading.textContent, document.title];
  for (const candidate of candidates) {
    const cleaned = cleanCourseTitle(candidate || '');
    if (!isGenericHarvestTitle(candidate || cleaned)) {
      title = cleaned;
      break;
    }
  }
  const courseKey = normText(title);
  if (!title && !courseId) return null;
  const moduleTopics = [
    ...(Array.isArray(courseTopicsMap[courseId]) ? courseTopicsMap[courseId] : []),
    ...visibleCourseTopics(),
  ];
  const topics = [];
  const topicKeys = new Set();
  for (const candidate of moduleTopics) {
    const topic = cleanCourseTitle(candidate);
    const key = normText(topic);
    if (!key || isGenericHarvestTitle(topic) || topicKeys.has(key)) continue;
    topicKeys.add(key);
    topics.push(topic);
  }
  const keywords = buildHarvestKeywords([title, ...topics]);
  if (isCoursePage && title) await saveCourseMetadata(courseId, title, topics);
  return {
    courseId,
    courseKey,
    title,
    moduleTopics: topics,
    keywords,
    courseUrl: courseUrl ? new URL(courseUrl, location.origin).href : '',
  };
}

async function requestCourseHarvest(force = false) {
  let info;
  try {
    info = await courseHarvestInfo();
  } catch (error) {
    logHUD('warn', 'Could not resolve course for harvesting: ' + error.message);
    return false;
  }
  if (!info) {
    if (force) logHUD('warn', 'Open a Moodle course or quiz page to harvest its answer bank.');
    return false;
  }
  const requestKey = info.courseId || info.courseKey;
  if (!force && _autoHarvestRequested.has(requestKey)) return true;
  if (!force) _autoHarvestRequested.add(requestKey);
  const message = {
    type: 'AUTO_HARVEST',
    courseId: info.courseId,
    courseKey: info.courseKey,
    courseTitle: info.title,
    courseUrl: info.courseUrl,
    moduleTopics: info.moduleTopics,
    keywords: info.keywords,
  };
  if (force) message.force = true;
  try {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        logHUD('warn', 'Course harvesting request failed: ' + chrome.runtime.lastError.message);
      } else if (response && response.error) {
        logHUD('warn', 'Course harvesting failed: ' + response.error);
      }
    });
    return true;
  } catch (error) {
    logHUD('warn', 'Course harvesting request failed: ' + error.message);
    return false;
  }
}

function startAutoHarvest() {
  requestCourseHarvest(false);
  // Course / grades pages also learn from every completed quiz's review page,
  // once per course (6 h throttle), then push the new pairs to GitHub.
  const pathname = location.pathname || '';
  if (pathname.includes('/course/view.php') || pathname.includes('/grade/report/user/index.php')) {
    setTimeout(() => { harvestCourseReviews(false).catch(() => {}); }, 2500);
  }
}

function addResultEntry(q, t, a, s) {
  const b = _hudShadow?.getElementById('hud-body'); if (!b) return;
  const e = document.createElement('div'); e.className='hud-entry';
  e.innerHTML = '<div class="q-text">'+esc(q.slice(0,80))+'</div><div class="q-result"><span class="q-tier">'+esc(t)+'</span><span class="q-answer">'+esc(a)+'</span><span class="q-score">'+(s||'')+'</span></div>';
  b.appendChild(e); b.scrollTop = b.scrollHeight;
}

function setHUDStatus(s) { const e = _hudShadow?.getElementById('hud-status'); if (e) { e.textContent = s; e.className = s; } }
function esc(s) { return (s||'').replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }

function getQContainers() { return Array.from(document.querySelectorAll('div.que')).filter(d => !d.parentElement?.closest('div.que')); }
function qSig(c) { return c.id || normText(qTxt(c)).slice(0,120); }
function qTxt(c) {
  const BLOCK = new Set(['P','DIV','LI','UL','OL','BR','TR','H1','H2','H3','H4','H5','H6','BLOCKQUOTE','PRE','TABLE']);
  const SKIP = new Set(['SCRIPT','STYLE','BUTTON','NOSCRIPT']);
  const SKIP_CLASSES = new Set(['info','outcome','feedback','rightanswer','qno','state','grade','questionflag']);
  const extract = (root) => {
    let output = '';
    const walk = (node) => {
      if (node.nodeType === 3) { output += node.nodeValue; return; }
      if (node.nodeType !== 1) return;
      const tag = node.tagName;
      if (SKIP.has(tag)) return;
      const className = String(node.className || '');
      if (className.split(/\s+/).some((name) => SKIP_CLASSES.has(name))) return;
      if (/\bsr-only|visually-hidden|accesshide|answerlabel\b/.test(className)) return;
      if (tag === 'SUP' || tag === 'SUB') { output += scriptToken(tag, node.textContent || ''); return; }
      if (tag === 'IMG') {
        const token = imageTokenFor(node);
        if (token) output += ' ' + token + ' ';
        return;
      }
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') { output += ' ______ '; return; }
      const isBlock = BLOCK.has(tag);
      if (isBlock) output += '\n';
      for (const child of node.childNodes) walk(child);
      if (isBlock) output += '\n';
    };
    walk(root);
    const lines = [];
    const seen = new Set();
    for (const line of output.split('\n')) {
      const text = line.replace(/\s+/g,' ').trim();
      const normalized = text.toLowerCase();
      if (!text || seen.has(normalized)) continue;
      seen.add(normalized);
      lines.push(text);
    }
    return lines.join('\n').slice(0,1200);
  };
  const questionText = Array.from(c.querySelectorAll('.qtext'));
  const preferred = questionText.length ? questionText : Array.from(c.querySelectorAll('.formulation'));
  for (const node of preferred) {
    const text = extract(node);
    if (text) return text;
  }
  return extract(c);
}
function elemSig(els) { if (!els||!els.length) return ''; const c = els[0].closest('div[class*="que"]'); return c ? qSig(c) : ''; }
function optLabel(el){
  const textFrom=(node)=>{
    if(!node)return'';
    return cleanNodeText(node, 'input, script, style, .sr-only, .accesshide, .answernumber, select');
  };
  const labels=[];
  if(el.id){try{const label=document.querySelector('label[for="'+CSS.escape(el.id)+'"]');if(label)labels.push(label);}catch(e){}}
  try{const label=el.closest('label');if(label&&!labels.includes(label))labels.push(label);}catch(e){}
  for(const label of labels){const text=textFrom(label);if(text)return text;}
  if(el.parentElement){
    try{
      const answerLabel=el.parentElement.querySelector('[data-region="answer-label"], .flex-fill, .ml-1, .answertext');
      const text=textFrom(answerLabel);
      if(text)return text;
    }catch(e){}
  }
  let row=el.parentElement;
  while(row){
    const text=textFrom(row);
    if(text)return text;
    if(/(^|\s)r[01](\s|$)/.test(String(row.className||'')))break;
    row=row.parentElement;
  }
  return'';
}
function optTxt(el){let t=optLabel(el);if(t){t=t.replace(/\s+/g,' ').replace(/^[a-dA-D][.)]\s*/,'');return t.trim();}return (el.getAttribute('value')||'').trim();}
function xtractOpts(radios){const txts=[],els=[];for(const r of radios){if((r.getAttribute('value')||'')==='-1')continue;const t=optTxt(r);if(t){txts.push(t);els.push(r);}}return{txts,els};}
function isQuizPg(){return getQContainers().length>0||!!document.querySelector('form#responseform, #mod_quiz-next-nav, #mod_quiz-finish-nav, .que, input[type="radio"][name^="q"]');}
function isReviwPg(){return (typeof location!=='undefined'&&location.pathname.includes('/review.php'))||!!document.querySelector('.rightanswer, .reviewsummary, .que.correct, .que.incorrect, .que.partiallycorrect, .outcome .feedback');}const NAV_S = '__navigating__';

// ── Matching questions (.que.match) ─────────────────────────────────────────
// Every <select> sits in its own row whose prompt is the sub-statement to
// complete ("Computer security and cybersecurity are both children of ______").
// "Match the term/details to complete each statement." only describes the whole
// block, so keying answers by it would blend every pair together — each row is
// stored/retrieved under its own sub-statement instead.
const MATCH_CELL_SKIP = /(^|\s)(control|feedback|feedbackspan|state|grade|outcome|rightanswer|correctanswer)(\s|$)/i;

// Dropdowns that belong to the matching block (navigation/attempt controls
// inside the same .que are ignored so they can never be mistaken for a row).
function matchingSelects(container) {
  if (!container || !container.querySelectorAll) return [];
  return Array.from(container.querySelectorAll('div.answer select, .answer select, select'))
    .filter((select) => !select.closest('.im-controls, .submitbtns, .submitbuttons, .quiznavigation'));
}

// True for `qtype_match` blocks: `.que.match`, or several dropdowns laid out as
// `table.answer tr` / `.answer .row` pairs. Inline "select missing word" blanks
// are not rows, so they keep the legacy resolver.
function isMatchingBlock(container) {
  if (!container) return false;
  if (/(^|\s)match(\s|$)/i.test(String(container.className || ''))) return true;
  return !!container.querySelector('table.answer tr select, .answer .row select, .answer .r0 select, .answer .r1 select');
}

// Data rows of a matching block. Review pages render graded rows as text (no
// live <select> anymore), so a row with an answer/feedback cell still counts.
function matchingRowElements(container) {
  if (!container || !container.querySelectorAll) return [];
  return Array.from(container.querySelectorAll('table.answer tr, .answer .row, .answer .r0, .answer .r1'))
    .filter((row) => {
      const cells = Array.from(row.children || []).filter((child) => String(child.tagName || '').toUpperCase() === 'TD');
      if (!cells.length) return false;
      if (row.querySelector('select')) return true;
      return !!row.querySelector('.rightanswer, .correctanswer, .feedback, .answer');
    });
}

// The row element that carries one statement + its dropdown. Moodle uses
// `table.answer tr` (4.x) and some themes use `.answer .row` divs.
function matchingRowRoot(selectEl) {
  if (!selectEl) return null;
  try {
    const row = selectEl.closest('tr');
    if (row) return row;
  } catch (error) { /* closest() unavailable on exotic nodes */ }
  let node = selectEl.parentElement;
  let fallback = node || selectEl;
  let depth = 0;
  while (node && depth < 6) {
    if (node.querySelectorAll && node.querySelectorAll('select').length > 1) break;
    if (/(^|\s)(row|r0|r1|answerrow|answer)(\s|$)/i.test(String(node.className || ''))) return node;
    fallback = node;
    node = node.parentElement;
    depth += 1;
  }
  return fallback;
}

// Text of the statement cell only: the dropdown cell, the feedback cell and the
// graded "The correct answer is..." block are never part of the key.
const MATCH_STRIP_SELECTOR = 'select, input, button, script, style, .rightanswer, .correctanswer, .feedback, .feedbackspan, .state, .grade, .icon, .accesshide, .answernumber, .sr-only, .useranswer';

function statementTextFrom(node) {
  return cleanNodeText(node, MATCH_STRIP_SELECTOR);
}

function statementFromRowRoot(rowRoot, selectEl) {
  if (!rowRoot) return '';
  let parts = [];
  if (rowRoot.tagName === 'TR') parts = Array.from(rowRoot.children);
  else if (rowRoot.querySelectorAll) parts = Array.from(rowRoot.querySelectorAll(':scope > *'));
  for (const part of parts) {
    if (!part || part.nodeType !== 1) continue;
    if (selectEl && (part === selectEl || part.contains(selectEl))) continue;
    if (MATCH_CELL_SKIP.test(String(part.className || ''))) continue;
    if (part.querySelector && part.querySelector('select')) continue;
    const text = statementTextFrom(part);
    if (text) return text;
  }
  return statementTextFrom(rowRoot);
}

// Normalise one row prompt into a stable lookup key: numbering and leaked
// "Choose..." placeholder text are dropped, the blank itself is kept so the
// statement stays readable, and meaningless rows (letters/digits only) are
// rejected.
function cleanSubStatement(raw) {
  let text = normalizeReviewText(raw);
  if (!text) return '';
  text = text.replace(PLACEHOLDER_RE, ' ');
  // Graded feedback ("The correct answer is: ...") is never part of the prompt.
  text = text.replace(/\s*(?:the\s+)?correct\s+answer\s+is\s*:.*$/i, ' ');
  text = text.replace(/\s*correct\s+answer\s*:.*$/i, ' ');
  text = text.replace(/^[-\u2013\u2014(\[]?\s*\d{1,2}\s*[.)\]:]\s*/, '');
  text = text.replace(/\s+(?:choose\.{2,}.*|select one.*)$/i, ' ');
  text = text.replace(/\s+/g, ' ').trim();
  if (text.replace(/[\s\d_\-.,;:()\[\]]/g, '').length < 8) return '';
  return text.slice(0, 300);
}

// Build one record per dropdown: { rowIndex, element, rowRoot, subStatement }.
// `rowIndex` is the 1-based row number used in prompts, logs and the batch JSON.
// Items may be dropdowns (attempt page) or row elements (review pages, where a
// row can render its answer as text instead of a disabled <select>).
function collectMatchingRows(elements, questionText) {
  const lines = String(questionText || '')
    .split('\n')
    .map((line) => normalizeReviewText(line))
    .filter(Boolean);
  const rows = [];
  for (let index = 0; index < elements.length; index += 1) {
    const unit = elements[index];
    const isSelect = !!unit && String(unit.tagName || '').toUpperCase() === 'SELECT';
    const rowRoot = isSelect ? matchingRowRoot(unit) : unit;
    const selectEl = isSelect ? unit : (rowRoot && rowRoot.querySelector ? rowRoot.querySelector('select') : null);
    rows.push({
      rowIndex: index + 1,
      element: selectEl || unit,
      rowRoot,
      subStatement: cleanSubStatement(statementFromRowRoot(rowRoot, selectEl)),
    });
  }
  // Themes that render every statement inside .qtext still work: unused blank
  // lines are handed to rows whose own cell carried no prompt text.
  const used = new Set(rows.map((row) => normText(row.subStatement)).filter(Boolean));
  const spare = lines.filter((line) => BLANK_RE.test(line) && !used.has(normText(line)));
  let cursor = 0;
  for (const row of rows) {
    if (row.subStatement) continue;
    while (cursor < spare.length && used.has(normText(spare[cursor]))) cursor += 1;
    if (cursor >= spare.length) break;
    const statement = cleanSubStatement(spare[cursor]);
    cursor += 1;
    if (!statement || used.has(normText(statement))) continue;
    row.subStatement = statement;
    used.add(normText(statement));
  }
  const statements = new Set(rows.map((row) => normText(row.subStatement)).filter(Boolean));
  const header = lines.filter((line) => !statements.has(normText(line))).join(' ').slice(0, 300);
  return { rows, header };
}

// "also information security" is a different choice from "information
// security": a near-duplicate must never be used for a row that asks for the
// shorter phrase when the exact item is already taken.
function isNearDuplicateVariant(target, candidate) {
  if (!target || !candidate || target === candidate) return false;
  const targetWords = target.split(' ');
  const candidateWords = candidate.split(' ');
  if (targetWords.length >= candidateWords.length) return false;
  return targetWords.every((word) => candidateWords.includes(word));
}

// Map an item text onto the shared option list. `exclude` holds option indexes
// already taken by another row so a 1-to-1 assignment is preserved.
function matchingOptionIndex(text, options, exclude) {
  const target = normText(text);
  if (!target || !options || !options.length) return -1;
  const blocked = exclude || new Set();
  for (let index = 0; index < options.length; index += 1) {
    if (blocked.has(index)) continue;
    if (normText(options[index]) === target) return index;
  }
  let best = -1;
  let bestScore = 0;
  for (let index = 0; index < options.length; index += 1) {
    if (blocked.has(index)) continue;
    const candidate = normText(options[index]);
    if (!candidate || isNearDuplicateVariant(target, candidate)) continue;
    const score = similarity(target, candidate);
    if (score > bestScore) { best = index; bestScore = score; }
  }
  return best !== -1 && bestScore >= 0.8 ? best : -1;
}

// Item currently chosen in one dropdown, mapped back onto the shared list.
function currentMatchingOptionIndex(selectEl, options) {
  if (!selectEl || !selectEl.options || selectEl.selectedIndex < 0) return -1;
  const option = selectEl.options[selectEl.selectedIndex];
  if (!option || !option.value || option.value === '0') return -1;
  return matchingOptionIndex(option.text, options, new Set());
}

function setMatchingSelect(selectEl, optionText) {
  if (!selectEl || !selectEl.options) return false;
  const target = normText(optionText);
  if (!target) return false;
  let chosen = null;
  for (const option of selectEl.options) {
    if (!option.value || option.value === '0') continue;
    if (normText(option.text) === target) { chosen = option; break; }
  }
  if (!chosen) {
    let bestScore = 0;
    for (const option of selectEl.options) {
      if (!option.value || option.value === '0') continue;
      const candidate = normText(option.text);
      if (!candidate || isNearDuplicateVariant(target, candidate)) continue;
      const score = similarity(target, candidate);
      if (score > bestScore) { chosen = option; bestScore = score; }
    }
    if (bestScore < 0.72) chosen = null;
  }
  if (!chosen) return false;
  try {
    selectEl.value = chosen.value;
    selectEl.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  } catch (error) { return false; }
}

// A <select> only counts as answered when a real option is picked. Moodle's
// matching dropdowns put the "Choose..." placeholder at index 0, so `> 0` alone
// rejects it even when a theme gives the placeholder a non-empty value.
function isSelectAnswerChosen(selectEl) {
  if (!selectEl || selectEl.disabled) return false;
  if (typeof selectEl.selectedIndex !== 'number' || selectEl.selectedIndex <= 0) return false;
  const option = selectEl.options && selectEl.options[selectEl.selectedIndex] ? selectEl.options[selectEl.selectedIndex] : null;
  const value = String(selectEl.value || '');
  const selectedText = String(option ? (option.text || '') : '');
  return value !== '' && value !== '0' && value !== '-1' && !/^choose/i.test(selectedText);
}

// True when every enabled dropdown in a `.que` block already holds a valid
// answer (Text/Currency/Number/Paragraph Text/...). A block without any enabled
// dropdown has nothing this bot could fill, so it is not called complete here.
function allMatchingSelectsAnswered(containerOrSelects) {
  const selects = Array.isArray(containerOrSelects)
    ? containerOrSelects
    : matchingSelects(containerOrSelects);
  const enabled = selects.filter((select) => select && !select.disabled);
  if (!enabled.length) return false;
  return enabled.every(isSelectAnswerChosen);
}

function hasMatchingSelection(selectEl) {
  return isSelectAnswerChosen(selectEl);
}

// Rows answered by a Moodle-confirmed (verified: true) bank hit are filled
// first, keyed by their own sub-statement. Returns the answered row numbers.
async function fillMatchingFromBank(rows, options, used) {
  const filled = new Set();
  for (const row of rows) {
    if (!row.subStatement) continue;
    let hits = null;
    try { hits = await answerKeyGet(row.subStatement); }
    catch (error) { hits = null; }
    if (!hits || !hits.length) continue;
    for (const hit of hits) {
      if (!hit || hit.verified !== true || !hit.answer) continue;
      const index = matchingOptionIndex(hit.answer, options, used);
      if (index === -1) continue;
      if (!setMatchingSelect(row.element, options[index])) continue;
      used.add(index);
      filled.add(row.rowIndex);
      logHUD('success', 'Matched row ' + row.rowIndex + ': ' + options[index]);
      break;
    }
  }
  return filled;
}

function extractQuestionData() {
  const all = getQContainers();
  const ANSWERED = new Set(['correct','incorrect','partiallycorrect','answersaved','complete','finished','gradedwrong','gradedright']);
  // Fresh verdict for this scan: startLoop() reads it after a null result.
  _lastScanMatchingAnswered = false;
  let firstSkipReason = '';
  const noteFirstSkip = (reason) => { if (!firstSkipReason) firstSkipReason = reason; };
  const foundQuestion = (data) => { _lastExtractionWarning = ''; return data; };
  for (const c of all) {
    const cls = new Set((c.className||'').toLowerCase().split(' '));
    if ([...cls].some(x=>ANSWERED.has(x))) {
      noteFirstSkip('question is already answered or graded');
      continue;
    }
    const selects = cfg('MATCHING_ENABLED') ? matchingSelects(c) : [];
    if (selects.length) {
      // Every enabled dropdown already holds a real choice: the matching block
      // is done. Returning it again made startLoop() spin forever on the same
      // `.que` and never click Next.
      if (allMatchingSelectsAnswered(selects)) {
        _lastScanMatchingAnswered = true;
        noteFirstSkip('matching dropdowns are already answered');
        continue;
      }
      const items = [];
      for (const s of selects) { for (const o of s.options) { if (o.value && o.value !== '0' && !o.text.toLowerCase().startsWith('choose')) items.push(o.text.trim()); } }
      const uniq = [...new Set(items)];
      if (uniq.length < 2) {
        noteFirstSkip(`matching options=${uniq.length}; question text length=${qTxt(c).length}`);
        continue;
      }
      return foundQuestion({ text: qTxt(c), options: uniq, elements: selects, kind: 'select', images: [] });
    }
    const boxes = cfg('MULTI_ENABLED') ? Array.from(c.querySelectorAll('input[type="checkbox"]')) : [];
    if (boxes.length) {
      const r = xtractOpts(boxes);
      if (r.txts.length < 2) {
        noteFirstSkip(`checkbox option text count=${r.txts.length}; question text length=${qTxt(c).length}`);
        continue;
      }
      if (r.els.some(b => b.checked)) {
        noteFirstSkip('checkbox question already has a selection');
        continue;
      }
      return foundQuestion({ text: qTxt(c), options: r.txts, elements: r.els, kind: 'check', images: [] });
    }
    const rads = Array.from(c.querySelectorAll('input[type="radio"]'));
    if (rads.length) {
      const r = xtractOpts(rads);
      if (!r.txts.length && cfg('SHORT_ANSWER_ENABLED')) {
        const inputs = Array.from(c.querySelectorAll('input[type="text"], textarea')).filter(el => !el.readOnly && !el.disabled && !(el.name||'').startsWith('_qf') && !(el.name||'').startsWith('sesskey'));
        if (!inputs.length) {
          noteFirstSkip(`radio option text count=${r.txts.length}; no usable short-answer input`);
          continue;
        }
        const text = qTxt(c);
        if (!text) {
          noteFirstSkip('short-answer question text is empty');
          continue;
        }
        return foundQuestion({ text, options: [], elements: [inputs[0]], kind: 'text', images: [] });
      }
      if (r.txts.length < 2) {
        noteFirstSkip(`radio option text count=${r.txts.length}; question text length=${qTxt(c).length}`);
        continue;
      }
      if (r.els.some(r2 => r2.checked)) {
        noteFirstSkip('radio question already has a selection');
        continue;
      }
      return foundQuestion({ text: qTxt(c), options: r.txts, elements: r.els, kind: 'radio', images: [] });
    }
    if (cfg('SHORT_ANSWER_ENABLED')) {
      const inputs = Array.from(c.querySelectorAll('input[type="text"], textarea')).filter(el => !el.readOnly && !el.disabled && !(el.name||'').startsWith('_qf') && !(el.name||'').startsWith('sesskey'));
      if (!inputs.length) {
        noteFirstSkip('no supported radio, checkbox, select, or short-answer input');
        continue;
      }
      if (inputs.some(el => (el.value||'').trim())) {
        noteFirstSkip('short-answer input already has a value');
        continue;
      }
      const text = qTxt(c);
      if (!text) {
        noteFirstSkip('short-answer question text is empty');
        continue;
      }
      return foundQuestion({ text, options: [], elements: [inputs[0]], kind: 'text', images: [] });
    }
    noteFirstSkip('no supported unanswered question controls');
  }
  if (all.length && !isReviwPg()) {
    const first = all[0];
    const warning = `Skipped ${all.length} question container(s); first .que: ${firstSkipReason || 'no eligible question found'}; className="${String(first.className || '')}"; innerHTML="${String(first.innerHTML || '').slice(0,300)}"`;
    if (warning !== _lastExtractionWarning) {
      logHUD('warn', warning);
      _lastExtractionWarning = warning;
    }
  } else {
    _lastExtractionWarning = '';
  }
  return null;
}

function waitForManual(elements, kind, question = '', options = [], statements = []) {
  logHUD('warn', 'No AI answer (check API key/credits or select manually)');
  return new Promise((resolve) => {
    const deadline = Date.now() + 300000;
    let checkSelection = '';
    let checkChangedAt = 0;
    const saveManualAnswers = async () => {
      const answers = [];
      if (kind === 'radio' || kind === 'check') {
        for (let i = 0; i < elements.length; i++) {
          if (elements[i].checked) answers.push({ question, answer: options[i] || optTxt(elements[i]) });
        }
      } else if (kind === 'select') {
        for (let i = 0; i < elements.length; i++) {
          const select = elements[i];
          const option = select.options[select.selectedIndex];
          if (!option || !select.value || select.value === '0') continue;
          answers.push({ question: statements[i] || question, answer: option.text.trim() });
        }
      } else {
        const answer = (elements[0]?.value || '').trim();
        if (answer) answers.push({ question, answer });
      }
      for (const item of answers) {
        if (!item.question || !item.answer) continue;
        await learnCorrect(item.question, item.answer);
        logHUD('success', 'Saved manual answer to local question bank (will verify on review)');
      }
    };
    const ivl = setInterval(async () => {
      if (_stopRequested || Date.now() > deadline) {
        clearInterval(ivl);
        if (Date.now() > deadline) logHUD('warn','Manual timeout - continuing');
        resolve(false); return;
      }
      if (kind === 'radio' || kind === 'check') {
        const selected = elements.map((element) => element.checked ? '1' : '0').join('');
        if (selected !== checkSelection) {
          checkSelection = selected;
          checkChangedAt = Date.now();
        }
        const selectionReady = kind === 'radio'
          ? elements.some(e => e.checked)
          : elements.some(e => e.checked) && Date.now() - checkChangedAt >= 900;
        if (selectionReady) {
          clearInterval(ivl);
          try { await saveManualAnswers(); }
          catch (error) { logHUD('error', 'Could not save manual answer: ' + error.message); }
          resolve(true);
          return;
        }
      } else if (kind === 'select') {
        if (elements.some(e => e.value && e.value !== '' && e.value !== '0')) {
          clearInterval(ivl);
          try { await saveManualAnswers(); }
          catch (error) { logHUD('error', 'Could not save manual answer: ' + error.message); }
          resolve(true);
          return;
        }
      } else {
        if (elements.some(e => (e.value||'').trim())) {
          clearInterval(ivl);
          try { await saveManualAnswers(); }
          catch (error) { logHUD('error', 'Could not save manual answer: ' + error.message); }
          resolve(true);
          return;
        }
      }
    }, 500);
  });
}

async function clickNext() {
  try {
    window.scrollBy(0,500); await new Promise(r=>setTimeout(r,150));
    for (const sel of ['input[name="next"]','#mod_quiz-next-nav','button[name="next"]','button[name="nextbutton"]','input[value="Next page"]']) {
      const btn = document.querySelector(sel); if (btn) { btn.click(); return true; }
    }
    // Fallback: find any button whose text contains "Next"
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) { if (btn.textContent.trim().toLowerCase().includes('next')) { btn.click(); return true; } }
    return false;
  } catch(e) { return false; }
}

async function clickFinish() {
  try {
    for (const sel of ['#mod_quiz-finish-nav','input[value="Finish attempt"]']) {
      const btn = document.querySelector(sel); if (btn) { btn.click(); return true; }
    }
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) { if (btn.textContent.trim().toLowerCase().includes('finish attempt') || btn.textContent.trim().toLowerCase().includes('finish')) { btn.click(); return true; } }
    return false;
  } catch(e) { return false; }
}
// Extract clean option text for a (possibly disabled) review input. `doc` lets
// the same code run on a fetched showall=1 document, where `label[for=…]` must
// be looked up inside that document instead of the live page.
function reviewAnswerText(inputOrRow, doc) {
  const node0 = inputOrRow;
  const strip = (node) => cleanNodeText(node, 'script, style, .icon, .feedbackicon, .grade, .state, .questionflag, .accesshide, .answernumber, .feedbackimage');
  let input = null;
  if (node0 && node0.tagName === 'INPUT') input = node0;
  else if (node0 && node0.querySelector) input = node0.querySelector('input[type="radio"], input[type="checkbox"]');

  const lookupDoc = (input && input.ownerDocument) || (doc && doc.querySelector ? doc : document);
  let text = '';
  if (input) {
    const lbl = input.closest('label');
    if (lbl) text = strip(lbl);
    if (!text && input.id) {
      const id = (typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape(input.id) : input.id.replace(/"/g, '\\"');
      const forLabel = lookupDoc.querySelector('label[for="' + id + '"]');
      if (forLabel) text = strip(forLabel);
    }
  }
  if (!text && node0 && node0.closest) {
    const row = node0.closest('.r0, .r1, [class*="answer"] > div, .answer, .answercell, td');
    if (row) text = strip(row);
  }
  if (!text && input && input.parentElement) text = strip(input.parentElement);
  // Strip any leading option-letter prefix ("a.", "B)", ...) and trailing state words.
  text = text.replace(/^[A-Da-d][.)]\s*/, '').replace(/^[A-Da-d][.)]\s*/, '');
  text = text.replace(/\s*(?:Correct|Incorrect|Partially correct)\s*$/i, '');
  return normalizeReviewText(text);
}

// ── Row marks: Moodle's per-row check/cross indicators ──────────────────────
// Every theme renders them differently (fa icons, feedbackimage alt/title,
// `.text-success`/`.text-danger`, literal ✓/✗ characters), so the row itself and
// the whole row subtree are inspected. Crosses win over checks: a wrong row is
// never treated as verified.
function reviewMarkKind(node) {
  if (!node || node.nodeType !== 1) return '';
  const cls = String(node.className || '').toLowerCase();
  if (/\bincorrect\b|\btext-danger\b/.test(cls)) return 'wrong';
  if (/\bcorrect\b/.test(cls) && !/partiallycorrect/.test(cls)) return 'right';
  if (node.querySelector) {
    const wrong = node.querySelector(
      '.fa-remove, .fa-times, .fa-close, .fa-times-circle, ' +
      '.feedbackimage[alt*="Incorrect" i], .feedbackimage[title*="Incorrect" i], ' +
      'img[src*="cross" i], img[src*="incorrect" i], [title*="Incorrect" i], ' +
      '[aria-label*="Incorrect" i], .text-danger, svg[data-icon="times"], i[data-icon="times"]'
    );
    if (wrong) return 'wrong';
    const right = node.querySelector(
      '.fa-check, .fa-check-circle, .feedbackimage[alt*="Correct" i], ' +
      '.feedbackimage[title*="Correct" i], img[src*="tick" i], img[src*="correct" i], ' +
      'img[src*="check" i], [title*="Correct" i], [aria-label*="Correct" i], ' +
      '.text-success, svg[data-icon="check"], i[data-icon="check"]'
    );
    if (right) return 'right';
  }
  const text = String(node.textContent || '');
  if (/[✗✘✕✖]/.test(text)) return 'wrong';
  if (/[✓✔]/.test(text)) return 'right';
  return '';
}

// Row-level correctness on a matching review page: the feedback icon first
// (`title="Correct"` / fa-check), then the nearest marked ancestor. Matching
// rows carry their own state, so a partially correct block is still learnable.
function matchingRowIsCorrect(row) {
  const root = row && (row.rowRoot || row.element);
  if (!root) return false;
  const mark = reviewMarkKind(root);
  if (mark === 'right') return true;
  if (mark === 'wrong') return false;
  let node = root;
  let depth = 0;
  while (node && depth < 8) {
    const cls = String(node.className || '').toLowerCase();
    if (/\bpartiallycorrect\b|\bincorrect\b/.test(cls)) return false;
    if (/\bcorrect\b/.test(cls)) return true;
    if (/\bque\b/.test(cls)) break;
    node = node.parentElement;
    depth += 1;
  }
  return false;
}

function cleanRightAnswerText(value) {
  return normalizeReviewText(value)
    .replace(/^The (?:correct|right) answers? (?:is|are)\s*:?\s*/i, '')
    .replace(/^Correct answers?\s*:?\s*/i, '')
    .replace(/\.$/, '')
    .trim();
}

// Moodle's own "The correct answer is: ..." text inside one review row.
function matchingRowRightAnswer(row) {
  const root = row && (row.rowRoot || row.element);
  if (!root || !root.querySelector) return '';
  for (const node of root.querySelectorAll('.rightanswer, .correctanswer')) {
    const text = cleanRightAnswerText(node.textContent || '');
    if (text) return text;
  }
  return '';
}

// What the learner actually submitted for one row (live dropdown, disabled
// review dropdown, or the plain-text answer cell Moodle 4.x renders).
function matchingRowSelectedText(row) {
  const root = row && (row.rowRoot || row.element);
  const select = row && row.element && String(row.element.tagName || '').toUpperCase() === 'SELECT'
    ? row.element
    : (root && root.querySelector ? root.querySelector('select') : null);
  if (select && select.options && select.selectedIndex >= 0) {
    const option = select.options[select.selectedIndex];
    const text = option ? normalizeReviewText(option.text || '') : '';
    if (text && option.value && option.value !== '0' && !/^choose/i.test(text)) return text;
  }
  if (!root || !root.querySelectorAll) return '';
  const candidates = root.querySelectorAll(
    '.useranswer, .control .answer, .control span.answer, .answercell .answer, td.control'
  );
  for (const node of candidates) {
    const text = cleanNodeText(node, MATCH_STRIP_SELECTOR);
    if (text && !/^choose/i.test(text)) return text;
  }
  return '';
}

// Verified correct dropdown value for one review row, or '' when the row does
// not prove an answer (right answer hidden and the row is not marked correct).
function matchingRowCorrectText(row, containerCorrect) {
  const root = row && (row.rowRoot || row.element);
  if (!root) return '';
  const rightAnswer = matchingRowRightAnswer(row);
  if (rightAnswer) return rightAnswer;
  if (!matchingRowIsCorrect(row) && containerCorrect !== true) return '';
  return matchingRowSelectedText(row);
}

// Outcome of one radio/checkbox option row (`right`/`wrong`/''), used by the
// live review learner and the background review-page harvester.
function choiceRowOutcome(el, container) {
  let node = el;
  while (node && node !== container) {
    const classes = new Set(String(node.className || '').toLowerCase().split(/\s+/));
    if (classes.has('incorrect') || classes.has('partiallycorrect')) return 'wrong';
    if (classes.has('correct')) return 'right';
    node = node.parentElement;
  }
  return '';
}

// One matching block -> per-row analysis with iterative elimination.
//
// 1. Verified rows pin a statement to an option and remove it from the pool.
// 2. A row with exactly one still-unclaimed candidate (after dropping that
//    row's own confirmed-wrong submission) is deduced — this covers "N-1 rows
//    are known, the last one follows".
// 3. Two swapped rows are deduced together: each one's wrong submission is the
//    other's correct option.
//
// Deduction only runs when the option pool covers every row, so an incomplete
// review page (learner skipped rows) can never fabricate a verified pair.
function analyzeMatchingRows(container, containerCorrect) {
  const selects = matchingSelects(container);
  const rowEls = matchingRowElements(container);
  if (!selects.length && !rowEls.length) return null;
  const units = rowEls.length >= Math.max(2, selects.length) ? rowEls : selects;
  const { rows, header } = collectMatchingRows(units, qTxt(container));

  const options = [];
  const optionKeys = new Set();
  const addOption = (value) => {
    const text = normalizeReviewText(value);
    const key = normText(text);
    if (!text || !key || /^choose\b/i.test(text) || optionKeys.has(key)) return;
    optionKeys.add(key);
    options.push(text);
  };
  for (const select of selects) {
    for (const option of select.options || []) {
      if (!option || !option.value || option.value === '0') continue;
      addOption(option.text || '');
    }
  }

  const analyses = [];
  for (const row of rows) {
    const root = row.rowRoot || row.element;
    const selected = matchingRowSelectedText(row);
    const rightAnswer = matchingRowRightAnswer(row);
    const mark = root ? reviewMarkKind(root) : '';
    const rowIsWrong = mark === 'wrong';
    const rowIsCorrect = !rowIsWrong && (mark === 'right' || !!rightAnswer || containerCorrect === true);
    if (selected) addOption(selected);
    if (rightAnswer) addOption(rightAnswer);
    const answer = rowIsCorrect ? (rightAnswer || selected) : '';
    analyses.push({
      rowIndex: row.rowIndex,
      element: row.element,
      rowRoot: row.rowRoot,
      subStatement: row.subStatement,
      selected,
      rightAnswer,
      answer,
      rowIsWrong,
      verified: !!(rowIsCorrect && answer),
      deduced: false,
      wrongAnswers: rowIsWrong && selected ? [selected] : [],
    });
  }
  const usedByVerified = new Set(
    analyses.filter((row) => row.verified && row.answer).map((row) => normText(row.answer))
  );
  let remaining = options.filter((option) => !usedByVerified.has(normText(option)));

  if (options.length >= analyses.length) {
    let deducedAny = true;
    while (deducedAny) {
      deducedAny = false;
      // Single-candidate elimination.
      for (const row of analyses) {
        if (row.verified) continue;
        const blocked = new Set((row.wrongAnswers || []).map((wrong) => normText(wrong)));
        const candidates = remaining.filter((option) => !blocked.has(normText(option)));
        if (candidates.length !== 1) continue;
        row.answer = candidates[0];
        row.verified = true;
        row.deduced = true;
        remaining = remaining.filter((option) => normText(option) !== normText(candidates[0]));
        deducedAny = true;
        break;
      }
      if (deducedAny) continue;

      // 2-row swap deduction.
      const open = analyses.filter((row) => !row.verified);
      if (open.length !== 2 || remaining.length !== 2) continue;
      const [first, second] = open;
      const [firstChoice, secondChoice] = remaining;
      const firstWrong = new Set((first.wrongAnswers || []).map((wrong) => normText(wrong)));
      const secondWrong = new Set((second.wrongAnswers || []).map((wrong) => normText(wrong)));
      const a = normText(firstChoice);
      const b = normText(secondChoice);
      if (firstWrong.has(a) && secondWrong.has(b)) {
        first.answer = secondChoice;
        second.answer = firstChoice;
      } else if (firstWrong.has(b) && secondWrong.has(a)) {
        first.answer = firstChoice;
        second.answer = secondChoice;
      } else {
        continue;
      }
      first.verified = true;
      second.verified = true;
      first.deduced = true;
      second.deduced = true;
      remaining = [];
      deducedAny = true;
    }
  }

  return { rows: analyses, header, options, selects, rowEls };
}

// Save every graded matching pair under its own sub-statement (never under the
// shared "Match the term/details..." header) so the next attempt can fill the
// dropdowns straight from the local/GitHub bank. Deduced pairs are stored as
// verified too; wrong submissions are recorded as eliminated choices.
async function learnMatchingFromReview(container, containerCorrect, learned) {
  const analysis = analyzeMatchingRows(container, containerCorrect);
  if (!analysis) return 0;
  let saved = 0;
  const used = new Set();
  for (const row of analysis.rows) {
    if (!row.subStatement) continue;
    const key = normText(row.subStatement);
    if (!key || used.has(key)) continue;
    used.add(key);
    if (row.verified && row.answer) {
      try {
        // `learned.new` is what the review scanner reports as newly saved.
        const existing = await answerKeyGet(row.subStatement);
        const known = Array.isArray(existing) && existing.some(
          (hit) => hit && hit.verified === true && normText(hit.answer) === normText(row.answer)
        );
        await answerKeyPut(row.subStatement, row.answer, 'learned-review', { verified: true, replaceVerified: true });
        saved += 1;
        if (learned) {
          learned.right += 1;
          learned.matching = (learned.matching || 0) + 1;
          if (!known) learned.new = (learned.new || 0) + 1;
          if (row.deduced) learned.deduced = (learned.deduced || 0) + 1;
        }
        logHUD('success', 'Matching saved: row ' + row.rowIndex + (row.deduced ? ' (deduced)' : '') +
          ' -> ' + row.answer.slice(0, 40));
      } catch (error) {
        logHUD('warn', 'Could not save matching pair: ' + error.message);
      }
      continue;
    }
    // Only rows Moodle marked wrong prove an eliminated choice.
    for (const wrong of row.wrongAnswers || []) {
      if (!wrong) continue;
      try {
        await wrongSet(row.subStatement, wrong);
        if (learned) learned.wrong += 1;
      } catch (error) { /* the wrong cache is advisory */ }
    }
  }
  return saved;
}

// ── Manual-answer review evidence (all formats) ─────────────────────────────
// One review question -> the answers Moodle itself proved: disabled
// radio/checkbox rows, typed text, textarea responses and dropdowns. The same
// extractor runs on the live page and on a fetched showall=1 attempt.

function reviewContainersIn(root) {
  if (!root || !root.querySelectorAll) return [];
  return Array.from(root.querySelectorAll('.que'))
    .filter((que) => !que.parentElement || !que.parentElement.closest('.que'));
}

function reviewAnswerCollector(container) {
  const right = [];
  const wrong = [];
  const seen = new Set();
  const add = (list, value) => {
    const text = normalizeReviewText(value);
    const key = normText(text);
    if (!text || !key || seen.has(key)) return '';
    seen.add(key);
    list.push(text);
    return text;
  };
  return { right, wrong, add, optionOutcome: (el) => choiceRowOutcome(el, container) };
}

function reviewQuestionEvidence(container, containerCorrect) {
  const ev = reviewAnswerCollector(container);

  // 1) Authoritative correct-answer text rendered by Moodle.
  for (const node of container.querySelectorAll('.rightanswer')) {
    ev.add(ev.right, cleanRightAnswerText(node.textContent || node.innerText || ''));
  }

  // 2) Options the theme flagged correct: covers disabled inputs (every review
  //    page input is disabled) and unselected correct options of a multi-select.
  for (const input of container.querySelectorAll('input[type="radio"], input[type="checkbox"]')) {
    if (input.value === '-1') continue;
    if (ev.optionOutcome(input) !== 'right') continue;
    ev.add(ev.right, reviewAnswerText(input));
  }

  // 3) The learner's own checked answer(s). ":checked" matches even when the
  //    inputs are disabled, which is how Moodle 4.x renders a reviewed attempt.
  for (const input of container.querySelectorAll('input[type="radio"]:checked, input[type="checkbox"]:checked')) {
    if (input.value === '-1') continue;
    const text = reviewAnswerText(input);
    const outcome = ev.optionOutcome(input);
    if (outcome === 'right') { ev.add(ev.right, text); continue; }
    if (outcome === 'wrong') { ev.add(ev.wrong, text); continue; }
    if (containerCorrect === true) ev.add(ev.right, text);
    else if (containerCorrect === false) ev.add(ev.wrong, text);
  }
  return ev;
}

async function learnFromReviewRoot(root, learned) {
  const stats = learned || { right: 0, wrong: 0, matching: 0, deduced: 0, new: 0 };
  if (typeof stats.new !== 'number') stats.new = 0;
  for (const c of reviewContainersIn(root)) {
    const qText = qTxt(c);
    if (!qText) continue;
    const grade = parseGradeFromReview(c);
    const containerCorrect = grade && typeof grade.correct === 'boolean' ? grade.correct : null;

    // Matching questions are graded row by row: learn each (sub-statement,
    // verified option) pair instead of treating the block as one answer.
    if (isMatchingBlock(c) && (matchingSelects(c).length || matchingRowElements(c).length)) {
      await learnMatchingFromReview(c, containerCorrect, stats);
      continue;
    }

    const evidence = reviewQuestionEvidence(c, containerCorrect);

    // 4) Typed responses: input[type=text]/number value, or the plain-text
    //    answer Moodle renders for short answers and essays (textarea).
    const typed = c.querySelectorAll('input[type="text"], input[type="number"], textarea');
    for (const field of typed) {
      let answer = normalizeReviewText(field.value || '');
      if (!answer) {
        const plain = c.querySelector('.answer .qtext, .answer p, .answer, .rightanswer');
        if (plain) answer = cleanRightAnswerText(plain.textContent || '');
      }
      if (!answer) continue;
      const outcome = evidence.optionOutcome(field);
      if (outcome === 'right' || containerCorrect === true) evidence.add(evidence.right, answer);
      else if (outcome === 'wrong' || containerCorrect === false) evidence.add(evidence.wrong, answer);
    }

    // 5) Dropdowns outside a matching block: the option Moodle kept selected is
    //    the submitted answer, proven by a correct row / correct question (and
    //    only when Moodle did not already spell the right answer out above).
    if (!isMatchingBlock(c)) {
      for (const select of c.querySelectorAll('select')) {
        if (select.closest('.im-controls, .submitbtns, .submitbuttons, .quiznavigation')) continue;
        const option = select.options && select.selectedIndex >= 0 ? select.options[select.selectedIndex] : null;
        const selected = normalizeReviewText(option ? (option.text || '') : '');
        if (!selected || /^choose\b/i.test(selected)) continue;
        if (!select.value || select.value === '0') continue;
        const outcome = evidence.optionOutcome(select);
        if (outcome === 'right' || (containerCorrect === true && !evidence.right.length)) {
          evidence.add(evidence.right, selected);
        } else if (outcome === 'wrong') {
          evidence.add(evidence.wrong, selected);
        }
      }
    }

    // 6) Two-option / True-False: when the attempt was wrong (earned === 0), the
    //    opposite (unselected) option is the correct answer — save it as verified.
    if (grade && grade.earned === 0 && !evidence.right.length
        && !c.querySelector('input[type="checkbox"]')) {
      const optionInputs = Array.from(c.querySelectorAll('input[type="radio"], input[type="checkbox"]'))
        .filter((input) => input.value !== '-1');
      const optionTexts = [];
      for (const input of optionInputs) {
        const t = reviewAnswerText(input);
        if (t && !optionTexts.some((x) => normText(x) === normText(t))) optionTexts.push(t);
      }
      if (optionTexts.length === 2) {
        const selected = optionInputs
          .filter((input) => input.checked)
          .map((input) => reviewAnswerText(input))
          .filter(Boolean);
        if (selected.length === 1) {
          const other = optionTexts.find((t) => normText(t) !== normText(selected[0]));
          if (other) {
            evidence.add(evidence.right, other);
            stats.deduced += 1;
            logHUD('info', 'Deduced opposite answer for 2-option question: ' + other.slice(0, 40));
          }
        }
      }
    }

    const checkboxInputs = Array.from(c.querySelectorAll('input[type="checkbox"]'))
      .filter((input) => input.value !== '-1');
    const partialCheckbox = checkboxInputs.length > 0 && grade
      && grade.earned > 0 && grade.max > grade.earned;
    if (partialCheckbox) {
      const allChoices = [];
      const addChoice = (value) => {
        const text = normalizeReviewText(value);
        if (text && !allChoices.some((choice) => normText(choice) === normText(text))) allChoices.push(text);
      };
      checkboxInputs.forEach((input) => addChoice(reviewAnswerText(input)));
      const checkedChoices = [];
      for (const input of checkboxInputs.filter((item) => item.checked)) {
        const text = normalizeReviewText(reviewAnswerText(input));
        if (text && !checkedChoices.some((choice) => normText(choice) === normText(text))) checkedChoices.push(text);
      }
      const markedCorrect = checkboxInputs
        .filter((input) => input.checked && evidence.optionOutcome(input) === 'right')
        .map((input) => normalizeReviewText(reviewAnswerText(input)))
        .filter(Boolean);
      const markedUnique = markedCorrect.filter((answer, index, list) =>
        list.findIndex((other) => normText(other) === normText(answer)) === index
      );
      const reviewText = normalizeReviewText(c.innerText || c.textContent || '');
      const correctCountMatch = reviewText.match(/you have correctly selected\s+(\d+)/i);
      const correctlySelected = correctCountMatch
        ? Number(correctCountMatch[1])
        : markedUnique.length;
      const expectedTotal = correctlySelected > 0
        ? Math.round(correctlySelected * (grade.max / grade.earned))
        : 0;
      const selectedCorrect = correctCountMatch
        ? (markedUnique.length >= correctlySelected
          ? markedUnique.slice(0, correctlySelected)
          : checkedChoices.length === correctlySelected ? checkedChoices : [])
        : markedUnique;

      evidence.right.splice(0, evidence.right.length);
      if (expectedTotal > 0 && expectedTotal === checkboxInputs.length) {
        allChoices.forEach((choice) => evidence.add(evidence.right, choice));
        evidence.wrong.splice(0, evidence.wrong.length);
        logHUD('info', 'Partial-credit deduction: all ' + checkboxInputs.length + ' checkbox options are correct');
      } else {
        selectedCorrect.forEach((choice) => evidence.add(evidence.right, choice));
        const correctKeys = new Set(evidence.right.map((answer) => normText(answer)));
        for (let index = evidence.wrong.length - 1; index >= 0; index -= 1) {
          if (correctKeys.has(normText(evidence.wrong[index]))) evidence.wrong.splice(index, 1);
        }
        if (checkedChoices.length) {
          try {
            const signature = checkedChoices.map(normText).filter(Boolean).sort()
              .map((choice) => choice.length + ' ' + choice).join(' ');
            await wrongSet(qText, 'MULTISELECT PARTIAL COMBO ' + signature);
            stats.wrong += 1;
          } catch (error) {
            logHUD('warn', 'Could not record partial checkbox selection: ' + error.message);
          }
        }
      }
    }

    // Save with `{ verified: true, replaceVerified: true }`: a single-answer
    // question retires stale verified hits for its prompt, while a multi-select
    // question (2+ correct options) keeps every option so the next attempt can
    // tick them all.
    const replaceVerified = checkboxInputs.length === 0 && evidence.right.length === 1;
    for (const answer of evidence.right) {
      try {
        const existing = await answerKeyGet(qText);
        const known = Array.isArray(existing) && existing.some(
          (hit) => hit && hit.verified === true && normText(hit.answer) === normText(answer)
        );
        await answerKeyPut(qText, answer, 'learned-review', { verified: true, replaceVerified });
        stats.right += 1;
        if (!known) stats.new += 1;
      } catch (error) {
        logHUD('warn', 'Could not save review answer: ' + error.message);
      }
    }

    for (const answer of evidence.wrong) {
      try {
        await wrongSet(qText, answer);
        stats.wrong += 1;
      } catch (error) { /* the wrong cache is advisory */ }
    }
  }
  return stats;
}

// ── Review scanner: auto-run + full-attempt (showall=1) coverage ────────────
// Runs on every /mod/quiz/review.php load whether the bot is running, stopped,
// or the answers were entered by hand. Paginated attempts are fetched once as
// `?attempt=<id>&showall=1` so a single pass covers every question.

const REVIEW_SHOWALL_RE = /(?:[?&])showall=1(?:&|$)/;
const REVIEW_SCAN_SETTLE_MS = 1500;   // wait for late-rendered .que blocks
const REVIEW_SCAN_SETTLE_TRIES = 4;

function reviewAttemptId() {
  try {
    const attempt = new URLSearchParams(location.search || '').get('attempt');
    if (attempt) return attempt;
  } catch (error) { /* fall through to the regex */ }
  const match = String(location.search || '').match(/[?&]attempt=(\d+)/);
  return match ? match[1] : '';
}

function reviewShowsAll() {
  return REVIEW_SHOWALL_RE.test(String(location.search || '') + '&');
}

function reviewHasPagination() {
  try { return !!document.querySelector('a[href*="page="]'); } catch (error) { return false; }
}

function reviewShowAllUrl() {
  const attempt = reviewAttemptId();
  const query = attempt
    ? '?attempt=' + encodeURIComponent(attempt) + '&showall=1'
    : '?showall=1';
  return location.origin + location.pathname + query;
}

// Background fetch of the whole attempt (same-origin cookies included). A login
// page or an empty response yields null, so the live page is scanned instead.
async function fetchReviewDoc(url) {
  const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
  if (!response.ok) throw new Error('HTTP ' + response.status);
  const html = await response.text();
  if (!html || !/\bque\b/.test(html)) return null;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return reviewContainersIn(doc).length ? doc : null;
}

// Await the worker's GitHub sync so the scanner can report the outcome.
function syncGitHubBankNow() {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ action: 'SYNC_GITHUB_BANK' }, (resp) => {
        if (chrome.runtime.lastError) { resolve({ error: chrome.runtime.lastError.message }); return; }
        resolve(resp || {});
      });
    } catch (error) {
      resolve({ error: error.message });
    }
  });
}

let _reviewScanInFlight = false;

async function doReviewScan() {
  if (_reviewScanInFlight) return null;
  _reviewScanInFlight = true;
  try {
    return await doReviewScanUnlocked();
  } finally {
    _reviewScanInFlight = false;
  }
}

async function doReviewScanUnlocked() {
  const learned = { right: 0, wrong: 0, matching: 0, deduced: 0, new: 0 };
  logHUD('info', 'Review scan: checking all answers...');

  let root = document;
  if (!reviewShowsAll() && reviewHasPagination()) {
    try {
      const fullDoc = await fetchReviewDoc(reviewShowAllUrl());
      if (fullDoc) root = fullDoc;
      else logHUD('warn', 'Review scan: full attempt returned no questions, using this page');
    } catch (error) {
      logHUD('warn', 'Review scan: could not load the full attempt (' + error.message + ')');
    }
  }

  // Moodle may still be painting the .que blocks when the scan is triggered.
  for (let attempt = 0; attempt < REVIEW_SCAN_SETTLE_TRIES && !reviewContainersIn(root).length; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, REVIEW_SCAN_SETTLE_MS));
  }
  if (!reviewContainersIn(root).length) {
    logHUD('info', 'Review scan: no questions to check on this page');
    return learned;
  }

  await learnFromReviewRoot(root, learned);
  await flushNow();
  logHUD('success', 'Review scan: verified & saved ' + learned.right + ' answers (' + learned.new + ' new)');

  const sync = await syncGitHubBankNow();
  if (!sync || (!sync.status && !sync.error)) return learned;
  if (sync.error) {
    logHUD('warn', 'GitHub sync: ' + sync.error);
  } else if (sync.status === 'ok') {
    logHUD('success', learned.new > 0
      ? 'GitHub sync: +' + learned.new + ' pushed ✓'
      : 'GitHub sync: up to date ✓');
  } else if (sync.status === 'skipped') {
    logHUD('info', 'GitHub sync: skipped (GitHub bank not configured)');
  }
  return learned;
}

let _reviewScanHref = '';
let _reviewScanPromise = null;

// Deduplicated entry point: one scan per review URL. A reload re-scans, and the
// automatic boot scan and the bot loop share the same in-flight promise.
function runReviewScan(options) {
  const href = String(location.href || '');
  if (_reviewScanPromise && _reviewScanHref === href) return _reviewScanPromise;
  if (!(options && options.force) && _reviewScanHref === href) return Promise.resolve(null);
  _reviewScanHref = href;
  _reviewScanPromise = doReviewScan()
    .catch((error) => {
      logHUD('warn', 'Review scan failed: ' + error.message);
      return null;
    })
    .then((result) => {
      _reviewScanPromise = null;
      return result;
    });
  return _reviewScanPromise;
}

// Boot hook: review pages scan themselves — stopped or not, manual or not.
function maybeAutoReviewScan() {
  try {
    if (!isReviewPage()) return;
    setTimeout(() => { runReviewScan(); }, 1200);
  } catch (error) {
    logHUD('warn', 'Review scan could not start: ' + error.message);
  }
}

// ── Review-page answer extraction (live page + fetched grade pages) ─────────
// Extracts verified answers, matching pairs and eliminated wrong choices from
// one review document. Runs on the live review page and on DOMParser documents
// fetched in the background, so both paths learn exactly the same evidence.
function harvestAnswersFromReviewDoc(rootDoc, subjectCode, quizTitle, courseTitle = '') {
  const questions = [];
  if (!rootDoc || !rootDoc.querySelectorAll) return questions;
  const containers = Array.from(rootDoc.querySelectorAll('.que'))
    .filter((que) => !que.parentElement || !que.parentElement.closest('.que'));
  for (const que of containers) {
    const qText = qTxt(que);
    if (!qText) continue;
    const grade = parseGradeFromReview(que);
    const containerCorrect = grade && typeof grade.correct === 'boolean' ? grade.correct : null;
    const base = { quizTitle, courseTitle, subjectCode, evidenceType: 'moodle_review_elimination' };

    // Matching blocks are graded row by row; each verified/deduced pair is its
    // own bank entry keyed by the row's sub-statement.
    if (isMatchingBlock(que) && (matchingSelects(que).length || matchingRowElements(que).length)) {
      const analysis = analyzeMatchingRows(que, containerCorrect);
      if (!analysis) continue;
      for (const row of analysis.rows) {
        if (!row.subStatement) continue;
        const record = { question: row.subStatement, answer: '', verified: false, deduced: false, wrongAnswers: [], ...base };
        if (row.verified && row.answer) {
          record.answer = row.answer;
          record.verified = true;
          record.deduced = !!row.deduced;
          record.evidenceType = row.deduced ? 'elimination_deduction' : 'moodle_review';
        } else {
          record.wrongAnswers = (row.wrongAnswers || []).slice();
        }
        if (record.answer || record.wrongAnswers.length) questions.push(record);
      }
      continue;
    }

    const rightTexts = [];
    const wrongTexts = [];
    const choiceTexts = [];
    const addRight = (value) => {
      const text = normalizeReviewText(value);
      if (!text) return;
      if (!rightTexts.some((existing) => normText(existing) === normText(text))) rightTexts.push(text);
    };
    const addWrong = (value) => {
      const text = normalizeReviewText(value);
      if (!text) return;
      if (rightTexts.some((existing) => normText(existing) === normText(text))) return;
      if (!wrongTexts.some((existing) => normText(existing) === normText(text))) wrongTexts.push(text);
    };

    // 1) Moodle's authoritative correct-answer text.
    for (const node of que.querySelectorAll('.rightanswer, .correctanswer')) {
      const answer = cleanRightAnswerText(node.textContent || '');
      if (answer) addRight(answer);
    }

    // 2) Per-choice checkmarks/crosses and the learner's checked options.
    const inputs = Array.from(que.querySelectorAll('input[type="radio"], input[type="checkbox"]'))
      .filter((input) => input.value !== '-1');
    const checkedChoices = [];
    for (const input of inputs) {
      const text = reviewAnswerText(input);
      if (!text) continue;
      if (!choiceTexts.some((existing) => normText(existing) === normText(text))) choiceTexts.push(text);
      const mark = choiceRowOutcome(input, que) ||
        reviewMarkKind(input.closest('label') || input.parentElement || input);
      if (mark === 'wrong') addWrong(text);
      else if (mark === 'right') addRight(text);
      if (input.checked) checkedChoices.push({ text, mark });
    }

    // 3) Full marks prove the submitted choices; zero marks eliminate them.
    if (!rightTexts.length && containerCorrect === true) {
      checkedChoices.forEach((choice) => { if (choice.mark !== 'wrong') addRight(choice.text); });
    } else if (!rightTexts.length && (containerCorrect === false || (grade && grade.earned === 0))) {
      checkedChoices.forEach((choice) => { if (choice.mark !== 'right') addWrong(choice.text); });
    }

    // 3b) Review pages often render choices as text (disabled/no inputs). The
    // per-choice checkmark/cross still proves the answer or the elimination.
    const choiceRows = que.querySelectorAll(
      '.answer div.r0, .answer div.r1, .answer fieldset > div, .answer li, .answer tr, .answer label, .answer > div'
    );
    for (const row of choiceRows) {
      if (/(^|\s)(rightanswer|correctanswer)(\s|$)/i.test(String(row.className || ''))) continue;
      if (row.querySelector('.rightanswer, .correctanswer')) continue;
      const label = row.querySelector('label') || row;
      const text = cleanNodeText(label, 'input, button, .answernumber, .accesshide, .sr-only, .feedback, .feedbackspan, .feedbackimage, .icon, .state, .grade');
      if (!text || text.length < 2) continue;
      if (!choiceTexts.some((existing) => normText(existing) === normText(text))) choiceTexts.push(text);
      const mark = reviewMarkKind(row) || reviewMarkKind(label);
      if (mark === 'wrong') addWrong(text);
      else if (mark === 'right') addRight(text);
    }

    // 4) Typed responses (short answer / cloze).
    for (const input of que.querySelectorAll('input[type="text"], textarea')) {
      const value = normalizeReviewText(input.value || '');
      if (!value) continue;
      const outcome = choiceRowOutcome(input, que);
      if (outcome === 'right' || containerCorrect === true) addRight(value);
      else if (outcome === 'wrong' || containerCorrect === false) addWrong(value);
    }

    // 5) Review pages render a typed answer as text instead of a live input.
    if (!rightTexts.length && containerCorrect === true && !inputs.length) {
      const answerNode = que.querySelector('.answer > div:not(.rightanswer):not(.correctanswer), .answer p, .answer');
      const answer = answerNode
        ? cleanNodeText(answerNode, '.rightanswer, .correctanswer, .feedback, .state, .grade, .icon, .feedbackimage')
        : '';
      if (answer && !/^select one|^choose/i.test(answer)) addRight(answer);
    }

    // 6) Elimination: when every option but one is confirmed wrong.
    let deduced = false;
    if (!rightTexts.length && wrongTexts.length > 0 && choiceTexts.length > 1) {
      const remaining = choiceTexts.filter((choice) =>
        !wrongTexts.some((wrong) => normText(wrong) === normText(choice)));
      if (remaining.length === 1) {
        addRight(remaining[0]);
        deduced = true;
      }
    }

    const record = {
      question: qText,
      answer: rightTexts.join(', '),
      verified: rightTexts.length > 0,
      deduced,
      wrongAnswers: wrongTexts.filter((wrong) =>
        !rightTexts.some((right) => normText(right) === normText(wrong))),
      ...base,
    };
    record.evidenceType = deduced
      ? 'elimination_deduction'
      : (rightTexts.length ? 'moodle_review' : 'moodle_review_elimination');
    if (record.answer || record.wrongAnswers.length) questions.push(record);
  }
  return questions;
}

function subjectCodeFromText(value) {
  const match = String(value || '').match(/\b([A-Z]{2,6}\s*-?\s*\d{3,4}[A-Z]?)\b/);
  return match ? match[1].replace(/\s+/g, '').toUpperCase() : '';
}

// Fetch one quiz's review pages (showall=1, plus pagination when Moodle ignores
// it) and extract every question record.
async function harvestQuizReviewPages(quiz, subjectCode, courseTitle, seenQuestions) {
  const viewDoc = await fetchMoodleDocument(quiz.url);
  const queue = [];
  for (const link of viewDoc.querySelectorAll('a[href*="review.php"], a[href*="/mod/quiz/review.php"]')) {
    const href = link.getAttribute('href');
    if (!href) continue;
    try { queue.push(new URL(href, quiz.url).href); } catch (error) { /* ignore */ }
  }
  if (!queue.length && /\/mod\/quiz\/review\.php/i.test(quiz.url)) queue.push(quiz.url);
  const seenUrls = new Set();
  const records = [];
  for (let index = 0; index < queue.length && index < GRADES_HARVEST_MAX_REVIEW_PAGES; index += 1) {
    let reviewUrl = queue[index];
    try {
      const parsed = new URL(reviewUrl, quiz.url);
      parsed.searchParams.set('showall', '1');
      reviewUrl = parsed.href;
    } catch (error) { /* keep the raw URL */ }
    if (seenUrls.has(reviewUrl)) continue;
    seenUrls.add(reviewUrl);
    let reviewDoc = null;
    try {
      reviewDoc = await fetchMoodleDocument(reviewUrl);
    } catch (error) {
      logHUD('warn', 'Review fetch failed (' + quiz.title + '): ' + error.message);
      continue;
    }
    for (const record of harvestAnswersFromReviewDoc(reviewDoc, subjectCode, quiz.title, courseTitle)) {
      const key = normText(record.question);
      if (!key || seenQuestions.has(key)) continue;
      seenQuestions.add(key);
      records.push(record);
    }
    // Themes that ignore showall=1 expose follow-up review pages as links.
    for (const link of reviewDoc.querySelectorAll('a[href*="review.php"]')) {
      const href = link.getAttribute('href');
      if (!href) continue;
      let pageUrl = '';
      try {
        const parsed = new URL(href, quiz.url);
        parsed.searchParams.delete('showall');
        pageUrl = parsed.href;
      } catch (error) { continue; }
      if (!seenUrls.has(pageUrl) && !queue.includes(pageUrl)) queue.push(pageUrl);
    }
  }
  return records;
}

// Clicking Harvest (force) or opening a course/grades page (throttled to one
// scan per course per 6 h) reads the user grade report, fetches every completed
// quiz's review pages and merges verified answers + eliminated choices into the
// local bank, then pushes them to the GitHub `ama-quiz-bank`.
async function harvestCourseReviews(force = false) {
  if (_gradesHarvestRunning) {
    if (force) logHUD('warn', 'Course review harvest is already running');
    return { success: false, inProgress: true };
  }
  const pathname = location.pathname || '';
  if (!force && (pathname.includes('/mod/quiz/attempt.php') || pathname.includes('/mod/quiz/review.php'))) {
    return { success: false, skipped: true };
  }
  let courseInfo = null;
  try { courseInfo = await courseHarvestInfo(); } catch (error) { courseInfo = null; }
  const courseId = (courseInfo && courseInfo.courseId) || courseIdFromLocation();
  if (!courseId) {
    if (force) logHUD('warn', 'Open a Moodle course or grades page to harvest review answers.');
    return { success: false };
  }
  if (!force) {
    const stored = await chrome.storage.local.get('gradesHarvestMap');
    const history = stored.gradesHarvestMap && typeof stored.gradesHarvestMap === 'object'
      ? stored.gradesHarvestMap
      : {};
    const last = Number(history[courseId]) || 0;
    if (Date.now() - last < GRADES_HARVEST_COOLDOWN_MS) return { success: false, skipped: true };
    history[courseId] = Date.now();
    await chrome.storage.local.set({ gradesHarvestMap: history });
  }

  _gradesHarvestRunning = true;
  try {
    const courseTitle = (courseInfo && courseInfo.title) || '';
    const subjectCode = subjectCodeFromText(courseTitle) || courseTitle || ('course' + courseId);
    logHUD('info', 'Review harvest: scanning grade report for ' + (courseTitle || courseId) + '...');
    const gradesDoc = (pathname.includes('/grade/report/user/index.php') &&
      document.querySelector('.user-grade, table.generaltable, .generaltable'))
      ? document
      : await fetchMoodleDocument(gradesReportUrl(courseId));
    const quizzes = completedQuizzesFromGradesDoc(gradesDoc).slice(0, GRADES_HARVEST_MAX_QUIZZES);
    if (!quizzes.length) {
      logHUD('info', 'Review harvest: no completed quizzes found');
      return { success: false, quizzes: 0 };
    }
    const records = [];
    const seenQuestions = new Set();
    for (let index = 0; index < quizzes.length; index += 1) {
      // Disabled from the popup mid-run: stop walking the grade report at once.
      if (!_botEnabled) {
        logHUD('warn', 'Bot stopped — review harvest cancelled.');
        break;
      }
      const quiz = quizzes[index];
      logHUD('info', 'Review harvest [' + (index + 1) + '/' + quizzes.length + ']: ' + quiz.title);
      try {
        const extracted = await harvestQuizReviewPages(quiz, subjectCode, courseTitle, seenQuestions);
        for (const record of extracted) records.push(record);
      } catch (error) {
        logHUD('warn', 'Review harvest skipped ' + quiz.title + ': ' + error.message);
      }
    }
    const merged = await mergeHarvestedReviewRecords(records, subjectCode);
    if (merged.saved || merged.eliminated) {
      logHUD('success', 'Review harvest: ' + merged.saved + ' verified answer(s), ' +
        merged.eliminated + ' eliminated choice(s)' +
        (merged.deduced ? ', ' + merged.deduced + ' deduced' : '') +
        ' from ' + quizzes.length + ' quiz(zes)');
      requestGitHubBankPush();
    } else {
      logHUD('info', 'Review harvest: nothing new to save');
    }
    return { success: merged.saved > 0, quizzes: quizzes.length, ...merged };
  } catch (error) {
    logHUD('warn', 'Review harvest failed: ' + error.message);
    return { success: false, error: error.message };
  } finally {
    _gradesHarvestRunning = false;
  }
}


// Merge harvested review evidence into the local bank. Verified (and deduced)
// answers use `replaceVerified` so a newer Moodle result retires stale pairs;
// eliminated choices go to the wrong cache so future attempts never pick them.
async function mergeHarvestedReviewRecords(records, subjectCode) {
  const course = 'harvested-' + (normText(subjectCode).replace(/\s+/g, '') || 'reviews');
  let saved = 0;
  let deduced = 0;
  let eliminated = 0;
  for (const record of records || []) {
    const question = normalizeReviewText(record && record.question);
    if (!question) continue;
    const answer = normalizeReviewText(record.answer || '');
    if (answer) {
      await answerKeyPut(question, answer, course, { verified: true, replaceVerified: true });
      saved += 1;
      if (record.deduced) deduced += 1;
    }
    const answerParts = answer.split(',').map((part) => normText(part)).filter(Boolean);
    for (const wrong of record.wrongAnswers || []) {
      const text = normalizeReviewText(wrong);
      const wrongNorm = normText(text);
      if (!wrongNorm) continue;
      if (answerParts.some((part) => part === wrongNorm || similarity(part, wrongNorm) >= 0.95)) continue;
      await wrongSet(question, text);
      eliminated += 1;
    }
  }
  if (saved || eliminated) await flushNow();
  return { saved, deduced, eliminated };
}

// ── Background grades-report harvest (course / grades pages) ────────────────
const GRADES_HARVEST_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const GRADES_HARVEST_MAX_QUIZZES = 25;
const GRADES_HARVEST_MAX_REVIEW_PAGES = 40;
let _gradesHarvestRunning = false;

// Semester-aware Moodle base path: "/2612/course/view.php" -> "/2612".
function moodleBasePath() {
  const match = String(location.pathname || '').match(/^(.*?)\/(?:course|mod|grade|my|login|admin)(?:\/|$)/i);
  return match ? match[1] : '';
}

function gradesReportUrl(courseId) {
  return location.origin + moodleBasePath() + '/grade/report/user/index.php?id=' + encodeURIComponent(courseId);
}

function courseIdFromLocation() {
  const crumb = document.querySelector('.breadcrumb a[href*="/course/view.php"]');
  if (crumb) {
    const id = courseIdFromHref(crumb.href || crumb.getAttribute('href') || '');
    if (id) return id;
  }
  const gradesLink = document.querySelector('a[href*="/grade/report/user/index.php"]');
  if (gradesLink) {
    const id = courseIdFromHref(gradesLink.href || gradesLink.getAttribute('href') || '');
    if (id) return id;
  }
  const pathname = location.pathname || '';
  if (pathname.includes('/course/view.php') || pathname.includes('/grade/report/user/index.php')) {
    return new URLSearchParams(location.search).get('id') || '';
  }
  return '';
}

// A grade-report row is "completed" only when it carries a real score. Ranges
// ("0.00–100.00"), dashes and "( Empty )" never count.
function quizRowCompleted(row) {
  const usable = (text) => {
    const value = normalizeReviewText(text);
    if (!value || value === '-' || value === '–') return false;
    if (/\(\s*empty\s*\)/i.test(value)) return false;
    return /\d/.test(value);
  };
  const gradeCell = row.querySelector('.column-grade, td.grade, [headers*="grade" i]');
  if (gradeCell) {
    const text = normalizeReviewText(gradeCell.textContent);
    if (usable(text) && !/^0(?:\.0+)?\s*[–-]\s*\d/.test(text)) return true;
  }
  const pctCell = row.querySelector('.column-percentage, [headers*="percentage" i]');
  if (pctCell) {
    const text = normalizeReviewText(pctCell.textContent);
    if (usable(text) && !/^0(?:\.0+)?\s*%?$/.test(text)) return true;
  }
  for (const cell of row.querySelectorAll('td')) {
    if (cell.querySelector('a[href*="/mod/quiz/"]')) continue;
    const text = normalizeReviewText(cell.textContent);
    if (!usable(text)) continue;
    if (/^0(?:\.0+)?\s*%?$/.test(text)) continue;
    if (/^0(?:\.0+)?\s*[–-]\s*\d/.test(text)) continue;
    return true;
  }
  return false;
}

// Completed quizzes in a grade-report document (view.php links with a score).
function completedQuizzesFromGradesDoc(gradesDoc) {
  const quizzes = [];
  const seen = new Set();
  if (!gradesDoc || !gradesDoc.querySelectorAll) return quizzes;
  const rows = Array.from(gradesDoc.querySelectorAll('.user-grade tr, table.generaltable tr, table.table tr, tr'));
  for (const row of rows) {
    const link = row.querySelector('a[href*="/mod/quiz/view.php"], a[href*="/mod/quiz/"]');
    if (!link) continue;
    const href = link.getAttribute('href') || '';
    if (!href || href.includes('attempt.php') || href.includes('review.php')) continue;
    const title = normalizeReviewText(link.textContent || '');
    if (!title) continue;
    let url = '';
    try { url = new URL(href, location.origin).href; } catch (error) { continue; }
    if (seen.has(url) || !quizRowCompleted(row)) continue;
    seen.add(url);
    quizzes.push({ title: title.replace(/^QUIZ\s+/i, '').trim() || title, url });
  }
  return quizzes;
}

async function fetchMoodleDocument(url, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { credentials: 'include', signal: controller.signal });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    return new DOMParser().parseFromString(await response.text(), 'text/html');
  } finally {
    clearTimeout(timer);
  }
}


async function selectAnswer(selectEl, optionText) {

  try {
    let bestVal = null, bestScore = 0;
    for (const o of selectEl.options) {
      if (!o.value || o.value === '0') continue;
      const s = similarity(optionText.toLowerCase(), o.text.toLowerCase());
      if (s > bestScore) { bestVal = o.value; bestScore = s; }
    }
    if (!bestVal || bestScore < 0.45) return false;
    selectEl.value = bestVal;
    selectEl.dispatchEvent(new Event('change', {bubbles:true}));
    return true;
  } catch(e) { return false; }
}

function typeAnswer(element, text) {
  try {
    element.focus();
    element.value = text;
    element.dispatchEvent(new Event('input', {bubbles:true}));
    element.dispatchEvent(new Event('change', {bubbles:true}));
    element.dispatchEvent(new Event('blur', {bubbles:true}));
    return true;
  } catch(e) { return false; }
}

async function submitAttempt() {
  const sel = ['#id_submitbutton','input[value="Submit all and finish"]','button[name="submitbutton"]'];
  for (const s of sel) {
    const btn = document.querySelector(s);
    if (btn) { btn.click(); return true; }
  }
  const buttons = document.querySelectorAll('button');
  for (const btn of buttons) { if (btn.textContent.trim().toLowerCase().includes('submit all and finish')) { btn.click(); return true; } }
  return false;
}
// Build a predicate that flags options matching a stored (known-wrong) answer.
async function buildWrongOptionFilter(qText, options) {
  const wrong = await getWrongAnswers(qText);
  const set = new Set((wrong || [])
    .map((w) => normText(w))
    .filter((value) => value && !value.startsWith('multiselect partial ')));
  return (option) => {
    const on = normText(option);
    if (!on) return false;
    if (set.has(on)) return true;
    for (const w of set) if (similarity(on, w) >= 0.9) return true;
    return false;
  };
}

// Return `preferIdx` unless it maps to a known-wrong option, else the first allowed one.
function firstAllowedOption(options, isWrong, preferIdx) {
  if (preferIdx >= 0 && preferIdx < options.length && !isWrong(options[preferIdx])) return preferIdx;
  for (let i = 0; i < options.length; i++) if (!isWrong(options[i])) return i;
  return preferIdx;
}

// Local-bank matches: hits flagged wrong (or whose answer/option is stored as
// wrong) are strictly excluded, and `verified: true` hits always sort first so
// Tier 1 can only ever click an answer Moodle already confirmed.
function rankLocalMatches(matches, isWrong) {
  const allowed = (matches || []).filter((match) =>
    match && match.wrong !== true && !isWrong(match.option) && !isWrong(match.answer));
  return allowed.sort((a, b) => (b.verified === true ? 1 : 0) - (a.verified === true ? 1 : 0));
}

async function handleQuestion(data) {
  const { text, options, elements, kind, images } = data;
  const qkey = elemSig(elements);
  logHUD('info', 'Q: '+text.slice(0,80));

  // Review page grade detection: when user clicks Run on /mod/quiz/review.php
  if(isReviewPage()){
    const container = (elements && elements[0] && elements[0].closest) ? elements[0].closest('.que') : null;
    const scope = container || document;
    const grade = parseGradeFromReview(scope);
    if(grade){
      const gradeLabel = (grade.earned == null ? '?' : grade.earned) + '/' + (grade.max == null ? '?' : grade.max);
      if(grade.correct === true && kind !== 'select'){
        // Matching blocks are learned per dropdown row further down (and on the
        // review pass) — saving the first row's `.rightanswer` under the shared
        // header would store one pair for the whole block.
        // Prefer the per-question correct-answer block; fall back to a ".correct" option.
        const questionElem = scope.querySelector('.qtext, .question, .questiontext') || scope;
        const questionText = normalizeReviewText(questionElem ? (questionElem.innerText || questionElem.textContent) : '');
        const answerElem = scope.querySelector('.rightanswer, .correctanswer, .answ .correct, .correct');
        const answerText = normalizeReviewText(answerElem ? (answerElem.innerText || answerElem.textContent) : '')
          .replace(/^The correct answer is\s*:\s*/i, '');
        if(questionText && answerText){
          const saved = await saveCorrectAnswerFromReview(questionText, answerText);
          logHUD('success', 'Grade detected: '+gradeLabel+' - '+(saved ? 'Saved answer permanently' : 'Answer already known'));
          if(saved){ await flushNow(); requestGitHubBankPush(); }
        }
      }else if(grade.correct === false){
        logHUD('info', 'Grade detected: '+gradeLabel+' - Answer was incorrect, not saved');
      }
    }
    // Continue with normal question handling after grade processing
  }

  if (kind === 'select') {
    // One `.que.match` block = many dropdown rows sharing one item list. Each
    // row is keyed by its own sub-statement; unanswered rows are resolved by a
    // single batch AI request instead of one call per dropdown.
    const { rows, header } = collectMatchingRows(elements, text);
    const statements = rows.map((row) => row.subStatement);
    const container = elements[0] && elements[0].closest ? elements[0].closest('.que') : null;

    if (!isMatchingBlock(container)) {
      // Inline dropdown blanks ("select missing word") are not rows: keep the
      // legacy resolver, but still log each pair under its row number.
      const n = elements.length;
      const legacy = await resolveMatching(header, statements, options, n);
      if (legacy.keyed + legacy.aiMatched === 0) {
        logHUD('warn','Waiting for manual dropdowns...');
        const ok = await waitForManual(elements, 'select', text, options, statements);
        if (!ok) logHUD('warn','Manual dropdown timeout');
        return ok;
      }
      for (let i = 0; i < n; i++) {
        if (legacy.idxs[i] === -1) continue;
        if (runCancelled()) return false;
        await selectAnswer(elements[i], options[legacy.idxs[i]]);
        logHUD('info', 'Matched row ' + (i + 1) + ': ' + options[legacy.idxs[i]]);
      }
      return true;
    }

    const unanswered = rows.filter((row) => !hasMatchingSelection(row.element));
    if (!unanswered.length) {
      logHUD('info', 'Matching question already answered');
      return true;
    }
    // Items already chosen by the learner are off-limits for the remaining rows.
    const used = new Set();
    for (const row of rows) {
      if (!hasMatchingSelection(row.element)) continue;
      const index = currentMatchingOptionIndex(row.element, options);
      if (index !== -1) used.add(index);
    }
    const filled = await fillMatchingFromBank(unanswered, options, used);
    const pending = unanswered.filter((row) => !filled.has(row.rowIndex));
    if (!pending.length) return true;

    let aiMatched = 0;
    try {
      const batch = await resolveMatchingBatch(
        pending.map((row) => ({ rowIndex: row.rowIndex, subStatement: row.subStatement })),
        options,
        header
      );
      const assignments = (batch && batch.assignments) || {};
      for (const row of pending) {
        if (runCancelled()) return false;
        const answer = assignments[String(row.rowIndex)];
        if (!answer) continue;
        const index = matchingOptionIndex(answer, options, used);
        if (index === -1) continue;
        if (!setMatchingSelect(row.element, options[index])) continue;
        used.add(index);
        aiMatched += 1;
        logHUD('success', 'Matched row ' + row.rowIndex + ': ' + options[index]);
      }
      if (aiMatched > 0) {
        logHUD('info', 'Matching batch: ' + aiMatched + '/' + pending.length + ' dropdown(s) resolved in one request');
      }
    } catch (error) {
      logHUD('warn', 'Matching batch failed: ' + error.message);
    }

    if (filled.size + aiMatched === 0) {
      logHUD('warn','Waiting for manual dropdowns...');
      const ok = await waitForManual(elements, 'select', text, options, statements);
      if (!ok) logHUD('warn','Manual dropdown timeout');
      return ok;
    }
    return true;
  }

  if (kind === 'check') {
    const isWrong = await buildWrongOptionFilter(text, options);
    const previousWrong = await getWrongAnswers(text);
    const localMatches = rankLocalMatches(await localBankOptionMatches(text, options), isWrong)
      .filter((match) => match.verified === true);
    if (runCancelled()) return false; // Stop / Run / Disable while we were thinking
    if (localMatches.length >= 2 && !previousWrong.length) {
      for (const match of localMatches) {
        if (runCancelled()) return false;
        const element = elements[match.index];
        if (element && !element.checked) element.click();
        logHUD('info', 'Tier 1 (Verified Bank): ' + match.option);
      }
      return true;
    }
    let picks = await askAiMultiSelect(text, options);
    if (runCancelled()) return false;
    picks = (picks || []).filter((p) => p >= 0 && p < options.length && !isWrong(options[p]));
    if (!picks.length) {
      logHUD('warn','Waiting for manual checkboxes...');
      const ok = await waitForManual(elements, 'check', text, options);
      if (!ok) logHUD('warn','Manual checkbox timeout');
      return ok;
    }
    for (const p of picks) {
      if (runCancelled()) return false;
      if (p < elements.length && !elements[p].checked) {
        elements[p].click();
        logHUD('info', 'Ticked '+(p+1));
      }
    }
    return true;
  }

  if (kind === 'text') {
    const ans = await askAiText(text);
    if (runCancelled()) return false; // never type into a page after Stop
    if (!ans) {
      logHUD('warn','Waiting for manual text input...');
      const ok = await waitForManual(elements, 'text', text);
      if (!ok) logHUD('warn','Manual text timeout');
      return ok;
    }
    typeAnswer(elements[0], ans);
    logHUD('success', 'Typed: '+ans.slice(0,60));
    return true;
  }

  // Radio / MCQ
  const isWrong = await buildWrongOptionFilter(text, options);
  const localMatches = rankLocalMatches(await localBankOptionMatches(text, options), isWrong);
  if (runCancelled()) return false;
  if (localMatches.length) {
    const match = localMatches[0];
    if (elements[match.index]) elements[match.index].click();
    logHUD('info', 'Tier 1 (Local Bank): ' + match.option);
    return true;
  }
  let idx = await askAi(text, options, images);
  if (runCancelled()) return false; // Stop pressed while the AI was thinking
  // Safety net: never click a stored-wrong option even if a provider returns one.
  if (idx !== -1 && isWrong(options[idx])) idx = firstAllowedOption(options, isWrong, idx);
  if (idx === -1) {
    logHUD('warn','Waiting for manual selection...');
    const ok = await waitForManual(elements, 'radio', text, options);
    if (!ok) logHUD('warn','Manual selection timeout');
    return ok;
  }
  if (idx < elements.length) {
    elements[idx].click();
    logHUD('success', 'Option '+(idx+1)+': '+options[idx].slice(0,60));
  }
  return true;
}

// Stable per-question key used by startLoop()'s attempt guard: Moodle's
// `.que` id (e.g. "question-123-4") when present, otherwise the same signature
// the answered-question set uses.
function questionIdFromData(data) {
  const first = data && data.elements && data.elements[0];
  let container = null;
  try { container = first && first.closest ? first.closest('div.que') : null; }
  catch (error) { container = null; }
  return (container && container.id) || elemSig(data && data.elements) || normText(String((data && data.text) || '')).slice(0, 120);
}

// How many controls of the current question still need an answer. A count that
// does not grow between scans means the bot is no longer making progress.
function countEmptyControls(data) {
  const els = data && data.elements;
  if (!els || !els.length) return 0;
  if (data.kind === 'select') return els.filter((select) => !select.disabled && !isSelectAnswerChosen(select)).length;
  if (data.kind === 'text') return els.filter((el) => !(el.value || '').trim()).length;
  return els.filter((el) => !el.checked && !el.disabled).length;
}

async function startLoop() {
  if (_loopActive) return;
  // Reserve the lock before the first await so two clicks can never start two
  // loops, then own the run through a generation token.
  _loopActive = true;
  _stopRequested = false;
  const token = ++_runToken;
  try {
    await ensureLoaded();
    await loadConfig();
    if (!(await readBotEnabledAsync())) {
      _botEnabled = false;
      setHudVisible(false);
      logHUD('error', 'Bot disabled in settings');
      return;
    }
    _botEnabled = true;
    _activeRunToken = token;
    setHUDStatus('running');
    createHUD();
    setHudVisible(true);
    logHUD('info', 'Bot started.');
    _hudRoot?.classList?.add('active');

    const handledQuestions = new Set();
    // Per-question attempt guard: the exact same `.que` id processed more than
    // twice in a row without new empty controls is marked done for this page
    // pass so startLoop() cannot spin on it forever.
    const attemptsByQuestionId = new Map();
    let lastQuestionId = '';
    let lastAdvanceAttemptAt = 0;
    let totalAnswered = 0;
    let emptyScans = 0;
    let stalls = 0;
    let reviewPageHandled = '';
    const startTime = Date.now();
    const maxRun = 8 * 60 * 60 * 1000;

    while (!_stopRequested && token === _runToken) {
      if (Date.now() - startTime > maxRun) {
        logHUD('error', '8-hour max runtime reached');
        break;
      }
      await new Promise(r => setTimeout(r, cfg('SCAN_INTERVAL')));
      if (token !== _runToken) break; // Stop was pressed while we waited
      if (isReviwPg()) {
        const pageId = typeof location === 'undefined' ? 'review' : location.href;
        if (pageId !== reviewPageHandled) {
          reviewPageHandled = pageId;
          try {
            // Shared with the boot-time auto scan: one deduplicated pass that
            // learns every verified answer, then reports the GitHub sync.
            await runReviewScan();
          } catch (error) {
            logHUD('error', 'Review page learning failed: ' + error.message);
          }
        }
        continue;
      }
      reviewPageHandled = '';
      if (!isQuizPg()) {
        emptyScans++;
        if (emptyScans > 30 && totalAnswered > 0) {
          logHUD('info', 'No quiz page - idle');
        }
        continue;
      }

      try {
        const data = extractQuestionData();
        if (!data) {
          emptyScans++;
          // `_lastScanMatchingAnswered`: the only matching blocks left have all
          // their dropdowns filled, so advance even if this run answered none of
          // them (Run pressed on a page whose dropdowns were already complete).
          if (_lastScanMatchingAnswered || (emptyScans >= 6 && totalAnswered > 0)) {
            // Throttle log+click: a missing Next button must not spam the HUD.
            if (Date.now() - lastAdvanceAttemptAt >= 1500) {
              lastAdvanceAttemptAt = Date.now();
              logHUD('info', 'All answered — advancing');
              const ok = cfg('AUTO_CLICK_NEXT') ? await clickNext() : false;
              if (!ok) await clickFinish();
            }
            handledQuestions.clear();
            attemptsByQuestionId.clear();
            lastQuestionId = '';
          }
          continue;
        }
        emptyScans = 0;
        totalAnswered++;
        addResultEntry(data.text, '', '', '');

        // Loop guard: count consecutive extractions of the exact same question.
        // More than two passes with no new empty inputs means no progress, so
        // mark it done for this page pass and advance instead of logging again.
        const qid = questionIdFromData(data);
        const emptyCount = countEmptyControls(data);
        const previousAttempt = attemptsByQuestionId.get(qid);
        const attempts = (previousAttempt ? previousAttempt.attempts : 0) + 1;
        const noNewEmptyInputs = !!previousAttempt && emptyCount >= previousAttempt.empty;
        attemptsByQuestionId.set(qid, { attempts, empty: emptyCount });
        if (previousAttempt && qid === lastQuestionId && attempts > 2 && noNewEmptyInputs) {
          if (Date.now() - lastAdvanceAttemptAt >= 1500) {
            lastAdvanceAttemptAt = Date.now();
            logHUD('info', 'All answered — advancing');
            const ok = cfg('AUTO_CLICK_NEXT') ? await clickNext() : false;
            if (!ok) await clickFinish();
          }
          handledQuestions.clear();
          attemptsByQuestionId.clear();
          lastQuestionId = '';
          continue;
        }
        lastQuestionId = qid;

        const sig = elemSig(data.elements);
        if (handledQuestions.has(sig)) continue;
        handledQuestions.add(sig);

        const ok = await handleQuestion(data);
        if (token !== _runToken) break; // cancelled mid-question: drop the result
        if (!ok && data.kind !== 'select') {
          stalls++;
          if (stalls > 5) {
            logHUD('warn', 'Too many stalls - advancing');
            stalls = 0;
          }
        } else {
          stalls = 0;
        }

        if (cfg('PAUSE_AFTER_ANSWER') > 0) await new Promise(r => setTimeout(r, cfg('PAUSE_AFTER_ANSWER')));
      } catch (e) {
        logHUD('error', 'Error: '+e.message.slice(0,100));
      }
    }
  } finally {
    // Only the newest run may publish the stopped state: a cancelled loop that
    // was parked in a long await must never clear a fresh run's lock.
    if (token === _runToken) {
      _loopActive = false;
      _stopRequested = true;
      setHUDStatus('stopped');
      if (_hudRoot) _hudRoot.classList.remove('active');
      if (_botEnabled) logHUD('info', 'Bot stopped.');
    }
  }
}

// Auto-start when DOM is ready. BOT_ENABLED is read first: a disabled bot must
// not auto-harvest or start the loop on any open tab — but review pages still
// learn themselves (that pass only reads the page and saves verified answers,
// exactly as before the switch existed).
let _bootRan = false;
function bootBot() {
  if (_bootRan) return;
  _bootRan = true;
  createHUD();
  logHUD('info', 'Moodle Quiz Bot loaded');
  watchBotEnabled();
  maybeAutoReviewScan();
  readBotEnabled((enabled) => {
    applyBotEnabled(enabled, true);
    if (!enabled) return;
    setHudVisible(true);
    startAutoHarvest();
    startLoop();
  });
}

document.addEventListener('DOMContentLoaded', bootBot);

// Also try immediate start (the document is often already idle when the content
// script is injected, so DOMContentLoaded has already fired).
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  loadConfig().then(bootBot);
}


  window.__qbTmBankStorage = { mergeRemoteBankIntoLocal, answerKeyGetAll, flushNow };
  window.__qbTmReloadConfig = loadConfig;
  const qbTmMoodleGearTimer = setInterval(() => {
    try {
      if (typeof _hudShadow !== 'undefined' && _hudShadow) {
        qbTmAddGearButton(_hudShadow.getElementById('hud-header'));
        clearInterval(qbTmMoodleGearTimer);
      }
    } catch (error) { console.warn('[Quiz Bot] Could not add settings gear:', error); }
  }, 250);
  })();
} else {
  (function () {

;
// ─────────────────────────────────────────────────────────────────────────────
//  CONFIG — defaults + chrome.storage.sync overlay
//  Ported verbatim from bot.py + answerkey.py environment variables.
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULTS = Object.freeze({
  // Moodle
  MOODLE_URL: 'https://amaes.com',

  // FreeLLMAPI / Custom OpenAI-compatible endpoint
  CUSTOM_API_BASE_URL: 'https://api.freellmapi.com/v1',
  CUSTOM_API_KEY: '',
  CUSTOM_MODEL: 'auto',

  // GitHub Question Bank
  GITHUB_BANK_OWNER: '',
  GITHUB_BANK_REPO: '',
  GITHUB_BANK_PATH: 'bank.json',
  GITHUB_SYNC_TOKEN: '',
  // Legacy alias. The options page writes `GITHUB_SYNC_TOKEN`; the sync code
  // accepts either (the primary key wins) so older saved settings keep working.
  GITHUB_BANK_TOKEN: '',

  // OpenRouter
  OPENROUTER_API_KEY: '',
  OPENROUTER_MODEL: 'deepseek/deepseek-v4.1-flash',
  OPENROUTER_VISION_MODEL: '',
  OPENROUTER_COOLDOWN: 180,
  OPENROUTER_API_URL: 'https://openrouter.ai/api/v1/chat/completions',
  OPENROUTER_WEB_ENABLED: false, // web plugin is billed per search; off = much cheaper

  // Gemini (`GEMINI_API_KEY` accepts comma/newline separated backup keys)
  GEMINI_API_KEY: '',
  GEMINI_MODEL: 'gemini-3.8-flash',
  GEMINI_KEY_COOLDOWN: 180,

  // Ollama
  OLLAMA_URL: 'http://127.0.0.1:11434',
  OLLAMA_MODEL: 'qwen2.5:7b',
  OLLAMA_VISION_MODEL: '',
  OLLAMA_API_KEY: '',
  OLLAMA_NUM_CTX: 4096,
  OLLAMA_KEEP_ALIVE: '10m',
  OLLAMA_TIMEOUT_MS: 60000,

  // Behaviour
  PAUSE_AFTER_ANSWER: 300,
  PAUSE_AFTER_NEXT: 500,
  AUTO_CLICK_NEXT: true,
  AUTO_SUBMIT: true,
  SCAN_INTERVAL: 300,
  NAV_WAIT_MS: 900,
  MAX_SUBMIT_TRIES: 4,
  AUTO_REATTEMPT: false,

  // Short-answer
  SHORT_ANSWER_ENABLED: true,
  TYPE_DELAY_MS: 8,
  MAX_TEXT_RETRIES: 2,
  TYPE_ON_FAILURE: true,

  // Multi-answer
  MULTI_ENABLED: true,
  MULTI_MAX_PICKS: 4,

  // Matching
  MATCHING_ENABLED: true,
  MATCHING_MIN_MATCHED: 0.6,
  MATCHING_OPTION_FLOOR: 0.45,

  // True/False
  BOOL_QUESTION_MIN_SCORE: 0.55,

  // Vision
  VISION_ENABLED: true,
  MAX_QUESTION_IMAGES: 2,

  // Answer key (amauoed.com)
  ANSWER_KEY_ENABLED: true,
  ANSWER_KEY_TIMEOUT: 4,
  ANSWER_KEY_MIN_SCORE: 0.72,
  ANSWER_KEY_TEXT_MIN_SCORE: 0.82,
  ANSWER_KEY_MATCH_MIN_SCORE: 0.8,
  ANSWER_KEY_MAX_HITS: 4,

  // Web search
  WEB_SEARCH_ENABLED: true,
  WEB_SEARCH_MAX_RESULTS: 3,
  WEB_SEARCH_DOMAINS: 'amauoed.com,studocu.com,coursehero.com,docsity.com',

  // Limits
  MAX_Q_CHARS: 1200,
  WEB_Q_CHARS: 380,
  MAX_RUN_HOURS: 8,
  MANUAL_TIMEOUT: 300,

  // Answer key cache
  CACHE_TTL: 0,
  CACHE_MAX: 50000,

  // Extension specific
  BOT_ENABLED: true,
});

const PLACEHOLDER_RE = /answer\s*\d+\s*[\.\)]?\s*question\s*\d+/gi;

// In-memory merged config.
let _merged = { ...DEFAULTS };

/**
 * Load settings from chrome.storage.sync and merge with defaults.
 * Called once at startup by background.js and content.js.
 */
async function loadConfig() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(null, (items) => {
      if (chrome.runtime.lastError) {
        console.warn('[config] storage.sync error:', chrome.runtime.lastError.message);
        resolve({ ...DEFAULTS });
        return { ...DEFAULTS };
      }
      _merged = { ...DEFAULTS };
      for (const [k, v] of Object.entries(items)) {
        if (k in DEFAULTS && v !== undefined && v !== null) {
          _merged[k] = v;
        }
      }
      const geminiModel = String(_merged.GEMINI_MODEL || '').trim();
      if (!geminiModel || geminiModel === 'gemini-2.5-flash') {
        _merged.GEMINI_MODEL = 'gemini-3.8-flash';
        chrome.storage.sync.set({ GEMINI_MODEL: _merged.GEMINI_MODEL });
      }
      const ollamaUrl = String(_merged.OLLAMA_URL || '').trim();
      const ollamaModel = String(_merged.OLLAMA_MODEL || '').trim();
      const ollamaUpdates = {};
      if (!ollamaUrl) {
        _merged.OLLAMA_URL = DEFAULTS.OLLAMA_URL;
        ollamaUpdates.OLLAMA_URL = _merged.OLLAMA_URL;
      }
      if (!ollamaModel || ollamaModel === 'gemma4:e2b') {
        _merged.OLLAMA_MODEL = DEFAULTS.OLLAMA_MODEL;
        ollamaUpdates.OLLAMA_MODEL = _merged.OLLAMA_MODEL;
      }
      if (Object.keys(ollamaUpdates).length) chrome.storage.sync.set(ollamaUpdates);
      resolve(_merged);
    });
  });
}

/**
 * Save a set of config keys to storage.sync.
 */
async function saveConfig(updates) {
  return new Promise((resolve) => {
    const filtered = {};
    for (const [k, v] of Object.entries(updates)) {
      if (k in DEFAULTS) {
        filtered[k] = v;
        _merged[k] = v;
      }
    }
    chrome.storage.sync.set(filtered, () => {
      resolve();
    });
  });
}

/**
 * Get a single config value (synchronous, from in-memory copy).
 */
function cfg(key) {
  return _merged[key];
}

/**
 * Get all config.
 */
function getAllConfig() {
  return { ..._merged };
}

/**
 * Ollama timeout in ms: accepts seconds (< 1000) or ms, never below 30 s.
 */
function ollamaTimeoutMs(value) {
  let ms = Number(value) || Number(_merged.OLLAMA_TIMEOUT_MS) || 60000;
  if (ms < 1000) ms *= 1000;
  return Math.max(ms, 30000);
}

;
// ─────────────────────────────────────────────────────────────────────────────
//  STORAGE — promise-mutex serialized read-modify-write cycle
//  chrome.storage.local for answer key cache, wrong cache, search cache.
//  In-memory mirror for hot-path lookups.
// ─────────────────────────────────────────────────────────────────────────────

// ── Promise-mutex serialiser ────────────────────────────────────────────────
let _queue = Promise.resolve();

/**
 * Serialise a read-modify-write cycle end to end.
 * fn receives the current data dict, must return the new data dict (or same).
 */
async function mutex(fn) {
  _queue = _queue.then(fn, fn);
  return _queue;
}

// ── In-memory mirrors ───────────────────────────────────────────────────────
let _answerKeyMem = {};
let _wrongMem = {};
let _searchMem = {};

const STORAGE_KEYS = {
  ANSWER_KEY: 'answerkey_cache',
  WRONG: 'wrong_cache',
  SEARCH: 'search_cache',
};

/**
 * Validate shape of loaded data; drop malformed entries.
 */
function validateAnswerKey(data) {
  if (typeof data !== 'object' || data === null) return {};
  const out = {};
  for (const [rawKey, value] of Object.entries(data)) {
    const key = normText(rawKey);
    if (!key) continue;
    const entry = normalizeAnswerEntry(rawKey, value);
    if (!entry) continue;
    if (!out[key]) {
      out[key] = entry;
      continue;
    }
    const hits = out[key][1];
    for (const hit of entry[1]) {
      if (!hits.some((existing) =>
        normText(existing.question) === normText(hit.question) &&
        normText(existing.answer) === normText(hit.answer)
      )) hits.push(hit);
    }
    out[key][0] = Math.max(out[key][0], entry[0]);
  }
  return out;
}

function normalizeAnswerEntry(question, value) {
  let timestamp = Date.now() / 1000;
  let rawHits;
  if (Array.isArray(value) && value.length === 2 &&
      typeof value[0] === 'number' && Array.isArray(value[1])) {
    timestamp = value[0];
    rawHits = value[1];
  } else if (typeof value === 'string' || (value && typeof value === 'object')) {
    rawHits = [value];
  } else {
    return null;
  }

  const hits = [];
  for (const rawHit of rawHits) {
    const hit = typeof rawHit === 'string' ? { answer: rawHit } : rawHit;
    if (!hit || typeof hit.answer !== 'string' || !hit.answer.trim()) continue;
    const normalized = {
      question: typeof hit.question === 'string' && hit.question.trim()
        ? hit.question.trim()
        : question,
      answer: hit.answer.trim(),
      course: typeof hit.course === 'string' ? hit.course : 'imported',
      verified: hit.verified === true,
    };
    // Keep an explicit "known wrong" marker so it can be purged on the next write.
    if (hit.wrong === true) normalized.wrong = true;
    hits.push(normalized);
  }
  return [timestamp, hits];
}

function validateWrong(data) {
  if (typeof data !== 'object' || data === null) return {};
  const out = {};
  for (const [k, v] of Object.entries(data)) {
    if (Array.isArray(v)) {
      out[k] = v.filter((x) => typeof x === 'string');
    }
  }
  return out;
}

function validateSearch(data) {
  if (typeof data !== 'object' || data === null) return {};
  const out = {};
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

// ── Load all caches into memory on first access ────────────────────────────
let _loaded = false;
let _loadPromise = null;

function ensureLoaded() {
  if (!_loadPromise) {
    _loadPromise = (async () => {
      await loadConfig();
      const result = await chrome.storage.local.get([
        STORAGE_KEYS.ANSWER_KEY,
        STORAGE_KEYS.WRONG,
        STORAGE_KEYS.SEARCH,
      ]);
      _answerKeyMem = validateAnswerKey(result[STORAGE_KEYS.ANSWER_KEY] || {});
      _wrongMem = validateWrong(result[STORAGE_KEYS.WRONG] || {});
      _searchMem = validateSearch(result[STORAGE_KEYS.SEARCH] || {});
      _loaded = true;
    })();
  }
  return _loadPromise;
}

// ── Dirty tracking: several contexts (worker, tabs, options) share storage, so
//    a flush merges only the keys this context changed instead of overwriting.
const _dirty = { ak: new Set(), wrong: new Set(), search: new Set() };
const _deleted = { ak: new Set(), wrong: new Set(), search: new Set() };

function markKey(kind, key, removed = false) {
  if (!key) return;
  (removed ? _deleted : _dirty)[kind].add(key);
  (removed ? _dirty : _deleted)[kind].delete(key);
}

function overlayPending(kind, base, mem) {
  const out = base && typeof base === 'object' ? { ...base } : {};
  for (const key of _dirty[kind]) if (key in mem) out[key] = mem[key];
  for (const key of _deleted[kind]) delete out[key];
  return out;
}

// Keep the in-memory mirror in sync with writes from other contexts.
if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !_loaded) return;
    if (changes[STORAGE_KEYS.ANSWER_KEY]) {
      _answerKeyMem = overlayPending('ak', changes[STORAGE_KEYS.ANSWER_KEY].newValue, _answerKeyMem);
    }
    if (changes[STORAGE_KEYS.WRONG]) {
      _wrongMem = overlayPending('wrong', changes[STORAGE_KEYS.WRONG].newValue, _wrongMem);
    }
    if (changes[STORAGE_KEYS.SEARCH]) {
      _searchMem = overlayPending('search', changes[STORAGE_KEYS.SEARCH].newValue, _searchMem);
    }
  });
}

// ── Debounced cache flush ────────────────────────────────────────────────────
let _flushTimer = null;
const FLUSH_DEBOUNCE_MS = 500;

function scheduleFlush() {
  if (_flushTimer) clearTimeout(_flushTimer);
  _flushTimer = setTimeout(doFlush, FLUSH_DEBOUNCE_MS);
}

async function flushNow() {
  if (_flushTimer) clearTimeout(_flushTimer);
  _flushTimer = null;
  await doFlush();
}
// ── Answer key cache ────────────────────────────────────────────────────────
async function answerKeyGet(key, options = {}) {
  await ensureLoaded();
  key = normText(key);
  const entry = _answerKeyMem[key];
  if (!entry) return null;
  const ts = entry[0];
  const ttl = cfg('CACHE_TTL');
  const permanent = entry[1].some((hit) => hit && (
    hit.course === 'learned-review' ||
    hit.course === 'imported' ||
    (typeof hit.course === 'string' && hit.course.startsWith('harvested-'))
  ));
  if (ttl > 0 && !permanent && Date.now() / 1000 - ts > ttl) {
    delete _answerKeyMem[key];
    markKey('ak', key, true);
    scheduleFlush();
    return null;
  }
  const wrong = (await getWrongAnswers(key)).map((answer) => normText(answer)).filter(Boolean);
  const includeUnverified = options && options.includeUnverified === true;
  return entry[1].filter((hit) => {
    if (!hit || hit.wrong === true) return false;
    if (!includeUnverified && hit.verified !== true) return false;
    const answer = hitAnswerNorm(hit);
    return !answer || !wrong.some((knownWrong) =>
      answer === knownWrong || similarity(answer, knownWrong) >= 0.9
    );
  });
}

function hitAnswerNorm(hit) {
  if (!hit || typeof hit !== 'object' || typeof hit.answer !== 'string') return '';
  return normText(hit.answer);
}

// Verified answers always outrank unverified ones and conflicting guesses are
// purged: as soon as a question has a `verified: true` hit, every hit with a
// different answer is dropped and the verified hit is moved to index 0.
// Hits flagged `wrong: true` never survive a write.
function rankHits(hits) {
  if (!Array.isArray(hits)) return [];
  const verified = [];
  const unverified = [];
  const other = [];
  const seen = new Set();
  for (const hit of hits) {
    if (hit && typeof hit === 'object' && hit.wrong === true) continue;
    const answerNorm = hitAnswerNorm(hit);
    if (!answerNorm) { other.push(hit); continue; }
    if (seen.has(answerNorm)) continue;
    seen.add(answerNorm);
    if (hit.verified === true) verified.push(hit);
    else unverified.push(hit);
  }
  if (!verified.length) return unverified.concat(other);
  const verifiedNorms = verified.map(hitAnswerNorm);
  const kept = unverified.filter((hit) => {
    const answerNorm = hitAnswerNorm(hit);
    // Keep unverified hits that are only a spacing/punctuation variant of a
    // verified answer; everything else is a conflicting guess and is purged.
    return verifiedNorms.some((norm) => norm === answerNorm || similarity(answerNorm, norm) >= 0.9);
  });
  return verified.concat(kept, other);
}

// `opts.replaceVerified` is for single-answer keys (one matching statement, one
// MCQ prompt): a freshly graded verified answer retires older verified hits that
// now contradict it, so a stale pair can never outrank Moodle's latest result.
async function answerKeyPut(key, hits, course = 'learned-review', opts = {}) {
  await ensureLoaded();
  const verified = !!(opts && opts.verified);
  const replaceVerified = !!(opts && opts.replaceVerified);
  if (typeof hits === 'string') {
    const question = key;
    key = normText(question);
    const answer = hits.replace(/<[^>]+>/g, '').trim();
    if (!key || !answer) return;
    const answerNorm = normText(answer);
    hits = (_answerKeyMem[key]?.[1] || []).slice();
    if (verified && replaceVerified) {
      hits = hits.filter((hit) => !hit || typeof hit !== 'object' ||
        hit.verified !== true || normText(hit.answer) === answerNorm);
    }
    const existing = hits.find((hit) => hit && normText(hit.answer) === answerNorm);
    if (existing) {
      if (verified && !existing.verified) existing.verified = true;
    } else {
      const hit = { question: question.trim(), answer, course };
      if (verified) hit.verified = true;
      hits.push(hit);
    }
    await wrongDeleteFuzzy(key, answerNorm);
  } else if (Array.isArray(hits) && verified) {
    hits = hits.map((hit) => (hit && typeof hit === 'object') ? { ...hit, verified: true } : hit);
  }
  key = normText(key);
  if (!key || !Array.isArray(hits) || !hits.length) return;

  // Verified answers are authoritative: purge them out of the wrong cache so a
  // stale "wrong" record can never outvote what Moodle confirmed on review.
  const verifiedNorms = [];
  for (const hit of hits) {
    if (!hit || typeof hit !== 'object' || hit.verified !== true) continue;
    const answerNorm = hitAnswerNorm(hit);
    if (answerNorm && !verifiedNorms.includes(answerNorm)) verifiedNorms.push(answerNorm);
  }
  for (const answerNorm of verifiedNorms) await wrongDeleteFuzzy(key, answerNorm);

  // Purge unverified hits that the wrong cache already knows are incorrect, then
  // force verified hits to index 0 so lookups always see them first.
  const knownWrong = (await getWrongAnswers(key)).map((item) => normText(item)).filter(Boolean);
  if (knownWrong.length) {
    hits = hits.filter((hit) => {
      if (!hit || typeof hit !== 'object' || hit.verified === true) return true;
      const answerNorm = hitAnswerNorm(hit);
      if (!answerNorm) return true;
      return !knownWrong.some((item) => item === answerNorm || similarity(answerNorm, item) >= 0.9);
    });
  }
  hits = rankHits(hits);
  if (!hits.length) {
    // Everything stored for this question was a known-wrong guess: drop the key
    // instead of keeping a poisoned entry around.
    if (_answerKeyMem[key]) {
      delete _answerKeyMem[key];
      markKey('ak', key, true);
      scheduleFlush();
    }
    return;
  }

  _answerKeyMem[key] = [Date.now() / 1000, hits];
  markKey('ak', key);
  evictAnswerKeys();
  scheduleFlush();
}

function evictAnswerKeys() {
  const max = cfg('CACHE_MAX');
  const keys = Object.keys(_answerKeyMem);
  if (keys.length <= max) return;
  keys.sort((a, b) => (_answerKeyMem[a][0] || 0) - (_answerKeyMem[b][0] || 0));
  for (let i = 0; i < keys.length - max; i++) {
    delete _answerKeyMem[keys[i]];
    markKey('ak', keys[i], true);
  }
}

async function saveLocalAnswer(question, answer, course = 'learned-review') {
  const key = normText(question);
  const value = (answer || '').replace(/<[^>]+>/g, '').trim();
  if (!key || !value) return;
  const hits = (await answerKeyGet(key, { includeUnverified: true })) || [];
  const answerNorm = normText(value);
  if (!hits.some((hit) => hit && normText(hit.answer) === answerNorm)) {
    hits.push({
      question: (question || '').trim(),
      answer: value,
      course,
    });
  }
  await answerKeyPut(key, hits);
}

async function answerKeyImport(imported) {
  await ensureLoaded();
  const questions = unwrapBankQuestions(imported);
  if (!questions) {
    throw new Error('Question bank JSON must contain a question map.');
  }
  let added = 0;
  for (const [rawKey, entry] of Object.entries(questions)) {
    if (BANK_META_KEYS.has(rawKey)) continue;
    const key = normText(rawKey);
    const normalized = normalizeAnswerEntry(rawKey, entry);
    if (!key || !normalized) continue;
    const existing = _answerKeyMem[key] || [normalized[0], []];
    const hits = existing[1].slice();
    const seen = new Set(hits.filter((hit) => hit && hit.answer).map((hit) =>
      `${normText(hit.question || rawKey)}|${normText(hit.answer)}`));
    for (const hit of normalized[1]) {
      const signature = `${normText(hit.question || rawKey)}|${normText(hit.answer)}`;
      if (seen.has(signature)) continue;
      seen.add(signature);
      hits.push(hit);
      added++;
    }
    if (hits.length) {
      _answerKeyMem[key] = [Math.max(existing[0] || 0, normalized[0]), hits];
      markKey('ak', key);
    }
  }
  evictAnswerKeys();
  scheduleFlush();
  return { added, questions: Object.keys(_answerKeyMem).length };
}

// Keys a bank file may carry that are not questions themselves. They must never be
// imported as question entries (a bare map without the `questions` wrapper still
// sometimes ships `updatedAt` alongside the questions).
const BANK_META_KEYS = new Set(['questions', 'updatedAt', 'format', 'version', 'exportedAt']);

/**
 * Extract the question map out of a bank payload.
 *
 * GitHub banks are written either as `{ "questions": { ... }, "updatedAt": "..." }`
 * (the wrapper used by the Python harvester and by this extension's exporter) or as
 * a bare `{ question: [timestamp, hits] }` map. Unwrap before iterating over the
 * question keys. Returns null when the payload is not a question map at all.
 */
function unwrapBankQuestions(bankJson) {
  const entriesMap = (bankJson && typeof bankJson.questions === 'object' && !Array.isArray(bankJson.questions))
    ? bankJson.questions
    : bankJson;
  if (!entriesMap || typeof entriesMap !== 'object' || Array.isArray(entriesMap)) return null;
  return entriesMap;
}

/**
 * Merge a GitHub bank payload into chrome.storage.local (the pull direction).
 *
 * Shared by the options page ("Sync Now") and the service worker (push sync), so
 * both accept every bank shape and count new answers identically.
 * Returns { added, questions }: newly stored answers and the resulting total.
 */
async function mergeRemoteBankIntoLocal(bankJson) {
  const entriesMap = unwrapBankQuestions(bankJson);
  if (!entriesMap) return { added: 0, questions: await answerKeyCount() };

  const pullMap = {};
  for (const [rawKey, value] of Object.entries(entriesMap)) {
    if (!rawKey || BANK_META_KEYS.has(rawKey)) continue;
    const normalized = normalizeAnswerEntry(rawKey, value);
    if (!normalized || !normalized[1].length) continue;
    pullMap[rawKey] = normalized;
  }
  const pulled = await answerKeyImport({ questions: pullMap });
  // Persist right away so the service worker and content scripts see the merged
  // answers without waiting for the 500 ms flush debounce.
  try {
    await flushNow();
  } catch (error) {
    // Merged in memory; the scheduled flush retries the storage write.
  }
  return { added: pulled.added, questions: pulled.questions };
}

async function answerKeyDelete(key) {
  await ensureLoaded();
  delete _answerKeyMem[key];
  markKey('ak', key, true);
  scheduleFlush();
}

async function answerKeyDeleteFuzzy(qNorm) {
  await ensureLoaded();
  for (const storedKey of Object.keys(_answerKeyMem)) {
    const ratio = similarity(qNorm, storedKey);
    const fuzzy = ratio >= 0.85 ||
      (storedKey.length >= 20 && (storedKey.includes(qNorm) || qNorm.includes(storedKey)));
    if (storedKey === qNorm || fuzzy) {
      delete _answerKeyMem[storedKey];
      markKey('ak', storedKey, true);
    }
  }
  scheduleFlush();
}

// ── Wrong cache ─────────────────────────────────────────────────────────────
async function wrongGetAll(qNorm) {
  await ensureLoaded();
  const combined = [];
  for (const [storedKey, values] of Object.entries(_wrongMem)) {
    const ratio = similarity(qNorm, storedKey);
    const fuzzy = ratio >= 0.85 ||
      (storedKey.length >= 20 && (storedKey.includes(qNorm) || qNorm.includes(storedKey)));
    if (storedKey === qNorm || fuzzy) {
      for (const v of values) {
        if (typeof v === 'string' && v.trim()) combined.push(v);
      }
    }
  }
  const seen = new Set();
  return combined.filter((v) => {
    const n = normText(v);
    if (!n || seen.has(n)) return false;
    seen.add(n);
    return true;
  });
}

async function wrongSet(key, values) {
  await ensureLoaded();
  if (typeof values === 'string') {
    key = normText(key);
    const answer = normText(values);
    if (!key || !answer) return;
    values = [...(_wrongMem[key] || []), answer];
  } else {
    key = normText(key);
  }
  if (!key) return;
  _wrongMem[key] = [...new Set(values)];
  markKey('wrong', key);
  scheduleFlush();
}

async function getWrongAnswers(question) {
  const key = normText(question);
  return key ? wrongGetAll(key) : [];
}

async function learnWrong(question, answer) {
  const key = normText(question);
  const value = normText(answer);
  if (!key || !value) return;
  await answerKeyDeleteFuzzy(key);
  const previous = await wrongGetAll(key);
  if (!previous.some((item) => normText(item) === value)) {
    previous.push(value);
  }
  await wrongSet(key, previous);
}

async function learnCorrect(question, answer) {
  const key = normText(question);
  const value = (answer || '').replace(/<[^>]+>/g, '').trim();
  if (!key || !value) return;
  await saveLocalAnswer(question, value);
  await wrongDeleteFuzzy(key, normText(value));
}

async function wrongDeleteFuzzy(qNorm, answerNorm) {
  await ensureLoaded();
  for (const storedKey of Object.keys(_wrongMem)) {
    const ratio = similarity(qNorm, storedKey);
    const fuzzy = ratio >= 0.85 ||
      (storedKey.length >= 20 && (storedKey.includes(qNorm) || qNorm.includes(storedKey)));
    if (storedKey === qNorm || fuzzy) {
      const filtered = _wrongMem[storedKey].filter((item) => normText(item) !== answerNorm);
      if (filtered.length === _wrongMem[storedKey].length) continue;
      if (filtered.length) {
        _wrongMem[storedKey] = filtered;
        markKey('wrong', storedKey);
      } else {
        delete _wrongMem[storedKey];
        markKey('wrong', storedKey, true);
      }
    }
  }
  scheduleFlush();
}

async function answerKeyGetAll() {
  await ensureLoaded();
  return { ..._answerKeyMem };
}

async function answerKeyCount() {
  await ensureLoaded();
  return Object.keys(_answerKeyMem).length;
}

async function wrongDeleteKey(key) {
  await ensureLoaded();
  delete _wrongMem[key];
  markKey('wrong', key, true);
  scheduleFlush();
}

async function searchGet(key) {
  await ensureLoaded();
  return _searchMem[key] || null;
}

async function searchPut(key, text) {
  await ensureLoaded();
  _searchMem[key] = text;
  markKey('search', key);
  scheduleFlush();
}

// ── Bundled starter bank (default_bank.json) ───────────────────────────────
//    Imported once per extension version; import is merge-only and idempotent.
async function seedDefaultBank(force = false) {
  const version = chrome.runtime.getManifest().version;
  const flag = await chrome.storage.local.get('default_bank_version');
  if (!force && flag.default_bank_version === version) return null;
  const response = await fetch(chrome.runtime.getURL('default_bank.json'));
  if (!response.ok) throw new Error(`default_bank.json HTTP ${response.status}`);
  const result = await answerKeyImport(await response.json());
  await flushNow();
  await chrome.storage.local.set({ default_bank_version: version });
  return result;
}

// ── Superscript / subscript / Moodle image normalization ────────────────────
//  `cleanDOMToAI` in the reference toolkit turns <sup>/<sub> markup into the
//  real unicode characters so "2<sup>3</sup>" reads exactly like a typed "2³".
//  `unscriptDigits()` then folds both forms back to plain digits for matching,
//  and attempt-specific pluginfile.php URLs collapse into a stable
//  `[moodle-asset:<filename>]` token, so the same item matches across attempts.
const SUP_MAP = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
  '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', 'n': 'ⁿ', 'i': 'ⁱ', 'x': 'ˣ', 'y': 'ʸ', 'm': 'ᵐ',
  'a': 'ᵃ', 'b': 'ᵇ', 'c': 'ᶜ',
};
const SUB_MAP = {
  '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
  '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎', 'a': 'ₐ', 'e': 'ₑ', 'o': 'ₒ', 'x': 'ₓ', 'i': 'ᵢ',
  'j': 'ⱼ', 'n': 'ₙ', 'p': 'ₚ',
};

const UNSCRIPT_DIGITS = {
  '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9',
  '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9',
};

/** Fold unicode superscript/subscript digits (2³, 10₂) back to ASCII digits. */
function unscriptDigits(str) {
  if (!str) return '';
  return String(str).replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹₀₁₂₃₄₅₆₇₈₉]/g, (ch) => UNSCRIPT_DIGITS[ch] || ch);
}

// Moodle rewrites the context/attempt id inside every pluginfile.php URL, so the
// raw src can never match between attempts — the filename is stable. The path
// prefix varies (`/pluginfile.php`, `/2612/pluginfile.php`, ...).
const MOODLE_ASSET_SRC = '(?:https?:\\/\\/[^\\s"\']*?)?\\/pluginfile\\.php\\/\\d+\\/question\\/(?:answer|questiontext|feedback)\\/\\d+(?:\\/\\d+)?\\/([^?#\\s"\']+)';
const MOODLE_ASSET_RE = new RegExp(MOODLE_ASSET_SRC, 'i');
// Full URL form: the `?forcedownload=1` / `#...` tail is attempt noise too.
const MOODLE_ASSET_ANY_RE = new RegExp(MOODLE_ASSET_SRC + '(?:[?#][^\\s"\']*)?', 'gi');

/** Stable `[moodle-asset:<filename>]` token for a Moodle question file URL. */
function moodleAssetToken(src) {
  const text = String(src || '');
  const match = text.match(MOODLE_ASSET_RE);
  if (!match || !match[1]) return '';
  let name = match[1];
  try { name = decodeURIComponent(name); } catch (error) { /* keep the raw name */ }
  return `[moodle-asset:${name}]`;
}

// ── Utility: norm_text port ────────────────────────────────────────────────
function normText(s) {
  s = (s || '').toLowerCase();
  // Attempt-independent image token (URL or already-written token form).
  s = s.replace(MOODLE_ASSET_ANY_RE, ' moodle asset $1 ');
  s = s.replace(/\[\s*moodle\s*-\s*asset\s*:\s*([^\]]+)\]/g, ' moodle asset $1 ');
  // 2³ / 10₂ must fold to 23 / 102 before non-ASCII characters are stripped.
  s = unscriptDigits(s);
  s = s.replace(/^(question\s*)?\d+[.)]\s*/, '');
  s = s.replace(/\bselect one\b|\bchoose\.\.\.|\btrue or false\b/g, '');
  s = s.replace(/[_\-]{2,}/g, ' ');
  s = s.replace(/[^a-z0-9 ]/g, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

// ── Simple string similarity (bigram Dice) ────────────────────────────────
function similarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const bigrams = (s) => {
    const m = new Map();
    for (let i = 0; i < s.length - 1; i++) {
      const bg = s.substring(i, i + 2);
      m.set(bg, (m.get(bg) || 0) + 1);
    }
    return m;
  };
  const m1 = bigrams(a);
  const m2 = bigrams(b);
  let intersection = 0;
  for (const [bg, c1] of m1) {
    const c2 = m2.get(bg) || 0;
    intersection += Math.min(c1, c2);
  }
  const total = [...m1.values()].reduce((s, c) => s + c, 0) +
                [...m2.values()].reduce((s, c) => s + c, 0);
  return total === 0 ? 0 : (2 * intersection) / total;
}

// ── GitHub Contents API helpers ─────────────────────────────────────────────
//  Shared by the service worker (background.js) and the options page
//  (options.js), both of which include this file.
//
//  Three GitHub quirks matter here:
//   1. The metadata endpoint must be requested with the JSON media type
//      (`application/vnd.github+json`); requesting `...raw+json` returns the
//      file body instead of the JSON envelope, so `data.sha` is missing and the
//      subsequent PUT fails with 422 "sha wasn't supplied".
//   2. Base64 payloads carry UTF-8 bytes. `atob()` yields one char per byte, so
//      decoding with TextDecoder (and encoding with TextEncoder) keeps `²`,
//      `₂`, emoji, etc. intact instead of producing mojibake.
//   3. GET /contents only inlines `content` for files up to 1 MB. Above that
//      GitHub answers with `"encoding": "none"` and an empty `content`, so the
//      body has to come from the Git blobs API (up to 100 MB) or `download_url`.

const GITHUB_API_ROOT = 'https://api.github.com';

/** Decode a Base64 payload (Contents API / Git blob API) into a UTF-8 string. */
function decodeBase64Utf8(b64) {
  const bin = atob(String(b64 || '').replace(/\s+/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}

/** Encode a UTF-8 string into Base64 (btoa alone throws on non-Latin1 input). */
function encodeBase64Utf8(str) {
  const bytes = new TextEncoder().encode(str == null ? '' : String(str));
  const CHUNK = 0x8000; // String.fromCharCode.apply() has an argument-count limit
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

// Legacy names kept so older call sites keep working.
function b64ToUtf8(b64) { return decodeBase64Utf8(b64); }
function utf8ToB64(text) { return encodeBase64Utf8(text); }

/** Common GitHub headers: JSON media type plus the token when one is set. */
function gitHubHeaders(token, accept) {
  const headers = { Accept: accept || 'application/vnd.github+json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  return headers;
}

/** Pull the human-readable message out of a failed GitHub response body. */
async function gitHubErrorDetail(resp) {
  try {
    const text = (await resp.text()).trim();
    if (!text) return '';
    try {
      const parsed = JSON.parse(text);
      const message = parsed && (parsed.message || parsed.error);
      return String(message || text.slice(0, 300)).trim();
    } catch (error) {
      return text.slice(0, 300);
    }
  } catch (error) {
    return '';
  }
}

/**
 * Read the raw text behind a Contents API metadata response.
 * Inline Base64 is used when GitHub sends it; files over 1 MB (`encoding:
 * "none"`) are read from the Git blobs API, with `download_url` as a fallback.
 * Every failure reason is collected so the caller can surface it verbatim.
 */
async function gitHubReadFileText(owner, repo, token, meta) {
  if (meta.contentB64) {
    return { text: decodeBase64Utf8(meta.contentB64), source: 'contents' };
  }

  const failures = [];

  if (meta.sha) {
    try {
      const blobUrl = `${GITHUB_API_ROOT}/repos/${owner}/${repo}/git/blobs/${encodeURIComponent(meta.sha)}`;
      const blobResp = await fetch(blobUrl, { headers: gitHubHeaders(token), cache: 'no-store' });
      if (!blobResp.ok) {
        const detail = await gitHubErrorDetail(blobResp);
        failures.push(`Git blob fetch failed: HTTP ${blobResp.status}${detail ? ' — ' + detail : ''}`);
      } else {
        const blob = await blobResp.json();
        if (blob && typeof blob.content === 'string' && blob.content) {
          return blob.encoding === 'base64'
            ? { text: decodeBase64Utf8(blob.content), source: 'blob' }
            : { text: blob.content, source: 'blob' };
        }
        failures.push('Git blob response contained no content');
      }
    } catch (error) {
      failures.push(`Git blob fetch failed: ${error.message}`);
    }
  }

  if (meta.downloadUrl) {
    try {
      // raw.githubusercontent.com serves the file as text; the token is still
      // required for private repositories.
      const rawResp = await fetch(meta.downloadUrl, {
        headers: token ? { Authorization: 'Bearer ' + token } : {},
        cache: 'no-store',
      });
      if (!rawResp.ok) {
        failures.push(`raw download failed: HTTP ${rawResp.status}`);
      } else {
        return { text: await rawResp.text(), source: 'download_url' };
      }
    } catch (error) {
      failures.push(`raw download failed: ${error.message}`);
    }
  }

  throw new Error(failures.join('; ') || `GitHub returned no file content for ${meta.sha || 'this file'}`);
}

/**
 * Read a JSON file from a GitHub repo via the Contents API.
 *
 * Returns { sha, content, missing, parseError, size, source }:
 *  - `content` is the parsed JSON object (null when absent or unparsable)
 *  - `parseError` carries the exact JSON.parse/HTTP/decoding failure, never
 *    masked as "unparsable"
 *  - `missing` is true on 404 and `source` records where the body came from
 *    ('contents' | 'blob' | 'download_url' | 'empty' | 'error' | 'missing')
 *
 * Throws only when the metadata request itself fails (non-404 HTTP error).
 */
async function gitHubGetFile(owner, repo, path, token) {
  const url = `${GITHUB_API_ROOT}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?t=${Date.now()}`;
  const resp = await fetch(url, { headers: gitHubHeaders(token), cache: 'no-store' });
  if (resp.status === 404) {
    return { sha: null, content: null, missing: true, parseError: '', size: 0, source: 'missing' };
  }
  if (!resp.ok) {
    const detail = await gitHubErrorDetail(resp);
    const failure = new Error(`GitHub API error: HTTP ${resp.status}${detail ? ' — ' + detail : ''}`);
    failure.status = resp.status;
    failure.detail = detail;
    throw failure;
  }

  const data = (await resp.json()) || {};
  const meta = {
    sha: data.sha || null,
    size: Number(data.size) || 0,
    encoding: data.encoding || '',
    contentB64: typeof data.content === 'string' ? data.content : '',
    downloadUrl: data.download_url || '',
  };

  let text = '';
  let source = 'empty';
  try {
    const read = await gitHubReadFileText(owner, repo, token, meta);
    text = read.text;
    source = read.source;
  } catch (error) {
    return {
      sha: meta.sha, content: null, missing: false,
      parseError: error.message, size: meta.size, source: 'error',
    };
  }

  if (!text.trim()) {
    return {
      sha: meta.sha, content: null, missing: false,
      parseError: `GitHub returned an empty body (size ${meta.size} bytes, read from ${source})`,
      size: meta.size, source,
    };
  }

  try {
    return {
      sha: meta.sha, content: JSON.parse(text), missing: false,
      parseError: '', size: meta.size, source,
    };
  } catch (error) {
    const preview = text.trim().slice(0, 80).replace(/\s+/g, ' ');
    return {
      sha: meta.sha, content: null, missing: false,
      parseError: `${error.message} (${text.length} chars from ${source}, starts with "${preview}")`,
      size: meta.size, source,
    };
  }
}

/**
 * Create or update a JSON file via the Contents API.
 * Always sends the current `sha` when updating (omit only for a brand-new
 * file). If the server rejects the stale sha with 409/422, re-fetch the latest
 * sha once and retry. Returns { ok, status, message }.
 */
async function gitHubPutJson(owner, repo, path, token, data, message, sha) {
  const headers = gitHubHeaders(token);
  headers['Content-Type'] = 'application/json';
  const url = `${GITHUB_API_ROOT}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`;
  // UTF-8 aware: multi-byte characters (², ₂, emoji) survive the round trip.
  const content = encodeBase64Utf8(JSON.stringify(data, null, 2));

  const doPut = (fileSha) => {
    const payload = { message, content };
    if (fileSha) payload.sha = fileSha; // Omit only when creating a new file.
    return fetch(url, { method: 'PUT', headers, body: JSON.stringify(payload) });
  };

  let resp = await doPut(sha);
  if (resp.status === 409 || resp.status === 422) {
    // Stale sha: re-fetch the latest metadata once and retry the PUT.
    let latestSha = null;
    try {
      latestSha = (await gitHubGetFile(owner, repo, path, token)).sha;
    } catch (e) {
      latestSha = null;
    }
    resp = await doPut(latestSha);
  }

  if (resp.ok) return { ok: true, status: resp.status, message: '' };
  const apiMessage = await gitHubErrorDetail(resp);
  const hint = resp.status === 413 ? ' (file is too large for the Contents API)' : '';
  return { ok: false, status: resp.status, message: `${apiMessage}${hint}`.trim() };
}

function doFlush() {
  _flushTimer = null;
  return mutex(async () => {
    const pending = ['ak', 'wrong', 'search'].some((kind) => _dirty[kind].size || _deleted[kind].size);
    if (!pending) return;
    const stored = await chrome.storage.local.get([
      STORAGE_KEYS.ANSWER_KEY,
      STORAGE_KEYS.WRONG,
      STORAGE_KEYS.SEARCH,
    ]);
    // Synchronous merge section: no await between merge and set().
    _answerKeyMem = overlayPending('ak', validateAnswerKey(stored[STORAGE_KEYS.ANSWER_KEY] || {}), _answerKeyMem);
    _wrongMem = overlayPending('wrong', validateWrong(stored[STORAGE_KEYS.WRONG] || {}), _wrongMem);
    _searchMem = overlayPending('search', validateSearch(stored[STORAGE_KEYS.SEARCH] || {}), _searchMem);
    for (const kind of ['ak', 'wrong', 'search']) {
      _dirty[kind].clear();
      _deleted[kind].clear();
    }
    await chrome.storage.local.set({
      [STORAGE_KEYS.ANSWER_KEY]: _answerKeyMem,
      [STORAGE_KEYS.WRONG]: _wrongMem,
      [STORAGE_KEYS.SEARCH]: _searchMem,
    });
  });
}

;
/* ─────────────────────────────────────────────────────────────────────────────
   universal-harvester.js — Harvest Q&A pairs from any study site.

   Injected on <all_urls> (but NOT on amaes.com, where content.js keeps its own
   Moodle HUD). It renders a small dark-glass panel (#qb-hud) with:

     • Harvest Page   — highlighted text first, then amauoed.com cards, Quizlet
                        term pairs, or a generic question/answer DOM heuristic
     • Harvest Course — loops ?page=1, ?page=2, … for multi-page course pages
     • Stop           — aborts an in-flight course fetch loop
     • — / 🐾          — minimize to a compact floating pill

   Every pair goes through answerKeyPut(q, a, 'harvested-<site>', { verified })
   from storage.js; flushNow() persists the bank and SYNC_GITHUB_BANK pushes the
   verified rows to the ama-quiz-bank GitHub repo.

   BOT_ENABLED (the popup switch, chrome.storage.local + .sync) is watched here:
   `false` hides the panel / 🐾 pill at once and aborts an in-flight run, `true`
   brings the panel back — neither needs a page reload.

   HUD rows are appended to #qb-log as .hud-log-line.<level> and the status chip
   uses the shared running / stopped / waiting / reviewing classes, so mascot.js
   narrates the run with harvesting.gif and review.gif without extra wiring.

   This file is strictly read-only towards the page: it never clicks, types,
   submits or navigates.
   ───────────────────────────────────────────────────────────────────────────── */
try {
  (function () {
    'use strict';

    /* ── Configuration ──────────────────────────────────────────────────── */

    const HUD_ID = 'qb-hud';
    const LOG_ID = 'qb-log';
    const STATUS_ID = 'qb-status';

    const MAX_COURSE_PAGES = 80;
    const FETCH_TIMEOUT_MS = 20000;
    const MAX_GENERIC_NODES = 2000;
    const MAX_GENERIC_PAIRS = 300;
    const QUESTION_MAX_CHARS = 1200;
    const ANSWER_MAX_CHARS = 600;

    // Auto-expanded here; everywhere else the HUD starts as a floating pill.
    const STUDY_HOSTS = [
      'amaes.com',
      'amauoed.com',
      'quizlet.com',
      'studocu.com',
      'brainly.ph',
      'brainly.com',
      'coursehero.com',
      'scribd.com',
    ];

    // Other hosts where an expanded HUD is handy (search engines / Q&A sites).
    const EXTRA_EXPAND_HOSTS = [
      'google.com',
      'google.com.ph',
      'bing.com',
      'duckduckgo.com',
      'chegg.com',
      'bartleby.com',
      'numerade.com',
    ];

    const AUTO_EXPAND_HOSTS = STUDY_HOSTS.concat(EXTRA_EXPAND_HOSTS);

    // Never treat chrome/settings-style text as an answer.
    const STOP_ANSWERS = new Set([
      'answer',
      'answers',
      'show answer',
      'show answers',
      'see answer',
      'reveal answer',
      'hide answer',
      'check answer',
      'submit',
      'submit answer',
      'next',
      'next question',
      'previous',
      'previous question',
      'back',
      'continue',
      'login',
      'log in',
      'sign in',
      'sign up',
      'register',
      'share',
      'menu',
      'search',
      'loading',
      'loading...',
      'correct',
      'incorrect',
      'right',
      'wrong',
      'true or false',
      'select one',
      'choose one',
      'not sure',
      'skip',
    ]);

    const PAGINATION_SELECTORS = [
      'a[rel="next"]',
      '.pagination a',
      '.pager a',
      'nav[aria-label*="pagination" i] a',
      '[class*="pagination" i] a',
      '[class*="pager" i] a',
    ];

    const QUESTION_SELECTOR = [
      'p',
      'li',
      'dt',
      'summary',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'blockquote',
      '.question',
      '.question-text',
      '.qtext',
      '.prompt',
      '[class*="question" i]',
      '[data-testid*="question" i]',
    ].join(', ');

    const ANSWER_SELECTOR = [
      'strong',
      'b',
      'mark',
      '.answer',
      '.answers',
      '.correct',
      '.right-answer',
      '.rightanswer',
      '[class*="answer" i]',
      '[class*="correct" i]',
      '[data-testid*="answer" i]',
    ].join(', ');

    /* ── State ──────────────────────────────────────────────────────────── */

    let hudEl = null;
    let logEl = null;
    let statusEl = null;
    let minimizeBtn = null;
    let pageBtn = null;
    let courseBtn = null;
    let stopBtn = null;

    let collapsed = false;
    let busy = false;
    let stopRequested = false;
    let abortController = null;
    let dragState = null;

    // Lines produced before the HUD is attached; replayed on mount.
    const pendingLog = [];

    // BOT_ENABLED mirror (the popup switch). When it flips off the panel and the
    // 🐾 pill are hidden at once and any running harvest is aborted — no reload.
    let botEnabled = true;
    let enabledWatched = false;

    /* ── Small helpers ──────────────────────────────────────────────────── */

    function norm(value) {
      return String(value == null ? '' : value)
        .replace(/\u00a0/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }

    function currentHost() {
      try {
        return String(location.hostname || '').toLowerCase();
      } catch (error) {
        return '';
      }
    }

    function hostMatches(host, domain) {
      const clean = String(host || '').toLowerCase();
      const target = String(domain || '').toLowerCase();
      return clean === target || clean.endsWith('.' + target);
    }

    function hostInList(host, list) {
      return list.some((domain) => hostMatches(host, domain));
    }

    // Study / Q&A hosts where the panel opens expanded instead of as a pill.
    function isStudyHost() {
      return hostInList(currentHost(), AUTO_EXPAND_HOSTS);
    }

    function isAmauoed() {
      return hostMatches(currentHost(), 'amauoed.com');
    }

    function isQuizlet() {
      return hostMatches(currentHost(), 'quizlet.com');
    }

    // 'harvested-amauoed', 'harvested-quizlet', … — same shape as the existing
    // 'harvested-amauoed' source tag used by background.js.
    function sourceTagForHost(host) {
      const clean = String(host || '').toLowerCase().replace(/^www\./, '');
      const label = clean.split('.')[0].replace(/[^a-z0-9-]/g, '');
      return 'harvested-' + (label || 'site');
    }

    function pairSignature(pair) {
      return (pair.question + '\u0000' + pair.answer).toLowerCase();
    }

    function safeSendMessage(message, callback) {
      try {
        if (!chrome || !chrome.runtime || !chrome.runtime.id) {
          if (callback) callback(null, 'extension context unavailable');
          return;
        }
        chrome.runtime.sendMessage(message, (response) => {
          const lastError = chrome.runtime.lastError;
          if (callback) callback(response || null, lastError ? lastError.message : '');
        });
      } catch (error) {
        const message = error && error.message ? error.message : String(error);
        if (callback) callback(null, message);
      }
    }

    /* ── Text cleanup ───────────────────────────────────────────────────── */

    const CHECK_MARK_RE = /^[\s\u2705\u2714\u2713\u2611\u2610\uFE0F]+/;
    const QUESTION_PREFIX_RE = /^(?:q(?:uestion)?\s*#?\s*\d*\s*[:.)\-]|(?:\d{1,3})[.)])\s*/i;
    const ANSWER_LABEL_RE = /^(?:(?:correct|right)\s+)?(?:answer|ans)\s*[:.)\-]\s*/i;
    const CORRECT_LABEL_RE = /^(?:correct|right)\s*[:.)\-]\s*/i;

    function stripCheckMarks(text) {
      return norm(String(text || '').replace(CHECK_MARK_RE, ''));
    }

    function cleanQuestion(text) {
      return norm(text)
        .replace(QUESTION_PREFIX_RE, '')
        .replace(/\s*\bselect (?:one|an option)\b\s*$/i, '')
        .replace(/\s*\bchoose (?:one|an option)\b\s*$/i, '')
        .trim();
    }

    function cleanAnswer(text) {
      let value = norm(text);
      value = value.replace(ANSWER_LABEL_RE, '');
      value = value.replace(CORRECT_LABEL_RE, '');
      value = stripCheckMarks(value);
      value = value.replace(/\s*\bcorrect\b\s*$/i, '').trim();
      return value;
    }

    /**
     * Validate + normalise one Q/A pair. Returns null for UI noise, navigation
     * labels, duplicated text and absurdly long blocks.
     */
    function makePair(questionText, answerText, verified) {
      const question = cleanQuestion(questionText).slice(0, QUESTION_MAX_CHARS);
      const answer = cleanAnswer(answerText).slice(0, ANSWER_MAX_CHARS);
      // Short terms are normal on Quizlet/amauoed; the generic extractor already
      // filters its own candidates through looksLikeQuestion().
      if (question.length < 3 || answer.length < 1) return null;

      const qLower = question.toLowerCase();
      const aLower = answer.toLowerCase();
      if (qLower === aLower) return null;
      if (STOP_ANSWERS.has(qLower) || STOP_ANSWERS.has(aLower)) return null;
      // An "answer" that repeats the whole question is a container, not an answer.
      if (aLower.length > 24 && qLower.includes(aLower)) return null;
      if (qLower.length > 24 && aLower.includes(qLower)) return null;
      // Real answers rarely end with '?' (True/False aside).
      if (answer.endsWith('?') && !/^(?:true|false)$/i.test(answer)) return null;
      // Pure punctuation / counters.
      if (!/[a-z0-9\u00c0-\u024f]/i.test(answer)) return null;

      return { question, answer, verified: !!verified };
    }

    /* ── HUD logging (shared #qb-log / .hud-log-line classes) ───────────── */

    function appendLogLine(level, text) {
      if (!logEl) return;
      const row = document.createElement('div');
      row.className = 'hud-log-line ' + level;
      const stamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      row.textContent = '[' + stamp + '] ' + text;
      logEl.appendChild(row);
      while (logEl.children.length > 120) logEl.removeChild(logEl.firstChild);
      logEl.scrollTop = logEl.scrollHeight;
    }

    function logHUD(level, text) {
      const safeLevel = String(level || 'info');
      const message = String(text == null ? '' : text);
      if (!logEl) {
        pendingLog.push([safeLevel, message]);
        if (pendingLog.length > 60) pendingLog.shift();
      } else {
        appendLogLine(safeLevel, message);
      }
      try {
        console.log('[Harvest/' + safeLevel + '] ' + message);
      } catch (error) { /* console may be unavailable */ }
    }

    // mascot.js tees this function when it boots; keeping the same global name
    // as content.js means the 7-cat reacts to HUD output on every site.
    window.logHUD = logHUD;

    function setStatus(text, className) {
      if (!statusEl) return;
      statusEl.textContent = text;
      statusEl.className = className || '';
      statusEl.title = text;
    }

    function delay(ms) {
      return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
    }

    /* ── Instant enable/disable (BOT_ENABLED) ───────────────────────────── */

    // popup.js writes BOT_ENABLED to chrome.storage.local and mirrors it to
    // .sync; local wins when present, `!== false` means enabled.
    function readBotEnabled(callback) {
      const done = (value) => { try { callback(value !== false); } catch (error) { /* ignore */ } };
      try {
        chrome.storage.local.get('BOT_ENABLED', (local) => {
          if (chrome.runtime.lastError) { done(true); return; }
          if (local && local.BOT_ENABLED !== undefined) { done(local.BOT_ENABLED); return; }
          try {
            chrome.storage.sync.get('BOT_ENABLED', (sync) => {
              if (chrome.runtime.lastError) { done(true); return; }
              done(sync ? sync.BOT_ENABLED : undefined);
            });
          } catch (error) { done(true); }
        });
      } catch (error) { done(true); }
    }

    // Show/hide the panel with an inline display: #qb-hud is a flex column, so
    // restoring with 'flex' keeps the expanded panel and the 🐾 pill identical.
    function setPanelVisible(visible) {
      if (!hudEl) return;
      hudEl.style.display = visible ? 'flex' : 'none';
    }

    function applyBotEnabled(enabled) {
      const next = enabled !== false;
      const changed = next !== botEnabled;
      botEnabled = next;
      if (!next) {
        if (busy) {
          // Kills the in-flight page/course run immediately.
          stopRequested = true;
          if (abortController) {
            try { abortController.abort(); } catch (error) { /* already aborted */ }
          }
          setBusy(false);
          setStatus('stopped', 'stopped');
          logHUD('warn', changed ? 'Bot stopped — disabled from the popup.' : 'Bot stopped.');
        }
        setPanelVisible(false);
        return;
      }
      setPanelVisible(true);
      if (changed) logHUD('info', 'Bot enabled — harvester ready.');
    }

    function watchBotEnabled() {
      if (enabledWatched) return;
      enabledWatched = true;
      try {
        if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.onChanged) return;
        chrome.storage.onChanged.addListener((changes, areaName) => {
          try {
            if (areaName !== 'local' && areaName !== 'sync') return;
            if (!changes || !changes.BOT_ENABLED) return;
            const value = changes.BOT_ENABLED.newValue;
            applyBotEnabled(value === undefined ? true : value);
          } catch (error) { /* never break the page */ }
        });
      } catch (error) { /* storage events unavailable */ }
      readBotEnabled((enabled) => applyBotEnabled(enabled));
    }

    /* ── HUD construction ───────────────────────────────────────────────── */

    function makeButton(id, label, title) {
      const button = document.createElement('button');
      button.type = 'button';
      button.id = id;
      button.className = 'qb-btn';
      button.textContent = label;
      button.title = title || label;
      return button;
    }

    function setCollapsed(next) {
      collapsed = !!next;
      if (!hudEl) return;
      hudEl.classList.toggle('qb-collapsed', collapsed);
      hudEl.classList.toggle('qb-expanded', !collapsed);
      if (minimizeBtn) {
        minimizeBtn.textContent = collapsed ? '🐾' : '—';
        minimizeBtn.title = collapsed ? 'Expand harvester' : 'Minimize harvester';
        minimizeBtn.setAttribute('aria-label', minimizeBtn.title);
        minimizeBtn.setAttribute('aria-expanded', String(!collapsed));
      }
    }

    function flushPendingLog() {
      const rows = pendingLog.splice(0, pendingLog.length);
      rows.forEach(([level, text]) => appendLogLine(level, text));
    }

    function buildHud() {
      const existing = document.getElementById(HUD_ID);
      if (existing) {
        hudEl = existing;
        logEl = existing.querySelector('#' + LOG_ID);
        statusEl = existing.querySelector('#' + STATUS_ID);
        setPanelVisible(botEnabled);
        return;
      }

      const hud = document.createElement('div');
      hud.id = HUD_ID;
      hud.className = 'qb-hud';
      hud.setAttribute('role', 'complementary');
      hud.setAttribute('aria-label', 'Quiz bank harvester');

      const header = document.createElement('div');
      header.id = 'qb-hud-header';

      const title = document.createElement('span');
      title.id = 'qb-hud-title';
      title.textContent = '🐾 Harvest';

      statusEl = document.createElement('span');
      statusEl.id = STATUS_ID;
      statusEl.textContent = 'idle';

      minimizeBtn = document.createElement('button');
      minimizeBtn.type = 'button';
      minimizeBtn.id = 'qb-minimize-btn';
      minimizeBtn.textContent = '—';
      minimizeBtn.title = 'Minimize harvester';
      minimizeBtn.setAttribute('aria-label', 'Minimize harvester');
      minimizeBtn.setAttribute('aria-expanded', 'true');

      header.append(title, statusEl, minimizeBtn);

      const body = document.createElement('div');
      body.id = 'qb-hud-body';

      logEl = document.createElement('div');
      logEl.id = LOG_ID;
      logEl.className = 'qb-log';
      logEl.setAttribute('role', 'log');
      logEl.setAttribute('aria-live', 'polite');
      body.appendChild(logEl);

      const hint = document.createElement('div');
      hint.id = 'qb-hud-hint';
      hint.textContent = 'Highlight text for an instant capture, or harvest the whole page.';
      body.appendChild(hint);

      const actions = document.createElement('div');
      actions.id = 'qb-actions';

      pageBtn = makeButton('qb-harvest-page', 'Harvest Page', 'Harvest Q&A pairs from this page');
      courseBtn = makeButton('qb-harvest-course', 'Harvest Course', 'Loop ?page=1, ?page=2, … for this course');
      stopBtn = makeButton('qb-stop', 'Stop', 'Stop the running harvest');

      actions.append(pageBtn, courseBtn, stopBtn);
      hud.append(header, body, actions);

      const anchor = document.body || document.documentElement;
      anchor.appendChild(hud);

      hudEl = hud;
      bindHudEvents(header);
      setCollapsed(!isStudyHost());
      refreshCourseButton();
      setBusy(false);
      setStatus('idle', '');
      setPanelVisible(botEnabled);
      flushPendingLog();
    }

    function bindHudEvents(header) {
      if (!header || !hudEl) return;

      minimizeBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        setCollapsed(!collapsed);
      });

      pageBtn.addEventListener('click', () => {
        harvestPage();
      });

      courseBtn.addEventListener('click', () => {
        harvestCourse();
      });

      stopBtn.addEventListener('click', () => {
        requestStop();
      });

      header.addEventListener('mousedown', (event) => {
        if (event.button !== 0) return;
        if (event.target && event.target.closest && event.target.closest('button')) return;
        const rect = hudEl.getBoundingClientRect();
        dragState = {
          offsetX: event.clientX - rect.left,
          offsetY: event.clientY - rect.top,
        };
        hudEl.style.left = rect.left + 'px';
        hudEl.style.top = rect.top + 'px';
        hudEl.style.right = 'auto';
        hudEl.style.bottom = 'auto';
        event.preventDefault();
      });

      document.addEventListener('mousemove', (event) => {
        if (!dragState || !hudEl) return;
        const maxLeft = Math.max(0, window.innerWidth - hudEl.offsetWidth - 4);
        const maxTop = Math.max(0, window.innerHeight - hudEl.offsetHeight - 4);
        const left = Math.min(maxLeft, Math.max(4, event.clientX - dragState.offsetX));
        const top = Math.min(maxTop, Math.max(4, event.clientY - dragState.offsetY));
        hudEl.style.left = left + 'px';
        hudEl.style.top = top + 'px';
      }, { passive: true });

      document.addEventListener('mouseup', () => {
        dragState = null;
      }, { passive: true });

      // Keep a dragged panel inside the viewport when it is resized.
      window.addEventListener('resize', () => {
        if (!hudEl || !hudEl.style.left) return;
        const rect = hudEl.getBoundingClientRect();
        const left = Math.min(rect.left, Math.max(4, window.innerWidth - hudEl.offsetWidth - 4));
        const top = Math.min(rect.top, Math.max(4, window.innerHeight - hudEl.offsetHeight - 4));
        hudEl.style.left = left + 'px';
        hudEl.style.top = top + 'px';
      }, { passive: true });
    }

    function setBusy(next) {
      busy = !!next;
      if (pageBtn) pageBtn.disabled = busy;
      if (stopBtn) stopBtn.disabled = false;
      if (hudEl) hudEl.classList.toggle('qb-busy', busy);
      refreshCourseButton();
    }

    function requestStop() {
      if (!busy) {
        setStatus('idle', '');
        logHUD('info', 'Idle — nothing is running.');
        return;
      }
      stopRequested = true;
      setStatus('stopping', 'waiting');
      logHUD('warn', 'Stop requested — halting harvest.');
      if (abortController) {
        try { abortController.abort(); } catch (error) { /* already aborted */ }
      }
    }

    /* ── Strategy 1: highlighted selection ─────────────────────────────── */

    const QUESTION_START_RE = /^(?:q(?:uestion)?\s*#?\s*\d*\s*[:.)\-]|(?:\d{1,3})[.)])\s*/i;
    const CHOICE_RE = /^(?:\(?[a-h]\)?|[ivx]{1,4})[.)]\s+(.+)$/i;
    const BULLET_RE = /^[-*•·]\s+(.+)$/;

    function readSelectionText() {
      try {
        const active = document.activeElement;
        if (active && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT')) {
          const start = typeof active.selectionStart === 'number' ? active.selectionStart : 0;
          const end = typeof active.selectionEnd === 'number' ? active.selectionEnd : 0;
          if (end > start) {
            const value = String(active.value || '').slice(start, end);
            if (value.trim()) return value;
          }
        }
        return String(window.getSelection ? window.getSelection().toString() : '');
      } catch (error) {
        return '';
      }
    }

    function parseHighlightedSelection(rawText) {
      const text = String(rawText || '').replace(/\r\n?/g, '\n');
      const lines = text.split('\n').map((line) => norm(line)).filter(Boolean);
      if (!lines.length) return [];

      const blocks = [];
      let block = null;

      const beginBlock = (line) => {
        block = {
          question: [cleanQuestion(line)],
          answer: [],
          choices: [],
          verified: false,
        };
        blocks.push(block);
      };

      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];

        // "Q: …" / "Question 4: …" / "12. …" starts (or restarts) a block.
        if (QUESTION_START_RE.test(line)) {
          beginBlock(line);
          continue;
        }

        if (!block) {
          if (line.endsWith('?') || /^(?:q|question)\b/i.test(line)) beginBlock(line);
          continue;
        }

        // A fresh question line while the previous one has no answer yet.
        if (!block.answer.length && line.endsWith('?') && block.question.join(' ').trim()) {
          beginBlock(line);
          continue;
        }

        const answerLabel = line.match(ANSWER_LABEL_RE);
        if (answerLabel) {
          block.verified = block.verified || /^(?:correct|right)\b/i.test(line);
          block.answer.push(cleanAnswer(line.slice(answerLabel[0].length)));
          continue;
        }

        const correctLabel = line.match(CORRECT_LABEL_RE);
        if (correctLabel) {
          block.verified = true;
          block.answer.push(cleanAnswer(line.slice(correctLabel[0].length)));
          continue;
        }

        // "✓ Active Directory Domain Services" / "✅ Paris"
        if (CHECK_MARK_RE.test(line) && stripCheckMarks(line)) {
          block.verified = true;
          block.answer.push(stripCheckMarks(line));
          continue;
        }

        const choice = line.match(CHOICE_RE) || line.match(BULLET_RE);
        if (choice && !block.answer.length) {
          const isCorrect = /[\u2705\u2714\u2713\u2611\u2610]/.test(line);
          const choiceText = cleanAnswer(choice[1] || line);
          if (choiceText) {
            block.choices.push({ text: choiceText, correct: isCorrect });
            if (isCorrect) {
              block.verified = true;
              block.answer.push(choiceText);
            }
          }
          continue;
        }

        if (block.answer.length) block.answer.push(cleanAnswer(line));
        else block.question.push(norm(line));
      }

      const pairs = [];
      blocks.forEach((item) => {
        const question = cleanQuestion(item.question.join(' '));
        let answer = cleanAnswer(item.answer.join(' '));
        let verified = item.verified;
        if (!answer && item.choices.length === 1) {
          answer = item.choices[0].text;
          verified = verified || item.choices[0].correct;
        }
        const pair = makePair(question, answer, verified);
        if (pair) pairs.push(pair);
      });

      // Plain "question?" / "answer" selections without any label at all.
      if (!pairs.length) {
        for (let i = 0; i < lines.length - 1; i += 1) {
          if (!lines[i].endsWith('?')) continue;
          const candidate = cleanAnswer(lines[i + 1]);
          if (!candidate || candidate.endsWith('?')) continue;
          const pair = makePair(cleanQuestion(lines[i]), candidate, false);
          if (pair) pairs.push(pair);
        }
      }

      return pairs;
    }

    /* ── Strategy 2: amauoed.com cards ──────────────────────────────────── */

    function extractAmauoed(root) {
      const out = [];
      if (!root || !root.querySelectorAll) return out;
      let badges = [];
      try {
        badges = Array.from(root.querySelectorAll('.chip.bg-success, .bg-success'));
      } catch (error) {
        badges = [];
      }

      badges.forEach((badge) => {
        if (!/correct/i.test(norm(badge.textContent))) return;
        if (badge.closest && badge.closest('#' + HUD_ID)) return;

        const scope = (badge.closest && (
          badge.closest('.card') ||
          badge.closest('.list-group-item') ||
          badge.closest('li')
        )) || badge.parentElement;
        if (!scope) return;

        // The answer lives beside the green "Correct" chip, usually in <strong>.
        const answerOwner = (badge.closest && badge.closest('strong, b')) || badge.parentElement;
        let answer = '';
        if (answerOwner) {
          const clone = answerOwner.cloneNode(true);
          try {
            clone.querySelectorAll('.chip, .badge, .bg-success, .bg-primary').forEach((node) => node.remove());
          } catch (error) { /* ignore */ }
          answer = cleanAnswer(clone.textContent);
        }
        if (!answer) return;

        const questionEl = scope.querySelector('.mb-2, .question, .question-text, .qtext, .prompt');
        if (!questionEl || questionEl === answerOwner) return;

        const pair = makePair(cleanQuestion(questionEl.textContent), answer, true);
        if (pair) out.push(pair);
      });

      return out;
    }

    /* ── Strategy 3: Quizlet term cards ─────────────────────────────────── */

    function extractQuizlet(root) {
      const out = [];
      if (!root || !root.querySelectorAll) return out;

      let containers = [];
      try {
        containers = Array.from(root.querySelectorAll('.SetPageTerm-content, .SetPageTerm'));
      } catch (error) {
        containers = [];
      }

      containers.forEach((container) => {
        const word = container.querySelector('.SetPageTerm-wordText');
        const definition = container.querySelector('.SetPageTerm-definitionText');
        if (!word || !definition) return;
        const pair = makePair(word.textContent, definition.textContent, false);
        if (pair) out.push(pair);
      });

      // Quizlet's newer card markup (data-testid cards with .TermText spans).
      if (!out.length) {
        let cards = [];
        try {
          cards = Array.from(root.querySelectorAll('[data-testid="set-page-card"], [data-testid="card"]'));
        } catch (error) {
          cards = [];
        }
        cards.forEach((card) => {
          const texts = Array.from(card.querySelectorAll('.TermText, [class*="TermText"]'))
            .map((node) => norm(node.textContent))
            .filter(Boolean);
          if (texts.length < 2) return;
          const pair = makePair(texts[0], texts[1], false);
          if (pair) out.push(pair);
        });
      }

      return out;
    }

    /* ── Strategy 4: generic DOM heuristic ──────────────────────────────── */

    const INLINE_ANSWER_RE = /\b(?:correct\s+)?(?:answer|ans)\s*[:.)\-]\s*(.{1,400})$/i;

    function looksLikeQuestion(text) {
      const value = norm(text);
      if (value.length < 8 || value.length > 700) return false;
      if (value.endsWith('?')) return true;
      if (/^(?:q|question)\s*#?\s*\d*\s*[:.)\-]/i.test(value)) return true;
      if (QUESTION_PREFIX_RE.test(value)) return true;
      return /^(?:what|which|who|whom|when|where|why|how|define|describe|explain|identify|list|name|state|give|true or false)\b/i.test(value);
    }

    function isVerifiedAnswerElement(element, rawText) {
      try {
        if (CHECK_MARK_RE.test(String(rawText || ''))) return true;
        const className = String(element.className || '');
        if (/\b(correct|right-?answer|rightanswer|answer-correct|bg-success|is-correct|verified)\b/i.test(className)) return true;
        if (element.matches && element.matches('mark, .correct, .bg-success, [class*="correct" i]')) return true;
        if (element.closest && element.closest('mark, .correct, .bg-success, [class*="correct" i]')) return true;
      } catch (error) { /* ignore */ }
      return false;
    }

    function answerCandidate(element, questionText) {
      if (!element || element.nodeType !== 1) return null;
      if (element.closest && element.closest('#' + HUD_ID)) return null;
      const raw = norm(element.textContent);
      if (!raw || raw.length > ANSWER_MAX_CHARS) return null;
      const text = cleanAnswer(raw);
      if (!text || text.length > ANSWER_MAX_CHARS) return null;

      const qLower = questionText.toLowerCase();
      const aLower = text.toLowerCase();
      if (aLower === qLower) return null;
      if (aLower.length > 24 && qLower.includes(aLower)) return null;
      if (qLower.length > 24 && aLower.includes(qLower)) return null;
      if (STOP_ANSWERS.has(aLower)) return null;
      if (text.endsWith('?') && !/^(?:true|false)$/i.test(text)) return null;

      return {
        text,
        verified: isVerifiedAnswerElement(element, raw),
      };
    }

    function findGenericAnswer(node, questionText) {
      // <dt>Question</dt><dd>Answer</dd>
      if (node.tagName === 'DT') {
        const dd = node.nextElementSibling;
        if (dd && dd.tagName === 'DD') {
          const hit = answerCandidate(dd, questionText);
          if (hit) return hit;
        }
      }

      // <details><summary>Question?</summary>Answer…</details>
      if (node.tagName === 'SUMMARY' && node.parentElement) {
        const clone = node.parentElement.cloneNode(true);
        const summary = clone.querySelector('summary');
        if (summary) summary.remove();
        const hit = answerCandidate(clone, questionText);
        if (hit) return hit;
      }

      // Following siblings: the usual "question div, answer div" layout.
      let sibling = node.nextElementSibling;
      for (let i = 0; sibling && i < 3; i += 1, sibling = sibling.nextElementSibling) {
        const hit = answerCandidate(sibling, questionText);
        if (hit && !sibling.matches('ul, ol, table, form, nav')) return hit;
      }

      // Question and answer wrapped in separate spans inside neighbour divs.
      const parent = node.parentElement;
      if (parent) {
        let parentSibling = parent.nextElementSibling;
        for (let i = 0; parentSibling && i < 2; i += 1, parentSibling = parentSibling.nextElementSibling) {
          const hit = answerCandidate(parentSibling, questionText);
          if (hit && !parentSibling.matches('ul, ol, table, form, nav')) return hit;
        }
      }

      // Explicit answer / correct-answer nodes inside the same card.
      let container = null;
      try {
        container = (node.closest && node.closest(
          'li, article, section, tr, dl, .question, [class*="question" i], [class*="qa" i], [class*="card" i]'
        )) || parent;
      } catch (error) {
        container = parent;
      }
      if (container) {
        let answers = [];
        try {
          answers = Array.from(container.querySelectorAll(ANSWER_SELECTOR));
        } catch (error) {
          answers = [];
        }
        for (let i = 0; i < answers.length; i += 1) {
          if (node.contains(answers[i])) continue;
          const hit = answerCandidate(answers[i], questionText);
          if (hit) return hit;
        }
      }

      return null;
    }


    function extractGeneric(root) {
      const out = [];
      if (!root || !root.querySelectorAll) return out;

      let nodes = [];
      try {
        nodes = Array.from(root.querySelectorAll(QUESTION_SELECTOR));
      } catch (error) {
        nodes = [];
      }
      if (nodes.length > MAX_GENERIC_NODES) nodes = nodes.slice(0, MAX_GENERIC_NODES);

      for (let i = 0; i < nodes.length; i += 1) {
        if (out.length >= MAX_GENERIC_PAIRS) break;
        const node = nodes[i];

        try {
          if (node.closest('#' + HUD_ID)) continue;
          if (node.closest('nav, header, footer, aside, [role="navigation"], [aria-hidden="true"]')) continue;
          // Skip big wrappers; leaf-ish nodes carry a single question.
          if (node.querySelectorAll('p, li, h1, h2, h3, .question').length > 2) continue;

          const text = norm(node.textContent);
          if (!text || text.length > 700) continue;

          // "…? Answer: …" inside one block.
          const inline = text.match(INLINE_ANSWER_RE);
          if (inline && inline.index > 7) {
            const pair = makePair(text.slice(0, inline.index), inline[1], /correct/i.test(inline[0]));
            if (pair) { out.push(pair); continue; }
          }

          if (!looksLikeQuestion(text)) continue;
          const found = findGenericAnswer(node, cleanQuestion(text));
          if (!found) continue;
          const pair = makePair(text, found.text, found.verified);
          if (pair) out.push(pair);
        } catch (error) {
          // One odd node must never abort the whole harvest.
        }
      }

      return out;
    }

    function extractPagePairsFromDom() {
      const collected = [];
      const seen = new Set();
      const push = (pair) => {
        if (!pair) return;
        const signature = pairSignature(pair);
        if (seen.has(signature)) return;
        seen.add(signature);
        collected.push(pair);
      };

      if (isAmauoed()) extractAmauoed(document).forEach(push);
      if (isQuizlet()) extractQuizlet(document).forEach(push);
      extractGeneric(document).forEach(push);
      return collected;
    }

    /* ── Persistence + GitHub bank sync ─────────────────────────────────── */

    async function persistPairs(pairs, host, options) {
      const opts = options || {};
      const tag = sourceTagForHost(host);
      const seen = new Set();
      let saved = 0;
      let verified = 0;
      let skipped = 0;

      for (let i = 0; i < pairs.length; i += 1) {
        const pair = pairs[i];
        if (!pair) continue;
        const signature = pairSignature(pair);
        if (seen.has(signature)) { skipped += 1; continue; }
        seen.add(signature);
        try {
          if (typeof answerKeyPut !== 'function') throw new Error('answerKeyPut unavailable');
          await answerKeyPut(pair.question, pair.answer, tag, { verified: !!pair.verified });
          saved += 1;
          if (pair.verified) verified += 1;
        } catch (error) {
          const message = error && error.message ? error.message : String(error);
          logHUD('error', 'Bank write failed: ' + message);
        }
      }

      if (!opts.deferFlush && saved > 0) {
        try {
          if (typeof flushNow === 'function') await flushNow();
        } catch (error) {
          const message = error && error.message ? error.message : String(error);
          logHUD('warn', 'Bank flush failed: ' + message);
        }
      }

      return { saved, verified, skipped };
    }

    function requestGitHubBankPush() {
      safeSendMessage({ action: 'SYNC_GITHUB_BANK' }, (response, error) => {
        if (error) {
          logHUD('warn', 'GitHub bank sync unavailable: ' + error);
          return;
        }
        if (!response) return;
        if (response.error) {
          logHUD('warn', 'GitHub bank sync failed: ' + response.error);
          return;
        }
        if (response.status === 'skipped') {
          logHUD('info', 'GitHub bank not configured — pairs stay in the local bank.');
          return;
        }
        if (response.status === 'ok') {
          logHUD('success', 'GitHub bank pushed (' + (response.pushed || 0) + ' questions).');
        }
      });
    }

    /* ── Harvest Page ───────────────────────────────────────────────────── */

    let activeRunId = 0;

    function scheduleIdleStatus(runId) {
      window.setTimeout(() => {
        if (activeRunId !== runId || busy) return;
        setStatus('idle', '');
      }, 2600);
    }

    async function harvestPage() {
      if (!botEnabled) {
        logHUD('warn', 'Bot is disabled — enable it in the popup to harvest.');
        return;
      }
      if (busy) {
        logHUD('warn', 'Harvest is already running.');
        return;
      }
      if (!hudEl) buildHud();

      const host = currentHost() || 'this page';
      const runId = ++activeRunId;
      stopRequested = false;
      setBusy(true);
      setStatus('harvesting', 'running');
      logHUD('info', 'Harvest "' + host + '" — reading this page…');
      // Give the mascot's log observer a frame to see the start line.
      await delay(80);

      try {
        let strategy = '';
        let pairs = [];

        const selection = readSelectionText();
        if (norm(selection)) {
          pairs = parseHighlightedSelection(selection);
          if (pairs.length) strategy = 'highlighted text';
        }

        if (!pairs.length) {
          pairs = extractPagePairsFromDom();
          strategy = 'page DOM';
        }

        if (!pairs.length) {
          setStatus('empty', 'waiting');
          logHUD('warn', 'Harvesting failed: no Q&A pairs found — highlight a Q&A block or open a study page.');
          return;
        }

        logHUD('info', 'Harvest "' + host + '" — ' + pairs.length + ' candidate pair(s) from ' + strategy + '.');
        await delay(40);

        const result = await persistPairs(pairs, host);
        if (!result.saved) {
          setStatus('empty', 'waiting');
          logHUD('warn', 'Harvesting failed: nothing new to store on this page.');
          return;
        }

        setStatus('done', 'reviewing');
        const savedLabel = result.saved === 1 ? 'answer' : 'answers';
        logHUD('success', 'Harvested ' + result.saved + ' ' + savedLabel + ' from ' + host + '!');
        await delay(900);
        logHUD('info', 'Review page: ' + result.saved + ' pairs ready in the local bank.');
        requestGitHubBankPush();
        scheduleIdleStatus(runId);
      } catch (error) {
        const message = error && error.message ? error.message : String(error);
        setStatus('stopped', 'stopped');
        logHUD('error', 'Harvesting failed: ' + message);
      } finally {
        setBusy(false);
      }
    }


    /* ── Harvest Course (?page=1, ?page=2, …) ───────────────────────────── */

    function isCourseUrl() {
      try {
        const path = String(location.pathname || '');
        return /\/(?:courses?|class|classes|modules?|subjects?|sets?|study)(?:\/|$)/i.test(path);
      } catch (error) {
        return false;
      }
    }

    function hasPagination() {
      for (let i = 0; i < PAGINATION_SELECTORS.length; i += 1) {
        try {
          if (document.querySelector(PAGINATION_SELECTORS[i])) return true;
        } catch (error) { /* skip bad selector */ }
      }
      return false;
    }

    function courseHarvestAvailable() {
      return isCourseUrl() || hasPagination();
    }

    function refreshCourseButton() {
      if (!courseBtn) return;
      const available = courseHarvestAvailable();
      courseBtn.disabled = busy || !available;
      courseBtn.title = available
        ? 'Loop ?page=1, ?page=2, … for this course'
        : 'Needs a multi-page course or a paginated page';
    }

    function baseCourseUrl() {
      const url = new URL(location.href);
      url.searchParams.delete('page');
      url.hash = '';
      return url.toString();
    }

    function coursePageUrl(baseHref, page) {
      const url = new URL(baseHref);
      url.searchParams.set('page', String(page));
      return url.toString();
    }

    async function fetchHtml(url) {
      const controller = new AbortController();
      abortController = controller;
      const timer = setTimeout(() => {
        try { controller.abort(); } catch (error) { /* already aborted */ }
      }, FETCH_TIMEOUT_MS);
      try {
        const response = await fetch(url, {
          credentials: 'include',
          signal: controller.signal,
          headers: { Accept: 'text/html,application/xhtml+xml' },
        });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return await response.text();
      } finally {
        clearTimeout(timer);
        if (abortController === controller) abortController = null;
      }
    }

    function extractPairsFromHtml(html) {
      const collected = [];
      const seen = new Set();
      const push = (pair) => {
        if (!pair) return;
        const signature = pairSignature(pair);
        if (seen.has(signature)) return;
        seen.add(signature);
        collected.push(pair);
      };

      const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
      if (isAmauoed()) extractAmauoed(doc).forEach(push);
      if (isQuizlet()) extractQuizlet(doc).forEach(push);
      extractGeneric(doc).forEach(push);
      return collected;
    }

    async function harvestCourse() {
      if (!botEnabled) {
        logHUD('warn', 'Bot is disabled — enable it in the popup to harvest.');
        return;
      }
      if (busy) {
        logHUD('warn', 'Harvest is already running.');
        return;
      }
      if (!courseHarvestAvailable()) {
        logHUD('warn', 'Course harvest needs a course page or a paginated page.');
        return;
      }
      if (!hudEl) buildHud();

      const host = currentHost() || 'this page';
      const runId = ++activeRunId;
      const base = baseCourseUrl();
      stopRequested = false;
      setBusy(true);
      setStatus('harvesting', 'running');
      logHUD('info', 'Harvest "' + host + '" — course mode, starting at ?page=1…');
      await delay(80);

      const seenPairs = new Set();
      let savedTotal = 0;
      let verifiedTotal = 0;
      let pagesRead = 0;
      let lastSignature = '';

      try {
        for (let page = 1; page <= MAX_COURSE_PAGES; page += 1) {
          if (stopRequested || !botEnabled) break;
          setStatus('page ' + page, 'running');

          const url = coursePageUrl(base, page);
          let pagePairs = [];

          try {
            const html = await fetchHtml(url);
            if (stopRequested) break;
            pagePairs = extractPairsFromHtml(html);
          } catch (error) {
            if (stopRequested) break;
            const message = error && error.message ? error.message : String(error);
            // First page fallback: harvest what is already open in the tab.
            if (page === 1) {
              logHUD('warn', 'Harvest "' + host + '" — ?page=1 fetch failed (' + message + '), using the open tab.');
              pagePairs = extractPagePairsFromDom();
            } else {
              logHUD('warn', 'Harvest "' + host + '" — ?page=' + page + ' failed: ' + message);
              break;
            }
          }

          if (stopRequested) break;

          const fresh = pagePairs.filter((pair) => !seenPairs.has(pairSignature(pair)));
          if (!fresh.length) {
            logHUD('info', 'Harvest "' + host + '" — ?page=' + page + ' has no new pairs.');
            break;
          }

          const signature = fresh.map(pairSignature).join('|');
          if (signature === lastSignature) {
            logHUD('info', 'Harvest "' + host + '" — ?page=' + page + ' repeats the previous page.');
            break;
          }
          lastSignature = signature;
          fresh.forEach((pair) => seenPairs.add(pairSignature(pair)));

          const result = await persistPairs(fresh, host, { deferFlush: true });
          savedTotal += result.saved;
          verifiedTotal += result.verified;
          pagesRead += 1;

          logHUD('info', 'Harvest "' + host + '" — ?page=' + page + ': +' + result.saved + ' pair(s) stored.');
          await delay(120);
        }

        if (!savedTotal) {
          setStatus(stopRequested ? 'stopped' : 'empty', stopRequested ? 'stopped' : 'waiting');
          logHUD('warn', stopRequested
            ? 'Bot stopped — nothing stored.'
            : 'Harvesting failed: nothing new to store across the course.');
          return;
        }

        try {
          if (typeof flushNow === 'function') await flushNow();
        } catch (error) {
          const message = error && error.message ? error.message : String(error);
          logHUD('warn', 'Bank flush failed: ' + message);
        }

        setStatus(stopRequested ? 'stopped' : 'done', stopRequested ? 'stopped' : 'reviewing');
        const savedLabel = savedTotal === 1 ? 'answer' : 'answers';
        logHUD('success', 'Harvested ' + savedTotal + ' ' + savedLabel + ' from ' + host + '!');
        await delay(900);

        if (stopRequested) {
          logHUD('warn', 'Bot stopped — ' + savedTotal + ' pair(s) kept from ' + pagesRead + ' page(s).');
        } else {
          logHUD('info', 'Review page: ' + savedTotal + ' pairs ready in the local bank.');
          if (verifiedTotal) logHUD('info', 'Verified this run: ' + verifiedTotal + ' pair(s).');
          if (pagesRead >= MAX_COURSE_PAGES) logHUD('warn', 'Course page limit reached (' + MAX_COURSE_PAGES + ').');
        }

        requestGitHubBankPush();
        scheduleIdleStatus(runId);
      } catch (error) {
        const message = error && error.message ? error.message : String(error);
        setStatus('stopped', 'stopped');
        logHUD('error', 'Harvesting failed: ' + message);
      } finally {
        setBusy(false);
      }
    }

    /* ── Boot ───────────────────────────────────────────────────────────── */

    function ensureMounted() {
      if (!hudEl) return;
      if (!hudEl.isConnected) {
        try {
          (document.body || document.documentElement).appendChild(hudEl);
        } catch (error) { /* page may be tearing down */ }
      }
      refreshCourseButton();
    }

    function init() {
      try {
        if (document.getElementById(HUD_ID)) return;
        buildHud();
        watchBotEnabled();
        logHUD('info', 'Ready on ' + (currentHost() || 'this page') + ' — highlight text or use Harvest Page.');
        if (hasPagination()) {
          logHUD('info', 'Paginated page detected — Harvest Course can walk ?page=1, 2, 3…');
        }
        window.setInterval(ensureMounted, 5000);
        window.addEventListener('beforeunload', () => {
          if (abortController) {
            try { abortController.abort(); } catch (error) { /* ignore */ }
          }
        });
      } catch (error) {
        try { console.warn('[Harvest] init failed:', error); } catch (ignore) { /* ignore */ }
      }
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
      init();
    }
  })();
} catch (error) {
  try { console.warn('[Harvest] disabled:', error); } catch (ignore) { /* ignore */ }
}


  window.__qbTmBankStorage = { mergeRemoteBankIntoLocal, answerKeyGetAll, flushNow };
  window.__qbTmReloadConfig = loadConfig;
  const qbTmHarvesterGearTimer = setInterval(() => {
    const header = document.getElementById('qb-hud-header');
    if (header) {
      qbTmAddGearButton(header);
      clearInterval(qbTmHarvesterGearTimer);
    }
  }, 250);
  })();
}

;
/* ─────────────────────────────────────────────────────────────────────────────
   mascot.js — three global pixel-art cats for the Quiz Bot.

   HARD RULE: this file never touches quiz logic. It cannot click, submit,
   navigate or block anything:
     • no element.click(), no preventDefault(), no stopPropagation();
     • every page listener is passive and side-effect free;
     • state is inferred read-only (DOM observation + a pass-through tee on the
       HUD logger that only *reads* the text, then delegates unchanged);
     • the whole file is wrapped in try/catch, so a mascot bug can only ever
       disable the mascot — quiz solving, review learning and GitHub bank
       syncing keep running exactly as in previous version/content.js.

   PIXEL ENGINE (no images): a 96×96 <canvas> with `image-rendering: pixelated`
   draws hand-plotted 24×24 pixel-matrix frames at ~7 FPS. Every state is pure
   JS (tail wag, blink, ear twitch, trot cycle, glasses, laptop, pickaxe…), so
   the mascot weighs nothing and never waits on a download.

   3-CAT SQUAD, every tab ("Cat squad presence" below): the roster is
   Mochi (orange tabby, hyper speedrunner), Luna (tuxedo, deadpan genius) and
   Boba (calico, sleepy loot goblin). `CAT_SQUAD` in chrome.storage.local holds
   three assignment slots; each working tab claims the specialist for its job
   (exam → Mochi, review → Luna, harvest → Boba) and a second, third tab picks
   one of the remaining free cats, so several tabs work in parallel. Tabs with
   no cat hide the workers and show a live "🐾 Working: Mochi (Exam) • …" pill.
   When every job ends the focused tab gets Mochi back, who naps after 35 s of
   stillness and wakes the moment he is clicked or a quiz/harvest starts.

   SUMMON SQUAD ("Squad hangout" below): while idle, triple-click the cat (or
   click its hover badge) to gather cats that are free on other tabs. Busy cats
   stay with their work, and the badge count follows the live roster.

   States (all drawn by the pixel engine):
     idle       roams the bottom/side edges every 5–7 s (tail wag, blink, ear
                twitch), random cat quotes every 6–8 s (petting lines on click)
     walk       4-frame trot while gliding somewhere; flips scaleX(-1) when
                moving left
     nap        curls into a ball with rising pixel Zzz after 35 s of stillness
     thinking   "Reading the question... 👀" → "Hmm... let me think 🤔"
                (paw on chin + floating ... / ?)
     answering  "AHA!! Found it! ✨" (~0.8 s happy hop, pixel ! + sparkles)
     clicking   paw-slap onto the exact radio dot / checkbox, then a hop to the
                Next page button (input[name="next"])
     nextpage   "Next page!! 🐾➡️" (1.1 s) paw-slap on the blue button
     typing     tiny pixel laptop with alternating paw-tapping frames
     harvesting pickaxe swinging with flying pixel star particles while the HUD
                streams harvest progress → "Scooped X answers!! 🐟✨"
     review     pixel reading glasses slide onto the eyes (white lens glint); the
                cat glides down the .que blocks of /mod/quiz/review.php while
                content.js scans, showing "Scanned! Saved X answers (Y new) •
                GitHub ✓" in the bubble

   Interaction (all cosmetic — none of it can reach quiz logic):
     click          playful petting line from PET_LINES (shuffle-no-repeat)
     double-click   1.8 s answering cheer from HYPE_LINES → back to the state
     mouseenter     occasional curious hint from HOVER_LINES (12 s cooldown)
     low timer      on /attempt.php, ≤5 min left → review pose + "HALA!! ..." alarm
     review score   .quizreviewsummary ≥90% / ≥75% / <75% celebration lines

   LOCAL CAT BRAIN CORE ("Local Cat Brain Core" below) — zero API keys, zero
   network. Passive sensors only (the clipboard is never read, keystrokes are
   counted, never captured):
     page identity  hostname + cleaned document.title + course code (/[A-Z]{2,4}\d{4}/)
     typing bursts  keydown count per burst → "12 keys in a burst! Essay mode??"
     copy / cut     "I saw you copy that!! Saving braincells? 👀📋"
     cursor         throttled mousemove → pupils follow the pointer, a fast flick
                    plays the whisker-wiggle dizzy wobble
     scroll         px/s velocity → "WHOA slow down scrolling!! 🎢🙀"
     memory         CAT_BRAIN_MEMORY in chrome.storage.local (tabHopsToday,
                    petCount, copyCount, keyCount, bankCount, day)
   composeCatThought() fills template pools with that live context (late-night
   00:00–04:59 lines, YouTube / Messenger / GitHub / AI-tab commentary, bank size,
   pet and tab-hop counters) and never repeats a recent line.

   SWITCH: popup.js writes BOT_ENABLED to chrome.storage.local (mirrored to
   .sync). `false` hides the cat and the busy pill on every open tab instantly
   and stops him claiming ownership; `true` restores him where he belongs.
   No reload, ever.

   ───────────────────────────────────────────────────────────────────────────── */
try {
  (function () {
    'use strict';

    /* ── Ids, assets, speech, timings ─────────────────────────────────────── */

    const WRAP_ID = 'qb-mascot-wrap';
    const IMG_CLASS = 'qb-mascot-img';
    const BUBBLE_ID = 'qb-mascot-bubble';
    const STYLE_ID = 'qb-mascot-style';
    const PILL_ID = 'qb-mascot-pill';
    const HUD_HOST_ID = 'moodle-quiz-bot-hud';
    const SQUAD_CAT_CLASS = 'qb-squad-cat';
    const SQUAD_CANVAS_CLASS = 'qb-squad-canvas';
    const SQUAD_BUBBLE_CLASS = 'qb-squad-bubble';
    const SQUAD_BADGE_CLASS = 'qb-squad-badge';
    const SQUAD_BADGE_HIDDEN = 'qb-squad-badge-hidden';

    const SIZE = 130;        // px — square cat
    const BUBBLE_MAX = 175;  // px — widest the speech bubble can render
    const EDGE = 16;         // px — viewport margin (left / top / bottom)
    const RIGHT_GUARD = 24;  // px — extra room reserved on the right edge
    const GAP = 10;          // px — gap when parking beside a Moodle element
    // Right-edge footprint: the bubble (175 px, right-aligned to the wrap) is
    // wider than the 130 px cat, so the wider of the two drives the clamp.
    const MASCOT_WIDTH = Math.max(SIZE, BUBBLE_MAX);

    // Every state the pixel engine can draw. `walk` and `nap` are rendered from
    // idle/catnap flags rather than set through setState(), but they still live
    // here so the external `qb-mascot-state` hook can play them.
    const STATES = [
      'idle', 'walk', 'nap', 'thinking', 'answering',
      'clicking', 'nextpage', 'typing', 'harvesting', 'review',
    ];

    function isKnownState(state) {
      return STATES.indexOf(String(state || '')) >= 0;
    }

    // The two "action" animations replay the exact move the bot just made:
    // slapping a radio/checkbox/dropdown option, or typing into a text box.
    const ACTION_STATES = ['clicking', 'typing'];

    const SPEECH = {
      reading: 'Reading the question... 👀',
      thinking: 'Hmm... let me think 🤔',
      answering: 'AHA!! Found it! ✨',
      clicking: 'Slapping that answer!! 🐾💥',
      nextpage: 'Next page!! 🐾➡️',
      typing: 'Typing the answer... ⌨️🐾',
      harvesting: 'Digging up answers... 🐾⛏️',
      scooped: (count) => 'Scooped ' + count + ' answers!! 🐟✨',
      review: 'Checking your score... 👀',
      learned: (count) => 'Learned ' + count + ' right! Purrfect 🎓',
    };

    const IDLE_QUOTES = [
      'Meow... waiting for a quiz! 🐾',
      'Manifesting 1.00 flat... purr ✨',
      'Checking my 1 braincell... 0 found 😿',
      'Don\'t forget to click Review after! 📖',
      'GitHub bank locked & loaded 🐟',
      'Kaya natin \'to, click Run na! 💪',
      'Sip water while I scan~ 💧🐾',
      'No thoughts, head empty, only 100% score',
      'Study now, bawal bumagsak 📚😾',
      'Feed me questions, hooman 🐟',
      'Cramming is a lifestyle, purr 😹',
      'Deadline? More like dead-tired 🐾💀',
      'Recitation later, cat nap now 😴',
      'God bless sa quiz, laban tayo! 🙏🐾',
      'Pretending I reviewed the modules 📖😼',
      'Calculator ba need dito? 🧮',
      'Ready when you are! Click Run~ 🐱',
      '8 AM class? I sleep through it 😾',
      'One more question please, I behave 🥺',
      'Remember to open Review after! 📖',
      'Confidence 100, knowledge 40 😹',
      'Bonak sa quiz, bawi sa Finals 💪',
      'I roam, therefore I answer. 🐈',
      'Coffee for hooman, canned tuna for me ☕🐟',
      'Group project? I only do solo 😼',
      'Zero naps until the bank syncs 😼',
      'Attendance is 20%, effort is 100% 🐾',
      'Waiting for that sweet 1.00 sighting 🎓',
      'My answers are 99% purr-fect, 1% cat hair 🐈',
      'Click Run before my braincell expires ⌛😿',
    ];

    // Every pool below is drawn through pickFreshLine(), so no line ever repeats
    // back-to-back and a long exam session keeps hearing fresh material.
    const READING_LINES = [
      SPEECH.reading,
      'Basahin ko muna, wait lang 👀',
      'Wait lang, reading carefully 👀',
      'Scanning the question text 🔍',
    ];

    const THINKING_LINES = [
      SPEECH.thinking,
      'Hmm... let me cook 🤔',
      'Scanning my braincells... 🔍',
      'Wait lang, reading carefully 👀',
      'Processing... purr-cessing 🐾',
      'Consulting the GitHub bank 🐟',
      'Checking amauoed.com real quick 👀',
      'Hmm, familiar ba \'to? 🤔',
    ];

    const CLICKING_LINES = [
      SPEECH.clicking,
      'Boop! Selected! ✨',
      'Easy pick right here! 😼',
      'Tapped it, no hesitation 🐾',
      'That option, final answer 😼',
      'Picked with my paw, 100% accurate 🐾',
    ];

    const TYPING_LINES = [
      SPEECH.typing,
      'FURIOUS TYPING NOISES ⌨️🔥',
      'Speedrunning this blank box 🐾💻',
      'Typing like my tuition depends on it ⌨️😾',
      'Fill in the blank, fill my heart 💖⌨️',
    ];

    const PET_LINES = [
      'Meow?! I\'m working here! 😾',
      'Purrrr~ +10 luck on your exam 🍀',
      'Petting the cat increases accuracy by 99% 🐾',
      'Mrrp! That tickles 🐱',
      'Head scritches accepted, focus restored ✨',
      'One pet = one correct answer (not really) 😼',
      'Purr... continue, hooman 🐾',
    ];

    const HYPE_LINES = [
      'LET\'S GOOOO!! 🔥🐾',
      'UNSTOPPABLE!! ✨',
      'KAYA NATIN \'TO!! 1.00 LANG!! 🎓🔥',
      'CHEER MODE: ON 🐾📣',
      'Manifesting perfect-score energy ✨🐱',
    ];

    const HOVER_LINES = [
      'Need help? Hit Run! 👀',
      'Psst... you can drag me anywhere 🐾',
      'Stuck? Click Run and I\'ll cook 🤔',
      'I can\'t help by just hovering, you know 😼',
      'Double-click me if you need hype 🔥',
    ];

    // Catnap + global-presence dialogs. A napping cat mumbles NAP_LINES, wakes
    // with WAKE_LINE, and the idle cat greets the tab it just followed with
    // FOLLOW_LINES (all drawn through pickFreshLine, so nothing repeats).
    const NAP_LINES = [
      'Zzz... taking a quick catnap 💤🐾',
      'Dreaming of 100% exam scores... 🐟💤',
      'Wake me up when the next quiz starts~ 😴',
    ];

    const WAKE_LINE = 'Yawn~ Ready to work!! 🐾✨';

    const FOLLOW_LINES = [
      'Meow! Followed you over here~ 🐾',
      'Done working! What are we doing on this tab? 👀',
    ];

    const PANIC_LINE = 'HALA!! Under 5 mins left!! ⏰🙀';

    const SCORE_HIGH_LINES = [
      'SHEESH!! High score!! Certified Dean\'s Lister 🎓✨',
      'Grabe ang galing, 1.00 energy 🎓✨',
      'Top of the class behavior detected 🎓🐾',
    ];

    const SCORE_PASS_LINES = [
      'Solid pass!! Synced new answers to GitHub 😎🐾',
      'Panalo! Passed with style 😎🐾',
      'Good score, bank updated, tuloy ang laban 😎',
    ];

    const SCORE_LOW_LINES = [
      'Bawi next attempt! Saved the right ones 📖💪',
      'Okay lang \'yan, next attempt panalo 📖💪',
      'Charge to experience, saved the rights 📖🐾',
    ];

    /* ── The 3-Cat Squad roster ───────────────────────────────────────────── */

    // Three specialists share the global squad. `palette` overrides the base
    // pixel palette (P) and `lines` feeds every bubble the cat speaks, so each
    // one has a distinct colour scheme, pixel accessory and voice.
    //   Mochi — warm orange tabby + red pixel bandana — hyper speedrunner
    //   Luna  — black & white tuxedo + dark pixel shades — deadpan genius
    //   Boba  — cream calico + tiny green sprout — sleepy loot goblin
    const CATS = {
      mochi: {
        id: 'mochi',
        name: 'Mochi',
        role: 'Hyper Speedrunner',
        fur: 'Orange Tabby',
        palette: {
          fur: '#f5a15c',
          furDark: '#d67b36',
          white: '#fff4e6',
          pink: '#ff9fb2',
          nose: '#e2688a',
          eye: '#3ddc84',
          pupil: '#1b2430',
        },
        lines: {
          idle: [
            'SPEEDRUN MODE ACTIVATED!! 🔥🐾',
            'Ez clap next question!! ⚡',
            'No warm-up, straight to 1.00 🏁',
            'Click Run, I already stretched my paws 🔥',
            'Faster than the page loads, purr ⚡',
            'Next question? Born ready 🐾💨',
            'Kaya natin \'to, speedrun na!! 🔥🎓',
          ],
          thinking: [
            'Reading at 2x speed... 👀⚡',
            'Scanning, no time to blink!! 🔍🔥',
            'Locking in, brain at max RPM 🧠💨',
          ],
          clicking: [
            'BOOP! Next!! ⚡🐾',
            'Tapped it before it loaded 😼💥',
            'Speed click, no hesitation!! 🔥',
          ],
          typing: [
            'FURIOUS TYPING NOISES ⌨️🔥',
            'Typing at 120 WPM, paws only ⌨️💨',
          ],
          pet: [
            'Pet me later, we are speedrunning!! 🔥😾',
            'One quick purr, then BACK TO WORK ⚡',
            'Pet = +10 speed. Confirmed. 🐾🔥',
          ],
          hype: [
            'LET\'S GOOOO!! 🔥🐾',
            'UNSTOPPABLE!! ✨⚡',
            'SPEEDRUN THE WHOLE QUIZ!! 🏁🔥',
          ],
          harvest: [
            'Digging at full sprint!! 🐾⛏️💨',
            'Scoop scoop scoop, no stopping!! 🐟⚡',
          ],
          review: [
            'Score check, quick quick quick 👀⚡',
            'Reviewing at turbo speed 🔍🔥',
          ],
          nap: [
            'Power nap: 45 seconds. Go. 💤⚡',
            'Recharging turbo... do not wake me... 💤',
          ],
          hang: [
            'Race you to the Next button!! 🔥🐾',
            'I did 400 laps around this tab today ⚡',
            'Luna, analyze THIS!! *zooms past* 🐾💨',
            'Boba wake up, we are training!! 🔥💤',
          ],
        },
      },
      luna: {
        id: 'luna',
        name: 'Luna',
        role: 'Deadpan Genius',
        fur: 'Black & White Tuxedo',
        palette: {
          fur: '#f2f0ea',
          furDark: '#2b2d3a',
          white: '#ffffff',
          pink: '#f2b8c6',
          nose: '#e58aa5',
          eye: '#7fd4ff',
          pupil: '#10131c',
        },
        lines: {
          idle: [
            'Statistically speaking, it\'s B. 🕶️',
            'My IQ is 9999. Next. ✨',
            'I have already predicted the answer. 🕶️📈',
            'Probability of a 1.00: acceptable. ✨',
            'No rush. I am always right anyway. 🕶️',
            'Observe. Analyze. Answer. Repeat. 🧠',
          ],
          thinking: [
            'Statistically speaking... 🕶️',
            'Calculating all four options. Stand by. 📈',
            'My analysis says this is trivial. 🧠',
          ],
          clicking: [
            'Correct choice. Obviously. 🕶️✨',
            'Selected. As predicted. 📈',
            'The data agrees with me. 🕶️',
          ],
          typing: [
            'Composing a statistically optimal answer ⌨️🕶️',
            'Words. Precisely chosen. ⌨️',
          ],
          pet: [
            'Your pet has been logged. 🕶️',
            'Affection detected. ...Acknowledged. ✨',
            'I allow this. Briefly. 🕶️',
          ],
          hype: [
            'My IQ is 9999. Next. ✨',
            'I predicted this success. 🕶️✨',
            'Efficiency: impeccable. 🕶️',
          ],
          harvest: [
            'Cataloguing answers with precision 🕶️⛏️',
            'Data extraction in progress. Do not disturb. 📈',
          ],
          review: [
            'Cross-referencing every answer. 🕶️🔍',
            'The score is... as calculated. ✨',
          ],
          nap: [
            'Resting my 9999 IQ. 🕶️💤',
            'Even geniuses require REM sleep. 💤',
          ],
          hang: [
            'Statistically, I am the best cat here. 🕶️',
            'Boba, your nap schedule is inefficient. 📈',
            'Mochi, speed without accuracy is chaos. 🕶️',
            'I calculated a 97% chance you two are chaos. 🕶️📈',
          ],
        },
      },
      boba: {
        id: 'boba',
        name: 'Boba',
        role: 'Sleepy Loot Goblin',
        fur: 'Cream Calico',
        palette: {
          fur: '#f6e3bd',
          furDark: '#a9773f',
          white: '#fffaf0',
          pink: '#f7b6c2',
          nose: '#d98fa0',
          eye: '#8ee08a',
          pupil: '#1b2430',
        },
        lines: {
          idle: [
            'Ooh shiny answers!! *nom nom* 🐟⛏️',
            'Are we done yet? I need a nap... 💤',
            'I found a snack in the answer bank 🐟✨',
            'Five more minutes of harvesting, then nap 😴⛏️',
            'My loot pouch is full of answers 🎒🐟',
            'Wake me when the fish— I mean quiz— is ready 🐟💤',
          ],
          thinking: [
            'Hmm... what was the question again? 🐟💤',
            'Thinking... mostly about snacks 🍪🤔',
            'Brain loading... *yawn* 💤',
          ],
          clicking: [
            'Boop! Did I get it? 🐾🐟',
            'Click click, now snack break? 🍪',
            'Picked the shiniest option ✨🐾',
          ],
          typing: [
            'Typing... snacks... typing... 🍪⌨️',
            'My paws are sleepy but dedicated ⌨️💤',
          ],
          pet: [
            'Pet me and I will share my fish 🐟😽',
            'Purrrr... wake me at the next question 💤',
            'Snacks first, pets second 🍪🐾',
          ],
          hype: [
            'SHINY ANSWERS!! *nom nom* 🐟⛏️',
            'Loot party!! 🎒✨',
            'We did it! Snack time!! 🍪🎉',
          ],
          harvest: [
            'Ooh shiny answers!! *nom nom* 🐟⛏️',
            'Loot goblin mode: ON 🎒⛏️',
            'Digging for snacks— answers! 🐾⛏️',
          ],
          review: [
            'Checking score... then checking snacks 🍪👀',
            'Did we pass? Can I nap now? 💤',
          ],
          nap: [
            'Nap time... please do not harvest without me 💤🐟',
            'Five more minutes... 🍪💤',
          ],
          hang: [
            'Snack break? Snack break. 🍪🐾',
            'Are we done yet? I need a nap... 💤',
            'Mochi stop zooming, you spill my fish 🐟😾',
            'Luna, is napping statistically optimal? 💤🕶️',
          ],
        },
      },
    };

    const CHEER_MS = 1800;             // double-click answering cheer
    const PANIC_HOLD_MS = 3200;        // low-timer review alarm
    const TIMER_CHECK_MS = 10000;      // #quiz-time-left poll cadence
    const TIMER_PANIC_SECONDS = 300;   // "under 5 mins left" threshold
    const HOVER_COOLDOWN_MS = 12000;   // hover hints at most once per 12 s
    const HOVER_CHANCE = 0.35;         // ... and only ~1 in 3 hovers speaks
    const PET_COOLDOWN_MS = 300;       // swallows the 2nd click of a double click

    const ROAM_MIN_MS = 5000;        // idle wander cadence: 5–7 s
    const ROAM_SPREAD_MS = 2000;
    const ROAM_PAUSE_AFTER_DRAG = 15000;
    const QUOTE_MIN_MS = 6000;       // idle chatter cadence: 6–8 s
    const QUOTE_SPREAD_MS = 2000;
    const READING_HOLD_MS = 1600;    // "Reading the question..." → "Hmm..."
    const ANSWER_REACT_MS = 800;     // "AHA!! Found it! ✨" → clicking / typing
    const SLAP_HOLD_MS = 1100;       // clicking pose on the exact dot → Next page hop
    const NEXT_HOP_MS = 1100;        // "Next page!!" hop beside the button → idle
    const ACTION_HOLD_MS = 2500;     // typing pose → idle (clicking uses SLAP_HOLD_MS)
    const TARGET_LIFT = 40;          // px — sit this far above the target's top edge
    const NEXT_OFFSET_X = 140;       // px — park this far left of the Next page button
    const NEXT_OFFSET_Y = 45;        // px — park this far above the Next page button
    const REVIEW_COUNT_DELAY_MS = 1800;
    const TICK_MS = 1500;            // read-only state reconciliation
    const MUTATION_DEBOUNCE_MS = 220;
    const ANSWER_THROTTLE_MS = 800;
    const HARVEST_HOLD_MS = 2000;    // harvest animation lingers 2 s after the last line
    const HARVEST_STALE_MS = 20000;  // safety: 20 s of silence → back to idle
    const CONTROL_HINT_MS = 2000;    // how long the last answer control stays "fresh"
    const REVIEW_GLIDE_MS = 1100;    // review scan: hop between .que blocks
    const REVIEW_SCAN_MAX_MS = 45000; // safety: never glide forever

    /* ── Cat Squad presence + catnap tuning ───────────────────────────────── */

    // chrome.storage.local.CAT_SQUAD holds one assignment slot per cat:
    //   { mochi: { tabId, task, url, workLockUntil, updatedAt }, luna: …, boba: … }
    // `task` is 'exam' | 'harvest' | 'review' | 'idle' | ''.
    const SQUAD_KEY = 'CAT_SQUAD';
    const SQUAD_SLOTS = ['mochi', 'luna', 'boba'];
    const SQUAD_SPECIALTY = { exam: 'mochi', harvest: 'boba', review: 'luna' };
    const SQUAD_TASK_LABEL = { exam: 'Exam', harvest: 'Harvest', review: 'Review', idle: 'Idle' };
    // Which squad job a mascot state belongs to (empty → not a squad job).
    const SQUAD_STATE_TASK = {
      thinking: 'exam',
      answering: 'exam',
      clicking: 'exam',
      typing: 'exam',
      nextpage: 'exam',
      harvesting: 'harvest',
      review: 'review',
    };
    const PRESENCE_STALE_MS = 15000;       // an assignment older than this is ignored
    const PRESENCE_HEARTBEAT_MS = 4000;    // working slots keep updatedAt fresh
    const PRESENCE_INIT_TIMEOUT_MS = 2500; // chrome never answered → single-tab mode
    const WORK_LOCK_MS = 20000;            // a quiz run / harvest stays "active" this long
    // Session-level work lock (see `_activeWorkUntil`): a quiz run and a harvest
    // keep streaming these HUD lines question after question. Between two answers
    // `syncPresenceForState('idle')` briefly publishes an idle record, so without
    // the lock a freshly focused tab would steal the cat mid-exam. Both patterns
    // are anchored at the line start: harvest lines are spelled out (a bare
    // /harvest/ would match the "…or use Harvest Page." boot banner) and a quiz
    // question such as "Q: What is a stop sign?" must never end the run.
    const WORK_START_RE = /^(?:bot started|q:|question:|option\s*\d|selected\b|matched\b|typed\b|all answered|harvest\s+"|auto-harvesting answers|scanning grade report|review harvest|answer harvesting is running)/;
    const HARVEST_ABORT_RE = /^(?:harvesting failed|no q&a|nothing to harvest|harvest stopped)/;
    const WORK_END_RE = /^(?:bot stopped|stop(?:ped)?\b|quiz complete|review scan:|harvested|harvesting failed|no q&a|nothing to harvest|harvest stopped)/;
    const PILL_TEXT = '🐾 Cat squad is working on another tab...';
    const WORK_PILL_TEXT = '🐾 Cat squad is busy working on another tab...';
    const PILL_CLASS = 'qb-pill-visible';
    const NAP_CLASS = 'qb-napping';
    const NAP_AFTER_MS = 35000;            // idle + no interaction for 35 s → catnap
    const NAP_TICK_MS = 3000;              // how often stillness is checked
    const NAP_QUOTE_MIN_MS = 11000;        // sleepy mumbling cadence while napping
    const NAP_QUOTE_SPREAD_MS = 4000;

    // Every state in this map means "this tab is doing a squad job" (the job name
    // comes from SQUAD_STATE_TASK and drives which specialist cat it claims).
    const BUSY_LABELS = {
      thinking: 'reading a question',
      answering: 'answering a question',
      clicking: 'clicking an answer',
      typing: 'typing an answer',
      nextpage: 'moving to the next page',
      harvesting: 'harvesting answers',
      review: 'checking the score',
    };

    function taskKindForState(state) {
      return SQUAD_STATE_TASK[String(state || '')] || '';
    }

    function preferredCatFor(task) {
      return SQUAD_SPECIALTY[task] || 'mochi';
    }


    /* ── Module state ─────────────────────────────────────────────────────── */

    let wrapEl = null;
    let catEl = null;
    let bubbleEl = null;

    let currentState = 'idle';
    let facing = 'right';
    let pos = { left: 0, top: 0 };

    let drag = null;
    let suppressClickUntil = 0;
    let pauseRoamUntil = 0;
    let pendingAction = null;   // { kind: 'clicking' | 'typing', anchor } queued behind "AHA!!"
    let lastControl = null;     // { kind, element, at } — last answer control the bot touched

    let quoteTimer = null;
    let roamTimer = null;
    let thinkTimer = null;
    let holdTimer = null;
    let reviewTimer = null;
    let harvestTimer = null;   // harvesting → idle fade-out after the last harvest line
    let tickTimer = null;
    let mutationTimer = null;

    const freshMemory = new WeakMap(); // dialog pool -> line it drew last
    let lastBubbleText = '';
    let lastQuestionKey = '';
    let lastQuestionAt = 0;
    let lastAnswerAt = 0;
    let lastLogLine = '';
    let lastLearnedShown = -1;
    let reviewStartedAt = 0;
    let reviewParked = false;
    let booted = false;

    // Visual review scanner: content.js streams "Review scan: ..." and
    // "GitHub sync: ..." HUD lines; the cat wears glasses, glides down the .que
    // blocks and shows the live counts in its bubble. It only ever narrates —
    // content.js owns the scanning, saving and syncing.
    const reviewScan = {
      active: false,
      startedAt: 0,
      right: null,
      newCount: null,
      github: '',
      timer: null,
      stopTimer: null,
      index: 0,
    };

    let overlayTimer = null;   // cheer / panic overlay restore timer
    let overlayState = '';     // '' | 'answering' | 'review'
    let timerCheck = null;     // 10 s #quiz-time-left poll
    let panicWarned = false;   // one low-timer alarm per attempt
    let lastHoverAt = 0;
    let lastPetAt = 0;
    let scoreAnnounced = false;
    let lastScoreLine = '';    // celebration line, re-shown when the cat is petted

    // Cat squad presence: which cat this tab owns, what job it is doing, and the
    // live CAT_SQUAD map shared by every tab (assignments older than 15 s stale).
    let myTabId = null;
    let squadEnabled = false;      // false → single-tab fallback (no storage/tab id)
    let squadReady = false;        // the first read finished: show/hide is safe now
    let squadWatched = false;
    let squad = normalizeSquad(null);
    let squadHeartbeat = null;
    let pillEl = null;
    let lastStaleRecoveryAt = 0;
    let myCatId = null;            // cat assigned to this tab ('' / null → none)
    let myTask = '';               // this tab's claimed job kind ('exam' | …)
    let assignedCatId = 'mochi';   // cat painted on the primary <canvas>
    let claimInFlight = false;     // a read-modify-write claim is in progress
    // Session-level work lock: `Date.now() + WORK_LOCK_MS` while a quiz run or a
    // harvest is in progress on this tab, 0 otherwise. It bridges the idle gap
    // between two questions and is mirrored into CAT_SQUAD[cat].workLockUntil so
    // the other tabs can honour it without polling this one.
    let _activeWorkUntil = 0;
    let lastWorkLockPushAt = 0;
    let sawOtherTabWorking = false;  // other cats were busy; waiting to hand back

    // BOT_ENABLED mirror (the popup switch): disabled → the cat and the busy pill
    // vanish from this tab instantly and he stops claiming ownership; enabled →
    // applyPresence puts him back wherever he belongs.
    let uiEnabled = true;
    let uiEnabledWatched = false;

    // Catnap: `napping` drives the sleepy CSS mood; `lastInteractionAt` is the
    // newest real user action (page or mascot) that keeps him awake.
    let napping = false;
    let napTickTimer = null;
    let napQuoteTimer = null;
    let lastInteractionAt = Date.now();


    const answeredKeys = new Set();
    const warned = new Set();

    /* ── Tiny, never-throwing utilities ───────────────────────────────────── */

    function warnOnce(scope, error) {
      const message = scope + ': ' + ((error && error.message) || error || 'unknown error');
      if (warned.has(message)) return;
      warned.add(message);
      try { console.warn('[Mascot] ' + message); } catch (e) { /* never throw */ }
    }

    // The canvas repaints from module state every frame; this only records the
    // logical state and forces an immediate repaint, so a new animation appears
    // without waiting for the next ~7 FPS tick.
    function applyAsset(state) {
      if (!catEl) return;
      const key = isKnownState(state) ? state : 'idle';
      catEl.dataset.state = key;
      try { paintPrimary(); } catch (error) { warnOnce('pixel-draw', error); }
    }

    function clamp(value, min, max) {
      return Math.min(max, Math.max(min, value));
    }

    function norm(value) {
      return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    }

    function isReviewPage() {
      try {
        const path = String((typeof location !== 'undefined' && location.pathname) || '');
        return path.includes('/mod/quiz/review.php') || path.includes('/review.php');
      } catch (error) {
        return false;
      }
    }

    function rectFor(element) {
      try {
        if (!element || !element.getBoundingClientRect) return null;
        const rect = element.getBoundingClientRect();
        if (!rect || (!rect.width && !rect.height)) return null;
        return rect;
      } catch (error) {
        return null;
      }
    }

    /* ── 2D pixel-art cat engine (pure JS, no image assets) ───────────────── */

    const GRID = 24;         // logical 24 × 24 sprite matrix
    const CANVAS = 96;       // <canvas width/height> = 4 device px per sprite px
    const FRAME_MS = 143;    // ≈ 7 FPS pixel animation

    const BASE_PALETTE = {
      outline: '#241a16',
      fur: '#f5a15c',
      furDark: '#d67b36',
      white: '#fff4e6',
      pink: '#ff9fb2',
      nose: '#e2688a',
      eye: '#3ddc84',
      pupil: '#1b2430',
      metal: '#a8bccf',
      wood: '#a9713f',
      gold: '#ffd166',
      lens: 'rgba(150, 226, 255, 0.30)',
      screen: '#123047',
      code: '#7ef0c0',
    };

    // `P` is the active palette. `applyPalette(catId)` resets it to the base and
    // then applies the cat's overrides, so every draw helper stays palette-blind
    // while Mochi / Luna / Boba each paint in their own fur colours.
    const P = { ...BASE_PALETTE };

    function applyPalette(catId) {
      const cat = CATS[catId] || CATS.mochi;
      Object.keys(BASE_PALETTE).forEach((key) => { P[key] = BASE_PALETTE[key]; });
      const overrides = (cat && cat.palette) || {};
      Object.keys(overrides).forEach((key) => { P[key] = overrides[key]; });
    }

    // ── Per-cat pixel accessories + fur patterns ────────────────────────────
    // Drawn after the face so shades actually sit on the eyes and the bandana
    // reads as a collar. All coordinates are the same 24×24 sprite matrix.

    function drawMochiAccessory(dy, tick) {
      // Orange tabby stripes on the cheeks.
      px(7, 7 + dy, P.furDark, 1, 2);
      px(16, 7 + dy, P.furDark, 1, 2);
      px(8, 6 + dy, P.furDark);
      // Tiny red bandana around the neck: red band + knot + tail.
      const wag = tick % 8 < 4 ? 0 : 1;
      px(8, 12 + dy, '#a81f2d', 8, 1);
      px(9, 13 + dy, '#e63946', 7, 1);
      px(12, 14 + dy, '#e63946', 2, 1);
      px(11, 15 + dy, '#e63946', 1, 2 + wag);
      px(14, 15 + dy, '#e63946', 1, 2 - wag);
    }

    function drawLunaAccessory(dy, tick) {
      // Tuxedo cap: dark patches on both sides of a white forehead blaze.
      px(8, 5 + dy, P.furDark, 3, 2);
      px(13, 5 + dy, P.furDark, 3, 2);
      px(11, 5 + dy, P.fur, 2, 2);
      px(8, 7 + dy, P.furDark);
      px(15, 7 + dy, P.furDark);
      // Cool dark pixel shades over both eyes (bridge + temples + glint).
      px(8, 8 + dy, '#14161f', 4, 2);
      px(12, 8 + dy, '#14161f', 4, 2);
      px(11, 8 + dy, '#4a4e63');
      px(7, 8 + dy, '#14161f');
      px(16, 8 + dy, '#14161f');
      const glint = tick % 10 < 5 ? 0 : 1;
      px(9 + glint, 8 + dy, '#9be7ff');
      px(13 + glint, 8 + dy, '#9be7ff');
      // White tuxedo chest patch.
      px(10, 14 + dy, P.white, 4, 3);
    }

    function drawBobaAccessory(dy, tick) {
      // Cream calico spots (one on the head, one on the flank).
      px(14, 5 + dy, P.furDark, 2, 2);
      px(7, 8 + dy, P.furDark, 1, 1);
      px(8, 16 + dy, P.furDark, 2, 2);
      px(16, 15 + dy, P.furDark, 1, 1);
      // Tiny green sprout between the ears (stem + two leaves).
      const sway = tick % 12 < 6 ? 0 : 1;
      px(12, 2 + dy, '#3f8a3a', 1, 3);
      px(11 + sway, 1 + dy, '#6ec46a', 1, 1);
      px(13 - sway, 1 + dy, '#8ddd74', 1, 1);
      px(10 + sway, 2 + dy, '#8ddd74');
      px(14 - sway, 2 + dy, '#6ec46a');
    }

    function drawAccessory(catId, state, tick, dy) {
      if (state === 'nap') return; // sleeping ball pose: accessories would float
      if (catId === 'luna') drawLunaAccessory(dy, tick);
      else if (catId === 'boba') drawBobaAccessory(dy, tick);
      else drawMochiAccessory(dy, tick);
    }

    let ctx = null;
    let primaryCtx = null;
    let frameTick = 0;
    let frameTimer = null;
    let walkUntil = 0;       // idle + still gliding → play the trot cycle

    function paintPrimary() {
      if (!primaryCtx || !catEl) return;
      ctx = primaryCtx;
      applyPalette(assignedCatId);
      drawCatFrame(renderState(), frameTick, assignedCatId);
    }

    function px(x, y, color, w, h) {
      if (!ctx) return;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, w == null ? 1 : w, h == null ? 1 : h);
    }

    function clearSprite() {
      if (ctx) ctx.clearRect(0, 0, GRID, GRID);
    }

    // One blob = stacked rows: each row's edge pixels become the outline and the
    // inside stays fur, so silhouettes read as rounded pixel art at 24 px.
    function drawBlob(rows, dy, fill, outline) {
      const edge = outline || P.outline;
      const lift = dy || 0;
      for (let i = 0; i < rows.length; i += 1) {
        px(rows[i].x, rows[i].y + lift, edge, rows[i].w, 1);
      }
      for (let i = 1; i < rows.length - 1; i += 1) {
        if (rows[i].w > 2) px(rows[i].x + 1, rows[i].y + lift, fill, rows[i].w - 2, 1);
      }
    }

    const BODY_ROWS = [
      { y: 13, x: 9, w: 6 },
      { y: 14, x: 8, w: 8 },
      { y: 15, x: 7, w: 10 },
      { y: 16, x: 7, w: 10 },
      { y: 17, x: 7, w: 10 },
      { y: 18, x: 7, w: 10 },
      { y: 19, x: 7, w: 10 },
      { y: 20, x: 8, w: 8 },
      { y: 21, x: 9, w: 6 },
    ];

    const HEAD_ROWS = [
      { y: 5, x: 8, w: 8 },
      { y: 6, x: 7, w: 10 },
      { y: 7, x: 6, w: 12 },
      { y: 8, x: 6, w: 12 },
      { y: 9, x: 6, w: 12 },
      { y: 10, x: 6, w: 12 },
      { y: 11, x: 6, w: 12 },
      { y: 12, x: 7, w: 10 },
      { y: 13, x: 8, w: 8 },
    ];

    // Four tail poses: the wag cycle of the idle / walk loop.
    const TAIL_PHASES = [
      [[17, 18], [18, 17], [19, 16], [20, 15], [21, 14], [21, 13]],
      [[17, 18], [18, 18], [19, 17], [20, 17], [21, 16], [22, 16]],
      [[17, 19], [18, 19], [19, 18], [20, 18], [21, 18], [21, 17]],
      [[17, 18], [18, 17], [19, 17], [20, 16], [21, 15], [22, 15]],
    ];

    function drawTail(phase, dy) {
      const tail = TAIL_PHASES[phase % TAIL_PHASES.length];
      for (let i = 0; i < tail.length; i += 1) px(tail[i][0], tail[i][1] + dy, P.outline, 2, 2);
      for (let i = 0; i < tail.length; i += 1) px(tail[i][0], tail[i][1] + dy, P.fur, 1, 1);
      const tip = tail[tail.length - 1];
      px(tip[0] + 1, tip[1] + dy, P.furDark);
    }

    function drawEars(dy, twitch) {
      const lift = twitch ? -1 : 0;
      px(7, 2 + dy + lift, P.outline, 2, 1);
      px(6, 3 + dy + lift, P.outline, 4, 1);
      px(6, 4 + dy, P.outline, 4, 1);
      px(7, 3 + dy + lift, P.pink);
      px(7, 4 + dy, P.pink, 2, 1);
      px(15, 2 + dy + lift, P.outline, 2, 1);
      px(14, 3 + dy + lift, P.outline, 4, 1);
      px(14, 4 + dy, P.outline, 4, 1);
      px(16, 3 + dy + lift, P.pink);
      px(15, 4 + dy, P.pink, 2, 1);
    }

    // Eyes / muzzle / whiskers. `happy` → closed ^ ^ eyes, `focus` → looking down
    // (reading glasses), `blink` → flat lines, `look` → pupils track the cursor
    // (−1 left, 0 centre, +1 right) fed by the local brain's mousemove sensor.
    function drawFace(dy, opts) {
      const o = opts || {};
      px(9, 6 + dy, P.furDark, 2, 1);
      px(14, 6 + dy, P.furDark, 1, 1);
      px(10, 10 + dy, P.white, 4, 3);
      px(11, 10 + dy, P.nose, 2, 1);
      px(11, 11 + dy, P.outline, 2, 1);
      px(4, 10 + dy, P.white, 2, 1);
      px(18, 10 + dy, P.white, 2, 1);
      px(5, 11 + dy, P.white, 1, 1);
      px(19, 11 + dy, P.white, 1, 1);
      if (o.happy) {
        px(9, 9 + dy, P.outline, 2, 1);
        px(9, 8 + dy, P.outline, 1, 1);
        px(13, 9 + dy, P.outline, 2, 1);
        px(14, 8 + dy, P.outline, 1, 1);
      } else if (o.blink) {
        px(9, 9 + dy, P.outline, 2, 1);
        px(13, 9 + dy, P.outline, 2, 1);
      } else {
        const look = o.look || 0;
        px(9, 8 + dy, P.eye, 2, 2);
        px(13, 8 + dy, P.eye, 2, 2);
        const pupilRow = 8 + dy + (o.focus ? 1 : 0);
        // Pupil slides inside the 2 px eye; the highlight takes the freed pixel.
        px(look > 0 ? 10 : 9, pupilRow, P.pupil);
        px(look < 0 ? 13 : 14, pupilRow, P.pupil);
        px(look > 0 ? 9 : 10, 8 + dy, P.white);
        px(look < 0 ? 14 : 13, 8 + dy, P.white);
      }
    }

    function drawPaws(dy, walking, step) {
      const leftLift = walking && step % 2 === 0 ? 1 : 0;
      const rightLift = walking && step % 2 === 1 ? 1 : 0;
      px(8, 19 + dy - leftLift, P.outline, 4, 3);
      px(9, 20 + dy - leftLift, P.white, 2, 1);
      px(13, 19 + dy - rightLift, P.outline, 4, 3);
      px(14, 20 + dy - rightLift, P.white, 2, 1);
    }

    function drawSparkle(x, y, color, big) {
      px(x, y, color);
      px(x - 1, y + 1, color);
      px(x + 1, y + 1, color);
      px(x, y + 2, color);
      if (big) { px(x, y - 1, color); px(x, y + 3, color); }
    }

    // Tiny pixel "Z": top bar, diagonal, bottom bar.
    function drawZ(x, y, size, color) {
      px(x, y, color, size, 1);
      for (let i = 1; i < size - 1; i += 1) px(x + size - 1 - i, y + i, color);
      px(x, y + size - 1, color, size, 1);
    }

    // Catnap: a curled ball with a resting head, folded ears and rising Zzz.
    function drawNap(tick) {
      drawBlob([
        { y: 16, x: 7, w: 11 },
        { y: 17, x: 6, w: 13 },
        { y: 18, x: 5, w: 15 },
        { y: 19, x: 5, w: 15 },
        { y: 20, x: 6, w: 13 },
        { y: 21, x: 7, w: 11 },
      ], 0, P.fur);
      drawBlob([
        { y: 12, x: 8, w: 9 },
        { y: 13, x: 7, w: 11 },
        { y: 14, x: 7, w: 11 },
        { y: 15, x: 8, w: 9 },
      ], 0, P.fur);
      // folded ears + closed eyes + nose
      px(7, 11, P.outline, 2, 1);
      px(8, 11, P.pink);
      px(16, 11, P.outline, 2, 1);
      px(16, 11, P.pink);
      px(9, 14, P.outline, 2, 1);
      px(14, 14, P.outline, 2, 1);
      px(12, 15, P.nose, 2, 1);
      // tail wrapped around the front of the ball
      px(5, 19, P.outline, 3, 2);
      px(5, 19, P.fur, 2, 1);
      px(17, 19, P.outline, 3, 2);
      px(18, 19, P.fur, 2, 1);
      // Zzz drifting up, two sizes
      const rise = tick % 3;
      drawZ(17, 10 - rise, 3, P.white);
      drawZ(20, 6 - rise, 2, P.gold);
    }

    function drawBody(dy, walking) {
      drawBlob(BODY_ROWS, dy, P.fur);
      // chest fluff + side stripes
      px(11, 15 + dy, P.white, 2, 3);
      px(8, 16 + dy, P.furDark, 1, 2);
      px(15, 16 + dy, P.furDark, 1, 2);
      if (walking) px(9, 21 + dy, P.furDark, 2, 1);
    }

    // Paw on chin + floating "..." (and a "?" every other beat).
    function drawThinking(tick, dy) {
      px(12, 12 + dy, P.outline, 4, 3);
      px(13, 13 + dy, P.white, 2, 1);
      const phase = Math.floor(tick / 2) % 4;
      for (let i = 0; i < 3; i += 1) {
        px(18 + i * 2, 6 + dy - (phase === i ? 1 : 0), i <= phase ? P.gold : P.white);
      }
      if (Math.floor(tick / 12) % 2 === 0) {
        px(19, 2 + dy, P.gold, 3, 1);
        px(21, 3 + dy, P.gold);
        px(20, 4 + dy, P.gold);
        px(20, 6 + dy, P.gold);
      }
    }

    // "AHA!!": hop + pixel "!" + a sparkle burst.
    function drawExcited(tick, dy) {
      px(19, 1 + dy, P.gold, 2, 4);
      px(19, 6 + dy, P.gold, 2, 2);
      const on = tick % 2 === 0;
      drawSparkle(4, 6 + dy + (on ? 0 : 1), P.white);
      drawSparkle(21, 12 + dy + (on ? 1 : 0), P.gold);
      drawSparkle(6, 16 + dy + (on ? 1 : 0), P.gold);
    }

    // Paw-slap onto the exact radio dot (clicking) or the Next page button.
    function drawSlap(tick, dy, nextPage) {
      const hit = tick % 2 === 0;
      const dotX = nextPage ? 18 : 17;
      const dotY = nextPage ? 16 : 18;
      px(13, dotY - 3 + dy + (hit ? 1 : 0), P.outline, 4, 3);
      px(14, dotY - 2 + dy + (hit ? 1 : 0), P.white, 2, 1);
      px(dotX, dotY + dy, P.outline, 5, 4);
      px(dotX + 1, dotY + 1 + dy, nextPage ? P.eye : P.gold, 3, 2);
      if (hit) drawSparkle(dotX + 2, dotY - 2 + dy, P.white, true);
    }

    // Tiny laptop: screen in front of the chest, paws tapping the keys.
    function drawLaptop(tick, dy) {
      const tap = tick % 2 === 0;
      px(5, 13 + dy, P.outline, 14, 6);
      px(6, 14 + dy, P.screen, 12, 4);
      px(7, 15 + dy, P.code, 5, 1);
      px(7, 16 + dy, P.code, 8, 1);
      px(4, 19 + dy, P.outline, 16, 3);
      px(5, 20 + dy, P.metal, 14, 1);
      px(7, 20 + dy - (tap ? 0 : 1), P.white, 3, 2);
      px(14, 20 + dy - (tap ? 1 : 0), P.white, 3, 2);
    }

    // Pickaxe swinging + flying pixel star particles.
    function drawPickaxe(tick, dy) {
      const phases = [
        { ex: 20, ey: 9, hx: 20, hy: 8 },
        { ex: 18, ey: 11, hx: 18, hy: 10 },
        { ex: 15, ey: 13, hx: 14, hy: 12 },
      ];
      const phase = phases[Math.floor(tick / 3) % phases.length];
      const steps = 6;
      for (let i = 0; i <= steps; i += 1) {
        const t = i / steps;
        px(Math.round(16 + (phase.ex - 16) * t), Math.round(18 + (phase.ey - 18) * t) + dy, P.wood);
      }
      px(phase.hx, phase.hy + dy, P.metal, 3, 2);
      px(15, 17 + dy, P.white, 2, 1); // paw holding the handle
      if (tick % 2 === 0) {
        drawSparkle(phase.hx + 3, phase.hy + dy + 1, P.white);
        drawSparkle(4, 8 + (tick % 4), P.gold);
      } else {
        drawSparkle(phase.hx - 2, phase.hy + dy + 2, P.gold);
      }
    }

    // Reading glasses over the eyes: they drop onto the muzzle over ~350 ms, then
    // a white glint sweeps across both lenses while the scan runs.
    function drawGlasses(tick) {
      let drop = 0;
      const startedAt = reviewScan.active ? reviewScan.startedAt : reviewStartedAt;
      if (startedAt) {
        const elapsed = Date.now() - startedAt;
        if (elapsed >= 0 && elapsed < 350) drop = -4 + Math.round((elapsed / 350) * 4);
      }
      const top = 7 + drop;
      // left lens x8..11, right lens x12..15 (the eyes sit inside them)
      px(8, top - 1, P.outline, 4, 1);
      px(12, top - 1, P.outline, 4, 1);
      px(8, top + 4, P.outline, 4, 1);
      px(12, top + 4, P.outline, 4, 1);
      px(8, top, P.outline, 1, 4);
      px(11, top, P.outline, 1, 4);
      px(12, top, P.outline, 1, 4);
      px(15, top, P.outline, 1, 4);
      px(9, top, P.lens, 2, 4);
      px(13, top, P.lens, 2, 4);
      // temples resting on the cheeks
      px(7, top + 1, P.outline);
      px(16, top + 1, P.outline);
      // white lens glint sweeping left → right
      const glint = Math.floor(tick / 2) % 4;
      px(9, top + glint, P.white);
      px(13, top + glint, P.white);
      // scanning sparkle above the frames
      if (reviewScan.active && tick % 4 < 2) drawSparkle(18, top - 2, P.gold);
    }

    // Which animation actually paints: catnap wins, then a temporary overlay
    // (double-click cheer / low-timer panic), then the trot while gliding.
    function renderState() {
      if (napping) return 'nap';
      if (overlayState && isKnownState(overlayState)) return overlayState;
      if (currentState === 'idle' && Date.now() < walkUntil) return 'walk';
      return isKnownState(currentState) ? currentState : 'idle';
    }

    function drawCatFrame(state, tick, catKey) {
      if (!ctx) return;
      clearSprite();
      if (state === 'nap') { drawNap(tick); return; }
      const catId = CATS[catKey] ? catKey : assignedCatId;

      const walking = state === 'walk';
      const step = Math.floor(tick / 2) % 4;
      const bob = walking && step % 2 === 1 ? -1 : 0;
      const hop = state === 'answering' ? (tick % 2 === 0 ? -2 : -1) : 0;
      const dy = bob + hop;
      const blink = state !== 'answering' && state !== 'review' && tick % 26 === 13;
      const twitch = tick % 22 === 4;
      const tailPhase = state === 'harvesting' ? tick : Math.floor(tick / 3);

      drawTail(tailPhase, dy);
      drawBody(dy, walking);
      drawEars(dy, twitch);
      drawBlob(HEAD_ROWS, dy, P.fur);
      drawFace(dy, {
        blink,
        happy: state === 'answering' && tick % 2 === 0,
        focus: state === 'review',
        look: state === 'review' ? 0 : gazeLook, // reading glasses stare at the paper
      });
      if (state !== 'typing' && state !== 'harvesting') drawPaws(dy, walking, step);
      drawAccessory(catId, state, tick, dy);

      if (state === 'thinking') drawThinking(tick, dy);
      else if (state === 'answering') drawExcited(tick, dy);
      else if (state === 'clicking' || state === 'nextpage') drawSlap(tick, dy, state === 'nextpage');
      else if (state === 'typing') drawLaptop(tick, dy);
      else if (state === 'harvesting') drawPickaxe(tick, dy);
      else if (state === 'review' && catId !== 'luna') drawGlasses(tick); // Luna keeps her shades
    }

    // Boot the ~7 FPS pixel loop. Hidden/unfocused tabs skip the repaint (the cat
    // is either hidden there or the user cannot see him), so an idle background
    // tab costs nothing. The same loop paints the Summon Squad canvases.
    function startPixelEngine() {
      if (!catEl) return;
      try {
        primaryCtx = catEl.getContext('2d');
        if (primaryCtx) {
          primaryCtx.imageSmoothingEnabled = false;
          primaryCtx.setTransform(CANVAS / GRID, 0, 0, CANVAS / GRID, 0, 0);
        }
      } catch (error) {
        primaryCtx = null;
        warnOnce('pixel-context', error);
      }
      if (!primaryCtx) return; // no canvas support: the wrapper simply stays empty
      if (frameTimer) clearInterval(frameTimer);
      frameTimer = setInterval(() => {
        try {
          if (wrapEl && wrapEl.style.display === 'none') return;
          if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
          frameTick += 1;
          paintPrimary();
          advanceHangoutCats();
          drawHangoutCats(frameTick);
        } catch (error) {
          warnOnce('pixel-frame', error);
        }
      }, FRAME_MS);
      frameTick = 0;
      paintPrimary();
    }

    /* ── Styles (self-contained; hud.css only styles the closed shadow HUD) ── */

    function injectStyles() {
      if (document.getElementById(STYLE_ID)) return;
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = `
#${WRAP_ID} {
  position: fixed;
  left: 0;
  top: 0;
  width: ${SIZE}px;
  height: ${SIZE}px;
  z-index: 2147483647;
  pointer-events: none;
  font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
  transition:
    left 0.85s cubic-bezier(0.22, 1, 0.36, 1),
    top 0.85s cubic-bezier(0.22, 1, 0.36, 1);
  will-change: left, top;
}
#${WRAP_ID}.qb-dragging {
  transition: none;
  will-change: auto;
}
/* The pixel canvas: 96×96 rendered at ${SIZE}px with nearest-neighbour scaling,
   so every sprite pixel stays a crisp square. The drop-shadow follows the cat's
   silhouette instead of the element box (the canvas itself is transparent). */
.${IMG_CLASS} {
  display: block;
  width: ${SIZE}px;
  height: ${SIZE}px;
  image-rendering: crisp-edges;
  image-rendering: pixelated;
  border: 0;
  background: transparent;
  filter: drop-shadow(0 8px 16px rgba(0, 0, 0, 0.38));
  pointer-events: auto;
  cursor: grab;
  user-select: none;
  -webkit-user-select: none;
  -webkit-user-drag: none;
  transform: scaleX(1);
  transform-origin: 50% 50%;
  transition: transform 0.35s ease, filter 0.25s ease;
}
.${IMG_CLASS}.qb-facing-left { transform: scaleX(-1); }
.${IMG_CLASS}:active { cursor: grabbing; }
.${IMG_CLASS}.qb-hop { animation: qbMascotHop 0.45s ease-out; }
.${IMG_CLASS}.qb-review { animation: qbMascotGlow 2s ease-in-out infinite; }
/* Local brain: fast cursor flick → whisker-wiggle dizzy wobble. */
.${IMG_CLASS}.qb-dizzy { animation: qbMascotDizzy 0.3s ease-in-out 4; }
@keyframes qbMascotDizzy {
  0%   { rotate: 0deg; translate: 0 0; }
  25%  { rotate: -7deg; translate: -2px 1px; }
  50%  { rotate: 0deg; translate: 0 -2px; }
  75%  { rotate: 7deg; translate: 2px 1px; }
  100% { rotate: 0deg; translate: 0 0; }
}
@keyframes qbMascotHop {
  0%   { translate: 0 0; }
  45%  { translate: 0 -10px; }
  100% { translate: 0 0; }
}
@keyframes qbMascotGlow {
  0%, 100% { filter: drop-shadow(0 8px 16px rgba(0, 0, 0, 0.38)); }
  50%      { filter: drop-shadow(0 8px 16px rgba(0, 0, 0, 0.38)) drop-shadow(0 0 9px rgba(255, 209, 102, 0.95)); }
}
#${BUBBLE_ID} {
  position: absolute;
  right: 0;
  left: auto;
  bottom: calc(100% + 10px);
  max-width: 175px;
  min-width: 56px;
  box-sizing: border-box;
  white-space: normal;
  word-wrap: break-word;
  overflow-wrap: break-word;
  padding: 8px 12px;
  border-radius: 16px 16px 4px 16px;
  background: linear-gradient(135deg, #ff6b6b 0%, #ff8c42 100%);
  color: #fff;
  font-size: 12px;
  line-height: 1.4;
  text-align: left;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  pointer-events: none;
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.25s ease, visibility 0.25s ease;
  z-index: 2147483647;
}
#${BUBBLE_ID}.qb-bubble-visible { opacity: 1; visibility: visible; }
#${BUBBLE_ID}.qb-bubble-left {
  right: auto;
  left: 0;
  border-radius: 16px 16px 16px 4px;
}
#${BUBBLE_ID}::after {
  content: "";
  position: absolute;
  top: 100%;
  right: 20px;
  left: auto;
  width: 0;
  border-width: 10px 10px 0;
  border-style: solid;
  border-color: #ff6b6b transparent;
}
#${BUBBLE_ID}.qb-bubble-left::after {
  right: auto;
  left: 20px;
}

/* Catnap: dimmed + slow breathing. Still draggable and clickable. */
#${WRAP_ID}.qb-napping { opacity: 0.92; }
#${WRAP_ID}.qb-napping .${IMG_CLASS} {
  animation: qbMascotBreathe 4.6s ease-in-out infinite;
  filter: drop-shadow(0 6px 12px rgba(0, 0, 0, 0.3));
}
@keyframes qbMascotBreathe {
  0%, 100% { scale: 1 1; }
  50%      { scale: 1.035 1.035; }
}

/* The one cat lives on a single tab; every other tab gets this status pill
   instead (HUD palette, so it reads as part of the bot's chrome). */
#${PILL_ID} {
  position: fixed;
  left: 20px;
  bottom: 20px;
  z-index: 2147483646;
  max-width: min(460px, calc(100vw - 40px));
  box-sizing: border-box;
  padding: 9px 14px;
  border-radius: 999px;
  background: linear-gradient(135deg, #1e2a47 0%, #0f3460 100%);
  border: 1px solid rgba(255, 179, 71, 0.45);
  color: #ffd166;
  font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  pointer-events: none;
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.25s ease, visibility 0.25s ease;
}
#${PILL_ID}.${PILL_CLASS} { opacity: 1; visibility: visible; }

/* ── Summon Squad: hover badge + the two extra trotting cats ───────────── */

#${WRAP_ID} .${SQUAD_BADGE_CLASS} {
  position: absolute;
  left: 50%;
  bottom: 0;
  transform: translateX(-50%);
  box-sizing: border-box;
  padding: 3px 9px;
  border-radius: 999px;
  background: rgba(15, 52, 96, 0.94);
  border: 1px solid rgba(255, 179, 71, 0.55);
  color: #ffd166;
  font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.02em;
  line-height: 1.3;
  white-space: nowrap;
  cursor: pointer;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.2s ease;
  user-select: none;
  -webkit-user-select: none;
}
#${WRAP_ID}:hover .${SQUAD_BADGE_CLASS} { opacity: 1; pointer-events: auto; }
#${WRAP_ID} .${SQUAD_BADGE_CLASS}.${SQUAD_BADGE_HIDDEN} { display: none; }
#${WRAP_ID} .${SQUAD_BADGE_CLASS}:hover { background: #0f3460; }

.${SQUAD_CAT_CLASS} {
  position: fixed;
  left: 0;
  top: 0;
  width: 96px;
  height: 96px;
  z-index: 2147483646;
  pointer-events: none;
  transition:
    left 0.9s cubic-bezier(0.22, 1, 0.36, 1),
    top 0.9s cubic-bezier(0.22, 1, 0.36, 1);
  will-change: left, top;
}
.${SQUAD_CANVAS_CLASS} {
  display: block;
  width: 96px;
  height: 96px;
  image-rendering: crisp-edges;
  image-rendering: pixelated;
  border: 0;
  background: transparent;
  filter: drop-shadow(0 6px 12px rgba(0, 0, 0, 0.34));
  transform: scaleX(1);
  transform-origin: 50% 50%;
  transition: transform 0.3s ease;
}
.${SQUAD_CANVAS_CLASS}.qb-facing-left { transform: scaleX(-1); }
.${SQUAD_BUBBLE_CLASS} {
  position: absolute;
  right: 0;
  bottom: calc(100% + 4px);
  max-width: 150px;
  box-sizing: border-box;
  white-space: normal;
  overflow-wrap: break-word;
  padding: 6px 10px;
  border-radius: 14px 14px 4px 14px;
  background: linear-gradient(135deg, #1e2a47 0%, #0f3460 100%);
  border: 1px solid rgba(255, 179, 71, 0.45);
  color: #ffe9b8;
  font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
  font-size: 11px;
  line-height: 1.35;
  text-align: left;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
  pointer-events: none;
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.2s ease, visibility 0.2s ease;
}
.${SQUAD_BUBBLE_CLASS}.qb-bubble-visible { opacity: 1; visibility: visible; }
      `;
      (document.head || document.documentElement).appendChild(style);
    }

    /* ── Geometry: viewport clamping + HUD-box avoidance ──────────────────── */

    function hudBlockedRect() {
      try {
        const host = document.getElementById(HUD_HOST_ID);
        if (!host) return null;
        const narrow = window.innerWidth <= 564; // hud.css stacks the panel there
        const style = window.getComputedStyle(host);
        const rect = rectFor(host);
        const width = narrow
          ? Math.max(0, window.innerWidth - 40)
          : ((rect && rect.width) || parseFloat(style.width) || 380);
        const right = rect
          ? rect.right
          : window.innerWidth - (parseFloat(style.right) || 165);
        // The HUD host is 0 px tall (its panel is absolutely positioned inside),
        // so the panel's bottom edge is the host's top edge.
        let bottom = rect ? rect.top : window.innerHeight - (parseFloat(style.bottom) || 20);
        if (narrow) bottom -= 148;
        const height = Math.min(window.innerHeight - 40, 360);
        return { left: right - width, right, top: bottom - height, bottom };
      } catch (error) {
        return null;
      }
    }

    function intersects(x, y, rect) {
      if (!rect) return false;
      return x < rect.right && x + SIZE > rect.left && y < rect.bottom && y + SIZE > rect.top;
    }

    // Right-edge clamp for every `left` we ever write:
    //   maxLeft = window.innerWidth − mascotWidth − 24
    // mascotWidth is the bubble (175 px, right-aligned to the wrap) because it is
    // wider than the 130 px cat, so neither the cat nor its bubble can clip off
    // the right edge of the window.
    function maxLeftFor() {
      return Math.max(EDGE, window.innerWidth - MASCOT_WIDTH - RIGHT_GUARD);
    }

    // Clamp into the viewport (16 px margin) and keep clear of the HUD box.
    function safeSpot(x, y) {
      const maxLeft = maxLeftFor();
      const maxTop = Math.max(EDGE, window.innerHeight - SIZE - EDGE);
      let left = clamp(x, EDGE, maxLeft);
      let top = clamp(y, EDGE, maxTop);
      const hud = hudBlockedRect();
      if (hud && intersects(left, top, hud)) {
        const above = hud.top - SIZE - GAP;
        const leftOf = hud.left - SIZE - GAP;
        if (above >= EDGE) top = Math.min(maxTop, above);
        else if (leftOf >= EDGE) left = Math.max(EDGE, leftOf);
        else { left = EDGE; top = EDGE; }
      }
      return { left: clamp(left, EDGE, maxLeft), top: clamp(top, EDGE, maxTop) };
    }

    /* ── Movement + horizontal flip ───────────────────────────────────────── */

    function alignBubble() {
      if (!bubbleEl) return;
      const bubbleWidth = Math.min(BUBBLE_MAX, bubbleEl.offsetWidth || BUBBLE_MAX);
      const overflowLeft = pos.left + SIZE - bubbleWidth;
      bubbleEl.classList.toggle('qb-bubble-left', overflowLeft < 8);
    }

    function applyPosition(left, top) {
      if (!wrapEl) return;
      pos = { left, top };
      wrapEl.style.left = Math.round(left) + 'px';
      wrapEl.style.top = Math.round(top) + 'px';
      alignBubble();
    }

    // Glide (CSS transition) to a target, flipping the cat to face its heading.
    // While idle, the pixel engine plays the 4-frame trot for the duration of
    // the glide, so roaming reads as walking instead of sliding.
    function moveTo(x, y) {
      if (!wrapEl) return;
      const spot = safeSpot(x, y);
      const dx = spot.left - pos.left;
      if (Math.abs(dx) > 6) {
        facing = dx < 0 ? 'left' : 'right';
        if (catEl) catEl.classList.toggle('qb-facing-left', facing === 'left');
      }
      if (currentState === 'idle' && !napping) {
        const distance = Math.abs(dx) + Math.abs(spot.top - pos.top);
        walkUntil = Date.now() + Math.min(1400, 450 + distance * 2);
      }
      applyPosition(spot.left, spot.top);
    }

    // Force the un-mirrored pose (scaleX(1)): the Next page hop always keeps the
    // paw pointing right at the blue button, whatever way the cat last walked.
    function faceRight() {
      facing = 'right';
      if (catEl) catEl.classList.remove('qb-facing-left');
    }

    /* ── Speech bubble ────────────────────────────────────────────────────── */

    function setBubble(text, visible) {
      if (!bubbleEl) return;
      if (text) {
        bubbleEl.textContent = text;
        lastBubbleText = text;
      }
      bubbleEl.classList.toggle('qb-bubble-visible', visible !== false);
      alignBubble();
    }

    // Shuffle-no-repeat picker: each pool remembers its last line, so the same
    // dialog never appears twice in a row (and never echoes the live bubble).
    function rememberPick(pool, pick) {
      try { freshMemory.set(pool, pick); } catch (error) { /* ignore */ }
      return pick;
    }

    function pickFreshLine(pool) {
      if (!Array.isArray(pool) || !pool.length) return '';
      if (pool.length === 1) return pool[0];
      const last = freshMemory.get(pool) || '';
      let pick = last;
      for (let attempt = 0; attempt < 10; attempt += 1) {
        pick = pool[Math.floor(Math.random() * pool.length)];
        if (pick !== last && pick !== lastBubbleText) return rememberPick(pool, pick);
      }
      // Tiny pool / unlucky rerolls: accept anything different from the last draw.
      if (pick === last) pick = pool[(pool.indexOf(last) + 1) % pool.length];
      return rememberPick(pool, pick);
    }

    // Idle chatter: the local brain composes from live context (title, course,
    // time, bank size, tab hops…) and falls back to the active cat's own voice.
    function randomQuote() {
      if (hangout.active) return pickCatLine(assignedCatId, 'hang') || pickFreshLine(HANG_LINES);
      return composeCatThought('idle') || pickCatLine(assignedCatId, 'idle') || pickFreshLine(IDLE_QUOTES);
    }

    // Temporary animation overlay (double-click cheer, low-timer panic): play
    // `state`'s animation for `ms` with `line` in the bubble, then restore
    // whatever the real state machine currently wants. currentState never moves,
    // so quiz logic and the reconciliation loop are untouched by it.
    function startOverlay(state, ms, line) {
      if (!catEl || !bubbleEl) return;
      if (!isKnownState(state)) return;
      if (overlayTimer) { clearTimeout(overlayTimer); overlayTimer = null; }
      overlayState = state;
      if (catEl.dataset.state !== state) {
        applyAsset(state);
      }
      catEl.classList.remove('qb-hop', 'qb-review');
      void catEl.offsetWidth; // restart the hop animation
      catEl.classList.add('qb-hop');
      if (line) setBubble(line, true);
      overlayTimer = setTimeout(restoreAfterOverlay, ms);
    }

    function restoreAfterOverlay() {
      overlayTimer = null;
      overlayState = '';
      if (!catEl) return;
      const real = isKnownState(currentState) ? currentState : 'idle';
      if (catEl.dataset.state !== real) {
        applyAsset(real);
      }
      if (real === 'review') catEl.classList.add('qb-review');
      else catEl.classList.remove('qb-review');
    }

    /* ── Cat squad presence: three cats shared by every tab ───────────────── */

    // Cosmetic coordination only: nothing here can click, submit or block page
    // code. Every tab reads and writes the same map:
    //
    //   chrome.storage.local.CAT_SQUAD = {
    //     mochi: { tabId, task, url, workLockUntil, updatedAt },
    //     luna:  { … },
    //     boba:  { … },
    //   }
    //
    // Rule A (specialist claim): a tab entering a working state claims the free
    // cat for its job — exam → Mochi, review → Luna, harvest → Boba — falling
    // back to any free slot. A second tab starting another job claims one of the
    // remaining cats, so up to three tabs work in parallel with their own cat.
    // The claim refreshes `updatedAt` every PRESENCE_HEARTBEAT_MS, so a
    // closed/crashed tab frees its cat after PRESENCE_STALE_MS.
    //
    // Rule A+ (session work lock): a quiz run and a harvest dip back to idle
    // between two questions, so `workLockUntil` keeps that cat reserved on the
    // working tab (shown as "Working") through the gaps; no other tab may steal
    // it while the deadline is in the future.
    //
    // Rule B (follow the active tab): when no cat is working, Mochi belongs to
    // the tab the user is looking at. Ownership changes only on real user
    // signals — a tab switch, focusing another window, a page load, or another
    // tab handing him over — so the 1.5 s reconciler can never trade cats back
    // and forth. Tabs with no cat hide the workers and show a live squad pill:
    //   🐾 Working: Mochi (Exam) • Boba (Harvest)

    function pageUrl() {
      try { return String(location.href || '').slice(0, 500); } catch (error) { return ''; }
    }

    function normalizeSlot(raw) {
      const value = raw && typeof raw === 'object' ? raw : {};
      const tabId = value.tabId;
      return {
        tabId: typeof tabId === 'number' && Number.isFinite(tabId) ? tabId : null,
        task: typeof value.task === 'string' ? value.task : '',
        url: typeof value.url === 'string' ? value.url : '',
        workLockUntil: Number(value.workLockUntil) || 0,
        updatedAt: Number(value.updatedAt) || 0,
      };
    }

    function normalizeSquad(raw) {
      const value = raw && typeof raw === 'object' ? raw : {};
      const next = {};
      SQUAD_SLOTS.forEach((id) => { next[id] = normalizeSlot(value[id]); });
      return next;
    }

    // An assignment is only honoured for PRESENCE_STALE_MS; a working cat keeps
    // touching updatedAt via the heartbeat, so silence means "that tab went away".
    function slotIsFresh(slot) {
      return !!slot && slot.updatedAt > 0 && (Date.now() - slot.updatedAt) < PRESENCE_STALE_MS;
    }

    // A slot is "working" when it holds a real job and is either fresh (heartbeat
    // alive) or inside its session work lock (between two questions of a run).
    function slotIsWorking(slot) {
      if (!slot || !slot.task || slot.task === 'idle') return false;
      if (slotIsFresh(slot)) return true;
      return slot.workLockUntil > 0 && Date.now() < slot.workLockUntil;
    }

    function workingSlots() {
      const list = [];
      SQUAD_SLOTS.forEach((id) => { if (slotIsWorking(squad[id])) list.push(id); });
      return list;
    }

    // Another tab holds a live session work lock: a quiz run or a harvest is in
    // progress there even if the cat is between two questions right now.
    function otherTabWorkLocked() {
      if (myTabId == null) return false;
      return SQUAD_SLOTS.some((id) => {
        const slot = squad[id];
        return slot.tabId != null && slot.tabId !== myTabId && slot.workLockUntil > 0 && Date.now() < slot.workLockUntil;
      });
    }

    function isCatBusyOnOtherTab(catId) {
      const slot = squad[catId];
      if (!slot || slot.tabId == null || slot.tabId === myTabId) return false;
      return slotIsWorking(slot) || (slot.workLockUntil > 0 && Date.now() < slot.workLockUntil);
    }

    // True while another tab must keep its cat: a fresh working claim (Rule A) or
    // a live work lock (Rule A+). The owner never blocks itself.
    function otherTabIsBusy() {
      if (!squadEnabled || myTabId == null) return false;
      const busy = SQUAD_SLOTS.some((id) => {
        const slot = squad[id];
        return slot.tabId != null && slot.tabId !== myTabId && slotIsWorking(slot);
      });
      return busy || otherTabWorkLocked();
    }

    function slotTaskLabel(slot) {
      if (!slot || !slot.task || slot.task === 'idle') return 'Working';
      return SQUAD_TASK_LABEL[slot.task] || 'Working';
    }

    // "🐾 Working: Mochi (Exam) • Boba (Harvest)" — the live squad pill shown on
    // every tab that has no cat of its own while one or more cats are busy.
    function squadStatusPill() {
      const parts = [];
      SQUAD_SLOTS.forEach((id) => {
        const slot = squad[id];
        const busy = slotIsWorking(slot) || (slot.tabId != null && slot.workLockUntil > 0 && Date.now() < slot.workLockUntil);
        if (!busy) return;
        parts.push((CATS[id] ? CATS[id].name : id) + ' (' + slotTaskLabel(slot) + ')');
      });
      if (!parts.length) return WORK_PILL_TEXT;
      return '🐾 Working: ' + parts.join(' • ');
    }

    function writeSquad(next) {
      try {
        if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
        chrome.storage.local.set({ [SQUAD_KEY]: next }, () => {
          try { void chrome.runtime.lastError; } catch (error) { /* no listener left */ }
        });
      } catch (error) {
        warnOnce('squad-write', error);
      }
    }

    // Callback style (not promises) so older Chromium builds and a suspended
    // MV3 worker all behave the same; `finish` guarantees exactly one answer.
    function readSquad(callback) {
      let answered = false;
      const finish = (value) => {
        if (answered) return;
        answered = true;
        callback(value);
      };
      try {
        if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
          finish(null);
          return;
        }
        chrome.storage.local.get(SQUAD_KEY, (data) => {
          try {
            if (chrome.runtime.lastError) { finish(null); return; }
          } catch (error) { /* ignore */ }
          finish(data ? data[SQUAD_KEY] : null);
        });
      } catch (error) {
        warnOnce('squad-read', error);
        finish(null);
      }
    }

    function requestTabId(callback) {
      let answered = false;
      const finish = (value) => {
        if (answered) return;
        answered = true;
        callback(value);
      };
      try {
        if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
          finish(null);
          return;
        }
        chrome.runtime.sendMessage({ action: 'GET_CURRENT_TAB_ID' }, (response) => {
          try {
            if (chrome.runtime.lastError) { finish(null); return; }
          } catch (error) { /* ignore */ }
          finish(response && typeof response.tabId === 'number' ? response.tabId : null);
        });
      } catch (error) {
        warnOnce('presence-tab-id', error);
        finish(null);
      }
    }

    // Read-modify-write of the shared map. `mutate` receives a normalized copy
    // and edits it in place; the result is mirrored locally first so the UI
    // reacts immediately, then persisted for the other tabs.
    function updateSquad(mutate) {
      if (!squadEnabled || myTabId == null) return;
      readSquad((stored) => {
        const next = normalizeSquad(stored || squad);
        try { mutate(next); } catch (error) { warnOnce('squad-mutate', error); return; }
        squad = next;
        refreshAssignedCat();
        writeSquad(next);
        applyPresence();
      });
    }

    // Rule A+: keep this tab's session work lock visible in its slot without
    // disturbing which cat it owns. Claims a cat first if there is none yet.
    function publishWorkLock() {
      if (!squadEnabled || myTabId == null) return;
      const task = taskKindForState(currentState);
      if (!myCatId || !squad[myCatId] || squad[myCatId].tabId !== myTabId) {
        if (task) claimBusy(currentState);
        return;
      }
      if (task) myTask = task;
      updateSquad((next) => {
        const slot = next[myCatId];
        if (!slot || slot.tabId !== myTabId) return;
        next[myCatId] = { ...slot, task: myTask || slot.task, url: pageUrl(), workLockUntil: _activeWorkUntil, updatedAt: Date.now() };
      });
    }

    // Claim the specialist cat for a job (exam → Mochi, harvest → Boba,
    // review → Luna), falling back to any free slot. The read happens right
    // before the write and the jitter staggers simultaneous starts, so two tabs
    // starting together normally end up with two different cats.
    function claimSquad(task) {
      if (!uiEnabled) return;
      const wanted = task || 'exam';
      if (!squadEnabled || myTabId == null) {
        myTask = wanted;
        myCatId = preferredCatFor(wanted);
        refreshAssignedCat();
        applyPresence();
        return;
      }
      if (myCatId && squad[myCatId] && squad[myCatId].tabId === myTabId) {
        const slot = squad[myCatId];
        if (slot.task === wanted || (slot.task === 'idle' && slot.workLockUntil > Date.now())) {
          myTask = wanted; // the session work lock already reserves this cat
          if (slot.task !== wanted) {
            updateSquad((next) => {
              const current = next[myCatId];
              if (!current || current.tabId !== myTabId) return;
              next[myCatId] = { ...current, task: wanted, updatedAt: Date.now() };
            });
          }
          refreshAssignedCat();
          applyPresence();
          return;
        }
      }
      if (claimInFlight) { myTask = wanted; refreshAssignedCat(); applyPresence(); return; }
      claimInFlight = true;
      const jitter = 20 + Math.floor(Math.random() * 180);
      setTimeout(() => {
        readSquad((stored) => {
          const next = normalizeSquad(stored);
          // Free every slot this tab held before choosing its specialist.
          SQUAD_SLOTS.forEach((id) => {
            if (next[id].tabId === myTabId) {
              next[id] = { tabId: null, task: '', url: '', workLockUntil: 0, updatedAt: Date.now() };
            }
          });
          const preferred = preferredCatFor(wanted);
          const order = [preferred].concat(SQUAD_SLOTS.filter((id) => id !== preferred));
          let chosen = null;
          for (let i = 0; i < order.length; i += 1) {
            const slot = next[order[i]];
            const taken = slot.tabId != null && slot.tabId !== myTabId
              && (slotIsFresh(slot) || (slot.workLockUntil > 0 && Date.now() < slot.workLockUntil));
            if (!taken) { chosen = order[i]; break; }
          }
          claimInFlight = false;
          squad = next;
          if (!chosen) {
            // All three cats are working elsewhere: no cat here, show the pill.
            myCatId = null;
            myTask = '';
            refreshAssignedCat();
            applyPresence();
            return;
          }
          next[chosen] = {
            tabId: myTabId,
            task: wanted,
            url: pageUrl(),
            workLockUntil: _activeWorkUntil,
            updatedAt: Date.now(),
          };
          myCatId = chosen;
          myTask = wanted;
          assignedCatId = chosen;
          applyCatIdentity();
          writeSquad(next);
          applyPresence();
        });
      }, jitter);
    }

    // Feed every HUD line through here (before any other reader). A quiz run and a
    // harvest re-arm a 20 s work lock, so the cat stays put through the idle gap
    // between two questions; "Bot stopped" / "Quiz complete" / "Review scan:" /
    // "Harvested" end it immediately.
    function noteWorkLockLine(line) {
      if (!line) return;
      if (WORK_END_RE.test(line)) {
        const harvestAborted = HARVEST_ABORT_RE.test(line);
        if (!_activeWorkUntil && !harvestAborted) return;
        _activeWorkUntil = 0;
        lastWorkLockPushAt = 0; // the next run publishes at once
        // Failed/empty harvests release their slot immediately; other active runs
        // only clear the lock and let the state change to idle hand the slot back.
        if (currentState === 'idle' || harvestAborted) { releaseBusy(); return; }
        publishWorkLock();
        return;
      }
      if (!WORK_START_RE.test(line)) return;
      _activeWorkUntil = Date.now() + WORK_LOCK_MS;
      if (Date.now() - lastWorkLockPushAt < 4000) return; // ≤ one storage write / 4 s
      lastWorkLockPushAt = Date.now();
      publishWorkLock();
    }

    function claimBusy(state) {
      if (!uiEnabled) return; // the popup switch is off: this tab must not claim
      if (!BUSY_LABELS[state]) return;
      const task = taskKindForState(state);
      if (!task) return;
      claimSquad(task);
    }

    // Idle hand-back. Inside a run/harvest (`_activeWorkUntil` in the future) the
    // slot stays reserved for this tab but reads task 'idle', so the other tabs
    // keep showing "Working" through the gap between two questions. Once the run
    // really ends the slot is freed and the focused tab gets Mochi back.
    function releaseBusy() {
      if (!uiEnabled) return;
      const keep = _activeWorkUntil > Date.now();
      if (!squadEnabled || myTabId == null) {
        myCatId = null;
        myTask = '';
        refreshAssignedCat();
        applyPresence();
        return;
      }
      if (!myCatId) {
        myTask = '';
        applyPresence();
        return;
      }
      if (myTask === 'idle' && keep) { applyPresence(); return; }
      if (keep) {
        myTask = 'idle';
        updateSquad((next) => {
          const slot = next[myCatId];
          if (!slot || slot.tabId !== myTabId) return;
          next[myCatId] = { ...slot, task: 'idle', url: pageUrl(), workLockUntil: _activeWorkUntil, updatedAt: Date.now() };
        });
        return;
      }
      myCatId = null;
      myTask = '';
      updateSquad((next) => {
        SQUAD_SLOTS.forEach((id) => {
          if (next[id].tabId === myTabId) {
            next[id] = { tabId: null, task: '', url: '', workLockUntil: 0, updatedAt: Date.now() };
          }
        });
        const jobsLeft = SQUAD_SLOTS.some((id) => slotIsWorking(next[id]));
        if (jobsLeft) return; // a cat still works elsewhere: this tab keeps the pill
        if (!tabVisible()) return;
        // Every job finished: the primary cat returns to this (focused) tab.
        next.mochi = { tabId: myTabId, task: 'idle', url: pageUrl(), workLockUntil: 0, updatedAt: Date.now() };
        myCatId = 'mochi';
        myTask = 'idle';
      });
    }

    // Rule B: take the idle Mochi onto this (visible) tab. `follow` greets the
    // user only when he came from another tab, so a plain page load stays quiet.
    function claimIdle(follow) {
      if (!uiEnabled) return;
      if (!squadEnabled || myTabId == null) return;
      if (!tabVisible()) return;
      // A working cat on this tab always wins over an idle claim.
      const holdsSlot = !!myCatId && !!squad[myCatId] && squad[myCatId].tabId === myTabId;
      if (holdsSlot && slotIsWorking(squad[myCatId])) {
        applyPresence();
        return;
      }
      if (myTask && myTask !== 'idle' && holdsSlot) { applyPresence(); return; }
      if (otherTabIsBusy() || otherTabWorkLocked()) return; // Rule A always wins
      const previousOwner = squad.mochi.tabId;
      if (squad.mochi.tabId === myTabId && squad.mochi.task === 'idle' && slotIsFresh(squad.mochi)) {
        myCatId = 'mochi';
        myTask = 'idle';
        refreshAssignedCat();
        applyPresence();
        return;
      }
      readSquad((stored) => {
        const next = normalizeSquad(stored);
        const jobsLeft = SQUAD_SLOTS.some((id) => slotIsWorking(next[id]) && next[id].tabId !== myTabId);
        if (jobsLeft || otherTabWorkLocked()) { squad = next; applyPresence(); return; }
        // Only one idle mascot follows the user: fold every idle assignment away.
        SQUAD_SLOTS.forEach((id) => {
          if (next[id].task === 'idle' || next[id].tabId == null) {
            next[id] = { tabId: null, task: '', url: '', workLockUntil: 0, updatedAt: Date.now() };
          }
        });
        next.mochi = { tabId: myTabId, task: 'idle', url: pageUrl(), workLockUntil: 0, updatedAt: Date.now() };
        squad = next;
        myCatId = 'mochi';
        myTask = 'idle';
        refreshAssignedCat();
        writeSquad(next);
        applyPresence();
        if (follow && previousOwner != null && previousOwner !== myTabId) {
          const line = pickFreshLine(FOLLOW_LINES);
          if (line) setBubble(line, true);
          scheduleQuote();
        }
      });
    }

    function tabVisible() {
      try {
        return document.visibilityState === 'visible';
      } catch (error) {
        return true;
      }
    }

    function documentHasFocus() {
      try {
        return typeof document.hasFocus === 'function' ? document.hasFocus() : true;
      } catch (error) {
        return true;
      }
    }

    // Polled by the existing 1.5 s reconciler. Ownership never moves merely
    // because two tabs poll each other (that would trade cats forever); it only
    // moves on two one-shot recoveries: a working claim older than
    // PRESENCE_STALE_MS means that tab was closed/crashed, and a finished
    // run/harvest ("Bot stopped" / "Harvested" / "Quiz complete") hands Mochi
    // back to the tab the user is actually looking at.
    function presenceTick() {
      if (!uiEnabled) return;
      if (!squadReady) return;
      applyPresence();
      if (hangout.active) syncHangoutCats();
      if (!squadEnabled) return;
      const busyElsewhere = otherTabIsBusy() || otherTabWorkLocked();
      if (busyElsewhere) {
        sawOtherTabWorking = true; // Rule A / A+ still holds at least one cat
        return;
      }
      // The other tabs stopped working. Focus decides, so two visible windows can
      // never trade the idle cat back and forth.
      if (sawOtherTabWorking) {
        sawOtherTabWorking = false;
        if (tabVisible() && documentHasFocus()) { claimIdle(true); return; }
      }
      if (!myCatId && taskKindForState(currentState)) { claimBusy(currentState); return; }
      if (myCatId && squad[myCatId] && squad[myCatId].tabId === myTabId) return; // this tab shows a cat
      const owner = squad.mochi;
      if (owner.tabId === myTabId) return;
      if (owner.tabId != null && owner.task === 'idle' && slotIsFresh(owner)) return; // another tab shows Mochi
      if (Date.now() - lastStaleRecoveryAt < PRESENCE_STALE_MS) return;
      if (!tabVisible() || !documentHasFocus()) return;
      lastStaleRecoveryAt = Date.now();
      claimIdle(false); // the stale owner vanished: take the idle cat back
    }

    // Rule B follow-through for "work finished while I was already watching this
    // tab": a hand-off published by another tab is claimed by the focused tab.
    // The tab-id tie-break (`myTabId < previousOwner`) keeps it deterministic.
    function maybeFollowIdle(previousOwner) {
      if (!squadEnabled || myTabId == null) return;
      if (otherTabIsBusy() || otherTabWorkLocked()) return; // another cat still works
      if (previousOwner == null || previousOwner === myTabId) return;
      if (myTabId >= previousOwner) return;                // deterministic winner only
      if (!tabVisible() || !documentHasFocus()) return;
      claimIdle(true); // "Done working! What are we doing on this tab?"
    }

    function showCat() {
      if (!wrapEl) return;
      if (wrapEl.style.display === 'none') wrapEl.style.display = 'block';
      if (!booted || currentState !== 'idle' || napping) { refreshSquadBadge(); return; }
      if (!roamTimer) scheduleRoam();
      if (!quoteTimer) scheduleQuote();
      refreshSquadBadge();
    }

    function hideCat() {
      if (!wrapEl) return;
      if (wrapEl.style.display !== 'none') wrapEl.style.display = 'none';
      if (bubbleEl) bubbleEl.classList.remove('qb-bubble-visible');
      if (roamTimer) { clearTimeout(roamTimer); roamTimer = null; }
      if (quoteTimer) { clearTimeout(quoteTimer); quoteTimer = null; }
      stopSquadHangout();
      refreshSquadBadge();
    }

    function showPill(show, text) {
      if (!pillEl) return;
      if (!uiEnabled) { pillEl.classList.remove(PILL_CLASS); return; }
      const label = text || PILL_TEXT;
      if (pillEl.textContent !== label) pillEl.textContent = label;
      let visible = true;
      try { visible = document.visibilityState === 'visible'; } catch (error) { /* assume */ }
      pillEl.classList.toggle(PILL_CLASS, !!show && visible);
    }

    // Single source of truth for "which cat is painted here?". A fresh idle
    // owner can keep its cosmetic cat visible while a different squad member
    // works elsewhere, allowing a hangout to show only the remaining free cats.
    function applyPresence() {
      if (!wrapEl) return;
      // Disabled in the popup: nothing of the mascot exists on this tab at all.
      if (!uiEnabled) { hideCat(); showPill(false); return; }
      if (!squadReady) { hideCat(); showPill(false); return; }
      if (!squadEnabled) {
        // Single-tab fallback: show the specialist for the current job.
        if (!myCatId) myCatId = preferredCatFor(myTask || taskKindForState(currentState) || 'exam');
        refreshAssignedCat();
        showCat();
        showPill(false);
        return;
      }

      // If another tab took this slot (rare simultaneous claim), forget it so the
      // next reconciliation tick can claim one of the remaining free cats.
      if (myCatId && (!squad[myCatId] || squad[myCatId].tabId !== myTabId)) {
        myCatId = null;
        if (myTask === 'idle') myTask = '';
        refreshAssignedCat();
      }

      // A cat assigned to this tab: working or the fresh idle owner. The idle
      // owner may stay visible while another cat works on a different tab.
      let mine = null;
      SQUAD_SLOTS.forEach((id) => {
        if (mine) return;
        const slot = squad[id];
        if (slot.tabId !== myTabId) return;
        if (slotIsWorking(slot) || (slot.task === 'idle' && slotIsFresh(slot))) mine = id;
      });
      const mineWorking = !!mine && slotIsWorking(squad[mine]);
      const busyElsewhere = SQUAD_SLOTS.some((id) => {
        const slot = squad[id];
        return slot.tabId != null && slot.tabId !== myTabId && slotIsWorking(slot);
      }) || otherTabWorkLocked();

      if (mine && (mineWorking ||
          (squad[mine].task === 'idle' && slotIsFresh(squad[mine])))) {
        myCatId = mine;
        myTask = squad[mine].task || 'idle';
        refreshAssignedCat();
        showCat();
        showPill(false);
        return;
      }
      if (busyElsewhere || (mine == null && workingSlots().length)) {
        hideCat();
        showPill(true, squadStatusPill());
        return;
      }

      // Every job finished. Only one tab paints Mochi: the fresh idle owner, or
      // a visible tab in the split second before the first claim lands.
      const owner = squad.mochi;
      const ownerIdle = owner.tabId != null && owner.task === 'idle' && slotIsFresh(owner);
      if (ownerIdle && owner.tabId === myTabId) {
        myCatId = 'mochi';
        myTask = 'idle';
        refreshAssignedCat();
        showCat();
        showPill(false);
        return;
      }
      if (!ownerIdle && !myCatId && tabVisible()) {
        assignedCatId = 'mochi';
        applyCatIdentity();
        showCat();
        showPill(false);
        return;
      }
      hideCat();
      showPill(false);
    }

    /* ── Instant enable/disable (BOT_ENABLED) ─────────────────────────────── */

    // popup.js writes BOT_ENABLED to chrome.storage.local and mirrors it to
    // .sync; local wins when present, `!== false` means enabled.
    function readBotEnabled(callback) {
      const done = (value) => { try { callback(value !== false); } catch (error) { /* ignore */ } };
      try {
        if (typeof chrome === 'undefined' || !chrome.storage) { done(true); return; }
        chrome.storage.local.get('BOT_ENABLED', (local) => {
          try { if (chrome.runtime.lastError) { done(true); return; } } catch (error) { /* ignore */ }
          if (local && local.BOT_ENABLED !== undefined) { done(local.BOT_ENABLED); return; }
          try {
            chrome.storage.sync.get('BOT_ENABLED', (sync) => {
              try { if (chrome.runtime.lastError) { done(true); return; } } catch (error) { /* ignore */ }
              done(sync ? sync.BOT_ENABLED : undefined);
            });
          } catch (error) { done(true); }
        });
      } catch (error) { done(true); }
    }

    // Disabled: cats + pill gone and every idle timer stopped. Enabled: the
    // shared CAT_SQUAD map decides which cat comes back on this tab.
    function applyUiEnabled(enabled) {
      const next = enabled !== false;
      const changed = next !== uiEnabled;
      uiEnabled = next;
      if (!next) {
        hideCat();
        showPill(false);
        if (wrapEl) wrapEl.style.display = 'none';
        if (pillEl) pillEl.classList.remove(PILL_CLASS);
        if (napQuoteTimer) { clearTimeout(napQuoteTimer); napQuoteTimer = null; }
        if (overlayTimer) { clearTimeout(overlayTimer); overlayTimer = null; }
        overlayState = '';
        return;
      }
      if (changed) applyPresence();
    }

    function watchUiEnabled() {
      if (uiEnabledWatched) return;
      uiEnabledWatched = true;
      try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
          chrome.storage.onChanged.addListener((changes, areaName) => {
            try {
              if (areaName !== 'local' && areaName !== 'sync') return;
              if (!changes || !changes.BOT_ENABLED) return;
              const value = changes.BOT_ENABLED.newValue;
              applyUiEnabled(value === undefined ? true : value);
            } catch (error) { warnOnce('ui-toggle-change', error); }
          });
        }
      } catch (error) { /* storage events unavailable */ }
      readBotEnabled((enabled) => applyUiEnabled(enabled));
    }

    // Every state change runs through here: working states claim the specialist
    // cat for their job, idle hands it back to whichever tab the user is on.
    function syncPresenceForState(state) {
      // Starting a quiz / harvest always wakes the cat up, even before the shared
      // map is ready (the state's own bubble takes over right after).
      if (state === 'idle') wakeFromNap(null);
      else if (BUSY_LABELS[state]) wakeFromNap(WAKE_LINE);
      if (!uiEnabled) return; // disabled in the popup: never claim a cat
      const task = taskKindForState(state);
      if (task) {
        stopSquadHangout(); // a real job always ends the hangout
        claimBusy(state);
        return;
      }
      if (state === 'idle') releaseBusy();
    }

    /* ── Summon Squad hangout (idle + cosmetic only) ──────────────────────── */

    const SQUAD_SIZE = 96;               // px — exact 4× scale of the 24×24 sprite
    const SQUAD_TAP_MS = 800;            // triple-click window
    const HANG_LINE_MIN_MS = 3800;       // squad chatter cadence
    const HANG_LINE_SPREAD_MS = 2600;
    const HANG_BUBBLE_MS = 3600;         // how long a secondary cat's bubble stays
    const HANG_LINES = [
      'Squad assemble!! 🐾✨',
      'Best squad in the whole browser 🐾',
      'Three cats, zero bugs. Probably. 🐾🔥',
    ];

    const hangout = {
      active: false,
      starting: false,
      requestId: 0,
      cats: [],
      lineTimer: null,
      taps: [],
    };
    let squadBadgeEl = null;

    function pickCatLine(catId, kind) {
      const cat = CATS[catId] || CATS.mochi;
      const pool = cat && cat.lines ? cat.lines[kind] : null;
      return Array.isArray(pool) && pool.length ? pickFreshLine(pool) : '';
    }

    // Swap the primary canvas to the cat this tab now owns (new palette,
    // accessory, aria-label and badge title), then repaint at once.
    function applyCatIdentity() {
      const cat = CATS[assignedCatId] || CATS.mochi;
      if (catEl) {
        catEl.dataset.cat = assignedCatId;
        catEl.setAttribute('aria-label', 'Quiz bot pixel cat ' + cat.name + ' — ' + cat.fur + ', ' + cat.role);
      }
      if (wrapEl) wrapEl.dataset.cat = assignedCatId;
      paintPrimary();
      refreshSquadBadge();
    }

    function refreshAssignedCat() {
      const next = myCatId && CATS[myCatId] ? myCatId : (myTask ? preferredCatFor(myTask) : 'mochi');
      if (next === assignedCatId) { refreshSquadBadge(); return; }
      assignedCatId = next;
      applyCatIdentity();
    }

    function refreshSquadBadge() {
      if (!squadBadgeEl) return;
      const count = hangout.active
        ? 1 + SQUAD_SLOTS.filter((id) => id !== assignedCatId && !isCatBusyOnOtherTab(id)).length
        : 1;
      const label = 'Squad (' + count + '/3)';
      if (squadBadgeEl.textContent !== label) squadBadgeEl.textContent = label;
      squadBadgeEl.title = hangout.active
        ? 'Send the free cats home (triple-click the cat also toggles)'
        : 'Summon Squad — hang out with Mochi, Luna & Boba';
      const allowed = uiEnabled && booted && currentState === 'idle' && !napping
        && catShown();
      squadBadgeEl.classList.toggle(SQUAD_BADGE_HIDDEN, !allowed);
    }

    function canHangout() {
      return booted && uiEnabled && currentState === 'idle' && !napping
        && catShown();
    }

    // Triple-click detector: three taps inside SQUAD_TAP_MS toggle the hangout.
    // Returns true when it consumed the click (so it does not also count as a pet).
    function noteSquadTap() {
      const now = Date.now();
      hangout.taps = hangout.taps.filter((at) => now - at < SQUAD_TAP_MS);
      hangout.taps.push(now);
      if (hangout.taps.length < 3) return false;
      hangout.taps = [];
      toggleSquadHangout();
      return true;
    }

    function onSquadBadgeClick() {
      try {
        markInteraction();
        suppressClickUntil = Date.now() + 250; // do not also trigger a pet line
        toggleSquadHangout();
      } catch (error) {
        warnOnce('squad-badge', error);
      }
    }

    function toggleSquadHangout() {
      if (hangout.active) {
        stopSquadHangout();
        setBubble('Squad dismissed! Solo cat life again 🐾', true);
        scheduleQuote();
        return;
      }
      if (!canHangout()) {
        setBubble('Not now — we are working! 💼🐾', true);
        return;
      }
      startSquadHangout();
    }


    function hangoutSpot(index, total) {
      const maxLeft = Math.max(EDGE, window.innerWidth - SQUAD_SIZE - EDGE);
      const span = Math.max(0, maxLeft - EDGE);
      const left = EDGE + span * ((index + 0.6) / Math.max(1, total + 0.4));
      const maxTop = Math.max(EDGE, window.innerHeight - SQUAD_SIZE - EDGE);
      const band = Math.min(80, maxTop * 0.2);
      const top = maxTop - (index % 2 === 0 ? 0 : band);
      return { left, top };
    }

    function spawnHangoutCat(id, index, total) {
      const spot = hangoutSpot(index, total);
      const wrap = document.createElement('div');
      wrap.className = SQUAD_CAT_CLASS;
      wrap.style.left = Math.round(spot.left) + 'px';
      wrap.style.top = Math.round(spot.top) + 'px';

      const bubble = document.createElement('div');
      bubble.className = SQUAD_BUBBLE_CLASS;

      const canvas = document.createElement('canvas');
      canvas.className = SQUAD_CANVAS_CLASS;
      canvas.width = CANVAS;
      canvas.height = CANVAS;
      canvas.setAttribute('aria-hidden', 'true');
      let catCtx = null;
      try {
        catCtx = canvas.getContext('2d');
        if (catCtx) {
          catCtx.imageSmoothingEnabled = false;
          catCtx.setTransform(CANVAS / GRID, 0, 0, CANVAS / GRID, 0, 0);
        }
      } catch (error) {
        catCtx = null;
        warnOnce('squad-context', error);
      }

      wrap.appendChild(bubble);
      wrap.appendChild(canvas);
      const host = document.body || document.documentElement;
      if (host) host.appendChild(wrap);

      return {
        id,
        wrap,
        canvas,
        ctx: catCtx,
        bubble,
        bubbleTimer: null,
        x: spot.left,
        y: spot.top,
        walkUntil: 0,
        nextMoveAt: Date.now() + 600 + Math.random() * 1400,
        tickOffset: 3 + index * 7,
      };
    }

    function syncHangoutCats() {
      if (!hangout.active) return;
      const wanted = SQUAD_SLOTS.filter((id) => id !== assignedCatId && !isCatBusyOnOtherTab(id));
      const wantedSet = new Set(wanted);
      hangout.cats = hangout.cats.filter((cat) => {
        if (wantedSet.has(cat.id)) return true;
        if (cat.bubbleTimer) clearTimeout(cat.bubbleTimer);
        try {
          if (cat.wrap && cat.wrap.parentNode) cat.wrap.parentNode.removeChild(cat.wrap);
        } catch (error) { /* already detached */ }
        return false;
      });
      const existing = new Set(hangout.cats.map((cat) => cat.id));
      wanted.forEach((id) => {
        if (existing.has(id)) return;
        try {
          hangout.cats.push(spawnHangoutCat(id, hangout.cats.length, wanted.length));
        } catch (error) {
          warnOnce('squad-spawn', error);
        }
      });
      refreshSquadBadge();
    }

    function startSquadHangout() {
      if (hangout.active || hangout.starting || !canHangout()) return;
      hangout.starting = true;
      const requestId = ++hangout.requestId;
      readSquad((stored) => {
        if (requestId !== hangout.requestId) return;
        hangout.starting = false;
        squad = normalizeSquad(stored);
        if (!canHangout()) { refreshSquadBadge(); return; }
        hangout.active = true;
        // A triple-click also fires dblclick; drop any cheer overlay it started.
        if (overlayTimer) { clearTimeout(overlayTimer); overlayTimer = null; }
        overlayState = '';
        if (catEl) {
          catEl.classList.remove('qb-hop', 'qb-review');
          applyAsset(renderState());
        } else {
          paintPrimary();
        }
        syncHangoutCats();
        const line = pickCatLine(assignedCatId, 'hang') || pickFreshLine(HANG_LINES);
        if (line) setBubble(line, true);
        scheduleHangoutLine(900);
        refreshSquadBadge();
      });
    }

    function stopSquadHangout() {
      if (hangout.starting) {
        hangout.starting = false;
        hangout.requestId += 1;
      }
      if (!hangout.active) return;
      hangout.active = false;
      if (hangout.lineTimer) { clearTimeout(hangout.lineTimer); hangout.lineTimer = null; }
      hangout.cats.forEach((cat) => {
        if (cat.bubbleTimer) { clearTimeout(cat.bubbleTimer); cat.bubbleTimer = null; }
        try {
          if (cat.wrap && cat.wrap.parentNode) cat.wrap.parentNode.removeChild(cat.wrap);
        } catch (error) { /* already detached */ }
      });
      hangout.cats = [];
      refreshSquadBadge();
    }


    function showSquadBubble(cat, line) {
      if (!cat || !cat.bubble) return;
      cat.bubble.textContent = line;
      cat.bubble.classList.add('qb-bubble-visible');
      if (cat.bubbleTimer) clearTimeout(cat.bubbleTimer);
      cat.bubbleTimer = setTimeout(() => {
        cat.bubbleTimer = null;
        if (cat.bubble) cat.bubble.classList.remove('qb-bubble-visible');
      }, HANG_BUBBLE_MS);
    }

    // Move the extra cats in short trots along the bottom band. The CSS
    // transition does the gliding; walkUntil just selects the trot frames.
    function advanceHangoutCats() {
      if (!hangout.active || !hangout.cats.length) return;
      const now = Date.now();
      const maxLeft = Math.max(EDGE, window.innerWidth - SQUAD_SIZE - EDGE);
      const maxTop = Math.max(EDGE, window.innerHeight - SQUAD_SIZE - EDGE);
      const band = Math.min(80, maxTop * 0.2);
      hangout.cats.forEach((cat) => {
        if (!cat.wrap || now < cat.nextMoveAt) return;
        const nextLeft = EDGE + Math.random() * Math.max(1, maxLeft - EDGE);
        const nextTop = maxTop - Math.random() * band;
        const dx = nextLeft - cat.x;
        if (Math.abs(dx) > 6 && cat.canvas) {
          cat.canvas.classList.toggle('qb-facing-left', dx < 0);
        }
        const distance = Math.abs(dx) + Math.abs(nextTop - cat.y);
        cat.walkUntil = now + Math.min(1400, 450 + distance * 2);
        cat.x = nextLeft;
        cat.y = nextTop;
        cat.wrap.style.left = Math.round(nextLeft) + 'px';
        cat.wrap.style.top = Math.round(nextTop) + 'px';
        cat.nextMoveAt = now + 2200 + Math.random() * 3600;
      });
    }

    function drawHangoutCats(tick) {
      if (!hangout.active) return;
      const now = Date.now();
      hangout.cats.forEach((cat) => {
        if (!cat.ctx) return;
        ctx = cat.ctx;
        applyPalette(cat.id);
        drawCatFrame(now < cat.walkUntil ? 'walk' : 'idle', tick + cat.tickOffset, cat.id);
      });
    }

    // Round-robin chatter: one cat speaks every 4–6 s, in its own personality.
    function scheduleHangoutLine(delay) {
      if (hangout.lineTimer) clearTimeout(hangout.lineTimer);
      hangout.lineTimer = setTimeout(() => {
        hangout.lineTimer = null;
        if (!hangout.active) return;
        const speakers = [assignedCatId].concat(hangout.cats.map((cat) => cat.id));
        const id = speakers[Math.floor(Math.random() * speakers.length)];
        const line = pickCatLine(id, 'hang') || pickFreshLine(HANG_LINES);
        if (line) {
          const extra = hangout.cats.filter((cat) => cat.id === id)[0];
          if (!extra) setBubble(line, true);
          else showSquadBubble(extra, line);
        }
        scheduleHangoutLine(HANG_LINE_MIN_MS + Math.random() * HANG_LINE_SPREAD_MS);
      }, delay || HANG_LINE_MIN_MS);
    }


    /* ── Local Cat Brain Core — zero API keys, zero network ──────────────── */

    // Everything below is local: page identity, a privacy-safe keystroke count, a
    // copy reaction, cursor movement and scroll velocity feed a template composer.
    // No fetch(), no provider call, no key — the cat is chatty offline.
    const BRAIN_KEY = 'CAT_BRAIN_MEMORY';
    const BRAIN_SAVE_MS = 1200;         // debounce: one storage write per burst
    const TYPE_BURST_MS = 1400;         // a pause this long closes a typing burst
    const TYPE_BURST_MIN = 12;          // keys per burst before he comments
    const CURSOR_SAMPLE_MS = 90;        // mousemove sampling floor (~11 Hz)
    const CURSOR_DIZZY_SPEED = 3800;    // px/s → whisker-wiggle dizzy (a real flick)
    const DIZZY_HOLD_MS = 1200;
    const DIZZY_COOLDOWN_MS = 12000;
    const SCROLL_SPEED = 3400;          // px/s → "WHOA slow down scrolling!!"
    const SCROLL_COOLDOWN_MS = 9000;
    const THOUGHT_MEMORY = 14;          // remember this many lines to avoid repeats
    const COPY_LINE = 'I saw you copy that!! Saving braincells? 👀📋';
    const DIZZY_LINES = [
      'Whoa— dizzy!! My whiskers are spinning!! 🌀🙀',
      'Slow paws!! You are making me seasick. 🐾💫',
      'Wheee— my eyes cannot keep up!! 😵‍💫',
      'Is the mouse running a marathon? 😹💨',
    ];
    const SCROLL_LINES = [
      'WHOA slow down scrolling!! 🎢🙀',
      'You are scrolling like the answer is hiding! 🐾💨',
      'SCROLL SLOWER. My paws are smoking. 🔥🐾',
      'Racing to the bottom? The questions are still up there! 😾⬆️',
    ];
    const TYPING_BRAIN_LINES = [
      '{keys} keys in a burst! Essay mode?? ✍️😼',
      'Tap tap tap… {keys} keystrokes. I heard all of them. 👂🐾',
      'Your keyboard is getting a workout: {keys} keys! ⌨️💪',
      'Writing a novel over there? {keys} keys already! 📖😹',
    ];
    const GENERIC_BRAIN_LINES = [
      'Just vibing on {host}. 🐾',
      'Still here! Still a cat. 🐱',
      'Plot twist: the answer was in your notes all along. 📓',
      'My tail is a metronome for your productivity. 🎵',
      'Blink test… yep, still working. 😼',
      'I give this tab a 9/10 for nap-ability. 😴',
      'If in doubt, re-read the question. Trust me. 🙀',
      'Your mouse cursor is my favourite toy. 🐁',
      'Whisker status: fully calibrated. ✨',
      'Ten more minutes and I am napping on your keyboard. ⌨️',
      'Psst… stretch your shoulders. I will wait. 🧘',
      'I have no thumbs, yet here we are, working. 🐾',
      'Reminder: you are doing better than you think. 💛',
      'Loading more brain cells… ▓▓▓░░ 60% 🧠',
    ];
    const TITLE_BRAIN_LINES = [
      '"{title}" — sounds important. Ears up! 🐱📖',
      'So we are on "{title}" now. Noted. 📝',
      '"{title}"? I could summarise that in one meow. 😼',
      'This page is called "{title}". Fancy. 🎩',
      '"{title}"… reading it with my strongest reading glasses. 🤓',
    ];


    const COURSE_BRAIN_LINES = [
      '{course} again? We own this subject now. 💪',
      '{course} detected. Braincells, assemble! 🧠⚡',
      'A wild {course} problem appears. I believe in you. 🐾',
      '{course}? My whiskers say you already know this. ✨',
    ];
    const BANK_BRAIN_LINES = [
      'I am carrying {bank} answers in my little cat backpack. 🎒',
      '{bank} answers stored. That is a lot of fish. 🐟',
      'My brain bank holds {bank} questions and counting! 🧠📚',
    ];
    const HOP_BRAIN_LINES = [
      '{hops} tabs today. My paws are tired. 🐾',
      'Tab hop #{hops}. I am basically a parkour cat now. 🏃',
      'We have visited {hops} tabs today — adventurous! 🗺️',
    ];
    const PET_BRAIN_LINES = [
      'That is {pets} pets so far. I am keeping score. 😽',
      '{pets} pets! My fur has never been fluffier. ✨',
      'Pet #{pets} accepted. Purring engaged. 💛',
    ];
    const NIGHT_LINES = [
      'It is {time}. The late-night study arc is real. 🌙😾',
      '{time}?? Sleep is also a strategy, you know. 🛏️',
      'Night owl mode: ON. I will keep watch. 🦉🐾',
      'At {time} even my whiskers are sleepy. 😴',
      'Late-night brain: 10% logic, 90% vibes. 🌌',
      'The house is quiet, {host} is open. Cozy. 🌙',
    ];
    // Site-specific commentary, keyed by the hostname buckets below.
    const SITE_LINES = {
      youtube: [
        'YouTube again? One video, then back to work. Promise? 📺😼',
        'I will allow exactly one cat video. Then we study. 🐈📹',
        'Autoplay is a trap and you know it. ⏭️🙀',
        'Is this "research"? Because it looks like cat videos. 🐾👀',
      ],
      messenger: [
        'Chatting? Say hi from me. 🐾💬',
        'Tell them a cat says the answers are in the notes. 😼📚',
        'Messenger pings and my ears twitch every time. 👂✨',
        'One reply, then back to the questions. Deal? 🤝🐾',
      ],
      github: [
        'GitHub! Pushing answers or pushing code? 🐙✨',
        'Green squares are basically catnip for you. 🟩😹',
        'Commit early, commit often, then pet the cat. 🐾💾',
        'I reviewed your commits. Very fluffy. LGTM. ✅',
      ],
      ai: [
        'Another AI tab? Am I not enough?! 😾🤖',
        'Ask them, sure… but I already had the vibe of the answer. 🔮',
        'Two AIs and one cat in one browser. Bold. 🧠🐾',
        'I hope that one also knows the answers. 👀✨',
      ],
    };
    const AI_HOSTS_RE = /(^|\.)(chatgpt\.com|chat\.openai\.com|claude\.ai|gemini\.google\.com|perplexity\.ai|copilot\.microsoft\.com|deepseek\.com|grok\.com|x\.ai)$/i;
    const STUDY_HOSTS_RE = /(amaes\.com|amauoed\.com|quizlet\.com|studocu\.com|brainly\.|coursehero\.com|scribd\.com|moodle)/i;

    // `gazeLook` is read by drawFace(): -1 pupils left, 0 centre, +1 right.
    let gazeLook = 0;
    let dizzyTimer = null;

    const brain = {
      started: false,
      loaded: false,
      saveTimer: null,
      day: '',
      tabHopsToday: 0,
      petCount: 0,
      copyCount: 0,
      keyCount: 0,
      bankCount: 0,
      host: '',
      cleanTitle: '',
      courseCode: '',
      timeStr: '',
      lastThought: '',
      recent: [],
      typing: { keys: 0, timer: null },
      cursor: { x: 0, y: 0, at: 0, speed: 0, lastDizzyAt: 0, samples: 0 },
      scroll: { y: 0, at: 0, lastAlarmAt: 0 },
    };

    /* ── Brain: live context (all local, all read-only) ───────────────────── */

    function todayKey() {
      const now = new Date();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      return now.getFullYear() + '-' + month + '-' + day;
    }

    // Site buckets used for the commentary below.
    function siteKind(host) {
      const value = String(host || brain.host || '').toLowerCase();
      if (!value) return '';
      if (/(^|\.)(youtube\.com|youtu\.be)$/.test(value)) return 'youtube';
      if (/(^|\.)(messenger\.com|facebook\.com|web\.whatsapp\.com|discord\.com|instagram\.com|t\.me|telegram\.org)$/.test(value)) return 'messenger';
      if (/(^|\.)(github\.com|gist\.github\.com|gitlab\.com)$/.test(value)) return 'github';
      if (AI_HOSTS_RE.test(value)) return 'ai';
      return '';
    }

    function cleanPageTitle(raw) {
      let text = norm(raw);
      if (!text) return '';
      text = text
        .replace(/^\(\d+\+?\)\s*/, '')  // "(3) Messenger"
        .replace(/\s*[·|–—-]\s*(?:YouTube|Messenger|GitHub|Google\s+Chrome|Moodle|Quizlet|Studocu|Brainly|Course\s*Hero|Scribd)\s*$/i, '')
        .replace(/\s*\|\s*.*$/, '')     // "Course | Site"
        .replace(/\s+/g, ' ')
        .trim();
      if (text.length > 64) text = text.slice(0, 61).trim() + '…';
      return text;
    }

    // ECON1012 / IT3010 / CS101 → the course code the cat can nod at.
    function courseCodeFrom(text) {
      const raw = String(text || '');
      const strict = raw.match(/\b[A-Z]{2,4}\d{4}\b/);
      if (strict) return strict[0];
      // Tab titles are often lowercased upstream: retry, then normalise.
      const loose = raw.match(/\b([A-Za-z]{2,4})(\d{4})\b/);
      return loose ? (loose[1] + loose[2]).toUpperCase() : '';
    }

    function refreshBrainContext() {
      try {
        if (typeof location !== 'undefined' && location.hostname) {
          brain.host = String(location.hostname).replace(/^www\./i, '');
        }
      } catch (error) { /* keep the old host */ }
      const rawTitle = (typeof document !== 'undefined' && document.title) || '';
      brain.cleanTitle = cleanPageTitle(rawTitle);
      brain.courseCode = courseCodeFrom(rawTitle) || courseCodeFrom(brain.cleanTitle);
      let time = '';
      try { time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch (error) { time = ''; }
      brain.timeStr = time;
      return brain;
    }

    function isLateNight() {
      const hour = new Date().getHours();
      return hour >= 0 && hour < 5; // 00:00 – 04:59
    }

    /* ── Brain: the dynamic sentence composer ─────────────────────────────── */

    function thoughtContext(extra) {
      refreshBrainContext();
      const ctx = {
        title: brain.cleanTitle || 'this page',
        host: brain.host || 'this page',
        course: brain.courseCode,
        time: brain.timeStr || '',
        bank: brain.bankCount ? String(brain.bankCount) : '',
        hops: brain.tabHopsToday ? String(brain.tabHopsToday) : '',
        pets: brain.petCount ? String(brain.petCount) : '',
        keys: brain.keyCount ? String(brain.keyCount) : '',
      };
      if (extra && typeof extra === 'object') {
        Object.keys(extra).forEach((key) => { ctx[key] = String(extra[key]); });
      }
      return ctx;
    }

    // `{slot}` → live value. A line that needs data we do not have is dropped
    // instead of showing an empty hole ("{course} again?" with no code).
    function fillThought(template, ctx) {
      let missing = false;
      const filled = String(template || '').replace(/\{(\w+)\}/g, (match, key) => {
        const value = ctx[key];
        if (!value) { missing = true; return ''; }
        return value;
      });
      return missing ? '' : filled;
    }

    function rememberThought(line) {
      brain.lastThought = line;
      brain.recent.push(line);
      while (brain.recent.length > THOUGHT_MEMORY) brain.recent.shift();
    }

    // The whole brain in one call: collect every pool that fits the moment, fill
    // the slots, then pick a line that was not used recently. `kind` is
    // 'idle' | 'pet' | 'hype' | 'typing' | 'copy' | 'scroll' | 'dizzy'.
    function composeCatThought(kind, extra) {
      try {
        const mode = kind || 'idle';
        const ctx = thoughtContext(extra);
        const pool = [];
        const add = (list) => { if (Array.isArray(list)) list.forEach((line) => pool.push(line)); };
        if (mode === 'copy') add([COPY_LINE]);
        else if (mode === 'scroll') add(SCROLL_LINES);
        else if (mode === 'dizzy') add(DIZZY_LINES);
        else if (mode === 'typing') add(TYPING_BRAIN_LINES);
        else if (mode === 'pet') { add(PET_LINES); add(PET_BRAIN_LINES); add(TITLE_BRAIN_LINES); }
        else if (mode === 'hype') {
          add(HYPE_LINES);
          add(TITLE_BRAIN_LINES);
          if (brain.courseCode) add(COURSE_BRAIN_LINES);
          if (isLateNight()) add(NIGHT_LINES);
        } else {
          add(GENERIC_BRAIN_LINES);
          if (isLateNight()) add(NIGHT_LINES);
          const site = siteKind();
          if (site) add(SITE_LINES[site]);
          add(TITLE_BRAIN_LINES);
          if (brain.courseCode) add(COURSE_BRAIN_LINES);
          if (brain.bankCount) add(BANK_BRAIN_LINES);
          if (brain.tabHopsToday > 1) add(HOP_BRAIN_LINES);
          if (brain.petCount) add(PET_BRAIN_LINES);
        }
        const fresh = [];
        const seen = new Set();
        pool.forEach((template) => {
          const line = fillThought(template, ctx);
          if (!line || seen.has(line)) return;
          seen.add(line);
          if (brain.recent.indexOf(line) !== -1) return;
          if (line === lastBubbleText) return;
          fresh.push(line);
        });
        const candidates = fresh.length ? fresh : Array.from(seen);
        if (!candidates.length) return mode === 'idle' ? pickFreshLine(IDLE_QUOTES) : '';
        const pick = candidates[Math.floor(Math.random() * candidates.length)];
        rememberThought(pick);
        return pick;
      } catch (error) {
        warnOnce('brain-compose', error);
        return '';
      }
    }

    /* ── Brain: persistence (CAT_BRAIN_MEMORY in chrome.storage.local) ────── */

    // Daily counters: tabHopsToday + keystroke/copy counts restart on a new day,
    // petCount and the bank count are lifetime numbers.
    function rollBrainDay() {
      const today = todayKey();
      if (brain.day === today) return;
      brain.day = today;
      brain.tabHopsToday = 0;
      brain.keyCount = 0;
      brain.copyCount = 0;
    }

    function saveBrain() {
      if (brain.saveTimer) return; // debounced: one write per burst
      brain.saveTimer = setTimeout(() => {
        brain.saveTimer = null;
        try {
          if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
          const payload = {
            day: brain.day,
            tabHopsToday: brain.tabHopsToday,
            petCount: brain.petCount,
            copyCount: brain.copyCount,
            keyCount: brain.keyCount,
            bankCount: brain.bankCount,
            updatedAt: Date.now(),
          };
          chrome.storage.local.set({ [BRAIN_KEY]: payload }, () => {
            try { void chrome.runtime.lastError; } catch (error) { /* no listener left */ }
          });
        } catch (error) { warnOnce('brain-save', error); }
      }, BRAIN_SAVE_MS);
    }

    function loadBrain() {
      rollBrainDay();
      try {
        if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
          brain.loaded = true;
          return;
        }
        // Only study hosts pay for reading the (large) answer cache; every other
        // tab reuses the count persisted in CAT_BRAIN_MEMORY.
        const keys = [BRAIN_KEY];
        if (STUDY_HOSTS_RE.test(brain.host || '')) keys.push('answerkey_cache');
        chrome.storage.local.get(keys, (data) => {
          try {
            if (!chrome.runtime.lastError && data && data[BRAIN_KEY] && typeof data[BRAIN_KEY] === 'object') {
              const stored = data[BRAIN_KEY];
              brain.day = typeof stored.day === 'string' && stored.day ? stored.day : brain.day;
              brain.tabHopsToday = Number(stored.tabHopsToday) || 0;
              brain.petCount = Number(stored.petCount) || 0;
              brain.copyCount = Number(stored.copyCount) || 0;
              brain.keyCount = Number(stored.keyCount) || 0;
              brain.bankCount = Number(stored.bankCount) || 0;
            }
            // One read buys both the stats and the live stored-answer count.
            const cache = data && data.answerkey_cache;
            if (cache && typeof cache === 'object') brain.bankCount = Object.keys(cache).length;
          } catch (error) { warnOnce('brain-load', error); }
          rollBrainDay();
          brain.loaded = true;
          refreshBankCount();
        });
      } catch (error) {
        warnOnce('brain-load', error);
        brain.loaded = true;
      }
    }

    // Free refresh on study hosts (storage.js already holds the cache in memory);
    // everywhere else the persisted count is reused, so no tab pays for a 100 KB
    // read just to say "I have 240 answers".
    function refreshBankCount() {
      try {
        if (typeof answerKeyCount !== 'function') return;
        if (!STUDY_HOSTS_RE.test(brain.host || '')) return;
        Promise.resolve(answerKeyCount()).then((count) => {
          const next = Number(count) || 0;
          if (next === brain.bankCount) return;
          brain.bankCount = next;
          saveBrain();
        }).catch(() => {});
      } catch (error) { /* storage helpers unavailable */ }
    }

    function recordTabHop() {
      try {
        rollBrainDay();
        brain.tabHopsToday += 1;
        saveBrain();
      } catch (error) { warnOnce('brain-hop', error); }
    }

    function recordPet() {
      try {
        brain.petCount += 1;
        saveBrain();
      } catch (error) { warnOnce('brain-pet', error); }
    }

    /* ── Brain: real-time sensors (privacy-safe, never block the page) ─────── */

    // Typing bursts: COUNT ONLY. The `key` is inspected to decide "printable
    // character?" and thrown away — nothing typed is stored or logged.
    function onBrainKeydown(event) {
      try {
        if (!uiEnabled || !event) return;
        const key = event.key;
        if (typeof key !== 'string' || key.length !== 1) return;
        brain.keyCount += 1;
        brain.typing.keys += 1;
        saveBrain();
        if (brain.typing.timer) return;
        brain.typing.timer = setTimeout(flushTypingBurst, TYPE_BURST_MS);
      } catch (error) { warnOnce('brain-keydown', error); }
    }

    function flushTypingBurst() {
      brain.typing.timer = null;
      const keys = brain.typing.keys;
      brain.typing.keys = 0;
      if (keys < TYPE_BURST_MIN) return;
      if (!catActive() || currentState !== 'idle' || overlayState) return;
      const line = composeCatThought('typing', { keys: String(keys) });
      if (!line) return;
      setBubble(line, true);
      scheduleQuote();
    }

    // Copy / cut: a pure reaction. The clipboard itself is never read.
    function onBrainCopy() {
      try {
        if (!uiEnabled) return;
        brain.copyCount += 1;
        saveBrain();
        if (!catShown()) return;
        markInteraction();
        if (napping) { wakeFromNap(COPY_LINE); return; }
        // Only chatty while idle: a working-state bubble (answer picked, page
        // turning …) is information the user needs more than a joke.
        if (currentState !== 'idle' || overlayState) return;
        setBubble(COPY_LINE, true);
        scheduleQuote();
      } catch (error) { warnOnce('brain-copy', error); }
    }

    // Cursor: throttled sampling drives the pupils (eye tracking) and a fast
    // flick triggers the whisker-wiggle dizzy reaction.
    function onBrainMousemove(event) {
      try {
        if (!uiEnabled || !event || !wrapEl || wrapEl.style.display === 'none') return;
        const sample = brain.cursor;
        const now = Date.now();
        if (sample.at && now - sample.at < CURSOR_SAMPLE_MS) return;
        const x = Number(event.clientX) || 0;
        const y = Number(event.clientY) || 0;
        const dt = sample.at ? now - sample.at : 0;
        if (dt > 0) sample.speed = Math.hypot(x - sample.x, y - sample.y) / (dt / 1000);
        sample.x = x;
        sample.y = y;
        sample.at = now;
        sample.samples += 1;
        updateGaze(x);
        if (sample.speed < CURSOR_DIZZY_SPEED) return;
        if (now - sample.lastDizzyAt < DIZZY_COOLDOWN_MS) return;
        if (!catActive() || currentState !== 'idle' || overlayState) return;
        sample.lastDizzyAt = now;
        dizzyReaction();
      } catch (error) { warnOnce('brain-mousemove', error); }
    }

    // Pupils lean towards the cursor: ±1 sprite pixel, read by drawFace().
    function updateGaze(cursorX) {
      const rect = rectFor(catEl);
      if (!rect) return;
      const offset = cursorX - (rect.left + rect.width / 2);
      gazeLook = Math.abs(offset) < 26 ? 0 : (offset < 0 ? -1 : 1);
    }

    function dizzyReaction() {
      try {
        if (catEl) {
          catEl.classList.remove('qb-dizzy');
          void catEl.offsetWidth; // restart the wobble
          catEl.classList.add('qb-dizzy');
          if (dizzyTimer) clearTimeout(dizzyTimer);
          dizzyTimer = setTimeout(() => {
            dizzyTimer = null;
            if (catEl) catEl.classList.remove('qb-dizzy');
          }, DIZZY_HOLD_MS);
        }
      } catch (error) { warnOnce('brain-dizzy', error); }
      const line = composeCatThought('dizzy');
      if (!line) return;
      setBubble(line, true);
      scheduleQuote();
    }

    // Scroll velocity (px/s), measured between two passive scroll events.
    function onBrainScroll() {
      try {
        if (!uiEnabled) return;
        const now = Date.now();
        const y = Number(window.scrollY || window.pageYOffset || 0);
        const state = brain.scroll;
        if (!state.at) { state.y = y; state.at = now; return; }
        const dt = now - state.at;
        if (dt < 80) return;
        const speed = Math.abs(y - state.y) / (dt / 1000);
        state.y = y;
        state.at = now;
        if (speed < SCROLL_SPEED) return;
        if (now - state.lastAlarmAt < SCROLL_COOLDOWN_MS) return;
        if (!catActive() || currentState !== 'idle' || overlayState) return;
        state.lastAlarmAt = now;
        const line = composeCatThought('scroll');
        if (!line) return;
        setBubble(line, true);
        scheduleQuote();
      } catch (error) { warnOnce('brain-scroll', error); }
    }

    // Boot the brain: stats first, then the passive listeners. Nothing here can
    // click, type, navigate or cancel a page event.
    function startBrain() {
      if (brain.started) return;
      brain.started = true;
      refreshBrainContext();
      loadBrain();
      try {
        document.addEventListener('keydown', onBrainKeydown, { capture: true, passive: true });
        document.addEventListener('copy', onBrainCopy, { capture: true, passive: true });
        document.addEventListener('cut', onBrainCopy, { capture: true, passive: true });
        document.addEventListener('mousemove', onBrainMousemove, { passive: true });
        window.addEventListener('scroll', onBrainScroll, { passive: true });
        window.addEventListener('popstate', refreshBrainContext, { passive: true });
        window.addEventListener('hashchange', refreshBrainContext, { passive: true });
        // SPA route changes rewrite <title>: follow it so the commentary stays live.
        const titleNode = document.querySelector('title');
        if (titleNode && typeof MutationObserver === 'function') {
          new MutationObserver(() => refreshBrainContext())
            .observe(titleNode, { childList: true, characterData: true, subtree: true });
        }
      } catch (error) { warnOnce('brain-sensors', error); }
      // A bank write (harvest / learned answer) updates the count in the bubble.
      try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
          chrome.storage.onChanged.addListener((changes, areaName) => {
            try {
              if (areaName !== 'local' || !changes || !changes.answerkey_cache) return;
              const cache = changes.answerkey_cache.newValue;
              if (!cache || typeof cache !== 'object') return;
              brain.bankCount = Object.keys(cache).length;
              saveBrain();
            } catch (error) { warnOnce('brain-bank-change', error); }
          });
        }
      } catch (error) { /* storage events unavailable */ }
    }

    /* ── Catnap: "doing cat things" while idle ────────────────────────────── */

    function catShown() {
      return !!wrapEl && wrapEl.style.display !== 'none';
    }

    // Awake *and* actually on screen: roaming, chatter and naps only run then.
    function catOnScreen() {
      if (!booted || !catShown()) return false;
      let visible = true;
      try { visible = document.visibilityState === 'visible'; } catch (error) { /* assume */ }
      return visible;
    }

    function catActive() {
      return !napping && catOnScreen();
    }

    function markInteraction() {
      lastInteractionAt = Date.now();
    }

    // Polled every NAP_TICK_MS: 35 s of stillness on an idle cat → catnap.
    function napTick() {
      if (!booted || napping || drag || overlayState) return;
      if (currentState !== 'idle' || !catOnScreen()) return;
      if (Date.now() - lastInteractionAt < NAP_AFTER_MS) return;
      enterNap();
    }

    function enterNap() {
      if (napping || !wrapEl || !bubbleEl) return;
      napping = true;
      stopSquadHangout(); // the squad goes home before the catnap
      if (roamTimer) { clearTimeout(roamTimer); roamTimer = null; }
      if (quoteTimer) { clearTimeout(quoteTimer); quoteTimer = null; }
      wrapEl.classList.add(NAP_CLASS);
      setBubble(pickCatLine(assignedCatId, 'nap') || pickFreshLine(NAP_LINES), true);
      scheduleNapQuote();
      refreshSquadBadge();
    }

    // Sleepy mumbling every 11–15 s: gentle proof the cat is still there.
    function scheduleNapQuote() {
      if (napQuoteTimer) clearTimeout(napQuoteTimer);
      napQuoteTimer = setTimeout(() => {
        napQuoteTimer = null;
        if (!napping) return;
        if (catOnScreen()) setBubble(pickCatLine(assignedCatId, 'nap') || pickFreshLine(NAP_LINES), true);
        scheduleNapQuote();
      }, NAP_QUOTE_MIN_MS + Math.random() * NAP_QUOTE_SPREAD_MS);
    }

    // Any click / quiz start / harvest wakes him instantly. `line` is optional so
    // a state change can wake him silently while its own bubble speaks.
    function wakeFromNap(line) {
      if (!napping) {
        if (line) setBubble(line, true);
        return;
      }
      napping = false;
      lastInteractionAt = Date.now();
      if (napQuoteTimer) { clearTimeout(napQuoteTimer); napQuoteTimer = null; }
      if (wrapEl) wrapEl.classList.remove(NAP_CLASS);
      if (line) setBubble(line, true);
      else if (bubbleEl) bubbleEl.classList.remove('qb-bubble-visible');
      if (currentState === 'idle' && catShown()) scheduleQuote();
      refreshSquadBadge();
    }

    /* ── Squad wiring: storage, visibility, heartbeat, first claim ─────────── */

    function watchPresenceChanges() {
      if (squadWatched) return;
      try {
        if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.onChanged) return;
        chrome.storage.onChanged.addListener((changes, areaName) => {
          try {
            if (areaName !== 'local' || !changes || !changes[SQUAD_KEY]) return;
            const previousOwner = squad.mochi.tabId;
            const wasBusy = otherTabIsBusy();
            squad = normalizeSquad(changes[SQUAD_KEY].newValue);
            squadReady = true;
            applyPresence(); // hide + pill, or reveal the cat assigned to this tab
            syncHangoutCats();
            if (otherTabIsBusy()) return;
            if (wasBusy) maybeFollowIdle(previousOwner); // idle hand-off → follow it
          } catch (error) {
            warnOnce('squad-change', error);
          }
        });
        squadWatched = true;
      } catch (error) {
        warnOnce('squad-watch', error);
      }
    }

    // While this tab works it re-stamps its slot so the other tabs keep honouring
    // the claim and a crashed tab frees its cat after PRESENCE_STALE_MS. Idle
    // slots are deliberately left to go stale: focus decides who inherits Mochi.
    function startPresenceHeartbeat() {
      if (squadHeartbeat) return;
      squadHeartbeat = setInterval(() => {
        try {
          if (!squadEnabled || myTabId == null) return;
          const id = myCatId && CATS[myCatId] ? myCatId : null;
          if (!id || !squad[id] || squad[id].tabId !== myTabId) return;
          if (myTask === 'idle') return;
          const next = { ...squad };
          next[id] = { ...next[id], task: myTask || next[id].task, url: pageUrl(), workLockUntil: _activeWorkUntil, updatedAt: Date.now() };
          squad = next;
          writeSquad(next);
        } catch (error) {
          warnOnce('squad-heartbeat', error);
        }
      }, PRESENCE_HEARTBEAT_MS);
    }

    function onVisibilityChange() {
      try {
        if (document.visibilityState === 'visible') {
          markInteraction();
          wakeFromNap(null); // coming back to the tab gets him up
          recordTabHop();    // local brain stat: how many tabs today
          if (!uiEnabled) return;
          // Switching tabs must never steal the cat while a quiz run or a harvest
          // is still going on elsewhere — not even during its idle gap between two
          // questions. That tab keeps #qb-mascot-wrap; this one stays hidden and
          // shows the busy pill until the run/harvest finishes.
          if (otherTabIsBusy()) { applyPresence(); return; }
          claimIdle(true);   // Rule B: the idle cat follows the active tab
        }
        applyPresence();
      } catch (error) {
        warnOnce('visibility', error);
      }
    }

    // Same idea for a second window: clicking into it focuses the document
    // without changing visibility, and the cat should hop over with the user —
    // unless another tab is still working or holds a live work lock.
    function onTabFocus() {
      try {
        markInteraction();
        if (!uiEnabled) return;
        if (otherTabIsBusy()) { applyPresence(); return; }
        claimIdle(true);
        applyPresence();
      } catch (error) {
        warnOnce('focus', error);
      }
    }

    // Boot: learn this tab's id, read the shared squad, then show/hide its cat.
    // If the worker never answers we degrade to a one-cat-per-tab mascot instead
    // of hiding the cats forever.
    function initPresence() {
      applyPresence(); // hidden while the assignment is still unknown
      watchPresenceChanges();
      setTimeout(() => {
        if (squadReady) return;
        squadReady = true;
        applyPresence();
      }, PRESENCE_INIT_TIMEOUT_MS);
      requestTabId((tabId) => {
        myTabId = tabId;
        squadEnabled = typeof tabId === 'number';
        readSquad((stored) => {
          squad = normalizeSquad(stored);
          squadReady = true;
          startPresenceHeartbeat();
          if (!squadEnabled) { applyPresence(); return; }
          readBotEnabled((enabled) => {
            if (enabled && location.pathname.includes('/mod/quiz/attempt.php')) {
              _activeWorkUntil = Date.now() + 25000;
              const ownedCat = SQUAD_SLOTS.find((id) => squad[id].tabId === myTabId);
              if (ownedCat) {
                myCatId = ownedCat;
                myTask = 'exam';
                updateSquad((next) => {
                  const slot = next[ownedCat];
                  if (slot.tabId !== myTabId) return;
                  next[ownedCat] = {
                    ...slot,
                    task: 'exam',
                    url: pageUrl(),
                    workLockUntil: _activeWorkUntil,
                    updatedAt: Date.now(),
                  };
                });
                applyPresence();
                return;
              }
              claimSquad('exam');
              return;
            }
            // Boot may land mid-review (score page): honour that working state
            // instead of quietly claiming an idle cat. Otherwise appear quietly,
            // no greeting on a plain page load.
            if (BUSY_LABELS[currentState]) claimBusy(currentState);
            else claimIdle(false);
            applyPresence();
          });
        });
      });
    }

    /* ── DOM: draggable cat + wrapped speech bubble ───────────────────────── */

    function mount() {
      if (wrapEl && wrapEl.isConnected) return;
      injectStyles();

      wrapEl = document.createElement('div');
      wrapEl.id = WRAP_ID;

      bubbleEl = document.createElement('div');
      bubbleEl.id = BUBBLE_ID;

      catEl = document.createElement('canvas');
      catEl.className = IMG_CLASS;
      catEl.width = CANVAS;
      catEl.height = CANVAS;
      catEl.setAttribute('role', 'img');
      catEl.setAttribute('aria-label', 'Quiz bot pixel cat Mochi — Orange Tabby, Hyper Speedrunner');
      catEl.dataset.state = 'idle';
      catEl.dataset.cat = 'mochi';
      startPixelEngine();
      applyAsset('idle');
      catEl.addEventListener('click', onMascotClick);
      catEl.addEventListener('mousedown', onDragStart);
      catEl.addEventListener('dblclick', onMascotDoubleClick);
      catEl.addEventListener('mouseenter', onMascotHover, { passive: true });

      // Tiny hover badge: "Squad (1/3)" → click summons / dismisses the squad.
      squadBadgeEl = document.createElement('div');
      squadBadgeEl.className = SQUAD_BADGE_CLASS + ' ' + SQUAD_BADGE_HIDDEN;
      squadBadgeEl.setAttribute('role', 'button');
      squadBadgeEl.setAttribute('aria-label', 'Summon the cat squad');
      squadBadgeEl.textContent = 'Squad (1/3)';
      squadBadgeEl.addEventListener('click', onSquadBadgeClick);

      wrapEl.appendChild(bubbleEl);
      wrapEl.appendChild(catEl);
      wrapEl.appendChild(squadBadgeEl);

      // Paint the very first frame already parked bottom-right (no animation).
      const start = safeSpot(window.innerWidth - SIZE - 20, window.innerHeight - SIZE - 20);
      pos = { left: start.left, top: start.top };
      wrapEl.style.left = Math.round(start.left) + 'px';
      wrapEl.style.top = Math.round(start.top) + 'px';
      // Hidden until the shared CAT_SQUAD map says this tab owns a cat — that is
      // what keeps exactly one cat per working tab across all tabs.
      wrapEl.style.display = 'none';

      (document.body || document.documentElement).appendChild(wrapEl);
      alignBubble();

      // Status pill shown on the tabs that do NOT own one of the working cats.
      if (!pillEl || !pillEl.isConnected) {
        pillEl = document.createElement('div');
        pillEl.id = PILL_ID;
        pillEl.textContent = PILL_TEXT;
        (document.body || document.documentElement).appendChild(pillEl);
      }

      refreshSquadBadge();

      document.addEventListener('mousemove', onDragMove, { passive: true });
      document.addEventListener('mouseup', onDragEnd, true);
      window.addEventListener('resize', onWindowResize, { passive: true });
    }

    // Single click: a playful petting reaction. The same click handler swallows
    // the second click of a double click (PET_COOLDOWN_MS) so the cheer takes over.
    function onMascotClick() {
      if (Date.now() < suppressClickUntil) return;
      // Clicking a sleeping cat wakes him up instead of petting him.
      if (napping) { markInteraction(); wakeFromNap(WAKE_LINE); return; }
      // Triple-click (or the hover badge) toggles the Summon Squad hangout.
      if (noteSquadTap()) return;
      const now = Date.now();
      if (now - lastPetAt < PET_COOLDOWN_MS) return;
      lastPetAt = now;
      markInteraction();
      recordPet(); // local brain stat: how many pets so far
      try {
        if (currentState === 'idle') {
          const line = composeCatThought('pet') || pickCatLine(assignedCatId, 'pet') || pickFreshLine(PET_LINES);
          if (line) setBubble(line, true);
          scheduleQuote();
          return;
        }
        if (currentState === 'thinking') { setBubble(pickCatLine(assignedCatId, 'thinking') || pickFreshLine(THINKING_LINES), true); return; }
        if (currentState === 'answering') { setBubble(SPEECH.answering, true); return; }
        if (currentState === 'clicking') { setBubble(pickCatLine(assignedCatId, 'clicking') || pickFreshLine(CLICKING_LINES), true); return; }
        if (currentState === 'nextpage') { setBubble(SPEECH.nextpage, true); return; }
        if (currentState === 'harvesting') { setBubble(SPEECH.harvesting, true); return; }
        if (currentState === 'typing') { setBubble(pickCatLine(assignedCatId, 'typing') || pickFreshLine(TYPING_LINES), true); return; }
        if (lastScoreLine) { setBubble(lastScoreLine, true); return; }
        setBubble(SPEECH.review, true);
      } catch (error) {
        warnOnce('click', error);
      }
    }

    // Double click: 1.8 s of the answering cheer, then straight back to whatever
    // the state machine wants (idle / review / an action pose).
    function onMascotDoubleClick() {
      if (Date.now() < suppressClickUntil) return;
      try {
        markInteraction();
        wakeFromNap(null); // a cheer never happens from inside a catnap
        // Double-click chat: the local brain composes a fresh hype line, then the
        // active cat's own hype voice.
        const line = composeCatThought('hype') || pickCatLine(assignedCatId, 'hype') || pickFreshLine(HYPE_LINES);
        startOverlay('answering', CHEER_MS, line);
      } catch (error) {
        warnOnce('double-click', error);
      }
    }

    // Hover: now and then a subtle hint — at most once per HOVER_COOLDOWN_MS and
    // only while idling, so it never talks over the bot's action bubbles.
    function onMascotHover() {
      try {
        if (!booted || drag || overlayState) return;
        markInteraction();
        if (napping) return; // never talk over a catnap
        const now = Date.now();
        if (now - lastHoverAt < HOVER_COOLDOWN_MS) return;
        lastHoverAt = now;
        if (currentState !== 'idle') return;
        if (Math.random() > HOVER_CHANCE) return;
        const line = pickFreshLine(HOVER_LINES);
        if (!line) return;
        setBubble(line, true);
        scheduleQuote();
      } catch (error) {
        warnOnce('hover', error);
      }
    }

    /* ── Dragging (the cat only — never the page, never a Moodle button) ──── */

    function onDragStart(event) {
      if (!wrapEl || event.button !== 0) return;
      markInteraction();
      const rect = rectFor(wrapEl) || { left: pos.left, top: pos.top };
      drag = {
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top,
        startX: event.clientX,
        startY: event.clientY,
        moved: false,
        // A plain click must still be able to show the "Yawn~" wake line, so the
        // catnap only ends once the cat is actually being carried around.
        napAtStart: napping,
      };
      wrapEl.classList.add('qb-dragging');
    }

    function onDragMove(event) {
      if (!drag || !wrapEl) return;
      const travelled = Math.abs(event.clientX - drag.startX) + Math.abs(event.clientY - drag.startY);
      if (!drag.moved && travelled < 4) return;
      drag.moved = true;
      if (drag.napAtStart) wakeFromNap(null); // carrying him around wakes him
      const maxLeft = maxLeftFor();
      const maxTop = Math.max(EDGE, window.innerHeight - SIZE - EDGE);
      const left = clamp(event.clientX - drag.offsetX, EDGE, maxLeft);
      const top = clamp(event.clientY - drag.offsetY, EDGE, maxTop);
      pos = { left, top };
      wrapEl.style.left = Math.round(left) + 'px';
      wrapEl.style.top = Math.round(top) + 'px';
      alignBubble();
    }

    function onDragEnd() {
      if (!drag) return;
      const moved = drag.moved;
      drag = null;
      if (!wrapEl) return;
      // Re-enable the glide transition only after the release frame, otherwise
      // the cat would animate back from where the drag started.
      window.requestAnimationFrame(() => {
        try { wrapEl.classList.remove('qb-dragging'); } catch (error) { /* ignore */ }
      });
      if (moved) {
        suppressClickUntil = Date.now() + 250;
        pauseRoamUntil = Date.now() + ROAM_PAUSE_AFTER_DRAG; // 15 s calm-down
      }
    }

    function onWindowResize() {
      try { moveTo(pos.left, pos.top); } catch (error) { warnOnce('resize', error); }
    }

    /* ── Idle chatter + review score (read-only) ──────────────────────────── */

    function scheduleQuote() {
      if (!catActive()) return; // hidden tab or catnap: chatter resumes on reveal
      if (quoteTimer) clearTimeout(quoteTimer);
      quoteTimer = setTimeout(() => {
        quoteTimer = null;
        showRandomQuote();
      }, QUOTE_MIN_MS + Math.random() * QUOTE_SPREAD_MS);
    }

    function showRandomQuote() {
      if (!bubbleEl || currentState !== 'idle' || !catActive()) return;
      if (overlayState) { scheduleQuote(); return; } // an overlay owns the bubble
      const text = randomQuote();
      if (text) setBubble(text, true);
      scheduleQuote();
    }

    function countRight() {
      try {
        const marked = document.querySelectorAll('.que.correct').length;
        if (marked) return marked;
        return document.querySelectorAll('.qnbutton.correct').length;
      } catch (error) {
        return 0;
      }
    }

    /* ── State machine ────────────────────────────────────────────────────── */

    function setState(next, options) {
      const state = isKnownState(next) ? next : 'idle';
      if (!catEl || !bubbleEl) return;
      const opts = options || {};
      const changed = currentState !== state;
      currentState = state;
      if (changed) syncPresenceForState(state);

      if (changed) {
        if (thinkTimer) { clearTimeout(thinkTimer); thinkTimer = null; }
        if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
        if (reviewTimer) { clearTimeout(reviewTimer); reviewTimer = null; }
        if (harvestTimer) { clearTimeout(harvestTimer); harvestTimer = null; }
        if (quoteTimer) { clearTimeout(quoteTimer); quoteTimer = null; }
        if (roamTimer) { clearTimeout(roamTimer); roamTimer = null; }
        // A queued action only survives the "AHA!!" reaction it was queued for.
        if (state !== 'answering') pendingAction = null;

        if (catEl.dataset.state !== state) {
          applyAsset(state);
        }
        catEl.classList.remove('qb-hop', 'qb-review');
        if (state === 'answering' || state === 'nextpage' || state === 'harvesting' || ACTION_STATES.includes(state)) {
          void catEl.offsetWidth; // restart the hop animation
          catEl.classList.add('qb-hop');
        } else if (state === 'review') {
          catEl.classList.add('qb-review');
          lastLearnedShown = -1;
          reviewStartedAt = Date.now();
        }
      } else {
        // Unchanged state: only re-show an idle quote, or an explicit restart.
        if (state === 'idle' && opts.quote) { scheduleRoam(); showRandomQuote(); return; }
        if (!opts.restart) return;
      }

      if (state === 'idle') {
        scheduleRoam();
        if (changed || opts.quote) showRandomQuote();
        return;
      }

      if (state === 'thinking') {
        setBubble(pickCatLine(assignedCatId, 'thinking') || pickFreshLine(READING_LINES), true);
        if (thinkTimer) clearTimeout(thinkTimer);
        thinkTimer = setTimeout(() => {
          thinkTimer = null;
          if (currentState === 'thinking') {
            setBubble(pickCatLine(assignedCatId, 'thinking') || pickFreshLine(THINKING_LINES), true);
          }
        }, READING_HOLD_MS);
        return;
      }

      if (state === 'answering') {
        // Brief "AHA!! Found it! ✨" reaction, then the matching action animation.
        setBubble(SPEECH.answering, true);
        if (holdTimer) clearTimeout(holdTimer);
        holdTimer = setTimeout(() => {
          holdTimer = null;
          if (currentState !== 'answering') return;
          if (pendingAction) { startAction(); return; }
          setState('idle');
        }, ANSWER_REACT_MS);
        return;
      }

      if (ACTION_STATES.includes(state)) {
        // clicking: ~1.1 s of "Slapping that answer!! 🐾💥" on the exact dot, then
        // the "Next page!! 🐾➡️" hop. typing: 2.5 s of "Typing the answer... ⌨️🐾".
        setBubble(pickCatLine(assignedCatId, state === 'typing' ? 'typing' : 'clicking')
          || pickFreshLine(state === 'typing' ? TYPING_LINES : CLICKING_LINES), true);
        if (holdTimer) clearTimeout(holdTimer);
        holdTimer = setTimeout(() => {
          holdTimer = null;
          if (currentState !== state) return;
          if (state === 'clicking') { hopToNextPage(); return; }
          setState('idle');
        }, state === 'clicking' ? SLAP_HOLD_MS : ACTION_HOLD_MS);
        return;
      }

      if (state === 'harvesting') {
        // Passive digging: content.js owns the harvest, the cat only narrates it.
        // Every harvest line re-arms the safety timer; the closing line (or a
        // 2 s silence) sends the cat back to idle.
        setBubble(pickCatLine(assignedCatId, 'harvest') || SPEECH.harvesting, true);
        scheduleHarvestIdle(HARVEST_STALE_MS);
        return;
      }

      if (state === 'nextpage') {
        // Visual-only hop beside the Next page button — nothing is ever clicked.
        setBubble(SPEECH.nextpage, true);
        if (holdTimer) clearTimeout(holdTimer);
        holdTimer = setTimeout(() => {
          holdTimer = null;
          if (currentState === 'nextpage') setState('idle');
        }, NEXT_HOP_MS);
        return;
      }

      // review — the visual scanner owns the bubble while it is running.
      if (reviewScan.active) { setBubble(reviewScanBubble(), true); return; }
      setBubble(pickCatLine(assignedCatId, 'review') || SPEECH.review, true);
      if (reviewTimer) clearTimeout(reviewTimer);
      reviewTimer = setTimeout(() => {
        reviewTimer = null;
        if (currentState !== 'review') return;
        if (reviewScan.active) return; // scan counts own the bubble
        if (announceReviewScore()) return; // e.g. "SHEESH!! High score!! ..."
        if (scoreAnnounced) return; // celebration already shown by an earlier pass
        setBubble(SPEECH.learned(countRight()), true);
      }, REVIEW_COUNT_DELAY_MS);
    }

    function refreshReviewCount() {
      if (currentState !== 'review') return;
      if (reviewScan.active) return; // the scan bubble already shows the count
      if (Date.now() - reviewStartedAt < REVIEW_COUNT_DELAY_MS) return;
      if (scoreAnnounced) return; // the score celebration already owns the bubble
      const count = countRight();
      if (count === lastLearnedShown) return;
      lastLearnedShown = count;
      setBubble(SPEECH.learned(count), true);
    }

    /* ── Shimeji roaming (idle only) ──────────────────────────────────────── */

    function scheduleRoam() {
      if (roamTimer) clearTimeout(roamTimer);
      roamTimer = null;
      if (currentState !== 'idle' || !catActive()) return;
      roamTimer = setTimeout(() => {
        roamTimer = null;
        roamOnce();
      }, ROAM_MIN_MS + Math.random() * ROAM_SPREAD_MS);
    }

    function roamOnce() {
      if (currentState !== 'idle' || drag) { scheduleRoam(); return; }
      if (!catActive()) return; // hidden or napping: roaming resumes on reveal
      if (Date.now() < pauseRoamUntil) { scheduleRoam(); return; } // 15 s after a drag
      const target = pickRoamTarget();
      moveTo(target.left, target.top);
      scheduleRoam();
    }

    function pickRoamTarget() {
      const maxLeft = maxLeftFor();
      const maxTop = Math.max(EDGE, window.innerHeight - SIZE - EDGE);
      const roll = Math.random();
      let next;
      if (roll < 0.55) {
        // bottom edge stroll
        next = { left: EDGE + Math.random() * (maxLeft - EDGE), top: maxTop };
      } else if (roll < 0.8) {
        // left side climb
        next = {
          left: EDGE + Math.random() * Math.min(120, maxLeft - EDGE),
          top: maxTop * (0.25 + Math.random() * 0.75),
        };
      } else {
        // right side (safeSpot lifts the cat above the HUD box when needed)
        next = { left: maxLeft, top: maxTop * (0.25 + Math.random() * 0.75) };
      }
      // Avoid micro-movements: if the target is on top of the cat, cross over.
      if (Math.abs(next.left - pos.left) < 40 && Math.abs(next.top - pos.top) < 40) {
        const farLeft = pos.left > (maxLeft + EDGE) / 2;
        next = { left: farLeft ? EDGE + Math.random() * 80 : maxLeft - Math.random() * 80, top: maxTop };
      }
      return next;
    }

    /* ── Moodle DOM helpers (strictly read-only) ──────────────────────────── */

    const ANSWERED_RE = /\b(correct|incorrect|partiallycorrect|answersaved|complete|finished|gradedright|gradedwrong)\b/;

    function questionTextOf(container) {
      if (!container) return '';
      const node = container.querySelector('.qtext, .questiontext, .prompt, legend');
      return norm(node ? (node.innerText || node.textContent) : (container.innerText || '')).slice(0, 160);
    }

    function questionKeyOf(container) {
      if (!container) return '';
      const number = container.querySelector('.qno, .questionnumber');
      return norm(number ? number.textContent : '') + '|' + questionTextOf(container);
    }

    function isAnswered(container) {
      if (!container) return true;
      if (ANSWERED_RE.test(String(container.className || '').toLowerCase())) return true;
      try {
        return !!container.querySelector('.rightanswer, .outcome .correct, .outcome .incorrect');
      } catch (error) {
        return true;
      }
    }

    function onScreen(rect) {
      if (!rect) return false;
      return rect.bottom > 8
        && rect.top < window.innerHeight - 8
        && rect.right > 8
        && rect.left < window.innerWidth - 8;
    }

    function activeQuestion() {
      try {
        const list = document.querySelectorAll('.que');
        for (let i = 0; i < list.length; i += 1) {
          const candidate = list[i];
          if (isAnswered(candidate)) continue;
          if (!onScreen(rectFor(candidate))) continue;
          return candidate;
        }
      } catch (error) {
        warnOnce('active-question', error);
      }
      return null;
    }

    // Park immediately to the right of a box, or to its left when there is no
    // room, always through the viewport/HUD clamp.
    function beside(rect) {
      if (!rect || !onScreen(rect)) return null;
      const centreY = rect.top + rect.height / 2 - SIZE / 2;
      let left = rect.right + GAP;
      if (left > maxLeftFor()) left = rect.left - SIZE - GAP;
      return safeSpot(left, centreY);
    }

    // Park exactly beside a control: just right of its right edge (or left of it
    // when the right side has no room) and 40 px above its top edge — always
    // through the viewport/HUD clamp, so the cat can never leave the window.
    function besideExact(rect) {
      if (!rect) return null;
      let left = rect.right + GAP;
      if (left > maxLeftFor()) left = rect.left - SIZE - GAP;
      return safeSpot(left, rect.top - TARGET_LIFT);
    }

    // The precise radio dot / checkbox the bot just ticked: the control captured
    // from the page event while it is still fresh and checked, otherwise the
    // first checked radio/checkbox inside the open question.
    function slapInput() {
      try {
        const hint = lastControl;
        if (hint && hint.element && hint.kind === 'clicking' && Date.now() - hint.at < CONTROL_HINT_MS) {
          const element = hint.element;
          const tag = String(element.tagName || '').toLowerCase();
          const type = String(element.type || '').toLowerCase();
          if (tag === 'input' && (type === 'radio' || type === 'checkbox') && element.checked) return element;
        }
        return document.querySelector('.que input[type="radio"]:checked, .que input[type="checkbox"]:checked');
      } catch (error) { /* ignore */ }
      return null;
    }

    // Where the slap happens: the input's own rect first (that is the dot the
    // user asked for), then its row/label, then whatever the DOM says was chosen.
    function slapSpot(fallbackAnchor) {
      const input = slapInput();
      const inputRect = rectFor(input);
      if (inputRect && onScreen(inputRect)) return besideExact(inputRect);
      const rowRect = rectFor(fallbackAnchor) || rectFor(anchorFor(input)) || rectFor(bestAnswerAnchor());
      if (rowRect) return besideExact(rowRect);
      return beside(rowRect);
    }

    /* ── Moodle "Next page" navigation button (read-only) ─────────────────── */

    // Ordered candidates. A real forward control (name="next" / Moodle's own nav
    // id or class) always wins; the generic `.submitbtns` submit is only a last
    // resort, because that container also holds the "Previous page" button and
    // it comes FIRST in document order — which is exactly how the cat used to
    // end up guarding the left-hand Previous button.
    const NEXT_BUTTON_SELECTORS = [
      'input[name="next"]',
      'button[name="next"]',
      '#mod_quiz-next-nav',
      'input.mod_quiz-next-nav',
      'button.mod_quiz-next-nav',
      'a.mod_quiz-next-nav',
      '.submitbtns input[type="submit"]:not([name="previous"]):not([name="prev"])',
      '.submitbtns button[type="submit"]:not([name="previous"]):not([name="prev"])',
      '.submitbtns a.mod_quiz-next-nav'
    ];
    const NEXT_VALUE_RE = /next|finish/i;          // "Next page", "Finish attempt ..."
    const PREVIOUS_RE = /previous|prev\b|back\b/i; // never a forward target

    function navTextOf(node) {
      return {
        name: norm(node.getAttribute('name') || node.name || '').toLowerCase(),
        id: norm(node.id || '').toLowerCase(),
        cls: norm(node.getAttribute('class') || node.className || '').toLowerCase(),
        value: norm(node.value || '').toLowerCase(),
        text: norm(node.textContent || '').toLowerCase(),
        type: String(node.type || '').toLowerCase()
      };
    }

    // True only for the forward/next control: name="next", Moodle's nav id/class,
    // or a footer submit whose label says next/finish. "Previous page", "Back"
    // and hidden/reset inputs are always rejected.
    function isForwardNav(node) {
      try {
        if (!node || node.nodeType !== 1) return false;
        const meta = navTextOf(node);
        if (meta.type === 'hidden' || meta.type === 'reset') return false;
        if (meta.name.indexOf('previous') >= 0 || meta.name === 'prev') return false;
        if (meta.id.indexOf('previous') >= 0 || meta.id === 'prev') return false;
        const label = [meta.name, meta.id, meta.value, meta.text].filter(Boolean).join(' ');
        if (PREVIOUS_RE.test(label)) return false;
        if (meta.name === 'next') return true;
        if (meta.id === 'mod_quiz-next-nav') return true;
        if (/\bmod_quiz-next-nav\b/.test(meta.cls)) return true;
        return NEXT_VALUE_RE.test(meta.value + ' ' + meta.text);
      } catch (error) {
        return false;
      }
    }

    // The first *visible* forward button in the page's nav footer, if any.
    function findNextButton() {
      try {
        const seen = new Set();
        for (let s = 0; s < NEXT_BUTTON_SELECTORS.length; s += 1) {
          const list = document.querySelectorAll(NEXT_BUTTON_SELECTORS[s]);
          for (let i = 0; i < list.length; i += 1) {
            const node = list[i];
            if (seen.has(node)) continue;
            seen.add(node);
            if (!isForwardNav(node)) continue;
            const style = window.getComputedStyle(node);
            if (!style || style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) continue;
            const rect = rectFor(node);
            if (!rect || !onScreen(rect)) continue;
            return { element: node, rect: rect };
          }
        }
      } catch (error) {
        warnOnce('next-button', error);
      }
      return null;
    }

    /* ── Triggers (all read-only) ─────────────────────────────────────────── */

    function botRunning() {
      try {
        const host = document.getElementById(HUD_HOST_ID);
        if (!host) return false;
        if (host.dataset && host.dataset.running === '1') return true;
        return /\bactive\b/.test(String(host.className || ''));
      } catch (error) {
        return false;
      }
    }

    // The visible row of an answer control (never the invisible input itself).
    function anchorFor(control) {
      if (!control || control.nodeType !== 1) return null;
      try {
        const tag = String(control.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'select' || tag === 'textarea') {
          const label = control.closest && control.closest('label');
          if (label) return label;
          const row = control.closest && control.closest('.answer > div, .answer, .fitem, .ablock, .r0, .r1');
          if (row) return row;
        }
      } catch (error) { /* ignore */ }
      return control;
    }

    function bestAnswerAnchor() {
      try {
        const checked = document.querySelector('.que input[type="radio"]:checked, .que input[type="checkbox"]:checked');
        if (checked) return anchorFor(checked);
        const typed = Array.prototype.find.call(
          document.querySelectorAll('.que input[type="text"], .que input[type="number"], .que textarea'),
          (input) => String(input.value || '').trim()
        );
        if (typed) return anchorFor(typed);
        const chosen = Array.prototype.find.call(
          document.querySelectorAll('.que select'),
          (select) => select.value && select.value !== '0'
        );
        if (chosen) return anchorFor(chosen);
        const container = activeQuestion();
        if (container) return container.querySelector('.qtext, .questiontext') || container;
      } catch (error) { /* ignore */ }
      return null;
    }

    // 'typing' for a fill-in-the-blank / short-answer box, 'clicking' for a
    // radio / checkbox / dropdown — '' when the node is not an answer control.
    function kindForControl(node) {
      if (!node || node.nodeType !== 1) return '';
      const tag = String(node.tagName || '').toLowerCase();
      if (tag === 'textarea') return 'typing';
      if (tag === 'select') return 'clicking';
      if (tag !== 'input') return '';
      const type = String(node.type || 'text').toLowerCase();
      if (type === 'radio' || type === 'checkbox') return 'clicking';
      if (type === 'text' || type === 'number' || type === 'search' || type === 'email' || type === 'url' || type === 'tel') {
        return 'typing';
      }
      return '';
    }

    // Read-only DOM guess (used when the HUD line itself does not say which
    // move happened): a checked radio/checkbox or a chosen dropdown is a click,
    // otherwise a filled text box is typing.
    function detectActionKind() {
      try {
        const checked = document.querySelector('.que input[type="radio"]:checked, .que input[type="checkbox"]:checked');
        if (checked) return 'clicking';
        const chosen = Array.prototype.find.call(
          document.querySelectorAll('.que select'),
          (select) => select.value && select.value !== '0'
        );
        if (chosen) return 'clicking';
        const typed = Array.prototype.find.call(
          document.querySelectorAll('.que input[type="text"], .que input[type="number"], .que textarea'),
          (input) => String(input.value || '').trim()
        );
        if (typed) return 'typing';
      } catch (error) { /* ignore */ }
      return 'clicking';
    }

    // Where to hop for an action: the control that just fired (most precise),
    // then the live DOM of the current question.
    function actionAnchor(kind) {
      try {
        if (lastControl && lastControl.kind === kind && Date.now() - lastControl.at < CONTROL_HINT_MS) {
          const anchor = anchorFor(lastControl.element);
          if (rectFor(anchor)) return anchor;
        }
        if (kind === 'typing') {
          const typed = Array.prototype.find.call(
            document.querySelectorAll('.que input[type="text"], .que input[type="number"], .que textarea'),
            (input) => String(input.value || '').trim()
          );
          if (typed) return anchorFor(typed);
        } else {
          const checked = document.querySelector('.que input[type="radio"]:checked, .que input[type="checkbox"]:checked');
          if (checked) return anchorFor(checked);
          const chosen = Array.prototype.find.call(
            document.querySelectorAll('.que select'),
            (select) => select.value && select.value !== '0'
          );
          if (chosen) return anchorFor(chosen);
        }
        const container = activeQuestion();
        if (container) return container.querySelector('.qtext, .questiontext') || container;
      } catch (error) { /* ignore */ }
      return bestAnswerAnchor();
    }

    function enterThinking(container) {
      setState('thinking', { restart: true });
      const anchor = container ? (container.querySelector('.qtext, .questiontext') || container) : null;
      const spot = beside(rectFor(anchor));
      if (spot) moveTo(spot.left, spot.top);
    }

    function noteQuestion() {
      try {
        if (!wrapEl || isReviewPage()) return;
        const container = activeQuestion();
        if (!container) return;
        const key = questionKeyOf(container);
        if (!key || answeredKeys.has(key)) return;
        if (key === lastQuestionKey && Date.now() - lastQuestionAt < 4000) return;
        lastQuestionKey = key;
        lastQuestionAt = Date.now();
        enterThinking(container);
      } catch (error) {
        warnOnce('note-question', error);
      }
    }

    // Answer detected → brief "AHA!! Found it! ✨" hop, then the matching action
    // pose (`clicking` or `typing`) parked beside the control that was answered.
    function enterAnswering(anchor, kind) {
      const now = Date.now();
      if (now - lastAnswerAt < ANSWER_THROTTLE_MS) return; // DOM + log double-fire
      lastAnswerAt = now;

      const key = questionKeyOf(activeQuestion());
      if (key) answeredKeys.add(key);

      let resolvedKind = (kind === 'typing' || kind === 'clicking') ? kind : '';
      if (!resolvedKind) {
        const hint = lastControl && now - lastControl.at < CONTROL_HINT_MS ? lastControl : null;
        resolvedKind = hint ? hint.kind : detectActionKind();
      }
      const hintForKind = (lastControl && lastControl.kind === resolvedKind && now - lastControl.at < CONTROL_HINT_MS)
        ? lastControl
        : null;
      const anchorEl = anchor || (hintForKind ? anchorFor(hintForKind.element) : null) || actionAnchor(resolvedKind);

      pendingAction = { kind: resolvedKind, anchor: anchorEl || null };
      setState('answering');
      const spot = beside(rectFor(anchorEl));
      if (spot) moveTo(spot.left, spot.top);
    }

    // Second half of an answer: play the clicking pose right on the exact radio
    // dot / checkbox the bot ticked (then hop beside the Next page button), or
    // the typing pose beside the text box it filled in.
    function startAction() {
      const action = pendingAction || {};
      pendingAction = null;
      const kind = action.kind === 'typing' ? 'typing' : 'clicking';
      setState(kind, { restart: true });
      if (kind === 'typing') {
        const anchor = action.anchor || actionAnchor(kind);
        const spot = beside(rectFor(anchor)) || beside(rectFor(bestAnswerAnchor()));
        if (spot) moveTo(spot.left, spot.top);
        return;
      }
      // clicking: land on the *exact* dot / checkbox, not just its row.
      const spot = slapSpot(action.anchor || actionAnchor(kind));
      if (spot) moveTo(spot.left, spot.top);
    }

    // Visual-only hop: park the cat directly left of the visible Next page button
    // (left − 140 px, top − 45 px, clamped into the viewport) and face it right
    // so the paw slaps the blue button itself. The button is never clicked or
    // submitted — this is animation only, exactly like the rest of the mascot.
    function hopToNextPage() {
      const next = findNextButton();
      if (!next) { setState('idle'); return; }
      setState('nextpage', { restart: true });
      const spot = safeSpot(next.rect.left - NEXT_OFFSET_X, next.rect.top - NEXT_OFFSET_Y);
      if (spot) {
        moveTo(spot.left, spot.top);
        faceRight();
      }
    }

    function enterReview() {
      const alreadyReview = currentState === 'review';
      setState('review');
      // While the visual scanner is running it owns the cat's position.
      if (reviewScan.active) return;
      if (alreadyReview && reviewParked) return;
      const summary = document.querySelector('.quizreviewsummary, #quizreviewsummary, .reviewsummary, .quizreview, .totalgrade, .grade');
      const spot = beside(rectFor(summary));
      if (spot) {
        moveTo(spot.left, spot.top);
        reviewParked = true;
      }
    }

    /* ── Visual review scanner (glasses + glide + live counts) ────────────── */

    // The bubble line the user sees while content.js scans: the live scan count
    // followed by the GitHub sync badge ("Scanned! Saved 12 answers (4 new) •
    // GitHub ✓").
    function reviewScanBubble() {
      if (reviewScan.right == null) return 'Checking every answer... 👓';
      let text = 'Scanned! Saved ' + reviewScan.right + ' answers';
      if (reviewScan.newCount != null) text += ' (' + reviewScan.newCount + ' new)';
      if (reviewScan.github) text += ' • ' + reviewScan.github;
      return text;
    }

    // Every visible .que block, top to bottom: the scanner walks this list.
    function reviewScanBlocks() {
      try {
        return Array.from(document.querySelectorAll('.que'))
          .filter((que) => {
            const rect = rectFor(que);
            return !!rect && rect.height > 40;
          })
          .sort((a, b) => {
            const ra = rectFor(a);
            const rb = rectFor(b);
            return (ra ? ra.top : 0) - (rb ? rb.top : 0);
          });
      } catch (error) {
        return [];
      }
    }

    // Glide down to the next question block, glasses on, bubble live.
    function reviewScanStep() {
      if (!reviewScan.active) return;
      const blocks = reviewScanBlocks();
      if (!blocks.length) return;
      const block = blocks[reviewScan.index % blocks.length];
      reviewScan.index += 1;
      const spot = beside(rectFor(block));
      if (spot) {
        moveTo(spot.left, spot.top);
        faceRight();
      }
      if (reviewScan.right == null) setBubble(reviewScanBubble(), true);
    }

    function stopReviewScan() {
      reviewScan.active = false;
      if (reviewScan.timer) { clearInterval(reviewScan.timer); reviewScan.timer = null; }
      if (reviewScan.stopTimer) { clearTimeout(reviewScan.stopTimer); reviewScan.stopTimer = null; }
    }

    function scheduleReviewScanStop(ms) {
      if (reviewScan.stopTimer) clearTimeout(reviewScan.stopTimer);
      reviewScan.stopTimer = setTimeout(() => {
        reviewScan.stopTimer = null;
        stopReviewScan();
      }, ms);
    }

    function enterReviewScan() {
      if (reviewScan.active) {
        setBubble(reviewScanBubble(), true);
        return;
      }
      reviewScan.active = true;
      reviewScan.startedAt = Date.now();
      reviewScan.right = null;
      reviewScan.newCount = null;
      reviewScan.github = '';
      reviewScan.index = 0;
      if (reviewScan.timer) clearInterval(reviewScan.timer);
      reviewScan.timer = setInterval(() => {
        try { reviewScanStep(); } catch (error) { warnOnce('review-glide', error); }
      }, REVIEW_GLIDE_MS);
      scheduleReviewScanStop(REVIEW_SCAN_MAX_MS);
      reviewParked = false;
      setState('review', { restart: true });
      setBubble(reviewScanBubble(), true);
      reviewScanStep();
    }

    // "Review scan: verified & saved 12 answers (4 new)" → live bubble counts.
    function noteReviewScanResult(right, newCount) {
      if (!reviewScan.active) enterReviewScan();
      reviewScan.right = Math.max(0, Number(right) || 0);
      reviewScan.newCount = newCount == null ? null : Math.max(0, Number(newCount) || 0);
      setBubble(reviewScanBubble(), true);
      scheduleReviewScanStop(5000);
    }

    // "GitHub sync: +4 pushed ✓" → append the sync badge to the same bubble.
    // Failures/skips leave the bubble clean (content.js already warns in the HUD).
    function noteGitHubSync(ok, pushed) {
      if (!reviewScan.active) return;
      reviewScan.github = ok ? (pushed > 0 ? 'GitHub +' + pushed + ' ✓' : 'GitHub ✓') : '';
      setBubble(reviewScanBubble(), true);
      if (ok) scheduleReviewScanStop(3500);
    }

    /* ── Live page awareness: low-timer alarm + review score celebration ──── */

    function isAttemptPage() {
      try {
        const path = String((typeof location !== 'undefined' && location.pathname) || '');
        return path.includes('/mod/quiz/attempt.php') || path.includes('/attempt.php');
      } catch (error) {
        return false;
      }
    }

    // "0:04:37" / "4:37" / "4 mins 37 secs" / "45 secs" → seconds remaining.
    function parseRemainingSeconds(text) {
      const raw = norm(text).toLowerCase();
      if (!raw) return null;
      const clock = raw.match(/(\d{1,3}):(\d{1,2})(?::(\d{1,2}))?/);
      if (clock) {
        const first = Number(clock[1]);
        const second = Number(clock[2]);
        if (clock[3] == null) return first * 60 + second;
        return first * 3600 + second * 60 + Number(clock[3]);
      }
      const hours = raw.match(/(\d+)\s*(?:hours?|hrs?|h)\b/);
      const mins = raw.match(/(\d+)\s*(?:minutes?|mins?|m)\b/);
      const secs = raw.match(/(\d+)\s*(?:seconds?|secs?|s)\b/);
      if (hours || mins || secs) {
        return (hours ? Number(hours[1]) * 3600 : 0)
          + (mins ? Number(mins[1]) * 60 : 0)
          + (secs ? Number(secs[1]) : 0);
      }
      const bare = raw.match(/\b(\d{1,4})\b/);
      return bare ? Number(bare[1]) : null;
    }

    function remainingSeconds() {
      const selectors = ['#quiz-time-left', '#quiz-timer'];
      for (let i = 0; i < selectors.length; i += 1) {
        let node = null;
        try { node = document.querySelector(selectors[i]); } catch (error) { node = null; }
        if (!node) continue;
        const seconds = parseRemainingSeconds(node.innerText || node.textContent);
        if (seconds != null) return seconds;
      }
      return null;
    }

    // Polled every 10 s: shout exactly once when the attempt drops under 5 min.
    // The alarm re-arms by itself if the timer climbs back above 5 min (i.e. the
    // next attempt), so each attempt gets one panic and no nagging.
    function checkQuizTimer() {
      try {
        if (!booted || isReviewPage() || !isAttemptPage()) return;
        const seconds = remainingSeconds();
        if (seconds == null) return;
        if (seconds > TIMER_PANIC_SECONDS) { panicWarned = false; return; }
        if (seconds <= 0 || panicWarned) return;
        panicWarned = true;
        wakeFromNap(null); // a low-timer alarm never fires from inside a catnap
        startOverlay('review', PANIC_HOLD_MS, PANIC_LINE);
      } catch (error) {
        warnOnce('timer-check', error);
      }
    }

    // Grade-ish text → percentage: "88.00 %", "Grade 44 out of 50.00" and
    // "90.00/100.00" all resolve to a 0–100 value.
    function percentFromText(text) {
      const raw = norm(text);
      if (!raw) return null;
      const percent = raw.match(/(\d{1,3}(?:[.,]\d+)?)\s*(?:%|percent)/i);
      if (percent) {
        const value = Number(percent[1].replace(',', '.'));
        if (!Number.isNaN(value) && value >= 0 && value <= 100) return value;
      }
      const fraction = raw.match(/(\d{1,4}(?:[.,]\d+)?)\s*(?:out\s+of|\/)\s*(\d{1,4}(?:[.,]\d+)?)/i);
      if (fraction) {
        const got = Number(fraction[1].replace(',', '.'));
        const max = Number(fraction[2].replace(',', '.'));
        if (!Number.isNaN(got) && !Number.isNaN(max) && max > 0 && got >= 0 && got <= max) {
          return (got / max) * 100;
        }
      }
      return null;
    }

    // Overall percentage from the review grade table only — never a single
    // question's "Grade 1.00 out of 1.00" row.
    function reviewPercent() {
      try {
        const summary = document.querySelector('.quizreviewsummary, #quizreviewsummary');
        if (summary) {
          const direct = percentFromText(summary.innerText || summary.textContent);
          if (direct != null) return direct;
          const cells = summary.querySelectorAll('td, .cell, .quizreviewsummarygrade');
          for (let i = 0; i < cells.length; i += 1) {
            const value = percentFromText(cells[i].innerText || cells[i].textContent);
            if (value != null) return value;
          }
          return null;
        }
        const fallback = document.querySelector('.totalgrade, .reviewsummary');
        return fallback ? percentFromText(fallback.innerText || fallback.textContent) : null;
      } catch (error) {
        warnOnce('review-percent', error);
        return null;
      }
    }

    // One celebration per review page load, picked from the score band. Returns
    // false (and says nothing) when the grade table is missing or unreadable, so
    // setState('review') can fall back to the "Learned X right!" line.
    function announceReviewScore() {
      if (reviewScan.active) return false; // scanner counts own the bubble
      if (scoreAnnounced) return false;
      const percent = reviewPercent();
      if (percent == null) return false;
      scoreAnnounced = true;
      const line = percent >= 90
        ? pickFreshLine(SCORE_HIGH_LINES)
        : (percent >= 75 ? pickFreshLine(SCORE_PASS_LINES) : pickFreshLine(SCORE_LOW_LINES));
      if (line) { lastScoreLine = line; setBubble(line, true); } // remember + show
      if (catEl) {
        catEl.classList.remove('qb-hop');
        void catEl.offsetWidth;
        catEl.classList.add('qb-hop');
      }
      return true;
    }

    /* ── Reconciliation loop (poll): never invents a click, only state ────── */

    function refresh() {
      if (!booted || !wrapEl) return;
      try { presenceTick(); } catch (error) { warnOnce('presence-tick', error); }
      if (isReviewPage()) {
        enterReview();
        if (!scoreAnnounced) announceReviewScore(); // grade table may load late
        return;
      }
      if (currentState === 'review') { reviewParked = false; setState('idle'); }
      if (reviewScan.active) stopReviewScan(); // navigated away from the review page
      // Hold the "AHA!!" reaction and the clicking / typing action pose.
      if (currentState === 'answering' || currentState === 'nextpage' || currentState === 'harvesting'
        || ACTION_STATES.includes(currentState)) return;

      if (!botRunning()) {
        if (currentState !== 'idle') setState('idle');
        return;
      }

      const container = activeQuestion();
      if (!container) { if (currentState !== 'idle') setState('idle'); return; }
      const key = questionKeyOf(container);
      if (!key || answeredKeys.has(key)) {
        if (currentState !== 'idle') setState('idle');
        return;
      }
      if (key === lastQuestionKey) return; // already reading/thinking about it
      lastQuestionKey = key;
      lastQuestionAt = Date.now();
      enterThinking(container);
    }

    /* ── HUD log observation (read-only, pass-through tee) ────────────────── */

    /* ── Harvesting narration (still read-only) ───────────────────────────── */

    // Lines content.js / background.js stream while a course/review harvest runs:
    //   "Auto-harvesting answers for CS6301"
    //   Harvest "data structures" page 1: HTTP 200, 3 matched card(s)
    //   Review harvest: scanning grade report for CS6301...
    //   Review harvest [3/12]: Long Quiz 2
    const HARVEST_START_RE = /harvest\s+"|auto-harvesting answers|scanning grade report|review harvest\s*\[|answer harvesting is running/;
    // Lines that carry a scoop count:
    //   Harvested 3 answers for "data structures"   (background, per keyword)
    //   Auto-harvested 12 answers for CS6301
    //   Review harvest: 5 verified answer(s), 2 eliminated wrong choice(s)
    const HARVEST_COUNT_RES = [
      /harvest(?:ed)?\s+(\d+)\s+answers?\b/,
      /review harvest:\s*(\d+)\s+verified/,
    ];
    // Harvest endings that carry no count (nothing left to dig).
    const HARVEST_DONE_RE = /review harvest:\s*nothing new|course already harvested|review harvest failed|could not load course topics|harvesting (?:request )?failed|harvest is already running|no completed quizzes/;

    // Back to idle after `ms` of quiet — re-armed by every harvest line.
    function scheduleHarvestIdle(ms) {
      if (harvestTimer) clearTimeout(harvestTimer);
      harvestTimer = setTimeout(() => {
        harvestTimer = null;
        if (currentState === 'harvesting') setState('idle');
      }, ms);
    }

    function enterHarvesting() {
      // restart=true re-shows "Digging up answers..." even if the cat is already
      // digging, and re-arms the 20 s safety timer through the state body.
      setState('harvesting', { restart: true });
    }

    function finishHarvesting(count) {
      if (count != null) setBubble(SPEECH.scooped(count), true);
      scheduleHarvestIdle(HARVEST_HOLD_MS);
    }

    // Returns true when `line` was a harvest line and nothing else should read
    // it. A count line is always swallowed (a harvest summary must never look
    // like an answer event); scoops/endings only act on a *running* harvest.
    function noteHarvestLine(line) {
      if (!line) return false;
      let count = null;
      for (let i = 0; i < HARVEST_COUNT_RES.length; i += 1) {
        const match = line.match(HARVEST_COUNT_RES[i]);
        if (match) { count = Math.max(0, Number(match[1]) || 0); break; }
      }
      if (count != null) {
        if (currentState === 'harvesting') finishHarvesting(count);
        return true;
      }
      if (currentState === 'harvesting' && HARVEST_DONE_RE.test(line)) {
        finishHarvesting(null);
        return true;
      }
      if (HARVEST_START_RE.test(line)) {
        enterHarvesting();
        return true;
      }
      return false;
    }

    // Which action pose a HUD line implies:
    //   'typing'   — a fill-in-the-blank / short-answer box got typed into
    //   'clicking' — a radio / checkbox / dropdown answer got chosen
    //   'answer'   — the bot answered, but the wording does not say how, so the
    //                active .que decides (filled text box vs. checked option)
    //   ''         — the line is not about choosing an answer
    // Manual-wait/timeout lines only *announce* that the bot is waiting, so they
    // are never treated as an action.
    function classifyLogAction(line) {
      if (!line) return '';
      if (/waiting for manual|manual [a-z]* ?timeout|no ai answer|all answered|advancing/.test(line)) return '';
      if (/\btyped\b|\btyping\b|\btext\s*(answer|input|box|field)\b|fill[- ]?(in|the[- ]blank)|\bblank\b|\bshort[- ]answer\b/.test(line)) {
        return 'typing';
      }
      if (/\bselected\b|\bselecting\b|\bselection\b|\bmatched\b|\bmatch(es|ing)?\b|\bticked\b|\bticking\b|\bclicked\b|\bclicking\b|\bchecked\b|\bchose\b|\bchosen\b|\boption\s+\d|\bdropdown\s+\d|\btier\s+\d/.test(line)) {
        return 'clicking';
      }
      if (/\banswer(ed|s|ing)?\b|saved manual/.test(line)) return 'answer';
      return '';
    }

    function onHudLog(level, text) {
      const line = String(text == null ? '' : text)
        .toLowerCase()
        .replace(/^\s*\[[^\]]*\]\s*/, ''); // drop an optional [timestamp]
      if (!line) return;

      // Session work lock first: it must see every line, including the harvest
      // summaries that the harvest narration swallows right below.
      noteWorkLockLine(line);

      // Harvest progress owns the cat first: these lines must never fall through
      // to the answer classifier ("3 matched card(s)" would look like a click).
      if (noteHarvestLine(line)) return;

      // Review scanner: "Review scan: checking all answers..." puts the reading
      // glasses on and starts the glide; the result / sync lines update the live
      // bubble. These checks run before the review-page branch below so the
      // counts are never swallowed by the generic score narration.
      if (/review scan:\s*checking all answers/.test(line)) { enterReviewScan(); return; }
      const scanResult = line.match(/review scan:\s*verified & saved\s+(\d+)\s+answers?(?:\s*\((\d+)\s+new\))?/);
      if (scanResult) {
        noteReviewScanResult(Number(scanResult[1]), scanResult[2] == null ? null : Number(scanResult[2]));
        return;
      }
      if (/^review scan:/.test(line)) {
        if (reviewScan.active) scheduleReviewScanStop(2500); // "no questions to check"
        return;
      }
      if (/^github sync:/.test(line)) {
        const pushed = line.match(/\+\s*(\d+)/);
        noteGitHubSync(/✓/.test(line), pushed ? Number(pushed[1]) : 0);
        return;
      }

      if (isReviewPage() || /review page:/.test(line)) {
        enterReview();
        if (/learned\s+\d+\s+right/.test(line)) refreshReviewCount();
        return;
      }
      if (/^\s*q:|^\s*question:/.test(line)) { noteQuestion(); return; }

      const actionKind = classifyLogAction(line);
      if (actionKind) {
        // `Typed:` → typing, `Selected:` / `Matched:` / `Ticked` / `Option N`
        // / `Dropdown N` / `Tier N` → clicking. An ambiguous answer line falls
        // back to the DOM hint (filled text box vs. checked option).
        enterAnswering(null, actionKind === 'answer' ? '' : actionKind);
        return;
      }

      if (/waiting for manual/.test(line) || /bot started|scanning/.test(line)) {
        noteQuestion();
        return;
      }
      if (/bot stopped|^\s*stop\s*$|max runtime/.test(line)) setState('idle');
    }

    // content.js declares `function logHUD(...)`, which lives on the shared
    // isolated-world global object. Tee it: read the text, then delegate the
    // exact same arguments/return value. Nothing is altered, nothing can block.
    function hookHudLog() {
      try {
        const original = window.logHUD;
        if (typeof original !== 'function') return false;
        if (original.__qbMascotTee) return true;
        const tee = function (level, text) {
          try { onHudLog(level, text); } catch (error) { /* mascot only */ }
          return original.apply(this, arguments);
        };
        tee.__qbMascotTee = true;
        window.logHUD = tee;
        return true;
      } catch (error) {
        warnOnce('log-tee', error);
        return false;
      }
    }

    function watchHudLog() {
      if (hookHudLog()) return;
      let attempts = 0;
      const retry = setInterval(() => {
        attempts += 1;
        if (hookHudLog() || attempts >= 30) clearInterval(retry);
      }, 1000);
    }

    // Belt and braces: if a HUD build ever exposes a visible log node
    // (#qb-log / .qb-log) outside its shadow root, mirror its last line.
    function readLogNode(container) {
      try {
        if (!container) return;
        const rows = container.querySelectorAll('.hud-log-line, .log-line, li, div');
        const node = rows.length ? rows[rows.length - 1] : container;
        const text = norm(node.textContent).slice(0, 240);
        if (!text || text === lastLogLine) return;
        lastLogLine = text;
        onHudLog('info', text);
      } catch (error) {
        warnOnce('log-node', error);
      }
    }

    function watchLogNodes() {
      const attach = () => {
        let container = null;
        try { container = document.querySelector('#qb-log, .qb-log'); } catch (error) { container = null; }
        if (!container) return false;
        const observer = new MutationObserver(() => readLogNode(container));
        observer.observe(container, { childList: true, subtree: true, characterData: true });
        readLogNode(container);
        return true;
      };
      if (attach()) return;
      let attempts = 0;
      const retry = setInterval(() => {
        attempts += 1;
        if (attach() || attempts >= 30) clearInterval(retry);
      }, 1000);
    }

    /* ── Passive answer listeners (capture + passive, never cancelled) ─────── */

    function isAnswerControl(node) {
      if (!node || node.nodeType !== 1) return false;
      const tag = String(node.tagName || '').toLowerCase();
      if (tag !== 'input' && tag !== 'select' && tag !== 'textarea') return false;
      try {
        return !!(node.closest && node.closest('.que, .formulation'));
      } catch (error) {
        return false;
      }
    }

    function onPageAnswerEvent(event) {
      try {
        if (!booted) return;
        const target = event && event.target;
        if (!isAnswerControl(target)) return;
        const type = String((event && event.type) || '').toLowerCase();
        const kind = kindForControl(target);
        if (!kind) return;
        // A click only *chooses* for a radio/checkbox. A text box is merely
        // focused and a dropdown merely opened, so those wait for `change`.
        if (type === 'click') {
          const tag = String(target.tagName || '').toLowerCase();
          if (tag !== 'input') return;
          const inputType = String(target.type || '').toLowerCase();
          if (inputType !== 'radio' && inputType !== 'checkbox') return;
        }
        lastControl = { kind, element: target, at: Date.now() };
        enterAnswering(anchorFor(target), kind);
      } catch (error) {
        warnOnce('answer-event', error);
      }
    }

    function watchAnswerControls() {
      document.addEventListener('change', onPageAnswerEvent, { capture: true, passive: true });
      document.addEventListener('click', onPageAnswerEvent, { capture: true, passive: true });
    }

    /* ── Moodle DOM observation (debounced, read-only) ────────────────────── */

    function onMoodleMutation() {
      if (mutationTimer) clearTimeout(mutationTimer);
      mutationTimer = setTimeout(() => {
        mutationTimer = null;
        try {
          refreshReviewCount();
          refresh();
        } catch (error) {
          warnOnce('mutation', error);
        }
      }, MUTATION_DEBOUNCE_MS);
    }

    function watchMoodleDom() {
      try {
        const observer = new MutationObserver(onMoodleMutation);
        observer.observe(document.body || document.documentElement, {
          childList: true,
          subtree: true,
          characterData: true,
        });
      } catch (error) {
        warnOnce('dom-observe', error);
      }
    }

    /* ── Boot ─────────────────────────────────────────────────────────────── */

    function boot() {
      if (booted) return;
      booted = true;

      try {
        mount();
      } catch (error) {
        warnOnce('mount', error);
        return;
      }

      // Claim/release the one shared cat (hidden until the record says this tab
      // owns it), then start the catnap watchdog.
      try {
        initPresence();
      } catch (error) {
        warnOnce('presence-boot', error);
      }

      // Popup switch: the cat (and the busy pill) hide or come back instantly on
      // every open tab, no reload. The local brain boots its passive sensors.
      try { watchUiEnabled(); } catch (error) { warnOnce('ui-toggle-boot', error); }
      try { startBrain(); } catch (error) { warnOnce('brain-boot', error); }

      try {
        lastInteractionAt = Date.now();
        document.addEventListener('visibilitychange', onVisibilityChange, { passive: true });
        window.addEventListener('focus', onTabFocus, { passive: true });
        // "The user is here" bookkeeping only: passive listeners that just stamp
        // a timestamp, so nothing about page behaviour changes.
        const interactionEvents = ['pointerdown', 'keydown', 'wheel', 'touchstart'];
        interactionEvents.forEach((name) => {
          document.addEventListener(name, markInteraction, { capture: true, passive: true });
        });
        napTickTimer = setInterval(() => {
          try { napTick(); } catch (error) { warnOnce('nap-tick', error); }
        }, NAP_TICK_MS);
      } catch (error) {
        warnOnce('nap-boot', error);
      }

      try {
        if (isReviewPage()) {
          setState('review');
          enterReview();
        } else {
          setState('idle', { quote: true });
        }
      } catch (error) {
        warnOnce('initial-state', error);
      }

      try { watchHudLog(); } catch (error) { warnOnce('log-tee-boot', error); }
      try { watchLogNodes(); } catch (error) { warnOnce('log-watch', error); }
      try { watchAnswerControls(); } catch (error) { warnOnce('answer-watch', error); }
      try { watchMoodleDom(); } catch (error) { warnOnce('dom-watch', error); }

      try {
        tickTimer = setInterval(() => {
          try { refresh(); } catch (error) { warnOnce('tick', error); }
        }, TICK_MS);
      } catch (error) {
        warnOnce('tick-start', error);
      }

      try {
        checkQuizTimer(); // one immediate look, then every 10 s on /attempt.php
        timerCheck = setInterval(() => {
          try { checkQuizTimer(); } catch (error) { warnOnce('timer-tick', error); }
        }, TIMER_CHECK_MS);
      } catch (error) {
        warnOnce('timer-start', error);
      }

      try { refresh(); } catch (error) { warnOnce('refresh-boot', error); }
    }

    // Optional, non-invasive integration hook used only by the console or a test
    // harness. Nothing in content.js uses it:
    //   window.dispatchEvent(new CustomEvent('qb-mascot-state', { detail: { state: 'thinking' } }));
    window.addEventListener('qb-mascot-state', (event) => {
      try {
        const detail = (event && event.detail) || {};
        const next = typeof detail === 'string' ? detail : String(detail.state || '');
        if (isKnownState(next)) setState(next);
      } catch (error) {
        warnOnce('external-state', error);
      }
    });

    function start() {
      try {
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', () => {
            try { boot(); } catch (error) { warnOnce('boot', error); }
          }, { once: true });
        } else {
          boot();
        }
      } catch (error) {
        warnOnce('start', error);
      }
    }

    start();
  })();
} catch (error) {
  try { console.warn('[Mascot]', error); } catch (ignored) { /* never throw */ }
}



})();
