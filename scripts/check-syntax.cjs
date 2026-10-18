'use strict';
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
let checked=0;
function walk(dir){
 for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
  if(entry.name.startsWith('.')||entry.name==='node_modules')continue;
  const file=path.join(dir,entry.name);
  if(entry.isDirectory())walk(file);
  else if(entry.isFile()&&/\.(?:js|cjs)$/.test(file)){
   execFileSync(process.execPath,['--check',file],{stdio:'inherit'});checked++;
  }
 }
}
walk(root);console.log(`${checked} JavaScript files passed syntax checks`);
