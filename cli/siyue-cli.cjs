#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path');
const catalog=JSON.parse(fs.readFileSync(path.join(__dirname,'operations.json'),'utf8'));
const [cmd='help',id]=process.argv.slice(2);
const out=x=>process.stdout.write(JSON.stringify(x,null,2)+'\n');
if(cmd==='help')console.log('siyue-cli list [关键词]\nsiyue-cli describe <operation-id>\nsiyue-cli plan <operation-id>\n目录查询不代表已授权；实际操作由浏览器账号权限验证。写入接口尚未接入。');
else if(cmd==='list')out(catalog.operations.filter(x=>!id||[x.id,x.label,...x.aliases].join(' ').includes(id)));
else if(['describe','plan'].includes(cmd)){const op=catalog.operations.find(x=>x.id===id);if(!op){console.error('UNKNOWN_OPERATION');process.exitCode=1}else out(cmd==='describe'?op:{version:catalog.version,operationId:id,mode:'open-form',input:{},authorization:'required-at-execution',commit:false,transport:'reserved',browserCall:`siyueCLI.open(${JSON.stringify(id)})`})}
else{console.error('NOT_IMPLEMENTED: 当前仅支持 list、describe、plan，未连接服务端写入。');process.exitCode=2}
