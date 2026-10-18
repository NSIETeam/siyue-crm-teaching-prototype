'use strict';
// Build only: this script has no SSH, network, Nginx, or server side effects.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {sourceContext}=require('./release-source.cjs');
const repo=path.resolve(__dirname,'../..');
function sha(bytes){return crypto.createHash('sha256').update(bytes).digest('hex');}
function build(outParent,releaseId,snapshotPath){
 if(!outParent||!path.isAbsolute(outParent))throw Error('--out must be an existing absolute directory');
 const outputParent=fs.realpathSync(outParent);
 if(outputParent===repo||outputParent.startsWith(repo+path.sep))throw Error('Write release artifacts outside the repository');
 const files=JSON.parse(fs.readFileSync(path.join(__dirname,'public-files.json'),'utf8'));
 const allowed=new Set(files);
 if(allowed.size!==files.length||!allowed.has('index.html'))throw Error('Invalid allowlist');
 for(const file of files){
  if(!/^(?:[A-Za-z0-9_-]+\.(?:html|js|css|csv)|assets\/[A-Za-z0-9_.-]+\.(?:png|svg|jpg|webp|woff2))$/.test(file))throw Error('Disallowed public path: '+file);
  const source=path.join(repo,file);if(!fs.lstatSync(source).isFile()||fs.lstatSync(source).isSymbolicLink())throw Error('Not a regular file: '+file);
  if(fs.realpathSync(source)!==source)throw Error('Symlink in source path: '+file);
 }
 const context=sourceContext(files,snapshotPath),{revision,source,buffers}=context;
 const identity=revision?revision.slice(0,12):'snapshot-'+source.snapshotId.slice(0,12);
 const id=releaseId||new Date().toISOString().replace(/[-:TZ.]/g,'').slice(0,14)+'-'+identity;
 if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(id))throw Error('Invalid release ID');
 const html=buffers.get('index.html').toString('utf8');
 for(const [,link] of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)){
  if(link.startsWith('#')||link.startsWith('data:'))continue;
  if(!allowed.has(link))throw Error('HTML dependency is not in public-files.json: '+link);
 }
 for(const [file,bytes] of buffers)if(file.endsWith('.css'))for(const [,raw] of bytes.toString('utf8').matchAll(/url\(\s*["']?([^\s)'";]+)["']?\s*\)/g)){
  if(raw.startsWith('data:')||raw.startsWith('#'))continue;
  const reference=path.posix.normalize(path.posix.join(path.posix.dirname(file),raw));
  if(!allowed.has(reference))throw Error('CSS dependency is not in public-files.json: '+raw);
 }
 const output=path.join(outputParent,id),archive=output+'.tar.gz';
 if(fs.existsSync(output)||fs.existsSync(archive)||fs.existsSync(archive+'.sha256'))throw Error('Release destination already exists');
 fs.mkdirSync(output);
 const hashes=[];
 for(const [file,bytes] of buffers){const dest=path.join(output,'public',file);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,bytes,{mode:0o644});hashes.push({path:file,sha256:sha(bytes),bytes:bytes.length});}
 context.verify();
 fs.writeFileSync(path.join(output,'release-manifest.json'),JSON.stringify({releaseId:id,revision,source,builtAt:new Date().toISOString(),type:'static-frontend',backendIncluded:false,files:hashes},null,2)+'\n');
 fs.writeFileSync(path.join(output,'public-files.list'),files.slice().sort().join('\n')+'\n');
 fs.writeFileSync(path.join(output,'SHA256SUMS'),hashes.map(x=>`${x.sha256}  public/${x.path}`).sort().join('\n')+'\n');
 const metadata=['release-manifest.json','public-files.list','SHA256SUMS'];
 if(context.snapshotBytes){fs.writeFileSync(path.join(output,'source-snapshot.json'),context.snapshotBytes,{mode:0o600});metadata.push('source-snapshot.json');}
 execFileSync('tar',['-czf',archive,'-C',output,'public',...metadata],{stdio:'pipe',env:{...process.env,COPYFILE_DISABLE:'1'}});
 const archiveSha=sha(fs.readFileSync(archive));
 fs.writeFileSync(archive+'.sha256',`${archiveSha}  ${path.basename(archive)}\n`);
 return {releaseId:id,revision,source,files:files.length,releaseDirectory:output,archive,archiveSha256:archiveSha};
}
if(require.main===module){
 try{const args=process.argv.slice(2);let out,id,snapshot;for(let i=0;i<args.length;i+=2){if(!args[i+1])throw Error('Missing build option value');if(args[i]==='--out')out=args[i+1];else if(args[i]==='--release-id')id=args[i+1];else if(args[i]==='--source-snapshot')snapshot=args[i+1];else throw Error('Usage: node deploy/aliyun/build-release.cjs --out /absolute/staging-directory [--release-id name] [--source-snapshot /absolute/source-snapshot.json]');}console.log(JSON.stringify(build(out,id,snapshot),null,2));}
 catch(error){console.error(error.message);process.exitCode=1;}
}
module.exports={build};
