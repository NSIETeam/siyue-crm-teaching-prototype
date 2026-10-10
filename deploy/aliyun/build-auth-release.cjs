#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..');
const files=['backend/src/server.cjs','backend/src/auth-policy.cjs','backend/src/auth-store.cjs','backend/src/auth-credentials.cjs','backend/src/auth-service.cjs','backend/src/bootstrap-auth.cjs','backend/contracts/operations.json','backend/contracts/openapi.json','cli/operations.json','deploy/aliyun/siyue-crm-auth.service','deploy/aliyun/auth-api.nginx.conf'];
if(process.argv.length!==4||process.argv[2]!=='--out'||!path.isAbsolute(process.argv[3]))throw Error('Usage: build-auth-release.cjs --out /absolute/directory');
const out=process.argv[3],revision=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const dirty=execFileSync('git',['status','--porcelain','--',...files],{cwd:root,encoding:'utf8'});if(dirty.trim())throw Error('Commit the reviewed authentication source before packaging');
const releaseId='auth-'+new Date().toISOString().replace(/[-:TZ.]/g,'').slice(0,14)+'-'+revision.slice(0,12),stage=path.join(out,releaseId);fs.mkdirSync(stage,{recursive:true});const entries=[];
for(const name of files){const content=execFileSync('git',['show',revision+':'+name],{cwd:root});const target=path.join(stage,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,content,{mode:0o644});entries.push({path:name,bytes:content.length,sha256:crypto.createHash('sha256').update(content).digest('hex')});}
const manifest={releaseId,revision,files:entries};fs.writeFileSync(path.join(stage,'auth-release-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
const archive=path.join(out,releaseId+'.tar.gz');execFileSync('tar',['-czf',archive,'-C',stage,...files,'auth-release-manifest.json']);
console.log(JSON.stringify({...manifest,archive,archiveSha256:crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex')},null,2));
