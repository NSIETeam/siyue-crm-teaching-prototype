/* Java-owned commerce pages for course publication and class-scoped promotions. */
(function (root) {
  'use strict';
  const pages = [
    { id: 'mallShelf', title: '课程上架', kind: 'product', permission: 'commerce.read' },
    { id: 'mallGroup', title: '拼团', kind: 'group', permission: 'commerce.read' },
    { id: 'mallJoint', title: '联报', kind: 'joint', permission: 'commerce.read' }
  ];
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const kinds = { long_term: '长期班', short_term: '短期班', trial: '体验课' };
  const participants = ['在读学员', '潜在学员', '历史学员'];
  const knownRejection = error => Number.isInteger(error?.status) && error.status >= 400 && error.status < 500;
  const items = result => Array.isArray(result?.items) ? result.items : [];

  function create({ api, identity, render }) {
    const commerce = api.commerce;
    const permissions = new Set(identity.permissions || []);
    const state = { page: '', loading: false, error: '', notice: '', result: null, number: 1,
      edit: null, picker: null, review: null, request: 0, closed: false };
    const bound = new WeakSet();
    const controller = new AbortController();
    const allowed = permission => permissions.has(permission);
    const page = () => pages.find(item => item.id === state.page);
    const paint = () => { if (!state.closed) render(); };
    const msg = error => error?.message || '商城设置读取失败，请重试。';
    const button = (label, action, extra = '', disabled = false, primary = false) => `<button type="button" class="btn${primary ? ' primary' : ''}" data-jc-action="${action}" ${extra} ${disabled ? 'disabled' : ''}>${esc(label)}</button>`;
    const input = (label, name, value, type = 'text', attrs = '') => `<label>${esc(label)}<input class="input" name="${name}" type="${type}" value="${esc(value)}" ${attrs}></label>`;
    const select = (label, name, value, rows, attrs = '') => `<label>${esc(label)}<select class="select" name="${name}" ${attrs}>${rows.map(row => `<option value="${esc(row.value)}" ${String(value ?? '') === String(row.value) ? 'selected' : ''}>${esc(row.label)}</option>`).join('')}</select></label>`;
    const table = (headers, rows, empty = '当前暂无记录') => `<div class="table-wrap"><table class="table"><thead><tr>${headers.map(header => `<th>${esc(header)}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.join('') : `<tr><td colspan="${headers.length}">${esc(empty)}</td></tr>`}</tbody></table></div>`;
    const tr = values => `<tr>${values.map(value => `<td>${value}</td>`).join('')}</tr>`;
    const pager = data => data ? `<div class="ja-pager"><span>共 ${Number(data.total) || 0} 项 · 第 ${Number(data.page) || 1} 页</span><div>${button('上一页','page',`data-page="${Math.max(1,state.number-1)}"`,state.number<=1)}${button('下一页','page',`data-page="${state.number+1}"`,state.number*Number(data.pageSize||50)>=Number(data.total||0))}</div></div>` : '';
    function canLeave() {
      if (state.review?.busy || state.review?.uncertain) { state.error = '商城提交结果尚未确认，请在原页使用相同请求重试后再切换。'; paint(); return false; }
      if (state.review || state.edit || state.picker) { state.error = '请先完成或取消当前商城编辑，再切换工作页。'; paint(); return false; }
      return true;
    }
    async function open(id) {
      const entry = pages.find(item => item.id === id);
      if (!entry || !allowed(entry.permission)) throw Error('当前账号没有访问此商城页面的权限。');
      if (!canLeave()) return false;
      state.page = id; state.error = ''; state.notice = ''; state.edit = null; state.review = null; state.picker = null; state.number = 1;
      await load(); return true;
    }
    async function load() {
      const request = ++state.request; state.loading = true; state.error = ''; state.result = null; paint();
      try {
        const result = page().kind === 'product'
          ? await commerce.products.list({ page: state.number, pageSize: 50 })
          : await commerce.promotions.list({ page: state.number, pageSize: 50, type: page().kind });
        if (request !== state.request || state.closed) return;
        if (!Array.isArray(result?.items) || result.page !== state.number || result.pageSize !== 50 || !Number.isSafeInteger(result.total) || result.total < 0 || result.items.length > 50) throw Error('商城列表回执不一致，未展示记录。');
        state.result = result;
      } catch (error) { if (request === state.request) state.error = msg(error); }
      finally { if (request === state.request && !state.closed) { state.loading = false; paint(); } }
    }
    async function loadCourses(pageNumber = 1, search = '') {
      const picker = { page: pageNumber, search, data: null, loading: true, error: '' }; state.picker = picker; paint();
      try {
        const data = state.edit?.kind === 'product'
          ? await api.academic.courses.list({ page: pageNumber, size: 20, status: 'active', ...(search ? { search } : {}) })
          : await publishedCourses(pageNumber, search);
        if (state.picker !== picker || state.closed) return;
        if (!Array.isArray(data?.items) || data.page !== pageNumber || data.size !== 20 || !Number.isSafeInteger(data.total)) throw Error('课程列表回执不一致。');
        picker.data = data;
      } catch (error) { if (state.picker === picker) picker.error = msg(error); }
      finally { if (state.picker === picker) { picker.loading = false; paint(); } }
    }
    async function publishedCourses(pageNumber, search) {
      const products = []; let current = 1, total = 0;
      do {
        const data = await commerce.products.list({ page: current, pageSize: 100 });
        if (!Array.isArray(data?.items) || data.page !== current || data.pageSize !== 100 || !Number.isSafeInteger(data.total) || data.total < 0 || data.items.length > 100) throw Error('已上架商品回执不一致。');
        if (current === 1) total = data.total;
        if (data.total !== total || data.items.length !== Math.min(100, Math.max(0, total - (current - 1) * 100))) throw Error('商品分页发生变化，请重新选择课程。');
        products.push(...data.items); current++;
        if (current > 1001) throw Error('商品数量超出支持范围。');
      } while (products.length < total);
      if (new Set(products.map(row => row.id)).size !== products.length) throw Error('商品分页包含重复记录。');
      const query = search.trim().toLocaleLowerCase();
      const rows = products.filter(row => row.published).map(row => {
        if (typeof row.courseId !== 'string' || !Array.isArray(row.classIds) || !row.classIds.length || new Set(row.classIds).size !== row.classIds.length) throw Error('已上架商品的班级范围无效。');
        return { id: row.courseId, name: row.name, marketClassIds: [...row.classIds] };
      }).filter(row => !query || `${row.name} ${row.id}`.toLocaleLowerCase().includes(query));
      return { items: rows.slice((pageNumber - 1) * 20, pageNumber * 20), total: rows.length, page: pageNumber, size: 20 };
    }
    async function loadCourseClasses(courseId) {
      const all = []; let pageNumber = 1, total = 0;
      do {
        const data = await commerce.courses.classes(courseId, { page: pageNumber, pageSize: 100 });
        if (!Array.isArray(data?.items) || data.page !== pageNumber || data.pageSize !== 100 || !Number.isSafeInteger(data.total) || data.total < 0 || data.items.length > 100 || data.items.some(row => row.courseId !== courseId || typeof row.id !== 'string' || !row.id)) throw Error('课程班级列表回执不一致。');
        if (pageNumber === 1) total = data.total;
        if (data.total !== total || data.items.length !== Math.min(100, Math.max(0, total - (pageNumber - 1) * 100))) throw Error('课程班级分页不完整，无法默认选择全部班级。');
        all.push(...data.items); pageNumber++;
        if (pageNumber > 1001) throw Error('课程班级数量超出支持范围。');
      } while (all.length < total);
      return all;
    }
    async function addCourse(course) {
      const edit = state.edit; if (!edit || !course) return;
      if (edit.kind === 'product' && edit.courseId) throw Error('一个上架商品只能关联一门课程。');
      if ((edit.selections || []).some(item => item.courseId === course.id)) throw Error('该课程已在本活动中。');
      const allClasses = await loadCourseClasses(course.id);
      const classes = edit.kind === 'product' ? allClasses : allClasses.filter(row => course.marketClassIds?.includes(row.id));
      if (edit.kind !== 'product' && (!Array.isArray(course.marketClassIds) || classes.length !== course.marketClassIds.length)) throw Error('商品可售班级已变化，请重新选择课程。');
      if (!classes.length) throw Error('该课程目前没有可选班级。');
      if (classes.length > 5000) throw Error('该课程班级数量超出支持范围。');
      if (edit.kind === 'product') { edit.courseId = course.id; edit.name = edit.name || course.name; edit.classes = classes; edit.classIds = classes.map(row => row.id); }
      else edit.selections.push({ courseId: course.id, courseName: course.name, classes, classIds: classes.map(row => row.id) });
      state.picker = null; paint();
    }
    async function restoreEdit(entry) {
      const edit = page().kind === 'product'
        ? { kind: 'product', id: entry.id, version: entry.version, courseId: entry.courseId, name: entry.name, published: entry.published, classIds: [...entry.classIds], classes: [] }
        : { kind: entry.type, id: entry.id, version: entry.version, ...entry, selections: [] };
      if (page().kind !== 'product' && edit.kind !== page().kind) throw Error('活动类型与当前列表不一致，请刷新后重试。');
      state.edit = edit; paint();
      try {
        if (edit.kind === 'product') {
          const courses = await api.academic.courses.list({ page: 1, size: 20, search: entry.courseId, status: 'all' });
          const course = items(courses).find(row => row.id === entry.courseId);
          edit.classes = await loadCourseClasses(entry.courseId);
          edit.courseName = course?.name || entry.courseId;
        } else {
          for (const selection of entry.selections) {
            const courses = await api.academic.courses.list({ page: 1, size: 20, search: selection.courseId, status: 'all' });
            const course = items(courses).find(row => row.id === selection.courseId);
            edit.selections.push({ ...selection, courseName: course?.name || selection.courseId, classes: await loadCourseClasses(selection.courseId) });
          }
        }
      } catch (error) { edit.error = msg(error); }
      paint();
    }
    function classPicker(edit) {
      if (edit.kind === 'product') return edit.courseId ? `<section class="jc-course-range"><h3>${esc(edit.courseName || edit.courseId)} · 全部班级</h3>${classChoices(edit.classes || [], edit.classIds, 'product')}${button('移除课程','remove-course')}</section>` : '<p>请先选择课程，系统会默认勾选该课程的全部班级。</p>';
      return `<div class="jc-selections">${edit.selections.map((selection,index)=>`<section class="jc-course-range"><div class="jc-course-head"><h3>${esc(selection.courseName || selection.courseId)}</h3>${button('移除课程','remove-promotion-course',`data-index="${index}"`)}</div>${classChoices(selection.classes || [],selection.classIds,'promotion',index)}</section>`).join('')}</div>${button('添加课程','choose-course','',state.picker?.loading)}<p class="help">每次添加课程都会默认勾选其商品已上架班级，可逐班取消；活动只适用于保留的已上架班级。</p>`;
    }
    function classChoices(classes, selected, scope, index = '') {
      return `<div class="jc-class-list">${classes.map(row=>`<label><input type="checkbox" data-jc-class="${scope}" data-index="${index}" data-id="${esc(row.id)}" ${selected.includes(row.id)?'checked':''}><span>${esc(row.name)}</span><small>${esc(row.phase || '班级')} · ${esc(row.room || '未设教室')}</small></label>`).join('')}</div>`;
    }
    function editorHtml() {
      const edit = state.edit; if (!edit) return '';
      if (edit.error) return `<section class="card pad jc-editor"><h2>读取关联班级失败</h2><p class="notice" role="alert">${esc(edit.error)}</p>${button('返回列表','cancel-edit')}</section>`;
      const cls = classPicker(edit);
      const common = `${input('名称','name',edit.name,'text','required maxlength="100"')}${cls}`;
      if (edit.kind === 'product') return `<section class="card pad jc-editor"><div class="heading"><h2>${edit.id?'编辑课程上架':'上架课程'}</h2>${button('返回列表','cancel-edit')}</div><p class="help">先选课程，再检查自动勾选的全部班级；取消某个班级后，商品只适用于保留的班级。</p><div class="form-grid">${input('商品课程','courseLabel',edit.courseName || '尚未选择','text','readonly')}${common}</div><label class="jc-check"><input type="checkbox" name="published" ${edit.published?'checked':''}>发布到课程商城</label><div class="actions">${button('选择课程','choose-course')}${button('核对并保存','review-save','',false,true)}</div></section>`;
      const group = edit.kind === 'group';
      const specifics = group ? `${input('成团人数','groupSize',edit.groupSize ?? '','number','required min="2" max="1000"')}${input('拼团有效小时','validHours',edit.validHours ?? '','number','required min="1" max="8760"')}` : '';
      return `<section class="card pad jc-editor"><div class="heading"><h2>${edit.id?'编辑':'创建'}${group?'拼团':'联报'}</h2>${button('返回列表','cancel-edit')}</div><p class="help">选择活动商品后默认勾选其已上架班级；可取消不适用的班级。</p><form data-jc-form="promotion"><div class="form-grid">${common}${input('开始日期','startDate',edit.startDate || '','date','required')}${input('结束日期','endDate',edit.endDate || '','date','required')}${input('优惠金额（元）','discountAmount',edit.discountAmount ?? '','number','required min="0.01" step="0.01"')}${specifics}${select('优惠券叠加','stackCoupon',String(Boolean(edit.stackCoupon)),[{value:'false',label:'不可叠加'},{value:'true',label:'允许叠加'}])}</div><fieldset class="jc-participants"><legend>适用学员</legend>${participants.map(item=>`<label><input type="checkbox" name="participant" value="${esc(item)}" ${edit.participants?.includes(item)?'checked':''}>${esc(item)}</label>`).join('')}</fieldset><label class="jc-check"><input type="checkbox" name="published" ${edit.published?'checked':''}>发布活动</label><div class="actions">${button('添加课程','choose-course')}${button('核对并保存','review-save','',false,true)}</div></form></section>`;
    }
    function reviewHtml() {
      const review = state.review; if (!review) return '';
      return `<section class="card pad jc-review"><h2>核对${review.kind==='product'?'商品':'活动'}</h2><dl>${review.summary.map(([label,value])=>`<dt>${esc(label)}</dt><dd>${esc(value)}</dd>`).join('')}</dl>${review.error?`<p class="notice" role="alert">${esc(review.error)}</p><p class="help">${review.uncertain?'结果未确定，请使用相同提交编号重试。':'服务端拒绝本次提交，可返回修改。'}</p>`:''}<div class="actions">${button('返回修改','review-back','',review.busy||review.uncertain)}${button(review.busy?'正在提交…':review.uncertain?'使用原提交重试':'确认提交','commit','',review.busy,true)}</div></section>`;
    }
    function directoryHtml() {
      if (!state.result) return state.loading ? '<p role="status">正在读取商城数据…</p>' : '';
      const rows = items(state.result);
      if (page().kind === 'product') return `<div class="actions">${allowed('commerce.manage')?button('上架课程','new-edit','',false,true):''}</div>${table(['商品','课程','适用班级','状态','版本','操作'],rows.map(row=>tr([esc(row.name),esc(row.courseId),esc(row.classIds.length),row.published?'已发布':'未发布',esc(row.version),allowed('commerce.manage')?button('编辑','edit-row',`data-id="${esc(row.id)}"`):'—'])))}${pager(state.result)}`;
      return `<div class="actions">${allowed('commerce.manage')?button('新建活动','new-edit','',false,true):''}</div>${table(['活动','类型','活动日期','优惠金额','适用课程 / 班级','状态','版本','操作'],rows.map(row=>tr([esc(row.name),row.type==='group'?'拼团':'联报',esc(`${row.startDate} 至 ${row.endDate}`),esc(`${row.discountAmount} 元`),esc(row.selections.map(selection=>`${selection.courseId}（${selection.classIds.length}班）`).join('、')),row.published?'已发布':'未发布',esc(row.version),allowed('commerce.manage')?button('编辑','edit-row',`data-id="${esc(row.id)}"`):'—'])))}${pager(state.result)}`;
    }
    function html() {
      const title = page()?.title || '';
      return `<section class="java-commerce"><div class="heading"><div><h1>${esc(title)}</h1><p class="subtitle">课程与班级适用范围由服务端保存；更改前请核对完整范围。</p></div>${button('刷新','refresh','',state.loading||state.review?.busy)}</div>${state.error?`<p class="notice" role="alert">${esc(state.error)}</p>`:''}${state.notice?`<p class="notice" role="status">${esc(state.notice)}</p>`:''}${state.review?reviewHtml():state.edit?`${editorHtml()}${pickerHtml()}`:`${directoryHtml()}${pickerHtml()}`}</section>`;
    }
    function pickerHtml() {
      const picker = state.picker; if (!picker) return '';
      const rows = items(picker.data).map(course=>tr([esc(course.name),esc(kinds[course.metadata?.courseKind] || '—'),esc(course.metadata?.term || '—'),esc(course.subject),esc(course.grade),button('选择','pick-course',`data-id="${esc(course.id)}"`,picker.loading)]));
      return `<section class="jc-picker card pad"><div class="heading"><h2>选择课程</h2>${button('取消','cancel-picker')}</div><form data-jc-form="course-search" class="filters">${input('搜索课程','search',picker.search,'search','maxlength="100"')}<button class="btn primary">查询</button></form>${picker.error?`<p class="notice" role="alert">${esc(picker.error)}</p>${button('重试','choose-course')}`:''}${picker.loading?'<p role="status">正在读取课程…</p>':picker.error?'':table(['课程','课程类型','学期','学科','年级','操作'],rows)}${picker.data?`<div class="ja-pager"><span>共 ${picker.data.total} 门课程 · 第 ${picker.page} 页</span><div>${button('上一页','course-page',`data-page="${Math.max(1,picker.page-1)}"`,picker.page<=1)}${button('下一页','course-page',`data-page="${picker.page+1}"`,picker.page*20>=picker.data.total)}</div></div>`:''}</section>`;
    }
    function capture(form) {
      const data = new FormData(form), values = {};
      data.forEach((value,key)=>{ if(key==='participant') (values.participants ||= []).push(String(value)); else values[key]=String(value); });
      const edit=state.edit;
      if (!edit || form.dataset.jcForm!=='promotion') return values;
      edit.name=values.name||'';edit.startDate=values.startDate||'';edit.endDate=values.endDate||'';edit.discountAmount=values.discountAmount||'';
      edit.groupSize=values.groupSize||'';edit.validHours=values.validHours||'';edit.stackCoupon=values.stackCoupon==='true';edit.participants=values.participants||[];edit.published=Boolean(values.published);
      return values;
    }
    function beginReview() {
      const edit=state.edit;if(!edit||!allowed('commerce.manage'))throw Error('当前账号没有商城编辑权限。');
      let body, summary, kind;
      if(edit.kind==='product') {
        body={courseId:edit.courseId,name:edit.name.trim(),classIds:[...edit.classIds],published:Boolean(edit.published),...(edit.id?{expectedVersion:edit.version}:{})};kind='product';
        if(!body.courseId||!body.name||!body.classIds.length||new Set(body.classIds).size!==body.classIds.length)throw Error('请选课程、至少一个班级并填写商品名称。');
        summary=[['商品',body.name],['课程',edit.courseName||body.courseId],['适用班级',`${body.classIds.length} 个`],['发布状态',body.published?'发布':'暂不发布']];
      } else {
        const selections=edit.selections.map(item=>({courseId:item.courseId,classIds:[...item.classIds]}));
        body={type:edit.kind,name:edit.name.trim(),startDate:edit.startDate,endDate:edit.endDate,discountAmount:edit.discountAmount,groupSize:edit.kind==='group'?Number(edit.groupSize):null,validHours:edit.kind==='group'?Number(edit.validHours):null,stackCoupon:Boolean(edit.stackCoupon),participants:[...edit.participants],selections,published:Boolean(edit.published),...(edit.id?{expectedVersion:edit.version}:{})};kind=edit.kind;
        if(!body.name||!body.startDate||!body.endDate||body.endDate<body.startDate||!/^\d{1,10}(\.\d{1,2})?$/.test(body.discountAmount)||Number(body.discountAmount)<=0||!body.participants.length||!selections.length||selections.some(row=>!row.classIds.length)||new Set(selections.map(row=>row.courseId)).size!==selections.length||edit.kind==='joint'&&selections.length<2||edit.kind==='group'&&(!Number.isInteger(body.groupSize)||!Number.isInteger(body.validHours)))throw Error('请填写有效活动日期、优惠金额、参与学员，并为各课程保留适用班级。联报至少选择两门课程。');
        summary=[['活动',body.name],['类型',edit.kind==='group'?'拼团':'联报'],['日期',`${body.startDate} 至 ${body.endDate}`],['优惠金额',`${body.discountAmount} 元`],['适用课程 / 班级',selections.map((row,index)=>`${edit.selections[index].courseName}：${row.classIds.length} 班`).join('；')],['参与学员',body.participants.join('、')],['发布状态',body.published?'发布':'暂不发布']];
        if(edit.kind==='group')summary.push(['成团人数 / 有效时长',`${body.groupSize} 人 / ${body.validHours} 小时`]);
      }
      const key=root.crypto.randomUUID();state.review={kind,id:edit.id,body,summary,key,busy:false,uncertain:false,error:''};paint();
    }
    function sameSelections(left,right) {
      if(!Array.isArray(left)||!Array.isArray(right)||left.length!==right.length)return false;
      const canonical=rows=>rows.map(row=>({courseId:row.courseId,classIds:[...(row.classIds||[])].sort()}))
        .sort((a,b)=>a.courseId.localeCompare(b.courseId));
      return JSON.stringify(canonical(left))===JSON.stringify(canonical(right));
    }
    function sameIds(left,right) {
      return Array.isArray(left)&&Array.isArray(right)&&left.length===right.length
        &&JSON.stringify([...left].sort())===JSON.stringify([...right].sort());
    }
    async function commit() {
      const review=state.review;if(!review||review.busy)return;
      review.busy=true;review.error='';paint();
      try {
        const result=review.kind==='product' ? review.id?await commerce.products.update(review.id,review.body,review.key):await commerce.products.create(review.body,review.key)
          : review.id?await commerce.promotions.update(review.id,review.body,review.key):await commerce.promotions.create(review.body,review.key);
        if(!result?.id||result.version!==((review.body.expectedVersion||0)+1)||result.published!==review.body.published)throw Error('服务端回执无法确认保存结果，请刷新或重试原请求。');
        if(review.kind==='product'&&(result.courseId!==review.body.courseId||result.name!==review.body.name||!sameIds(result.classIds,review.body.classIds)))throw Error('商品回执的课程或班级范围不一致。');
        if(review.kind!=='product'&&(result.type!==review.body.type||result.name!==review.body.name||!sameSelections(result.selections,review.body.selections)))throw Error('活动回执的课程或班级范围不一致。');
        if(state.review!==review||state.closed)return;
        state.review=null;state.edit=null;state.notice='已保存，商品与班级适用范围已由服务端确认。';await load();
      } catch(error) { if(state.review===review){review.error=msg(error);review.uncertain=review.uncertain||!knownRejection(error); } }
      finally { if(state.review===review){review.busy=false;paint();} }
    }
    async function action(target) {
      const name=target.dataset.jcAction;if(state.review?.busy||state.review?.uncertain&&name!=='commit')return;
      try {
        const promotionForm=root.document.querySelector('[data-jc-form="promotion"]');
        if(promotionForm)capture(promotionForm);
        if(name==='review-save') {
          const edit=state.edit;
          if(edit?.kind==='product'){edit.name=root.document.querySelector('[name="name"]')?.value||'';edit.published=Boolean(root.document.querySelector('[name="published"]')?.checked);beginReview();}
          else {const form=root.document.querySelector('[data-jc-form="promotion"]');if(!form?.reportValidity())return;capture(form);beginReview();}
        }
        else if(name==='refresh')await load();
        else if(name==='page'){state.number=Number(target.dataset.page);await load();}
        else if(name==='new-edit'&&allowed('commerce.manage'))state.edit=page().kind==='product'?{kind:'product',name:'',courseId:'',courseName:'',classes:[],classIds:[],published:false}:{kind:page().kind,name:'',selections:[],startDate:'',endDate:'',discountAmount:'',groupSize:'',validHours:'',stackCoupon:false,participants:[],published:false};
        else if(name==='edit-row'&&allowed('commerce.manage')){const row=items(state.result).find(item=>item.id===target.dataset.id);if(row)await restoreEdit(row);}
        else if(name==='choose-course')await loadCourses();
        else if(name==='course-page'&&state.picker)await loadCourses(Number(target.dataset.page),state.picker.search);
        else if(name==='cancel-picker')state.picker=null;
        else if(name==='pick-course'&&state.picker){const course=items(state.picker.data).find(item=>item.id===target.dataset.id);await addCourse(course);}
        else if(name==='remove-course'&&state.edit?.kind==='product'){Object.assign(state.edit,{courseId:'',courseName:'',classes:[],classIds:[]});}
        else if(name==='remove-promotion-course'&&state.edit){state.edit.selections.splice(Number(target.dataset.index),1);}
        else if(name==='cancel-edit')state.edit=null;
        else if(name==='review-back')state.review=null;
        else if(name==='commit')await commit();
      } catch(error) { state.error=msg(error); }
      paint();
    }
    function bind(container = root.document) {
      if(bound.has(container))return;bound.add(container);
      container.addEventListener('click',event=>{const target=event.target.closest?.('[data-jc-action]');if(target)void action(target);},{signal:controller.signal});
      container.addEventListener('change',event=>{
        const target=event.target,scope=target.dataset?.jcClass,edit=state.edit;if(!edit||!scope)return;
        const selection=scope==='product'?edit:edit.selections[Number(target.dataset.index)];if(!selection)return;
        const ids=selection.classIds;selection.classIds=target.checked?[...new Set([...ids,target.dataset.id])]:ids.filter(id=>id!==target.dataset.id);
        const form=target.closest?.('[data-jc-form="promotion"]');if(form)capture(form);
      },{signal:controller.signal});
      container.addEventListener('input',event=>{
        const target=event.target,edit=state.edit;if(!edit)return;
        const form=target.closest?.('[data-jc-form="promotion"]');if(form){capture(form);return;}
        if(target.name==='name')edit.name=target.value;
        if(target.name==='published')edit.published=target.checked;
      },{signal:controller.signal});
      container.addEventListener('submit',event=>{
        const form=event.target.closest?.('[data-jc-form]');if(!form)return;event.preventDefault();
        if(form.dataset.jcForm==='course-search'){const values=new FormData(form);void loadCourses(1,String(values.get('search')||'')).then(()=>{});return;}
        if(form.dataset.jcForm==='promotion'){capture(form);try{beginReview();}catch(error){state.error=msg(error);paint();}return;}
      },{signal:controller.signal});
    }
    function dispose(){state.closed=true;state.request++;controller.abort();}
    return Object.freeze({ pages, open, html, bind, canLeave, dispose });
  }
  root.siyueJavaCommerce = Object.freeze({ pages, create });
})(globalThis);
