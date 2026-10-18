'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {defaultRolePolicies,validateRolePolicies,isReadOnlyPermission}=require('./auth-policy.cjs');
function assertRegular(file){const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o077))throw new Error('认证文件必须为 0600 普通文件');}
function fileExists(file){try{fs.lstatSync(file);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
function atomicWrite(file,value){
 const temp=path.join(path.dirname(file),'.auth-'+crypto.randomBytes(16).toString('hex')+'.tmp');let fd;
 try {fd=fs.openSync(temp,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);fs.writeFileSync(fd,JSON.stringify(value));fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.renameSync(temp,file);}catch(error){if(fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(temp);}catch{}throw error;}
 // A rename is the commit point. Never report a failed mutation after it succeeds.
 try{const dir=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}}catch{process.stderr.write('认证数据已原子提交；目录同步失败，请检查存储设备。\n');}
}
const communicationMigration='student-communication-20261014';
function migrateCommunicationPermission(state){
 if(state.migrations?.includes(communicationMigration))return false;
 const defaults=defaultRolePolicies(),upgraded=[],roleChanges=[];
 for(const id of ['teacher','academic','principal']){
  const policy=state.rolePolicies[id];if(!policy)continue;
  const previous=defaults[id].permissions.filter(p=>p!=='student.communicate').sort(),actual=[...policy.permissions].sort();
  if(actual.length!==previous.length||actual.some((permission,index)=>permission!==previous[index]))continue;
  state.rolePolicies[id]={...policy,permissions:[...defaults[id].permissions],version:policy.version+1};upgraded.push(id);roleChanges.push({roleId:id,beforePermissions:actual,afterPermissions:[...defaults[id].permissions],beforeVersion:policy.version,afterVersion:policy.version+1});
 }
 const now=new Date().toISOString();let affectedUsers=0;
 for(const user of state.users){if(!user.roleIds.some(id=>upgraded.includes(id)))continue;affectedUsers++;const prior=user.version;user.version++;user.updatedAt=now;if(!user.disabled)for(const session of state.sessions)if(session.userId===user.id&&session.version===prior&&Date.parse(session.expiresAt)>Date.now())session.version=user.version;}
 state.migrations=[...(state.migrations||[]),communicationMigration];
 state.audit.push({id:crypto.randomUUID(),at:now,actorId:null,actorName:'系统权限迁移',action:'role.migrate.studentCommunication',outcome:'success',targetId:null,details:{roles:upgraded,roleChanges,permission:'student.communicate',affectedUsers}});
 return true;
}

const auditorMigration='auditor-readonly-20261018';
function migrateAuditorReadOnly(state){
 if(state.migrations?.includes(auditorMigration))return false;
 const policy=state.rolePolicies.auditor,removed=policy?.permissions.filter(p=>!isReadOnlyPermission(p))||[];
 if(removed.length)state.rolePolicies.auditor={...policy,permissions:policy.permissions.filter(isReadOnlyPermission),version:policy.version+1};
 const now=new Date().toISOString();let affectedUsers=0,overrideCount=0;
 for(const user of state.users){
  const sole=user.roleIds.length===1&&user.roleIds[0]==='auditor',overrides=sole?(user.additionalPermissions||[]).filter(p=>!isReadOnlyPermission(p)):[];
  if(!user.roleIds.includes('auditor')||!removed.length&&!overrides.length)continue;
  if(overrides.length){user.additionalPermissions=user.additionalPermissions.filter(isReadOnlyPermission);overrideCount+=overrides.length;}
  const previous=user.version;user.version++;user.updatedAt=now;affectedUsers++;
  if(!user.disabled)for(const session of state.sessions)if(session.userId===user.id&&session.version===previous&&Date.parse(session.expiresAt)>Date.now())session.version=user.version;
 }
 state.migrations=[...(state.migrations||[]),auditorMigration];
 state.audit.push({id:crypto.randomUUID(),at:now,actorId:null,actorName:'系统权限迁移',action:'role.migrate.auditorReadOnly',outcome:'success',targetId:'role:auditor',details:{permissionsRemoved:removed,overrideCount,affectedUsers}});
 return true;
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
   else{this.state={schemaVersion:1,users:[],sessions:[],audit:[],rolePolicies:defaultRolePolicies()};atomicWrite(this.filename,this.state);}
   if(this.state.schemaVersion!==1||!['users','sessions','audit'].every(k=>Array.isArray(this.state[k])))throw new Error('认证存储格式无效');
   if(this.state.rolePolicies===undefined)this.state.rolePolicies=defaultRolePolicies();validateRolePolicies(this.state.rolePolicies);
   for(const user of this.state.users)if(!user.id||!user.username||!Array.isArray(user.roleIds)||!user.passwordHash||!Number.isInteger(user.version))throw new Error('认证账号存储损坏');
   const migrated=structuredClone(this.state);const communicationChanged=migrateCommunicationPermission(migrated),auditorChanged=migrateAuditorReadOnly(migrated);if(communicationChanged||auditorChanged){atomicWrite(this.filename,migrated);this.state=migrated;}
  }catch(error){this.close();throw error;}
 }
 transact(change){if(this.closed)throw new Error('认证存储已关闭');const candidate=structuredClone(this.state);const result=change(candidate);if(Buffer.byteLength(JSON.stringify(candidate))>32*1024*1024)throw new Error('认证存储已达容量，请先归档审计');if(fileExists(this.filename))assertRegular(this.filename);atomicWrite(this.filename,candidate);this.state=candidate;return result;}
 close(){if(this.closed)return;this.closed=true;try{assertRegular(this.lock);const owner=JSON.parse(fs.readFileSync(this.lock,'utf8'));if(owner.id===this.lockId)fs.unlinkSync(this.lock);}catch{}}
}
module.exports={AuthStore,atomicWrite};
