(function(){
 'use strict';
 const auth=()=>window.employeeAuth, apiBase='v1/admin/ui-annotations';
 if(!window.SIYUE_AUTH_API||!auth())return;
 const selector='#view :is(button,a,input,select,textarea,th,td,tr,[role="tab"],label,summary,h1,h2,h3,h4,p,legend,.notice,.empty,.card,.stat-card,.kpi-card),.sidebar :is(button,a,[role="tab"]),.topbar :is(button,a,input,select,[role="tab"],#crumb),#workspace-tabs :is(button,[role="tab"])';
 const safe=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let target=null, selectedTarget=null, annotations=[], loading=false;
 const labelOf=el=>{
  if(!el)return {tag:'element',type:'other',label:'界面元素'};
  const tag=el.tagName.toLowerCase(), type=el.matches('.menu-item,.nav-toggle')?'navigation':el.matches('[role="tab"]')?'tab':tag==='button'?'button':tag==='a'?'link':tag==='input'?'input':tag==='select'?'select':tag==='textarea'?'textarea':tag==='th'?'table-header':tag==='td'?'table-cell':tag==='tr'?'table-row':el.matches('label')?'label':el.matches('.card,.stat-card,.kpi-card')?'card':/^H[1-6]$/.test(el.tagName)?'heading':'other';
  let label='';
  if(['TD','TH'].includes(el.tagName)){const table=el.closest('table'),idx=[...el.parentElement.cells].indexOf(el);label=table?.rows[0]?.cells[idx]?.textContent?.trim()||'';}
  if(!label&&['INPUT','SELECT','TEXTAREA'].includes(el.tagName))label=el.getAttribute('placeholder')||'';
  if(!label&&el.tagName==='LABEL')label='表单标签';
  if(!label)label=({navigation:'导航项',tab:'页签',button:'按钮',link:'链接',input:'输入框',select:'下拉选项',textarea:'文本输入框', 'table-header':'表格标题','table-cell':'表格单元格','table-row':'表格行',card:'内容卡片',heading:'页面标题'})[type]||({P:'说明文字',SUMMARY:'可展开区域',LEGEND:'分组标题'})[el.tagName]||'界面元素';
  return {tag,type,label:label.slice(0,120)};
 };
 const locator=el=>{
  const bits=[el.tagName.toLowerCase()];
  for(const attr of ['id','data-page','data-action','data-entity-kind','name','type']){const value=el.getAttribute(attr);if(value){bits.push(`[${attr}="${value.slice(0,100).replace(/["\\]/g,'')}\"]`);break}}
  if(el.closest('table')){const row=[...el.closest('tr')?.parentElement?.children||[]].indexOf(el.closest('tr'));const col=[...el.parentElement?.children||[]].indexOf(el);bits.push(`row:${Math.max(0,row)},column:${Math.max(0,col)}`)}
  return bits.join('');
 };
 const pageContext=()=>({page:location.pathname+location.hash,pageTitle:document.querySelector('#crumb')?.textContent?.trim()||document.title});
 function position(){
  const button=document.getElementById('ui-annotation-pencil');
  if(!button||!target?.isConnected)return button?.classList.remove('is-visible');
  const tab=target.closest?.('.work-tab-item'),r=(tab||target).getBoundingClientRect();
  let left=r.right-(tab?64:26),top=r.top+4;
  // Keep the annotation control outside small interactive targets so hover cannot
  // intercept the click intended for logout, navigation, or a form control.
  if(!tab&&target.matches('button,a,input,select,textarea,summary,[role="tab"]')){
   left=r.right-30;
   if(r.top>=36)top=r.top-30;
   else if(r.bottom+30<=innerHeight-6)top=r.bottom;
   else if(r.right+30<=innerWidth-6){left=r.right;top=r.top;}
   else if(r.left>=36){left=r.left-30;top=r.top;}
   else {button.classList.remove('is-visible');return;}
  }
  button.style.left=`${Math.max(6,Math.min(innerWidth-36,left))}px`;
  button.style.top=`${Math.max(6,Math.min(innerHeight-36,top))}px`;
  button.classList.add('is-visible');
 }
 function clearSelection(){selectedTarget=null;const frame=document.getElementById('ui-annotation-selection');if(!frame)return;if(frame.hidePopover&&frame.matches(':popover-open'))frame.hidePopover();frame.hidden=true;}
 function positionSelection(){const frame=document.getElementById('ui-annotation-selection');if(!frame||!selectedTarget)return;if(!selectedTarget.isConnected){clearSelection();return}const r=selectedTarget.getBoundingClientRect(),left=Math.max(0,r.left),top=Math.max(0,r.top),right=Math.min(innerWidth,r.right),bottom=Math.min(innerHeight,r.bottom);frame.hidden=right<=left||bottom<=top;Object.assign(frame.style,{left:`${left}px`,top:`${top}px`,width:`${Math.max(0,right-left)}px`,height:`${Math.max(0,bottom-top)}px`});}
 function selectRegion(el){clearSelection();selectedTarget=el;const frame=document.getElementById('ui-annotation-selection');positionSelection();if(!frame.hidden&&frame.showPopover)frame.showPopover();}
 function shell(){if(document.getElementById('ui-annotation-dialog'))return;document.body.insertAdjacentHTML('beforeend',`<div id="ui-annotation-selection" popover="manual" aria-hidden="true" hidden></div><button type="button" id="ui-annotation-pencil" aria-label="标注此处问题" title="标注此处问题"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 5 5 5M4 20l4.2-.8L19 8.4a2.1 2.1 0 0 0-3-3L5.2 16.2 4 20Z"/></svg></button><button type="button" id="ui-annotation-desk">待修改清单</button><dialog id="ui-annotation-dialog"><header class="uia-head"><h2 id="uia-title">标注界面问题</h2><button type="button" class="uia-close" aria-label="关闭">×</button></header><div class="uia-body" id="uia-body"></div></dialog>`);
  const headerUser=document.querySelector('.topbar .user');
  if(headerUser)headerUser.prepend(document.getElementById('ui-annotation-desk'));
  document.getElementById('ui-annotation-dialog').addEventListener('close',clearSelection);
  document.getElementById('ui-annotation-pencil').addEventListener('click',openComposer);
  document.getElementById('ui-annotation-desk').addEventListener('click',openDesk);
  document.querySelector('#ui-annotation-dialog .uia-close').addEventListener('click',()=>document.querySelector('#ui-annotation-dialog').close());
 }
 function visible(){const yes=!!auth()?.isSuperadmin?.();document.getElementById('ui-annotation-desk')?.toggleAttribute('hidden',!yes);if(!yes){document.getElementById('ui-annotation-pencil')?.classList.remove('is-visible');target=null;clearSelection()}return yes}
 function openComposer(){
  if(!visible()||!target)return;
  const el=target,meta=labelOf(el),ctx=pageContext();
  document.getElementById('uia-title').textContent='提交修改建议';
  document.getElementById('uia-body').innerHTML=`<div class="uia-context"><strong>${safe(ctx.pageTitle)}</strong><br>元素：${safe(meta.label)}<br>类型：${safe(meta.type)}<br>定位：${safe(locator(el))}</div>
   <label class="uia-field" for="uia-category">建议类型</label><select id="uia-category" class="uia-input"><option value="interface">界面元素</option><option value="workflow">业务流程图</option></select>
   <div id="uia-workflow-fields" hidden>
    <label class="uia-field" for="uia-workflow-name">流程名称</label><input id="uia-workflow-name" class="uia-input" maxlength="120" placeholder="例如：线索分配与跟进">
    <label class="uia-field" for="uia-flow-definition">现有业务流程图</label><textarea id="uia-flow-definition" class="uia-textarea uia-flow-definition" maxlength="6000" placeholder="开始 -> 登记线索&#10;登记线索 -重复客户-> 合并档案&#10;登记线索 -新客户-> 分配顾问&#10;分配顾问 -已联系-> 持续跟进&#10;分配顾问 -未联系-> 待首联"></textarea><div class="uia-flow-editor-preview" data-uia-current-preview></div>
    <label class="uia-field" for="uia-desired-flow">希望调整后的流程图</label><textarea id="uia-desired-flow" class="uia-textarea uia-flow-definition" maxlength="6000" placeholder="开始 -> 登记线索&#10;登记线索 -> 去重校验&#10;去重校验 -已存在-> 合并档案&#10;去重校验 -新客户-> 分配顾问"></textarea><div class="uia-flow-editor-preview" data-uia-desired-preview></div>
    <small class="uia-hint">每行一条连线：起始节点 -条件-> 目标节点；无条件连线可写“节点A -> 节点B”。</small>
   </div>
   <label class="uia-field" for="uia-issue">问题描述 / 修改目标</label><textarea id="uia-issue" class="uia-textarea" maxlength="4000" placeholder="说明具体问题；流程建议请描述业务规则和希望调整的原因" required></textarea><p class="uia-status" role="status"></p><div class="uia-actions"><button type="button" class="btn" data-uia-cancel>取消</button><button type="button" class="btn primary" data-uia-save>加入待修改清单</button></div>`;
  const dialog=document.getElementById('ui-annotation-dialog'),category=document.getElementById('uia-category'),workflowFields=document.getElementById('uia-workflow-fields');
  selectRegion(el);
  dialog.showModal();
  document.getElementById('uia-flow-definition').oninput=event=>document.querySelector('[data-uia-current-preview]').innerHTML=flowMarkup(event.target.value);
  document.getElementById('uia-desired-flow').oninput=event=>document.querySelector('[data-uia-desired-preview]').innerHTML=flowMarkup(event.target.value);
  category.onchange=()=>{workflowFields.hidden=category.value!=='workflow';document.getElementById('uia-issue').placeholder=category.value==='workflow'?'描述业务规则、存在的问题和流程修改原因':'描述这里的问题或希望如何调整'};
  document.querySelector('[data-uia-cancel]').onclick=()=>dialog.close();
  document.querySelector('[data-uia-save]').onclick=async()=>{
   const issue=document.getElementById('uia-issue').value.trim(),status=document.querySelector('.uia-status'),workflowName=document.getElementById('uia-workflow-name').value.trim(),flowDefinition=document.getElementById('uia-flow-definition').value.trim(),desiredFlowDefinition=document.getElementById('uia-desired-flow').value.trim();
   if(!issue){status.textContent='请填写问题描述或修改目标。';return}
   if(category.value==='workflow'&&(!workflowName||!flowDefinition||!desiredFlowDefinition)){status.textContent='请填写流程名称、现有流程图和希望调整后的流程图。';return}
   const button=document.querySelector('[data-uia-save]');button.disabled=true;status.textContent='正在提交…';
   try{const result=await auth().request(apiBase,{method:'POST',body:{...ctx,elementKind:meta.type,elementLabel:meta.label,selector:locator(el),issue,category:category.value,workflowName,flowDefinition,desiredFlowDefinition}});annotations.unshift(result.annotation);status.textContent='已加入平台待修改清单。';setTimeout(()=>{if(dialog.open)dialog.close()},650)}catch(error){status.textContent=error.message||'提交失败，请重试。';button.disabled=false}
  };
 }
 async function openDesk(){if(!visible())return;clearSelection();const dialog=document.getElementById('ui-annotation-dialog'),body=document.getElementById('uia-body');document.getElementById('uia-title').textContent='待修改清单';dialog.showModal();body.innerHTML='<p class="uia-status">正在加载待修改清单…</p>';if(loading)return;loading=true;try{const result=await auth().request(apiBase);annotations=result.annotations||[];drawDesk()}catch(error){body.innerHTML=`<p class="uia-status">${safe(error.message||'加载失败')}</p>`}finally{loading=false}}
 const taskText=item=>item.category==='workflow'?`根据“${item.workflowName}”流程建议，检查并修改对应业务实现与流程图。现有流程：\n${item.flowDefinition}\n目标流程：\n${item.desiredFlowDefinition}\n变更说明：${item.issue}`:`修复 ${item.pageTitle}（${item.page}）中的“${item.elementLabel}”（${item.elementKind}，定位：${item.selector}）：${item.issue}`;
 const flowMarkup=value=>{try{const g=JSON.parse(value);if(g.schema==='siyue.workflow/v1'&&Array.isArray(g.nodes)&&Array.isArray(g.edges)){const name=id=>g.nodes.find(n=>n.id===id)?.label||id;return '<div class="uia-flow-raw">'+g.nodes.map(n=>safe(n.label)+' · '+safe(n.role||'按业务权限')+' · '+safe(n.rule||'')).join('<br>')+'</div>'+g.edges.map(e=>'<div class="uia-flow-edge"><span class="uia-flow-node">'+safe(name(e.from))+'</span><span class="uia-flow-arrow">'+safe(e.condition||'')+' →</span><span class="uia-flow-node">'+safe(name(e.to))+'</span></div>').join('')}}catch{}const lines=String(value||'').split(/\r?\n/).map(line=>line.trim()).filter(Boolean);return lines.map(line=>{let match=line.match(/^(.+?)\s+-([^>]+)->\s*(.+)$/),from,condition,to;if(match){[,from,condition,to]=match}else{match=line.match(/^(.+?)\s*->\s*(.+)$/);if(match){[,from,to]=match}else return `<div class=\"uia-flow-raw\">${safe(line)}</div>`}return `<div class=\"uia-flow-edge\"><span class=\"uia-flow-node\">${safe(from.trim())}</span><span class=\"uia-flow-arrow\">${condition?`<small>${safe(condition.trim())}</small>`:''} →</span><span class=\"uia-flow-node\">${safe(to.trim())}</span></div>`}).join('')||'<span class=\"uia-hint\">流程图预览</span>'};
 async function copyQueue(){const pending=annotations.filter(item=>item.status==='open');const payload=JSON.stringify({workflow:'siyue-ui-annotation-queue/v1',instruction:'逐条读取待修改项并直接落实。界面项修改界面实现；workflow 项同时修改业务实现和对应流程图/规格，并检查权限、状态转换与审计。完成并验证后才将状态更新为 resolved；不要仅因读取而关闭。',items:pending.map(item=>({id:item.id,status:item.status,pageTitle:item.pageTitle,page:item.page,elementKind:item.elementKind,elementLabel:item.elementLabel,selector:item.selector,issue:item.issue,workflowName:item.workflowName||'',flowDefinition:item.flowDefinition||'',desiredFlowDefinition:item.desiredFlowDefinition||'',task:taskText(item),createdAt:item.createdAt}))},null,2);try{await navigator.clipboard.writeText(payload);const status=document.querySelector('[data-uia-copy-status]');if(status)status.textContent=`已复制 ${pending.length} 条待修改项（JSON）`}catch{const status=document.querySelector('[data-uia-copy-status]');if(status)status.textContent='无法访问剪贴板；请使用管理员会话调用待修改清单 API。'}}
 function drawDesk(){const body=document.getElementById('uia-body'),pending=annotations.filter(item=>item.status==='open'),done=annotations.filter(item=>item.status==='resolved');body.innerHTML=`<p class="uia-status">待修改 ${pending.length} 条 · 已完成 ${done.length} 条。下一位 agent 可读取结构化清单并按条修复；读取不会自动关闭条目。</p><div class="uia-actions uia-queue-actions"><button type="button" class="btn" data-uia-reload>刷新</button><button type="button" class="btn primary" data-uia-copy ${pending.length?'':'disabled'}>复制待修改清单（JSON）</button></div><p class="uia-status" data-uia-copy-status role="status"></p><div class="uia-list">${annotations.length?annotations.map(item=>`<article class="uia-item"><div class="uia-item-head"><strong>${safe(item.category==='workflow'?'流程图：'+(item.workflowName||item.pageTitle):item.pageTitle+' · '+item.elementLabel)}</strong><small class="${item.status==='resolved'?'uia-resolved':''}">${item.status==='resolved'?'已完成':'待修改'}</small></div><small>${safe(item.category==='workflow'?'业务流程图 · 流程定义需同步更新':item.page+' · '+item.elementKind+' · 定位：'+item.selector)} · ${new Date(item.createdAt).toLocaleString()}</small>${item.category==='workflow'?`<div class=\"uia-flow-preview\"><strong>现有流程图</strong>${flowMarkup(item.flowDefinition)}<strong>目标流程图</strong>${flowMarkup(item.desiredFlowDefinition)}</div>`:''}<p><strong>执行项：</strong>${safe(taskText(item))}</p><p><strong>${item.category==='workflow'?'变更目标':'问题描述'}：</strong>${safe(item.issue)}</p><small>标注人：${safe(item.createdByName)}</small>${item.status==='open'?`<div class="uia-actions"><button type="button" class="btn small" data-uia-resolve="${safe(item.id)}">标记已完成</button></div>`:''}</article>`).join(''):'<p class="uia-status">暂无待修改项。</p>'}</div>`;body.querySelector('[data-uia-reload]').onclick=openDesk;body.querySelector('[data-uia-copy]').onclick=copyQueue;body.querySelectorAll('[data-uia-resolve]').forEach(button=>button.onclick=async()=>{button.disabled=true;try{const result=await auth().request(`${apiBase}/${encodeURIComponent(button.dataset.uiaResolve)}`,{method:'PATCH',body:{status:'resolved'}});annotations=annotations.map(item=>item.id===result.annotation.id?result.annotation:item);drawDesk()}catch(error){button.disabled=false;alert(error.message||'更新失败')}})}
 function sync(){if(!auth()?.isSuperadmin?.()){visible();return}shell();visible();positionSelection()}
 document.addEventListener('pointerover',event=>{if(!visible())return;const el=event.target.closest?.(selector);if(!el||el.closest('#ui-annotation-dialog,#ui-annotation-pencil,#ui-annotation-desk'))return;target=el;position()});
 document.addEventListener('pointerout',event=>{if(!target)return;if(event.relatedTarget===document.getElementById('ui-annotation-pencil')||event.relatedTarget?.closest?.('#ui-annotation-pencil'))return;if(!target.contains(event.relatedTarget)){target=null;document.getElementById('ui-annotation-pencil')?.classList.remove('is-visible')}});
 document.addEventListener('scroll',()=>{position();positionSelection()},true);window.addEventListener('resize',()=>{position();positionSelection()});
 const observer=new MutationObserver(sync);observer.observe(document.documentElement,{childList:true,subtree:true});
 window.addEventListener('siyue-auth-changed',sync);sync();
})();
