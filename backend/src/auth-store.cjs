'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
function assertRegular(file){const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o077))throw new Error('认证文件必须为 0600 普通文件');}
function fileExists(file){try{fs.lstatSync(file);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
function atomicWrite(file,value){
 const temp=path.join(path.dirname(file),'.auth-'+crypto.randomBytes(16).toString('hex')+'.tmp');let fd;
 try {fd=fs.openSync(temp,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);fs.writeFileSync(fd,JSON.stringify(value));fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.renameSync(temp,file);}catch(error){if(fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(temp);}catch{}throw error;}
 // A rename is the commit point. Never report a failed mutation after it succeeds.
 try{const dir=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}}catch{process.stderr.write('认证数据已原子提交；目录同步失败，请检查存储设备。\n');}
}
class AuthStore{
 constructor(filename){
  if(!path.isAbsolute(filename))throw new Error('SIYUE_AUTH_STORE 必须是绝对路径');
  const parent=path.dirname(filename);fs.mkdirSync(parent,{recursive:true,mode:0o700});
  const stat=fs.lstatSync(parent);if(!stat.isDirectory()||stat.isSymbolicLink()||(stat.mode&0o077))throw new Error('认证数据目录必须为 0700 独立目录');
  this.filename=path.join(fs.realpathSync(parent),path.basename(filename));this.lock=this.filename+'.lock';this.lockId=crypto.randomUUID();this.closed=false;
  try{const fd=fs.openSync(this.lock,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);fs.writeFileSync(fd,JSON.stringify({pid:process.pid,id:this.lockId}));fs.closeSync(fd);}catch(error){if(error.code==='EEXIST')throw new Error('认证存储已有写入进程；若为异常退出，请先确认该进程已停止再移除锁文件');throw error;}
  try{
   if(fileExists(this.filename)){assertRegular(this.filename);if(fs.statSync(this.filename).size>32*1024*1024)throw new Error('认证存储过大，需先归档审计');this.state=JSON.parse(fs.readFileSync(this.filename,'utf8'));}
   else{this.state={schemaVersion:1,users:[],sessions:[],audit:[]};atomicWrite(this.filename,this.state);}
   if(this.state.schemaVersion!==1||!['users','sessions','audit'].every(k=>Array.isArray(this.state[k])))throw new Error('认证存储格式无效');
   for(const user of this.state.users)if(!user.id||!user.username||!Array.isArray(user.roleIds)||!user.passwordHash||!Number.isInteger(user.version))throw new Error('认证账号存储损坏');
  }catch(error){this.close();throw error;}
 }
 transact(change){if(this.closed)throw new Error('认证存储已关闭');const candidate=structuredClone(this.state);const result=change(candidate);if(Buffer.byteLength(JSON.stringify(candidate))>32*1024*1024)throw new Error('认证存储已达容量，请先归档审计');if(fileExists(this.filename))assertRegular(this.filename);atomicWrite(this.filename,candidate);this.state=candidate;return result;}
 close(){if(this.closed)return;this.closed=true;try{assertRegular(this.lock);const owner=JSON.parse(fs.readFileSync(this.lock,'utf8'));if(owner.id===this.lockId)fs.unlinkSync(this.lock);}catch{}}
}
module.exports={AuthStore,atomicWrite};
