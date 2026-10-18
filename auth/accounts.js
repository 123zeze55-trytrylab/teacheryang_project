import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { promises as fs } from 'node:fs';
import path from 'node:path';
const scrypt = promisify(scryptCallback);
const error = (status, message) => Object.assign(new Error(message), { status });
const digest = x => createHash('sha256').update(String(x)).digest('hex');
const cleanId = x => typeof x === 'string' ? x.trim().toLowerCase() : '';
function validId(id) { return /^[a-z0-9][a-z0-9_-]{2,39}$/.test(id); }
function checkPassword(password) {
  if (typeof password !== 'string' || password.length < 10 || password.length > 128 || !password.trim()) throw error(400, '密码需为10—128个字符，请勿使用学号作为密码。');
}
async function passwordHash(password) {
  checkPassword(password); const salt = randomBytes(16).toString('hex');
  return 'scrypt$' + salt + '$' + Buffer.from(await scrypt(password, salt, 64)).toString('hex');
}
async function verify(password, hash) {
  const parts = (hash || '').split('$');
  const salt = parts.length === 3 ? parts[1] : 'nonexistent-account-salt';
  const actual = Buffer.from(await scrypt(typeof password === 'string' ? password.slice(0,129) : '', salt, 64));
  if (parts[0] !== 'scrypt' || !/^[a-f0-9]{128}$/.test(parts[2] || '')) return false;
  return timingSafeEqual(actual, Buffer.from(parts[2], 'hex'));
}
export const publicUser = u => ({ id: u.id, username: u.username, studentId: u.studentId || null, name: u.name, role: u.role, classIds: u.classIds || [], mustChangePassword: Boolean(u.mustChangePassword), disabled: Boolean(u.disabled), createdAt: u.createdAt });
export async function createAccounts({ db, save, dataDir, env = process.env }) {
  let queue = Promise.resolve();
  const exclusive = operation => { const result = queue.then(operation); queue = result.catch(() => {}); return result; };
  if (db.authVersion !== 2) {
    if (db.users.length || db.sessions.length) {
      const backupDir = path.join(dataDir, 'migration-backups'); await fs.mkdir(backupDir, { recursive: true, mode: 0o700 });
      await fs.writeFile(path.join(backupDir, 'before-accounts-' + randomUUID() + '.json'), JSON.stringify(db), { flag: 'wx', mode: 0o600 });
    }
    for (const user of db.users) if (!user.passwordHash) user.legacy = true;
    for (const session of db.sessions) session.classId ||= 'legacy-demo';
    db.tokens = {}; db.authVersion = 2;
    db.classes ||= []; db.roster ||= []; db.audit ||= [];
    if (!db.classes.some(c => c.id === 'legacy-demo')) db.classes.push({ id: 'legacy-demo', name: '旧演示记录（归档）', teacherIds: [], archived: true });
    await save();
  }
  db.classes ||= []; db.roster ||= []; db.audit ||= [];
  if (!db.classes.some(c => c.id === 'default')) db.classes.push({ id: 'default', name: '个案工作体验班', teacherIds: [], archived: false });
  const audit = (actor, type, target) => db.audit.push({ id: randomUUID(), actorId: actor?.id || null, type, targetId: target, at: Date.now() });
  const classById = id => db.classes.find(c => c.id === id);
  const manages = (actor, classId) => actor.role === 'admin' || actor.role === 'teacher' && Boolean(classById(classId)?.teacherIds.includes(actor.id));
  const staff = actor => { if (!['admin','teacher'].includes(actor.role)) throw error(403, '仅教师或管理员可操作。'); };
  const makeUser = async ({ username, name, role, password, classIds = [], mustChangePassword = false }) => {
    username = cleanId(username);
    if (!validId(username) || typeof name !== 'string' || !name.trim() || name.length > 40) throw error(400, '账号需为3—40位字母、数字、下划线或短横线，姓名限40字。');
    if (db.users.some(u => !u.legacy && u.username === username && (role === 'student' ? u.role === 'student' : u.role !== 'student'))) throw error(409, '账号已存在。');
    if (password === username) throw error(400, '密码不能与账号相同。');
    const u = { id: randomUUID(), username, name: name.trim(), role, classIds, passwordHash: await passwordHash(password), mustChangePassword, createdAt: Date.now() };
    if (role === 'student') u.studentId = username;
    db.users.push(u); return u;
  };
  // Environment secrets only seed accounts that do not already exist. Never reset on restart.
  for (const [role, prefix, fallback, label] of [['admin','ADMIN','admin','系统管理员'],['teacher','TEACHER','teacher','课程教师']]) {
    const password = env[prefix + '_PASSWORD'];
    if (password && !db.users.some(u => !u.legacy && u.role === role)) {
      const username = env[prefix + '_USERNAME'] || fallback;
      const u = await makeUser({ username, password, name: env[prefix + '_NAME'] || label, role, classIds: role === 'teacher' ? ['default'] : [] });
      if (role === 'teacher') classById('default').teacherIds.push(u.id);
      audit(null, 'bootstrap-' + role, u.id);
    }
  }
  await save();
  function sessionUser(req) {
    const cookie = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('practice-session='))?.slice(17);
    const bearer = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    const token = bearer || cookie;
    const item = token ? db.tokens[digest(token)] : null;
    const user = item && item.expires > Date.now() ? db.users.find(u => u.id === item.userId && !u.legacy && !u.disabled) : null;
    if (!user) throw error(401, '请使用学号或分配的账号重新登录。');
    if (!bearer && !['GET','HEAD'].includes(req.method) && req.headers['x-requested-with'] !== 'casework-web') throw error(403, '请求验证失败，请刷新页面后重试。');
    return user;
  }
  const tokenFrom = req => req.headers.authorization?.match(/^Bearer (.+)$/)?.[1] || (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('practice-session='))?.slice(17);
  const issue = user => {
    const token = randomBytes(32).toString('base64url');
    db.tokens[digest(token)] = { userId: user.id, expires: Date.now() + 12 * 3600000 };
    return { token, user: publicUser(user) };
  };
  const revoke = id => { for (const [token,s] of Object.entries(db.tokens)) if (s.userId === id) delete db.tokens[token]; };
  const attempts = new Map();
  const api = {
    status: () => ({ version: 'accounts-2', setupRequired: !db.users.some(u => !u.legacy && u.role === 'admin'), registrationRequiresCode: true, passwordMinLength: 10 }),
    auth: sessionUser,
    publicUser,
    canSeeSession: (user,s) => user.id === s.userId || user.role === 'admin' || user.role === 'teacher' && manages(user,s.classId || 'legacy-demo'),
    classes: user => db.classes.filter(c => user.role === 'admin' || user.role === 'teacher' ? manages(user,c.id) : user.classIds.includes(c.id)),
    login: (input, ip) => exclusive(async () => {
      const { password, role } = input; const username = cleanId(input.username);
      if (!['student','teacher','admin'].includes(role) || !validId(username) || typeof password !== 'string' || password.length > 128) throw error(400, '请输入正确的账号、密码和身份。');
      const key = digest(ip + ':' + role + ':' + username); const now = Date.now();
      for (const [k,a] of attempts) if (now - a.at > 15 * 60000) attempts.delete(k);
      if ((attempts.get(key)?.count || 0) >= 10) throw error(429, '密码错误次数较多，请15分钟后重试或联系管理员。');
      const user = db.users.find(u => !u.legacy && !u.disabled && u.username === username && u.role === role);
      if (!(await verify(password,user?.passwordHash))) {
        const a = attempts.get(key) || { at: now, count: 0 }; a.count++; attempts.set(key,a);
        throw error(401, '账号或密码不正确。忘记密码请联系教师或管理员。');
      }
      attempts.delete(key); const result = issue(user); audit(user,'login',user.id); await save(); return result;
    }),
    register: input => exclusive(async () => {
      const studentId = cleanId(input.studentId), code = typeof input.registrationCode === 'string' ? input.registrationCode.trim() : '';
      checkPassword(input.password);
      if (!validId(studentId) || input.password === studentId) throw error(400, '请填写正确学号并设置不同于学号的密码。');
      const row = db.roster.find(r => r.studentId === studentId && !r.userId && r.codeHash === digest(code));
      if (!row || classById(row.classId)?.archived) throw error(400, '学号或注册码无效、已使用；请联系教师或管理员。');
      const user = await makeUser({ username: studentId, name: row.name, role: 'student', password: input.password, classIds: [row.classId] });
      row.userId = user.id; row.registeredAt = Date.now(); delete row.codeHash;
      audit(user,'register',user.id); const result = issue(user); await save(); return result;
    }),
    logout: async req => { const token=tokenFrom(req); if(token)delete db.tokens[digest(token)]; await save(); },
    changePassword: (actor,input) => exclusive(async () => {
      if (!(await verify(input.oldPassword,actor.passwordHash))) throw error(400, '原密码不正确。');
      checkPassword(input.newPassword);
      if (input.newPassword === actor.username || input.newPassword === input.oldPassword) throw error(400, '请设置不同于原密码及账号的新密码。');
      actor.passwordHash = await passwordHash(input.newPassword); actor.mustChangePassword = false;
      revoke(actor.id); const result = issue(actor); audit(actor,'change-password',actor.id); await save(); return result;
    }),
    accounts: actor => {
      staff(actor);
      return db.users.filter(u => !u.legacy && (actor.role === 'admin' || u.id === actor.id || u.role === 'student' && u.classIds.some(id => manages(actor,id)))).map(publicUser);
    },
    roster: actor => {
      staff(actor); return db.roster.filter(r => manages(actor,r.classId)).map(({codeHash,...r}) => r);
    },
    importRoster: (actor,input) => exclusive(async () => {
      staff(actor);
      if (!manages(actor,input.classId) || !classById(input.classId) || classById(input.classId).archived) throw error(403,'无权管理该班级。');
      if (!Array.isArray(input.students) || !input.students.length || input.students.length>100) throw error(400,'请一次导入1—100名学生。');
      const ids=new Set();
      for (const row of input.students) {
        const id=cleanId(row.studentId);
        if (!validId(id) || typeof row.name!=='string' || !row.name.trim() || row.name.length>40 || ids.has(id)) throw error(400,'学号格式、姓名或重复行有误，请检查后重试。');
        if (db.roster.some(r=>r.studentId===id) || db.users.some(u=>!u.legacy&&u.role==='student'&&u.username===id)) throw error(409,'名单中已有学号，请移除已导入项后重试。');
        ids.add(id);
      }
      const invitations=[];
      for (const row of input.students) {
        const code=randomBytes(9).toString('base64url');
        const item={id:randomUUID(),studentId:cleanId(row.studentId),name:row.name.trim(),classId:input.classId,codeHash:digest(code),createdAt:Date.now()};
        db.roster.push(item); invitations.push({id:item.id,studentId:item.studentId,name:item.name,registrationCode:code});
      }
      audit(actor,'import-roster',input.classId); await save(); return invitations;
    }),
    reissue: (actor,id) => exclusive(async () => {
      staff(actor); const row=db.roster.find(r=>r.id===id);
      if(!row||!manages(actor,row.classId))throw error(404,'未找到可管理的名单。');
      if(row.userId)throw error(409,'该学生已注册，请使用重置密码。');
      const code=randomBytes(9).toString('base64url');row.codeHash=digest(code);
      audit(actor,'reissue-registration',id);await save();return {studentId:row.studentId,name:row.name,registrationCode:code};
    }),
    resetPassword: (actor,id,input) => exclusive(async () => {
      staff(actor); const target=db.users.find(u=>u.id===id&&!u.legacy);
      if(!target || actor.role!=='admin' && !(target.role==='student'&&target.classIds.some(c=>manages(actor,c))))throw error(403,'无权重置该账号密码。');
      if(target.id===actor.id)throw error(400,'请通过修改密码功能修改自己的密码。');
      checkPassword(input.temporaryPassword);
      if(input.temporaryPassword===target.username)throw error(400,'临时密码不能与账号相同。');
      target.passwordHash=await passwordHash(input.temporaryPassword);target.mustChangePassword=true;revoke(target.id);
      audit(actor,'reset-password',target.id);await save();return publicUser(target);
    }),
    createStaff: (actor,input) => exclusive(async () => {
      if(actor.role!=='admin')throw error(403,'仅管理员可创建教师或管理员账号。');
      if(!['teacher','admin'].includes(input.role))throw error(400,'请选择教师或管理员。');
      const classIds=input.role==='teacher'?(input.classIds||[]):[];
      if(!Array.isArray(classIds)||!classIds.every(id=>classById(id)&&!classById(id).archived))throw error(400,'班级选择无效。');
      const user=await makeUser({...input,classIds,mustChangePassword:true});
      if(user.role==='teacher')for(const id of classIds)classById(id).teacherIds.push(user.id);
      audit(actor,'create-staff',user.id);await save();return publicUser(user);
    }),
    createClass: (actor,input) => exclusive(async () => {
      if(actor.role!=='admin')throw error(403,'仅管理员可创建班级。');
      if(typeof input.name!=='string'||!input.name.trim()||input.name.length>60||!Array.isArray(input.teacherIds)||!input.teacherIds.every(id=>db.users.some(u=>u.id===id&&!u.legacy&&u.role==='teacher')))throw error(400,'请填写班级名称并选择有效教师。');
      const c={id:randomUUID(),name:input.name.trim(),teacherIds:[...new Set(input.teacherIds)],archived:false};db.classes.push(c);
      for(const id of c.teacherIds)db.users.find(u=>u.id===id).classIds.push(c.id);
      audit(actor,'create-class',c.id);await save();return c;
    }),
  };
  return api;
}
