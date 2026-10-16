import http from 'node:http';
import { cases } from './teaching/cases.js';
import { learningLibrary, teacherRoles, replyToStudent, buildTextReview, teachingVersion } from './teaching/engine.js';
import { randomInt, randomUUID, createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { promises as fs, createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const accessCode = process.env.DEMO_ACCESS_CODE || '';
if (process.env.REQUIRE_ACCESS_CODE === '1' && accessCode.length < 16) throw new Error('部署必须设置至少 16 字符的 DEMO_ACCESS_CODE');
const digest = value => createHash('sha256').update(value).digest();
const equal = (a, b) => timingSafeEqual(digest(a), digest(b));
const accessCookie = accessCode ? createHmac('sha256', accessCode).update('casework-demo-access-v1').digest('hex') : '';
const accessAttempts = new Map();
const accessPage = '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>知遇 · 体验访问</title><body><main><h1>知遇 · 受保护的体验站</h1><p>请输入站点管理员提供的体验口令。仅使用虚构身份和练习视频。</p><form action="/access" method="post"><label for="code">体验口令</label><input id="code" name="code" type="password" required maxlength="256" autocomplete="current-password"><button type="submit">进入体验站</button></form><p>这不是正式教学平台，未接入真实 AI 和手机号认证。</p></main></body></html>';
const root = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(process.env.DATA_DIR || path.join(root, '.data'));
await fs.mkdir(path.join(dataDir, 'videos'), { recursive: true });
let db;
try { db = JSON.parse(await fs.readFile(path.join(dataDir, 'db.json'), 'utf8')); }
catch (e) { if (e.code !== 'ENOENT') throw e; db = { users: [], sessions: [], tokens: {} }; }
let writes = Promise.resolve();
const save = () => { const snapshot = JSON.stringify(db); writes = writes.then(async () => { await fs.writeFile(path.join(dataDir, 'db.tmp'), snapshot); await fs.rename(path.join(dataDir, 'db.tmp'), path.join(dataDir, 'db.json')); }); return writes; };
const publicCase = ({ replies, opening, ...rest }) => rest;

const fail = (status, message) => Object.assign(new Error(message), { status });
const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
async function body(req, max = 100_000) { const chunks = []; let size = 0; for await (const chunk of req) { size += chunk.length; if (size > max) throw fail(413, '内容过大'); chunks.push(chunk); } try { return JSON.parse(Buffer.concat(chunks).toString()); } catch { throw fail(400, '请求格式错误'); } }
function auth(req) { const token = req.headers.authorization?.replace(/^Bearer /, ''); const item = db.tokens[token]; if (!item || item.expires < Date.now()) throw fail(401, '请重新登录'); return db.users.find(u => u.id === item.userId); }
function ownSession(id, user) { const s = db.sessions.find(s => s.id === id); if (!s || (s.userId !== user.id && user.role !== 'teacher')) throw fail(404, '实训记录不存在'); return s; }
function editable(s) { if (s.status === 'completed') throw fail(409, '已完成的实训不可修改，请开始新的练习'); }
function elapsed(s) { return Math.floor((Date.now() - s.startedAt) / 1000); }
function feedback(s) {
  return { mode: 'textbook-rules', version: teachingVersion,
    language: { stars: null, status: '教材规则复盘 · 待教师评价', evidence: '', note: '请查看下方文字会谈复盘，对照案主原话、学生回应和章节依据。规则线索不代表已掌握相应技巧。' },
    voice: { stars: null, status: '待接入音频分析', note: '当前版本未分析声音，不生成星级。可练习清晰表达、适当停顿和自然的语速。' },
    expression: { stars: null, status: '待接入视频分析', note: '当前版本未分析表情，不生成星级。关注自然、与情境相符的表达，不要求一直微笑。' },
    summary: '以下为练习反馈。文字部分依据教材相关章节的教学转述，由规则识别表达线索，需教师复核；声音与表情未分析，不计入课程成绩。' };
}
function sessionView(s) {
  return { ...s, textReview: ['upload', 'feedback', 'completed'].includes(s.status) ? (s.textReview || buildTextReview(s)) : null };
}

const server = http.createServer(async (req, res) => {
  try {
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'same-origin');
    const url = new URL(req.url, 'http://localhost'); const p = url.pathname;
    if (p === '/api/health') return json(res, 200, { ok: true, mode: 'demo', teachingVersion });
    if (accessCode) {
      const cookie = (req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith('practice-access='))?.slice(16) || '';
      if (p === '/access' && req.method === 'POST') {
        const ip = req.socket.remoteAddress || 'unknown'; const now = Date.now();
        for (const [key, value] of accessAttempts) if (now - value.at > 60000) accessAttempts.delete(key);
        const attempt = accessAttempts.get(ip) || { at: now, count: 0 }; attempt.count++; accessAttempts.set(ip, attempt);
        if (attempt.count > 10) throw fail(429, '尝试过于频繁，请一分钟后重试');
        const chunks = []; let size = 0;
        for await (const chunk of req) { size += chunk.length; if (size > 2048) throw fail(413, '输入过长'); chunks.push(chunk); }
        const code = new URLSearchParams(Buffer.concat(chunks).toString()).get('code') || '';
        if (!equal(code, accessCode)) throw fail(403, '体验口令不正确，请返回后重新输入');
        res.writeHead(303, { Location: '/', 'Cache-Control': 'no-store', 'Set-Cookie': `practice-access=${accessCookie}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400${process.env.COOKIE_SECURE === '1' ? '; Secure' : ''}` }); return res.end();
      }
      if (!equal(cookie, accessCookie)) {
        if (p.startsWith('/api/')) throw fail(403, '请先打开站点首页，输入体验口令');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'" }); return res.end(accessPage);
      }
    }
    if (p === '/api/login' && req.method === 'POST') {
      const { role, name } = await body(req);
      if (!['student', 'teacher'].includes(role)) throw fail(400, '请选择身份');
      if (typeof name !== 'string' || !name.trim() || name.length > 30) throw fail(400, '请输入 1—30 字的姓名');
      const user = { id: randomUUID(), role, name: name.trim() }; db.users.push(user);
      const token = randomUUID(); db.tokens[token] = { userId: user.id, expires: Date.now() + 7 * 86400000 }; await save();
      return json(res, 200, { token, user, demo: true });
    }
    if (p.startsWith('/api/')) {
      const user = auth(req);
      if (p === '/api/learning' && req.method === 'GET') return json(res, 200, { ...learningLibrary, roleGuides: user.role === 'teacher' ? teacherRoles() : undefined });
      if (p === '/api/me') return json(res, 200, user);
      if (p === '/api/logout' && req.method === 'POST') { delete db.tokens[req.headers.authorization.replace(/^Bearer /, '')]; await save(); return json(res, 200, { ok: true }); }
      if (p === '/api/sessions' && req.method === 'GET') return json(res, 200, db.sessions.filter(s => user.role === 'teacher' || s.userId === user.id).map(s => ({ ...sessionView(s), studentName: db.users.find(u => u.id === s.userId)?.name || '学生' })));
      if (p === '/api/sessions' && req.method === 'POST') {
        if (user.role !== 'student') throw fail(403, '请使用学生身份开始实训');
        const c = cases[randomInt(cases.length)]; const s = { id: randomUUID(), userId: user.id, case: publicCase(c), createdAt: Date.now(), startedAt: null, status: 'drawn', teachingVersion, dialogueEngine: 'scripted-rules', messages: [], video: null, feedback: null, reflection: '', teacherNote: '' };
        db.sessions.push(s); await save(); return json(res, 201, s);
      }
      if (p === '/api/export' && req.method === 'GET') {
        if (user.role !== 'teacher') throw fail(403, '仅教师可导出');
        const cell = v => '"' + String(v ?? '').replace(/^[=+@\-\t\r]/, "'$&").replaceAll('"', '""') + '"';
        const rows = [['学生', '案例', '状态', '实训时间', '学生感受', '教师点评', '文字规则复盘', '教材章节依据'], ...db.sessions.map(s => [db.users.find(u => u.id === s.userId)?.name, s.case.id + ' · ' + s.case.name, s.status, new Date(s.createdAt).toISOString(), s.reflection, s.teacherNote, ['upload', 'feedback', 'completed'].includes(s.status) ? sessionView(s).textReview.observations.map(o => `${o.title}：${o.evidence.map(e => `第${e.turn}次回应「${e.quote}」`).join('；')}；${o.action}`).join('\n') : '', ['upload', 'feedback', 'completed'].includes(s.status) ? [...new Set(sessionView(s).textReview.observations.flatMap(o => o.references.map(r => r.source)))].join('；') : ''])];
        res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="practice-feedback.csv"' }); return res.end('\ufeff' + rows.map(r => r.map(cell).join(',')).join('\r\n'));
      }
      const match = p.match(/^\/api\/sessions\/([a-f0-9-]+)(?:\/(start|chat|finish|video|reflection|note))?$/);
      if (match) {
        const s = ownSession(match[1], user); const action = match[2];
        if (!action && req.method === 'GET') return json(res, 200, sessionView(s));
        if (action === 'video' && req.method === 'GET') {
          if (!s.video) throw fail(404, '尚未上传视频');
          const file = path.join(dataDir, 'videos', s.video.file); const stat = await fs.stat(file);
          let start = 0, end = stat.size - 1, status = 200;
          if (req.headers.range) { const m = req.headers.range.match(/^bytes=(\d+)-(\d*)$/); if (!m) throw fail(416, '不支持此范围'); start = Number(m[1]); end = m[2] ? Math.min(Number(m[2]), end) : end; if (start > end) throw fail(416, '范围无效'); status = 206; res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`); }
          res.writeHead(status, { 'Content-Type': s.video.type, 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' }); return createReadStream(file, { start, end }).pipe(res);
        }
        if (action === 'note' && req.method === 'POST') {
          if (user.role !== 'teacher') throw fail(403, '仅教师可点评'); const { note } = await body(req); if (typeof note !== 'string' || note.length > 3000) throw fail(400, '点评限 3000 字'); s.teacherNote = note; await save(); return json(res, 200, sessionView(s));
        }
        if (s.userId !== user.id || user.role !== 'student') throw fail(403, '无权修改此记录');
        editable(s);
        if (action === 'start' && req.method === 'POST') {
          if (!s.startedAt) { s.startedAt = Date.now(); s.status = 'chatting'; s.messages.push({ role: 'client', text: cases.find(c => c.id === s.case.id).opening, at: Date.now() }); await save(); } return json(res, 200, sessionView(s));
        }
        if (action === 'chat' && req.method === 'POST') {
          if (s.status !== 'chatting') throw fail(409, '请先开始会谈'); if (elapsed(s) >= 300) throw fail(409, '会谈已达 5 分钟，请结束会谈');
          const { text } = await body(req); if (typeof text !== 'string' || !text.trim() || text.length > 1000) throw fail(400, '请输入 1—1000 字的回应');
          const reply = replyToStudent({ caseId: s.case.id, text: text.trim(), messages: s.messages });
          s.messages.push({ role: 'student', text: text.trim(), at: Date.now() });
          s.messages.push({ role: 'client', ...reply, at: Date.now() }); await save(); return json(res, 200, sessionView(s));
        }
        if (action === 'finish' && req.method === 'POST') {
          if (s.status !== 'chatting') throw fail(409, '当前不在会谈阶段'); if (elapsed(s) < 180) throw fail(400, '会谈至少需要 3 分钟'); if (!s.messages.some(m => m.role === 'student')) throw fail(400, '请至少完成一次会谈回应');
          s.status = 'upload'; s.finishedAt = Date.now(); s.textReview = buildTextReview(s); await save(); return json(res, 200, sessionView(s));
        }
        if (action === 'video' && req.method === 'POST') {
          if (!['upload', 'feedback'].includes(s.status)) throw fail(409, '请先完成文字会谈');
          const type = req.headers['content-type']?.split(';')[0]; if (!['video/mp4', 'video/webm', 'video/quicktime'].includes(type)) throw fail(400, '支持 MP4、WebM 和 MOV 视频');
          const duration = Number(url.searchParams.get('duration')); if (!Number.isFinite(duration) || duration < 180 || duration > 300) throw fail(400, '视频须为 3—5 分钟');
          const file = randomUUID(); const dest = path.join(dataDir, 'videos', file); const handle = await fs.open(dest, 'wx'); let size = 0; let head = Buffer.alloc(0);
          try { for await (const chunk of req) { size += chunk.length; if (size > 200 * 1024 * 1024) throw fail(413, '视频不能超过 200 MB'); if (head.length < 16) head = Buffer.concat([head, chunk]).subarray(0, 16); await handle.write(chunk); } if (size < 16 || !(head.subarray(4,8).toString() === 'ftyp' || head.subarray(0,4).toString('hex') === '1a45dfa3')) throw fail(400, '无法识别视频文件'); } catch (e) { await handle.close(); await fs.unlink(dest).catch(() => {}); throw e; }
          await handle.close(); const previous = s.video; s.video = { file, type, size, duration, uploadedAt: Date.now() }; s.feedback = feedback(s); s.status = 'feedback'; await save(); if (previous) await fs.unlink(path.join(dataDir, 'videos', previous.file)).catch(() => {}); return json(res, 200, sessionView(s));
        }
        if (action === 'reflection' && req.method === 'POST') {
          if (s.status !== 'feedback') throw fail(409, '请先上传演练视频'); const { text } = await body(req); if (typeof text !== 'string' || [...text.replace(/\s/g, '')].length < 300 || text.length > 10000) throw fail(400, '感受反馈须为 300—10000 字（不含空白）'); s.reflection = text.trim(); s.status = 'completed'; s.completedAt = Date.now(); await save(); return json(res, 200, sessionView(s));
        }
      }
      throw fail(404, '接口不存在');
    }
    if (!['GET', 'HEAD'].includes(req.method)) throw fail(405, '不支持此操作');
    const allowed = { '/': 'index.html', '/app.js': 'app.js', '/styles.css': 'styles.css' }; const filename = allowed[p]; if (!filename) throw fail(404, '页面不存在');
    const content = await fs.readFile(path.join(root, 'public', filename)); const type = filename.endsWith('.js') ? 'text/javascript' : filename.endsWith('.css') ? 'text/css' : 'text/html';
    res.writeHead(200, { 'Content-Type': type + '; charset=utf-8', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; media-src 'self' blob:; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'" }); res.end(req.method === 'HEAD' ? undefined : content);
  } catch (e) { if (!res.headersSent) json(res, e.status || 500, { error: e.status ? e.message : '服务器处理失败，请稍后重试' }); else res.end(); if (!e.status) console.error(e); }
});
server.listen(Number(process.env.PORT || 3000), process.env.HOST || '127.0.0.1', () => console.log(`个案实训演示服务已启动，端口 ${server.address().port}`));
