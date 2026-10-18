/* Student adapter for the same follow-up workspace used by leads. */
(function(root){
 'use strict';
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const channels={phone:'电话',wecom:'企业微信',text:'文字记录'};
 let generation=0,cache={key:'',records:null,error:'',loading:false},activeTab='followup',binding=null;
 const actor=()=>root.employeeAuth?.current?.();
 const account=()=>{const a=actor();return a?JSON.stringify([a.id,a.version,a.scope,a.roleIds,a.permissions]):'';};
 const permitted=p=>root.employeeAuth?.has?.(p)??!!actor()?.permissions?.includes(p);
 const current=()=>root.businessAPI?.academicDraft?.();
 const isStudent=ctx=>ctx?.operation?.id==='student.communicate';
 const key=ctx=>JSON.stringify([account(),ctx.draft.studentId,ctx.draft.classId]);
 const by=(ctx,kind,id)=>(ctx.data?.[kind]||[]).find(row=>row.id===id);
 function classes(ctx,studentId=ctx.draft.studentId){
  const a=actor(),restricted=a?.scope?.type==='assigned'||a?.roleIds?.includes('teacher')&&!a.roleIds.some(role=>['superadmin','principal','academic'].includes(role));
  return (ctx.data?.classes||[]).filter(c=>c.active!==false&&!['ended','cancelled','canceled','inactive','已结束','已取消','已关闭'].includes(c.status)&&(ctx.data?.enrollments||[]).some(e=>e.studentId===studentId&&e.classId===c.id&&e.status==='active')&&(!restricted||c.teacherId===a.id||(c.schedule||[]).some(s=>(s.substituteTeacherId||s.teacherId)===a.id))&&(a?.scope?.type!=='campus'||(a.scope.campusIds||[]).includes(c.campusId)));
 }
 function reset(){generation++;cache={key:'',records:null,error:'',loading:false};activeTab='followup';binding?.();binding=null;}
 function allowed(ctx){return isStudent(ctx)&&permitted('student.communicate')&&classes(ctx).some(c=>c.id===ctx.draft.classId);}
 function ensureHistory(ctx){
  if(!allowed(ctx)||!permitted('student.read')){if(cache.key)reset();return;}
  const requestKey=key(ctx);if(cache.key===requestKey)return;
  cache={key:requestKey,records:null,error:'',loading:true};const seq=++generation;
  const valid=()=>{const now=current();return seq===generation&&allowed(now)&&permitted('student.read')&&key(now)===requestKey;};
  Promise.resolve().then(()=>valid()?root.employeeAuth.request('v1/students/communications?'+new URLSearchParams({studentId:ctx.draft.studentId,classId:ctx.draft.classId})):null).then(response=>{
   if(!valid()){if(seq===generation)cache={key:'',records:null,error:'',loading:false};return;}
   if(!response||!Array.isArray(response.records)||response.total!==response.records.length||response.records.some(r=>r.studentId!==ctx.draft.studentId||r.classId!==ctx.draft.classId||typeof r.note!=='string'||!Object.hasOwn(channels,r.channel)||!Number.isFinite(Date.parse(r.createdAt))||r.nextFollowAt&&!Number.isFinite(Date.parse(r.nextFollowAt))))throw Error('沟通记录回执不完整，请重新读取。');
   cache.records=response.records;cache.loading=false;root.businessAPI.redraw();
  }).catch(error=>{if(valid()){cache.error=error.message||'沟通历史读取失败';cache.loading=false;root.businessAPI.redraw();}else if(seq===generation)cache={key:'',records:null,error:'',loading:false};});
 }
 function retry(){if(!allowed(current())||current().disabled)return false;generation++;cache={key:'',records:null,error:'',loading:false};root.businessAPI.redraw();return true;}
 function refresh(){const ctx=current();if(!isStudent(ctx)||ctx.disabled||!permitted('student.communicate'))return false;reset();return root.businessAPI.reloadOptions();}
 function chooseStudent(id){
  const ctx=current();if(!isStudent(ctx)||ctx.disabled||!permitted('student.communicate'))return false;
  const student=by(ctx,'students',id),available=classes(ctx,id);if(!student||!available.length)return false;
  // A different student must never inherit the previous student's unsaved communication.
  if(id===ctx.draft.studentId)return true;reset();
  return root.businessAPI.academicSet([],{studentId:id,classId:available[0].id,channel:'text',note:'',...(student.version?{expectedVersion:student.version}:{})});
 }
 function chooseClass(id){const ctx=current();if(!allowed(ctx)||ctx.disabled||!classes(ctx).some(c=>c.id===id))return false;if(id===ctx.draft.classId)return true;reset();return root.businessAPI.academicSet([],{studentId:ctx.draft.studentId,classId:id,channel:'text',note:'',...(ctx.draft.expectedVersion?{expectedVersion:ctx.draft.expectedVersion}:{})});}
 function dateText(value){return value&&Number.isFinite(Date.parse(value))?new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}):'未安排';}
 function localDateTime(value){if(!value||!Number.isFinite(Date.parse(value)))return '';const d=new Date(value),pad=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;}
 function timeline(ctx){
  if(!permitted('student.read'))return '<p class="notice">当前账号没有读取学生沟通历史的权限。</p>';
  if(!allowed(ctx))return '<p class="help">请选择当前授权范围内的在读学生及班级。</p>';
  if(cache.loading)return '<p role="status">正在读取沟通历史…</p>';
  if(cache.error)return `<p role="alert" class="business-error">${esc(cache.error)}</p><button type="button" class="btn" onclick="SiyueStudentCommunication.retry()">重新读取记录</button>`;
  if(!cache.records?.length)return '<p class="help">暂无历史沟通记录。</p>';
  return `<ol class="student-communication-timeline">${cache.records.map(r=>`<li><header><strong>${esc(channels[r.channel])}</strong><span>${esc(r.actorName||'员工')}</span><time>${esc(dateText(r.createdAt))}</time></header><p>${esc(r.note)}</p><small>下次回访：${esc(dateText(r.nextFollowAt))}</small></li>`).join('')}</ol>`;
 }
 function render(ctx,state={}){
  if(!isStudent(ctx))return null;
  if(!permitted('student.communicate')){reset();return '<section class="card pad"><p role="alert">当前账号没有学生沟通权限，请返回学生名单。</p><button class="btn" onclick="businessAPI.back()">返回学生名单</button></section>';}
  ensureHistory(ctx);
  const d=ctx.draft,student=by(ctx,'students',d.studentId),available=classes(ctx),klass=available.find(c=>c.id===d.classId),valid=!!klass,off=ctx.disabled||state.busy||state.uncertain,dis=off?'disabled':'',records=cache.key===key(ctx)?cache.records:null;
  if(state.hasPreview||state.error)activeTab='followup';
  const studentOptions=(ctx.data?.students||[]).filter(s=>classes(ctx,s.id).length);
  const fields=`<div class="student-communication-fields"><label>沟通学生<select class="select" aria-label="沟通学生" ${dis} onchange="SiyueStudentCommunication.chooseStudent(this.value)"><option value="">请选择在读学生</option>${studentOptions.map(s=>`<option value="${esc(s.id)}" ${s.id===d.studentId?'selected':''}>${esc(s.name)}</option>`).join('')}</select></label><label>所属班级<select class="select" aria-label="沟通所属班级" ${dis} onchange="SiyueStudentCommunication.chooseClass(this.value)"><option value="">请选择班级</option>${available.map(c=>`<option value="${esc(c.id)}" ${c.id===d.classId?'selected':''}>${esc(c.name)}</option>`).join('')}</select></label><label>沟通方式<span class="required-mark">*</span><select class="select" aria-label="沟通方式" data-business-path="[&quot;channel&quot;]" data-business-type="string" required ${dis} onchange="businessAPI.input(['channel'],this.value,'string')">${Object.entries(channels).map(([id,name])=>`<option value="${id}" ${(d.channel||'text')===id?'selected':''}>${name}</option>`).join('')}</select></label><label>下次回访时间<input class="input" type="datetime-local" aria-label="下次回访时间" data-business-path="[&quot;nextFollowAt&quot;]" data-business-type="datetime" value="${esc(localDateTime(d.nextFollowAt))}" ${dis} oninput="businessAPI.input(['nextFollowAt'],this.value,'datetime')"><small>按本机时间填写，可留空；保存本次回访安排，不自动发送通知。</small></label><label class="student-communication-note">本次沟通内容<span class="required-mark">*</span><textarea class="input" rows="7" maxlength="5000" aria-label="本次沟通内容" data-business-path="[&quot;note&quot;]" data-business-type="string" required ${dis} oninput="businessAPI.input(['note'],this.value,'string')" placeholder="记录学习情况、沟通结果与下一步安排">${esc(d.note)}</textarea></label></div>`;
  const form=`<form id="business-form" class="business-form" onsubmit="event.preventDefault();businessAPI.preview()">${fields}${!valid?'<p class="notice">请选择当前授权范围内的在读学生及班级。</p>':''}<p class="business-error" role="alert">${esc(state.error)}</p><div id="business-preview">${state.hasPreview?`<section class="business-preview"><h3>确认沟通内容</h3>${state.previewHtml||''}</section>`:''}</div><p id="business-preview-hint" class="help">${state.hasPreview?'请核对内容，再确认保存。':'请先检查并预览，核对后保存沟通。'}</p></form>`;
  const footer=`<div class="form-actions business-submit-actions"><button type="button" class="btn" ${dis} onclick="businessAPI.back()">返回学生名单</button><button type="submit" form="business-form" class="btn" ${off||!valid?'disabled':''}>${state.busy?'正在处理…':'检查并预览'}</button><button type="button" id="business-confirm" class="btn primary" ${!state.hasPreview||state.busy||!valid?'disabled':''} onclick="businessAPI.execute()">${state.uncertain?'重试确认提交结果':'保存沟通与回访安排'}</button><button type="button" class="btn" ${dis} onclick="SiyueStudentCommunication.refresh()">刷新业务数据</button></div>`;
  const facts=valid?[['学生姓名',student?.name],['联系电话',student?.phone],['年级',student?.grade],['所属班级',klass.name],['课程',by(ctx,'courses',klass.courseId)?.name],['校区',by(ctx,'campuses',klass.campusId)?.name]]:[];
  const profile=`<dl class="student-communication-profile">${facts.map(([label,value])=>`<div><dt>${esc(label)}</dt><dd>${esc(value||'—')}</dd></div>`).join('')}</dl>`;
  const layout=root.SiyueCrmFollowup?.render?.({eyebrow:'学生沟通',actionsLabel:'学生操作',title:valid?student?.name||'学生沟通':'学生沟通',recordId:valid?student?.id:'',status:valid?'在读':'请选择学生',summary:[{label:'联系电话',value:valid?student?.phone:''},{label:'所属班级',value:klass?.name},{label:'最近回访安排',value:records?.length?dateText(records[0].nextFollowAt):'未安排'}],notice:'电话、企业微信、文字均用于记录沟通事实。保存后返回原学生名单；切换学生或班级会清空未保存内容。',tabs:[{id:'followup',label:'记录沟通',html:form},{id:'history',label:'沟通与回访记录',html:timeline(ctx)},{id:'profile',label:'学生资料',html:profile}],activeTab,footerHtml:footer});
  return `<section class="student-communication-workspace">${layout||'<p role="alert">沟通工作区组件未加载，请刷新页面。</p>'}</section>`;
 }
 function bind(container){binding?.();binding=null;if(!isStudent(current()))return;binding=root.SiyueCrmFollowup?.bind?.(container,id=>{activeTab=id;});}
 root.SiyueStudentCommunication=Object.freeze({render,bind,reset,retry,refresh,chooseStudent,chooseClass});
 root.employeeAuth?.subscribe?.(()=>reset());
})(globalThis);
