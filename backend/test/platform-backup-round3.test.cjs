'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{Worker}=require('node:worker_threads');
const {BusinessStore}=require('../src/business-store.cjs');
test('Y04 backup during independent writes restores a complete transaction prefix and matching audit receipts',{timeout:30000},async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'siyue-live-backup-')),file=path.join(dir,'business.sqlite'),auth=path.join(dir,'auth.json');
 require('../src/bootstrap-auth.cjs').bootstrap(auth,path.join(dir,'delivery.json'));const source=new BusinessStore(file);source.close();
 let worker;t.after(async()=>{if(worker)await worker.terminate();fs.rmSync(dir,{recursive:true,force:true});});
 const code=`const {parentPort,workerData:d}=require('node:worker_threads'),crypto=require('node:crypto');const s=new(require(d.store).BusinessStore)(d.file),op=require(d.academic).operations.find(o=>o.id==='student.create'),actor={id:'backup-writer',name:'隔离备份写入',version:1,roleIds:['superadmin'],scope:{type:'all'},permissions:['student.create']};parentPort.once('message',()=>{try{for(let i=0;i<80;i++){const input={name:'备份序列'+i,phone:'1390000'+String(i).padStart(4,'0')},p=s.preview(op,input,actor,[],i);s.execute(op,input,actor,[],{revision:i,previewToken:p.previewToken,key:crypto.randomUUID()});}parentPort.postMessage({done:true});}catch(e){parentPort.postMessage({error:e.message});}finally{s.close();}});parentPort.postMessage({ready:true});`;
 worker=new Worker(code,{eval:true,workerData:{file,store:require.resolve('../src/business-store.cjs'),academic:require.resolve('../src/business-academic.cjs')}});
 const exited=new Promise((resolve,reject)=>{worker.once('exit',code=>code===0?resolve():reject(Error('writer exit '+code)));worker.once('error',reject);});
 let readyResolve,doneResolve,failed;const ready=new Promise((r,j)=>{readyResolve=r;failed=j;}),done=new Promise((r,j)=>{doneResolve=r;worker.on('error',j);});
 worker.on('error',failed);worker.on('message',m=>{if(m.ready)readyResolve();if(m.error){failed(Error(m.error));doneResolve(m);}if(m.done)doneResolve(m);});
 await ready;worker.postMessage('start');const revisions=[];
 for(let i=0;i<4;i++){
  const result=await require('../src/backup-business.cjs').snapshot({businessFile:file,authFile:auth,out:path.join(dir,'backups')}),restored=new BusinessStore(path.join(result.directory,'business.sqlite'));
  try{const snap=restored.snapshot(),n=snap.revision;revisions.push(n);assert(n>=0&&n<=80);assert.equal(snap.state.students.length,n);assert.equal(restored.db.prepare('SELECT count(*) n FROM business_requests').get().n,n);assert.equal(restored.db.prepare("SELECT count(*) n FROM business_audit WHERE outcome='success'").get().n,n);assert.equal(restored.db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.deepEqual(snap.state.students.map(x=>x.name),Array.from({length:n},(_,i)=>'备份序列'+i));}
  finally{restored.close();}
 }
 const completion=await done;assert.equal(completion.done,true,completion.error);await exited;const final=new BusinessStore(file);try{assert.equal(final.snapshot().revision,80);}finally{final.close();}
 t.diagnostic(JSON.stringify({writerTransactions:80,backupRevisions:revisions,scope:'business snapshot consistency only; concurrent auth/material changes not covered'}));
});
