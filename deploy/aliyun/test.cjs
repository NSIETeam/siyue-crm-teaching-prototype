'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {build}=require('./build-release.cjs');
const {build:buildAuth}=require('./build-auth-release.cjs');
const {createSnapshot,sourceContext,inventory,sha}=require('./release-source.cjs');
const {config}=require('./nginx-candidate.cjs');
function temporary(t,prefix){const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),prefix)));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
function snapshotFor(parent){const file=path.join(parent,'source-snapshot.json');createSnapshot(file);return file;}
function isolatedSource(t){
 const parent=temporary(t,'siyue-source-fixture-'),root=path.join(parent,'source'),out=path.join(parent,'output');fs.mkdirSync(root);fs.mkdirSync(out);
 for(const name of inventory()){const dest=path.join(root,name);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(path.resolve(__dirname,'../..',name),dest);}
 const source=require(path.join(root,'deploy/aliyun/release-source.cjs'));
 return {root,out,source};
}
test('explicit snapshot release contains exactly allowlisted frontend bytes, and refuses overwrite',t=>{
 const parent=fs.mkdtempSync(path.join(os.tmpdir(),'siyue-release-test-'));t.after(()=>fs.rmSync(parent,{recursive:true,force:true}));
 const snapshot=snapshotFor(fs.realpathSync(parent)),release=build(parent,'local-test',snapshot);const manifest=JSON.parse(fs.readFileSync(path.join(release.releaseDirectory,'release-manifest.json'),'utf8'));
 assert.equal(manifest.backendIncluded,false);assert.equal(manifest.files.length,require('./public-files.json').length);
 assert.equal(manifest.revision,null);assert.equal(manifest.source.kind,'source-snapshot');assert.equal(manifest.source.manifestSha256,sha(fs.readFileSync(snapshot)));
 for(const name of ['work-tabs.js','work-tabs.css','crm-layout-consistency.css','java-crm-needs.js','java-crm-needs.css'])assert.ok(manifest.files.some(file=>file.path===name));
 const published=new Set(manifest.files.map(file=>file.path));
 const html=fs.readFileSync(path.join(release.releaseDirectory,'public/index.html'),'utf8');
 for(const [,asset] of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)){
  if(asset.startsWith('#')||asset.startsWith('data:'))continue;
  assert.ok(published.has(asset),'Every index resource must be published: '+asset);
 }
 for(const file of manifest.files){const bytes=fs.readFileSync(path.join(release.releaseDirectory,'public',file.path));assert.equal(bytes.length,file.bytes);assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),file.sha256);assert.ok(!/^(backend|docs|tests|cli|\.git)\//.test(file.path));}
 const archive=execFileSync('tar',['-tzf',release.archive],{encoding:'utf8'}).trim().split('\n');
 assert.ok(archive.every(file=>file==='public/'||file==='public/assets/'||file.startsWith('public/')||['release-manifest.json','public-files.list','SHA256SUMS','source-snapshot.json'].includes(file)));
 assert.ok(!archive.some(file=>file.startsWith('/')||file.includes('..')||file.includes('._')));
 assert.throws(()=>build(parent,'local-test',snapshot),/already exists/);
});
test('nginx candidate requires explicit isolated path and preserves server settings',()=>{
 const result=config('/sample-crm/','/srv/sample-crm');
 assert.match(result,/alias \/srv\/sample-crm\/current\/public\//);assert.match(result,/location \^~ \/sample-crm\//);
 assert.doesNotMatch(result,/\n\s*(?:listen|server_name|proxy_pass|add_header)\s/);
 assert.throws(()=>config('/','/srv/sample-crm'));
 assert.throws(()=>config('/crm/;','/srv/sample-crm'));
 assert.throws(()=>config('/crm/','/srv/../existing'));
});
test('activation script parses as POSIX shell without changing any server',()=>{
 execFileSync('sh',['-n',path.join(__dirname,'activate-release.sh')]);
});

test('authentication release excludes private stores and includes every runtime dependency',t=>{
 const parent=fs.mkdtempSync(path.join(os.tmpdir(),'siyue-auth-release-test-'));t.after(()=>fs.rmSync(parent,{recursive:true,force:true}));
 const snapshot=snapshotFor(fs.realpathSync(parent)),result=buildAuth(parent,'auth-local-test',snapshot);
 const archive=execFileSync('tar',['-tzf',result.archive],{encoding:'utf8'}).trim().split('\n');
 const files=new Set(result.files.map(file=>file.path));
 assert.equal(archive.length,files.size+2);
 assert.ok(archive.every(p=>!p.includes('._')&&!p.includes('initial-admin')&&!p.includes('auth.json')&&!p.includes('session.json')&&!p.includes('node_modules')&&!p.includes('.sqlite')&&!p.includes('/tests/')));
 assert.equal(result.revision,null);assert.equal(result.source.kind,'source-snapshot');assert.ok(fs.existsSync(result.archive+'.sha256'));
 assert.throws(()=>buildAuth(parent,'auth-local-test',snapshot),/already exists/);
 for(const file of result.files){
  const bytes=fs.readFileSync(path.join(parent,result.releaseId,file.path));
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),file.sha256);
  if(!/\.(?:cjs|js)$/.test(file.path))continue;
  for(const match of bytes.toString().matchAll(/require\(['"](\.[^'"]+)['"]\)/g)){
   const dependency=path.posix.normalize(path.posix.join(path.posix.dirname(file.path),match[1]));
   assert.ok(files.has(dependency),`${file.path} requires missing release file ${dependency}`);
  }
 }
 // Load the packaged service from its isolated directory, without starting a server.
 execFileSync(process.execPath,['-e',"require('./backend/src/business-service.cjs');require('./backend/src/auth-service.cjs')"],{cwd:path.join(parent,result.releaseId),stdio:'pipe'});
});

test('snapshot identity is content based, records no revision, and refuses source edits',t=>{
 const {root,out,source}=isolatedSource(t),first=path.join(out,'first.json'),second=path.join(out,'second.json');
 assert.equal(source.createSnapshot(first).snapshotId,source.createSnapshot(second).snapshotId);
 const context=source.sourceContext(['index.html'],first);assert.equal(context.revision,null);context.verify();
 fs.appendFileSync(path.join(root,'work-tabs.js'),'\n// changed fixture\n');
 assert.throws(()=>context.verify(),/Source changed/);assert.throws(()=>source.sourceContext(['index.html'],first),/Source changed/);
});
test('snapshot rejects tampered inventory, identity and symlink manifests',t=>{
 const parent=temporary(t,'siyue-snapshot-invalid-'),snapshot=snapshotFor(parent),original=JSON.parse(fs.readFileSync(snapshot));
 const invalid=path.join(parent,'invalid.json');
 fs.writeFileSync(invalid,JSON.stringify({...original,files:[...original.files,{path:'auth.json',bytes:0,sha256:'0'.repeat(64)}]}));assert.throws(()=>sourceContext(['index.html'],invalid),/inventory/);
 fs.writeFileSync(invalid,JSON.stringify({...original,snapshotId:'0'.repeat(64)}));assert.throws(()=>sourceContext(['index.html'],invalid),/identity mismatch/);
 const linked=path.join(parent,'linked.json');fs.symlinkSync(snapshot,linked);assert.throws(()=>sourceContext(['index.html'],linked),/without symlinks/);
 assert.throws(()=>createSnapshot(snapshot),/EEXIST/);
});
test('snapshot rejects linked source and excludes unlisted private data',t=>{
 const {root,out,source}=isolatedSource(t);fs.writeFileSync(path.join(root,'auth.json'),'synthetic private fixture');
 const snapshot=path.join(out,'source.json');source.createSnapshot(snapshot);assert.ok(!JSON.parse(fs.readFileSync(snapshot)).files.some(file=>file.path==='auth.json'));
 const entry=path.join(root,'index.html'),other=path.join(out,'index.html');fs.renameSync(entry,other);fs.symlinkSync(other,entry);
 assert.throws(()=>source.sourceContext(['index.html'],snapshot),/Not a regular source file/);
});
test('Git mode retains real commit identity and rejects dirty or untracked sources',t=>{
 const {root,out,source}=isolatedSource(t);
 execFileSync('git',['init','-q'],{cwd:root});execFileSync('git',['add','.'],{cwd:root});
 execFileSync('git',['-c','user.name=Release Test','-c','user.email=release-test@example.invalid','commit','-qm','synthetic packaging fixture'],{cwd:root});
 const revision=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),context=source.sourceContext(['index.html']);
 assert.equal(context.revision,revision);assert.equal(context.source.kind,'git-commit');context.verify();
 const built=require(path.join(root,'deploy/aliyun/build-release.cjs')).build(out,'git-fixture');assert.equal(built.revision,revision);
 fs.appendFileSync(path.join(root,'index.html'),'\n');assert.throws(()=>context.verify(),/Commit reviewed/);
 execFileSync('git',['update-index','--assume-unchanged','index.html'],{cwd:root});assert.throws(()=>source.sourceContext(['index.html']),/bytes differ/);
 fs.writeFileSync(path.join(root,'untracked.js'),'');assert.throws(()=>source.sourceContext(['untracked.js']),/not tracked/);
});

test('snapshot manifest mutation is rejected after source capture',t=>{
 const parent=temporary(t,'siyue-snapshot-race-'),snapshot=snapshotFor(parent),context=sourceContext(['index.html'],snapshot);
 fs.appendFileSync(snapshot,'\n');assert.throws(()=>context.verify(),/manifest changed/);
});
test('HTTP verification keeps snapshot and release metadata outside the public surface',()=>{
 const verifier=fs.readFileSync(path.join(__dirname,'verify-http.cjs'),'utf8');
 for(const file of ['source-snapshot.json','auth-release-manifest.json'])assert.ok(verifier.includes("'"+file+"'"));
 assert.ok(!require('./public-files.json').some(file=>/manifest|snapshot|\.json$/.test(file)));
});
