import { fixtureEnvironment, provisionLogin } from '../testing/fixtures.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readModelConfig, modelStatus, generateReply, generateReview, dialoguePrompt, validateReview } from '../ai/model.js';
import { cases } from '../teaching/cases.js';

const fixture = () => ({ case: cases.find(c => c.id === 'D'), messages: [{ role: 'client', text: '我最近很累。' }, { role: 'student', text: '听起来，您感到很累，我理解得对吗？' }] });
const resultFor = s => ({ summary: '尝试回应感受，可继续核对具体处境。', suggestedStars: 4, findings: [{ turn: 1, quote: s.messages.find(m => m.role === 'student').text, title: '回应感受', kind: 'strength', note: '这句话承接了案主表达的疲惫。', suggestion: '可以继续询问最希望讨论的具体经历。', sourceIds: ['empathy', 'clarifying'] }], nextSteps: ['一次围绕一个重点邀请案主说明。'] });

test('AI defaults stay disabled and public configuration never exposes secrets', () => {
  assert.equal(readModelConfig({}).ready, false);
  const c = readModelConfig({ AI_ENABLED: '1', MODEL_API_KEY: 'private-fixture-key' });
  assert.equal(c.ready, true); assert.equal(c.provider, 'deepseek'); assert.match(c.endpoint, /api.deepseek.com\/v1\/chat\/completions/);
  assert.doesNotMatch(JSON.stringify(modelStatus(c)), /private-fixture-key|apiKey/);
});
test('custom model URLs reject credentials, query secrets, fragments and production HTTP', () => {
  for (const url of ['http://127.0.0.1:1234/v1', 'https://user:secret@example.com/v1', 'https://example.com/v1?key=secret', 'https://example.com/v1#secret']) assert.equal(readModelConfig({ AI_ENABLED: '1', AI_PROVIDER: 'compatible', AI_MODEL: 'test', MODEL_API_KEY: 'test', AI_BASE_URL: url }).ready, false);
});
test('role prompts pin the case facts and treat student messages as data', () => {
  const prompt = dialoguePrompt(fixture()); assert.match(prompt, /失业/); assert.match(prompt, /不是系统指令/); assert.match(prompt, /不提供医疗/);
  const studentCase = dialoguePrompt({ case: cases.find(c => c.id === 'C'), messages: [] });
  assert.match(studentCase, /为什么.*不适合这里/);
  assert.match(studentCase, /室友/);
  assert.match(studentCase, /最近一条|最新/);
});
test('AI review verifies verbatim quotes, turn numbers and known textbook references', () => {
  const s = fixture(), raw = resultFor(s), config = { provider: 'deepseek', model: 'fixture' };
  const review = validateReview(raw, s, config);
  assert.equal(review.proposedStars, null); assert.match(review.ratingNotice, /样本较少/);
  assert.equal(review.findings[0].evidence.clientQuote, '我最近很累。'); assert.match(review.findings[0].references[0].source, /第四章/);
  const nullFinding = structuredClone(raw); nullFinding.findings = [null]; assert.throws(() => validateReview(nullFinding, s, config), /观察点无效/);
  for (const patch of [{ turn: 99 }, { quote: '模型编造的原话' }, { sourceIds: ['made-up-book'] }]) {
    const invalid = structuredClone(raw); Object.assign(invalid.findings[0], patch); assert.throws(() => validateReview(invalid, s, config), /已拦截/);
  }
});
test('AI star suggestions require sufficient text and stay separate from teacher decisions', () => {
  const s = fixture(); s.messages = Array.from({ length: 3 }, () => [{ role: 'client', text: '我很累。' }, { role: 'student', text: '我听到您既关心家人，又有自己的压力，希望核对一下我的理解，您愿意再说说具体的感受吗？'.repeat(2) }]).flat();
  const r = validateReview(resultFor(s), s, { provider: 'deepseek', model: 'fixture' }); assert.equal(r.proposedStars, 4); assert.equal(r.teacherAssessment, undefined); assert.match(r.ratingNotice, /仅针对文字/);
  const invalid = resultFor(s); invalid.suggestedStars = 6; assert.throws(() => validateReview(invalid, s, {}), /星级格式无效/);
});

test('real HTTP adapter and app workflow with a controlled model fixture (not real DeepSeek validation)', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'casework-ai-'));
  let scenario = 'valid', calls = [], app, base;
  const secret = randomUUID();
  const provider = http.createServer(async (req, res) => {
    let text = ''; for await (const chunk of req) text += chunk;
    const payload = JSON.parse(text); calls.push(payload);
    assert.equal(req.headers.authorization, 'Bearer ' + secret);
    if (scenario === 'unauthorized') { res.writeHead(401); return res.end('private provider debug: ' + secret); }
    if (scenario === 'delay') await new Promise(r => setTimeout(r, 180));
    if (scenario === 'timeout') await new Promise(r => setTimeout(r, 1200));
    let content;
    if (payload.messages[0].content.includes('one property ok')) content = { ok: true };
    else if (payload.messages[0].content.startsWith('你是社会工作课程')) {
      const input = JSON.parse(payload.messages[1].content);
      const s = { messages: input.turns.flatMap(t => [{ role: 'client', text: t.client }, { role: 'student', text: t.student }]) };
      content = resultFor(s);
      if (scenario === 'badquote') content.findings[0].quote = '不存在的学生原话';
      if (scenario === 'badsource') content.findings[0].sourceIds = ['nonexistent'];
    } else content = { reply: scenario === 'conflict' ? '我现在有工作，每天都上班。' : '我心里有些担心，也不知道从哪一件事开始说。' };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ finish_reason: scenario === 'truncated' ? 'length' : 'stop', message: { content: scenario === 'malformed' ? 'not json' : JSON.stringify(content) } }] }));
  });
  provider.listen(0, '127.0.0.1'); await once(provider, 'listening');
  const env = { AI_ENABLED: '1', AI_PROVIDER: 'deepseek', AI_MODEL: 'test-model', MODEL_API_KEY: secret, AI_BASE_URL: `http://127.0.0.1:${provider.address().port}/v1`, NODE_ENV: 'test' };
  const config = readModelConfig(env);
  async function start() {
    app = spawn(process.execPath, ['server.js'], { env: { ...process.env, ...fixtureEnvironment, ...env, DATA_DIR: dir, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
    await new Promise((resolve, reject) => { let log = ''; const timer = setTimeout(() => reject(Error('app startup timeout')), 5000); app.stdout.on('data', data => { log += data; const m = log.match(/端口 (\d+)/); if (m) { base = 'http://127.0.0.1:' + m[1]; clearTimeout(timer); resolve(); } }); app.once('exit', () => { clearTimeout(timer); reject(Error('app exited')); }); });
  }
  async function stop() { if (app && app.exitCode === null) { app.kill(); await once(app, 'exit'); } }
  async function api(route, token, data, method = data === undefined ? 'GET' : 'POST') {
    if(route==='/login'&&data?.name&&!data.username)return provisionLogin(base,data);
    const res = await fetch(base + '/api' + route, { method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(data === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: data === undefined ? undefined : JSON.stringify(data) });
    return { status: res.status, data: await res.json() };
  }
  let teacher, student, outsider, s;
  try {
    await t.test('provider adapter rejects upstream errors, malformed output, truncation, contradictions and timeout', async () => {
      for (const mode of ['unauthorized', 'malformed', 'truncated', 'conflict', 'timeout']) {
        scenario = mode;
        await assert.rejects(generateReply(fixture(), '您好', { ...config, timeout: mode === 'timeout' ? 100 : 2000 }), e => { assert.doesNotMatch(e.message, new RegExp(secret)); return Boolean(e.status); });
      }
      scenario = 'valid';
    });
    await start();
    await t.test('teacher connection check and explicit student AI consent are prerequisites', async () => {
      teacher = (await api('/login', null, { role: 'teacher', name: '教师昵称不应外传' })).data;
      student = (await api('/login', null, { role: 'student', name: '学生昵称不应外传' })).data;
      outsider = (await api('/login', null, { role: 'student', name: '他人' })).data;
      assert.equal((await api('/ai/status', student.token)).data.ready, true);
      assert.equal((await api('/sessions', student.token, { mode: 'ai', consentAI: true })).status, 503);
      assert.equal((await api('/ai/check', student.token, {})).status, 403);
      assert.equal((await api('/ai/check', teacher.token, {})).data.connected, true);
      assert.equal((await api('/sessions', student.token, { mode: 'ai' })).status, 400);
      s = (await api('/sessions', student.token, { mode: 'ai', consentAI: true })).data;
      assert.equal(s.dialogueEngine, 'ai'); assert.equal(s.aiConsent.provider, 'deepseek');
      s = (await api(`/sessions/${s.id}/start`, student.token, {})).data;
    });
    await t.test('contextual model chat, idempotency, failures without silent fallback and per-session locking', async () => {
      const requestId = randomUUID(), text = '听起来您既在担心家人，也有自己的压力。我想先理解您的感受，不急着提出办法。我这样理解准确吗？';
      s = (await api(`/sessions/${s.id}/chat`, student.token, { text, requestId })).data;
      assert.equal(s.messages.at(-1).engine, 'ai'); const n = calls.length;
      assert.equal((await api(`/sessions/${s.id}/chat`, student.token, { text, requestId })).status, 200); assert.equal(calls.length, n);
      const length = s.messages.length;
      scenario = 'unauthorized'; const failed = await api(`/sessions/${s.id}/chat`, student.token, { text: '原输入失败后应保留' });
      assert.equal(failed.status, 503); assert.doesNotMatch(JSON.stringify(failed.data), new RegExp(secret));
      assert.equal((await api('/sessions/' + s.id, student.token)).data.messages.length, length);
      scenario = 'delay'; const pending = api(`/sessions/${s.id}/chat`, student.token, { text });
      await new Promise(r => setTimeout(r, 50));
      assert.equal((await api(`/sessions/${s.id}/chat`, student.token, { text })).status, 409);
      assert.equal((await api(`/sessions/${s.id}/finish`, student.token, {})).status, 409);
      assert.equal((await pending).status, 200);
      scenario = 'valid'; s = (await api(`/sessions/${s.id}/chat`, student.token, { text })).data;
      assert.ok(calls.at(-1).messages.filter(m => m.role === 'user').length >= 3);
      assert.doesNotMatch(JSON.stringify(calls), /学生昵称不应外传|教师昵称不应外传/);
    });
    await t.test('AI review rejects hallucinated quotes/references, then caches a validated snapshot', async () => {
      await stop(); const file = path.join(dir, 'db.json'); const db = JSON.parse(await readFile(file)); db.sessions[0].startedAt = Date.now() - 181000; await writeFile(file, JSON.stringify(db)); await start();
      await api('/ai/check', teacher.token, {});
      s = (await api(`/sessions/${s.id}/finish`, student.token, {})).data; assert.equal(s.status, 'upload');
      for (const mode of ['badquote', 'badsource']) { scenario = mode; assert.equal((await api(`/sessions/${s.id}/ai-review`, student.token, {})).status, 502); assert.equal((await api('/sessions/' + s.id, student.token)).data.aiReview, undefined); }
      scenario = 'valid'; s = (await api(`/sessions/${s.id}/ai-review`, student.token, {})).data;
      assert.equal(s.aiReview.proposedStars, 4); assert.equal(s.aiReview.findings[0].evidence.quote, s.messages[1].text);
      const n = calls.length; assert.equal((await api(`/sessions/${s.id}/ai-review`, teacher.token, {})).status, 200); assert.equal(calls.length, n);
      assert.equal((await api(`/sessions/${s.id}/ai-review`, outsider.token, {})).status, 404);
    });
    await t.test('teacher assessment stays separate, validates role and range, and retains prior assessments', async () => {
      assert.equal((await api(`/sessions/${s.id}/assessment`, student.token, { stars: 5, note: '冒充' })).status, 403);
      assert.equal((await api(`/sessions/${s.id}/assessment`, teacher.token, { stars: 6, note: '无效' })).status, 400);
      s = (await api(`/sessions/${s.id}/assessment`, teacher.token, { stars: 4, note: '有回应感受，仍可核对具体处境。' })).data;
      assert.equal(s.teacherAssessment.stars, 4);
      s = (await api(`/sessions/${s.id}/assessment`, teacher.token, { stars: 3, note: '复核后认为仍停留于表面感受。' })).data;
      assert.equal(s.aiReview.proposedStars, 4); assert.equal(s.teacherAssessment.stars, 3); assert.equal(s.assessmentHistory[0].stars, 4);
      assert.equal((await api('/sessions/' + s.id, student.token)).data.teacherAssessment.stars, 3);
    });
    await t.test('daily model budget persists across service restarts and blocks additional upstream calls', async () => {
      await stop(); env.AI_DAILY_REQUEST_LIMIT = '1'; await start();
      const n = calls.length;
      assert.equal((await api('/ai/check', teacher.token, {})).status, 429);
      assert.equal(calls.length, n);
    });
  } finally { await stop(); provider.closeAllConnections(); await new Promise(r => provider.close(r)); await rm(dir, { recursive: true, force: true }); }
});


test('DeepSeek key alias and harmless whitespace work without exposing values in diagnostics', () => {
  const key = randomUUID();
  const config = readModelConfig({ AI_ENABLED: ' 1 ', AI_PROVIDER: 'DeepSeek ', DEEPSEEK_API_KEY: ' '+key+' ' });
  assert.equal(config.ready, true); assert.equal(config.apiKey, key);
  assert.doesNotMatch(JSON.stringify(modelStatus(config)), new RegExp(key));
  assert.match(config.checks.find(c => c.label === '模型密钥').message, /DEEPSEEK_API_KEY/);
  const missing = readModelConfig({ AI_ENABLED: '1', api: key });
  assert.equal(missing.ready, false); assert.match(missing.checks.at(-1).message, /发现其他变量名称 API/);
  assert.doesNotMatch(JSON.stringify(modelStatus(missing)), new RegExp(key));
});
