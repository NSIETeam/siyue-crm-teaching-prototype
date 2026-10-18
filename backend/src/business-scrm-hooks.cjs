'use strict';
// Extend existing acquisitions without converting historic leads into sales needs.
function attachAcquisitionOperations(operations){return operations.map(operation=>{
 if(!['lead.create','lead.import','form.submission.review','form.submit'].includes(operation.id))return operation;
 return {...operation,run(state,input,ctx){
  const result=operation.run(state,input,ctx),core=require('./business-scrm-core.cjs').helpers;
  if(operation.id==='form.submit'){const submission=(state.forms.find(form=>form.id===input.formId)?.submissions||[]).find(row=>row.id===(result.submissionId||result.record?.id));if(submission&&ctx.sourcePromotion&&!submission.acquisitionSnapshot)submission.acquisitionSnapshot=structuredClone(ctx.sourcePromotion);return result;}if(operation.id==='form.submission.review'){
   if(result.record?.status==='approved'&&result.leadId){const lead=state.leads.find(l=>l.id===result.leadId),campaigns=(state.campaigns||[]).filter(c=>c.status==='published'&&c.formIds?.includes(input.formId));
    const provenance=result.record?.acquisitionSnapshot,sourceCampaign=provenance&&(state.campaigns||[]).find(c=>c.id===provenance.campaignId);if(lead){const acquired=core.attachLeadTouch(state,lead,{formId:input.formId,submissionId:input.submissionId,source:state.forms.find(f=>f.id===input.formId)?.settings?.source||lead.source,kind:'form',campaignId:provenance?(sourceCampaign?.status==='published'?provenance.campaignId:undefined):campaigns.length===1?campaigns[0].id:undefined},ctx);if(provenance)Object.assign(acquired.touchpoint,{campaignId:provenance.campaignId,campaignName:provenance.campaignName,promotionLinkId:provenance.linkId,promoterId:provenance.promoterId,promoterName:provenance.promoterName,acquisitionSnapshot:structuredClone(provenance)});}
   }
  }else for(const lead of result.records||[result.record])if(lead)core.attachLeadTouch(state,lead,{source:lead.source,kind:operation.id==='lead.import'?'import':'lead'},ctx);
  return result;
 }};
});}
module.exports={attachAcquisitionOperations};
