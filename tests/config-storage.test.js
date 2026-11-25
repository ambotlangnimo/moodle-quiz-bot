'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScripts } = require('./helpers');

test('config.js migrates secrets from sync to local and updates live onChanged', async () => {
  const { ctx, chrome } = loadScripts(['config.js'], {
    initialStorage: {
      sync: {
        OPENROUTER_API_KEY: 'sk-legacy-sync',
        GEMINI_API_KEY: 'gem-key-1',
        SCAN_INTERVAL: 450,
      },
    },
  });

  await ctx.loadConfig();

  assert.equal(ctx.cfg('OPENROUTER_API_KEY'), 'sk-legacy-sync');
  assert.equal(ctx.cfg('GEMINI_API_KEY'), 'gem-key-1');
  assert.equal(ctx.cfg('SCAN_INTERVAL'), 450);
  // Secrets must be moved into local and scrubbed from sync.
  assert.equal(chrome._areas.local.OPENROUTER_API_KEY, 'sk-legacy-sync');
  assert.equal(chrome._areas.sync.OPENROUTER_API_KEY, undefined);
  assert.equal(chrome._areas.local.GEMINI_API_KEY, 'gem-key-1');
  assert.equal(chrome._areas.sync.GEMINI_API_KEY, undefined);

  // Saving new secrets writes only to local; preferences write to sync.
  await ctx.saveConfig({ OPENROUTER_API_KEY: 'sk-new-local', AUTO_SUBMIT: false });
  assert.equal(chrome._areas.local.OPENROUTER_API_KEY, 'sk-new-local');
  assert.equal(chrome._areas.sync.OPENROUTER_API_KEY, undefined);
  assert.equal(chrome._areas.sync.AUTO_SUBMIT, false);

  // Live storage.onChanged updates in-memory config without reload.
  await chrome.storage.local.set({ GEMINI_API_KEY: 'gem-live-updated' });
  await chrome.storage.sync.set({ GEMINI_MODEL: 'gemini-custom-test' });
  assert.equal(ctx.cfg('GEMINI_API_KEY'), 'gem-live-updated');
  assert.equal(ctx.cfg('GEMINI_MODEL'), 'gemini-custom-test');
});

test('config.js moodleAllowedHost accepts amaes.com and custom MOODLE_URL', async () => {
  const { ctx } = loadScripts(['config.js']);
  await ctx.loadConfig();
  assert.equal(ctx.moodleAllowedHost('amaes.com'), true);
  assert.equal(ctx.moodleAllowedHost('lms.amaes.com'), true);
  assert.equal(ctx.moodleAllowedHost('evil.com'), false);

  await ctx.saveConfig({ MOODLE_URL: 'https://moodle.example.edu/portal' });
  assert.equal(ctx.moodleAllowedHost('moodle.example.edu'), true);
  assert.equal(ctx.moodleAllowedHost('sub.moodle.example.edu'), true);
});

test('storage.js normText folds superscripts, subscripts, and moodle-asset URLs', () => {
  const { ctx } = loadScripts(['config.js', 'storage.js']);
  assert.equal(ctx.normText('What is 2³ + 10₂?'), 'what is 23 102');
  const token = ctx.moodleAssetToken('https://lms.amaes.com/2612/pluginfile.php/999/question/questiontext/42/1/diagram%20A.png?forcedownload=1');
  assert.equal(token, '[moodle-asset:diagram A.png]');
  assert.equal(
    ctx.normText('See https://lms.amaes.com/2612/pluginfile.php/123/question/questiontext/5/chart.png'),
    ctx.normText('See [moodle-asset:chart.png]')
  );
});

test('storage.js inverted token index finds fuzzy matches and respects verified precedence', async () => {
  const { ctx } = loadScripts(['config.js', 'storage.js']);
  await ctx.answerKeyPut('Which protocol translates domain names into IP addresses?', 'UDP', 'harvested-amauoed', { verified: false });
  await ctx.answerKeyPut('Which protocol translates domain names into IP addresses?', 'DNS', 'learned-review', { verified: true });

  const hits = await ctx.answerKeyGet('Which protocol translates domain names into IP addresses?');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].answer, 'DNS');
  assert.equal(hits[0].verified, true);

  // Slightly rephrased question should hit via inverted token index.
  const fuzzy = await ctx.answerKeyFindFuzzy('Which protocol translates domain names to IP addresses?', 0.80);
  assert.ok(fuzzy);
  assert.equal(fuzzy.entry[1][0].answer, 'DNS');

  const search = await ctx.answerKeySearch('domain names', 10);
  assert.equal(search.length, 1);
  assert.equal(search[0].hits[0].answer, 'DNS');
});

test('storage.js encodeGitHubPath preserves slashes and gitHubPutJson re-merges on 409 conflict', async () => {
  let putCalls = 0;
  let lastPutBody = null;
  const mockFetch = async (url, init = {}) => {
    if (!init.method || init.method === 'GET') {
      assert.ok(url.includes('/contents/nested/dir/bank.json'), `Unexpected URL: ${url}`);
      const remoteJson = { questions: { 'remote q': [2, [{ question: 'remote q', answer: 'RemoteA', verified: true }]] } };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          sha: 'sha-v2',
          size: 100,
          encoding: 'base64',
          content: Buffer.from(JSON.stringify(remoteJson), 'utf8').toString('base64'),
        }),
      };
    }
    if (init.method === 'PUT') {
      putCalls += 1;
      lastPutBody = JSON.parse(init.body);
      if (putCalls === 1) {
        return { ok: false, status: 409, text: async () => JSON.stringify({ message: 'conflict' }) };
      }
      return { ok: true, status: 200, text: async () => '{}' };
    }
    throw new Error('Unexpected fetch');
  };

  const { ctx } = loadScripts(['config.js', 'storage.js'], { fetch: mockFetch });
  assert.equal(ctx.encodeGitHubPath('nested/dir/bank.json'), 'nested/dir/bank.json');

  const initial = { questions: { 'local q': [1, [{ question: 'local q', answer: 'LocalA', verified: true }]] } };
  const result = await ctx.gitHubPutJson(
    'owner',
    'repo',
    'nested/dir/bank.json',
    'tok',
    initial,
    'sync',
    'sha-v1',
    async (latestMeta) => ({
      questions: { ...latestMeta.content.questions, ...initial.questions },
    })
  );

  assert.equal(result.ok, true);
  assert.equal(putCalls, 2);
  assert.equal(lastPutBody.sha, 'sha-v2');
  const uploaded = JSON.parse(Buffer.from(lastPutBody.content, 'base64').toString('utf8'));
  assert.ok(uploaded.questions['remote q'], 'Remote question must survive 409 retry');
  assert.ok(uploaded.questions['local q'], 'Local question must survive 409 retry');
});
