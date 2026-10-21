/* Explicit preview/import of synthetic CLI output. Never imports automatically. */
const consumptionDemoUI={open:false,payload:null,error:''};
function consumptionDemoAllowed(){return permissionState.identity==='admin'}
function consumptionDemoValidate(input){
 const p=JSON.parse(JSON.stringify(input)),fail=message=>{throw Error(message)};
 if(!p||p.schema!=='siyue.lesson-consumption.simulation'||p.schemaVersion!==1||p.source?.mode!=='simulation'||p.source?.kind!=='siyue-cli'||!/^SIM-[A-Za-z0-9_-]{1,100}$/.test(p.runId))fail('仅支持 siyue-cli 生成的课消演示结果');
 const unsafe=x=>x&&typeof x==='object'&&Object.entries(x).some(([k,v])=>['__proto__','prototype','constructor'].includes(k)||unsafe(v));if(unsafe(p))fail('文件包含无效字段');
 const data=p.academic,keys=['courses','classes','students','attendance','orders','refunds','sessionAdjustments'];
 if(!data||keys.some(k=>!Array.isArray(data[k])||data[k].length>200)||data.refunds.length)fail('演示数据结构或数量不正确');
 const localId=id=>typeof id==='string'&&id.startsWith(p.runId+'-')&&/^[A-Za-z0-9_-]+$/.test(id),ids={};
 for(const key of keys){ids[key]=new Set();for(const row of data[key]){if(!row||!localId(row.id)||ids[key].has(row.id)||row.simulationRunId!==p.runId)fail('演示记录标识不正确');ids[key].add(row.id)}}
 const courseById=new Map(data.courses.map(x=>[x.id,x])),classById=new Map(data.classes.map(x=>[x.id,x])),orderById=new Map(data.orders.map(x=>[x.id,x])),adjustmentById=new Map(data.sessionAdjustments.map(x=>[x.id,x])),lessonIds=new Set();
 for(const c of data.courses){if(!consumptionValidLessons(c.lessons)||c.lessons.length>200||c.lessons.some(l=>!localId(l.id)||lessonIds.has(l.id)))fail('演示讲次标识重复、为空或不正确');c.lessons.forEach(l=>lessonIds.add(l.id))}
 const sessionClass=value=>typeof value==='string'?data.classes.find(c=>workflowSessionKey(c)===value):null;
 // Reject every reference outside the imported namespace, including nested records.
 const refSets={studentId:ids.students,studentIds:ids.students,classId:ids.classes,classIds:ids.classes,sourceClassId:ids.classes,targetClassId:ids.classes,makeupClassId:ids.classes,courseId:ids.courses,orderId:ids.orders,orderIds:ids.orders,sourceOrderId:ids.orders,lessonId:lessonIds,makeupAppointmentId:ids.sessionAdjustments,refundId:ids.refunds,withdrawalId:ids.refunds};
 const checkRefs=obj=>{if(!obj||typeof obj!=='object')return;for(const [key,value] of Object.entries(obj)){if(value==null||value==='')continue;if(key==='simulationRunId'){if(value!==p.runId)fail('演示记录混入其他运行标识')}else if(['sessionId','sourceSessionId','targetSessionId','consumptionSourceSessionId'].includes(key)){if(!sessionClass(value))fail('课次引用不属于本组演示数据')}else if(refSets[key]){const values=Array.isArray(value)?value:[value];if(values.some(id=>!refSets[key].has(id)))fail('关联引用不属于本组演示数据')}else if(/(?:Id|Ids)$/.test(key)){const values=Array.isArray(value)?value:[value];if(values.some(id=>!localId(id)))fail('包含本组演示以外的关联标识')}if(value&&typeof value==='object')checkRefs(value)}};
 checkRefs(data);
 for(const c of data.classes){const course=courseById.get(c.courseId);if(!course||!course.lessons.some(l=>l.id===c.lessonId)||!Array.isArray(c.studentIds)||c.studentIds.some(id=>!ids.students.has(id)))fail('班级关联不完整')}
 for(const s of data.students)if(!Array.isArray(s.classIds)||s.classIds.some(id=>!ids.classes.has(id))||s.className&&s.className!=='—'&&!s.classIds.some(id=>classById.get(id)?.name===s.className))fail('学生班级关联不完整');
 for(const o of data.orders){const course=courseById.get(o.courseId),c=classById.get(o.classId);if(!ids.students.has(o.studentId)||!c||c.courseId!==o.courseId||!course||consumptionCents(o.paid)===null||consumptionCents(o.amount)===null||!consumptionValidLessons(o.lessonSnapshot)||o.lessonSnapshot.some(l=>!course.lessons.some(x=>x.id===l.id)))fail('订单关联、讲次或金额不正确')}
 for(const r of data.sessionAdjustments){
  const source=classById.get(r.sourceClassId),target=classById.get(r.targetClassId),order=orderById.get(r.orderId||r.sourceOrderId);
  if(!ids.students.has(r.studentId)||!source||!target||source===target||source.courseId!==target.courseId||source.lessonId!==target.lessonId||String(source.lessonVersion)!==String(target.lessonVersion)||r.date!==target.date)fail('调课关联不完整');
  if(r.courseId&&r.courseId!==source.courseId||r.lessonId&&r.lessonId!==source.lessonId||r.lessonVersion!=null&&String(r.lessonVersion)!==String(source.lessonVersion))fail('调课课程内容不一致');
  if(r.sourceSessionId&&r.sourceSessionId!==workflowSessionKey(source)||r.targetSessionId&&r.targetSessionId!==workflowSessionKey(target)||r.sessionId&&r.sessionId!==workflowSessionKey(target)||r.consumptionSourceSessionId&&r.consumptionSourceSessionId!==workflowSessionKey(source))fail('调课课次引用不一致');
  if(r.orderId||r.sourceOrderId||r.consumptionEnabled){if(!order||order.studentId!==r.studentId||order.classId!==source.id||order.courseId!==source.courseId||r.orderId&&r.sourceOrderId&&r.orderId!==r.sourceOrderId||consumptionAllocation(order,source.lessonId)===null)fail('调课原订单引用不一致')}
 }
 for(const r of data.attendance){
  const c=classById.get(r.classId),order=orderById.get(r.orderId||r.sourceOrderId),adjustment=data.sessionAdjustments.find(x=>x.studentId===r.studentId&&x.targetClassId===r.classId&&x.date===r.date&&(!order||x.sourceClassId===order.classId));
  if(!ids.students.has(r.studentId)||!c||r.simulationRunId!==p.runId||!['到课','请假','旷课','未考勤'].includes(r.attendance)||typeof r.consumptionConfirmed!=='boolean'||r.sessionId!==workflowSessionKey(c)||r.date!==c.date||r.lessonId!==c.lessonId||r.session!==c.lessonId)fail('考勤关联不完整');
  if(r.orderId||r.sourceOrderId){if(!order||order.studentId!==r.studentId||order.courseId!==c.courseId||order.classId!==c.id&&!adjustment||r.orderId&&r.sourceOrderId&&r.orderId!==r.sourceOrderId)fail('考勤订单引用不一致')}
  const source=order?classById.get(order.classId):adjustment?classById.get(adjustment.sourceClassId):c;
  if(r.sourceSessionId&&r.sourceSessionId!==workflowSessionKey(source)||r.consumptionSourceSessionId&&r.consumptionSourceSessionId!==workflowSessionKey(source)||r.targetSessionId&&r.targetSessionId!==workflowSessionKey(c))fail('考勤原课次引用不一致');
  if(r.makeupAppointmentId){const appointment=adjustmentById.get(r.makeupAppointmentId);if(!appointment||appointment!==adjustment||appointment.type!=='补课')fail('补课预约引用不一致')}
  if(r.consumptionConfirmed&&(!order||order.paymentState!=='已支付'||consumptionAllocation(order,r.lessonId)===null))fail('课消缺少有效订单讲次');
 }
 return p;
}
function consumptionDemoOpen(){if(!consumptionDemoAllowed()){toast('当前身份无演示数据导入权限');return}consumptionDemoUI.open=true;nav('learningData')}
function consumptionDemoPreview(payload){if(!consumptionDemoAllowed())return;try{consumptionDemoUI.payload=consumptionDemoValidate(payload);consumptionDemoUI.error=''}catch(e){consumptionDemoUI.payload=null;consumptionDemoUI.error=e.message}render()}
async function consumptionDemoFile(file){if(!consumptionDemoAllowed()||!file)return;if(file.size>3*1024*1024){consumptionDemoUI.error='文件超过 3 MB';render();return}try{consumptionDemoPreview(JSON.parse(await file.text()))}catch{consumptionDemoUI.error='无法读取 JSON 文件';render()}}
function consumptionDemoImport(){
 if(!consumptionDemoAllowed()){toast('当前身份无演示数据导入权限');return}
 const p=consumptionDemoValidate(consumptionDemoUI.payload),data=p.academic;
 if(['courses','classes','students','orders','attendance','sessionAdjustments'].some(k=>data[k].some(row=>(a[k]||[]).some(x=>x.id===row.id)))){toast('这一组演示已经导入或标识冲突；未重复添加');return}
 for(const k of ['courses','classes','students','orders','sessionAdjustments'])a[k]=[...(a[k]||[]),...data[k]];
 const rows=data.attendance.map(r=>({...r,classIndex:a.classes.findIndex(c=>c.id===r.classId),studentIndex:a.students.findIndex(s=>s.id===r.studentId)}));
 a.attendance.push(...rows);a.batchLogs=a.batchLogs||[];a.batchLogs.push({id:p.runId+'-import',kind:'CLI 课消演示',simulationRunId:p.runId,at:new Date().toISOString(),actor:workflowActor(),source:'siyue-cli 模拟结果',count:rows.length});
 workflowPersist();consumptionDemoUI.open=false;nav('financeConsumption');toast('CLI 演示数据已导入；考勤、课消、学生档案和退费试算共用这些记录');return true;
}
consumptionDemoImport=auditAtomic(consumptionDemoImport);
const consumptionDemoDataPage=learningDataPage;
learningDataPage=function(){
 if(!consumptionDemoUI.open)return consumptionDemoDataPage()+ (consumptionDemoAllowed()?'<div class="card pad"><button class="btn" onclick="consumptionDemoOpen()">CLI 课消演示</button></div>':'');
 if(!consumptionDemoAllowed())return '<div class="empty">当前身份无演示数据导入权限</div>';
 const p=consumptionDemoUI.payload,d=p?.academic;
 return `<section class="card pad"><div class="toolbar"><strong>CLI 课消演示</strong><button class="btn" onclick="consumptionDemoUI.open=false;render()">关闭预览</button></div><p class="muted">仅追加带 SIM 标识的模拟档案，不覆盖现有记录。先预览，再确认导入。</p><div class="actions"><button class="btn" onclick="consumptionDemoPreview(window.siyueConsumptionExample)">预览内置 CLI 结果</button><label class="btn">选择 CLI 结果文件<input type="file" accept="application/json,.json" style="display:none" onchange="consumptionDemoFile(this.files[0])"></label></div>${consumptionDemoUI.error?`<p class="notice">${esc(consumptionDemoUI.error)}</p>`:''}${p?`<p class="muted">${esc(p.runId)} · ${esc(p.generatedAt)}</p><div class="toolbar"><span>${d.students.length} 位模拟学生</span><span>${d.classes.length} 个班级</span><span>${d.attendance.length} 条点名</span><span>${d.attendance.filter(r=>r.consumptionConfirmed).length} 条课消</span></div>${aTable(['学生','日期','考勤','课消'],d.attendance.map(r=>`<tr><td>${esc(d.students.find(s=>s.id===r.studentId)?.name||'')}</td><td>${esc(r.date)}</td><td>${esc(r.attendance)}</td><td>${r.consumptionConfirmed?'已确认':'不扣课'}</td></tr>`))}<div class="form-actions"><button class="btn primary" onclick="consumptionDemoImport()">确认导入演示数据</button></div>`:''}</section>`;
};
commandWorkflows.push({id:'demo.lesson-consumption',label:'导入 CLI 课消演示',words:['模拟课消','课消测试','siyue-cli','课消演示'],page:'learningData',allowed:consumptionDemoAllowed,run:consumptionDemoOpen});
