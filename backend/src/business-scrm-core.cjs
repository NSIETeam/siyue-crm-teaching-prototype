'use strict';
// All mutations run on the shared business transaction clone. No IO or timers here.
const {helpers:h}=require('./business-crm.cjs');
const {canAccess}=require('./business-common.cjs');
const {check,keys,text,phone,instant,integer,event,version,campus,owner,schema,op,S}=h;
const COLLECTIONS=['customers','campaigns','touchpoints','crmTaskBatches','crmTasks','opportunities','consultations'];
const OPEN_TASKS=['pending','in_progress'];
const OPEN_OPPORTUNITIES=['qualified','appointment','trial','negotiation'];
const STAGES=[...OPEN_OPPORTUNITIES,'won','closed'];
const ref=(collection,title)=>({type:'string',format:'reference',collection,title});
const str=(title,maxLength=200)=>({type:'string',title,maxLength});
const bool=title=>({type:'boolean',title});
const enumeration=(title,values)=>({type:'string',title,enum:values});
const expected={type:'integer',title:'记录版本',minimum:0};
function init(state){for(const name of COLLECTIONS)state[name]??=[];return state;}
function rows(state,name){init(state);return state[name];}
function get(state,name,id,ctx,access='write'){
 check(typeof id==='string'&&id.length>0&&id.length<=120,'请选择有效记录');
 const record=rows(state,name).find(x=>x.id===id);
 check(record&&ctx.can(record,name,{access}),'记录不存在或不在授权范围','NOT_FOUND',404);
 return record;
}
function activeCustomer(state,id,ctx,access='write'){
 const record=get(state,'customers',id,ctx,access);
 check(record.status!=='merged'&&record.status!=='archived','客户已合并或归档，请使用有效客户','CUSTOMER_CLOSED',409);
 return record;
}
function make(ctx,prefix,data){return {id:ctx.id(prefix),...data,createdBy:ctx.actor.id,createdAt:ctx.now,updatedAt:ctx.now,history:[],version:0};}
function changed(record,ctx,kind,detail={}){event(record,ctx,kind,detail);return record;}
function normalizedName(value){return text(value,'学生姓名',100).toLowerCase();}
function contacts(input,ctx,previous=[]){
 check(Array.isArray(input)&&input.length>0&&input.length<=10,'请填写1至10个联系方式');
 const used=new Set();
 const result=input.map(raw=>{
  keys(raw,['id','name','relationship','phone','primary']);
  const number=phone(raw.phone);check(!used.has(number),'联系方式中的手机号重复');used.add(number);
  const prior=raw.id?previous.find(x=>x.id===raw.id):previous.find(x=>x.phone===number);
  check(!raw.id||prior,'不能指定不存在的联系方式编号');
  check(raw.primary===undefined||typeof raw.primary==='boolean','主要联系方式选项无效');
  return {id:prior?.id||ctx.id('CONTACT'),name:text(raw.name,'联系人',100,true),relationship:text(raw.relationship,'与学生关系',50,true)||'监护人',phone:number,primary:raw.primary??prior?.primary??false};
 });
 check(result.filter(x=>x.primary).length<=1,'只能设置一个主要联系方式');
 if(!result.some(x=>x.primary))result[0].primary=true;
 return result;
}
function primaryContact(customer){return customer.contacts?.find(x=>x.primary)||customer.contacts?.[0]||null;}
function duplicateCandidates(state,input,ctx){
 const name=input.name?normalizedName(input.name):null,number=input.phone?phone(input.phone):null;
 check(name||number,'请填写学生姓名或手机号');
 return rows(state,'customers').filter(x=>!['merged','archived'].includes(x.status)&&ctx.can(x,'customers',{access:'read'})&&((name&&normalizedName(x.name)===name)||(number&&x.contacts?.some(c=>c.phone===number))));
}
function exactCustomerMatches(state,name,numbers){return rows(state,'customers').filter(x=>!['merged','archived'].includes(x.status)&&normalizedName(x.name)===normalizedName(name)&&x.contacts?.some(c=>numbers.includes(c.phone)));}
function campusInfo(state,id,ctx){const camp=campus(state,id,ctx);check(camp||ctx.actor.scope?.type!=='campus','请选择授权校区');return {campusId:camp?.id||null,campus:camp?.name||'待定'};}
function createCustomer(state,input,ctx){
 keys(input,['name','grade','campusId','contacts','note','confirmedDistinct','distinctReason']);
 const name=text(input.name,'学生姓名',100),list=contacts(input.contacts,ctx),matches=exactCustomerMatches(state,name,list.map(x=>x.phone));
 check(!matches.length||input.confirmedDistinct===true,'已有同名同联系方式客户，请先查重并明确选择已有客户','CUSTOMER_DUPLICATE',409);
 if(matches.length)text(input.distinctReason,'确认为不同学生的原因',1000);
 const record=make(ctx,'CUSTOMER',{name,grade:text(input.grade,'年级',50,true),...campusInfo(state,input.campusId,ctx),contacts:list,phone:list.find(x=>x.primary).phone,note:text(input.note,'客户备注',5000,true),status:'active',ownerId:ctx.actor.permissions?.includes('lead.follow')?ctx.actor.id:null,owner:ctx.actor.permissions?.includes('lead.follow')?ctx.actor.name:'未分配',studentId:null});
 check(ctx.can(record,'customers',{access:'write'}),'超出当前客户资料范围','FORBIDDEN',403);
 changed(record,ctx,'客户建档',{confirmedDistinct:input.confirmedDistinct===true,reason:input.distinctReason||null});rows(state,'customers').push(record);return record;
}
function resolveCustomer(state,input,ctx){
 const name=text(input.name,'学生姓名',100),number=phone(input.phone),matches=exactCustomerMatches(state,name,[number]);
 check(matches.length<=1,'存在多份可能重复的学生档案，请人工查重后选择客户','CUSTOMER_AMBIGUOUS',409);
 if(matches.length){
  const record=activeCustomer(state,matches[0].id,ctx,'read'),filled=[];
  if(!ctx.can(record,'customers',{access:'write'}))return {record,created:false,reused:true};
  for(const field of ['grade'])if(!record[field]&&input[field]){record[field]=text(input[field],field,100);filled.push(field);}
  const contact=record.contacts.find(x=>x.phone===number);if(contact&&!contact.name&&input.guardian){contact.name=text(input.guardian,'家长',100);filled.push('contact.name');}
  if(filled.length)changed(record,ctx,'补全客户空白资料',{fields:filled,source:input.source||null});
  return {record,created:false,reused:true};
 }
 return {record:createCustomer(state,{name,grade:input.grade,campusId:input.campusId,contacts:[{name:input.guardian||'',relationship:'监护人',phone:number,primary:true}],note:input.note||''},ctx),created:true,reused:false};
}
function customerFromLead(state,lead,ctx){
 check(ctx.can(lead,'leads',{access:'write'})||lead.registrarId===ctx.actor.id&&!lead.ownerId&&ctx.actor.permissions?.includes('lead.create'),'无权将该线索关联客户','FORBIDDEN',403);
 if(lead.customerId)return activeCustomer(state,lead.customerId,ctx);
 const list=contacts([{name:lead.guardian||'',phone:lead.contactPhone||lead.phone,relationship:'监护人',primary:true}],ctx);
 // Legacy migration is an explicit conversion. Similar name/phone is a suggestion,
 // never a reason to silently merge a family or alter another customer's identity.
 const customer=make(ctx,'CUSTOMER',{name:lead.name,grade:lead.grade||'',contacts:list,phone:list[0].phone,campusId:lead.campusId||null,campus:lead.campus||'待定',ownerId:lead.ownerId||null,owner:lead.owner||'未分配',note:lead.note||'',status:'active',originLeadId:lead.id||lead.leadId,studentId:null});
 rows(state,'customers').push(customer);lead.customerId=customer.id;
 const student=(state.students||[]).find(x=>x.id===lead.studentId||x.originLeadId===(lead.id||lead.leadId));
 if(student&&ctx.actor.permissions?.includes('student.read')&&ctx.can(student,'students',{access:'write'})){check(!student.customerId||student.customerId===customer.id,'学生已关联其它客户，需人工核对','CUSTOMER_LINK_CONFLICT',409);student.customerId=customer.id;customer.studentId=student.id;changed(student,ctx,'关联客户档案',{customerId:customer.id});}
 changed(lead,ctx,'明确关联客户档案',{customerId:customer.id});changed(customer,ctx,'由历史线索明确建档',{leadId:lead.id||lead.leadId});
 check(ctx.can(customer,'customers',{access:'write'}),'无权建立该客户档案','FORBIDDEN',403);return customer;
}
function campaignFor(state,id,ctx,campusId){if(!id)return null;const campaign=get(state,'campaigns',id,ctx,'read');check(!['closed','archived'].includes(campaign.status),'活动已关闭','CAMPAIGN_CLOSED',409);check(!campaign.campusId||!campusId||campaign.campusId===campusId,'活动与客户校区不一致');return campaign;}
function appendTouchpoint(state,input,ctx){
 keys(input,['customerId','campaignId','leadId','source','channel','subject','grade','term','note','kind','formId','submissionId','importBatchId']);
 const customer=activeCustomer(state,input.customerId,ctx,'read'),campaign=campaignFor(state,input.campaignId,ctx,customer.campusId);
 if(input.leadId){const lead=ctx.get('leads',input.leadId,{access:'read'});check(lead.customerId===customer.id,'触点线索与客户不匹配');}
 const record=make(ctx,'TOUCH',{customerId:customer.id,customerName:customer.name,campusId:customer.campusId,ownerId:customer.ownerId,leadId:input.leadId||null,campaignId:campaign?.id||null,campaignName:campaign?.name||null,source:text(input.source,'来源',100,true)||campaign?.name||'人工登记',channel:text(input.channel,'渠道',100,true)||'manual',kind:text(input.kind,'触点类型',50,true)||'consultation',subject:text(input.subject,'意向学科',100,true),grade:text(input.grade,'意向年级',50,true),term:text(input.term,'意向学期',100,true),note:text(input.note,'触点内容',5000,true),formId:input.formId||null,submissionId:input.submissionId||null,importBatchId:input.importBatchId||null,at:ctx.now});
 check(ctx.can(record,'touchpoints',{access:'write'}),'触点不在当前授权范围','FORBIDDEN',403);changed(record,ctx,'记录获客触点',{});rows(state,'touchpoints').push(record);return record;
}
function attachLeadTouch(state,lead,input={},ctx){
 ctx.require('lead.create');check(ctx.can(lead,'leads',{access:'read'}),'无权记录该线索触点','FORBIDDEN',403);
 if(input.submissionId){const existing=rows(state,'touchpoints').find(x=>x.submissionId===input.submissionId&&x.formId===input.formId);if(existing)return {customer:existing.customerId?activeCustomer(state,existing.customerId,ctx,'read'):null,touchpoint:existing,reused:true};}
 let customer=lead.customerId?activeCustomer(state,lead.customerId,ctx,'read'):null;
 if(!customer&&(ctx.can(lead,'leads',{access:'write'})||lead.registrarId===ctx.actor.id&&!lead.ownerId))customer=customerFromLead(state,lead,ctx);
 if(!customer){
  // Approved repeat acquisition can append its own evidence without editing a
  // different salesperson's legacy identity link or exposing their whole file.
  const touchpoint=make(ctx,'TOUCH',{customerId:null,customerName:lead.name,leadId:lead.id||lead.leadId,campusId:lead.campusId||null,ownerId:lead.ownerId||null,campaignId:campaignFor(state,input.campaignId,ctx,lead.campusId)?.id||null,source:text(input.source||lead.source,'来源',100),channel:text(input.channel,'渠道',100,true)||'form',kind:text(input.kind,'触点类型',50,true)||'form',subject:text(input.subject||lead.subject,'学科',100,true),grade:text(input.grade||lead.grade,'年级',50,true),note:text(input.note,'触点内容',5000,true),formId:input.formId||null,submissionId:input.submissionId||null,at:ctx.now,identityLinkPending:true});
  check(ctx.can(touchpoint,'touchpoints',{access:'write'}),'触点不在授权范围','FORBIDDEN',403);changed(touchpoint,ctx,'记录重复获客，等待负责人关联客户',{leadId:lead.id||lead.leadId});rows(state,'touchpoints').push(touchpoint);return {customer:null,touchpoint,identityLinkPending:true};
 }
 const touchpoint=appendTouchpoint(state,{customerId:customer.id,leadId:lead.id||lead.leadId,source:input.source||lead.source,campaignId:input.campaignId,channel:input.channel,kind:input.kind||'lead',subject:input.subject||lead.subject,grade:input.grade||lead.grade,note:input.note,formId:input.formId,submissionId:input.submissionId},ctx);
 return {customer,touchpoint};
}

function importAcquisition(state,input,ctx){
 ctx.require('lead.create');const name=text(input.name,'学生姓名',100),number=phone(input.phone),key=h.leadKey(name,number);
 const matches=(state.leads||[]).filter(lead=>h.leadKey(lead.name,lead.contactPhone||lead.phone)===key);
 check(matches.length<=1,'存在多份历史线索，请先核对重复档案','LEAD_AMBIGUOUS',409);
 let lead=matches[0]||null;if(lead)check(ctx.can(lead,'leads',{access:'read'}),'已有线索不在当前授权范围，请联系管理员','LEAD_ACCESS_REQUIRED',403);
 let resolved=lead?.customerId?{record:activeCustomer(state,lead.customerId,ctx,'read'),created:false,reused:true}:resolveCustomer(state,input,ctx);
 const customer=resolved.record;
 if(!lead)lead=h.createLead(state,{name,phone:number,guardian:input.guardian,grade:input.grade,subject:input.subject,campusId:input.campusId||customer.campusId,source:input.source||'批量导入',note:input.note},ctx);
 if(!lead.customerId){check(ctx.can(lead,'leads',{access:'write'})||lead.registrarId===ctx.actor.id&&!lead.ownerId,'历史线索需要负责人明确关联客户后再导入','LEAD_LINK_REQUIRES_OWNER',409);lead.customerId=customer.id;changed(lead,ctx,'获客导入关联客户',{customerId:customer.id,importBatchId:input.importBatchId||null});}
 check(lead.customerId===customer.id,'线索与客户档案冲突，请先处理重复档案','CUSTOMER_LINK_CONFLICT',409);
 const touchpoint=appendTouchpoint(state,{customerId:customer.id,leadId:lead.id||lead.leadId,campaignId:input.campaignId,source:input.source||'批量导入',subject:input.subject,grade:input.grade,term:input.term,note:input.note,kind:'import',importBatchId:input.importBatchId},ctx);
 return {record:customer,customer,lead,touchpoint,created:resolved.created,reused:resolved.reused};
}

function salesOwner(ctx,id,campusId){const chosen=id||ctx.actor.id;if(chosen!==ctx.actor.id)ctx.require('lead.assign');return owner(ctx,chosen,campusId);}
function needKey(customerId,subject,term){return `${customerId}|${subject.normalize('NFKC').trim().toLowerCase()}|${term.normalize('NFKC').trim().toLowerCase()}`;}
function createOpportunity(state,input,ctx){
 keys(input,['customerId','subject','term','title','leadId','campaignId','ownerId','skipQualification','sourceTaskId','note']);
 const customer=activeCustomer(state,input.customerId,ctx,'read'),subject=text(input.subject,'意向学科',100),term=text(input.term,'意向学期',100),key=needKey(customer.id,subject,term);
 let task=null;if(input.sourceTaskId){task=get(state,'crmTasks',input.sourceTaskId,ctx);check(task.customerId===customer.id&&task.taskType==='marketing','请选择该客户的营销任务');check(OPEN_TASKS.includes(task.status),'营销任务已结束');}
 const existing=rows(state,'opportunities').find(x=>x.needKey===key&&OPEN_OPPORTUNITIES.includes(x.stage));
 if(existing){check(ctx.can(existing,'opportunities',{access:'read'}),'同客户学科与学期已有活跃商机，请联系负责人','OPPORTUNITY_EXISTS',409);const touchpoint=appendTouchpoint(state,{customerId:customer.id,source:'重复需求咨询',subject,term,note:input.note||'再次咨询同一活跃需求',kind:'consultation'},ctx);changed(existing,ctx,'重复需求追加咨询',{touchpointId:touchpoint.id,note:input.note||'',ownerId:existing.ownerId});if(existing.ownerId&&existing.ownerId!==ctx.actor.id){state.inbox??=[];state.inbox.push({id:ctx.id('NOTICE'),ownerId:existing.ownerId,opportunityId:existing.id,customerId:customer.id,title:'客户再次咨询',text:customer.name+' 再次咨询 '+subject+' · '+term,createdAt:ctx.now,read:false});}if(task)completeTaskWithOpportunity(state,task,existing,ctx);return {record:existing,touchpoint,reused:true};}
 const person=salesOwner(ctx,input.ownerId,customer.campusId),campaign=campaignFor(state,input.campaignId,ctx,customer.campusId);
 if(input.leadId){const lead=ctx.get('leads',input.leadId,{access:'write'});check(lead.customerId===customer.id,'线索与客户不匹配');}
 const record=make(ctx,'OPP',{title:text(input.title,'商机名称',200,true)||`${customer.name} · ${subject} · ${term}`,name:customer.name,customerId:customer.id,customerName:customer.name,leadId:input.leadId||null,campusId:customer.campusId,campus:customer.campus,subject,term,needKey:key,campaignId:campaign?.id||task?.campaignId||null,ownerId:person.id,owner:person.name,stage:'qualified',status:'active',qualificationSkipped:input.skipQualification===true,sourceTaskId:task?.id||null,note:text(input.note,'需求内容',5000,true),stageHistory:[{at:ctx.now,from:null,to:'qualified',actorId:ctx.actor.id,reason:input.skipQualification?'明确需求，跳过初筛':'需求确认'}],orderIds:[]});
 check(ctx.can(record,'opportunities',{access:'write'}),'商机不在当前操作范围','FORBIDDEN',403);changed(record,ctx,'建立销售商机',{customerId:customer.id,sourceTaskId:task?.id||null});rows(state,'opportunities').push(record);
 if(task)completeTaskWithOpportunity(state,task,record,ctx);
 return {record,reused:false};
}

function finishBatch(state,batchId,ctx){const batch=rows(state,'crmTaskBatches').find(x=>x.id===batchId);if(batch&&rows(state,'crmTasks').filter(x=>x.batchId===batch.id).every(x=>!OPEN_TASKS.includes(x.status))){batch.status='completed';batch.completedAt=ctx.now;changed(batch,ctx,'全部任务已结束',{});}}
function completeTaskWithOpportunity(state,task,opportunity,ctx){task.status='completed';task.result='qualified';task.resultNote='已确认需求并关联商机';task.opportunityId=opportunity.id;task.completedAt=ctx.now;changed(task,ctx,'营销任务转为商机',{opportunityId:opportunity.id});finishBatch(state,task.batchId,ctx);}

function markOpportunityWon(state,order,receipt,ctx){
 if(!order.opportunityId||!Number.isSafeInteger(receipt.amountCents)||receipt.amountCents<=0)return null;
 const opportunity=rows(state,'opportunities').find(x=>x.id===order.opportunityId);
 check(opportunity,'订单关联商机不存在','OPPORTUNITY_LINK_INVALID',409);
 check(!order.customerId||order.customerId===opportunity.customerId,'订单与商机客户不一致','OPPORTUNITY_LINK_INVALID',409);
 if(opportunity.wonAt)return opportunity;
 check(opportunity.stage!=='closed','已关闭商机须先重新开启才能关联实收','OPPORTUNITY_CLOSED',409);
 // Finance is authorized on the order; the trusted receipt hook owns this transition.
 opportunity.stageHistory??=[];opportunity.stageHistory.push({at:ctx.now,from:opportunity.stage,to:'won',actorId:ctx.actor.id,orderId:order.id,receiptId:receipt.id,reason:'首笔有效实收'});
 opportunity.stage='won';opportunity.status='won';opportunity.nextFollowAt=null;opportunity.wonAt=ctx.now;opportunity.wonOrderId=order.id;opportunity.wonReceiptId=receipt.id;opportunity.orderIds=[...new Set([...(opportunity.orderIds||[]),order.id])];
 return changed(opportunity,ctx,'首笔实收确认成交',{orderId:order.id,receiptId:receipt.id,amountCents:receipt.amountCents});
}
const contactSchema=schema({id:str('已有联系方式编号'),name:str('联系人姓名',100),relationship:str('与学生关系',50),phone:str('手机号',50),primary:bool('主要联系方式')},['phone']);
const customerFields={name:str('学生姓名',100),grade:str('年级',50),campusId:ref('campuses','所属校区'),contacts:{type:'array',title:'学生与监护人联系方式',minItems:1,maxItems:10,items:contactSchema},note:str('客户备注',5000)};
const operations=[];
function register(id,label,permission,properties,required,run){operations.push(op(id,label,permission,schema(properties,required),(state,input,ctx)=>{init(state);return run(state,input,ctx);},{group:'scrm'}));}
register('customer.create','建立客户档案','lead.create',{...customerFields,confirmedDistinct:bool('已确认同名同电话记录属于不同学生'),distinctReason:str('不同学生的核对依据',1000)},['name','contacts'],(s,i,c)=>({record:createCustomer(s,i,c)}));
register('customer.findDuplicates','查找可能重复客户','lead.create',{name:str('学生姓名',100),phone:str('手机号',50)},[],(s,i,c)=>{keys(i,['name','phone']);return {records:duplicateCandidates(s,i,c).map(row=>projectRecord(s,c.actor,row,'customers'))};});
register('customer.fromLead','将历史线索明确关联客户','lead.follow',{leadId:ref('leads','已有线索'),customerId:ref('customers','经核对的已有客户'),expectedVersion:expected},['leadId'],(s,i,c)=>{
 keys(i,['leadId','customerId','expectedVersion']);const lead=c.get('leads',i.leadId,{access:'write'});version(lead,i);
 if(i.customerId){const customer=activeCustomer(s,i.customerId,c);check(!lead.customerId||lead.customerId===customer.id,'线索已关联另一客户，请通过客户合并处理','CUSTOMER_LINK_CONFLICT',409);check(normalizedName(lead.name)===normalizedName(customer.name),'学生姓名不一致，请先核对并修正档案');check(customer.contacts.some(x=>x.phone===phone(lead.contactPhone||lead.phone)),'手机号不匹配，请先核对并补齐客户联系方式');lead.customerId=customer.id;changed(lead,c,'人工关联已有客户',{customerId:customer.id});return {record:customer,lead};}
 return {record:customerFromLead(s,lead,c),lead};
});

register('customer.linkStudent','明确关联学生学籍','lead.follow',{customerId:ref('customers','客户'),studentId:ref('students','学生学籍'),reason:str('核对依据',1000),expectedVersion:expected},['customerId','studentId','reason'],(s,i,c)=>{
 keys(i,['customerId','studentId','reason','expectedVersion']);c.require('student.read');const customer=activeCustomer(s,i.customerId,c);version(customer,i);const student=c.get('students',i.studentId,{access:'write'});const reason=text(i.reason,'核对依据',1000);
 check(!customer.studentId||customer.studentId===student.id,'客户已经关联另一学生，请先人工核对','CUSTOMER_LINK_CONFLICT',409);check(!student.customerId||student.customerId===customer.id,'学生已经关联另一客户，请先核对重复客户','CUSTOMER_LINK_CONFLICT',409);
 check(!(s.customers||[]).some(x=>x.id!==customer.id&&x.status!=='merged'&&x.studentId===student.id),'学生已被另一客户关联，请先处理重复档案','CUSTOMER_LINK_CONFLICT',409);
 const differences={};for(const field of ['name','grade'])if((customer[field]||'')!==(student[field]||''))differences[field]={customer:customer[field]||null,student:student[field]||null};if(student.phone&&!customer.contacts.some(contact=>contact.phone===student.phone))differences.phone={customer:customer.contacts.map(contact=>contact.phone),student:student.phone};
 customer.studentId=student.id;student.customerId=customer.id;changed(customer,c,'明确关联学生学籍',{studentId:student.id,reason,differences});changed(student,c,'明确关联客户档案',{customerId:customer.id,reason,differences});return {record:customer,student,differences};
});

register('customer.update','编辑客户档案','lead.follow',{customerId:ref('customers','客户'),patch:schema(customerFields),expectedVersion:expected},['customerId','patch'],(s,i,c)=>{
 keys(i,['customerId','patch','expectedVersion']);const record=activeCustomer(s,i.customerId,c);version(record,i);const patch=keys(i.patch,Object.keys(customerFields));check(Object.keys(patch).length,'没有修改字段');
 const before={};for(const key of Object.keys(patch))before[key]=structuredClone(record[key]??null);
 if(patch.name!==undefined)record.name=text(patch.name,'学生姓名',100);if(patch.grade!==undefined)record.grade=text(patch.grade,'年级',50,true);if(patch.note!==undefined)record.note=text(patch.note,'备注',5000,true);
 if(patch.contacts!==undefined){record.contacts=contacts(patch.contacts,c,record.contacts);record.phone=primaryContact(record).phone;}
 if(patch.campusId!==undefined){c.require('lead.assign');Object.assign(record,campusInfo(s,patch.campusId,c));check(c.can(record,'customers',{access:'write'}),'不能将客户移出当前范围','FORBIDDEN',403);}
 changed(record,c,'编辑客户资料',{before,fields:Object.keys(patch)});return {record};
});
register('customer.merge','核对差异并合并重复客户','lead.assign',{targetCustomerId:ref('customers','保留客户'),sourceCustomerId:ref('customers','合并来源'),reason:str('合并依据',1000),confirmedSameStudent:bool('已核实为同一学生'),fieldChoices:schema({name:enumeration('学生姓名采用',['target','source']),grade:enumeration('年级采用',['target','source']),note:enumeration('备注采用',['target','source'])}),expectedVersion:expected,sourceExpectedVersion:expected},['targetCustomerId','sourceCustomerId','reason','confirmedSameStudent'],(s,i,c)=>{
 keys(i,['targetCustomerId','sourceCustomerId','reason','confirmedSameStudent','fieldChoices','expectedVersion','sourceExpectedVersion']);check(i.targetCustomerId!==i.sourceCustomerId,'不能合并同一客户');check(i.confirmedSameStudent===true,'请核实为同一学生后再合并');
 const target=activeCustomer(s,i.targetCustomerId,c),source=activeCustomer(s,i.sourceCustomerId,c);version(target,i);version(source,{expectedVersion:i.sourceExpectedVersion});const reason=text(i.reason,'合并依据',1000),choices=keys(i.fieldChoices||{},['name','grade','note']);
 check(!target.studentId||!source.studentId||target.studentId===source.studentId,'两份客户绑定了不同学生学籍，请先人工核对，不能合并','STUDENT_LINK_CONFLICT',409);
 const references=[];for(const kind of ['leads','students','orders','opportunities','crmTasks','touchpoints','consultations','serviceTickets'])for(const record of s[kind]||[])if(record.customerId===source.id){check(c.can(record,kind,{access:'write'}),'存在当前账号不可修改的关联记录，请由具有完整范围的管理员合并','FORBIDDEN',403);references.push({kind,record});}
 for(const item of references.filter(x=>x.kind==='opportunities'&&OPEN_OPPORTUNITIES.includes(x.record.stage)))check(!s.opportunities.some(x=>x.customerId===target.id&&OPEN_OPPORTUNITIES.includes(x.stage)&&needKey(target.id,x.subject,x.term)===needKey(target.id,item.record.subject,item.record.term)),'双方有同学科同学期活跃商机，请先关闭重复商机','OPPORTUNITY_MERGE_CONFLICT',409);
 const before={name:target.name,grade:target.grade,note:target.note,contacts:structuredClone(target.contacts),studentId:target.studentId};for(const field of ['name','grade','note']){if(choices[field]!==undefined)check(['target','source'].includes(choices[field]),'差异字段选择无效');if(choices[field]==='source')target[field]=source[field];else if(!target[field])target[field]=source[field];}
 for(const item of source.contacts||[])if(!target.contacts.some(x=>x.phone===item.phone))target.contacts.push({...structuredClone(item),id:c.id('CONTACT'),primary:false});check(target.contacts.length<=10,'合并后联系方式超过10个，请先核对整理');
 target.studentId=target.studentId||source.studentId||null;target.mergedFromIds=[...new Set([...(target.mergedFromIds||[]),source.id])];target.campusIds=[...new Set([...(target.campusIds||[target.campusId]),...(source.campusIds||[source.campusId])].filter(Boolean))];
 for(const {kind,record} of references){record.originalCustomerId??=source.id;record.customerId=target.id;if(kind==='opportunities')record.needKey=needKey(target.id,record.subject,record.term);changed(record,c,'客户去重关联调整',{fromCustomerId:source.id,toCustomerId:target.id,reason});}
 source.status='merged';source.mergedIntoId=target.id;source.mergedAt=c.now;changed(source,c,'重复客户合并',{targetCustomerId:target.id,reason});changed(target,c,'核对差异后合并客户',{sourceCustomerId:source.id,before,fieldChoices:choices,reason,linkedRecords:references.map(x=>({kind:x.kind,id:x.record.id}))});return {record:target,source};
});
const campaignFields={formIds:{type:'array',title:'关联表单',maxItems:100,items:ref('forms','表单')},participantIds:{type:'array',title:'参与员工',maxItems:100,items:ref('directory','员工')},promoterIds:{type:'array',title:'推广员工',maxItems:100,items:ref('directory','员工')},name:str('活动名称'),campusId:ref('campuses','校区'),channel:str('来源渠道',100),description:str('活动说明',3000),start:{type:'string',format:'date-time',title:'开始时间'},end:{type:'string',format:'date-time',title:'结束时间'},budgetMinor:{type:'integer',title:'预算（分）',minimum:0,maximum:100000000000},targetCount:{type:'integer',title:'目标有效线索数',minimum:0,maximum:1000000}};
function campaignValues(s,i,c,old={}){keys(i,Object.keys(campaignFields));const record={...old};if(i.name!==undefined||!old.id)record.name=text(i.name,'活动名称',200);for(const key of ['channel','description'])if(i[key]!==undefined)record[key]=text(i[key],key,key==='description'?3000:100,true);for(const key of ['start','end'])if(i[key]!==undefined)record[key]=instant(i[key],key);check(!record.start||!record.end||record.start<=record.end,'结束时间须晚于开始时间');if(i.campusId!==undefined||!old.id)Object.assign(record,campusInfo(s,i.campusId,c));for(const key of ['budgetMinor','targetCount'])if(i[key]!==undefined)record[key]=integer(i[key],key,0,key==='budgetMinor'?100000000000:1000000);
 for(const key of ['formIds','participantIds','promoterIds'])if(i[key]!==undefined){check(Array.isArray(i[key])&&i[key].length<=100&&new Set(i[key]).size===i[key].length,'关联记录不可重复且至多100项');if(key==='formIds')for(const id of i[key]){const form=c.get('forms',id,{access:'read'});check(!form.campusId||!record.campusId||form.campusId===record.campusId,'关联表单须属于活动校区');}else for(const id of i[key]){const person=(c.directory||[]).find(x=>x.id===id);check(person&&!person.disabled&&!person.mustChangePassword,'请选择有效参与员工');if(person.scope?.type==='campus')check(person.scope.campusIds?.includes(record.campusId),'参与员工不在活动校区授权范围');if(person.scope?.type==='assigned')check((s.classes||[]).some(cls=>cls.campusId===record.campusId&&(cls.teacherId===id||cls.teacherIds?.includes(id)||cls.schedule?.some(session=>session.teacherId===id||session.substituteTeacherId===id))),'参与教师没有活动校区授课关系');}record[key]=[...i[key]];}
 const formActors=(record.formIds||[]).flatMap(id=>{const form=(s.forms||[]).find(x=>x.id===id);return [form?.createdBy,form?.publishedBy];}).filter(id=>(c.directory||[]).some(person=>person.id===id&&!person.disabled));
 record.participantIds=[...new Set([...(record.participantIds||[]),...formActors])];
 return record;}
register('campaign.create','创建获客活动','lead.create',campaignFields,['name'],(s,i,c)=>{const record=make(c,'CAMPAIGN',{...campaignValues(s,i,c),status:'draft',ownerId:c.actor.id,owner:c.actor.name});check(c.can(record,'campaigns',{access:'write'}),'活动不在当前授权范围','FORBIDDEN',403);changed(record,c,'创建获客活动');s.campaigns.push(record);return {record};});
register('campaign.update','编辑获客活动','lead.create',{campaignId:ref('campaigns','活动'),patch:schema(campaignFields),expectedVersion:expected},['campaignId','patch'],(s,i,c)=>{keys(i,['campaignId','patch','expectedVersion']);const record=get(s,'campaigns',i.campaignId,c);version(record,i);check(record.status==='draft','活动发布后需创建新版本，不能覆盖当前活动','INVALID_STATE',409);const next=campaignValues(s,i.patch,c,record);check(c.can(next,'campaigns',{access:'write'}),'活动不在当前授权范围','FORBIDDEN',403);Object.assign(record,next);changed(record,c,'编辑获客活动',{fields:Object.keys(i.patch)});return {record};});
register('campaign.linkForm','给活动关联表单','lead.create',{campaignId:ref('campaigns','活动'),formId:ref('forms','表单'),expectedVersion:expected},['campaignId','formId'],(s,i,c)=>{keys(i,['campaignId','formId','expectedVersion']);const record=get(s,'campaigns',i.campaignId,c);version(record,i);check(['draft','published'].includes(record.status),'已结束活动不能新增表单','INVALID_STATE',409);const form=c.get('forms',i.formId,{access:'read'});check(!form.campusId||!record.campusId||form.campusId===record.campusId,'关联表单须属于活动校区');record.formIds??=[];if(record.formIds.includes(form.id))return {record,reused:true};record.formIds.push(form.id);record.participantIds=[...new Set([...(record.participantIds||[]),...[form.createdBy,form.publishedBy].filter(id=>(c.directory||[]).some(person=>person.id===id&&!person.disabled))])];changed(record,c,'关联获客表单',{formId:form.id,formVersion:form.publishedVersion||form.version||null});return {record};});
for(const action of ['publish','close'])register('campaign.'+action,action==='publish'?'发布获客活动':'结束获客活动','lead.create',{campaignId:ref('campaigns','活动'),expectedVersion:expected},['campaignId'],(s,i,c)=>{keys(i,['campaignId','expectedVersion']);const record=get(s,'campaigns',i.campaignId,c);version(record,i);check(action==='publish'?record.status==='draft':record.status==='published','活动状态不允许此操作','INVALID_STATE',409);if(action==='publish')check(!record.end||Date.parse(record.end)>Date.parse(c.now),'活动已过期');record.status=action==='publish'?'published':'closed';record[action==='publish'?'publishedAt':'closedAt']=c.now;changed(record,c,action==='publish'?'发布获客活动':'结束获客活动');return {record};});
register('touchpoint.create','记录客户获客触点','lead.create',{customerId:ref('customers','客户'),campaignId:ref('campaigns','活动'),leadId:ref('leads','线索'),source:str('来源'),channel:str('渠道'),subject:str('意向学科'),grade:str('年级'),term:str('学期'),note:str('触点内容',5000),kind:enumeration('触点类型',['consultation','campaign','referral','manual'])},['customerId'],(s,i,c)=>({record:appendTouchpoint(s,i,c)}));
const opportunityFields={customerId:ref('customers','客户'),subject:str('意向学科',100),term:str('意向学期',100),title:str('商机名称'),leadId:ref('leads','线索'),campaignId:ref('campaigns','活动'),ownerId:ref('directory','商机负责人'),skipQualification:bool('需求明确，跳过初筛'),sourceTaskId:ref('crmTasks','来源营销任务'),note:str('需求内容',5000)};
register('opportunity.create','确认需求并建立商机','lead.follow',opportunityFields,['customerId','subject','term'],createOpportunity);
register('opportunity.followup','记录商机沟通并安排回访','lead.follow',{opportunityId:ref('opportunities','商机'),note:str('沟通内容',5000),channel:enumeration('沟通方式',['phone','wechat','visit','online','other']),nextFollowAt:{type:'string',format:'date-time',title:'下次联系时间'},expectedVersion:expected},['opportunityId','note','channel'],(s,i,c)=>{require('./business-reception.cjs').requireOwner(s,c.actor,'opportunity.followup',i);const record=get(s,'opportunities',i.opportunityId,c);version(record,i);check(OPEN_OPPORTUNITIES.includes(record.stage),'已成交或关闭商机请通过服务或新需求办理');const next=i.nextFollowAt?instant(i.nextFollowAt,'下次联系时间'):null;check(!next||Date.parse(next)>Date.parse(c.now),'下次联系时间须晚于当前时间');record.lastFollowAt=c.now;record.nextFollowAt=next;changed(record,c,'商机跟进',{note:text(i.note,'沟通内容',5000),channel:i.channel,nextFollowAt:next});return {record};});
register('opportunity.update','编辑商机资料','lead.follow',{opportunityId:ref('opportunities','商机'),patch:schema({title:str('商机名称'),note:str('需求内容',5000),ownerId:ref('directory','负责人')}),expectedVersion:expected},['opportunityId','patch'],(s,i,c)=>{keys(i,['opportunityId','patch','expectedVersion']);const record=get(s,'opportunities',i.opportunityId,c);version(record,i);check(OPEN_OPPORTUNITIES.includes(record.stage),'已结束商机不可修改','INVALID_STATE',409);const patch=keys(i.patch,['title','note','ownerId']);check(Object.keys(patch).length,'没有修改字段');if(patch.title!==undefined)record.title=text(patch.title,'商机名称',200);if(patch.note!==undefined)record.note=text(patch.note,'需求内容',5000,true);if(patch.ownerId!==undefined){c.require('lead.assign');const person=owner(c,patch.ownerId,record.campusId),before=record.ownerId;record.ownerId=person.id;record.owner=person.name;record.assignmentHistory??=[];record.assignmentHistory.push({at:c.now,actorId:c.actor.id,from:before,to:person.id});}changed(record,c,'编辑商机资料',{fields:Object.keys(patch)});return {record};});
register('opportunity.advance','推进商机阶段','lead.follow',{opportunityId:ref('opportunities','商机'),stage:enumeration('销售阶段',[...OPEN_OPPORTUNITIES,'closed']),reason:str('阶段说明',1000),nextFollowAt:{type:'string',format:'date-time',title:'下次跟进时间'},expectedVersion:expected},['opportunityId','stage'],(s,i,c)=>{keys(i,['opportunityId','stage','reason','nextFollowAt','expectedVersion']);const record=get(s,'opportunities',i.opportunityId,c);version(record,i);check([...OPEN_OPPORTUNITIES,'closed'].includes(i.stage),'商机阶段无效，成交须由真实实收确认');check(record.stage!=='won','成交由真实收款确认，不能手动改变','INVALID_STATE',409);check(record.stage!==i.stage,'阶段未变化','NO_CHANGE',409);const reason=text(i.reason,'阶段说明',1000,i.stage!=='closed'&&record.stage!=='closed');if(record.stage==='closed'){check(i.stage==='qualified','关闭商机只可重新进入需求确认阶段');check(!s.opportunities.some(x=>x.id!==record.id&&x.needKey===record.needKey&&OPEN_OPPORTUNITIES.includes(x.stage)),'同一需求已有活跃商机，不能重复开启','OPPORTUNITY_EXISTS',409);}record.stageHistory??=[];record.stageHistory.push({at:c.now,from:record.stage,to:i.stage,actorId:c.actor.id,reason});record.stage=i.stage;record.status=i.stage==='closed'?'closed':'active';if(i.stage==='closed'){record.closedAt=c.now;record.closeReason=reason;record.nextFollowAt=null;}else if(i.nextFollowAt){record.nextFollowAt=instant(i.nextFollowAt,'下次跟进时间');check(Date.parse(record.nextFollowAt)>Date.parse(c.now),'下次跟进时间须晚于当前时间');}changed(record,c,'推进商机阶段',{stage:i.stage,reason});return {record};});
function taskAssignee(s,c,id,campusId,type){
 const person=(c.directory||[]).find(x=>x.id===id);check(person&&!person.disabled&&!person.mustChangePassword,'请选择有效员工');
 check(person.permissions?.includes(type==='marketing'?'lead.follow':'lead.create'),'员工缺少该任务所需权限');
 if(person.scope?.type==='campus')check(person.scope.campusIds?.includes(campusId),'员工不在该任务校区授权范围');
 if(person.scope?.type==='assigned'){check(type==='service','授课分配范围员工不能接收营销任务');check((s.classes||[]).some(cls=>cls.campusId===campusId&&(cls.teacherId===person.id||cls.teacherIds?.includes(person.id)||cls.schedule?.some(session=>session.teacherId===person.id||session.substituteTeacherId===person.id))),'员工没有该校区授课关系');}
 return person;
}
function assignmentPlan(records,assignees,strategy,quotas,prior){
 check(['even','quota','owner_first'].includes(strategy),'分配策略无效');
 const counts=new Map(assignees.map(x=>[x.id,0])),limits=new Map();
 if(strategy==='quota'){check(Array.isArray(quotas)&&quotas.length===assignees.length,'按数量分配需要每个员工的名额');for(const q of quotas){keys(q,['ownerId','count']);check(counts.has(q.ownerId)&&!limits.has(q.ownerId),'数量配置员工重复或不在分配名单');limits.set(q.ownerId,integer(q.count,'分配数量',0,10000));}check([...limits.values()].reduce((a,b)=>a+b,0)===records.length,'分配数量之和须等于去重后待分配记录数');}
 const plan=[];for(const record of records){let person=strategy==='owner_first'?assignees.find(x=>x.id===prior(record)):null;if(!person)person=assignees.filter(x=>strategy!=='quota'||counts.get(x.id)<limits.get(x.id)).sort((a,b)=>counts.get(a.id)-counts.get(b.id)||assignees.indexOf(a)-assignees.indexOf(b))[0];check(person,'没有可分配的员工');counts.set(person.id,counts.get(person.id)+1);plan.push({record,person});}return {plan,counts};
}
const quotaSchema={type:'array',title:'员工分配数量',maxItems:100,items:schema({ownerId:ref('directory','员工'),count:{type:'integer',title:'数量',minimum:0,maximum:10000}},['ownerId','count'])};
const allocationFields={ownerIds:{type:'array',title:'分配员工',minItems:1,maxItems:100,items:ref('directory','员工')},strategy:enumeration('分配策略',['even','quota','owner_first']),quotas:quotaSchema};
register('crm.taskBatch.create','批量创建并分配营销或服务任务','lead.assign',{title:str('任务批次名称'),taskType:enumeration('任务类型',['marketing','service']),serviceType:str('服务事项',100),customerIds:{type:'array',title:'客户',minItems:1,maxItems:500,items:ref('customers','客户')},campaignId:ref('campaigns','活动'),subject:str('意向学科',100),term:str('意向学期',100),dueAt:{type:'string',format:'date-time',title:'截止时间'},note:str('任务要求',5000),...allocationFields},['title','taskType','customerIds','ownerIds','strategy','dueAt'],(s,i,c)=>{
 keys(i,['title','taskType','serviceType','customerIds','campaignId','subject','term','dueAt','note','ownerIds','strategy','quotas']);check(['marketing','service'].includes(i.taskType),'任务类型无效');check(new Set(i.customerIds).size===i.customerIds.length,'客户列表重复');check(new Set(i.ownerIds).size===i.ownerIds.length,'员工列表重复');const dueAt=instant(i.dueAt,'任务截止时间');check(Date.parse(dueAt)>Date.parse(c.now),'任务截止时间须晚于当前时间');const subject=text(i.subject,'意向学科',100,true),term=text(i.term,'意向学期',100,true),serviceType=text(i.serviceType,'服务事项',100,i.taskType!=='service');
 const customers=i.customerIds.map(id=>activeCustomer(s,id,c)),skipped=[],eligible=[];
 for(const customer of customers){campaignFor(s,i.campaignId,c,customer.campusId);const duplicate=i.taskType==='marketing'&&s.crmTasks.find(task=>task.taskType==='marketing'&&task.customerId===customer.id&&task.subject===subject&&task.term===term&&OPEN_TASKS.includes(task.status));if(duplicate)skipped.push({customerId:customer.id,reason:'unfinished_marketing_task',...(c.can(duplicate,'crmTasks',{access:'read'})?{taskId:duplicate.id}:{})});else eligible.push(customer);}
 check(eligible.length,'所选客户均已有同需求未完成营销任务','NO_ELIGIBLE_CUSTOMERS',409);
 const people=i.ownerIds.map(id=>{for(const customer of eligible)taskAssignee(s,c,id,customer.campusId,i.taskType);return (c.directory||[]).find(x=>x.id===id);});const allocation=assignmentPlan(eligible,people,i.strategy,i.quotas,x=>x.ownerId),campusIds=[...new Set(eligible.map(x=>x.campusId).filter(Boolean))];
 const batch=make(c,'TASK_BATCH',{title:text(i.title,'任务批次名称',200),name:i.title,taskType:i.taskType,serviceType:serviceType||null,subject,term,campaignId:i.campaignId||null,campusId:campusIds.length===1?campusIds[0]:null,campusIds,strategy:i.strategy,dueAt,status:'active',customerIds:eligible.map(x=>x.id),taskIds:[],ownerIds:i.ownerIds,assignmentCounts:Object.fromEntries(allocation.counts),skipped,note:text(i.note,'任务要求',5000,true)});
 check(c.can(batch,'crmTaskBatches',{access:'write'}),'任务批次不在当前授权范围','FORBIDDEN',403);s.crmTaskBatches.push(batch);
 const records=allocation.plan.map(({record:customer,person})=>{const task=make(c,'CRM_TASK',{title:batch.title,taskType:i.taskType,serviceType:serviceType||null,batchId:batch.id,customerId:customer.id,customerName:customer.name,subject,term,campaignId:i.campaignId||null,campusId:customer.campusId,ownerId:person.id,owner:person.name,assigneeId:person.id,status:'pending',dueAt,note:batch.note,result:null,assignmentHistory:[{at:c.now,actorId:c.actor.id,from:null,to:person.id,strategy:i.strategy}]});changed(task,c,'任务分配',{batchId:batch.id,strategy:i.strategy});s.crmTasks.push(task);batch.taskIds.push(task.id);return task;});changed(batch,c,'批量分配任务',{count:records.length,skipped:skipped.length});return {record:batch,records,skipped};
});
register('crm.task.update','调整任务安排','lead.create',{taskId:ref('crmTasks','任务'),status:enumeration('任务状态',['pending','in_progress','cancelled']),ownerId:ref('directory','负责人'),dueAt:{type:'string',format:'date-time',title:'截止时间'},note:str('调整说明',5000),expectedVersion:expected},['taskId'],(s,i,c)=>{
 keys(i,['taskId','status','ownerId','dueAt','note','expectedVersion']);const record=get(s,'crmTasks',i.taskId,c);version(record,i);check(OPEN_TASKS.includes(record.status),'已结束任务不能调整','INVALID_STATE',409);if(record.taskType==='marketing')c.require('lead.follow');
 if(i.ownerId!==undefined){c.require('lead.assign');const person=taskAssignee(s,c,i.ownerId,record.campusId,record.taskType),before=record.ownerId;record.ownerId=person.id;record.owner=person.name;record.assigneeId=person.id;record.assignmentHistory.push({at:c.now,actorId:c.actor.id,from:before,to:person.id,reason:text(i.note,'转派原因',1000)});}
 if(i.dueAt){c.require('lead.assign');record.dueAt=instant(i.dueAt,'任务截止时间');check(Date.parse(record.dueAt)>Date.parse(c.now),'截止时间须晚于当前时间');text(i.note,'延期原因',1000);}
 if(i.status){if(i.status==='cancelled'){c.require('lead.assign');record.cancelReason=text(i.note,'取消原因',1000);record.cancelledAt=c.now;}record.status=i.status;}
 if(i.note!==undefined)record.note=text(i.note,'调整说明',5000,true);changed(record,c,'调整任务安排',{status:record.status,ownerId:record.ownerId,dueAt:record.dueAt});if(record.status==='cancelled')finishBatch(s,record.batchId,c);return {record};
});
register('crm.task.complete','完成营销或服务任务','lead.create',{taskId:ref('crmTasks','任务'),result:enumeration('处理结果',['qualified','no_need','unreachable','invalid_contact','completed','refused']),note:str('处理结果说明',5000),opportunityId:ref('opportunities','已建立商机'),expectedVersion:expected},['taskId','result','note'],(s,i,c)=>{
 keys(i,['taskId','result','note','opportunityId','expectedVersion']);const record=get(s,'crmTasks',i.taskId,c);version(record,i);check(OPEN_TASKS.includes(record.status),'任务已结束','INVALID_STATE',409);if(record.taskType==='marketing'){c.require('lead.follow');check(['qualified','no_need','unreachable','invalid_contact'].includes(i.result),'营销任务结果无效');}else check(['completed','refused','unreachable','invalid_contact'].includes(i.result),'服务任务结果无效');
 if(i.result==='qualified'){check(i.opportunityId,'有效需求须关联已建立的商机');const opportunity=get(s,'opportunities',i.opportunityId,c,'read');check(opportunity.customerId===record.customerId,'商机客户与任务不一致');record.opportunityId=opportunity.id;}
 record.status='completed';record.result=i.result;record.resultNote=text(i.note,'处理结果说明',5000);record.completedAt=c.now;changed(record,c,'完成任务',{result:i.result,note:record.resultNote});finishBatch(s,record.batchId,c);return {record};
});
register('lead.batch.assign','批量分配线索并保留归属流水','lead.assign',{leadIds:{type:'array',title:'线索',minItems:1,maxItems:500,items:ref('leads','线索')},...allocationFields,reason:str('分配原因',1000)},['leadIds','ownerIds','strategy','reason'],(s,i,c)=>{
 keys(i,['leadIds','ownerIds','strategy','quotas','reason']);check(new Set(i.leadIds).size===i.leadIds.length&&new Set(i.ownerIds).size===i.ownerIds.length,'线索或员工列表重复');const reason=text(i.reason,'分配原因',1000),records=i.leadIds.map(id=>c.get('leads',id,{access:'write'}));for(const lead of records){check(lead.status!=='cold'&&lead.stage!=='已归档','归档线索须先恢复');check(lead.decisionStatus!=='pending','待决策线索须先完成去向决策');}
 const people=i.ownerIds.map(id=>{for(const record of records)owner(c,id,record.campusId);return (c.directory||[]).find(x=>x.id===id);});const allocation=assignmentPlan(records,people,i.strategy,i.quotas,x=>x.ownerId),changedRecords=[],skipped=[];
 for(const {record,person} of allocation.plan){if(record.ownerId===person.id){skipped.push({leadId:record.id,reason:'same_owner'});continue;}const before={id:record.ownerId||null,name:record.owner||'未分配'};record.ownerId=person.id;record.owner=person.name;record.assignedAt=c.now;record.assignmentFollowAt=null;record.nextFollowAt=null;record.next='未约定';record.status=record.stage==='已报名'?'converted':'assigned';if(record.stage!=='已报名')record.stage='新分配';record.assignmentHistory??=[];record.assignmentHistory.push({at:c.now,kind:'批量分配',from:before,to:{id:person.id,name:person.name},actorId:c.actor.id,reason});changed(record,c,'批量分配',{ownerId:person.id,reason,strategy:i.strategy});changedRecords.push(record);}
 return {records:changedRecords,skipped,assignmentCounts:Object.fromEntries(allocation.counts)};
});
register('crm.consultation.register','登记来访或咨询记录','lead.create',{customerId:ref('customers','客户'),channel:enumeration('咨询方式',['phone','wechat','visit','online','other']),note:str('咨询内容',5000),campusId:ref('campuses','校区'),campaignId:ref('campaigns','活动'),opportunityId:ref('opportunities','商机'),nextFollowAt:{type:'string',format:'date-time',title:'下次联系时间'}},['customerId','channel','note'],(s,i,c)=>{
 require('./business-reception.cjs').requireOwner(s,c.actor,'crm.consultation.register',i);keys(i,['customerId','channel','note','campusId','campaignId','opportunityId','nextFollowAt']);const customer=activeCustomer(s,i.customerId,c,'read'),camp=i.campusId?campusInfo(s,i.campusId,c):{campusId:customer.campusId,campus:customer.campus};check(!customer.campusId||!camp.campusId||customer.campusId===camp.campusId,'咨询校区与客户校区不一致');const campaign=campaignFor(s,i.campaignId,c,camp.campusId);let opportunity=null;if(i.opportunityId){opportunity=get(s,'opportunities',i.opportunityId,c,'read');check(opportunity.customerId===customer.id,'商机与客户不一致');}
 const nextFollowAt=i.nextFollowAt?instant(i.nextFollowAt,'下次联系时间'):null;check(!nextFollowAt||Date.parse(nextFollowAt)>Date.parse(c.now),'下次联系时间須晚于当前时间');const record=make(c,'CONSULTATION',{title:customer.name+' · 咨询',customerId:customer.id,customerName:customer.name,...camp,ownerId:c.actor.id,owner:c.actor.name,channel:i.channel,note:text(i.note,'咨询内容',5000),campaignId:campaign?.id||null,opportunityId:opportunity?.id||null,nextFollowAt,at:c.now,status:'recorded'});check(c.can(record,'consultations',{access:'write'}),'咨询不在当前授权范围','FORBIDDEN',403);changed(record,c,'登记咨询',{});s.consultations.push(record);
 const touchpoint=appendTouchpoint(s,{customerId:customer.id,campaignId:campaign?.id,channel:i.channel,kind:'consultation',note:record.note,subject:opportunity?.subject,term:opportunity?.term},c);record.touchpointId=touchpoint.id;if(opportunity){if(nextFollowAt&&OPEN_OPPORTUNITIES.includes(opportunity.stage)&&c.can(opportunity,'opportunities',{access:'write'}))opportunity.nextFollowAt=nextFollowAt;changed(opportunity,c,'新增接待咨询',{consultationId:record.id,note:record.note,nextFollowAt});if(opportunity.ownerId!==c.actor.id){s.inbox??=[];s.inbox.push({id:c.id('NOTICE'),ownerId:opportunity.ownerId,customerId:customer.id,opportunityId:opportunity.id,title:'接待咨询交接',text:customer.name+' 有新的咨询记录',createdAt:c.now,read:false});}}return {record,touchpoint};
});
function allowedOperationIds(state,actor,record,collection){
 const permission=id=>actor.permissions?.includes(id),write=canAccess(state,actor,record,collection,{access:'write'}),read=canAccess(state,actor,record,collection,{access:'read'}),ids=[];if(!write){if(read&&collection==='customers'&&record.status==='active'){if(permission('lead.create')){if(require('./business-reception.cjs').ownsCustomer(state,actor,record.id))ids.push('crm.consultation.register');ids.push('touchpoint.create');}if(permission('lead.follow'))ids.push('opportunity.create');}return ids;}
 if(collection==='customers'&&record.status==='active'){if(permission('lead.create')){if(require('./business-reception.cjs').ownsCustomer(state,actor,record.id))ids.push('crm.consultation.register');ids.push('touchpoint.create');}if(permission('lead.follow')){ids.push('customer.update','opportunity.create');if(permission('student.read'))ids.push('customer.linkStudent');}if(permission('lead.assign'))ids.push('customer.merge','crm.taskBatch.create');}
 if(collection==='campaigns'&&permission('lead.create')){if(record.status==='draft')ids.push('campaign.update','campaign.publish','campaign.linkForm');if(record.status==='published')ids.push('campaign.close','campaign.linkForm');}
 if(collection==='crmTasks'&&OPEN_TASKS.includes(record.status)&&permission('lead.create')&&(record.taskType!=='marketing'||permission('lead.follow')))ids.push('crm.task.update','crm.task.complete');
 if(collection==='opportunities'&&permission('lead.follow')&&record.stage!=='won'){ids.push('opportunity.advance');if(record.stage!=='closed')ids.push('opportunity.update','opportunity.followup');}
 return ids;
}
function projectRecord(state,actor,row,collection){
 if(!canAccess(state,actor,row,collection,{access:'read'}))return null;
 const record=structuredClone(row);
 if(collection==='crmTaskBatches'&&actor.scope?.type!=='all'){
  const tasks=(state.crmTasks||[]).filter(task=>task.batchId===row.id&&canAccess(state,actor,task,'crmTasks',{access:'read'}));record.taskIds=tasks.map(x=>x.id);record.customerIds=[...new Set(tasks.map(x=>x.customerId))];record.ownerIds=[...new Set(tasks.map(x=>x.ownerId))];record.assignmentCounts=Object.fromEntries(record.ownerIds.map(id=>[id,tasks.filter(x=>x.ownerId===id).length]));record.skipped=(row.skipped||[]).filter(x=>(state.customers||[]).some(customer=>customer.id===x.customerId&&canAccess(state,actor,customer,'customers',{access:'read'})));record.history=(record.history||[]).filter(x=>x.actorId===actor.id||actor.scope?.type==='campus');
 }
 if(collection==='importBatches'&&actor.scope?.type!=='all'){
  record.items=(row.items||[]).filter(item=>{
   if(item.customerId){const customer=(state.customers||[]).find(x=>x.id===item.customerId);return !!customer&&canAccess(state,actor,customer,'customers',{access:'read'});}
   if(item.leadId){const lead=(state.leads||[]).find(x=>x.id===item.leadId);return !!lead&&canAccess(state,actor,lead,'leads',{access:'read'});}
   const campusId=item.data?.campusId||row.campusId;return actor.scope?.type==='campus'?!!campusId&&actor.scope.campusIds?.includes(campusId):row.createdBy===actor.id;
  });
  record.summary=Object.fromEntries(['new_customer','existing_touch','duplicate_demand','invalid'].map(category=>[category,record.items.filter(item=>item.category===category).length]));record.total=record.items.length;
 }
 if(collection==='campaigns')record.formIds=(record.formIds||[]).filter(id=>{const form=(state.forms||[]).find(x=>x.id===id);return !!form&&canAccess(state,actor,form,'forms',{access:'read'});});
 if(collection==='campaigns'&&actor.scope?.type!=='all'&&row.createdBy!==actor.id&&row.ownerId!==actor.id&&!actor.permissions?.includes('lead.assign'))record.promotionLinks=(record.promotionLinks||[]).filter(link=>link.promoterId===actor.id);
 if(collection==='customers'){
  const related=(kind,id)=>(state[kind]||[]).some(x=>x.id===id&&canAccess(state,actor,x,kind,{access:'read'}));
  if(record.studentId&&!related('students',record.studentId))delete record.studentId;if(record.originLeadId&&!related('leads',record.originLeadId))delete record.originLeadId;
  record.mergedFromIds=(record.mergedFromIds||[]).filter(id=>related('customers',id));
 }
 record.allowedOperationIds=allowedOperationIds(state,actor,row,collection);return record;
}
module.exports={operations,helpers:{init,COLLECTIONS,OPEN_TASKS,OPEN_OPPORTUNITIES,STAGES,createCustomer,resolveCustomer,customerFromLead,appendTouchpoint,attachLeadTouch,importAcquisition,createOpportunity,markOpportunityWon,primaryContact,needKey,allowedOperationIds,projectRecord}};
