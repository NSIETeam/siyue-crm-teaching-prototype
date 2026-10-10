'use strict';
const crypto=require('node:crypto');
const {AuthStore}=require('./auth-store.cjs');
const {hashPassword,verifyPassword,initialPassword,strongPassword,tokenHash,generateUsername}=require('./auth-credentials.cjs');
const {roles,permissions,normalizePolicy,publicUser,effectivePermissions}=require('./auth-policy.cjs');
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
 const cookieName='siyue_session';const buckets=new Map();
 function address(req){const remote=req.socket.remoteAddress||'';if(['127.0.0.1','::1','::ffff:127.0.0.1'].includes(remote)&&options.trustProxy){const ip=req.headers['x-real-ip'];if(typeof ip==='string'&&/^[0-9a-fA-F:.]{3,45}$/.test(ip))return ip;}return remote;}
 function limit(key,max,windowMs){const now=Date.now();for(const [k,v]of buckets)if(v.until<=now)buckets.delete(k);let value=buckets.get(key);if(!value){if(buckets.size>=2048)reject(429,'RATE_LIMITED','请求过于频繁，请稍后重试');value={count:0,until:now+windowMs};buckets.set(key,value);}value.count++;if(value.count>max)reject(429,'RATE_LIMITED','请求过于频繁，请稍后重试');}
 function audit(state,req,action,outcome,user=null,targetId=null,details={}){state.audit.push({id:crypto.randomUUID(),at:new Date().toISOString(),requestId:req.requestId||crypto.randomUUID(),actorId:user?.id||null,actorName:user?.name||null,action,outcome,targetId,ip:address(req),details});}
 function writeAudit(req,action,outcome,user,targetId,details){store.transact(s=>audit(s,req,action,outcome,user,targetId,details));}
 function cookie(token,clear=false){return `${cookieName}=${clear?'':token}; Path=${cookiePath}; HttpOnly; Secure; SameSite=Strict; Max-Age=${clear?0:28800}`;}
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
   if(pathname==='/v1/auth/login'&&req.method==='POST'){
    action='auth.login';limit('global-login',100,60000);limit('ip:'+address(req),20,15*60000);
    const body=await jsonBody(req);fields(body,['username','password','client']);
    if(!['browser','cli'].includes(body.client))reject(400,'INVALID_CLIENT','请选择有效登录方式');
    if(body.client==='browser')originCheck(req);else if(req.headers.origin&&req.headers.origin!==origin)reject(403,'ORIGIN_REJECTED','请求来源未授权');
    const username=typeof body.username==='string'?body.username.trim().toLowerCase():'';
    limit('account:'+tokenHash(username),10,15*60000);
    const candidate=store.state.users.find(u=>u.username===username);
    const validInput=username.length>=3&&username.length<=48&&typeof body.password==='string'&&Buffer.byteLength(body.password)<=256;
    const verified=verifyPassword(validInput?body.password:'',candidate?.passwordHash);
    if(validInput&&verified&&candidate)actor=candidate;
    if(!validInput||!verified||!candidate||candidate.disabled)reject(401,'INVALID_CREDENTIALS','账号或密码错误');
    const token=crypto.randomBytes(32).toString('base64url');const csrfToken=crypto.randomBytes(32).toString('base64url');
    const expiresAt=new Date(Date.now()+(candidate.mustChangePassword?10*60000:8*3600000)).toISOString();
    const result=store.transact(state=>{const user=state.users.find(u=>u.id===candidate.id);const session={tokenHash:tokenHash(token),userId:user.id,version:user.version,client:body.client,csrfToken,createdAt:new Date().toISOString(),expiresAt};state.sessions=state.sessions.filter(s=>Date.parse(s.expiresAt)>Date.now());const active=state.sessions.filter(s=>s.userId===user.id);if(active.length>=10){const oldest=active.sort((a,b)=>a.createdAt.localeCompare(b.createdAt))[0];state.sessions=state.sessions.filter(s=>s!==oldest);}state.sessions.push(session);audit(state,req,action,'success',user,user.id);return publicUser(user);});
    if(body.client==='browser')res.setHeader('Set-Cookie',cookie(token));return respond(200,{user:result,expiresAt,...(body.client==='cli'?{token}:{csrfToken})});
   }
   actor=authenticate(req).user;
   let session;({user:actor,session}=reauthenticate(req,{allowInitialPassword:true}));
   if(pathname==='/v1/auth/me'&&req.method==='GET')return respond(200,{user:publicUser(actor),expiresAt:session.expiresAt,...(session.client==='browser'?{csrfToken:session.csrfToken}:{})});
   if(pathname==='/v1/auth/logout'&&req.method==='POST'){action='auth.logout';store.transact(s=>{s.sessions=s.sessions.filter(x=>x.tokenHash!==session.tokenHash);audit(s,req,action,'success',actor,actor.id);});if(session.client==='browser')res.setHeader('Set-Cookie',cookie('',true));return respond(200,{loggedOut:true});}
   if(pathname==='/v1/auth/password'&&req.method==='POST'){
    action='auth.password';limit('password:'+actor.id,8,15*60000);const body=await jsonBody(req);({user:actor,session}=reauthenticate(req,{allowInitialPassword:true}));fields(body,['currentPassword','newPassword']);
    if(typeof body.currentPassword!=='string'||Buffer.byteLength(body.currentPassword)>256||!verifyPassword(body.currentPassword,actor.passwordHash))reject(403,'CURRENT_PASSWORD_INVALID','当前密码不正确');
    if(!strongPassword(body.newPassword,actor.username))reject(400,'WEAK_PASSWORD','密码至少 14 位，需包含大小写字母、数字和符号，且不能包含账号');
    if(body.newPassword===body.currentPassword)reject(400,'PASSWORD_UNCHANGED','新密码不能与当前密码相同');
    const passwordHash=hashPassword(body.newPassword);
    store.transact(s=>{const user=s.users.find(u=>u.id===actor.id);user.passwordHash=passwordHash;user.mustChangePassword=false;revoke(s,user);audit(s,req,action,'success',user,user.id);});if(session.client==='browser')res.setHeader('Set-Cookie',cookie('',true));return respond(200,{changed:true,reauthenticate:true});
   }
   if(actor.mustChangePassword)reject(403,'PASSWORD_CHANGE_REQUIRED','请先修改初始密码');
   if(pathname==='/v1/roles'&&req.method==='GET')return respond(200,{roles,permissions});
   if(pathname==='/v1/catalog'&&req.method==='GET'){
    const allowed=new Set(effectivePermissions(actor));const operations=catalog.operations.filter(x=>allowed.has(x.permission));const ids=new Set(operations.flatMap(x=>x.frontendAliases));
    return respond(200,{...catalog,mode:'authenticated-design',authorizationFiltered:true,description:'当前账号已授权的操作定义；业务执行仍未实现。',operations,frontendOperations:frontend.operations.filter(x=>x.permission?.anyOf?.length?x.permission.anyOf.some(p=>allowed.has(p)):x.permission?.required?x.permission.required==='self'||allowed.has(x.permission.required):ids.has(x.id)),userVersion:actor.version,scope:actor.scope});
   }
   if(pathname==='/v1/admin/audit'&&req.method==='GET'){
    action='audit.query';if(!actor.roleIds.includes('superadmin')&&!effectivePermissions(actor).includes('audit.read'))reject(403,'FORBIDDEN','无操作日志查看权限');
    const query=new URL(req.url,'http://local').searchParams;const from=query.get('from'),to=query.get('to');if((from&&!Number.isFinite(Date.parse(from)))||(to&&!Number.isFinite(Date.parse(to))))reject(400,'INVALID_DATE','日期筛选无效');
    if(from&&to&&Date.parse(from)>Date.parse(to))reject(400,'INVALID_DATE','开始日期不能晚于结束日期');
    const count=query.has('limit')?Number(query.get('limit')):100;if(!Number.isInteger(count)||count<1||count>500)reject(400,'INVALID_LIMIT','每页数量须为 1–500');
    let result=store.state.audit.filter(x=>(!query.get('actor')&&!query.get('actorId')||x.actorId===(query.get('actor')||query.get('actorId')))&&(!query.get('action')||x.action===query.get('action'))&&(!query.get('outcome')||x.outcome===query.get('outcome'))&&(!from||Date.parse(x.at)>=Date.parse(from))&&(!to||Date.parse(x.at)<=Date.parse(to))).slice().reverse();
    if(query.get('before')){const index=result.findIndex(x=>x.id===query.get('before'));if(index<0)reject(400,'INVALID_CURSOR','日志分页位置无效');result=result.slice(index+1);}
    writeAudit(req,action,'success',actor,null,{resultCount:Math.min(count,result.length)});return respond(200,{events:result.slice(0,count),hasMore:result.length>count,nextBefore:result.length>count?result[count-1].id:null});
   }
   if(pathname==='/v1/admin/users'){
    action=req.method==='POST'?'account.create':'account.list';admin(actor);
    if(req.method==='GET'){writeAudit(req,action,'success',actor);return respond(200,{users:store.state.users.map(publicUser)});}
    if(req.method==='POST'){const body=await jsonBody(req);({user:actor,session}=reauthenticate(req,{adminOnly:true}));const created=makeUser(body,store.state.users);store.transact(s=>{s.users.push(created.user);audit(s,req,action,'success',actor,created.user.id,{username:created.user.username,roleIds:created.user.roleIds,scope:created.user.scope});});return respond(201,{user:publicUser(created.user),initialPassword:created.password});}
   }
   const match=pathname.match(/^\/v1\/admin\/users\/([a-z0-9-]+)(\/reset-password)?$/);
   if(match){targetId=match[1];action=match[2]?'account.resetPassword':'account.update';admin(actor);let found=store.state.users.find(u=>u.id===targetId);if(!found)reject(404,'USER_NOT_FOUND','账号不存在');
    if(match[2]&&req.method==='POST'){const body=await jsonBody(req);({user:actor,session}=reauthenticate(req,{adminOnly:true}));fields(body,[]);const password=initialPassword(),passwordHash=hashPassword(password);const user=store.transact(s=>{const target=s.users.find(u=>u.id===targetId);target.passwordHash=passwordHash;target.mustChangePassword=true;revoke(s,target);audit(s,req,action,'success',actor,targetId);return publicUser(target);});return respond(200,{user,initialPassword:password});}
    if(!match[2]&&req.method==='PATCH'){const body=await jsonBody(req);({user:actor,session}=reauthenticate(req,{adminOnly:true}));found=store.state.users.find(u=>u.id===targetId);if(!found)reject(404,'USER_NOT_FOUND','账号不存在');fields(body,['name','roleIds','scope','disabled','additionalPermissions','deniedPermissions']);if(!Object.keys(body).length)reject(400,'NO_CHANGES','请指定修改内容');if(body.disabled!==undefined&&typeof body.disabled!=='boolean')reject(400,'INVALID_INPUT','停用状态无效');const changes={...normalizePolicy(body,found),...(body.name===undefined?{}:{name:text(body.name,'姓名')}),...(body.disabled===undefined?{}:{disabled:body.disabled})};const user=store.transact(s=>{const target=s.users.find(u=>u.id===targetId);const candidate={...target,...changes};if(target.roleIds.includes('superadmin'))guardLastAdmin(s,candidate);Object.assign(target,changes);revoke(s,target);audit(s,req,action,'success',actor,targetId,{roleIds:target.roleIds,scope:target.scope,additionalPermissions:target.additionalPermissions,deniedPermissions:target.deniedPermissions,disabled:target.disabled});return publicUser(target);});return respond(200,{user});}
   }
   const operationMatch=pathname.match(/^\/v1\/operations\/([a-zA-Z]+\.[a-zA-Z]+)\/(preview|execute)$/);
   if(operationMatch){action=operationMatch[1];const operation=catalog.operations.find(x=>x.id===action);if(!operation)reject(404,'NOT_FOUND','未登记此操作');if(!effectivePermissions(actor).includes(operation.permission))reject(403,'FORBIDDEN','没有此操作权限');}
   else {
    const readPermission={'/v1/students':'student.read','/v1/employees':'staff.read','/v1/leads':'lead.read','/v1/orders':'order.read','/v1/schedule':'schedule.read','/v1/audit-events':'audit.read'}[pathname];
    if(readPermission&&!effectivePermissions(actor).includes(readPermission))reject(403,'FORBIDDEN','没有此资料查看权限');
    if(pathname.startsWith('/v1/payment-webhooks/'))reject(501,'NOT_IMPLEMENTED','支付回调尚未实现');
   }
   if(pathname.startsWith('/v1/auth/')||pathname.startsWith('/v1/admin/'))reject(404,'NOT_FOUND','没有此接口');
   if(operationMatch||pathname.startsWith('/v1/'))writeAudit(req,action,'not_implemented',actor,targetId,{path:pathname.slice(0,200)});
   return false;
  }catch(error){
   const status=error.status||500;const code=error.code||'STORAGE_UNAVAILABLE';
   try{writeAudit(req,action,'denied',actor,targetId,{code});}catch{return respond(503,{requestId:req.requestId,code:'STORAGE_UNAVAILABLE',message:'认证存储暂不可用，请稍后重试'});}
   return respond(status,{requestId:req.requestId,code,message:status>=500?'认证服务暂不可用，请稍后重试':error.message});
  }
 }
 return {handle,close:()=>store.close(),store};
}
module.exports={createAuthService,makeUser};
