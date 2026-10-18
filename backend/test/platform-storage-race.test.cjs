'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{Worker}=require('node:worker_threads'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {BusinessStore}=require('../src/business-store.cjs'),{operations}=require('../src/business-academic.cjs');
test('eight independent SQLite writers arbitrate revisions and replay one shared key without duplicates',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'siyue-platform-race-')),file=path.join(dir,'business.sqlite'),store=new BusinessStore(file);
 t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
 const actor={id:'qa-writer',name:'隔离并发验证',version:1,roleIds:['academic'],permissions:['student.create'],scope:{type:'all'}},op=operations.find(o=>o.id==='student.create');
 store.db.prepare('UPDATE business_state SET data=? WHERE id=1').run(JSON.stringify({...store.snapshot().state,campuses:[{id:'A',name:'隔离校区',active:true}]}));
 async function compete(shared){
  const revision=store.snapshot().revision,plans=[];
  for(let i=0;i<(shared?1:8);i++){const input={name:'并发学生'+(shared?'共享':i),phone:'1390000'+String(i+1000+(shared?100:0)),campusId:'A'},preview=store.preview(op,input,actor,[],revision);plans.push({input,envelope:{revision,previewToken:preview.previewToken,key:crypto.randomUUID()}});}
  const workers=[],results=[];let ready=0,go;const barrier=new Promise(r=>go=r);
  const source=`const {parentPort,workerData:d}=require('node:worker_threads');const {BusinessStore}=require(d.module);const op=require(d.academic).operations.find(o=>o.id==='student.create');const s=new BusinessStore(d.file);parentPort.once('message',()=>{try{parentPort.postMessage({type:'result',ok:true,value:s.execute(op,d.plan.input,d.actor,[],d.plan.envelope)})}catch(e){parentPort.postMessage({type:'result',ok:false,code:e.code,message:e.message})}finally{s.close()}});parentPort.postMessage({type:'ready'});`;
  for(let i=0;i<8;i++){
   const w=new Worker(source,{eval:true,workerData:{module:require.resolve('../src/business-store.cjs'),academic:require.resolve('../src/business-academic.cjs'),file,actor,plan:plans[shared?0:i]}});workers.push(w);
   results.push(new Promise((resolve,reject)=>{let done=false;w.on('message',m=>{if(m.type==='ready'){if(++ready===8)go();}else{done=true;resolve(m);}});w.on('error',reject);w.on('exit',code=>{if(!done)reject(Error('worker exited '+code));});}));
  }
  t.after(async()=>{await Promise.all(workers.map(w=>w.terminate()));});
  await barrier;workers.forEach(w=>w.postMessage('commit'));const rs=await Promise.all(results);assert.equal(store.snapshot().revision,revision+1);
  if(shared){assert.equal(rs.filter(r=>r.ok).length,8);assert.equal(rs.filter(r=>r.value?.replayed).length,7);}
  else{assert.equal(rs.filter(r=>r.ok).length,1);assert.equal(rs.filter(r=>r.code==='REVISION_CONFLICT').length,7);}
 }
 await compete(false);await compete(true);const snap=store.snapshot();assert.equal(snap.state.students.length,2);assert.equal(store.db.prepare("SELECT count(*) AS n FROM business_audit WHERE action='student.create' AND outcome='success'").get().n,2);assert.equal(store.db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
});
