'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, loadScripts, plain } = require('./helpers');

test('providers.js has no duplicate top-level function declarations', () => {
  const src = fs.readFileSync(path.join(ROOT, 'providers.js'), 'utf8');
  const matches = [...src.matchAll(/^(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/gm)].map((m) => m[1]);
  const seen = new Set();
  const duplicates = [];
  for (const name of matches) {
    if (seen.has(name)) duplicates.push(name);
    seen.add(name);
  }
  assert.deepEqual(duplicates, []);
});

test('providers.js parses MCQ, multi-select, matching JSON, and typed answers accurately', async () => {
  const { ctx } = loadScripts(['config.js', 'storage.js', 'providers.js']);
  await ctx.loadConfig();

  const opts = ['TCP', 'UDP', 'ICMP', 'ARP'];
  assert.equal(ctx._interpretAnswer('2', opts), 1);
  assert.equal(ctx._interpretAnswer('C)', opts), 2);
  assert.equal(ctx._interpretAnswer('TCP', opts), 0);
  assert.equal(ctx._interpretAnswer('1', opts, [0]), -1);

  assert.deepEqual(plain(ctx._interpretMulti('1, 3', opts)), [0, 2]);
  assert.deepEqual(plain(ctx._parseMultiSelectResponse('["TCP", "ICMP"]', opts, ['UDP'], [])), [0, 2]);
  // Blocks repeated partial combinations
  assert.deepEqual(plain(ctx._parseMultiSelectResponse('["TCP", "ICMP"]', opts, [], [['icmp', 'tcp']])), []);

  const parsedObj = ctx._extractJsonObject('```json\n{"1": "TCP", "2": "UDP",}\n```');
  assert.deepEqual(plain(parsedObj), { '1': 'TCP', '2': 'UDP' });

  const mapped = ctx._parseMapping('1. B\n2. A', opts, 2);
  assert.deepEqual(plain(mapped.idxs), [1, 0]);
  assert.equal(mapped.matched, 2);

  assert.equal(ctx._cleanTyped('Answer: "Buffer Overflow."', true), 'Buffer Overflow');
  assert.equal(ctx._cleanTyped('NONE', true), '');
});

test('providers.js strictly respects OPENROUTER_WEB_ENABLED=false', async () => {
  let calledActions = [];
  const { ctx, chrome } = loadScripts(['config.js', 'storage.js', 'providers.js'], {
    initialStorage: {
      local: { OPENROUTER_API_KEY: 'sk-or-test' },
      sync: { OPENROUTER_WEB_ENABLED: false },
    },
  });
  chrome.runtime.sendMessage = (msg, cb) => {
    calledActions.push(msg.action);
    cb({ _reqId: msg._reqId, choices: [{ message: { content: '1' } }] });
  };
  await ctx.loadConfig();

  const webIdx = await ctx.askOpenRouterWeb('What is HTTP?', ['Hypertext Transfer Protocol', 'FTP']);
  assert.equal(webIdx, -1);
  assert.deepEqual(calledActions, []);

  const webMulti = await ctx.askOpenRouterWebMulti('Select web protocols', ['HTTP', 'HTTPS']);
  assert.deepEqual(plain(webMulti), []);
  assert.deepEqual(calledActions, []);
});

test('background.js parses answer cards, compares semver, logs to sidepanel, and rotates Gemini keys', async () => {
  const geminiCalls = [];
  const mockFetch = async (url) => {
    if (url.includes('generativelanguage.googleapis.com')) {
      geminiCalls.push(url);
      if (url.includes('key=k1')) {
        return { ok: false, status: 429, text: async () => 'quota exceeded' };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ candidates: [{ content: { parts: [{ text: '2' }] } }] }),
      };
    }
    if (url.includes('default_bank.json')) {
      return { ok: true, status: 200, json: async () => ({ questions: {} }) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };

  const { ctx, chrome } = loadScripts(['config.js', 'storage.js', 'background.js'], {
    fetch: mockFetch,
    initialStorage: {
      local: { GEMINI_API_KEY: 'k1, k2' },
      sync: { WEB_SEARCH_DOMAINS: 'amauoed.com, studocu.com' },
    },
  });

  // HTML scraping
  const html = `
    <div class="card mb-2 bg-secondary">
      <div class="mb-2">What does DNS stand for?</div>
      <strong>Domain Name System <span class="chip bg-success">Correct</span></strong>
      <div class="chip bg-primary">CS101</div>
    </div>`;
  const hits = ctx.parseAnswerKeyHtml(html, 4);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].question, 'What does DNS stand for?');
  assert.equal(hits[0].answer, 'Domain Name System');

  const cards = ctx.parseHarvestCards(html);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].answer, 'Domain Name System');

  // Semver comparison
  assert.equal(ctx.isNewerVersion('3.7.1', '3.7.0'), true);
  assert.equal(ctx.isNewerVersion('3.7.0', '3.7.0'), false);
  assert.equal(ctx.isNewerVersion('3.6.9', '3.7.0'), false);

  // Domain prefix from config
  await ctx.loadConfig();
  assert.equal(ctx.buildSearchDomainsPrefix(), 'site:amauoed.com OR site:studocu.com');

  // Sidepanel log handler
  const logRes = await ctx.handleMessage({ action: 'log', level: 'success', text: 'Answered Q1', _reqId: 'r1' });
  assert.equal(logRes.ok, true);
  assert.ok(chrome._areas.local._sidepanel_log.some((line) => line.includes('Answered Q1')));

  // Gemini key rotation on 429: k1 cools down, k2 succeeds immediately
  const gemRes = await ctx.handleMessage({
    action: 'postGemini',
    _reqId: 'r2',
    payload: { contents: [{ role: 'user', parts: [{ text: 'hi' }] }] },
  });
  assert.equal(gemRes.text, '2');
  assert.equal(gemRes.keyIndex, 2);
  assert.equal(geminiCalls.length, 2);
  assert.ok(chrome._areas.session._gemini_key_state.k1.limitedUntil > Date.now());
});
