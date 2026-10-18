'use strict';
const {assert,canAccess}=require('./business-common.cjs');
// Reception is a separate, deliberately small projection, never a full customer record.
function scrub(value){const dates=[];const text=String(value??'').replace(/\b20\d{2}-?(?:0[1-9]|1[0-2])-?(?:0[1-9]|[12]\d|3[01])\b/g,date=>{const key=dates.length;dates.push(date);return '\uE000'+key.toString(36)+'\uE001';});return text.replace(/(?:\+?\d[\d ()-]{5,}\d)/g,match=>match.replace(/\D/g,'').length>=7?'[电话已隐藏]':match).replace(/\uE000([0-9a-z]+)\uE001/g,(_,key)=>dates[parseInt(key,36)]);}
function ownsCustomer(state,actor,customerId){
 const customer=(state.customers||[]).find(x=>x.id===customerId);
 if(!customer)return false;
 const leads=(state.leads||[]).filter(l=>l.customerId===customerId||customer.leadId===l.id);
 const tasks=(state.crmTasks||[]).filter(t=>t.customerId===customerId&&['pending','in_progress'].includes(t.status));
 return leads.length||tasks.length?[...leads,...tasks].some(l=>l.ownerId===actor.id):customer.ownerId===actor.id;
}
function requireOwner(state,actor,operation,input){
 if(!['lead.followup','opportunity.followup','crm.consultation.register'].includes(operation))return;
 const row=operation==='lead.followup'?(state.leads||[]).find(l=>l.id===input.leadId):operation==='opportunity.followup'?(state.opportunities||[]).find(o=>o.id===input.opportunityId):null;
 assert(operation==='crm.consultation.register'?ownsCustomer(state,actor,input.customerId):row?.ownerId===actor.id,'仅当前负责人本人可以记录跟进或咨询','FORBIDDEN',403);
}
function query(snapshot,actor,directory,params){
 assert(actor&&!actor.disabled&&!actor.mustChangePassword&&(actor.permissions||[]).some(p=>['lead.read','lead.create','lead.follow','student.read'].includes(p)),'没有前台接待查看权限','FORBIDDEN',403);
 for(const key of params.keys())assert(['search','page','pageSize'].includes(key)&&params.getAll(key).length===1,'查询条件无效','INVALID_QUERY',400);
 const search=(params.get('search')||'').trim(),page=Number(params.get('page')||1),pageSize=Number(params.get('pageSize')||25);
 assert(search.length>0&&search.length<=120&&!/[\u0000-\u001f]/.test(search),'请填写学生姓名、学号或编号','INVALID_QUERY',400);
 assert(Number.isSafeInteger(page)&&page>=1&&page<=1000000&&Number.isSafeInteger(pageSize)&&pageSize>=1&&pageSize<=50,'分页参数无效','INVALID_QUERY',400);
 const state=snapshot.state,students=state.students||[],customers=state.customers||[],leads=state.leads||[],groups=new Map();
 const visible=(row,kind)=>actor.scope?.type==='campus'?canAccess(state,actor,row,kind,{access:'read'}):actor.scope?.type==='assigned'?canAccess(state,actor,row,kind,{access:'read'}):['all','own'].includes(actor.scope?.type);
 function add(row,kind){
  if(!visible(row,kind))return;
  const student=kind==='students'?row:students.find(s=>s.id===row.studentId||s.customerId&&s.customerId===(kind==='customers'?row.id:row.customerId)||s.leadId&&s.leadId===(kind==='leads'?row.id:row.leadId));
  const customer=kind==='customers'?row:customers.find(c=>c.id===(row.customerId||student?.customerId)||c.studentId&&c.studentId===student?.id||c.leadId&&c.leadId===(kind==='leads'?row.id:row.leadId));
  const relatedLeads=leads.filter(l=>visible(l,'leads')&&(kind==='leads'&&l.id===row.id||customer&&(l.customerId===customer.id||customer.leadId===l.id)||student&&(l.studentId===student.id||student.leadId===l.id)));
  const key=student?'student:'+student.id:customer?'customer:'+customer.id:'lead:'+row.id;
  if(groups.has(key))return;
  const name=student?.name||customer?.name||row.name||'',number=student?.studentNo||student?.no||row.studentNo||'';
  if(![name,number,row.id,customer?.id,student?.id,...relatedLeads.map(l=>l.id)].filter(Boolean).some(v=>String(v).toLowerCase().includes(search.toLowerCase())))return;
  const base=student||customer||row,campusId=base.campusId||customer?.campusId||row.campusId;
  const taskOwners=customer?(state.crmTasks||[]).filter(t=>t.customerId===customer.id&&visible(t,'crmTasks')&&['pending','in_progress'].includes(t.status)).map(t=>t.ownerId):[];
  const ownerIds=[...new Set([...relatedLeads.map(l=>l.ownerId),...taskOwners].filter(Boolean))];if(!ownerIds.length&&(customer?.ownerId||base.ownerId))ownerIds.push(customer?.ownerId||base.ownerId);
  const comm=[];
  for(const lead of relatedLeads)for(const h of lead.history||[])if(['跟进','沟通'].includes(h.kind))comm.push({id:h.id,at:h.at,actor:directory.find(u=>u.id===h.actorId)?.name||h.actor||'',channel:h.detail?.channel||'',note:h.detail?.note||''});
  if(customer)for(const c of state.consultations||[])if(c.customerId===customer.id&&visible(c,'consultations'))comm.push({id:c.id,at:c.at||c.createdAt,actor:directory.find(u=>u.id===(c.ownerId||c.createdBy))?.name||c.owner||'',channel:c.channel,note:c.note});
  if(student)for(const c of state.studentCommunications||[])if(c.studentId===student.id&&visible(c,'students'))comm.push({id:c.id,at:c.createdAt,actor:c.actorName||'',channel:c.channel,note:c.note});
  const followable=relatedLeads.filter(l=>l.ownerId===actor.id&&l.decisionStatus!=='pending'&&!['已归档','已流失'].includes(l.stage)&&!['cold','archived'].includes(l.status));
  groups.set(key,{id:key,name,studentNo:number,grade:base.grade||customer?.grade||row.grade||'',gender:base.gender||'',subject:base.subject||customer?.subject||row.subject||'',campus:(state.campuses||[]).find(c=>c.id===campusId)?.name||'待补充',owners:ownerIds.map(id=>({id,name:directory.find(u=>u.id===id)?.name||'负责人'})),communications:comm.sort((a,b)=>String(b.at||'').localeCompare(String(a.at||''))).slice(0,100),followupLeadIds:(actor.permissions||[]).includes('lead.follow')?followable.map(l=>l.id):[],consultationCustomerId:customer&&ownsCustomer(state,actor,customer.id)&&(actor.permissions||[]).includes('lead.create')?customer.id:null});
 }
 for(const [kind,rows]of [['students',students],['customers',customers],['leads',leads]])for(const row of rows)add(row,kind);
 const items=[...groups.values()].sort((a,b)=>a.name.localeCompare(b.name)||a.id.localeCompare(b.id));
 // Apply redaction to every emitted string, including free-form communication notes and names.
 const clean=(value,key='')=>Array.isArray(value)?value.map(v=>clean(v,key)):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,clean(v,k)])):typeof value==='string'&&!['id','studentNo','at','followupLeadIds','consultationCustomerId'].includes(key)?scrub(value):value;
 return {items:clean(items.slice((page-1)*pageSize,page*pageSize)),total:items.length,page,pageSize,revision:snapshot.revision};
}
module.exports={query,requireOwner,ownsCustomer,scrub};
