'use strict';

class AuditQueryError extends Error {
 constructor(status,code,message){super(message);this.status=status;this.code=code;}
}
const fail=(code,message)=>{throw new AuditQueryError(400,code,message);};

function readText(query,key,max,{aliases=[],code='INVALID_INPUT',label='筛选条件'}={}){
 const name=[key,...aliases].find(candidate=>query.has(candidate));
 if(!name)return '';
 const values=query.getAll(name),raw=values[0];
 if(raw===undefined||values.some(value=>value.length>max||/[\u0000-\u001f\u007f]/.test(value)))fail(code,label+'无效');
 return raw.trim();
}
function parseAuditQuery(query){
 const from=readText(query,'from',40,{code:'INVALID_DATE',label:'日期筛选'});
 const to=readText(query,'to',40,{code:'INVALID_DATE',label:'日期筛选'});
 if((from&&!Number.isFinite(Date.parse(from)))||(to&&!Number.isFinite(Date.parse(to))))fail('INVALID_DATE','日期筛选无效');
 if(from&&to&&Date.parse(from)>Date.parse(to))fail('INVALID_DATE','开始日期不能晚于结束日期');
 const limits=query.getAll('limit'),rawLimit=limits.length?limits[0]:'100';
 if(limits.some(value=>value.length>3))fail('INVALID_LIMIT','每页数量须为 1–500');
 const count=Number(rawLimit);
 if(!Number.isInteger(count)||count<1||count>500)fail('INVALID_LIMIT','每页数量须为 1–500');
 const actor=readText(query,'actor',128,{label:'员工编号'});
 const actorId=readText(query,'actorId',128,{label:'员工编号'});
 const view=readText(query,'view',20,{label:'日志视图'})||'all';
 if(!['activity','attention','all'].includes(view))fail('INVALID_INPUT','日志视图无效');
 return {
  from,to,count,view,
  actorId:actor||actorId,
  actorQuery:readText(query,'actorQuery',120,{label:'姓名或账号筛选'}),
  action:readText(query,'action',120,{label:'操作筛选'}),
  actionPrefix:readText(query,'actionPrefix',120,{label:'操作前缀'}),
  group:readText(query,'group',100,{label:'操作类别'}),
  outcome:readText(query,'outcome',40,{label:'操作结果'}),
  before:readText(query,'before',128,{code:'INVALID_CURSOR',label:'日志分页位置'}),
 };
}

const lower=value=>String(value||'').toLowerCase();
function systemRead(event){
 const action=lower(event.action);
 return ['audit.query','account.list','report.sales','report.teachers','sales.activity','makeup.candidates','session.attendance.roster'].includes(action)||/^(?:read|directory|staff\.directory|employee\.directory)\./.test(action);
}
function attentionEvent(event){
 const outcome=lower(event.outcome),action=lower(event.action);
 if(['preview','replayed'].includes(outcome))return false;
 if(systemRead(event)&&!['denied','failed','failure','rejected','error'].includes(outcome))return false;
 if(['denied','failed','failure','rejected','error'].includes(outcome))return true;
 return action.startsWith('refund.')||action.startsWith('account.')||action.startsWith('role.')||action==='auth.password'||['enrollment.withdraw','enrollment.cancel','enrollment.transfer','enrollment.batchtransfer'].includes(action);
}
function category(event){
 const action=lower(event.action);
 if(systemRead(event))return 'system';
 if(action.startsWith('auth.'))return 'security';
 if(action.startsWith('account.')||action.startsWith('role.'))return 'account';
 if(action.startsWith('refund.')||action.startsWith('order.'))return 'finance';
 if(action.startsWith('enrollment.'))return 'enrollment';
 return 'business';
}
function outcomeLabel(value){
 const outcome=lower(value);
 return ({success:'成功',preview:'预览 · 未提交',replayed:'已去重',denied:'已拒绝',rejected:'已拒绝',failed:'失败',failure:'失败',error:'失败'})[outcome]||'已记录/未知';
}
function safeName(value){return typeof value==='string'&&value.trim()&&value.trim().length<=120?value.trim():undefined;}
function businessName(change,changes,state){
 if(change.collection==='orders'){
  const order=change.after||change.before||(Array.isArray(state?.orders)?state.orders.find(item=>item?.id===change.id):null);
  const studentIds=[change.after?.studentId,change.before?.studentId,order?.studentId].filter(Boolean);
  const studentHistorical=studentIds.map(studentId=>{const row=changes.find(item=>item?.collection==='students'&&item.id===studentId);return safeName(row?.after?.name)||safeName(row?.before?.name);}).find(Boolean);
  const studentRows=Array.isArray(state?.students)?state.students:[];
  const studentCurrent=studentIds.map(id=>safeName(studentRows.find(item=>item?.id===id)?.name)).find(Boolean);
  const relatedStudentName=studentHistorical||studentCurrent;
  return relatedStudentName?{relatedStudentName}:{};
 }
 const historical=safeName(change.after?.name)||safeName(change.after?.title)||safeName(change.before?.name)||safeName(change.before?.title);
 if(historical)return {name:historical};
 const collection=change.collection,rows=['students','classes','courses','leads','orders'].includes(collection)&&Array.isArray(state?.[collection])?state[collection]:[];
 const row=rows.find(item=>item&&item.id===change.id);
 const current=safeName(row?.name)||safeName(row?.title);
 if(current)return {name:current};
 return {};
}
function selectAuditPage(events,directory,query,businessState){
 const filters=parseAuditQuery(query);
 const users=new Map((directory||[]).filter(x=>x&&x.id).map(x=>[x.id,x]));
 const actorNeedle=filters.actorQuery.toLowerCase();
 let rows=events.filter(event=>{
  if(filters.view==='activity'&&(systemRead(event)||['preview','replayed'].includes(lower(event.outcome))))return false;
  if(filters.view==='attention'&&!attentionEvent(event))return false;
  if(filters.actorId&&event.actorId!==filters.actorId)return false;
  if(filters.action&&event.action!==filters.action)return false;
  if(filters.actionPrefix&&!String(event.action||'').toLowerCase().startsWith(filters.actionPrefix.toLowerCase()))return false;
  if(filters.group&&String(event.action||'').split('.')[0]!==filters.group)return false;
  if(filters.outcome&&event.outcome!==filters.outcome)return false;
  const at=Date.parse(event.at);
  if(filters.from&&(!Number.isFinite(at)||at<Date.parse(filters.from)))return false;
  if(filters.to&&(!Number.isFinite(at)||at>Date.parse(filters.to)))return false;
  if(actorNeedle){
   const user=users.get(event.actorId);
   const names=[event.actorName,user?.name,user?.username,user?.employeeNo,event.actorId];
   if(!names.some(value=>typeof value==='string'&&value.toLowerCase().includes(actorNeedle)))return false;
  }
  return true;
 });
 if(filters.before){const index=rows.findIndex(event=>event.id===filters.before);if(index<0)fail('INVALID_CURSOR','日志分页位置无效');rows=rows.slice(index+1);}
 const page=rows.slice(0,filters.count);
 return {
  events:page.map(event=>{
  const user=users.get(event.actorId);
   const rawChanges=Array.isArray(event.details?.changes)?event.details.changes:[];
   const changes=rawChanges.map(change=>{
    if(!change||typeof change!=='object'||typeof change.id!=='string'||typeof change.collection!=='string')return null;
    return {collection:change.collection,id:change.id,...businessName(change,rawChanges,businessState)};
   }).filter(Boolean);
   const resultCount=Number.isSafeInteger(event.details?.resultCount)&&event.details.resultCount>=0?event.details.resultCount:undefined;
   const targetId=typeof event.targetId==='string'?event.targetId:undefined;
   const targetName=targetId?safeName(users.get(targetId)?.name):undefined;
   const needsAttention=attentionEvent(event);
   return {id:event.id,at:event.at,actorId:event.actorId??null,actorName:event.actorName||user?.name||null,...(targetId?{targetId,...(targetName?{targetName}:{})}:{}),action:event.action,outcome:event.outcome,outcomeLabel:outcomeLabel(event.outcome),category:category(event),attention:needsAttention,requestId:event.requestId,summary:{...(rawChanges.length?{changes}:{}),...(resultCount!==undefined?{resultCount}:{})}};
  }),
  hasMore:rows.length>filters.count,
  nextBefore:rows.length>filters.count?page.at(-1)?.id||null:null,
 };
}

module.exports={AuditQueryError,parseAuditQuery,selectAuditPage};
