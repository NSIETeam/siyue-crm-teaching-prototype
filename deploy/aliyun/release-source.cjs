'use strict';
// Explicit, allowlisted source identity. No network, account stores, or repository mutation.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..');
const tooling=['deploy/aliyun/public-files.json','deploy/aliyun/auth-files.json','deploy/aliyun/release-source.cjs','deploy/aliyun/build-release.cjs','deploy/aliyun/build-auth-release.cjs','deploy/aliyun/activate-release.sh','deploy/aliyun/verify-http.cjs','deploy/aliyun/nginx-candidate.cjs','deploy/aliyun/README.md','deploy/aliyun/test.cjs'];
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function inventory(){
 const publicFiles=JSON.parse(fs.readFileSync(path.join(__dirname,'public-files.json'),'utf8'));
 const authFiles=JSON.parse(fs.readFileSync(path.join(__dirname,'auth-files.json'),'utf8'));
 return [...new Set([...publicFiles,...authFiles,...tooling])].sort();
}
function readSource(name){
 if(typeof name!=='string'||!name||path.isAbsolute(name)||name.split('/').some(part=>!part||part==='.'||part==='..')||name.includes('\\'))throw Error('Invalid source path');
 const file=path.join(root,name),stat=fs.lstatSync(file);
 if(!stat.isFile()||stat.isSymbolicLink()||fs.realpathSync(file)!==file)throw Error('Not a regular source file: '+name);
 return fs.readFileSync(file);
}
function entriesFor(names){return names.map(name=>{const bytes=readSource(name);return {path:name,bytes:bytes.length,sha256:sha(bytes)};});}
function outsideSource(file){
 if(!file||!path.isAbsolute(file))throw Error('Expected an absolute path outside the source directory');
 const parent=fs.realpathSync(path.dirname(file));
 if(parent===root||parent.startsWith(root+path.sep))throw Error('Write release artifacts outside the repository');
 return path.join(parent,path.basename(file));
}
function snapshotId(files){return sha(Buffer.from(JSON.stringify(files)));}
function createSnapshot(destination){
 const target=outsideSource(destination),files=entriesFor(inventory());
 const snapshot={schemaVersion:1,kind:'source-snapshot',snapshotId:snapshotId(files),createdAt:new Date().toISOString(),files};
 fs.writeFileSync(target,JSON.stringify(snapshot,null,2)+'\n',{flag:'wx',mode:0o600});
 return {snapshotId:snapshot.snapshotId,files:files.length,path:target};
}
function git(args){
 try{return execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();}
 catch{throw Error('Git source identity unavailable; explicitly create and pass --source-snapshot instead');}
}
function sourceContext(names,snapshotPath){
 if(new Set(names).size!==names.length)throw Error('Duplicate release source path');
 let revision=null,source,snapshotBytes;
 let verify;
 if(snapshotPath){
  if(!path.isAbsolute(snapshotPath))throw Error('--source-snapshot must be an absolute path');
  const stat=fs.lstatSync(snapshotPath);
  if(!stat.isFile()||stat.isSymbolicLink()||fs.realpathSync(snapshotPath)!==snapshotPath)throw Error('Snapshot manifest must be a regular file without symlinks');
  snapshotBytes=fs.readFileSync(snapshotPath);
  const snapshot=JSON.parse(snapshotBytes.toString('utf8'));
  const expected=inventory();
  if(snapshot.schemaVersion!==1||snapshot.kind!=='source-snapshot'||!Array.isArray(snapshot.files)||snapshot.files.length!==expected.length)throw Error('Invalid source snapshot inventory');
  for(let i=0;i<expected.length;i++){
   const entry=snapshot.files[i];
   if(!entry||entry.path!==expected[i]||!Number.isSafeInteger(entry.bytes)||entry.bytes<0||!/^[a-f0-9]{64}$/.test(entry.sha256))throw Error('Invalid source snapshot entry: '+expected[i]);
  }
  if(snapshot.snapshotId!==snapshotId(snapshot.files))throw Error('Source snapshot identity mismatch');
  verify=()=>{
   if(!fs.readFileSync(snapshotPath).equals(snapshotBytes))throw Error('Source snapshot manifest changed during build');
   const current=entriesFor(expected);
   if(snapshotId(current)!==snapshot.snapshotId)throw Error('Source changed since snapshot; create a new reviewed snapshot');
  };
  verify();
  source={kind:'source-snapshot',snapshotId:snapshot.snapshotId,manifestSha256:sha(snapshotBytes)};
 }else{
  revision=git(['rev-parse','HEAD']);
  const tracked=new Set(git(['ls-files','-z']).split('\0'));
  for(const name of names)if(!tracked.has(name))throw Error('Release file is not tracked: '+name);
  verify=()=>{if(git(['rev-parse','HEAD'])!==revision||git(['status','--porcelain','--',...names]))throw Error('Commit reviewed source changes before building a release');};
  verify();source={kind:'git-commit',revision};
 }
 const buffers=new Map(names.map(name=>[name,readSource(name)]));
 // Git status can hide assume-unchanged files; the claimed revision must match exact bytes.
 if(revision)for(const [name,bytes] of buffers){
  const committed=execFileSync('git',['show',revision+':'+name],{cwd:root,stdio:['ignore','pipe','pipe']});
  if(!committed.equals(bytes))throw Error('Source bytes differ from the recorded Git revision: '+name);
 }
 return {revision,source,snapshotBytes,buffers,verify(){verify();for(const [name,bytes] of buffers)if(!readSource(name).equals(bytes))throw Error('Source changed during build: '+name);}};
}
if(require.main===module){
 try{if(process.argv.length!==4||process.argv[2]!=='--out')throw Error('Usage: node deploy/aliyun/release-source.cjs --out /absolute/staging/source-snapshot.json');console.log(JSON.stringify(createSnapshot(process.argv[3]),null,2));}
 catch(error){console.error(error.message);process.exitCode=1;}
}
module.exports={createSnapshot,sourceContext,inventory,sha};
