'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {build}=require('./build-release.cjs');
const {config}=require('./nginx-candidate.cjs');
test('release contains exactly allowlisted tracked frontend bytes, and refuses overwrite',t=>{
 const parent=fs.mkdtempSync(path.join(os.tmpdir(),'siyue-release-test-'));t.after(()=>fs.rmSync(parent,{recursive:true,force:true}));
 const release=build(parent,'local-test');const manifest=JSON.parse(fs.readFileSync(path.join(release.releaseDirectory,'release-manifest.json'),'utf8'));
 assert.equal(manifest.backendIncluded,false);assert.equal(manifest.files.length,require('./public-files.json').length);
 for(const file of manifest.files){const bytes=fs.readFileSync(path.join(release.releaseDirectory,'public',file.path));assert.equal(bytes.length,file.bytes);assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),file.sha256);assert.ok(!/^(backend|docs|tests|cli|\.git)\//.test(file.path));}
 const archive=execFileSync('tar',['-tzf',release.archive],{encoding:'utf8'}).trim().split('\n');
 assert.ok(archive.every(file=>file==='public/'||file==='public/assets/'||file.startsWith('public/')||['release-manifest.json','public-files.list','SHA256SUMS'].includes(file)));
 assert.ok(!archive.some(file=>file.startsWith('/')||file.includes('..')||file.includes('._')));
 assert.throws(()=>build(parent,'local-test'),/already exists/);
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

test('authentication release excludes private stores and macOS metadata',t=>{const parent=fs.mkdtempSync(path.join(os.tmpdir(),'siyue-auth-release-test-'));t.after(()=>fs.rmSync(parent,{recursive:true,force:true}));const result=JSON.parse(execFileSync(process.execPath,[path.join(__dirname,'build-auth-release.cjs'),'--out',parent],{encoding:'utf8'}));const archive=execFileSync('tar',['-tzf',result.archive],{encoding:'utf8'}).trim().split('\n');assert.equal(archive.length,12);assert.ok(archive.every(p=>!p.includes('._')&&!p.includes('initial-admin')&&!p.includes('auth.json')&&!p.includes('session.json')));assert.equal(result.files.length,11);for(const file of result.files){const bytes=fs.readFileSync(path.join(parent,result.releaseId,file.path));assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),file.sha256)}});
