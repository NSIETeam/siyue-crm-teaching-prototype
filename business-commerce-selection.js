/* Course and class selection for the authenticated Node v1 business flow. */
(function(root){
 'use strict';
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const arg=value=>esc(JSON.stringify(value));
 const live=row=>row&&row.active!==false&&!['已结束','已取消','已关闭','停用','cancelled','canceled','ended','inactive','closed'].includes(row.status);
 const rows=(ctx,key)=>Array.isArray(ctx?.data?.[key])?ctx.data[key]:[];
 const promo=ctx=>['promotion.create','promotion.update'].includes(ctx?.operation?.id)&&['group','joint'].includes(ctx.draft?.type);
 const product=ctx=>ctx?.operation?.id==='product.publish';
 const base=ctx=>ctx.operation?.id==='promotion.update'?['patch']:[];
 const value=ctx=>base(ctx).length?ctx.draft.patch||{}:ctx.draft;
 const shown=new Set();
 let pageContext=null;
 function courseClasses(ctx,id,forPromotion=false){
  let classes=rows(ctx,'classes').filter(c=>c.courseId===id&&live(c));
  const course=rows(ctx,'courses').find(c=>c.id===id);
  if(forPromotion&&Array.isArray(course?.storefront?.classIds))classes=classes.filter(c=>course.storefront.classIds.includes(c.id));
  return classes;
 }
 function catalog(ctx,forPromotion=false){
  const shelved=new Set((ctx.data?.shelved||[]).map(x=>typeof x==='string'?x:x.courseId)),hidden=new Set(ctx.data?.hiddenShelved||[]);
  return rows(ctx,'courses').filter(c=>live(c)&&(!forPromotion||shelved.has(c.id)&&!hidden.has(c.id)));
 }
 function selections(ctx){
  const draft=value(ctx);
  if(Array.isArray(draft.selections))return draft.selections.map(s=>({courseId:s.courseId,classIds:[...(s.classIds||[])]}));
  return (draft.courseIds||[]).map(courseId=>({courseId,classIds:courseClasses(ctx,courseId,true).map(c=>c.id)}));
 }
 function details(ctx,course,selectedIds,interactive,forPromotion,showSaved=false){
  const classes=courseClasses(ctx,course.id,forPromotion),ids=new Set(selectedIds||[]),disabled=ctx.disabled?'disabled':'';
  const missing=[...ids].filter(id=>!classes.some(c=>c.id===id));
  return `<details class="bcs-details" ${shown.has(course.id)?'open':''} ontoggle="SiyueBusinessCommerceSelection.expanded(${arg(course.id)},this.open)"><summary>班级详情 · ${classes.length} 个有效班级${interactive?` · 已选 ${ids.size} 个`:''}</summary><div class="bcs-class-list">${classes.map(c=>`<label class="bcs-class">${interactive?`<input type="checkbox" ${ids.has(c.id)?'checked':''} ${disabled} onchange="SiyueBusinessCommerceSelection.toggleClass(${arg(course.id)},${arg(c.id)},this.checked)">`:''}<span><strong>${esc(c.name||c.id)}</strong><small>${esc(rows(ctx,'campuses').find(r=>r.id===c.campusId)?.name||c.campusName||'')}${c.teacher||c.teacherName?` · ${esc(c.teacherName||c.teacher)}`:''}${showSaved?` · ${ids.has(c.id)?'上架范围内':'未上架'}`:''}</small></span></label>`).join('')||'<p class="help">暂无可选择的有效班级</p>'}${missing.length?`<p class="business-error">已保存的 ${missing.length} 个班级已停用或不在当前授权范围，请刷新后重新选择课程。</p>`:''}</div></details>`;
 }
 function picker(ctx){
  const isProduct=product(ctx),draft=value(ctx),selected=isProduct?(draft.courseId?[{courseId:draft.courseId,classIds:draft.classIds||[]}]:[]):selections(ctx),classesByCourse=new Map(selected.map(s=>[s.courseId,s.classIds]));
  const list=catalog(ctx,!isProduct),disabled=ctx.disabled?'disabled':'';
  return `<fieldset class="business-fieldset bcs-picker"><legend>${isProduct?'选择课程与上架班级':'选择商品与适用班级'}<span class="required-mark">*</span></legend><p class="help">选择课程后默认勾选其全部${isProduct?'有效':'可售'}班级，打开详情可单独取消班级。</p><div class="bcs-course-list">${list.map(c=>{const chosen=classesByCourse.has(c.id),ids=classesByCourse.get(c.id)||[],count=courseClasses(ctx,c.id,!isProduct).length;return `<article class="bcs-course ${chosen?'is-selected':''}"><label class="bcs-course-choice"><input type="${isProduct?'radio':'checkbox'}" ${isProduct?'name="bcs-product-course"':''} ${chosen?'checked':''} ${disabled||!count?'disabled':''} onchange="SiyueBusinessCommerceSelection.selectCourse(${arg(c.id)},this.checked)"><span><strong>${esc(c.name||c.id)}</strong><small>${esc([c.grade,c.subject].filter(Boolean).join(' · '))}</small></span></label>${chosen?`<button type="button" class="btn small bcs-select-all" ${disabled} onclick="SiyueBusinessCommerceSelection.selectCourse(${arg(c.id)},true)">全选${isProduct?'有效':'可售'}班级</button>`:''}${details(ctx,c,ids,chosen,!isProduct)}</article>`}).join('')||'<p class="help">暂无可选择的课程商品，请先上架课程并建立有效班级。</p>'}</div>${selected.filter(s=>!list.some(c=>c.id===s.courseId)).map(s=>`<p class="business-error">已选课程 ${esc(s.courseId)} 已停用、下架或不可见，请重新选择。<button type="button" class="btn small" ${disabled} onclick="SiyueBusinessCommerceSelection.selectCourse(${arg(s.courseId)},false)">移除该课程</button></p>`).join('')}${selected.some(s=>s.classIds.length===0)?'<p class="business-error">每门已选课程至少保留一个班级；可取消整门课程。</p>':''}</fieldset>`;
 }
 function field(ctx){
  if(product(ctx)&&ctx.path?.length===1){if(ctx.key==='courseId')return picker(ctx);if(ctx.key==='classIds')return '';}
  if(promo(ctx)&&ctx.path?.length===base(ctx).length+1){if(ctx.key==='courseIds')return picker(ctx);if(['classIds','selections'].includes(ctx.key))return '';}
  return null;
 }
 function current(){const ctx=root.businessAPI?.academicDraft?.();return ctx&&!ctx.disabled&&(product(ctx)||promo(ctx))?ctx:null;}
 function save(ctx,draft){const next={...ctx.draft};if(base(ctx).length)next.patch=draft;else Object.assign(next,draft);return root.businessAPI.academicSet([],next);}
 function selectCourse(id,checked){
  const ctx=current();if(!ctx)return false;
  const draft={...value(ctx)},course=catalog(ctx,promo(ctx)).find(c=>c.id===id);
  if(checked&&(!course||!courseClasses(ctx,id,promo(ctx)).length))return false;
  if(product(ctx)){if(checked){draft.courseId=id;draft.classIds=courseClasses(ctx,id).map(c=>c.id);draft.expectedVersion=course.version;}else{delete draft.courseId;delete draft.expectedVersion;draft.classIds=[];}}
  else{const selected=selections(ctx).filter(s=>s.courseId!==id);if(checked)selected.push({courseId:id,classIds:courseClasses(ctx,id,true).map(c=>c.id)});draft.selections=selected;draft.courseIds=selected.map(s=>s.courseId);}
  shown.add(id);return save(ctx,draft);
 }
 function toggleClass(courseId,classId,checked){
  const ctx=current();if(!ctx||!courseClasses(ctx,courseId,promo(ctx)).some(c=>c.id===classId))return false;
  const draft={...value(ctx)},update=ids=>checked?[...new Set([...ids,classId])]:ids.filter(id=>id!==classId);
  if(product(ctx)){if(draft.courseId!==courseId)return false;draft.classIds=update(draft.classIds||[]);}
  else{const selected=selections(ctx);if(!selected.some(s=>s.courseId===courseId))return false;draft.selections=selected.map(s=>s.courseId===courseId?{...s,classIds:update(s.classIds)}:s);draft.courseIds=draft.selections.map(s=>s.courseId);}
  return save(ctx,draft);
 }
 function renderPage(ctx){
  if(ctx?.page!=='mallShelf')return null;pageContext=ctx;
  const query=String(ctx.query||'').trim().toLocaleLowerCase(),shelved=new Set((ctx.data?.shelved||[]).map(x=>typeof x==='string'?x:x.courseId)),hidden=new Set(ctx.data?.hiddenShelved||[]),can=id=>{const op=ctx.operations?.find(o=>o.id===id);return !!op&&!!ctx.permitted?.(op)};
  return `<section class="card pad bcs-shelf"><div class="toolbar business-list-toolbar"><input class="input" type="search" aria-label="搜索课程商品" placeholder="搜索课程、年级、学科" value="${esc(ctx.query||'')}" onchange="businessAPI.search(this.value)"><div class="actions">${can('product.publish')?'<button type="button" class="btn primary" onclick="businessAPI.open(\'product.publish\')">上架课程</button>':''}<button type="button" class="btn" onclick="businessAPI.reload()">刷新</button></div></div><div class="bcs-course-list">${rows(ctx,'courses').filter(c=>!query||[c.name,c.grade,c.subject].join(' ').toLocaleLowerCase().includes(query)).map(c=>{const on=shelved.has(c.id)&&!hidden.has(c.id),saved=c.storefront?.classIds??(on?courseClasses(ctx,c.id).map(k=>k.id):[]);return `<article class="bcs-course"><div class="bcs-course-head"><div><strong>${esc(c.name||c.id)}</strong><small>${esc([c.grade,c.subject].filter(Boolean).join(' · '))}</small></div><span>${on?'已上架':shelved.has(c.id)?'已下架':'未上架'} · ${saved.length} 个可售班级</span><div class="actions">${can('product.publish')&&live(c)?`<button type="button" class="btn small" onclick="SiyueBusinessCommerceSelection.openProduct(${arg(c.id)})">${on?'修改上架班级':'上架课程'}</button>`:''}${on&&can('product.unpublish')?`<button type="button" class="btn small" onclick="businessAPI.open('product.unpublish',${arg({courseId:c.id,expectedVersion:c.version})})">下架</button>`:''}</div></div>${details(ctx,c,saved,false,false,true)}</article>`}).join('')||'<p class="empty">暂无课程商品</p>'}</div></section>`;
 }
 function openProduct(id){const ctx=pageContext,c=rows(ctx,'courses').find(c=>c.id===id);if(!c||!live(c))return false;const classIds=c.storefront?.classIds??courseClasses(ctx,id).map(k=>k.id);shown.add(id);return root.businessAPI.open('product.publish',{courseId:id,classIds:[...classIds],expectedVersion:c.version});}
 root.SiyueBusinessCommerceSelection={field,renderPage,selectCourse,toggleClass,openProduct,expanded(id,open){if(open)shown.add(id);else shown.delete(id);},reset(){shown.clear();pageContext=null;}};
})(typeof window==='undefined'?globalThis:window);
