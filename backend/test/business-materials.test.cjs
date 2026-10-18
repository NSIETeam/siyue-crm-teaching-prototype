'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createMaterialService,safeExtension,verifyContent}=require('../src/business-materials.cjs');

test('form material upload stores safe PDF assets and returns a public download URL',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'siyue-materials-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const service=createMaterialService({storeFile:path.join(root,'business.sqlite'),publicOrigin:'https://crm.example.test'});
 const buffer=Buffer.from('%PDF-1.7\nexample material');
 const request={method:'POST',headers:{'content-type':'application/octet-stream','x-material-name':encodeURIComponent('课程资料.pdf')},async *[Symbol.asyncIterator](){yield buffer;}};
 let status=0,payload='';
 const response={writeHead(code){status=code;},end(value){payload=String(value);}};
 const audit=[];
 await service.upload(request,response,{id:'employee-1'},{audit(...args){audit.push(args);}},'request-1');
 const result=JSON.parse(payload);
 assert.equal(status,201);
 assert.match(result.id,/^MAT_[A-Za-z0-9_-]{32}$/);
 assert.equal(result.fileName,'课程资料.pdf');
 assert.equal(result.url,`https://crm.example.test/crm-api/v1/public/formMaterials/${result.id}`);
 const file=path.join(service.directory,`${result.id}.pdf`);
 assert.deepEqual(fs.readFileSync(file),buffer);
 assert.equal(fs.statSync(file).mode&0o777,0o600);
 assert.equal(audit[0][1],'form.material.upload');
});

test('form material upload only accepts supported names and matching document signatures',()=>{
 assert.throws(()=>safeExtension('payload.exe'),/仅支持/);
 assert.throws(()=>safeExtension('%2e%2e%2fattack.pdf'),/文件名无效/);
 assert.doesNotThrow(()=>verifyContent(Buffer.from('%PDF-1.4\n'),'.pdf'));
 assert.throws(()=>verifyContent(Buffer.from('not a PDF'),'.pdf'),/文件内容/);
});
