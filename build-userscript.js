#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const manifest = JSON.parse(read('manifest.json'));
const files = [
  'hud.css',
  'config.js',
  'storage.js',
  'providers.js',
  'content.js',
  'universal-harvester.js',
  'mascot.js',
];
const source = Object.fromEntries(files.map((name) => [name, read(name)]));

const metadata = `// ==UserScript==
// @name         Moodle Quiz Bot + 3-Cat Squad
// @namespace    https://github.com/ambotlangnimo/moodle-quiz-bot
// @version      ${manifest.version}
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
// @connect      api.freellmapi.com
// @connect      openrouter.ai
// @connect      html.duckduckgo.com
// @connect      en.wikipedia.org
// @connect      127.0.0.1
// @connect      localhost
// @connect      amauoed.com
// @connect      *
// @updateURL    https://raw.githubusercontent.com/ambotlangnimo/moodle-quiz-bot/main/moodle-quiz-bot.user.js
// @downloadURL  https://raw.githubusercontent.com/ambotlangnimo/moodle-quiz-bot/main/moodle-quiz-bot.user.js
// @run-at       document-idle
// ==/UserScript==`;

const shim = String.raw`
const QB_TM_MANIFEST = ${JSON.stringify(manifest)};
const QB_TM_HUD_CSS = ${JSON.stringify(source['hud.css'])};
const QB_TM_LOCAL_PREFIX = 'qb_tm_local:';
const QB_TM_SYNC_PREFIX = 'qb_tm_sync:';
const QB_TM_REGISTRY_PREFIX = 'qb_tm_registry:';
let qbTmLastError = null;
const qbTmStorageListeners = new Set();
const qbTmWatched = new Set();
const qbTmRuntimeListeners = new Set();
const qbTmGeminiKeyState = new Map();
let qbTmGeminiKeyCursor = 0;

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
        responseText: response.responseType === 'arraybuffer' ? '' : (response.responseText || ''),
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

function qbTmBase64FromArrayBuffer(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)));
  }
  return btoa(binary);
}

async function qbTmReadAllSettings() {
  const [sync, local] = await Promise.all([
    chrome.storage.sync.get(null),
    chrome.storage.local.get([
      'CUSTOM_API_KEY', 'GEMINI_API_KEY', 'OPENROUTER_API_KEY',
      'OLLAMA_API_KEY', 'GITHUB_SYNC_TOKEN', 'GITHUB_BANK_TOKEN', 'DEEPSEEK_API_KEY',
    ]),
  ]);
  const merged = { ...sync };
  for (const [k, v] of Object.entries(local || {})) {
    if (v !== undefined && v !== '') merged[k] = v;
  }
  return merged;
}

async function qbTmGitHubSettings(payload) {
  const settings = await qbTmReadAllSettings();
  return {
    owner: String((payload && payload.owner) || settings.GITHUB_BANK_OWNER || '').trim(),
    repo: String((payload && payload.repo) || settings.GITHUB_BANK_REPO || '').trim(),
    path: String((payload && payload.path) || settings.GITHUB_BANK_PATH || 'bank.json').trim() || 'bank.json',
    token: String((payload && payload.token) || settings.GITHUB_SYNC_TOKEN || settings.GITHUB_BANK_TOKEN || '').trim(),
  };
}

function qbTmGitHubHeaders(token) {
  const headers = { Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  return headers;
}

async function qbTmGitHubGetFile(settings) {
  const encodedPath = settings.path.split('/').filter(Boolean).map(encodeURIComponent).join('/');
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
  const encodedPath = settings.path.split('/').filter(Boolean).map(encodeURIComponent).join('/');
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

function qbTmStripHtml(text) {
  return String(text || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function qbTmParseAnswerKeyHtml(html, maxHits) {
  const hits = [];
  const seen = new Set();
  const blocks = String(html || '').split('class="card mb-2 bg-secondary"');
  for (let i = 1; i < blocks.length && hits.length < maxHits; i += 1) {
    const block = blocks[i];
    const questionMatch = block.match(/class="mb-2">([\s\S]*?)<\/div>/);
    const answerMatch = block.match(/<strong>\s*([\s\S]*?)\s*<span class="chip bg-success">Correct/);
    const courseMatch = block.match(/chip bg-primary[^>]*>([\s\S]*?)<\/div>/);
    if (!(questionMatch && answerMatch)) continue;
    const answer = qbTmStripHtml(answerMatch[1]).replace(/\s*Correct\s*$/i, '').trim();
    if (!answer || seen.has(answer.toLowerCase())) continue;
    seen.add(answer.toLowerCase());
    hits.push({
      question: qbTmStripHtml(questionMatch[1]),
      answer,
      course: courseMatch ? qbTmStripHtml(courseMatch[1]) : '',
    });
  }
  return hits;
}

async function qbTmProviderRequest(action, payload) {
  const settings = await qbTmReadAllSettings();
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
      : settings.CUSTOM_API_BASE_URL || 'https://api.freellmapi.com/v1').replace(/\/$/, '');
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
    const now = Date.now();
    const cooldownMs = (Number(settings.GEMINI_KEY_COOLDOWN) || 180) * 1000;
    let tried = 0;
    let lastStatus = 0;
    let lastError = '';
    for (let offset = 0; offset < keys.length; offset += 1) {
      const idx = (qbTmGeminiKeyCursor + offset) % keys.length;
      const key = keys[idx];
      const state = qbTmGeminiKeyState.get(key) || {};
      if ((state.limitedUntil && state.limitedUntil > now) || (state.invalidUntil && state.invalidUntil > now)) continue;
      tried += 1;
      const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model
        + ':generateContent?key=' + encodeURIComponent(key);
      const response = await qbTmRequest({
        method: 'POST', url, headers: { 'Content-Type': 'application/json' },
        data: JSON.stringify({ contents: data.contents || [], generationConfig: data.generationConfig }),
        timeout: data.timeout || 30000,
      });
      if (response.status >= 200 && response.status < 300) {
        const json = qbTmParseJson(response.responseText, 'Gemini');
        qbTmGeminiKeyCursor = (idx + 1) % keys.length;
        return {
          _reqId: data._reqId,
          text: (json.candidates && json.candidates[0] && json.candidates[0].content && json.candidates[0].content.parts || [])
            .map((part) => part.text || '').join('').trim(),
          keyIndex: idx + 1,
          keyCount: keys.length,
        };
      }
      lastStatus = response.status;
      lastError = 'Gemini HTTP ' + response.status + ': ' + response.responseText.slice(0, 300);
      const quota = response.status === 429 || response.status === 503 || (response.status === 403 && /quota|rate/i.test(response.responseText));
      const invalid = response.status === 401 || (response.status === 400 && /api[ _-]?key not valid|invalid api key/i.test(response.responseText));
      if (quota) { qbTmGeminiKeyState.set(key, { ...state, limitedUntil: now + cooldownMs }); continue; }
      if (invalid) { qbTmGeminiKeyState.set(key, { ...state, invalidUntil: now + 24 * 60 * 60 * 1000 }); continue; }
      return { _reqId: data._reqId, status: response.status, error: lastError };
    }
    return {
      _reqId: data._reqId,
      status: lastStatus || 429,
      error: lastError || ('All ' + keys.length + ' Gemini API key(s) are cooling down or invalid'),
      allKeysLimited: true,
      keysTried: tried,
      keyCount: keys.length,
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
      const snippet = qbTmStripHtml(match[1]).slice(0, 400);
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

  if (action === 'log') return { _reqId: reqId, ok: true };
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
  if (action === 'getAnswerKey') {
    try {
      const q = String(payload.question || '').slice(0, 300);
      const response = await qbTmRequest({
        url: 'https://amauoed.com/search?query=' + encodeURIComponent(q),
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AmaBot/1.0)' },
        timeout: 6000,
      });
      const hits = response.status >= 200 && response.status < 300
        ? qbTmParseAnswerKeyHtml(response.responseText, 4)
        : [];
      return { _reqId: reqId, hits };
    } catch (error) { return { _reqId: reqId, hits: [] }; }
  }
  if (action === 'searchWeb' || action === 'SEARCH_WEB_SNIPPETS') {
    const result = await qbTmSearchWeb(payload.query, payload.maxResults);
    return { _reqId: reqId, ...result };
  }
  if (action === 'resolveCustomModel') {
    try {
      const settings = await qbTmReadAllSettings();
      const base = String(settings.CUSTOM_API_BASE_URL || 'https://api.freellmapi.com/v1').replace(/\/+$/, '');
      const headers = { 'Content-Type': 'application/json' };
      if (settings.CUSTOM_API_KEY) headers.Authorization = 'Bearer ' + settings.CUSTOM_API_KEY;
      const response = await qbTmRequest({ url: base + '/models', headers, timeout: 10000 });
      if (response.status < 200 || response.status >= 300) return { _reqId: reqId, model: null };
      const parsed = qbTmParseJson(response.responseText, 'Custom /models');
      const list = parsed.data || parsed.models || [];
      const first = list.find((m) => m && typeof (m.id || m.name || m.model) === 'string');
      return { _reqId: reqId, model: first ? (first.id || first.name || first.model) : null };
    } catch (error) { return { _reqId: reqId, model: null }; }
  }
  if (action === 'fetchImageBase64') {
    try {
      const response = await qbTmRequest({
        url: payload.url,
        responseType: 'arraybuffer',
        timeout: payload.timeout || 10000,
      });
      if (response.status < 200 || response.status >= 300 || !response.response) {
        return { _reqId: reqId, error: 'Image HTTP ' + response.status };
      }
      const mimeMatch = String(response.responseHeaders || '').match(/content-type:\s*([^\r\n;]+)/i);
      const mimeType = mimeMatch && mimeMatch[1].trim().startsWith('image/') ? mimeMatch[1].trim() : 'image/png';
      return { _reqId: reqId, base64: qbTmBase64FromArrayBuffer(response.response), mimeType };
    } catch (error) { return { _reqId: reqId, error: error.message || String(error) }; }
  }
  if (action === 'checkOllama') {
    try {
      const settings = await qbTmReadAllSettings();
      const base = String(settings.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
      const response = await qbTmRequest({ url: base + '/api/tags', timeout: 2500 });
      return { _reqId: reqId, ok: response.status >= 200 && response.status < 300 };
    } catch (error) { return { _reqId: reqId, ok: false }; }
  }
  if (action === 'postOpenRouter' || action === 'postGemini' || action === 'postCustomApi' || action === 'postOllama') {
    try { return await qbTmProviderRequest(action, { ...payload, _reqId: reqId }); }
    catch (error) { return { _reqId: reqId, error: error.message || String(error) }; }
  }
  if (action === 'CHECK_EXTENSION_UPDATE' || action === 'AUTO_HARVEST') {
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
} catch (error) { /* non-configurable in some browsers */ }

const QB_TM_SETTINGS = [
  ['MOODLE_URL', 'Moodle base URL'],
  ['GITHUB_BANK_OWNER', 'GitHub owner'],
  ['GITHUB_BANK_REPO', 'Question bank repository'],
  ['GITHUB_BANK_PATH', 'Question bank file path'],
  ['GITHUB_SYNC_TOKEN', 'GitHub token (repo contents access)'],
  ['OPENROUTER_API_KEY', 'OpenRouter API key'],
  ['OPENROUTER_MODEL', 'OpenRouter model'],
  ['GEMINI_API_KEY', 'Gemini API key(s)'],
  ['GEMINI_MODEL', 'Gemini model'],
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

  GM_addStyle('#qb-tm-settings-overlay{position:fixed;inset:0;z-index:2147483647;background:rgba(2,6,23,.78);display:flex;align-items:center;justify-content:center;padding:20px;font:14px system-ui,sans-serif;color:#e2e8f0}#qb-tm-settings-dialog{position:relative;width:min(620px,100%);max-height:90vh;overflow:auto;background:#111b31;border:1px solid #475569;border-radius:14px;padding:24px;box-shadow:0 20px 70px #000b}#qb-tm-settings-title{margin:0 40px 18px 0;color:#ffb347;font-size:20px}.qb-tm-close{position:absolute;right:14px;top:12px;background:#253550;color:#fff;border:0;border-radius:6px;font-size:22px;width:34px;height:34px;cursor:pointer}#qb-tm-settings-fields{display:grid;grid-template-columns:1fr 1fr;gap:12px}.qb-tm-field{display:flex;flex-direction:column;gap:5px;color:#cbd5e1}.qb-tm-field input{box-sizing:border-box;width:100%;padding:9px 10px;border:1px solid #475569;border-radius:7px;background:#0b1220;color:#f8fafc;font:inherit}.qb-tm-actions{display:flex;gap:10px;justify-content:flex-end;margin-top:18px}.qb-tm-actions button{border:0;border-radius:7px;padding:10px 16px;color:#fff;font-weight:600;cursor:pointer}.qb-tm-primary{background:#2563eb}.qb-tm-secondary{background:#0f766e}#qb-tm-settings-status{min-height:1.4em;margin:12px 0 0;color:#86efac}#qb-tm-settings-status.error{color:#fca5a5}@media(max-width:560px){#qb-tm-settings-fields{grid-template-columns:1fr}}');
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
      const current = typeof loadConfig === 'function' ? await loadConfig() : await qbTmReadAllSettings();
      for (const input of form.querySelectorAll('input[data-key]')) {
        const key = input.dataset.key;
        input.value = current[key] != null ? String(current[key]) : '';
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
      if (typeof saveConfig === 'function') await saveConfig(collect());
      else await chrome.storage.sync.set(collect());
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
      if (typeof saveConfig === 'function') await saveConfig(collect());
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
`;

// Shared core bundled ONCE instead of duplicated across branches.
const sharedCore = ['config.js', 'storage.js']
  .map((name) => `\n;\n${source[name]}\n`)
  .join('');
const moodleBranch = ['providers.js', 'content.js']
  .map((name) => `\n;\n${source[name]}\n`)
  .join('');
const harvesterBranch = `\n;\n${source['universal-harvester.js']}\n`;
const mascot = `\n;\n${source['mascot.js']}\n`;

const routing = `
${sharedCore}
window.__qbTmBankStorage = { mergeRemoteBankIntoLocal, answerKeyGetAll, flushNow };
window.__qbTmReloadConfig = loadConfig;

loadConfig().then(() => {
  const isMoodle = moodleAllowedHost(location.hostname);
  if (isMoodle) {
    (function () {
${moodleBranch}
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
${harvesterBranch}
      const qbTmHarvesterGearTimer = setInterval(() => {
        const header = window.__qbHarvesterHeader || document.getElementById('qb-hud-header');
        if (header) {
          qbTmAddGearButton(header);
          clearInterval(qbTmHarvesterGearTimer);
        }
      }, 250);
    })();
  }
${mascot}
});
`;

const output = `${metadata}
(function () {
'use strict';
${shim}
${routing}
})();
`;

const outputPath = path.join(root, 'moodle-quiz-bot.user.js');
fs.writeFileSync(outputPath, output, 'utf8');
console.log(`Built ${path.basename(outputPath)} v${manifest.version}`);
