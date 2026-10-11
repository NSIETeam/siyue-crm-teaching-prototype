'use strict';
const crypto=require('node:crypto');
const {AuthStore}=require('./auth-store.cjs');
const {createCaptchaService}=require('./auth-captcha.cjs');
const {hashPassword,verifyPassword,initialPassword,strongPassword,tokenHash,generateUsername}=require('./auth-credentials.cjs');
const {roles,permissions,reserved,normalizePolicy,publicUser,effectivePermissions,publicRoles,normalizeRolePermissions}=require('./auth-policy.cjs');
const {selectAuditPage}=require('./audit-query.cjs');
const catalog=require('../contracts/operations.json');
const frontend=require('../../cli/operations.json');
class HttpError extends Error{constructor(status,code,message){super(message);this.status=status;this.code=code;}}
const reject=(status,code,message)=>{throw new HttpError(status,code,message);};
const jsonBody=async(req)=>{if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))reject(415,'JSON_REQUIRED','请使用 JSON 请求');const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>16384)reject(413,'BODY_TOO_LARGE','请求内容过大');chunks.push(chunk);}try{const body=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));const value=JSON.parse(body||'{}');if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();return value;}catch{reject(400,'INVALID_JSON','请求内容不是有效 JSON 对象');}};
function fields(body,allowed){if(Object.keys(body).some(k=>!allowed.includes(k)))reject(400,'UNKNOWN_FIELD','请求包含未支持的字段');}
function text(value,label,max=80,required=true){if(value==null&&!required)return '';if(typeof value!=='string'||value.length>max||(required&&!value.trim())||/[\u0000-\u001f\u007f]/.test(value))reject(400,'INVALID_INPUT',label+'无效');return value.trim();}
function makeUser(input,users){
 fields(input,['name','employeeNo','username','roleIds','scope','additionalPermissions','deniedPermissions']);
 const name=text(input.name,'姓名');const employeeNo=text(input.employeeNo,'工号',40,false);
 if(employeeNo&&users.some(u=>u.employeeNo===employeeNo))reject(409,'ACCOUNT_CONFLICT','工号已存在');
 const username=input.username?text(input.username,'账号',48).toLowerCase():generateUsername(name,employeeNo,users);
 if(!/^[a-z0-9][a-z0-9_-]{2,47}$/.test(username))reject(400,'INVALID_USERNAME','账号需为 3–48 位字母、数字、下划线或连字符');
 if(users.some(u=>u.username===username))reject(409,'ACCOUNT_CONFLICT','账号已存在');
 const password=initialPassword();const now=new Date().toISOString();
 return {user:{id:crypto.randomUUID(),username,name,employeeNo,...normalizePolicy(input),passwordHash:hashPassword(password),version:1,mustChangePassword:true,disabled:false,createdAt:now,updatedAt:now},password};
}
function createAuthService(options){
 const store=options.store||new AuthStore(options.storeFile);const origin=new URL(options.publicOrigin).origin;
 if(new URL(origin).protocol!=='https:'&&!options.allowInsecureTest)throw new Error('认证服务的公开地址必须使用 HTTPS');
 const cookiePath=options.cookiePath||'/crm-api/';if(!/^\/[a-zA-Z0-9/_-]*$/.test(cookiePath))throw new Error('Cookie 路径无效');
 const cookieName='siyue_session',challengeCookieName='siyue_challenge';const buckets=new Map();
 const expose=user=>publicUser(user,store.state.rolePolicies);const currentPermissions=user=>effectivePermissions(user,store.state.rolePolicies);
 const captcha=createCaptchaService(options.captchaOptions);
 function readCookie(req,name){const matches=(req.headers.cookie||'').split(';').map(x=>x.trim()).filter(x=>x.startsWith(name+'='));return matches.length===1?matches[0].slice(name.length+1):undefined;}
 function addCookie(res,value){const current=res.getHeader('Set-Cookie');res.setHeader('Set-Cookie',[...(Array.isArray(current)?current:current?[current]:[]),value]);}
 function challengeCookie(binding,clear=false){return `${challengeCookieName}=${clear?'':binding}; Path=${cookiePath}; HttpOnly; Secure; SameSite=Strict; Max-Age=${clear?0:120}`;}
 function address(req){const remote=req.socket.remoteAddress||'';if(['127.0.0.1','::1','::ffff:127.0.0.1'].includes(remote)&&options.trustProxy){const ip=req.headers['x-real-ip'];if(typeof ip==='string'&&/^[0-9a-fA-F:.]{3,45}$/.test(ip))return ip;}return remote;}
 function limit(key,max,windowMs){const now=Date.now();for(const [k,v]of buckets)if(v.until<=now)buckets.delete(k);let value=buckets.get(key);if(!value){if(buckets.size>=2048)reject(429,'RATE_LIMITED','请求过于频繁，请稍后重试');value={count:0,until:now+windowMs};buckets.set(key,value);}value.count++;if(value.count>max)reject(429,'RATE_LIMITED','请求过于频繁，请稍后重试');}
 function audit(state,req,action,outcome,user=null,targetId=null,details={}){state.audit.push({id:crypto.randomUUID(),at:new Date().toISOString(),requestId:req.requestId||crypto.randomUUID(),actorId:user?.id||null,actorName:user?.name||null,action,outcome,targetId,ip:address(req),details});}
 function writeAudit(req,action,outcome,user,targetId,details){store.transact(s=>audit(s,req,action,outcome,user,targetId,details));}
 function cookie(token,{clear=false,remember=false,expiresAt}={}){const maxAge=clear?0:remember?Math.max(0,Math.floor((Date.parse(expiresAt)-Date.now())/1000)):null;return `${cookieName}=${clear?'':token}; Path=${cookiePath}; HttpOnly; Secure; SameSite=Strict${maxAge===null?'':'; Max-Age='+maxAge}`;}
 function newSession(user,client,remember=false){const token=crypto.randomBytes(32).toString('base64url'),csrfToken=crypto.randomBytes(32).toString('base64url');const createdAt=new Date().toISOString(),expiresAt=new Date(Date.now()+(user.mustChangePassword?10*60000:client==='browser'&&remember?30*86400000:8*3600000)).toISOString();return {token,session:{tokenHash:tokenHash(token),userId:user.id,version:user.version,client,csrfToken,remember:client==='browser'&&remember,createdAt,expiresAt}};}
 function originCheck(req){if(req.headers.origin!==origin)reject(403,'ORIGIN_REJECTED','请求来源未授权');}
 function authenticate(req){
  let token,client;
  if(req.headers.authorization){if(typeof req.headers.authorization!=='string'||!/^Bearer [A-Za-z0-9_-]{43}$/.test(req.headers.authorization))reject(401,'AUTH_REQUIRED','请重新登录');token=req.headers.authorization.slice(7);client='cli';}
  else{const matches=(req.headers.cookie||'').split(';').map(x=>x.trim()).filter(x=>x.startsWith(cookieName+'='));if(matches.length!==1)reject(401,'AUTH_REQUIRED','请先登录');token=matches[0].slice(cookieName.length+1);client='browser';if(!/^[A-Za-z0-9_-]{43}$/.test(token))reject(401,'AUTH_REQUIRED','请重新登录');}
  const hash=tokenHash(token);const session=store.state.sessions.find(x=>x.tokenHash===hash&&x.client===client);
  const user=session&&store.state.users.find(x=>x.id===session.userId);
  if(!session||!user||user.disabled||session.version!==user.version||Date.parse(session.expiresAt)<=Date.now())reject(401,'SESSION_EXPIRED','登录已失效，请重新登录');
  return {session,user};
 }
 function admin(user){if(!user.roleIds.includes('superadmin'))reject(403,'FORBIDDEN','仅超级管理员可以管理账号与权限');}
 // Re-read the live session after every asynchronous body read. A request may have
 // arrived before a concurrent password reset, logout or privilege revocation.
 function reauthenticate(req,{allowInitialPassword=false,adminOnly=false}={}){
  const live=authenticate(req),session=live.session;
  if(session.client==='browser'&&!['GET','HEAD','OPTIONS'].includes(req.method)){originCheck(req);const value=req.headers['x-csrf-token'];if(typeof value!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(value)||!crypto.timingSafeEqual(Buffer.from(value),Buffer.from(session.csrfToken)))reject(403,'CSRF_REJECTED','安全校验失败，请刷新后重试');}
  if(live.user.mustChangePassword&&!allowInitialPassword)reject(403,'PASSWORD_CHANGE_REQUIRED','请先修改初始密码');
  if(adminOnly)admin(live.user);return live;
 }
 function revoke(state,user){user.version++;user.updatedAt=new Date().toISOString();state.sessions=state.sessions.filter(s=>s.userId!==user.id);}
 function guardLastAdmin(state,candidate){if(candidate.disabled||!candidate.roleIds.includes('superadmin')){const others=state.users.filter(u=>u.id!==candidate.id&&!u.disabled&&u.roleIds.includes('superadmin'));if(!others.length)reject(409,'LAST_SUPERADMIN','不能停用或降权最后一个超级管理员');}}
 async function handle(req,res,pathname,respond){
  let actor=null;let action='request';let targetId=null;
  try{
   if(pathname==='/v1/auth/captcha'&&req.method==='GET'){
    if(req.headers.origin)originCheck(req);if(req.headers['sec-fetch-site']==='cross-site')reject(403,'ORIGIN_REJECTED','请求来源未授权');
    limit('global-captcha',200,60000);limit('captcha-ip:'+address(req),20,60000);
    const challenge=captcha.issue(readCookie(req,challengeCookieName));addCookie(res,challengeCookie(challenge.binding));return respond(200,{id:challenge.id,image:challenge.image,expiresAt:challenge.expiresAt});
   }
   if(pathname==='/v1/auth/login'&&req.method==='POST'){
    action='auth.login';limit('global-login',100,60000);limit('ip:'+address(req),20,15*60000);
    const body=await jsonBody(req);fields(body,['username','password','client','remember','captchaId','captchaCode']);
    if(!['browser','cli'].includes(body.client))reject(400,'INVALID_CLIENT','请选择有效登录方式');
    if(body.client==='browser'){
     originCheck(req);if(body.remember!==undefined&&typeof body.remember!=='boolean')reject(400,'INVALID_INPUT','记住登录状态必须为布尔值');
     const solved=captcha.consume(body.captchaId,body.captchaCode,readCookie(req,challengeCookieName));addCookie(res,challengeCookie('',true));
     if(!body.captchaId||!body.captchaCode)reject(400,'CAPTCHA_REQUIRED','请输入图片验证码');
     if(!solved)reject(400,'CAPTCHA_INVALID','验证码错误或已过期，请刷新后重试');
    }else{
     if(req.headers.origin!==undefined||req.headers['sec-fetch-site']!==undefined||readCookie(req,cookieName)||readCookie(req,challengeCookieName))reject(403,'BROWSER_CLIENT_REQUIRED','浏览器登录必须完成图片验证码');
     if(body.remember!==undefined||body.captchaId!==undefined||body.captchaCode!==undefined)reject(400,'INVALID_CLIENT_OPTIONS','命令行登录不接受浏览器选项');
    }
    const username=typeof body.username==='string'?body.username.trim().toLowerCase():'';
    limit('account:'+tokenHash(username),10,15*60000);
    const candidate=store.state.users.find(u=>u.username===username);
    const validInput=username.length>=3&&username.length<=48&&typeof body.password==='string'&&Buffer.byteLength(body.password)<=256;
    const verified=verifyPassword(validInput?body.password:'',candidate?.passwordHash);
    if(validInput&&verified&&candidate)actor=candidate;
    if(!validInput||!verified||!candidate||candidate.disabled)reject(401,'INVALID_CREDENTIALS','账号或密码错误');
    const issued=newSession(candidate,body.client,body.remember===true),{token}=issued,{csrfToken,expiresAt}=issued.session;
    const result=store.transact(state=>{const user=state.users.find(u=>u.id===candidate.id);state.sessions=state.sessions.filter(s=>Date.parse(s.expiresAt)>Date.now());const active=state.sessions.filter(s=>s.userId===user.id);if(active.length>=10){const oldest=active.sort((a,b)=>a.createdAt.localeCompare(b.createdAt))[0];state.sessions=state.sessions.filter(s=>s!==oldest);}state.sessions.push(issued.session);audit(state,req,action,'success',user,user.id);return expose(user);});
    if(body.client==='browser')addCookie(res,cookie(token,issued.session));return respond(200,{user:result,expiresAt,...(body.client==='cli'?{token}:{csrfToken})});
   }
   actor=authenticate(req).user;
   let session;({user:actor,session}=reauthenticate(req,{allowInitialPassword:true}));
   if(pathname==='/v1/auth/me'&&req.method==='GET')return respond(200,{user:expose(actor),expiresAt:session.expiresAt,...(session.client==='browser'?{csrfToken:session.csrfToken}:{})});
   if(pathname==='/v1/auth/logout'&&req.method==='POST'){action='auth.logout';store.transact(s=>{s.sessions=s.sessions.filter(x=>x.tokenHash!==session.tokenHash);audit(s,req,action,'success',actor,actor.id);});if(session.client==='browser')addCookie(res,cookie('',{clear:true}));return respond(200,{loggedOut:true});}
   if(pathname==='/v1/auth/password'&&req.method==='POST'){
    action='auth.password';limit('password:'+actor.id,8,15*60000);const body=await jsonBody(req);({user:actor,session}=reauthenticate(req,{allowInitialPassword:true}));fields(body,['currentPassword','newPassword']);
    if(typeof body.currentPassword!=='string'||Buffer.byteLength(body.currentPassword)>256||!verifyPassword(body.currentPassword,actor.passwordHash))reject(403,'CURRENT_PASSWORD_INVALID','当前密码不正确');
    if(!strongPassword(body.newPassword,actor.username))reject(400,'WEAK_PASSWORD','密码至少 10 位，需包含大小写字母、数字和符号，且不能包含账号');
    if(body.newPassword===body.currentPassword)reject(400,'PASSWORD_UNCHANGED','新密码不能与当前密码相同');
    const passwordHash=hashPassword(body.newPassword);
    const continueBrowser=session.client==='browser'&&actor.mustChangePassword;let issued;
    const updated=store.transact(s=>{const user=s.users.find(u=>u.id===actor.id);user.passwordHash=passwordHash;user.mustChangePassword=false;revoke(s,user);if(continueBrowser){issued=newSession(user,'browser',session.remember===true);s.sessions.push(issued.session);}audit(s,req,action,'success',user,user.id);return expose(user);});
    if(continueBrowser){addCookie(res,cookie(issued.token,issued.session));return respond(200,{changed:true,reauthenticate:false,user:updated,csrfToken:issued.session.csrfToken,expiresAt:issued.session.expiresAt});}
    if(session.client==='browser')addCookie(res,cookie('',{clear:true}));return respond(200,{changed:true,reauthenticate:true});
   }
   if(actor.mustChangePassword)reject(403,'PASSWORD_CHANGE_REQUIRED','请先修改初始密码');
   if(pathname==='/v1/roles'&&req.method==='GET')return respond(200,{roles:publicRoles(store.state.rolePolicies),permissions,reservedPermissions:[...reserved].sort()});
   if(pathname==='/v1/catalog'&&req.method==='GET'){
    const allowed=new Set(currentPermissions(actor));const operations=catalog.operations.filter(x=>allowed.has(x.permission));const ids=new Set(operations.flatMap(x=>x.frontendAliases));
    return respond(200,{...catalog,mode:'authenticated-design',authorizationFiltered:true,description:'当前账号已授权的操作定义；业务执行仍未实现。',operations,frontendOperations:frontend.operations.filter(x=>x.permission?.anyOf?.length?x.permission.anyOf.some(p=>allowed.has(p)):x.permission?.required?x.permission.required==='self'||allowed.has(x.permission.required):ids.has(x.id)),userVersion:actor.version,scope:actor.scope});
   }
   if(pathname==='/v1/admin/audit'&&req.method==='GET'){
    action='audit.query';if(!actor.roleIds.includes('superadmin')&&!currentPermissions(actor).includes('audit.read'))reject(403,'FORBIDDEN','无操作日志查看权限');
    const query=new URL(req.url,'http://local').searchParams;
    const result=selectAuditPage(store.state.audit.slice().reverse(),store.state.users.map(user=>expose(user)),query,store.state);
    writeAudit(req,action,'success',actor,null,{resultCount:result.events.length});return respond(200,result);
   }
   const archiveMatch=pathname.match(/^\/v1\/admin\/users\/([a-z0-9-]+)\/archive$/);
   if(archiveMatch&&req.method==='POST'){
    targetId=archiveMatch[1];action='account.archive';
    const body=await jsonBody(req);({user:actor,session}=reauthenticate(req,{adminOnly:true}));fields(body,['reason']);if(body.reason!==undefined&&typeof body.reason!=='string')reject(400,'INVALID_INPUT','归档原因无效');
    const reason=body.reason===undefined?'':text(body.reason,'归档原因',200,false);
    const result=store.transact(state=>{
     const target=state.users.find(user=>user.id===targetId);if(!target)reject(404,'USER_NOT_FOUND','账号不存在');
     if(target.id===actor.id)reject(409,'CANNOT_ARCHIVE_SELF','不能归档当前登录账号');
     if(target.archivedAt)reject(409,'ACCOUNT_ARCHIVED','该员工账号已归档');
     const candidate={...target,disabled:true};if(target.roleIds.includes('superadmin'))guardLastAdmin(state,candidate);
     target.disabled=true;target.archivedAt=new Date().toISOString();target.archivedBy=actor.id;target.archiveReason=reason||null;revoke(state,target);
     audit(state,req,action,'success',actor,targetId,{archiveReason:target.archiveReason,archived:true});
     return {user:expose(target),archived:true};
    });
    return respond(200,result);
   }
   const roleMatch=pathname.match(/^\/v1\/admin\/roles\/([a-z0-9-]+)$/);
   if(roleMatch&&req.method==='PATCH'){
    const roleId=roleMatch[1];action='role.update';targetId='role:'+roleId;
    const body=await jsonBody(req);({user:actor,session}=reauthenticate(req,{adminOnly:true}));
    fields(body,['permissions','expectedVersion']);
    const role=roles.find(item=>item.id===roleId);if(!role)reject(404,'ROLE_NOT_FOUND','角色不存在');
    if(roleId==='superadmin')reject(403,'ROLE_PROTECTED','超级管理员角色固定保留全部权限');
    if(!Number.isInteger(body.expectedVersion)||body.expectedVersion<1)reject(400,'INVALID_INPUT','角色版本无效');
    const nextPermissions=normalizeRolePermissions(body.permissions);
    const current=store.state.rolePolicies[roleId]||{permissions:[...role.permissions].sort(),version:1};
    if(body.expectedVersion!==current.version)reject(409,'ROLE_VERSION_CONFLICT','角色已被其他管理员修改，请刷新后重试');
    const before=[...current.permissions].sort(),same=before.length===nextPermissions.length&&before.every((value,index)=>value===nextPermissions[index]);
    const affectedUsers=store.state.users.filter(user=>user.roleIds.includes(roleId)).length;
    if(same)return respond(200,{role:publicRoles(store.state.rolePolicies).find(item=>item.id===roleId),affectedUsers,changed:false});
    const permissionsAdded=nextPermissions.filter(value=>!before.includes(value));
    const permissionsRemoved=before.filter(value=>!nextPermissions.includes(value));
    const result=store.transact(state=>{
     const latest=state.rolePolicies[roleId]||{permissions:[...role.permissions].sort(),version:1};
     if(latest.version!==body.expectedVersion)reject(409,'ROLE_VERSION_CONFLICT','角色已被其他管理员修改，请刷新后重试');
     state.rolePolicies[roleId]={permissions:nextPermissions,version:latest.version+1};
     const now=new Date().toISOString();let count=0;
     for(const user of state.users){if(!user.roleIds.includes(roleId))continue;count++;const oldVersion=user.version;user.version++;user.updatedAt=now;if(!user.disabled)for(const active of state.sessions){if(active.userId===user.id&&active.version===oldVersion&&Date.parse(active.expiresAt)>Date.now())active.version=user.version;}}
     audit(state,req,action,'success',actor,targetId,{roleName:role.label,permissionsAdded,permissionsRemoved,affectedUsers:count});
     return {role:publicRoles(state.rolePolicies).find(item=>item.id===roleId),affectedUsers:count,changed:true};
    });
    return respond(200,result);
   }
   if(pathname==='/v1/admin/users'){
    action=req.method==='POST'?'account.create':'account.list';admin(actor);
    if(req.method==='GET'){writeAudit(req,action,'success',actor);return respond(200,{users:store.state.users.map(user=>expose(user))});}
    if(req.method==='POST'){const body=await jsonBody(req);({user:actor,session}=reauthenticate(req,{adminOnly:true}));const created=makeUser(body,store.state.users);store.transact(s=>{s.users.push(created.user);audit(s,req,action,'success',actor,created.user.id,{username:created.user.username,roleIds:created.user.roleIds,scope:created.user.scope});});return respond(201,{user:expose(created.user),initialPassword:created.password});}
   }
   const match=pathname.match(/^\/v1\/admin\/users\/([a-z0-9-]+)(\/reset-password)?$/);
   if(match){targetId=match[1];action=match[2]?'account.resetPassword':'account.update';admin(actor);let found=store.state.users.find(u=>u.id===targetId);if(!found)reject(404,'USER_NOT_FOUND','账号不存在');
    if(match[2]&&req.method==='POST'){const body=await jsonBody(req);({user:actor,session}=reauthenticate(req,{adminOnly:true}));fields(body,[]);found=store.state.users.find(u=>u.id===targetId);if(found?.archivedAt)reject(409,'ACCOUNT_ARCHIVED','该员工账号已归档');const password=initialPassword(),passwordHash=hashPassword(password);const user=store.transact(s=>{const target=s.users.find(u=>u.id===targetId);target.passwordHash=passwordHash;target.mustChangePassword=true;revoke(s,target);audit(s,req,action,'success',actor,targetId);return expose(target);});return respond(200,{user,initialPassword:password});}
    if(!match[2]&&req.method==='PATCH'){const body=await jsonBody(req);({user:actor,session}=reauthenticate(req,{adminOnly:true}));found=store.state.users.find(u=>u.id===targetId);if(!found)reject(404,'USER_NOT_FOUND','账号不存在');fields(body,['name','roleIds','scope','disabled','additionalPermissions','deniedPermissions']);if(!Object.keys(body).length)reject(400,'NO_CHANGES','请指定修改内容');if(body.disabled!==undefined&&typeof body.disabled!=='boolean')reject(400,'INVALID_INPUT','停用状态无效');if(found.archivedAt)reject(409,'ACCOUNT_ARCHIVED','已归档账号只可查看，不能修改或重新启用');const changes={...normalizePolicy(body,found),...(body.name===undefined?{}:{name:text(body.name,'姓名')}),...(body.disabled===undefined?{}:{disabled:body.disabled})};const user=store.transact(s=>{const target=s.users.find(u=>u.id===targetId);const candidate={...target,...changes};if(target.roleIds.includes('superadmin'))guardLastAdmin(s,candidate);Object.assign(target,changes);revoke(s,target);audit(s,req,action,'success',actor,targetId,{roleIds:target.roleIds,scope:target.scope,additionalPermissions:target.additionalPermissions,deniedPermissions:target.deniedPermissions,disabled:target.disabled});return expose(target);});return respond(200,{user});}
   }
   const operationMatch=pathname.match(/^\/v1\/operations\/([a-zA-Z]+\.[a-zA-Z]+)\/(preview|execute)$/);
   if(operationMatch){action=operationMatch[1];const operation=catalog.operations.find(x=>x.id===action);if(!operation)reject(404,'NOT_FOUND','未登记此操作');if(!currentPermissions(actor).includes(operation.permission))reject(403,'FORBIDDEN','没有此操作权限');}
   else {
    const readPermission={'/v1/students':'student.read','/v1/employees':'staff.read','/v1/leads':'lead.read','/v1/orders':'order.read','/v1/schedule':'schedule.read','/v1/audit-events':'audit.read'}[pathname];
    if(readPermission&&!currentPermissions(actor).includes(readPermission))reject(403,'FORBIDDEN','没有此资料查看权限');
    if(pathname.startsWith('/v1/payment-webhooks/'))reject(501,'NOT_IMPLEMENTED','支付回调尚未实现');
   }
   if(pathname.startsWith('/v1/auth/')||pathname.startsWith('/v1/admin/'))reject(404,'NOT_FOUND','没有此接口');
   if(operationMatch||pathname.startsWith('/v1/'))writeAudit(req,action,'not_implemented',actor,targetId,{path:pathname.slice(0,200)});
   return false;
  }catch(error){
   const status=error.status||500;const code=error.code||'STORAGE_UNAVAILABLE';
   try{if(pathname!=='/v1/auth/captcha')writeAudit(req,action,'denied',actor,targetId,{code});}catch{return respond(503,{requestId:req.requestId,code:'STORAGE_UNAVAILABLE',message:'认证存储暂不可用，请稍后重试'});}
   return respond(status,{requestId:req.requestId,code,message:status>=500?'认证服务暂不可用，请稍后重试':error.message});
  }
 }
 return {handle,close:()=>store.close(),store,authorize:req=>expose(reauthenticate(req).user),directory:()=>store.state.users.map(user=>expose(user))};
}
module.exports={createAuthService,makeUser};
