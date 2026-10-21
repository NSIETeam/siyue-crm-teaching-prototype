/* Shared academic vocabulary. Unknown historic labels remain readable, never silently reclassified. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.SiyueAcademicDictionary=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const numbers=['一','二','三','四','五','六','七','八','九'];
 const grades=Object.freeze([['小学',6],['初中',3],['高中',3]].flatMap(([stage,count])=>Array.from({length:count},(_,i)=>Object.freeze({value:stage+numbers[i]+'年级',label:stage+numbers[i]+'年级'}))));
 const defaults=Object.freeze(['语文','数学','英语','物理','化学','生物','历史','地理','道德与法治','政治','科学']);
 function normalizeGrade(value){
  const raw=typeof value==='string'?value.trim():'';if(!raw)return raw;
  const key=raw.normalize('NFKC').replace(/\s+/g,'');
  const m=key.match(/^(小学|小|初中|初|高中|高)?([一二三四五六七八九1-9])(?:年级|年)?$/);
  if(!m)return raw;
  let n=/^[1-9]$/.test(m[2])?Number(m[2]):numbers.indexOf(m[2])+1,stage=m[1];
  if(!stage){if(!/(?:年级|年)$/.test(key))return raw;stage=n>6?'初中':'小学';if(n>6)n-=6;}
  else stage=stage.startsWith('小')?'小学':stage.startsWith('初')?'初中':'高中';
  if(n<1||n>(stage==='小学'?6:3))return raw;
  return stage+numbers[n-1]+'年级';
 }
 function equalGrade(a,b){const left=normalizeGrade(a),right=normalizeGrade(b);return !!left&&!!right&&left===right;}
 function subjects(dictionary,legacyValues){const extra=Array.isArray(dictionary?.subjects)?dictionary.subjects:[];return [...new Set([...defaults,...extra,...(Array.isArray(legacyValues)?legacyValues:[])].filter(x=>typeof x==='string').map(x=>x.trim()).filter(Boolean))];}
 return Object.freeze({grades,subjects,normalizeGrade,equalGrade});
});
