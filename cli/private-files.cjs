'use strict';
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const windows=process.platform==='win32';
// Fixed PowerShell code only. Paths and secret material travel over stdin, never argv.
const script=String.raw`
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
[Console]::InputEncoding=[System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)
$action=[Console]::In.ReadLine()
$target=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::In.ReadLine()))
$data=[Console]::In.ReadLine()
$me=[System.Security.Principal.WindowsIdentity]::GetCurrent().User
$system=[System.Security.Principal.SecurityIdentifier]::new('S-1-5-18')
if($target){
 $attributes=[IO.File]::GetAttributes($target)
 $directory=($attributes -band [IO.FileAttributes]::Directory) -ne 0
 if(($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'Reparse points are forbidden'}
 if($action -eq 'secure'){
  if($directory){
   $acl=[System.Security.AccessControl.DirectorySecurity]::new()
   $inherit=[System.Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'
  }else{$acl=[System.Security.AccessControl.FileSecurity]::new();$inherit=[System.Security.AccessControl.InheritanceFlags]::None}
  $acl.SetOwner($me)
  $acl.SetAccessRuleProtection($true,$false)
  foreach($sid in @($me,$system)){
   $rule=[System.Security.AccessControl.FileSystemAccessRule]::new($sid,'FullControl',$inherit,'None','Allow')
   $acl.AddAccessRule($rule)
  }
  if($directory){[IO.Directory]::SetAccessControl($target,$acl)}else{[IO.File]::SetAccessControl($target,$acl)}
 }
 if($directory){$acl=[IO.Directory]::GetAccessControl($target)}else{$acl=[IO.File]::GetAccessControl($target)}
 if($acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $me.Value){throw 'Owner must be the current user'}
 if(-not $acl.AreAccessRulesProtected){throw 'Inherited access is forbidden'}
 $own=$false
 foreach($rule in $acl.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier])){
  if($rule.AccessControlType -eq 'Allow'){
   if($rule.IdentityReference.Value -notin @($me.Value,$system.Value)){throw 'Public access is forbidden'}
   if($rule.IdentityReference.Value -eq $me.Value -and ($rule.FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::FullControl) -eq [System.Security.AccessControl.FileSystemRights]::FullControl){$own=$true}
  }
 }
 if(-not $own){throw 'Current user needs full control'}
}
if($action -eq 'encrypt' -or $action -eq 'decrypt'){
 [void][Reflection.Assembly]::LoadWithPartialName('System.Security')
 $bytes=[Convert]::FromBase64String($data)
 $entropy=[Text.Encoding]::UTF8.GetBytes('siyue-cli-session-v1')
 if($action -eq 'encrypt'){$result=[Security.Cryptography.ProtectedData]::Protect($bytes,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)}
 else{$result=[Security.Cryptography.ProtectedData]::Unprotect($bytes,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)}
 [Console]::Write([Convert]::ToBase64String($result))
}else{[Console]::Write('ok')}
`;
function win(action,file,data){
 const executable=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
 const env={...process.env};for(const key of Object.keys(env))if(key.toLowerCase()==='psmodulepath')delete env[key];env.PSModulePath=path.join(path.dirname(executable),'Modules');
 try{return execFileSync(executable,['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{env,input:[action,Buffer.from(file||'','utf8').toString('base64'),data||''].join('\n')+'\n',encoding:'utf8',windowsHide:true,timeout:30000,stdio:['pipe','pipe','pipe']}).trim();}
 catch(cause){throw Object.assign(new Error('Windows 私有文件保护失败；请使用本机 NTFS 用户目录，并检查系统 PowerShell 可用。',{cause}),{code:'PRIVATE_FILE_PROTECTION_FAILED'});}
}
function regularPath(target){
 const absolute=path.resolve(target);let current=path.parse(absolute).root;
 for(const part of absolute.slice(current.length).split(path.sep).filter(Boolean)){
  current=path.join(current,part);const st=fs.lstatSync(current);
  if(st.isSymbolicLink())throw Object.assign(new Error('私有文件路径不能包含符号链接或目录联接'),{code:'UNSAFE_SESSION_PATH'});
 }
 return absolute;
}
function secure(file){if(windows)win('secure',regularPath(file));}
function check(file){if(windows)win('check',regularPath(file));}
function openNew(file){
 if(windows)regularPath(path.dirname(path.resolve(file)));
 const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
 try{secure(file);return fd;}catch(error){fs.closeSync(fd);throw error;}
}
function encodeSession(value){if(!windows)return JSON.stringify(value);return JSON.stringify({format:'siyue-windows-dpapi-v1',data:win('encrypt',null,Buffer.from(JSON.stringify(value)).toString('base64'))});}
function decodeSession(text){const value=JSON.parse(text);if(!windows)return value;if(value.format!=='siyue-windows-dpapi-v1'||typeof value.data!=='string')throw Object.assign(new Error('旧版 Windows 会话需重新登录'),{code:'INVALID_SESSION'});return JSON.parse(Buffer.from(win('decrypt',null,value.data),'base64').toString('utf8'));}
module.exports={windows,secure,check,openNew,regularPath,encodeSession,decodeSession};
