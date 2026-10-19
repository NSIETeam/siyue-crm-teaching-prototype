'use strict';
// Ownership and callback progress are independent. A cancelled callback does not undo a prior start.
const valid=value=>typeof value==='string'&&value.length>0&&Number.isFinite(Date.parse(value));
const resetKinds=new Set(['释放公海','策略回收','恢复']);
function closed(lead){return ['cold','archived'].includes(lead.status)||['已流失','冷宫','已归档'].includes(lead.stage);}
function callbackEvidence(lead){
 if(valid(lead.callbackStartedAt)||valid(lead.nextFollowAt))return true;
 const history=lead.history||[];let reset=-1;
 for(let i=0;i<history.length;i++)if(resetKinds.has(history[i].kind))reset=i;
 return history.slice(reset+1).some(event=>valid(event.detail?.nextFollowAt));
}
function rememberCallback(lead,now){if(!valid(lead.callbackStartedAt)&&callbackEvidence(lead))lead.callbackStartedAt=now;}
function stage(lead){
 if(['已报名','待报名','已流失','冷宫','已归档'].includes(lead.stage))return lead.stage;
 return callbackEvidence(lead)?'跟进中':'新线索';
}
module.exports={closed,callbackEvidence,rememberCallback,stage};
