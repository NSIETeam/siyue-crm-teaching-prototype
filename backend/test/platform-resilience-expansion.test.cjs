'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const {BusinessStore}=require('../src/business-store.cjs');
const op=require('../src/business-academic.cjs').operations.find(o=>o.id==='student.create');
const actor={id:'resilience-admin',name:'隔离恢复测试',version:1,roleIds:['superadmin'],permissions:['student.create'],scope:{type:'all'}};
const input={name:'隔离恢复学生',phone:'13900008111',grade:'小四'};
function setup(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'siyue-resilience-')),file=path.join(dir,'business.sqlite');
 let store=new BusinessStore(file);t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
 const p=store.preview(op,input,actor,[],0),args={revision:0,previewToken:p.previewToken,key:crypto.randomUUID()};
 return {dir,file,p,args,get store(){return store;},reopen(){store.close();store=new BusinessStore(file);return store;}};
}
function counts(s){return Object.fromEntries(['business_requests','business_previews'].map(n=>[n,s.db.prepare('SELECT count(*) n FROM '+n).get().n]).concat([['success',s.db.prepare("SELECT count(*) n FROM business_audit WHERE outcome='success'").get().n]]));}

for(const [id,label,trigger] of [
 ['R01','state write failure',"BEFORE UPDATE ON business_state"],
 ['R02','idempotency receipt failure',"BEFORE INSERT ON business_requests"],
 ['R03','last-step preview cleanup failure',"BEFORE DELETE ON business_previews"]
])test(id+' '+label+' rolls back all effects and original request recovers after reopening',t=>{
 const f=setup(t),before=f.store.snapshot(),beforeCounts=counts(f.store);
 f.store.db.exec(`CREATE TRIGGER injected_failure ${trigger} BEGIN SELECT RAISE(ABORT,'isolated injected fault'); END;`);
 assert.throws(()=>f.store.execute(op,input,actor,[],f.args),/isolated injected fault/);
 assert.deepEqual(f.store.snapshot(),before);assert.deepEqual(counts(f.store),beforeCounts);
 f.reopen();assert.deepEqual(f.store.snapshot(),before);f.store.db.exec('DROP TRIGGER injected_failure');
 const saved=f.store.execute(op,input,actor,[],f.args);assert.equal(saved.result.student.id,f.p.result.student.id);
 assert.deepEqual(counts(f.store),{business_requests:1,business_previews:0,success:1});
 assert.equal(f.store.execute(op,input,actor,[],f.args).replayed,true);
});

for(const [id,stage] of [['R04','uncommitted'],['R05','committed']])test(id+' SIGKILL at '+stage+' transaction boundary preserves atomicity and retry safety',{timeout:15000},async t=>{
 const f=setup(t);f.store.close();
 const config={file:f.file,opFile:require.resolve('../src/business-academic.cjs'),storeFile:require.resolve('../src/business-store.cjs'),actor,input,args:f.args,stage};
 const childSource=`const fs=require('node:fs'),c=JSON.parse(process.argv[1]);const s=new(require(c.storeFile).BusinessStore)(c.file),op=require(c.opFile).operations.find(o=>o.id==='student.create');function barrier(){fs.writeSync(1,'BOUNDARY\\n');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);}if(c.stage==='uncommitted'){const audit=s.audit.bind(s);s.audit=(...args)=>{const r=audit(...args);if(args[2]==='success')barrier();return r;};}s.execute(op,c.input,c.actor,[],c.args);barrier();`;
 const child=spawn(process.execPath,['-e',childSource,JSON.stringify(config)],{stdio:['ignore','pipe','pipe']});
 t.after(()=>{if(child.exitCode===null&&!child.signalCode)child.kill('SIGKILL');});
 let stderr='';child.stderr.on('data',d=>stderr+=d);
 await new Promise((resolve,reject)=>{let seen='';child.stdout.on('data',d=>{seen+=d;if(seen.includes('BOUNDARY\n'))resolve();});child.once('error',reject);child.once('exit',()=>reject(Error('premature exit: '+stderr)));});
 const ended=new Promise((resolve,reject)=>{child.once('exit',(code,signal)=>signal==='SIGKILL'?resolve():reject(Error('unexpected exit '+code)));});child.kill('SIGKILL');await ended;
 f.reopen();assert.equal(f.store.db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
 assert.equal(f.store.snapshot().revision,stage==='committed'?1:0);
 assert.deepEqual(counts(f.store),stage==='committed'?{business_requests:1,business_previews:0,success:1}:{business_requests:0,business_previews:1,success:0});
 const result=f.store.execute(op,input,actor,[],f.args);assert.equal(Boolean(result.replayed),stage==='committed');
 assert.equal(f.store.snapshot().state.students.length,1);assert.equal(counts(f.store).success,1);
});

for(const [id,delta,valid] of [['R06',599999,true],['R07',600000,false]])test(id+' preview expiration at '+delta+'ms has exact boundary semantics',t=>{
 const originalNow=Date.now;let now=originalNow();Date.now=()=>now;t.after(()=>{Date.now=originalNow;});const f=setup(t);now+=delta;
 if(valid)assert.equal(f.store.execute(op,input,actor,[],f.args).revision,1);
 else{assert.throws(()=>f.store.execute(op,input,actor,[],f.args),{code:'PREVIEW_EXPIRED'});assert.equal(f.store.snapshot().revision,0);assert.equal(counts(f.store).business_requests,0);}
});
test('R08 reordered JSON properties preserve preview identity and same-key replay',t=>{
 const f=setup(t),reordered={grade:input.grade,phone:input.phone,name:input.name};
 assert.equal(f.store.execute(op,reordered,actor,[],f.args).revision,1);
 assert.equal(f.store.execute(op,input,actor,[],f.args).replayed,true);assert.equal(counts(f.store).success,1);
});
test('R09 preview tokens cannot move between actors and identical keys remain actor-scoped',t=>{
 const f=setup(t),other={...actor,id:'other-admin'};
 assert.throws(()=>f.store.execute(op,input,other,[],f.args),{code:'PREVIEW_EXPIRED'});assert.equal(f.store.snapshot().revision,0);
 f.store.execute(op,input,actor,[],f.args);const next={...input,name:'另一位隔离学生',phone:'13900008112'},p=f.store.preview(op,next,other,[],1);
 f.store.execute(op,next,other,[],{...f.args,revision:1,previewToken:p.previewToken});
 assert.equal(f.store.snapshot().state.students.length,2);assert.equal(counts(f.store).business_requests,2);
});
test('R10 completed request replays after token expiry and later writes without lowering revision',t=>{
 const f=setup(t);f.store.execute(op,input,actor,[],f.args);const next={...input,name:'后续学生',phone:'13900008113'},p=f.store.preview(op,next,actor,[],1);
 f.store.execute(op,next,actor,[],{revision:1,previewToken:p.previewToken,key:crypto.randomUUID()});
 const originalNow=Date.now;Date.now=()=>originalNow()+3600000;t.after(()=>{Date.now=originalNow;});
 const before=f.store.snapshot();const r=f.store.execute(op,input,actor,[],f.args);assert.equal(r.replayed,true);assert.equal(r.revision,1);assert.deepEqual(f.store.snapshot(),before);assert.equal(before.revision,2);
});
test('R11 restored backup retains successful request ledger and replay cannot resurrect a duplicate',async t=>{
 const f=setup(t);f.store.execute(op,input,actor,[],f.args);
 const auth=path.join(f.dir,'auth.json');require('../src/bootstrap-auth.cjs').bootstrap(auth,path.join(f.dir,'delivery.json'));
 const saved=await require('../src/backup-business.cjs').snapshot({businessFile:f.file,authFile:auth,out:path.join(f.dir,'backups')});
 const restored=new BusinessStore(path.join(saved.directory,'business.sqlite'));t.after(()=>restored.close());
 assert.equal(restored.execute(op,input,actor,[],f.args).replayed,true);assert.equal(restored.snapshot().state.students.length,1);assert.equal(counts(restored).success,1);
 assert.equal(restored.db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
});
