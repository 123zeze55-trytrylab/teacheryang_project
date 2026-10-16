import http from 'node:http';
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
export const cases = [
  { id: 'A', name: '林姐', age: 28, gender: '女', tag: '家庭暴力 · 独立生活', meeting: '第四次面谈', intro: '林姐因不愿再忍受家庭暴力，已经搬出来独自居住，正在尝试找工作、开始独立生活。', goals: ['关怀案主手部受伤康复情况', '了解案主未来规划'], opening: '手比之前好一些了。搬出来以后安静多了，可是想到要找工作、交房租，心里还是没底。', replies: ['有时候觉得自己总算走出来了，有时候又很害怕。不知道自己一个人到底行不行。', '我想找一份能养活自己的工作，可是很久没上班了，也不知道从哪里开始。', '谢谢你愿意听我说。我想先把手养好，再试着投几份简历。'] },
  { id: 'B', name: '陈先生', age: 53, gender: '男', tag: '疾病适应 · 情绪支持', meeting: '第三次面谈', intro: '陈先生离婚后独自带大儿子，因急性白血病住院治疗。长期孤身生活让他情绪低落，并对医院的一些处置感到不满。', goals: ['关怀案主即将出院的情况', '了解案主对医院存在的问题'], opening: '说是快出院了，可我一点也轻松不起来。回去就我一个人，有什么事找谁？医院有些事情也没跟我讲清楚。', replies: ['我也知道他们忙，可有时候问个问题等半天都没人来，让人觉得自己不重要。', '儿子也有自己的事，我不想总麻烦他。可说不担心，那也是假的。', '如果能有人把出院后该怎么办说清楚，我可能会踏实一点。'] },
  { id: 'C', name: '佳佳', age: 18, gender: '女', tag: '大学适应 · 压力疏解', meeting: '第一次面谈', intro: '佳佳是一名大学新生，进入新环境后感到难以适应，觉得自己格格不入，想到未来便感到压力重重。', goals: ['疏解案主情绪', '了解案主所面临的问题'], opening: '大家好像都有自己的朋友和计划，只有我不知道该做什么。我是不是根本不适合这里？', replies: ['宿舍里大家聊天我也插不上话，课上又怕回答错问题。每天都很累。', '我以前没有这么没信心。看到别人都那么厉害，就觉得自己什么也做不好。', '其实我也想交朋友，只是怕主动了以后别人不理我，那会更难受。'] },
  { id: 'D', name: '张叔', age: 56, gender: '男', tag: '家庭困境 · 照顾者支持', meeting: '第二次面谈', intro: '张叔目前失业，妻子患有精神疾病，儿子毕业后仍在找工作。一家人经济拮据，他也承受着照顾家庭的压力。', goals: ['关怀案主近来生活情况', '了解案主与家人互动情形'], opening: '还是老样子。老婆要照顾，儿子工作也没着落。我就关上门，泡泡茶，睡一下，没什么好说的。', replies: ['邻居们家里的情况都比我好，聊两句就聊不下去了。一想到家里的事，心里就不舒服。', '她有时候一听到动静就闹，我也知道她生病了，可实在忍不住的时候还是会争几句。', '儿子也不和我说话。我担心他，他又觉得我管得多，真不知道怎么办。', '（沉默了一会儿）你这么说，我心里好受点。这些年确实挺累的，有时候就觉得是自己命不好。'] },
  { id: 'E', name: '李奶奶', age: 75, gender: '女', tag: '代际冲突 · 长者关怀', meeting: '个案探访', intro: '李奶奶与儿子儿媳同住。儿子为买学区房要求老两口卖房，因意见不合发生多次争吵，儿媳曾辱骂并抓伤她。', goals: ['了解家庭成员生活状况、相处情形', '关心案主情绪和生活情况'], opening: '房子住了这么多年，怎么能说卖就卖？我们也不是不疼孙子，可总得给自己留个住的地方吧。', replies: ['现在在家里都不敢多说话。一说房子的事就吵，手上的伤还没完全好。', '都是一家人，闹成这样让外人知道多难看。可是我心里真的很委屈。', '我就是希望他们好好和我们商量，也听听我们的想法，不要再动手了。'] }
];
const publicCase = ({ replies, opening, ...rest }) => rest;
const fail = (status, message) => Object.assign(new Error(message), { status });
const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
async function body(req, max = 100_000) { const chunks = []; let size = 0; for await (const chunk of req) { size += chunk.length; if (size > max) throw fail(413, '内容过大'); chunks.push(chunk); } try { return JSON.parse(Buffer.concat(chunks).toString()); } catch { throw fail(400, '请求格式错误'); } }
function auth(req) { const token = req.headers.authorization?.replace(/^Bearer /, ''); const item = db.tokens[token]; if (!item || item.expires < Date.now()) throw fail(401, '请重新登录'); return db.users.find(u => u.id === item.userId); }
function ownSession(id, user) { const s = db.sessions.find(s => s.id === id); if (!s || (s.userId !== user.id && user.role !== 'teacher')) throw fail(404, '实训记录不存在'); return s; }
function editable(s) { if (s.status === 'completed') throw fail(409, '已完成的实训不可修改，请开始新的练习'); }
function elapsed(s) { return Math.floor((Date.now() - s.startedAt) / 1000); }
function feedback(s) {
  const messages = s.messages.filter(m => m.role === 'student').map(m => m.text);
  const evidence = messages.find(t => /感到|听起来|似乎|一方面|不容易|担心|矛盾|难过|委屈/.test(t));
  return { mode: 'demo', language: { stars: null, status: '待教师评价', evidence: evidence || messages[0] || '', note: evidence ? '这句话尝试回应案主的感受。还可以核对自己的理解，并邀请案主进一步表达。' : '可以尝试先回应案主的感受，再询问具体经历，避免过早给出建议。' }, voice: { stars: null, status: '待接入音频分析', note: '当前版本未分析声音，不生成星级。可练习清晰表达、适当停顿和自然的语速。' }, expression: { stars: null, status: '待接入视频分析', note: '当前版本未分析表情，不生成星级。建议保持自然关注，让表情与谈话情境相符。' }, summary: '这是基于文字关键词的演示提示，不是 AI 评分，也不计入课程成绩。教师可结合会谈与视频补充反馈。' };
}
const server = http.createServer(async (req, res) => {
  try {
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'same-origin');
    const url = new URL(req.url, 'http://localhost'); const p = url.pathname;
    if (p === '/api/health') return json(res, 200, { ok: true, mode: 'demo' });
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
      if (p === '/api/me') return json(res, 200, user);
      if (p === '/api/logout' && req.method === 'POST') { delete db.tokens[req.headers.authorization.replace(/^Bearer /, '')]; await save(); return json(res, 200, { ok: true }); }
      if (p === '/api/sessions' && req.method === 'GET') return json(res, 200, db.sessions.filter(s => user.role === 'teacher' || s.userId === user.id).map(s => ({ ...s, studentName: db.users.find(u => u.id === s.userId)?.name || '学生' })));
      if (p === '/api/sessions' && req.method === 'POST') {
        if (user.role !== 'student') throw fail(403, '请使用学生身份开始实训');
        const c = cases[randomInt(cases.length)]; const s = { id: randomUUID(), userId: user.id, case: publicCase(c), createdAt: Date.now(), startedAt: null, status: 'drawn', messages: [], video: null, feedback: null, reflection: '', teacherNote: '' };
        db.sessions.push(s); await save(); return json(res, 201, s);
      }
      if (p === '/api/export' && req.method === 'GET') {
        if (user.role !== 'teacher') throw fail(403, '仅教师可导出');
        const cell = v => '"' + String(v ?? '').replace(/^[=+@\-\t\r]/, "'$&").replaceAll('"', '""') + '"';
        const rows = [['学生', '案例', '状态', '实训时间', '学生感受', '教师点评'], ...db.sessions.map(s => [db.users.find(u => u.id === s.userId)?.name, s.case.id + ' · ' + s.case.name, s.status, new Date(s.createdAt).toISOString(), s.reflection, s.teacherNote])];
        res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="practice-feedback.csv"' }); return res.end('\ufeff' + rows.map(r => r.map(cell).join(',')).join('\r\n'));
      }
      const match = p.match(/^\/api\/sessions\/([a-f0-9-]+)(?:\/(start|chat|finish|video|reflection|note))?$/);
      if (match) {
        const s = ownSession(match[1], user); const action = match[2];
        if (!action && req.method === 'GET') return json(res, 200, s);
        if (action === 'video' && req.method === 'GET') {
          if (!s.video) throw fail(404, '尚未上传视频');
          const file = path.join(dataDir, 'videos', s.video.file); const stat = await fs.stat(file);
          let start = 0, end = stat.size - 1, status = 200;
          if (req.headers.range) { const m = req.headers.range.match(/^bytes=(\d+)-(\d*)$/); if (!m) throw fail(416, '不支持此范围'); start = Number(m[1]); end = m[2] ? Math.min(Number(m[2]), end) : end; if (start > end) throw fail(416, '范围无效'); status = 206; res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`); }
          res.writeHead(status, { 'Content-Type': s.video.type, 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' }); return createReadStream(file, { start, end }).pipe(res);
        }
        if (action === 'note' && req.method === 'POST') {
          if (user.role !== 'teacher') throw fail(403, '仅教师可点评'); const { note } = await body(req); if (typeof note !== 'string' || note.length > 3000) throw fail(400, '点评限 3000 字'); s.teacherNote = note; await save(); return json(res, 200, s);
        }
        if (s.userId !== user.id || user.role !== 'student') throw fail(403, '无权修改此记录');
        editable(s);
        if (action === 'start' && req.method === 'POST') {
          if (!s.startedAt) { s.startedAt = Date.now(); s.status = 'chatting'; s.messages.push({ role: 'client', text: cases.find(c => c.id === s.case.id).opening, at: Date.now() }); await save(); } return json(res, 200, s);
        }
        if (action === 'chat' && req.method === 'POST') {
          if (s.status !== 'chatting') throw fail(409, '请先开始会谈'); if (elapsed(s) >= 300) throw fail(409, '会谈已达 5 分钟，请结束会谈');
          const { text } = await body(req); if (typeof text !== 'string' || !text.trim() || text.length > 1000) throw fail(400, '请输入 1—1000 字的回应');
          const c = cases.find(c => c.id === s.case.id); const n = s.messages.filter(m => m.role === 'student').length;
          s.messages.push({ role: 'student', text: text.trim(), at: Date.now() });
          s.messages.push({ role: 'client', text: c.replies[n % c.replies.length], at: Date.now() }); await save(); return json(res, 200, s);
        }
        if (action === 'finish' && req.method === 'POST') {
          if (s.status !== 'chatting') throw fail(409, '当前不在会谈阶段'); if (elapsed(s) < 180) throw fail(400, '会谈至少需要 3 分钟'); if (!s.messages.some(m => m.role === 'student')) throw fail(400, '请至少完成一次会谈回应');
          s.status = 'upload'; s.finishedAt = Date.now(); await save(); return json(res, 200, s);
        }
        if (action === 'video' && req.method === 'POST') {
          if (!['upload', 'feedback'].includes(s.status)) throw fail(409, '请先完成文字会谈');
          const type = req.headers['content-type']?.split(';')[0]; if (!['video/mp4', 'video/webm', 'video/quicktime'].includes(type)) throw fail(400, '支持 MP4、WebM 和 MOV 视频');
          const duration = Number(url.searchParams.get('duration')); if (!Number.isFinite(duration) || duration < 180 || duration > 300) throw fail(400, '视频须为 3—5 分钟');
          const file = randomUUID(); const dest = path.join(dataDir, 'videos', file); const handle = await fs.open(dest, 'wx'); let size = 0; let head = Buffer.alloc(0);
          try { for await (const chunk of req) { size += chunk.length; if (size > 200 * 1024 * 1024) throw fail(413, '视频不能超过 200 MB'); if (head.length < 16) head = Buffer.concat([head, chunk]).subarray(0, 16); await handle.write(chunk); } if (size < 16 || !(head.subarray(4,8).toString() === 'ftyp' || head.subarray(0,4).toString('hex') === '1a45dfa3')) throw fail(400, '无法识别视频文件'); } catch (e) { await handle.close(); await fs.unlink(dest).catch(() => {}); throw e; }
          await handle.close(); const previous = s.video; s.video = { file, type, size, duration, uploadedAt: Date.now() }; s.feedback = feedback(s); s.status = 'feedback'; await save(); if (previous) await fs.unlink(path.join(dataDir, 'videos', previous.file)).catch(() => {}); return json(res, 200, s);
        }
        if (action === 'reflection' && req.method === 'POST') {
          if (s.status !== 'feedback') throw fail(409, '请先上传演练视频'); const { text } = await body(req); if (typeof text !== 'string' || [...text.replace(/\s/g, '')].length < 300 || text.length > 10000) throw fail(400, '感受反馈须为 300—10000 字（不含空白）'); s.reflection = text.trim(); s.status = 'completed'; s.completedAt = Date.now(); await save(); return json(res, 200, s);
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
