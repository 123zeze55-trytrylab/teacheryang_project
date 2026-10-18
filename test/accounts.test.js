import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fixtureEnvironment, fixturePassword, directApi } from '../testing/fixtures.js';
import { cases } from '../teaching/cases.js';

test('assigned accounts, class-scoped registration and password reset preserve legacy data securely', async t => {
 const dir=await mkdtemp(path.join(tmpdir(),'casework-accounts-'));
 const legacy={users:[{id:'old-teacher',role:'teacher',name:'旧演示教师'},{id:'old-student',role:'student',name:'旧演示学生'}],sessions:[{id:'00000000-0000-4000-8000-000000000001',userId:'old-student',case:cases[0],messages:[],status:'drawn',reflection:'旧反思'}],tokens:{'old-bearer':{userId:'old-teacher',expires:Date.now()+86400000}}};
 await writeFile(path.join(dir,'db.json'),JSON.stringify(legacy));
 let proc,base,admin,teacherA,teacherB,studentA,studentB,classB;
 const env={...process.env,...fixtureEnvironment,DATA_DIR:dir,PORT:'0'};
 async function start(){proc=spawn(process.execPath,['server.js'],{env,stdio:['ignore','pipe','pipe']});await new Promise((resolve,reject)=>{let log='';const timer=setTimeout(()=>reject(Error('startup timeout')),5000);proc.stdout.on('data',b=>{log+=b;const m=log.match(/端口 (\d+)/);if(m){base='http://127.0.0.1:'+m[1];clearTimeout(timer);resolve();}});proc.once('exit',()=>{clearTimeout(timer);reject(Error('startup failed'));});});}
 async function stop(){if(proc&&proc.exitCode===null){proc.kill();await once(proc,'exit');}}
 const api=(r,token,data,method)=>directApi(base,r,token,data,method);
 async function createTeacher(username,classIds){await api('/admin/users',admin.token,{username,name:username,role:'teacher',password:fixturePassword,classIds});const first=(await api('/login',null,{role:'teacher',username,password:fixturePassword})).data;assert.equal(first.user.mustChangePassword,true);assert.equal((await api('/sessions',first.token)).status,403);const changed=(await api('/change-password',first.token,{oldPassword:fixturePassword,newPassword:fixturePassword+'-changed'})).data;assert.equal((await api('/me',first.token)).status,401);return changed;}
 try {
  await start();
  await t.test('migration invalidates arbitrary demo logins and backs up without deleting records',async()=>{
   assert.equal((await api('/me','old-bearer')).status,401);
   assert.equal((await api('/login',null,{role:'teacher',name:'随意进入'})).status,400);
   assert.equal((await api('/auth/status')).data.setupRequired,false);
   admin=(await api('/login',null,{role:'admin',username:'admin',password:fixtureEnvironment.ADMIN_PASSWORD})).data;
   assert.equal(admin.user.role,'admin');assert.equal(admin.user.passwordHash,undefined);
   const old=(await api('/sessions/'+legacy.sessions[0].id,admin.token));assert.equal(old.status,200);assert.equal(old.data.reflection,'旧反思');assert.equal(old.data.classId,'legacy-demo');
   assert.equal((await readdir(path.join(dir,'migration-backups'))).length,1);
  });
  await t.test('only admin assigns staff and teacher/class assignments govern access',async()=>{
   teacherA=await createTeacher('teacher-a',['default']);teacherB=await createTeacher('teacher-b',[]);
   classB=(await api('/classes',admin.token,{name:'第二班',teacherIds:[teacherB.user.id]})).data;
   assert.equal((await api('/admin/users',teacherA.token,{username:'fake-admin',name:'越权',role:'admin',password:fixturePassword})).status,403);
   assert.equal((await api('/login',null,{role:'admin',username:'teacher-a',password:fixturePassword+'-changed'})).status,401);
   assert.equal((await api('/sessions/'+legacy.sessions[0].id,teacherA.token)).status,404);
   assert.deepEqual((await api('/classes',teacherB.token)).data.map(c=>c.id),[classB.id]);
  });
  let inviteA,inviteB;
  await t.test('roster import requires class authorization and exposes codes only when issued',async()=>{
   assert.equal((await api('/roster',teacherA.token,{classId:classB.id,students:[{studentId:'s999',name:'越权'}]})).status,403);
   inviteA=(await api('/roster',teacherA.token,{classId:'default',students:[{studentId:'s001',name:'学生甲'},{studentId:'s003',name:'学生丙'}]})).data;
   inviteB=(await api('/roster',teacherB.token,{classId:classB.id,students:[{studentId:'s002',name:'学生乙'}]})).data;
   assert.ok(inviteA[0].registrationCode);const roster=(await api('/roster',teacherA.token)).data;
   assert.equal(roster[0].codeHash,undefined);assert.equal(roster[0].registrationCode,undefined);assert.equal(roster.length,2);
   assert.equal((await api('/register',null,{studentId:'s001',registrationCode:'wrong',password:fixturePassword})).status,400);
  });
  await t.test('self-registration uses a one-time verified school ID and can never choose teacher privileges',async()=>{
   studentA=(await api('/register',null,{studentId:'s001',registrationCode:inviteA[0].registrationCode,password:fixturePassword,role:'admin',name:'冒名'})).data;
   studentB=(await api('/register',null,{studentId:'s002',registrationCode:inviteB[0].registrationCode,password:fixturePassword})).data;
   assert.equal(studentA.user.role,'student');assert.equal(studentA.user.name,'学生甲');
   assert.equal((await api('/register',null,{studentId:'s001',registrationCode:inviteA[0].registrationCode,password:fixturePassword})).status,400);
   const logged=(await api('/login',null,{role:'student',username:'s001',password:fixturePassword})).data;assert.equal(logged.user.id,studentA.user.id);
   const created=(await api('/sessions',studentB.token,{})).data;assert.equal(created.classId,classB.id);
   assert.equal((await api('/sessions/'+created.id,teacherA.token)).status,404);assert.equal((await api('/sessions/'+created.id,teacherB.token)).status,200);
   assert.ok(!(await api('/accounts',teacherA.token)).data.some(u=>u.id===studentB.user.id));
   assert.equal((await api('/accounts',studentA.token)).status,403);
  });
  await t.test('registration code reissue revokes the prior code; concurrent registration creates one identity',async()=>{
   const original=inviteA[1],replacement=(await api('/roster/'+original.id+'/reissue',teacherA.token,{})).data;
   assert.equal((await api('/register',null,{studentId:'s003',registrationCode:original.registrationCode,password:fixturePassword})).status,400);
   const results=await Promise.all([1,2].map(()=>api('/register',null,{studentId:'s003',registrationCode:replacement.registrationCode,password:fixturePassword})));
   assert.deepEqual(results.map(r=>r.status).sort(),[201,400]);
  });
  await t.test('teacher reset is class-scoped, revokes old sessions and forces a private new password',async()=>{
   const route='/accounts/'+studentA.user.id+'/reset-password';
   assert.equal((await api(route,studentA.token,{temporaryPassword:'Temp-Student-2026'})).status,403);
   assert.equal((await api(route,teacherB.token,{temporaryPassword:'Temp-Student-2026'})).status,403);
   assert.equal((await api('/accounts/'+admin.user.id+'/reset-password',teacherA.token,{temporaryPassword:'Temp-Student-2026'})).status,403);
   const reset=await api(route,teacherA.token,{temporaryPassword:'Temp-Student-2026'});assert.equal(reset.status,200);assert.equal(reset.data.passwordHash,undefined);
   assert.equal((await api('/me',studentA.token)).status,401);assert.equal((await api('/login',null,{role:'student',username:'s001',password:fixturePassword})).status,401);
   const temporary=(await api('/login',null,{role:'student',username:'s001',password:'Temp-Student-2026'})).data;
   assert.equal(temporary.user.mustChangePassword,true);assert.equal((await api('/sessions',temporary.token)).status,403);
   studentA=(await api('/change-password',temporary.token,{oldPassword:'Temp-Student-2026',newPassword:'Student-Own-Private-2026'})).data;
   assert.equal(studentA.user.mustChangePassword,false);assert.equal((await api('/me',temporary.token)).status,401);assert.equal((await api('/sessions',studentA.token)).status,200);
  });
  await t.test('browser cookie sessions are HttpOnly and state changes require same-origin request verification',async()=>{
   const r=await api('/login',null,{role:'admin',username:'admin',password:fixtureEnvironment.ADMIN_PASSWORD});
   const header=r.headers.get('set-cookie');assert.match(header,/HttpOnly/);assert.match(header,/SameSite=Strict/);const cookie=header.split(';')[0];
   const request=extra=>fetch(base+'/api/classes',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json',...extra},body:JSON.stringify({name:'CSRF验证班级',teacherIds:[]})});
   assert.equal((await request({})).status,403);
   assert.equal((await request({'X-Requested-With':'casework-web',Origin:'https://evil.example'})).status,403);
   assert.equal((await request({'X-Requested-With':'casework-web',Origin:base})).status,201);
   const text=await readFile(path.join(dir,'db.json'),'utf8');assert.ok(!text.includes(fixtureEnvironment.ADMIN_PASSWORD));assert.ok(!text.includes('Student-Own-Private-2026'));assert.ok(!text.includes(studentA.token));
  });
  await t.test('restart preserves existing identities instead of resetting them from environment values',async()=>{
   const before=JSON.parse(await readFile(path.join(dir,'db.json'))).users.length;
   await stop();env.ADMIN_PASSWORD='Changed-Env-Does-Not-Reset-2026';await start();
   assert.equal((await api('/login',null,{role:'admin',username:'admin',password:fixtureEnvironment.ADMIN_PASSWORD})).status,200);
   assert.equal((await api('/login',null,{role:'admin',username:'admin',password:env.ADMIN_PASSWORD})).status,401);
   assert.equal(JSON.parse(await readFile(path.join(dir,'db.json'))).users.length,before);assert.equal((await readdir(path.join(dir,'migration-backups'))).length,1);
  });
 } finally {await stop();await rm(dir,{recursive:true,force:true});}
});
