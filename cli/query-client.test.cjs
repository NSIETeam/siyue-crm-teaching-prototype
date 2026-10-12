'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {once}=require('node:events');
const {query,queries}=require('./query-client.cjs');

test('named queries reject raw routes, unknown fields and malformed selectors before making any request',async()=>{
 let calls=0;const request=async()=>{calls++;return {};};
 for(const id of ['https://external.example/v1/state','/v1/state','constructor','__proto__'])await assert.rejects(query(id,{},request),{code:'UNKNOWN_QUERY'});
 for(const [id,input] of [['students',{endpoint:'/v1/admin/users'}],['courses',{scope:'all'}],['state',{headers:{}}],['classes',{id:'x\nAuthorization: fake'}],['public-form',{formId:'../admin/users'}],['public-form',{formId:'id?x=1'}],['state',[]],['state',null],['state',Object.create({scope:'all'})]])await assert.rejects(query(id,input,request),{code:'INVALID_QUERY_INPUT'});
 assert.equal(calls,0);
 assert.equal(new Set(queries.map(x=>x.id)).size,queries.length);
 assert(queries.every(x=>x.inputSchema.additionalProperties===false));
});

test('audit filters are encoded without changing their meaning and paging values are checked',async()=>{
 let url;const reply={events:[],hasMore:false};
 const input={actorId:'sales-a',actorQuery:'张三 & 李四',view:'attention',actionPrefix:'refund.',group:'refund',outcome:'denied',from:'2026-10-01T00:00:00+08:00',to:'2026-10-12T23:59:59+08:00',limit:500,before:'audit:one'};
 assert.equal(await query('audit-events',input,async(endpoint,options)=>{url=new URL(endpoint,'http://local');assert.equal(options.method,'GET');return reply;}),reply);
 assert.equal(url.pathname,'/v1/audit-events');
 for(const [key,value] of Object.entries(input))assert.equal(url.searchParams.get(key),String(value));
 for(const input of [{limit:501},{limit:'100'},{limit:0},{before:'a'.repeat(129)},{view:'everything'},{from:'2026-02-30'},{from:'2026-10-12T24:00:00Z'},{from:'2026-10-12T12:00:00'},{from:'2026-10-13',to:'2026-10-12'},{actor:'one',actorId:'two'}])await assert.rejects(query('admin-audit',input,async()=>assert.fail('invalid filters reached server')),{code:'INVALID_QUERY_INPUT'});
});

test('sales followup query does not silently ignore date or activity-only filters',async()=>{
 let endpoint;
 await query('activity',{employeeId:'seller',view:'followups',limit:50,cursor:'followup:lead:3'},async route=>{endpoint=new URL(route,'http://local');return {items:[]};});
 assert.equal(endpoint.pathname,'/v1/sales/activity');assert.equal(endpoint.searchParams.get('cursor'),'followup:lead:3');
 for(const extra of [{from:'2026-10-01'},{to:'2026-10-12'},{leadId:'L1'},{action:'lead.followup'}])await assert.rejects(query('activity',{view:'followups',...extra},async()=>assert.fail('ignored filter sent')),{code:'INVALID_QUERY_INPUT'});
 await query('sales-report',{from:'2026-10-12T12:00:00+08:00',to:'2026-10-12'},async()=>({items:[]}));
 await assert.rejects(query('teacher-report',{observationDays:366},async()=>assert.fail('invalid window sent')),{code:'INVALID_QUERY_INPUT'});
});

test('makeup candidates and attendance roster require stable IDs; callers cannot invent date or teacher overrides',async()=>{
 for(const [id,input] of [['makeup-candidates',{enrollmentId:'E1'}],['attendance-roster',{classId:'C1'}],['attendance-roster',{classId:'C1',sessionId:'S1',date:'2026-10-12'}],['makeup-candidates',{enrollmentId:'E1',sourceSessionId:'S1',teacherId:'T2'}]])await assert.rejects(query(id,input,async()=>assert.fail('invalid selector sent')),{code:'INVALID_QUERY_INPUT'});
 let endpoint;const result={candidates:[],reason:'没有可用课次'};
 assert.equal(await query('makeup-candidates',{enrollmentId:'E1',sourceSessionId:'S1'},async route=>{endpoint=route;return result;}),result);
 assert.equal(endpoint,'/v1/makeup/candidates?enrollmentId=E1&sourceSessionId=S1');
});

test('collection reads select only server-projected rows and preserve server authorization errors',async()=>{
 const projection={revision:7,userVersion:3,state:{courses:[{id:'visible',name:'已授权课程'}],forms:[],settings:{}}};
 const request=async(endpoint,options)=>{assert.equal(endpoint,'/v1/state');assert.deepEqual(options,{method:'GET'});return projection;};
 assert.deepEqual(await query('courses',{id:'hidden'},request),{revision:7,userVersion:3,items:[]});
 assert.deepEqual((await query('courses',{id:'visible'},request)).items,[{id:'visible',name:'已授权课程'}]);
 assert.deepEqual((await query('forms',{},request)).items,[]);
 assert.deepEqual((await query('settings',{},request)).value,{});
 await assert.rejects(query('enrollments',{},async()=>{throw Object.assign(new Error('当前账号无此权限'),{code:'FORBIDDEN',status:403});}),{code:'FORBIDDEN',status:403});
 await assert.rejects(query('courses',{},async()=>({state:{courses:{}}})),{code:'INVALID_RESPONSE'});
});

async function fixture(t){
 const {AuthStore}=require('../backend/src/auth-store.cjs'),{makeUser}=require('../backend/src/auth-service.cjs'),{createServer}=require('../backend/src/server.cjs'),{BusinessStore}=require('../backend/src/business-store.cjs'),auth=require('./auth-client.cjs');
 const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'siyue-query-'))),authFile=path.join(dir,'auth.json'),businessFile=path.join(dir,'business.sqlite'),store=new AuthStore(authFile);
 const identities=[{name:'查询测试管理员',username:'query-admin',roleIds:['superadmin'],scope:{type:'all'}},{name:'查询测试教师',username:'query-teacher',roleIds:['teacher'],scope:{type:'assigned'}},{name:'查询测试校长',username:'query-principal',roleIds:['principal'],additionalPermissions:['audit.read'],scope:{type:'campus',campusIds:['campus-a']}}].map(input=>makeUser(input,[]));
 store.transact(state=>{state.users=identities.map(({user})=>({...user,mustChangePassword:false}));});store.close();
 const server=createServer({auth:{storeFile:authFile,publicOrigin:'https://crm.example.test'},business:{storeFile:businessFile}});
 t.after(async()=>{if(server.listening)await new Promise(resolve=>server.close(resolve));fs.rmSync(dir,{recursive:true,force:true});});
 server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}/`;
 const clients=[];for(const identity of identities){const login=await auth.request(base,'/v1/auth/login',{method:'POST',body:{username:identity.user.username,password:identity.password,client:'cli'}});clients.push({user:login.user,request:(endpoint,options)=>auth.request(base,endpoint,{...options,token:login.token})});}
 const seed=change=>{const business=new BusinessStore(businessFile);try{business.transaction(()=>{const snapshot=business.snapshot();change(snapshot.state,business);business.db.prepare('UPDATE business_state SET data=? WHERE id=1').run(JSON.stringify(snapshot.state));});}finally{business.close();}};
 return {admin:clients[0],teacher:clients[1],principal:clients[2],seed};
}

test('HTTP queries honor teacher records, campus audit scope and server-owned attendance-day rules',async t=>{
 const f=await fixture(t),today=new Date(Date.now()+8*3600000).toISOString().slice(0,10),future=new Date(Date.now()+8*3600000+86400000).toISOString().slice(0,10),teacherId=f.teacher.user.id;
 f.seed((state,store)=>{
  state.campuses=[{id:'campus-a',name:'校区甲'},{id:'campus-b',name:'校区乙'}];
  state.students=[{id:'student-a',name:'本人学生',campusId:'campus-a'},{id:'student-b',name:'其他教师学生',campusId:'campus-b'}];
  state.classes=[{id:'class-a',campusId:'campus-a',teacherId,studentIds:['student-a'],schedule:[{id:'session-today',date:today,time:'00:00–00:01',teacherId},{id:'session-future',date:future,time:'00:00–00:01',teacherId}]},{id:'class-b',campusId:'campus-b',teacherId:'other',studentIds:['student-b'],schedule:[]}];
  state.enrollments=[{id:'enrollment-a',studentId:'student-a',classId:'class-a',status:'active',activatedAt:'2020-01-01T00:00:00Z'},{id:'enrollment-b',studentId:'student-b',classId:'class-b',status:'active',activatedAt:'2020-01-01T00:00:00Z'}];
  state.leads=[{id:'lead-a',name:'本校区线索',campusId:'campus-a'},{id:'lead-b',name:'外校区秘密线索',campusId:'campus-b'}];
  for(const row of state.leads)store.audit(f.admin.user,'lead.update','success',{changes:[{collection:'leads',id:row.id,after:row}]},'query-test-'+row.id);
 });
 assert.deepEqual((await query('enrollments',{},f.teacher.request)).items.map(x=>x.id),['enrollment-a']);
 assert.deepEqual((await query('enrollments',{id:'enrollment-b'},f.teacher.request)).items,[]);
 assert.equal((await query('attendance-roster',{classId:'class-a',sessionId:'session-today'},f.teacher.request)).roster[0].name,'本人学生');
 await assert.rejects(query('attendance-roster',{classId:'class-a',sessionId:'session-future'},f.teacher.request),{code:'ATTENDANCE_DAY_ONLY',status:403});
 await assert.rejects(query('accounts',{},f.teacher.request),{code:'FORBIDDEN',status:403});
 const events=await query('admin-audit',{action:'lead.update',limit:1},f.principal.request);
 assert.equal(events.events.length,1);assert.equal(events.hasMore,false);assert.match(JSON.stringify(events),/本校区线索/);assert(!JSON.stringify(events).includes('外校区秘密线索'));
 const all=await query('audit-events',{action:'lead.update'},f.admin.request),hidden=all.events.find(event=>event.summary.changes[0].id==='lead-b');
 await assert.rejects(query('audit-events',{before:hidden.id},f.principal.request),{code:'INVALID_CURSOR'});
 const catalog=await query('catalog',{},f.admin.request),allOperations=['academic','crm','commerce','teacher-workflow'].flatMap(name=>require('../backend/src/business-'+name+'.cjs').operations),aliases=['lead.follow','leadPolicy.preview','leadPolicy.publish','store.design'];
 assert.deepEqual(new Set(catalog.operations.map(x=>x.id)),new Set(allOperations.filter(x=>!aliases.includes(x.id)).map(x=>x.id)));
});
