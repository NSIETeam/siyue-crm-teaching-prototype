'use strict';
const {assert}=require('./business-common.cjs');
const text={type:'string',minLength:1,maxLength:120};
const operations=[{
 id:'crm.view.save',label:'保存我的 CRM 筛选视图',permission:'lead.read',group:'crm',
 inputSchema:{type:'object',properties:{viewId:text,name:text,query:{type:'object'},expectedVersion:{type:'integer',minimum:1}},required:['name','query'],additionalProperties:false},
 run(state,input,ctx){
  ctx.require('lead.read');const normalized=require('./business-scrm-query.cjs').filters(input.query,ctx.actor);
  const name=input.name.normalize('NFKC').trim();assert(name&&name.length<=120,'视图名称无效');state.savedCrmViews||=[];
  let row=input.viewId&&state.savedCrmViews.find(row=>row.id===input.viewId&&row.ownerId===ctx.actor.id);assert(!input.viewId||row,'视图不存在','NOT_FOUND',404);
  if(row){assert(input.expectedVersion===row.version,'视图已更新，请重新读取','VERSION_CONFLICT',409);row.version++;}
  else{assert(state.savedCrmViews.filter(row=>row.ownerId===ctx.actor.id&&row.status!=='archived').length<30,'最多保存30个视图');row={id:ctx.id('VIEW'),ownerId:ctx.actor.id,createdBy:ctx.actor.id,createdAt:ctx.now,version:1};state.savedCrmViews.push(row);}
  const {page,pageSize,...query}=normalized;for(const key of Object.keys(query))if(query[key]===null||query[key]==='')delete query[key];Object.assign(row,{name,query,status:'active',updatedAt:ctx.now});return {record:row};
 }
},{
 id:'crm.view.archive',label:'归档我的 CRM 筛选视图',permission:'lead.read',group:'crm',
 inputSchema:{type:'object',properties:{viewId:text,expectedVersion:{type:'integer',minimum:1}},required:['viewId','expectedVersion'],additionalProperties:false},
 run(state,input,ctx){ctx.require('lead.read');const row=(state.savedCrmViews||[]).find(row=>row.id===input.viewId&&row.ownerId===ctx.actor.id);assert(row,'视图不存在','NOT_FOUND',404);assert(row.version===input.expectedVersion,'视图已更新','VERSION_CONFLICT',409);Object.assign(row,{status:'archived',version:row.version+1,updatedAt:ctx.now});return {record:row};}
}];
module.exports={operations};
