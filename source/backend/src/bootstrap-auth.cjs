#!/usr/bin/env node
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {AuthStore}=require('./auth-store.cjs');
const {makeUser}=require('./auth-service.cjs');
function bootstrap(storeFile,outputFile){
 if(!path.isAbsolute(outputFile))throw new Error('凭证输出文件必须为绝对路径');
 if(path.resolve(storeFile)===path.resolve(outputFile))throw new Error('凭证文件不能覆盖认证存储');
 const outputParent=path.dirname(outputFile);fs.mkdirSync(outputParent,{recursive:true,mode:0o700});
 const stat=fs.lstatSync(outputParent);if(!stat.isDirectory()||stat.isSymbolicLink()||(stat.mode&0o077))throw new Error('凭证必须保存在 0700 独立目录');
 const store=new AuthStore(storeFile);let outputCreated=false;
 try{
  if(store.state.users.length)throw new Error('已有账号，禁止重复初始化；请由超级管理员重置密码');
  const created=makeUser({name:'超级管理员',username:'admin-'+crypto.randomBytes(5).toString('hex'),roleIds:['superadmin'],scope:{type:'all'}},[]);
  const fd=fs.openSync(outputFile,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);outputCreated=true;
  try{fs.writeFileSync(fd,JSON.stringify({username:created.user.username,initialPassword:created.password,mustChangePassword:true},null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  store.transact(s=>{s.users.push(created.user);s.audit.push({id:crypto.randomUUID(),at:new Date().toISOString(),requestId:crypto.randomUUID(),actorId:created.user.id,actorName:created.user.name,action:'account.bootstrap',outcome:'success',targetId:created.user.id,ip:'local',details:{method:'offline'}});});
  return {username:created.user.username,credentialsFile:outputFile};
 }catch(error){if(outputCreated)try{fs.unlinkSync(outputFile);}catch{}throw error;}finally{store.close();}
}
if(require.main===module){try{const args=process.argv.slice(2);if(args.length!==4||args[0]!=='--store'||args[2]!=='--out')throw new Error('用法：node backend/src/bootstrap-auth.cjs --store /absolute/private/auth.json --out /absolute/private/initial-admin.json');const result=bootstrap(args[1],args[3]);process.stdout.write(JSON.stringify(result)+'\n');}catch(error){process.stderr.write(error.message+'\n');process.exitCode=1;}}
module.exports={bootstrap};
