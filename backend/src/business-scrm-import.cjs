'use strict';
const zlib=require('node:zlib');
const {assert,canAccess,context}=require('./business-common.cjs');
const fields=['name','phone','guardian','grade','subject','term','source','campusId','note'];
function csv(content){
 assert(typeof content==='string'&&Buffer.byteLength(content)<700000,'CSV 内容超过限制');const rows=[];let row=[],value='',quoted=false;
 for(let i=0;i<content.length;i++){const c=content[i];if(c==='"'){if(quoted&&content[i+1]==='"'){value+='"';i++;}else{assert(quoted||value.length===0,'CSV 引号位置无效');quoted=!quoted;}}else if(!quoted&&(c===','||c==='\n'||c==='\r')){row.push(value);value='';if(c!==','){if(c==='\r'&&content[i+1]==='\n')i++;if(row.some(v=>v.trim()))rows.push(row);row=[];}}else value+=c;}
 assert(!quoted,'CSV 引号没有闭合');row.push(value);if(row.some(v=>v.trim()))rows.push(row);assert(rows.length>=1&&rows.length<=501,'请上传含表头及最多500行数据的文件');rows[0][0]=rows[0][0].replace(/^\uFEFF/,'');return rows;
}
function zipEntries(content){
 assert(typeof content==='string'&&/^[A-Za-z0-9+/=\s]+$/.test(content)&&content.length<950000,'Excel 文件无效或过大');const buf=Buffer.from(content,'base64');let eocd=-1;
 for(let i=buf.length-22;i>=Math.max(0,buf.length-65557);i--)if(buf.readUInt32LE(i)===0x06054b50){eocd=i;break;}assert(eocd>=0,'Excel 压缩结构无效');assert(buf.readUInt16LE(eocd+4)===0&&buf.readUInt16LE(eocd+6)===0,'不支持多卷 Excel 文件');
 const count=buf.readUInt16LE(eocd+10);let cursor=buf.readUInt32LE(eocd+16),total=0;assert(count<=3000,'Excel 文件包含过多资源');const files=new Map();
 for(let i=0;i<count;i++){assert(cursor+46<=buf.length&&buf.readUInt32LE(cursor)===0x02014b50,'Excel 文件目录无效');const flags=buf.readUInt16LE(cursor+8),method=buf.readUInt16LE(cursor+10),packed=buf.readUInt32LE(cursor+20),size=buf.readUInt32LE(cursor+24),nameLength=buf.readUInt16LE(cursor+28),extra=buf.readUInt16LE(cursor+30),comment=buf.readUInt16LE(cursor+32),offset=buf.readUInt32LE(cursor+42),name=buf.subarray(cursor+46,cursor+46+nameLength).toString('utf8');cursor+=46+nameLength+extra+comment;assert(!(flags&1)&&[0,8].includes(method),'不支持加密 Excel 文件');total+=size;assert(size<=8000000&&total<=20000000,'Excel 解压后超过限制');if(!/^xl\/(?:sharedStrings\.xml|worksheets\/sheet\d+\.xml|workbook\.xml|_rels\/workbook\.xml\.rels)$/.test(name))continue;assert(offset+30<=buf.length&&buf.readUInt32LE(offset)===0x04034b50,'Excel 压缩项无效');const start=offset+30+buf.readUInt16LE(offset+26)+buf.readUInt16LE(offset+28);assert(start+packed<=buf.length,'Excel 压缩内容不完整');const data=buf.subarray(start,start+packed);const decoded=method===8?zlib.inflateRawSync(data,{maxOutputLength:8000000}):data;assert(decoded.length===size,'Excel 内容长度不一致');const xml=decoded.toString('utf8');assert(!/<!DOCTYPE|<!ENTITY/i.test(xml),'Excel XML 包含不支持声明');files.set(name,xml);}
 return files;
}
const decode=value=>String(value||'').replace(/&#x([0-9a-f]+);/gi,(_,hex)=>String.fromCodePoint(parseInt(hex,16))).replace(/&#(\d+);/g,(_,num)=>String.fromCodePoint(+num)).replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&');
const textNodes=xml=>[...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(m=>decode(m[1])).join('');
function parseXlsx(content){
 const files=zipEntries(content),strings=[...(files.get('xl/sharedStrings.xml')||'').matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)].map(m=>textNodes(m[1]));
 const firstId=files.get('xl/workbook.xml')?.match(/<sheet\b[^>]*\br:id="([^"]+)"/)?.[1],relations=files.get('xl/_rels/workbook.xml.rels')||'';let target;
 for(const m of relations.matchAll(/<Relationship\b([^>]+)\/?\s*>/g)){const attr=Object.fromEntries([...m[1].matchAll(/([\w:]+)="([^"]*)"/g)].map(a=>[a[1],a[2]]));if(attr.Id===firstId)target=attr.Target;}
 const name=target?(target.startsWith('/')?target.slice(1):target.startsWith('xl/')?target:'xl/'+target):[...files.keys()].find(n=>/^xl\/worksheets\/sheet\d+\.xml$/.test(n));const xml=files.get(name);assert(xml,'Excel 未找到第一个工作表');const rows=[];
 for(const m of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)){const row=[];for(const cell of m[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)){const ref=cell[1].match(/\br="([A-Z]+)\d+"/)?.[1];if(!ref)continue;let col=0;for(const c of ref)col=col*26+c.charCodeAt(0)-64;assert(col<=200,'Excel 列数超过限制');const type=cell[1].match(/\bt="([^"]+)"/)?.[1],v=cell[2]?.match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/)?.[1];assert(!/<f\b/.test(cell[2]||''),'请将公式转换为值后导入');row[col-1]=type==='s'?strings[Number(v)]||'':type==='inlineStr'?textNodes(cell[2]||''):decode(v||'');}if(row.some(v=>String(v||'').trim()))rows.push(row);assert(rows.length<=501,'一次最多导入500行数据');}
 assert(rows.length,'Excel 没有可导入内容');return rows;
}
function xlsx(content){try{return parseXlsx(content);}catch(error){if(error.status)throw error;throw Object.assign(new Error('Excel 文件内容损坏或格式不受支持，请另存为 XLSX 或 CSV 后导入'),{code:'INVALID_IMPORT_FILE',status:400});}}
const normalize=value=>String(value||'').normalize('NFKC').trim();
const phone=value=>normalize(value).replace(/[\s()-]/g,'').replace(/^(?:\+86|0086)(?=1\d{10}$)/,'');
function inspectImport(state,input,ctx){
 ctx.require('lead.create');assert(['csv','xlsx'].includes(input.format),'仅支持 CSV 或 XLSX');const rows=input.format==='csv'?csv(input.content):xlsx(input.content),columns=rows[0].map(normalize);assert(new Set(columns.filter(Boolean)).size===columns.filter(Boolean).length,'表头存在重复列');const mapping=input.mapping||{};assert(Object.keys(mapping).every(k=>fields.includes(k)),'字段映射包含未知字段');for(const value of Object.values(mapping))assert(typeof value==='string'&&columns.includes(value),'映射列不存在');
 if(input.campaignId)ctx.get('campaigns',input.campaignId,{access:'read'});if(input.campusId)ctx.get('campuses',input.campusId,{access:'read'});
 const seen=new Set(),items=[];let scratch=structuredClone(state);
 for(const [index,row] of rows.slice(1).entries()){
  const data={};for(const field of fields)if(mapping[field])data[field]=normalize(row[columns.indexOf(mapping[field])]);data.name=normalize(data.name);data.source||=input.source||'批量导入';data.campusId||=input.campusId||'';data.phone=phone(data.phone);const errors=[];
  if(!data.name||data.name.length>100)errors.push('学生姓名不能为空且不超过100字');if(!/^1[3-9]\d{9}$/.test(data.phone))errors.push('手机号格式无效');if(data.source.length>100)errors.push('来源不超过100字');if(data.note?.length>5000)errors.push('备注过长');
  if(data.campusId&&!state.campuses?.some(c=>c.id===data.campusId)){const matches=(state.campuses||[]).filter(c=>c.name===data.campusId&&c.active!==false&&canAccess(state,ctx.actor,c,'campuses',{access:'read'}));if(matches.length===1)data.campusId=matches[0].id;else errors.push(matches.length?'校区名称重复，请使用编号':'校区字典无法匹配');}if(data.campusId&&!state.campuses?.some(c=>c.id===data.campusId&&c.active!==false&&canAccess(state,ctx.actor,c,'campuses',{access:'read'})))errors.push('校区不存在或无权访问');
  const grades=require('../../academic-dictionary.js');if(data.grade){const normalized=grades.normalizeGrade(data.grade);if(!grades.grades.some(g=>g.value===normalized))errors.push('年级不在教学字典中');else data.grade=normalized;}if(data.subject&&!grades.subjects(state.dictionary||{},(state.courses||[]).map(c=>c.subject)).includes(data.subject))errors.push('学科不在教学字典中');
  const customer=(state.customers||[]).find(c=>c.status!=='merged'&&normalize(c.name||c.studentName).toLowerCase()===data.name.toLowerCase()&&(c.contacts||[]).some(contact=>phone(contact.phone||contact.value)===data.phone)&&canAccess(state,ctx.actor,c,'customers',{access:'read'}));
  const lead=(state.leads||[]).find(l=>normalize(l.name).toLowerCase()===data.name.toLowerCase()&&phone(l.phone||l.contactPhone)===data.phone&&canAccess(state,ctx.actor,l,'leads',{access:'read'}));
  const duplicate=customer&&data.subject&&(state.opportunities||[]).some(o=>o.customerId===customer.id&&o.subject===data.subject&&o.term===(data.term||'')&&!['won','closed'].includes(o.stage)&&canAccess(state,ctx.actor,o,'opportunities',{access:'read'}));
  const key=data.name.toLowerCase()+'|'+data.phone,repeat=seen.has(key);seen.add(key);
  if(!errors.length){try{const candidate=structuredClone(scratch),dryContext=context(candidate,ctx.actor,ctx.directory,{now:ctx.now,id:ctx.id});require('./business-scrm-core.cjs').helpers.importAcquisition(candidate,{...data,campaignId:input.campaignId},dryContext);scratch=candidate;}catch(error){errors.push(error.status>=500?'该行暂时无法导入':error.message);}}
  items.push({rowNumber:index+2,category:errors.length?'invalid':duplicate?'duplicate_demand':customer||lead||repeat?'existing_touch':'new_customer',data,customerId:customer?.id||null,leadId:lead?.id||null,errors});
 }
 const summary=Object.fromEntries(['new_customer','existing_touch','duplicate_demand','invalid'].map(k=>[k,items.filter(row=>row.category===k).length]));return {columns,items,summary,total:items.length};
}
const inputSchema={type:'object',properties:{format:{type:'string',enum:['csv','xlsx']},content:{type:'string',maxLength:950000},mapping:{type:'object',properties:Object.fromEntries(fields.map(k=>[k,{type:'string',maxLength:200}])),additionalProperties:false},campaignId:{type:'string'},source:{type:'string',maxLength:100},campusId:{type:'string'},fileName:{type:'string',maxLength:200}},required:['format','content','mapping'],additionalProperties:false};
const operations=[{id:'crm.import.commit',label:'导入客户与获客触点',permission:'lead.create',group:'crm',inputSchema,run(state,input,ctx){
 const result=inspectImport(state,input,ctx);assert(result.items.some(row=>!row.errors.length),'没有可导入的有效数据');const batch={id:ctx.id('IMPORT'),fileName:input.fileName||null,campaignId:input.campaignId||null,campusId:input.campusId||null,createdBy:ctx.actor.id,ownerId:ctx.actor.id,createdAt:ctx.now,updatedAt:ctx.now,version:1,status:'completed',summary:result.summary,items:[]};
 const core=require('./business-scrm-core.cjs');assert(typeof core.helpers.importAcquisition==='function','导入服务尚未就绪','IMPORT_UNAVAILABLE',503);
 for(const row of result.items){if(row.errors.length){batch.items.push(row);continue;}const acquired=core.helpers.importAcquisition(state,{...row.data,campaignId:input.campaignId,importBatchId:batch.id},ctx);batch.items.push({...row,customerId:acquired.customer?.id||acquired.customerId,leadId:acquired.lead?.id||acquired.leadId,touchpointId:acquired.touchpoint?.id||acquired.touchpointId});}
 batch.campusIds=[...new Set(batch.items.map(item=>item.data?.campusId).filter(Boolean))];state.importBatches||=[];state.importBatches.push(batch);return {record:batch,summary:batch.summary,items:batch.items};
}}];
module.exports={operations,inspectImport,inputSchema,csv,xlsx};
