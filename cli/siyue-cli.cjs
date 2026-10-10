#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path');
const catalog=JSON.parse(fs.readFileSync(path.join(__dirname,'operations.json'),'utf8'));
const [cmd='help',id,...args]=process.argv.slice(2);
const out=x=>process.stdout.write(JSON.stringify(x,null,2)+'\n');
if(cmd==='help')console.log('siyue-cli list [关键词]\nsiyue-cli describe <operation-id>\nsiyue-cli plan <operation-id>\nsiyue-cli simulate lesson-consumption --out <directory>\n模拟命令实际执行隔离的本地业务处理器并导出结果；未连接正式后台或真实账号。');
else if(cmd==='list')out(catalog.operations.filter(x=>!id||[x.id,x.label,...x.aliases].join(' ').includes(id)));
else if(['describe','plan'].includes(cmd)){const op=catalog.operations.find(x=>x.id===id);if(!op){console.error('UNKNOWN_OPERATION');process.exitCode=1}else out(cmd==='describe'?op:{version:catalog.version,operationId:id,mode:'open-form',input:{},authorization:'required-at-execution',commit:false,transport:'reserved',browserCall:`siyueCLI.open(${JSON.stringify(id)})`})}
else if(cmd==='simulate'){
 try{if(id!=='lesson-consumption'||args.length!==2||args[0]!=='--out'||!args[1])throw Error('用法：siyue-cli simulate lesson-consumption --out <directory>');out(require('./lesson-consumption-simulation.cjs').simulate({out:args[1]}));}
 catch(error){console.error('SIMULATION_FAILED: '+error.message);process.exitCode=1;}
}
else{console.error('NOT_IMPLEMENTED: 支持 list、describe、plan 和 simulate lesson-consumption；未连接正式服务端写入。');process.exitCode=2}
