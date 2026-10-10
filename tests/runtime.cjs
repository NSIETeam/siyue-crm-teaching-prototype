const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
// Tests application logic in isolated storage. This is not a browser layout test.
module.exports=function boot(storage=new Map()){
 const elements=new Map(),lists=new Map(),messages=[];
 function element(){return {innerHTML:'',textContent:'',value:'',dataset:{},children:[],classList:{add(){},remove(){},toggle(){}},querySelector(){return element()},querySelectorAll(){return []},addEventListener(){},insertBefore(){},insertAdjacentHTML(){},append(){},after(){},remove(){},getAttribute(){return ''},setAttribute(){}}}
 const document={querySelector(s){if(!elements.has(s))elements.set(s,element());return elements.get(s)},querySelectorAll:s=>lists.get(s)||[],createElement:element,getElementById(){return element()},addEventListener(){},head:element(),body:element()};
 const ctx={document,console:{log(){},error(){}},URL,URLSearchParams,location:{href:'https://example.invalid/'},setTimeout(){},clearTimeout(){},failStorage:false,localStorage:{getItem:k=>storage.get(k)||null,setItem(k,v){if(ctx.failStorage)throw Error('storage full');storage.set(k,String(v))}},messages};ctx.window=ctx;ctx.addEventListener=()=>{};vm.createContext(ctx);
 const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
 for(const m of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)){const src=m[1].match(/src="([^"]+)"/);vm.runInContext(src?fs.readFileSync(path.join(root,src[1]),'utf8'):m[2],ctx,{filename:src?.[1]||'index.inline.js'})}
 vm.runInContext('toast=(message)=>messages.push(message)',ctx);
 return {ctx,storage,elements,lists,messages,run:code=>vm.runInContext(code,ctx)};
};
