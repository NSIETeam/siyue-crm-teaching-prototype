'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{DatabaseSync,backup}=require('node:sqlite');

function hashFile(file){return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');}
function copyMaterials(source,destination){
 if(!fs.existsSync(source))return [];
 const sourceStat=fs.lstatSync(source);
 if(!sourceStat.isDirectory()||sourceStat.isSymbolicLink())throw Error('资料备份源必须是普通目录');
 fs.mkdirSync(destination,{mode:0o700});
 const entries=[];
 for(const name of fs.readdirSync(source)){
  if(!/^MAT_[A-Za-z0-9_-]{32}\.(pdf|doc|docx|ppt|pptx|xls|xlsx)$/.test(name))throw Error('资料目录中包含无法备份的文件');
  const input=path.join(source,name),stat=fs.lstatSync(input);
  if(!stat.isFile()||stat.isSymbolicLink())throw Error('资料备份中包含非普通文件');
  const output=path.join(destination,name);
  fs.copyFileSync(input,output,fs.constants.COPYFILE_EXCL);
  fs.chmodSync(output,0o600);
  entries.push({name:`materials/${name}`,sha256:hashFile(output)});
 }
 return entries;
}

async function snapshot({businessFile,authFile,out,materialStoreDir=businessFile?`${businessFile}.materials`:undefined}){
 if(!path.isAbsolute(out))throw Error('备份目录必须是绝对路径');
 fs.mkdirSync(out,{recursive:true,mode:0o700});
 if(fs.lstatSync(out).isSymbolicLink())throw Error('备份目录不能是符号链接');
 fs.chmodSync(out,0o700);
 const dir=path.join(out,new Date().toISOString().replace(/[:.]/g,'-')+'-'+crypto.randomBytes(4).toString('hex'));
 fs.mkdirSync(dir,{mode:0o700});let db;
 try{
  db=new DatabaseSync(businessFile,{readOnly:true});
  await backup(db,path.join(dir,'business.sqlite'));
  db.close();db=null;
  const auth=JSON.parse(fs.readFileSync(authFile,'utf8'));
  if(!Array.isArray(auth.users)||!auth.users.length)throw Error('账号存储无效');
  fs.writeFileSync(path.join(dir,'auth.json'),JSON.stringify(auth),{mode:0o600});
  const materialEntries=materialStoreDir?copyMaterials(materialStoreDir,path.join(dir,'materials')):[];
  const check=new DatabaseSync(path.join(dir,'business.sqlite'));
  try{check.exec('PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE;');if(check.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('业务备份校验失败');}
  finally{check.close();}
  const files=['business.sqlite','auth.json'].map(name=>{const file=path.join(dir,name);fs.chmodSync(file,0o600);return {name,sha256:hashFile(file)};}).concat(materialEntries);
  fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify({createdAt:new Date().toISOString(),files}),{mode:0o600});
  return {directory:dir,verified:true,materialCount:materialEntries.length};
 }catch(error){db?.close();fs.rmSync(dir,{recursive:true,force:true});throw error;}
}

if(require.main===module)snapshot({businessFile:process.env.SIYUE_BUSINESS_STORE,authFile:process.env.SIYUE_AUTH_STORE,out:process.env.SIYUE_BACKUP_DIR||'/var/backups/siyue-crm',materialStoreDir:process.env.SIYUE_MATERIAL_STORE}).then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={snapshot,copyMaterials};
