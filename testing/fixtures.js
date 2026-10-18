import { randomUUID } from 'node:crypto';
export const fixtureEnvironment = { ADMIN_PASSWORD:'Test-Admin-Private-2026', ADMIN_USERNAME:'admin' };
export const fixturePassword='Test-Account-Private-2026';
export async function directApi(base,route,token,body,method=body===undefined?'GET':'POST') {
  const res=await fetch(base+'/api'+route,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
  const data=(res.headers.get('content-type')||'').includes('application/json')?await res.json():await res.text();return {status:res.status,data,headers:res.headers};
}
// Legacy test intents are provisioned via the real admin/roster/registration APIs, never a demo-login bypass.
export async function provisionLogin(base,{role,name}) {
  const admin=await directApi(base,'/login',null,{role:'admin',username:'admin',password:fixtureEnvironment.ADMIN_PASSWORD});
  if(admin.status!==200)throw Error('Fixture admin login failed: '+JSON.stringify(admin.data));
  const username=(role==='student'?'s':'t')+randomUUID().replaceAll('-','').slice(0,15);
  if(role==='student') {
    const invites=await directApi(base,'/roster',admin.data.token,{classId:'default',students:[{studentId:username,name}]});
    if(invites.status!==201)throw Error('Fixture roster failed');
    return directApi(base,'/register',null,{studentId:username,registrationCode:invites.data[0].registrationCode,password:fixturePassword});
  }
  const created=await directApi(base,'/admin/users',admin.data.token,{role,username,name,password:fixturePassword,classIds:['default']});
  if(created.status!==201)throw Error('Fixture staff failed');
  const logged=await directApi(base,'/login',null,{role,username,password:fixturePassword});
  return directApi(base,'/change-password',logged.data.token,{oldPassword:fixturePassword,newPassword:fixturePassword+'-Changed'});
}
