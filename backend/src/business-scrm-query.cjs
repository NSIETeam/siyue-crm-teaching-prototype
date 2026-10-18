'use strict';

// A single server query powers the workbench, browser lists, CLI and MCP.
const {assert,canAccess,canReadFormSubmission}=require('./business-common.cjs');
const {range}=require('./business-lead-reports.cjs');
const permissions={
 leads:['lead.read','lead.create','lead.follow','lead.assign'],
 customers:['lead.read','lead.create','lead.follow'],campaigns:['lead.read','lead.create','lead.assign'],
 touchpoints:['lead.read','lead.create','lead.follow'],consultations:['lead.read','lead.create','lead.follow'],
 crmTaskBatches:['lead.read','lead.follow','lead.assign'],crmTasks:['lead.read','lead.follow','lead.assign'],
 opportunities:['lead.read','lead.follow','lead.create'],
 orders:['order.read','order.confirmReceipt'],receipts:['order.read','order.confirmReceipt'],refunds:['refund.read','refund.approve','lead.conversion.read'],enrollments:['student.read','enrollment.create'],
 serviceTickets:['lead.read','lead.follow','lead.assign'],attributionRequests:['lead.read','lead.follow','lead.assign','order.read'],
 importBatches:['lead.create','lead.assign'],routingRules:['lead.assign'],routingQueue:['lead.assign'],
 trialBookings:['lead.read','lead.follow','lead.create'],formSubmissions:['lead.create','promotion.publish','store.design'],
 leadReclaimRequests:['lead.follow','lead.assign'],savedCrmViews:['lead.read','lead.follow','lead.assign'],
};
const has=(actor,...names)=>names.some(name=>actor.permissions?.includes(name));
const canTeam=actor=>['all','campus'].includes(actor.scope?.type)&&has(actor,'lead.assign','report.read');
const day=at=>new Date(at).toLocaleDateString('en-CA',{timeZone:'Asia/Shanghai'});
const stamp=value=>Date.parse(value);
const coldPool=row=>row.stage==='已流失'||row.stage==='冷宫'||row.status==='cold'&&row.stage!=='已归档';
const archived=row=>['cold','archived'].includes(row.status)||['已归档','已流失'].includes(row.stage);
function converted(state,row){return (state.orders||[]).some(order=>order.conversionSnapshot?.leadId===(row.id||row.leadId)&&Number.isFinite(stamp(order.conversionSnapshot.convertedAt)));}
function leadStage(state,row){return converted(state,row)?'已成单':coldPool(row)?'冷宫':archived(row)?'已归档':row.ownerId?(row.stage==='待报名'?'待报名':'跟进中'):'待分配';}
function timing(state,row,now){
 const assigned=stamp(row.assignedAt||row.createdAt),follow=stamp(row.assignmentFollowAt||row.firstFollowAt),last=stamp(row.lastFollowAt),next=stamp(row.nextFollowAt),p=state.leadPolicy||{};
 const active=!!row.ownerId&&!archived(row)&&!converted(state,row),waiting=active&&Number.isFinite(assigned)&&(!Number.isFinite(follow)||follow<assigned),firstDeadline=assigned+Number(p.firstFollowHours??4)*3600000;
 const reclaimAt=Math.max(assigned+Number(p.reserveDays??14)*86400000,(Number.isFinite(last)&&last>=assigned?last:assigned)+Number(p.reclaimDays??21)*86400000);
 return {active,firstContact:waiting,firstOverdue:waiting&&firstDeadline<=now,today:active&&Number.isFinite(next)&&day(next)===day(now),overdue:active&&(waiting&&firstDeadline<=now||Number.isFinite(next)&&next<now),future:active&&Number.isFinite(next)&&day(next)>day(now),recycle:active&&reclaimAt<=now,recycleSoon:active&&reclaimAt>now&&reclaimAt<=now+3*86400000,reclaimAt:Number.isFinite(reclaimAt)?new Date(reclaimAt).toISOString():null};
}
const queryKeys=new Set(['resource','scope','queue','id','customerId','campaignId','ownerId','campusId','stage','intent','followupQueue','status','taskType','search','from','to','dateField','sort','page','pageSize']);
 const queues=['all','firstContact','today','overdue','future','unassigned','decision','pending','converted','recycleSoon','recycle','unmatched','cold','archived','completed','active','created','participated','registered'];
function filters(input,actor){
 const q=input instanceof URLSearchParams?Object.fromEntries(input):{...input};
 if(input instanceof URLSearchParams)for(const key of input.keys())assert(input.getAll(key).length===1,'查询条件不能重复','INVALID_QUERY',400);
 assert(Object.keys(q).every(key=>queryKeys.has(key)),'包含不支持的查询条件','INVALID_QUERY',400);
 const resource=q.resource||'leads',scope=q.scope||'mine',queue=q.queue||'all';
 assert(Object.hasOwn(permissions,resource),'不支持此 CRM 资源','INVALID_RESOURCE',400);
 assert(['mine','team'].includes(scope),'范围无效','INVALID_SCOPE',400);
 assert(scope!=='team'||canTeam(actor),'没有团队范围查看权限','FORBIDDEN',403);
 assert(queues.includes(queue),'队列无效','INVALID_QUEUE',400);assert(!q.followupQueue||resource==='leads'&&['firstContact','today','overdue','future','decision','recycleSoon','recycle'].includes(q.followupQueue),'回访筛选无效','INVALID_QUERY',400);
 assert(has(actor,...permissions[resource]),'没有此资源查看权限','FORBIDDEN',403);
 const page=Number(q.page||1),pageSize=Number(q.pageSize||50);
 assert(Number.isSafeInteger(page)&&page>=1&&page<=1000000&&Number.isSafeInteger(pageSize)&&pageSize>=1&&pageSize<=200,'分页参数无效','INVALID_PAGE',400);
 const priorityQueue=resource==='leads'&&queue==='active',sort=q.sort||(priorityQueue?'intentPriority:asc':'updatedAt:desc');assert(['updatedAt:desc','createdAt:desc','createdAt:asc','nextFollowAt:asc','dueAt:asc','name:asc'].includes(sort)||priorityQueue&&sort==='intentPriority:asc','排序方式无效','INVALID_SORT',400);
 for(const [key,value] of Object.entries(q))assert(typeof value==='string'||['page','pageSize'].includes(key)&&Number.isSafeInteger(value),'查询条件格式无效','INVALID_QUERY',400);
 for(const key of ['id','customerId','campaignId','ownerId','campusId','stage','intent','followupQueue','status','taskType','search'])if(q[key]!==undefined)assert(q[key].length<=200&&!/[\u0000-\u001f]/.test(q[key]),'查询条件过长或含无效字符','INVALID_QUERY',400);
 const dateField=q.dateField||'createdAt';assert(['createdAt','completedAt','paidAt','at','receivedAt','submittedAt'].includes(dateField),'日期口径无效','INVALID_QUERY',400);
 let dates;try{dates=range(new URLSearchParams({...(q.from?{from:q.from}:{}),...(q.to?{to:q.to}:{})}));}catch(e){e.status=400;throw e;}
 return {...q,resource,scope,queue,page,pageSize,sort,dateField,...dates};
}
function accessible(state,actor,resource,projection){
 if(resource==='savedCrmViews')return (state.savedCrmViews||[]).filter(row=>row.ownerId===actor.id);
 if(resource==='formSubmissions')return (state.forms||[]).filter(form=>canAccess(state,actor,form,'forms',{access:'read'})).flatMap(form=>(form.submissions||[]).filter(row=>canReadFormSubmission(actor,form,row)).map(row=>({...row,formId:form.id,name:form.title||form.name,ownerId:row.publisherId||form.publishedBy||form.createdBy,campusId:form.campusId})));
 if(resource==='trialBookings')return projection?.trialBookings||[];
 if(resource==='leadReclaimRequests')return (state.leadReclaimRequests||[]).filter(row=>row.applicantId===actor.id&&has(actor,'lead.follow')||has(actor,'lead.assign')&&(state.leads||[]).some(lead=>lead.id===row.leadId&&canAccess(state,actor,lead,'leads',{access:'read'})));
 return (state[resource]||[]).filter(row=>canAccess(state,actor,row,resource,{access:'read'})||['orders','receipts','refunds'].includes(resource)&&has(actor,'lead.conversion.read')&&(()=>{const order=resource==='orders'?row:(state.orders||[]).find(o=>o.id===row.orderId);return order&&require('./business-scrm-service.cjs').helpers.effectiveAttribution(state,order)?.ownerId===actor.id;})());
}
function mine(row,resource,actor,queue,state){
 if(['orders','receipts','refunds'].includes(resource)&&has(actor,'lead.conversion.read')){const order=resource==='orders'?row:(state.orders||[]).find(o=>o.id===row.orderId);const attribution=order&&require('./business-scrm-service.cjs').helpers.effectiveAttribution(state,order);if(attribution)return attribution.ownerId===actor.id;}
 if(resource==='leads')return queue==='registered'?(row.registrarId||row.registrantId||row.createdBy)===actor.id:['decision'].includes(queue)?row.decisionById===actor.id:queue==='unassigned'?row.registrarId===actor.id||row.createdBy===actor.id:row.ownerId===actor.id;
 if(resource==='campaigns')return queue==='created'?row.createdBy===actor.id:queue==='participated'?row.participantIds?.includes(actor.id)||row.promoterIds?.includes(actor.id):row.createdBy===actor.id||row.ownerId===actor.id||row.participantIds?.includes(actor.id)||row.promoterIds?.includes(actor.id);
 if(resource==='customers')return [row.ownerId,row.createdBy].includes(actor.id)||['leads','opportunities','crmTasks'].some(key=>(state[key]||[]).some(item=>item.customerId===row.id&&(item.ownerId===actor.id||item.assigneeId===actor.id)));
 return [row.ownerId,row.assigneeId,row.applicantId,row.createdBy,row.employeeId].includes(actor.id);
}
function queueMatches(state,row,resource,queue,now){
 if(queue==='all'||queue==='registered'&&resource==='leads')return true;
 if(resource==='campaigns'&&['created','participated'].includes(queue))return true;
 if(resource==='leads'){
  const t=timing(state,row,now);
  if(['firstContact','today','overdue','future','recycleSoon','recycle'].includes(queue))return t[queue];
  if(queue==='unassigned')return !row.ownerId&&!archived(row)&&!converted(state,row)&&row.decisionStatus!=='pending';
  if(queue==='decision'||queue==='pending')return !archived(row)&&row.decisionStatus==='pending';
  if(queue==='converted')return converted(state,row);
  if(queue==='cold')return coldPool(row)&&!converted(state,row);
  if(queue==='archived')return archived(row)&&!coldPool(row)&&!converted(state,row);
  if(queue==='active')return !!row.ownerId&&!archived(row)&&row.stage!=='已流失'&&!converted(state,row);
 }
 if(queue==='unmatched')return resource==='orders'&&!row.opportunityId;
 if(queue==='unassigned')return !row.ownerId&&!row.assigneeId;
 if(queue==='pending')return ['pending','in_progress','processing','open','submitted'].includes(row.status);
 if(queue==='completed')return ['completed','closed','resolved'].includes(row.status);
 if(queue==='converted')return row.stage==='won';
 if(queue==='archived')return archived(row)||row.stage==='closed';
 const at=resource==='trialBookings'?stamp(row.date+'T00:00:00+08:00'):stamp(row.dueAt||row.nextFollowAt);
 const active=!['completed','closed','cancelled','rejected','resolved','won','converted'].includes(row.status);
 if(queue==='active')return active;
 if(queue==='today')return active&&Number.isFinite(at)&&day(at)===day(now);
 if(queue==='future')return active&&Number.isFinite(at)&&day(at)>day(now);
 if(queue==='overdue')return active&&Number.isFinite(at)&&at<now;
 return false;
}
function rowsFor(state,actor,f,projection,now){
 const needle=f.search?.normalize('NFKC').trim().toLowerCase();
 return accessible(state,actor,f.resource,projection).filter(row=>{
  if(f.scope==='mine'&&!f.id&&!f.customerId&&!mine(row,f.resource,actor,f.queue,state))return false;
  if(f.resource==='campaigns'&&f.queue==='created'&&row.createdBy!==actor.id)return false;
  if(f.resource==='campaigns'&&f.queue==='participated'&&!row.participantIds?.includes(actor.id)&&!row.promoterIds?.includes(actor.id))return false;
  if(!queueMatches(state,row,f.resource,f.queue,now)||f.followupQueue&&!queueMatches(state,row,f.resource,f.followupQueue,now))return false;
  for(const key of ['id','customerId','campaignId','ownerId','campusId','stage','intent','status','taskType'])if(f[key]&&(key==='stage'&&f.resource==='leads'?leadStage(state,row):key==='intent'?(row.intent||'未标记'):row[key])!==(key==='stage'&&f.resource==='leads'?({'新线索':'待分配','新分配':'跟进中','已报名':'已成单'}[f[key]]||f[key]):f[key])){if(key==='campaignId'&&f.resource==='leads'&&(state.touchpoints||[]).some(touch=>touch.leadId===row.id&&touch.campaignId===f.campaignId&&canAccess(state,actor,touch,'touchpoints',{access:'read'})))continue;if(key==='customerId'&&['orders','enrollments','refunds','receipts'].includes(f.resource)){const customer=(state.customers||[]).find(c=>c.id===f.customerId&&canAccess(state,actor,c,'customers',{access:'read'}));if(customer&&[customer.studentId,...customer.studentIds||[]].filter(Boolean).includes(row.studentId))continue;}return false;}
  const at=row[f.dateField];if(f.from||f.to){if(!Number.isFinite(stamp(at))||f.from&&stamp(at)<stamp(f.from)||f.to&&stamp(at)>stamp(f.to))return false;}
  if(needle){const student=(state.students||[]).find(s=>s.id===row.studentId),customer=(state.customers||[]).find(c=>c.id===row.customerId&&canAccess(state,actor,c,'customers',{access:'read'}));const values=[row.id,row.leadId,row.name,row.title,row.phone,row.contactPhone,row.studentNo,row.studentCode,row.source,row.subject,row.term,row.guardian,student?.studentNo,student?.studentCode,customer?.name,customer?.studentName,...(row.contacts||[]).flatMap(c=>[c.name,c.phone,c.value]),...(row.guardians||[]).flatMap(c=>[c.name,c.phone])];if(!values.filter(Boolean).join(' ').normalize('NFKC').toLowerCase().includes(needle))return false;}
  return true;
 });
}
function leadActions(state,actor,row,now){
 const writable=canAccess(state,actor,row,'leads',{access:'write'}),pending=row.decisionStatus==='pending',won=converted(state,row),cold=archived(row),allowed=[];
 const add=(op,permission,when)=>{if(when&&has(actor,permission))allowed.push(op);};
 const decision=writable&&pending&&row.decisionById===actor.id&&stamp(row.decisionDeadline)>now;
 add('lead.retain','lead.follow',decision);add('lead.transfer','lead.transfer',decision||writable&&!pending&&!cold&&!!row.ownerId);add('lead.release','lead.release',decision||writable&&!pending&&!cold&&!won&&!!row.ownerId);
 add('lead.assign','lead.assign',writable&&!pending&&!cold&&!row.ownerId);add('lead.followup','lead.follow',writable&&!pending&&!cold&&!!row.ownerId&&!['已流失','已归档'].includes(row.stage)&&row.ownerId===actor.id);
 add('lead.update','lead.create',writable&&!pending&&has(actor,'lead.follow')&&(row.ownerId===actor.id||has(actor,'lead.assign')));
 add('lead.archive','lead.follow',writable&&!pending&&!cold&&!won);add('lead.reactivate','lead.assign',writable&&cold);
 add('lead.reclaim.request','lead.follow',!row.ownerId&&row.decisionStatus==='timed_out'&&!won);
 add('customer.fromLead','lead.follow',!row.customerId&&writable);add('lead.claim','lead.assign',writable&&!cold&&!row.ownerId&&row.status==='new'&&row.decisionStatus!=='timed_out');add('lead.status.update','lead.follow',writable&&!pending&&!cold&&!won&&!!row.ownerId&&(row.ownerId===actor.id||has(actor,'lead.assign')));return allowed;
}
function decorate(state,actor,row,resource,directory,now){
 const core=require('./business-scrm-core.cjs');
 const out=(core.helpers?.projectRecord?core.helpers.projectRecord(state,actor,row,resource):null)||structuredClone(row);
 if(resource==='refunds'&&!has(actor,'refund.read','refund.approve','refund.submit'))for(const key of Object.keys(out))if(!['id','orderId','studentId','campusId','amountCents','status','submittedAt','createdAt','updatedAt','version'].includes(key))delete out[key];
 const lookup=(key,id)=>{const item=(state[key]||[]).find(r=>r.id===id);return item&&canAccess(state,actor,item,key,{access:'read'})?item.name||item.title||item.studentName||item.id:null;};
 out.display={name:row.name||row.studentName||row.title||row.id,owner:directory.find(person=>person.id===(row.ownerId||row.assigneeId))?.name||'未分配',campus:lookup('campuses',row.campusId)||'待补充',customer:lookup('customers',row.customerId),campaign:lookup('campaigns',row.campaignId)};
 out.allowedOperationIds=resource==='leads'?leadActions(state,actor,row,now):[...(core.helpers?.allowedOperationIds?.(state,actor,row,resource)||[]),...(require('./business-scrm-service.cjs').helpers.allowedOperationIds(state,actor,row,resource)||[])];
 if(resource==='formSubmissions'&&has(actor,'lead.create')&&(actor.roleIds?.includes('superadmin')||row.publisherId===actor.id)&&canAccess(state,actor,(state.forms||[]).find(f=>f.id===row.formId),'forms',{access:'write'})){out.allowedOperationIds.push('form.submission.annotate');if(row.status==='pending')out.allowedOperationIds.push('form.submission.review');out.submissionId=row.id;}
 if(resource==='leadReclaimRequests'&&row.status==='pending'&&has(actor,'lead.assign')&&(state.leads||[]).some(lead=>lead.id===row.leadId&&canAccess(state,actor,lead,'leads',{access:'write'})))out.allowedOperationIds.push('lead.reclaim.review');
 if(resource==='savedCrmViews'&&row.ownerId===actor.id&&has(actor,'lead.read'))out.allowedOperationIds.push('crm.view.save','crm.view.archive');
 if(resource==='leads'){out.canonicalConverted=converted(state,row);out.stage=leadStage(state,row);out.intent=row.intent||'未标记';out.timing=timing(state,row,now);}
 return out;
}
function compareActiveLeadPriority(a,b){
 const ranks={'高意向':0,'热意向':0,high:0,'中意向':1,'温意向':1,medium:1,'低意向':2,'冷意向':2,low:2};
 const rank=row=>{const key=String(row.intent||'').trim().toLowerCase();return Object.hasOwn(ranks,key)?ranks[key]:3;};
 const priority=rank(a)-rank(b);if(priority)return priority;
 const valid=value=>{const at=stamp(value);return Number.isFinite(at)?at:null;};
 const aNext=valid(a.nextFollowAt)??Infinity,bNext=valid(b.nextFollowAt)??Infinity;
 if(aNext!==bNext)return aNext<bNext?-1:1;
 const recent=row=>valid(row.lastFollowAt)??valid(row.createdAt)??valid(row.assignedAt)??0;
 return recent(b)-recent(a)||(valid(b.createdAt)??0)-(valid(a.createdAt)??0)||String(a.id||a.leadId||'').localeCompare(String(b.id||b.leadId||''));
}
function query(snapshot,actor,directory,input,projection,now=Date.now()){
 const f=filters(input,actor),rows=rowsFor(snapshot.state,actor,f,projection,now),[field,direction]=f.sort.split(':'),sign=direction==='asc'?1:-1;
 rows.sort(f.sort==='intentPriority:asc'?compareActiveLeadPriority:(a,b)=>String(a[field]||'').localeCompare(String(b[field]||''),'zh-CN')*sign||String(a.id).localeCompare(String(b.id)));
 const offset=(f.page-1)*f.pageSize;
 return {items:rows.slice(offset,offset+f.pageSize).map(row=>decorate(snapshot.state,actor,row,f.resource,directory,now)),total:rows.length,page:f.page,pageSize:f.pageSize,filters:f,scope:f.scope,revision:snapshot.revision,updatedAt:new Date(now).toISOString()};
}
function workbench(snapshot,actor,directory,input={},projection,now=Date.now()){
 const inputKeys=input instanceof URLSearchParams?[...input.keys()]:Object.keys(input);assert(inputKeys.every(key=>key==='scope')&&(!(input instanceof URLSearchParams)||input.getAll('scope').length<=1),'工作台仅支持范围筛选','INVALID_QUERY',400);
 const scope=input instanceof URLSearchParams?input.get('scope')||'mine':input.scope||'mine';assert(['mine','team'].includes(scope)&& (scope!=='team'||canTeam(actor)),'没有此范围查看权限','FORBIDDEN',403);
 const definitions=[['firstContact','待首联','leads'],['today','今天回访','leads'],['overdue','逾期跟进','leads'],['future','未来回访','leads'],['unassigned','待分配','leads'],['decision','待处置','leads'],['recycleSoon','即将回收','leads'],['today','今天试听','trialBookings'],['future','未来试听','trialBookings'],['pending','表单待审核','formSubmissions'],['pending','取回待审批','leadReclaimRequests'],['pending','归因待审核','attributionRequests'],['today','今天任务','crmTasks'],['today','商机今天回访','opportunities'],['overdue','商机逾期回访','opportunities'],['future','商机未来回访','opportunities'],['overdue','服务工单逾期','serviceTickets']];
 const cards=definitions.filter(([, ,resource])=>resource!=='opportunities'&&has(actor,...permissions[resource])).map(([queue,label,resource])=>{const q={resource,scope,queue},f=filters(q,actor);return {key:resource+':'+queue,label,count:rowsFor(snapshot.state,actor,f,projection,now).length,query:q};});
 return {scope,scopeLabel:scope==='mine'?'我的跟进':actor.scope.type==='campus'?'授权校区团队':'全部授权团队',canTeam:canTeam(actor),cards,revision:snapshot.revision,updatedAt:new Date(now).toISOString()};
}
module.exports={permissions,canTeam,filters,accessible,rowsFor,query,workbench,converted,timing,decorate};
