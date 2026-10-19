/* Shared promotion text and poster-source rules. No URL is fetched by this module. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.SiyuePromotionContent=api;})(typeof globalThis==='undefined'?this:globalThis,function(){
 'use strict';
 const limits={promotionTitle:20,promotionSubtitle:20,promotionIntroduction:50};
 const labels={promotionTitle:'推广标题',promotionSubtitle:'推广副标题',promotionIntroduction:'推广介绍'};
 const count=value=>Array.from(String(value??'').trim()).length;
 function invalid(message){throw Object.assign(Error(message),{code:'INVALID_INPUT',status:400});}
 function privateV4(parts){const [a,b]=parts;return a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&b===168||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19);}
 function privateHost(raw){
  const host=raw.toLowerCase().replace(/^\[|\]$/g,'').replace(/\.$/,'');
  if(!host||host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||host.endsWith('.internal')||host.endsWith('.home')||!host.includes('.')&&!host.includes(':'))return true;
  if(/^\d+\.\d+\.\d+\.\d+$/.test(host))return privateV4(host.split('.').map(Number));
  if(host.includes(':')){
   const halves=host.split('::');if(halves.length>2)return true;
   const left=halves[0]?halves[0].split(':'):[],right=halves[1]?halves[1].split(':'):[];
   const words=(halves.length===2?[...left,...Array(Math.max(0,8-left.length-right.length)).fill('0'),...right]:left).map(x=>parseInt(x,16));
   if(words.length!==8||words.some(x=>!Number.isInteger(x)))return true;
   if(words.slice(0,5).every(x=>x===0)&&words[5]===0xffff)return privateV4([words[6]>>8,words[6]&255,words[7]>>8,words[7]&255]);
   if((words[0]&0xe000)!==0x2000)return true;
   if(words[0]===0x2002)return privateV4([words[1]>>8,words[1]&255,words[2]>>8,words[2]&255]);
  }
  return false;
 }
 function background(value){
  if(typeof value!=='string')invalid('海报背景须为颜色或 HTTPS 图片地址');
  const raw=value.trim();if(!raw)return '';
  if(/^#[0-9a-f]{6}$/i.test(raw))return raw.toLowerCase();
  if(raw.length>2048||/[\u0000-\u0020\u007f]/.test(raw))invalid('海报背景地址无效或超过2048字符');
  let url;try{url=new URL(raw);}catch{invalid('海报背景仅支持 #RRGGBB 或公开 HTTPS 图片地址');}
  if(url.protocol!=='https:'||url.username||url.password||privateHost(url.hostname))invalid('海报背景须使用无账号信息的公开 HTTPS 图片地址');
  if(url.href.length>2048)invalid('海报背景地址超过2048字符');
  return url.href;
 }
 function submitted(input){
  const out={};for(const [key,max]of Object.entries(limits))if(Object.hasOwn(input,key)){
   if(typeof input[key]!=='string')invalid(labels[key]+'须为文字');
   const value=input[key].trim();
   if(Array.from(value).length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))invalid(labels[key]+'最多'+max+'字');
   out[key]=value;
  }
  if(Object.hasOwn(input,'posterBackground'))out.posterBackground=background(input.posterBackground);
  return out;
 }
 function presentation(record={}){
  let posterBackground='';try{posterBackground=background(record.posterBackground||'');}catch{}
  return {promotionTitle:record.promotionTitle||record.name||'',promotionSubtitle:record.promotionSubtitle||'',promotionIntroduction:record.promotionIntroduction||record.description||'',posterBackground};
 }
 return {limits,labels,count,background,submitted,presentation};
});
