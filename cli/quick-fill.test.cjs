'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {once}=require('node:events'),{promisify}=require('node:util'),exec=promisify(require('node:child_process').execFile);
const quick=require('./quick-fill.cjs'),auth=require('./auth-client.cjs'),{bootstrap}=require('../backend/src/bootstrap-auth.cjs'),{createServer}=require('../backend/src/server.cjs');
const cli=path.join(__dirname,'siyue-cli.cjs'),operations=['academic','crm','commerce'].flatMap(n=>require('../backend/src/business-'+n+'.cjs').operations),op=id=>operations.find(x=>x.id===id);
function temp(t){const dir=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'siyue-quick-test-'));fs.chmodSync(dir,0o700);t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
const options=extra=>({set:[],...extra});
test('CSV parser preserves quoted commas, embedded newlines and physical line numbers; rejects malformed and duplicate fields',()=>{
 const p=quick.csv('\uFEFF姓名,备注\r\n张同学,"第一行,内容\n第二行"\r\n李同学,无\r\n');assert.equal(p.rows[0].cells[1],'第一行,内容\n第二行');assert.equal(p.rows[1].line,4);
 assert.throws(()=>quick.csv('姓名,姓名\na,b'),/重复/);assert.throws(()=>quick.csv('姓名,电话\na'),/列/);assert.throws(()=>quick.csv('姓名\n"a'),/未闭合/);
});
test('campus room CSV and nested --set carry virtualSeats through the normal schema',t=>{
 const file=path.join(temp(t),'rooms.csv');fs.writeFileSync(file,'教室名称,容量,虚拟座位\nA101,20,3\n');
 const csvResult=quick.prepare(op('campus.create'),options({name:'校区',rows:file}),{});assert.equal(csvResult.errors.length,0);assert.deepEqual(JSON.parse(JSON.stringify(csvResult.input.rooms)),[{name:'A101',capacity:20,virtualSeats:3}]);
 const setResult=quick.prepare(op('campus.create'),options({name:'校区',set:['rooms.0.name=A102','rooms.0.capacity=25','rooms.0.virtualSeats=2']}),{});assert.equal(setResult.errors.length,0);assert.equal(setResult.input.rooms[0].virtualSeats,2);
 const invalid=quick.prepare(op('campus.create'),options({name:'校区',set:['rooms.0.name=A103','rooms.0.capacity=25','rooms.0.virtualSeats=10001']}),{});assert.ok(invalid.errors.some(e=>e.path==='rooms.0.virtualSeats'));
});
test('name resolution uses exact authorized candidates, rejects ambiguity and never chooses a near spelling',()=>{
 const state={students:[{id:'s1',name:'小明',campus:'城中'},{id:'s2',name:'小明',campus:'园区'}],classes:[{id:'c1',name:'四年级数学'}]};
 let r=quick.prepare(op('enrollment.create'),options({class:'四年级数学',student:'小明'}),state);assert.equal(r.errors[0].code,'AMBIGUOUS_REFERENCE');assert.equal(r.errors[0].candidates.length,2);
 r=quick.prepare(op('enrollment.create'),options({class:'四年级数学',student:'s2'}),state);assert.equal(r.errors.length,0);assert.equal(r.input.studentId,'s2');
 r=quick.prepare(op('enrollment.create'),options({class:'四年级数',student:'s2'}),state);assert.equal(r.errors[0].code,'REFERENCE_NOT_FOUND');
});
test('normalization corrects safe input formats and exact decimal yuan, but rejects conflicting monetary inputs',()=>{
 assert.equal(quick.cents('１９９.９９'),19999);assert.equal(quick.cents('0.29'),29);assert.throws(()=>quick.cents('1.005'));assert.throws(()=>quick.cents('1e3'));assert.throws(()=>quick.cents('-1'));
 const input={name:' 张同学 ',phone:'+86 １３９-００００-８８８８',source:' 运营 '};const r=quick.normalize(input,op('lead.create').inputSchema,{});assert.equal(r.input.phone,'13900008888');assert.equal(r.input.name,'张同学');assert.ok(r.corrections.length>=2);
 const rule={type:'object',properties:{priceCents:{type:'integer',minimum:0}},additionalProperties:false};
 assert.equal(quick.normalize({priceCents:null,priceYuan:'199.99'},rule,{}).input.priceCents,19999);
 assert.equal(quick.normalize({priceCents:200,priceYuan:'199.99'},rule,{}).errors[0].code,'DUPLICATE_MONEY');
});
test('batch enrollment collects row errors and corrections without silently dropping students',t=>{
 const dir=temp(t),file=path.join(dir,'students.csv');fs.writeFileSync(file,'姓名,手机号,年级\n张同学,１３９ ００００ ８８８８,四年级\n李同学,123,四年级\n张同学,13900008888,四年级\n');
 const r=quick.prepare(op('enrollment.batchCreate'),options({class:'数学班',rows:file}),{classes:[{id:'c',name:'数学班'}]});
 assert.equal(r.input.rows.length,3);assert.equal(r.input.rows[0].studentDraft.phone,'13900008888');assert.ok(r.errors.some(e=>e.line===3&&e.path==='rows.1.studentDraft.phone'));assert.ok(r.errors.some(e=>e.line===4&&e.code==='DUPLICATE_STUDENT'));assert.ok(r.corrections.some(e=>e.line===2));
 const malformed=path.join(dir,'bad.json');fs.writeFileSync(malformed,JSON.stringify({classId:'c',rows:[null]}));assert.ok(quick.prepare(op('enrollment.batchCreate'),options({input:malformed}),{classes:[{id:'c'}]}).errors.some(e=>e.code==='OBJECT_REQUIRED'));
 fs.writeFileSync(file,'姓名,studentDraft.name\na,b');assert.throws(()=>quick.prepare(op('enrollment.batchCreate'),options({rows:file}),{}),/重复列/);
});
test('section-specific settings schema converts booleans and integers and rejects wrong-section fields and fixed-policy changes',()=>{
 const attendance=quick.prepare(op('settings.update'),options({set:['values.presentConsume=否','values.allowMakeup=是','section= attendance ']}),{});
 assert.equal(attendance.errors.length,0);assert.deepEqual(attendance.input,{section:'attendance',values:{presentConsume:false,allowMakeup:true}});
 const move=quick.prepare(op('settings.update'),options({set:['section=move','values.maxDays=３０','values.requireReason=是']}),{});
 assert.equal(move.errors.length,0);assert.equal(move.input.values.maxDays,30);assert.equal(move.input.values.requireReason,true);
 const invalid=quick.prepare(op('settings.update'),options({set:['section=move','values.maxDays=1.5','values.presentConsume=是','values.sameGrade=否']}),{});
 assert.ok(invalid.errors.some(e=>e.path==='values.maxDays'&&e.code==='INTEGER_REQUIRED'));assert.ok(invalid.errors.some(e=>e.path==='values.presentConsume'&&e.code==='UNKNOWN_FIELD'));assert.ok(invalid.errors.some(e=>e.path==='values.sameGrade'&&e.code==='INVALID_CONSTANT'));
});
test('nested --set paths support generic schema and reject prototype manipulation, duplicate fields and secret flags',()=>{
 const out={};quick.assign(out,'lessons.0.title','分数');quick.assign(out,'lessons.0.durationMinutes','90');assert.equal(out.lessons[0].title,'分数');assert.throws(()=>quick.assign(out,'__proto__.polluted','yes'));assert.equal({}.polluted,undefined);
 assert.throws(()=>quick.parseArguments(['--password','x']));assert.throws(()=>quick.parseArguments(['--name','a','--name','b']));assert.throws(()=>quick.prepare(op('lead.create'),options({name:'a',set:['name=b']}),{}),/重复/);
});
function request(server,endpoint,method='GET',data,token){return new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port:server.address().port,path:endpoint,method,headers:{...(data?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{})}},res=>{let raw='';res.on('data',c=>raw+=c);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(raw)}));});req.on('error',reject);req.end(data?JSON.stringify(data):undefined);});}
async function fixture(t){
 const dir=temp(t),file=path.join(dir,'auth.json'),delivery=path.join(dir,'initial.json');bootstrap(file,delivery);const initial=JSON.parse(fs.readFileSync(delivery));
 const server=createServer({auth:{storeFile:file,publicOrigin:'https://quick.example.test'},business:{storeFile:path.join(dir,'business.sqlite')}});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(r=>server.close(r)));
 const login=(username,password)=>request(server,'/v1/auth/login','POST',{username,password,client:'cli'});
 const first=await login(initial.username,initial.initialPassword),password='Quick-Test!7382Aa';await request(server,'/v1/auth/password','POST',{currentPassword:initial.initialPassword,newPassword:password},first.body.token);const ready=await login(initial.username,password),token=ready.body.token;
 const env={...process.env,SIYUE_CONFIG_DIR:path.join(dir,'cli')};auth.writeSession({server:`http://127.0.0.1:${server.address().port}/`,token,expiresAt:ready.body.expiresAt},env);
 const run=async(args,expected=0)=>{try{const r=await exec(process.execPath,[cli,...args],{env});assert.equal(expected,0);return JSON.parse(r.stdout);}catch(e){if(expected===0)throw e;assert.equal(e.code,expected,e.stderr);return e.stdout?JSON.parse(e.stdout):{stderr:e.stderr};}};
 const cliLogin=await exec(process.execPath,[cli,'login','--username',initial.username,'--server',`http://127.0.0.1:${server.address().port}/`],{env:{...env,SIYUE_PASSWORD:password}});assert.equal(JSON.parse(cliLogin.stdout).authenticated,true);assert.equal(cliLogin.stdout.includes(password),false);
 const call=(p,m='GET',d)=>request(server,p,m,d,token);
 return {dir,env,server,login,token,run,call};
}
test('CLI quick fill creates actual shared campus/course/class/schedule/enrollment via preview, then idempotent execute',async t=>{
 const f=await fixture(t);let sequence=0;
 const commit=async(id,args=[])=>{const file=path.join(f.dir,`plan-${++sequence}.json`),planned=await f.run(['fill',id,...args,'--out',file]);assert.equal(planned.commit,false);assert.equal(planned.valid,true);assert.equal(fs.statSync(file).mode&0o777,0o600);const r=await f.run(['execute','--plan',file]);return {planned,result:r.result,file};};
 const template=path.join(f.dir,'template.csv');await f.run(['template','批量报名','--format','csv','--out',template]);assert.equal(fs.statSync(template).mode&0o777,0o600);assert.match(fs.readFileSync(template,'utf8'),/姓名,手机号/);const campusTemplate=path.join(f.dir,'campuses.csv');await f.run(['template','校区','--format','csv','--out',campusTemplate]);assert.match(fs.readFileSync(campusTemplate,'utf8'),/教室名称,容量,虚拟座位/);
 const invalid=await f.run(['check','线索','--name','小明'],2);assert.equal(invalid.valid,false);assert.ok(invalid.errors.some(e=>e.path==='phone'));assert.equal((await f.call('/v1/state')).body.revision,0);
 await commit('校区',['--name','快填校区','--set','rooms.0.name=教室01','--set','rooms.0.capacity=20','--set','rooms.0.virtualSeats=2']);assert.equal((await f.call('/v1/state')).body.state.campuses[0].roomDetails[0].virtualSeats,2);
 const teacher=await f.call('/v1/admin/users','POST',{name:'快填老师',employeeNo:'QF-T01',roleIds:['teacher'],scope:{type:'assigned'}});assert.equal(teacher.status,201);
 await commit('课程',['--name','四年级数学','--campus','快填校区','--grade','四年级','--subject','数学','--price','1200.29','--set','lessons.0.title=分数','--set','lessons.0.durationMinutes=90']);
 const klass=await commit('建班',['--name','数学一班','--course','四年级数学','--campus','快填校区','--teacher','快填老师','--room','教室01','--capacity','20']);assert.equal(klass.result.class.teacherId,teacher.body.user.id);
 const schedule=path.join(f.dir,'schedule.csv');fs.writeFileSync(schedule,'讲次,日期,时间\n分数,2099-01-01,09:00-10:30\n');const scheduled=await commit('排课',['--class','数学一班','--rows',schedule]);assert.equal(scheduled.result.class.schedule.length,1);
 const rows=path.join(f.dir,'students.csv');fs.writeFileSync(rows,'姓名,手机号,年级\n快填甲,１３９ ００００ ８８８８,四年级\n快填乙,13900008889,四年级\n');
 const correctCSV=fs.readFileSync(rows,'utf8');fs.writeFileSync(rows,correctCSV.replace('13900008889','123'));
 const rejectedFile=path.join(f.dir,'bad.plan.json'),bad=await f.run(['fill','批量报名','--class','数学一班','--rows',rows,'--out',rejectedFile],2);assert.equal(bad.errors[0].line,3);assert.equal(fs.existsSync(rejectedFile),false);assert.equal((await f.call('/v1/state')).body.state.students.length,0);fs.writeFileSync(rows,correctCSV);
 const checked=await f.run(['check','批量报名','--class','数学一班','--rows',rows]);assert.equal(checked.valid,true);assert.equal((await f.call('/v1/state')).body.state.students.length,0);
 const enrolled=await commit('批量报名',['--class','数学一班','--rows',rows]);assert.equal(enrolled.result.results.length,2);
 const repeat=await f.run(['execute','--plan',enrolled.file]);assert.equal(repeat.replayed,true);const state=(await f.call('/v1/state')).body.state;assert.equal(state.students.length,2);assert.equal(state.orders.length,2);assert.equal(state.orders[0].amountCents,120029);
 // Scope/role changes invalidate the original server session; quick filling is not an auth bypass.
 const sales=await f.call('/v1/admin/users','POST',{name:'快填销售',employeeNo:'QF-S01',roleIds:['sales']});const first=await f.login(sales.body.user.username,sales.body.initialPassword);await request(f.server,'/v1/auth/password','POST',{currentPassword:sales.body.initialPassword,newPassword:'Sales-Quick!783Aa'},first.body.token);const login=await f.login(sales.body.user.username,'Sales-Quick!783Aa');auth.writeSession({server:`http://127.0.0.1:${f.server.address().port}/`,token:login.body.token,expiresAt:login.body.expiresAt},f.env);
 const denied=await f.run(['template','建班','--out',path.join(f.dir,'forbidden.json')],1);assert.match(denied.stderr,/FORBIDDEN/);assert.equal(fs.existsSync(path.join(f.dir,'forbidden.json')),false);
 const file=path.join(f.dir,'sales.plan.json');await f.run(['fill','线索','--name','销售线索','--phone','13900008880','--source','销售自拓','--out',file]);await f.call('/v1/admin/users/'+sales.body.user.id,'PATCH',{deniedPermissions:['lead.create']});await f.run(['execute','--plan',file],1);assert.equal((await f.call('/v1/state')).body.state.leads.length,0);
});

test('real CLI applies section-specific settings through checked preview and commit with typed shared state',async t=>{
 const f=await fixture(t),attendance=['--set','section=attendance','--set','values.presentConsume=否','--set','values.allowMakeup=是'];
 const checked=await f.run(['check','settings.update',...attendance]);assert.equal(checked.valid,true);assert.equal(checked.input.values.presentConsume,false);assert.equal(checked.input.values.allowMakeup,true);assert.equal((await f.call('/v1/state')).body.revision,0);
 const file=path.join(f.dir,'attendance.plan.json');await f.run(['fill','settings.update',...attendance,'--out',file]);await f.run(['execute','--plan',file]);
 let state=(await f.call('/v1/state')).body.state;assert.deepEqual(state.settings.attendance,{presentConsume:false,allowMakeup:true});
 const moveFile=path.join(f.dir,'move.plan.json');const move=await f.run(['fill','settings.update','--set','section=move','--set','values.maxDays=３０','--set','values.requireReason=是','--out',moveFile]);assert.equal(move.input.values.maxDays,30);await f.run(['execute','--plan',moveFile]);
 state=(await f.call('/v1/state')).body.state;assert.equal(state.settings.move.maxDays,30);assert.equal(state.settings.move.requireReason,true);
 const invalidFile=path.join(f.dir,'invalid-settings.plan.json'),invalid=await f.run(['fill','settings.update','--set','section=move','--set','values.sameGrade=否','--out',invalidFile],2);assert.ok(invalid.errors.some(e=>e.code==='INVALID_CONSTANT'));assert.equal(fs.existsSync(invalidFile),false);assert.equal((await f.call('/v1/state')).body.revision,2);
});
