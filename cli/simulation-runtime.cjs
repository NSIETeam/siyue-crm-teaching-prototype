'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
// Isolated application runtime for local simulation. No network, browser storage,
// production authentication, Node APIs, or user-provided executable code enters the VM.
module.exports=function simulationRuntime(storage=new Map()){
 const elements=new Map(),lists=new Map(),messages=[],errors=[];
 function element(){return {innerHTML:'',textContent:'',value:'',checked:false,hidden:false,dataset:{},children:[],classList:{add(){},remove(){},toggle(){}},querySelector(){return element()},querySelectorAll(){return []},addEventListener(){},insertBefore(){},insertAdjacentHTML(){},append(){},appendChild(){},after(){},remove(){},focus(){},getAttribute(){return ''},setAttribute(){}};}
 const document={querySelector(selector){if(!elements.has(selector))elements.set(selector,element());return elements.get(selector)},querySelectorAll:selector=>lists.get(selector)||[],createElement:element,getElementById(id){return this.querySelector('#'+id)},addEventListener(){},head:element(),body:element()};
 const context={document,console:{log(){},error(...args){errors.push(args.map(String).join(' '))}},URL,location:{href:'https://simulation.invalid/'},setTimeout(){},clearTimeout(){},failStorage:false,localStorage:{getItem:key=>storage.get(key)||null,setItem(key,value){if(context.failStorage)throw Error('simulated storage failure');storage.set(key,String(value))},removeItem(key){if(context.failStorage)throw Error('simulated storage failure');storage.delete(key)}},messages};
 context.window=context;context.addEventListener=()=>{};vm.createContext(context);
 const repo=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(repo,'index.html'),'utf8');
 for(const match of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)){
  const src=match[1].match(/src="([^"]+)"/),filename=src?.[1]||'index.inline.js';
  if(src&&!/^[A-Za-z0-9_-]+\.js$/.test(filename))throw Error('Simulation only loads repository root scripts');
  vm.runInContext(src?fs.readFileSync(path.join(repo,filename),'utf8'):match[2],context,{filename,timeout:10000});
 }
 const run=code=>vm.runInContext(code,context,{timeout:10000});
 run('toast=(message)=>messages.push(String(message))');
 function attendance(classId,rows){
  context.simulationClassId=classId;
  run("workflowState.selectedSession={classIndex:a.classes.findIndex(c=>c.id===simulationClassId),studentIndex:null};if(workflowState.selectedSession.classIndex<0)throw Error('UNKNOWN_SESSION');state.page='schedule';journalSource='siyue-cli 模拟执行'");
  lists.set('.wf-attendance',rows.map(row=>({value:row.attendance,dataset:{student:row.studentId}})));
  lists.set('.wf-consume',rows.map(row=>({checked:row.consume===true,dataset:{student:row.studentId}})));
  const from=messages.length;
  run('workflowSaveSessionAttendance()');
  return messages.slice(from);
 }
 return {context,storage,elements,lists,messages,errors,run,attendance};
};
