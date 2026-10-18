'use strict';
const {assert,canAccess}=require('./business-common.cjs');
const allowed=(actor,p)=>actor.permissions?.includes(p);
function list(snapshot,actor,directory,input,projection,now=Date.now()){
 const params=input instanceof URLSearchParams?Object.fromEntries(input):{...input};
 if(input instanceof URLSearchParams)for(const key of input.keys())assert(input.getAll(key).length===1,'查询条件不能重复','INVALID_QUERY',400);
 assert(Object.keys(params).every(k=>['campusId','search','page','pageSize'].includes(k)),'不支持此查询条件','INVALID_QUERY',400);
 for(const key of ['campusId','search'])if(params[key]!==undefined)assert(typeof params[key]==='string'&&params[key].length<=120&&!/[\u0000-\u001f]/.test(params[key]),'查询条件无效','INVALID_QUERY',400);
 assert(['lead.create','lead.assign','lead.transfer'].some(p=>allowed(actor,p)),'没有线索登记或分配权限','FORBIDDEN',403);
 const page=Number(params.page||1),pageSize=Number(params.pageSize||50);assert(Number.isSafeInteger(page)&&page>=1&&page<=1000000&&Number.isSafeInteger(pageSize)&&pageSize>=1&&pageSize<=200,'分页无效','INVALID_QUERY',400);
 const state=snapshot.state,campusId=params.campusId||null,campus=campusId&&(state.campuses||[]).find(c=>c.id===campusId);
 if(campusId)assert(campus&&campus.active!==false&&canAccess(state,actor,campus,'campuses',{access:'read'}),'校区不可用或超出授权范围','FORBIDDEN',403);
 const visible=new Set((projection.leadOwnerOptions||[]).map(r=>r.id));if(allowed(actor,'lead.follow'))visible.add(actor.id);
 const eligible=directory.filter(p=>visible.has(p.id)&&!p.disabled&&!p.mustChangePassword&&p.permissions?.includes('lead.follow')&&p.scope?.type!=='assigned'&&(!campusId||p.scope?.type!=='campus'||p.scope.campusIds?.includes(campusId)));
 const metrics=new Map(eligible.map(p=>[p.id,{receivedMinor:0,refundedMinor:0,netReceivedMinor:0,activeLeadCount:0}])),start=now-30*86400000,orders=new Map((state.orders||[]).map(o=>[o.id,o])),adjustments=new Map((state.attributionAdjustments||[]).map(a=>[a.orderId,a.after])),converted=new Set((state.orders||[]).filter(o=>o.conversionSnapshot?.leadId).map(o=>o.conversionSnapshot.leadId));
 const inRange=value=>{const t=Date.parse(value);return Number.isFinite(t)&&t>=start&&t<=now};
 if(campusId){
  const add=(row,refund)=>{if(!inRange(refund?row.submittedAt:row.createdAt)||refund&&row.status!=='submitted'||!refund&&['cancelled','void','reversed'].includes(row.status))return;const order=orders.get(row.orderId),attribution=order&&(adjustments.get(order.id)||order.attributionSnapshot);if(!order||order.campusId!==campusId||!attribution||!metrics.has(attribution.ownerId))return;const amount=Number(row.amountCents);if(!Number.isSafeInteger(amount)||amount<=0)return;metrics.get(attribution.ownerId)[refund?'refundedMinor':'receivedMinor']+=amount;};
  (state.receipts||[]).forEach(r=>add(r,false));(state.refunds||[]).forEach(r=>add(r,true));
  for(const lead of state.leads||[])if(lead.campusId===campusId&&metrics.has(lead.ownerId)&&!converted.has(lead.id||lead.leadId)&&!['cold','archived'].includes(lead.status)&&!['已流失','已归档','冷宫','已报名','已成单'].includes(lead.stage))metrics.get(lead.ownerId).activeLeadCount++;
 }
 for(const m of metrics.values())m.netReceivedMinor=m.receivedMinor-m.refundedMinor;
 const ranked=[...eligible].sort((a,b)=>metrics.get(b.id).netReceivedMinor-metrics.get(a.id).netReceivedMinor||metrics.get(a.id).activeLeadCount-metrics.get(b.id).activeLeadCount||a.name.localeCompare(b.name,'zh-CN')||a.id.localeCompare(b.id)),hasPerformance=[...metrics.values()].some(m=>m.receivedMinor||m.refundedMinor),showMetrics=allowed(actor,'report.read')&&['all','campus'].includes(actor.scope?.type);
 const clean=p=>({id:p.id,name:p.name,employeeNo:p.employeeNo||'',campusIds:p.scope?.type==='campus'?p.scope.campusIds:null}),recommendations=campusId?ranked.filter(p=>p.roleIds?.includes('sales')).slice(0,5).map((p,i)=>({...clean(p),rank:i+1,...(showMetrics?{metrics:metrics.get(p.id)}:{})})):[];
 const search=String(params.search||'').normalize('NFKC').trim().toLocaleLowerCase(),matches=ranked.filter(p=>!search||[p.name,p.employeeNo].some(v=>String(v||'').normalize('NFKC').toLocaleLowerCase().includes(search)));
 return {revision:snapshot.revision,campusId,from:new Date(start).toISOString(),to:new Date(now).toISOString(),basis:!campusId?'selectCampus':hasPerformance?'netReceived30d':'activeLeadCount',basisLabel:!campusId?'选择校区后显示推荐':hasPerformance?'近30天净收款优先，同分按在跟线索较少优先':'近30天暂无有效业绩，按在跟线索较少优先',metricsVisible:showMetrics,recommendations,items:matches.slice((page-1)*pageSize,page*pageSize).map(clean),total:matches.length,page,pageSize};
}
module.exports={list};
