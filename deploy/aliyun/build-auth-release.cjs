#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {sourceContext,sha}=require('./release-source.cjs');
const root=path.resolve(__dirname,'../..');
function build(outParent,releaseId,snapshotPath){
 if(!outParent||!path.isAbsolute(outParent))throw Error('--out must be an existing absolute directory');
 const out=fs.realpathSync(outParent);if(out===root||out.startsWith(root+path.sep))throw Error('Write authentication release artifacts outside the repository');
 const files=JSON.parse(fs.readFileSync(path.join(__dirname,'auth-files.json'),'utf8'));
 for(const file of files)if(!/^(?:contracts\.cjs|(?:backend\/src|cli)\/[A-Za-z0-9_-]+\.cjs|backend\/contracts\/(?:operations|openapi)\.json|cli\/operations\.json|academic-dictionary\.js|deploy\/aliyun\/[A-Za-z0-9_.-]+\.(?:sh|service|timer|conf))$/.test(file))throw Error('Disallowed service path: '+file);
 const context=sourceContext(files,snapshotPath),{revision,source,buffers}=context;
 const identity=revision?revision.slice(0,12):'snapshot-'+source.snapshotId.slice(0,12);
 const id=releaseId||'auth-'+new Date().toISOString().replace(/[-:TZ.]/g,'').slice(0,14)+'-'+identity;
 if(!/^auth-[A-Za-z0-9][A-Za-z0-9_-]{0,74}$/.test(id))throw Error('Invalid authentication release ID');
 const stage=path.join(out,id),archive=stage+'.tar.gz';
 if(fs.existsSync(stage)||fs.existsSync(archive)||fs.existsSync(archive+'.sha256'))throw Error('Release destination already exists');
 // Check relative runtime dependencies before emitting a partial release.
 const allowed=new Set(files);
 for(const [name,bytes] of buffers)if(/\.(?:cjs|js)$/.test(name))for(const [,relative] of bytes.toString('utf8').matchAll(/require\(['"](\.[^'"]+)['"]\)/g)){
  const dependency=path.posix.normalize(path.posix.join(path.posix.dirname(name),relative));
  if(!allowed.has(dependency))throw Error(name+' requires missing release file '+dependency);
 }
 fs.mkdirSync(stage);const entries=[];
 for(const [name,content] of buffers){const target=path.join(stage,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,content,{mode:0o644});entries.push({path:name,bytes:content.length,sha256:sha(content)});}
 context.verify();
 const manifest={releaseId:id,revision,source,builtAt:new Date().toISOString(),type:'node-auth-business',files:entries};
 fs.writeFileSync(path.join(stage,'auth-release-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
 const metadata=['auth-release-manifest.json'];
 if(context.snapshotBytes){fs.writeFileSync(path.join(stage,'source-snapshot.json'),context.snapshotBytes,{mode:0o600});metadata.push('source-snapshot.json');}
 execFileSync('tar',['-czf',archive,'-C',stage,...files,...metadata],{stdio:'pipe',env:{...process.env,COPYFILE_DISABLE:'1'}});
 const archiveSha256=sha(fs.readFileSync(archive));fs.writeFileSync(archive+'.sha256',`${archiveSha256}  ${path.basename(archive)}\n`);
 return {...manifest,releaseDirectory:stage,archive,archiveSha256};
}
if(require.main===module){
 try{const args=process.argv.slice(2);let out,id,snapshot;for(let i=0;i<args.length;i+=2){if(!args[i+1])throw Error('Missing build option value');if(args[i]==='--out')out=args[i+1];else if(args[i]==='--release-id')id=args[i+1];else if(args[i]==='--source-snapshot')snapshot=args[i+1];else throw Error('Usage: build-auth-release.cjs --out /absolute/directory [--release-id auth-name] [--source-snapshot /absolute/source-snapshot.json]');}console.log(JSON.stringify(build(out,id,snapshot),null,2));}
 catch(error){console.error(error.message);process.exitCode=1;}
}
module.exports={build};
