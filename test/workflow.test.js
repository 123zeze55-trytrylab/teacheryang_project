import { fixtureEnvironment, provisionLogin } from '../testing/fixtures.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';

const dir = await mkdtemp(path.join(tmpdir(), 'casework-test-'));
let server, base;
async function start(extraEnv = {}) {
  server = spawn(process.execPath, ['server.js'], { env: { ...process.env, ...fixtureEnvironment, PORT: '0', DATA_DIR: dir, ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error('Server startup timeout: ' + log)), 10000);
    server.stdout.on('data', chunk => { log += chunk; const m = log.match(/端口 (\d+)/); if (m) { base = 'http://127.0.0.1:' + m[1]; clearTimeout(timeout); resolve(); } });
    server.once('exit', code => { clearTimeout(timeout); reject(Error('Server exited: ' + code)); });
    server.stderr.on('data', chunk => { log += chunk; });
  });
}
async function stop() { if (server && server.exitCode === null) { server.kill(); await once(server, 'exit'); } }
async function request(route, token, method = 'GET', body, headers = {}) {
  if(route==='/login'&&body?.name&&!body.username){const r=await provisionLogin(base,body);return {...r,status:200};}
  const r = await fetch(base + '/api' + route, { method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body instanceof Uint8Array ? body : body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: (r.headers.get('content-type') || '').includes('application/json') ? await r.json() : await r.text(), headers: r.headers };
}

test('student practice, persistence, video, reflection, teacher review and authorization', async t => {
  try {
    await start();
    let student, other, teacher, session;
    await t.test('static app and public health work; data and unauthenticated records are protected', async () => {
      const r = await fetch(base); assert.equal(r.status, 200); assert.match(await r.text(), /知遇/);
      assert.equal((await request('/health')).data.mode, 'trial');
      assert.equal((await request('/sessions')).status, 401);
      assert.equal((await request('/learning')).status, 401);
      assert.equal((await fetch(base + '/.data/db.json')).status, 404);
    });
    await t.test('demo identities and uniform secure random case selection', async () => {
      student = (await request('/login', null, 'POST', { role: 'student', name: '练习学生' })).data;
      other = (await request('/login', null, 'POST', { role: 'student', name: '其他学生' })).data;
      teacher = (await request('/login', null, 'POST', { role: 'teacher', name: '演示教师' })).data;
      const r = await request('/sessions', student.token, 'POST'); assert.equal(r.status, 201); session = r.data;
      assert.ok(['A', 'B', 'C', 'D', 'E'].includes(session.case.id)); assert.equal(session.case.goals.length, 2); assert.equal(session.case.replies, undefined);
      assert.equal((await request('/sessions', teacher.token, 'POST')).status, 403);
      assert.equal((await request('/sessions/' + session.id, other.token)).status, 404);
      assert.equal((await request('/sessions', other.token)).data.length, 0);
      assert.equal((await request('/export', student.token)).status, 403);
      const studentLearning = (await request('/learning', student.token)).data;
      assert.equal(studentLearning.cards.length, 10); assert.equal(studentLearning.roleGuides, undefined);
      const teacherLearning = (await request('/learning', teacher.token)).data;
      assert.equal(teacherLearning.roleGuides.length, 5);
      assert.equal(session.case.opening, undefined); assert.equal(session.textReview, undefined);
    });
    await t.test('chat persists, rejects empty messages and premature completion', async () => {
      session = (await request(`/sessions/${session.id}/start`, student.token, 'POST')).data;
      assert.equal(session.messages.length, 1);
      assert.equal((await request(`/sessions/${session.id}/chat`, student.token, 'POST', { text: '' })).status, 400);
      session = (await request(`/sessions/${session.id}/chat`, student.token, 'POST', { text: '听起来，你一方面担心家人，一方面也感到不容易。我的理解准确吗？' })).data;
      assert.equal(session.messages.length, 3);
      assert.equal((await request(`/sessions/${session.id}/finish`, student.token, 'POST')).status, 400);
      assert.equal((await request(`/sessions/${session.id}/reflection`, student.token, 'POST', { text: '练'.repeat(300) })).status, 409);
    });
    await t.test('restart retains identity and transcript; elapsed time permits next step', async () => {
      await stop();
      const dbPath = path.join(dir, 'db.json'); const db = JSON.parse(await readFile(dbPath));
      db.sessions.find(s => s.id === session.id).startedAt = Date.now() - 181000;
      await writeFile(dbPath, JSON.stringify(db)); await start();
      assert.equal((await request('/me', student.token)).data.name, '练习学生');
      assert.equal((await request('/sessions/' + session.id, student.token)).data.messages.length, 3);
      const r = await request(`/sessions/${session.id}/finish`, student.token, 'POST'); assert.equal(r.status, 200); assert.equal(r.data.status, 'upload');
      assert.equal(r.data.textReview.mode, 'textbook-rules');
      assert.equal(r.data.textReview.observations.find(o => o.id === 'empathy').evidence[0].quote, '听起来，你一方面担心家人，一方面也感到不容易。我的理解准确吗？');
      assert.ok(r.data.textReview.observations.flatMap(o => o.references).some(r => r.id === 'empathy'));
    });
    await t.test('upload duration, content signature and access checks; no invented scores', async () => {
      const fake = Buffer.from('this is not a real video file');
      assert.equal((await request(`/sessions/${session.id}/video?duration=50`, student.token, 'POST', fake, { 'Content-Type': 'video/mp4' })).status, 400);
      assert.equal((await request(`/sessions/${session.id}/video?duration=200`, student.token, 'POST', fake, { 'Content-Type': 'video/mp4' })).status, 400);
      // A minimal container fixture exercises storage, not codec decoding (browser smoke uses a real video).
      const fixture = Buffer.from('00000018667479706d703432000000006d70343269736f6d', 'hex');
      const r = await request(`/sessions/${session.id}/video?duration=200`, student.token, 'POST', fixture, { 'Content-Type': 'video/mp4' });
      assert.equal(r.status, 200); assert.equal(r.data.status, 'feedback');
      for (const key of ['language', 'voice', 'expression']) assert.equal(r.data.feedback[key].stars, null);
      assert.equal((await request(`/sessions/${session.id}/video`, other.token)).status, 404);
      assert.equal((await request(`/sessions/${session.id}/video`, teacher.token)).status, 200);
      const range = await request(`/sessions/${session.id}/video`, student.token, 'GET', undefined, { Range: 'bytes=0-7' }); assert.equal(range.status, 206); assert.equal(range.headers.get('content-length'), '8');
    });
    await t.test('reflection minimum, final state, teacher note, and CSV export', async () => {
      assert.equal((await request(`/sessions/${session.id}/reflection`, student.token, 'POST', { text: '字 '.repeat(299) })).status, 400);
      const r = await request(`/sessions/${session.id}/reflection`, student.token, 'POST', { text: '练习倾听与回应'.repeat(50) }); assert.equal(r.status, 200); assert.equal(r.data.status, 'completed');
      assert.equal((await request(`/sessions/${session.id}/chat`, student.token, 'POST', { text: '继续' })).status, 409);
      assert.equal((await request(`/sessions/${session.id}/note`, student.token, 'POST', { note: '冒充教师' })).status, 403);
      assert.equal((await request(`/sessions/${session.id}/note`, teacher.token, 'POST', { note: '尝试具体回应案主的矛盾感受。' })).status, 200);
      assert.equal((await request('/sessions/' + session.id, student.token)).data.teacherNote, '尝试具体回应案主的矛盾感受。');
      const csv = await request('/export', teacher.token); assert.equal(csv.status, 200); assert.match(csv.data, /练习学生/); assert.match(csv.data, /尝试具体回应/); assert.match(csv.data, /教材章节依据/); assert.match(csv.data, /第四章/);
      assert.equal((await request('/logout', student.token, 'POST')).status, 200);
      assert.equal((await request('/me', student.token)).status, 401);
    });
    await t.test('legacy completed records get supplemental citations without altering original data', async () => {
      await stop();
      const dbPath = path.join(dir, 'db.json'); const original = JSON.parse(await readFile(dbPath));
      const legacy = structuredClone(original.sessions[0]);
      legacy.id = '00000000-0000-4000-8000-000000000001';
      delete legacy.textReview; delete legacy.teachingVersion; delete legacy.dialogueEngine;
      legacy.feedback = { mode: 'demo', language: { stars: null, note: '历史文字反馈' }, voice: { stars: null }, expression: { stars: null } };
      original.sessions.push(legacy); await writeFile(dbPath, JSON.stringify(original)); await start();
      const before = await readFile(dbPath, 'utf8');
      const r = await request('/sessions/' + legacy.id, teacher.token);
      assert.equal(r.status, 200); assert.equal(r.data.textReview.mode, 'textbook-rules');
      assert.deepEqual(r.data.feedback, legacy.feedback); assert.deepEqual(r.data.messages, legacy.messages);
      assert.equal(r.data.reflection, legacy.reflection); assert.equal(r.data.teacherNote, legacy.teacherNote);
      assert.equal(await readFile(dbPath, 'utf8'), before);
    });
  } finally { await stop(); await rm(dir, { recursive: true, force: true }); }
});


test('hosted demo gate protects app and API, permits cookie plus bearer login', async () => {
  try {
    const { randomUUID } = await import('node:crypto');
    const code = randomUUID();
    await start({ DEMO_ACCESS_CODE: code, REQUIRE_ACCESS_CODE: '1', COOKIE_SECURE: '1' });
    assert.equal((await request('/health')).status, 200);
    assert.match(await (await fetch(base)).text(), /受保护的体验站/);
    assert.equal((await request('/login', null, 'POST', { role: 'teacher', username: 'blocked', password: 'invalid-password' })).status, 403);
    const wrong = await fetch(base + '/access', { method: 'POST', body: new URLSearchParams({ code: 'wrong' }), redirect: 'manual' });
    assert.equal(wrong.status, 403);
    const admitted = await fetch(base + '/access', { method: 'POST', body: new URLSearchParams({ code }), redirect: 'manual' });
    assert.equal(admitted.status, 303);
    const setCookie = admitted.headers.get('set-cookie');
    assert.match(setCookie, /HttpOnly/); assert.match(setCookie, /Secure/); assert.match(setCookie, /SameSite=Strict/);
    const cookie = setCookie.split(';')[0];
    assert.doesNotMatch(await (await fetch(base, { headers: { Cookie: cookie } })).text(), /受保护的体验站/);
    const login = await request('/login', null, 'POST', { role: 'admin', username: 'admin', password: fixtureEnvironment.ADMIN_PASSWORD }, { Cookie: cookie });
    assert.equal(login.status, 200);
    assert.equal((await request('/sessions', login.data.token, 'GET', undefined, { Cookie: cookie })).status, 200);
    assert.equal((await request('/sessions', login.data.token)).status, 403);
  } finally { await stop(); await rm(dir, { recursive: true, force: true }); }
});
