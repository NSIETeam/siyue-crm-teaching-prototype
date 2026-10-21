/* Authenticated storefront editor presentation. Server operations remain the only write path. */
(function(root){
 'use strict';
 const blockNames=['轮播图','课程展示','机构介绍','教师介绍','品牌介绍','服务说明'];
 const view={selected:'page',preview:'draft'};
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const clone=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
 const quote=value=>esc(JSON.stringify(String(value??'')));
 const validImage=value=>{if(typeof value!=='string'||value.length>700000)return false;if(/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value))return true;if(!/^https:\/\//.test(value))return false;try{const url=new URL(value);return !url.username&&!url.password}catch{return false}};
 function defaultTemplate(){
  return {title:'思跃培优网校',subtitle:'每一份热爱，都值得被看见',color:'#3979ed',modules:['轮播图','课程展示','机构介绍'],blocks:{
   '轮播图':{title:'让好奇心，成为成长的起点',body:'适龄课程 · 专业老师 · 陪伴成长',image:'',cta:'了解课程'},
   '课程展示':{title:'精选好课',body:'为孩子找到适合的下一步',image:'',cta:'了解课程'},
   '机构介绍':{title:'机构介绍',body:'在这里填写介绍内容，让家长了解我们的教学与服务。',image:'',cta:'了解课程'},
   '教师介绍':{title:'教师介绍',body:'在这里填写介绍内容，让家长了解我们的教学与服务。',image:'',cta:'了解课程'},
   '品牌介绍':{title:'品牌介绍',body:'在这里填写介绍内容，让家长了解我们的教学与服务。',image:'',cta:'了解课程'},
   '服务说明':{title:'服务说明',body:'在这里填写介绍内容，让家长了解我们的教学与服务。',image:'',cta:'了解课程'}
  }};
 }
 function namesFor(decor){return [...new Set([...blockNames,...Object.keys(decor?.blocks||{})])].filter(name=>typeof name==='string'&&name.trim()&&!['__proto__','constructor','prototype'].includes(name))}
 function normalize(value){
  const base=defaultTemplate(),decor=value&&typeof value==='object'?clone(value):base;
  decor.title=decor.title??base.title;decor.subtitle=decor.subtitle??base.subtitle;decor.color=/^#[\da-f]{6}$/i.test(decor.color||'')?decor.color:base.color;
  const names=namesFor(decor);
  decor.modules=Array.isArray(decor.modules)?decor.modules.filter((x,i,a)=>names.includes(x)&&a.indexOf(x)===i):base.modules.slice();
  decor.blocks=decor.blocks&&typeof decor.blocks==='object'?decor.blocks:{};
  for(const name of names){decor.blocks[name]={...(base.blocks[name]||{title:name,body:'',image:'',cta:'了解课程'}),...(decor.blocks[name]||{})};if(!Array.isArray(decor.blocks[name].courseIds))delete decor.blocks[name].courseIds;}
  return decor;
 }
 function allowed(ctx,id){const op=(ctx.operations||[]).find(x=>x.id===id);return !!op&&!!ctx.permitted?.(op)}
 function open(id,decor){return `businessAPI.open('${id}',${esc(JSON.stringify({decor:clone(decor)}))})`}
 function currentDraft(){const value=root.businessAPI?.academicDraft?.();return value?.draft?.decor}
 function repaint(){root.businessAPI?.redraw?.()}
 function select(name){if(name!=='page'&&(typeof name!=='string'||!name.trim()||name.length>100||['__proto__','constructor','prototype'].includes(name)))return false;view.selected=name;repaint();return true}
 function setValue(path,value,type='string'){
  if(root.businessAPI?.input)root.businessAPI.input(['decor',...path],value,type);
  refreshForm();
 }
 function setModules(modules){if(root.businessAPI?.change)root.businessAPI.change(['decor','modules'],modules,'array');refreshForm()}
 function setModule(name,on){const draft=normalize(currentDraft()),modules=draft.modules.filter(x=>x!==name);if(on&&!namesFor(draft).includes(name))return false;if(on)modules.push(name);if(on)view.selected=name;else if(view.selected===name)view.selected='page';setModules(modules);return true}
 function move(direction){const draft=normalize(currentDraft()),list=draft.modules,index=list.indexOf(view.selected),next=index+direction;if(index<0||next<0||next>=list.length)return false;[list[index],list[next]]=[list[next],list[index]];setModules(list);return true}
 function setCourse(id,on){const draft=normalize(currentDraft()),block=draft.blocks['课程展示'];let ids=Array.isArray(block.courseIds)?block.courseIds:visibleCourses({data:root.businessAPI?.academicDraft?.()?.data||{}}).map(c=>c.id);ids=ids.filter(x=>x!==id);if(on)ids.push(id);setValue(['blocks','课程展示','courseIds'],ids,'array')}
 function imageUrl(value){return validImage(value)?value:''}
 function visibleCourses(ctx){
  const data=ctx.data||{},courses=Array.isArray(data.courses)?data.courses:[],shelved=new Set((data.shelved||[]).map(x=>typeof x==='string'?x:x?.courseId).filter(Boolean)),hidden=new Set((data.hiddenShelved||[]).map(x=>typeof x==='string'?x:x?.courseId).filter(Boolean));
  return courses.filter(c=>c?.id&&(shelved.has(c.id)||c.storefront?.status==='上架')&&!hidden.has(c.id)&&c.active!==false);
 }
 function phone(ctx,source,interactive){
  const d=normalize(source),color=d.color,products=visibleCourses(ctx),selected=name=>interactive&&view.selected===name?' chosen':'',blocks=d.modules.map(name=>{
   const block=d.blocks[name]||{},image=imageUrl(block.image),isHero=name==='轮播图';
   const productCards=name==='课程展示'?products.filter(c=>!Array.isArray(block.courseIds)||block.courseIds.includes(c.id)).map(c=>{const content=c.storefront?.content||{};return `<span class="store-course"><span class="course-art">${esc(content.subject||c.subject||'课程')}</span><span><b>${esc(content.title||c.name||'课程')}</b><small>${esc(content.grade||c.grade||'适龄学习')} · 查看课程详情</small></span></span>`}).join(''):'';
   return `<button type="button" class="decor-pick store-block ${isHero?'store-hero':''}${selected(name)}" ${interactive?`onclick="SiyueBusinessDecor.select(${quote(name)})" aria-label="编辑${esc(name)}"`:''}>${image?`<img src="${esc(image)}" alt="${esc(block.title)}">`:''}<span class="store-block-copy"><strong>${esc(block.title||name)}</strong><small>${esc(block.body||'')}</small>${isHero?`<span class="store-cta" style="background:${esc(color)}">${esc(block.cta||'了解课程')} ↗</span>`:''}</span>${productCards}</button>`;
  }).join('');
  return `<div class="iphone17 bd-phone" aria-label="iPhone 17 商城预览"><div class="iphone-screen"><div class="iphone-status"><b>9:41</b><span class="dynamic-island"></span><span aria-hidden="true">▮▮▮ ▰</span></div><div class="iphone-scroll"><button type="button" class="store-brand decor-pick${selected('page')}" ${interactive?'onclick="SiyueBusinessDecor.select(\'page\')" aria-label="编辑商城页面设置"':''}><span class="store-monogram" style="background:${esc(color)}">思</span><span><strong>${esc(d.title)}</strong><small>${esc(d.subtitle)}</small></span></button>${blocks||'<p class="bd-phone-empty">尚未选择展示区块</p>'}</div><div class="iphone-tabbar"><span>⌂<small>首页</small></span><span>▤<small>课程</small></span><span>♙<small>我的</small></span></div><div class="iphone-home"></div></div></div>`;
 }
 function pageInspector(ctx,draft,canEdit){
  const selected=view.selected==='page'?'page':view.selected,block=draft.blocks[selected];
  const header=`<div class="decor-editor-head bd-inspector-head"><strong>${selected==='page'?'页面设置':esc(selected)}</strong><span class="muted">${canEdit?'点选预览区块后，在这里编辑':'当前账号只有查看权限'}</span></div>`;
  if(selected==='page')return `${header}<div class="bd-inspector-body"><div class="bd-read-field"><span>商城名称</span><strong>${esc(draft.title||'—')}</strong></div><div class="bd-read-field"><span>品牌简介</span><strong>${esc(draft.subtitle||'—')}</strong></div><div class="bd-read-field"><span>主题颜色</span><i class="bd-color-chip" style="background:${esc(draft.color)}"></i><code>${esc(draft.color)}</code></div><div class="bd-module-list"><strong>页面区块</strong>${namesFor(draft).map(name=>`<span class="bd-module-state"><i class="${draft.modules.includes(name)?'is-on':''}"></i>${esc(name)}</span>`).join('')}</div>${canEdit?'<button type="button" class="btn primary" onclick="SiyueBusinessDecor.editSelected()">编辑页面</button>':''}</div>`;
  if(!block)return `${header}<p class="muted">请选择页面区块。</p>`;
  return `${header}<div class="bd-inspector-body"><div class="bd-read-field"><span>区块标题</span><strong>${esc(block.title||'—')}</strong></div><div class="bd-read-field"><span>内容</span><strong>${esc(block.body||'—')}</strong></div>${selected==='轮播图'?`<div class="bd-read-field"><span>按钮文字</span><strong>${esc(block.cta||'—')}</strong></div>`:''}${block.image&&imageUrl(block.image)?'<span class="bd-image-state">已配置图片</span>':''}${selected==='课程展示'?`<div class="bd-module-list"><strong>展示课程</strong>${visibleCourses(ctx).filter(c=>!Array.isArray(block.courseIds)||block.courseIds.includes(c.id)).map(c=>`<span class="bd-module-state">${esc(c.storefront?.content?.title||c.name||'课程')}</span>`).join('')||'<span class="muted">暂无上架课程</span>'}</div>`:''}${canEdit?'<button type="button" class="btn primary" onclick="SiyueBusinessDecor.editSelected()">编辑此区块</button>':''}</div>`;
 }
 function renderPage(ctx){
  if(ctx?.page!=='mallDecor')return null;
  const record=ctx.data?.decor||{},hasDraft=!!record.draft,hasPublished=!!record.published,canSave=allowed(ctx,'store.design.save'),canPublish=allowed(ctx,'store.design.publish');
  const template=defaultTemplate(),draft=normalize(record.draft||record.published||template),published=record.published?normalize(record.published):null;
  if(!hasPublished&&view.preview==='published')view.preview='draft';
  const showingPublished=view.preview==='published'&&published,previewData=showingPublished?published:draft;
  const canEdit=!!canSave&&!showingPublished;
  const hasConfigured=hasDraft||hasPublished;
  const buttons=`<div class="bd-actions">${canSave?hasConfigured?`<button type="button" class="btn primary" onclick="SiyueBusinessDecor.edit('draft')">${hasDraft?'编辑装修草稿':'从已发布版本继续编辑'}</button>`:`<button type="button" class="btn primary" onclick="SiyueBusinessDecor.useTemplate()">使用此模板</button>`:''}${canPublish&&hasDraft?`<button type="button" class="btn" onclick="SiyueBusinessDecor.publishDraft()">预览并发布</button>`:''}<button type="button" class="btn" onclick="businessAPI.reload()">刷新</button></div>`;
  const status=hasDraft?'已有草稿':hasPublished?'当前展示已发布版本':'尚未配置商城装修';
  return `<section class="bd-page"><div class="bd-topbar"><div><span>${status}</span></div>${buttons}</div>${hasPublished?`<div class="bd-preview-tabs"><button type="button" class="${view.preview==='draft'?'active':''}" onclick="SiyueBusinessDecor.previewMode('draft')">预览草稿</button><button type="button" class="${view.preview==='published'?'active':''}" onclick="SiyueBusinessDecor.previewMode('published')">已发布版本</button></div>`:''}<div class="decor-layout bd-layout"><section class="decor-stage bd-stage"><div class="decor-device-label bd-device-label">iPhone 17 <span>· 点击页面区块查看内容</span></div><div class="bd-preview">${phone(ctx,previewData,true)}</div></section><aside class="card decor-inspector bd-inspector">${pageInspector(ctx,previewData,canEdit)}</aside></div></section>`;
 }
 function formBlockEditor(ctx,draft){
  const name=view.selected==='page'?'page':view.selected,block=draft.blocks[name],disabled=ctx.disabled?'disabled':'';
  const input=(label,path,value,type='string',large=false)=>{const businessPath=esc(JSON.stringify(['decor',...path])),businessType=type==='color'?'string':type;return `<label class="decor-field bd-field"><span>${esc(label)}</span>${large?`<textarea class="input" rows="4" ${disabled} data-business-path="${businessPath}" data-business-type="${esc(businessType)}" oninput="SiyueBusinessDecor.input(${esc(JSON.stringify(path))},this.value,'${type}')">${esc(value||'')}</textarea>`:`<input class="input ${path.at(-1)==='image'?'bd-image-url':''}" ${disabled} value="${esc(value||'')}" data-business-path="${businessPath}" data-business-type="${esc(businessType)}" ${type==='color'?'type="color"':''} oninput="SiyueBusinessDecor.input(${esc(JSON.stringify(path))},this.value,'${type}')">`}</label>`};
  if(name==='page')return `${input('商城名称',['title'],draft.title)}${input('品牌简介',['subtitle'],draft.subtitle,'string',true)}${input('主题颜色',['color'],draft.color,'color')}<fieldset class="decor-field bd-fieldset" ${disabled}><legend>显示区块</legend>${namesFor(draft).map(key=>`<label class="decor-module bd-module-toggle"><input type="checkbox" ${draft.modules.includes(key)?'checked':''} ${disabled} onchange="SiyueBusinessDecor.setModule(${quote(key)},this.checked)"><span>${esc(key)}</span></label>`).join('')}</fieldset>`;
  if(!block)return '<p class="muted">请选择一个页面区块。</p>';
  const fields=input('区块标题',['blocks',name,'title'],block.title)+input('内容',['blocks',name,'body'],block.body,'string',true);
  const action=name==='轮播图'?input('按钮文字',['blocks',name,'cta'],block.cta):'';
  const imageUrlField=input('图片 HTTPS 地址或已选图片数据',['blocks',name,'image'],block.image||'');
  const imageHint=block.image&&!validImage(block.image)?'<small class="bd-error">当前图片地址不符合要求，请更换或移除。</small>':'<small class="muted">支持 HTTPS 地址或 PNG / JPEG / WebP；本机图片约500 KB以内。</small>';
  const image=`${imageUrlField}<label class="decor-field bd-field"><span>或从本机选择图片</span><input type="file" accept="image/png,image/jpeg,image/webp" ${disabled} onchange="SiyueBusinessDecor.upload(this)">${imageHint}${block.image?`<button type="button" class="btn small" ${disabled} onclick="SiyueBusinessDecor.input(${esc(JSON.stringify(['blocks',name,'image']))},'','string')">移除图片</button>`:''}<span id="bd-upload-state" class="bd-upload-state" aria-live="polite"></span></label>`;
  const courses=name==='课程展示'?`<fieldset class="decor-field bd-fieldset" ${disabled}><legend>展示课程</legend>${visibleCourses(ctx).map(course=>{const included=!Array.isArray(block.courseIds)||block.courseIds.includes(course.id);return `<label class="decor-module bd-module-toggle"><input type="checkbox" ${included?'checked':''} ${disabled} onchange="SiyueBusinessDecor.setCourse(${quote(course.id)},this.checked)"><span>${esc(course.storefront?.content?.title||course.name||'课程')}</span></label>`}).join('')||'<p class="muted">没有当前账号可见的已上架课程。</p>'}${Array.isArray(block.courseIds)?'<button type="button" class="btn small" '+disabled+' onclick="SiyueBusinessDecor.useAllCourses()">显示全部上架课程</button>':''}</fieldset>`:'';
  const index=draft.modules.indexOf(name);
  return `${fields}${action}${image}${courses}<div class="decor-reorder bd-reorder"><button type="button" class="btn small" ${disabled||index<=0?'disabled':''} onclick="SiyueBusinessDecor.move(-1)">上移</button><button type="button" class="btn small" ${disabled||index<0||index>=draft.modules.length-1?'disabled':''} onclick="SiyueBusinessDecor.move(1)">下移</button><button type="button" class="btn small" ${disabled||index<0?'disabled':''} onclick="SiyueBusinessDecor.setModule(${quote(name)},false)">隐藏区块</button></div>`;
 }
 function renderForm(ctx){
  if(!ctx?.operation?.id?.startsWith('store.design.'))return null;
  const current=ctx.draft?.decor??ctx.data?.decor?.draft??ctx.data?.decor?.published??defaultTemplate(),draft=normalize(current),canEdit=!ctx.disabled;
  if(view.selected!=='page'&&!draft.blocks[view.selected])view.selected='page';
  return `<div class="bd-form-editor"><div class="decor-section-tabs bd-form-tabs"><button type="button" class="btn small ${view.selected==='page'?'primary':''}" ${canEdit?'':'disabled'} onclick="SiyueBusinessDecor.select('page')">页面设置</button>${draft.modules.map(name=>`<button type="button" class="btn small ${view.selected===name?'primary':''}" ${canEdit?'':'disabled'} onclick="SiyueBusinessDecor.select(${quote(name)})">${esc(name)}</button>`).join('')}</div><div class="decor-layout bd-editor-layout"><section class="decor-stage bd-editor-stage"><div class="decor-device-label bd-device-label">iPhone 17 <span>· 点击区块切换设置</span></div><div id="decor-preview" class="bd-preview">${phone(ctx,draft,canEdit)}</div></section><aside class="card decor-inspector bd-inspector">${formBlockEditor(ctx,draft)}</aside></div></div>`;
 }
 function input(path,value,type){if(root.businessAPI?.input)root.businessAPI.input(['decor',...path],value,type);if(path.length===3&&path[0]==='blocks'&&path[2]==='image'){const field=root.document?.querySelector?.('.bd-image-url');if(field&&field.value!==String(value??''))field.value=String(value??'')}refreshForm()}
 function upload(control){
  const file=control?.files?.[0];if(!file)return false;
  const announce=message=>{const node=root.document?.querySelector?.('#bd-upload-state');if(node)node.textContent=message};
  const ctx=root.businessAPI?.academicDraft?.(),name=view.selected,operationId=ctx?.operation?.id;
  if(ctx?.disabled||operationId!=='store.design.save'||name==='page'||!ctx?.draft?.decor?.blocks?.[name]){announce('当前页面不可编辑图片');return false}
  if(!['image/png','image/jpeg','image/webp'].includes(file.type)){announce('请选择 PNG、JPEG 或 WebP 图片');return false}
  if(!Number.isFinite(Number(file.size))||Number(file.size)>524000){announce('图片文件过大，请压缩后重试');return false}
  const Reader=root.FileReader;if(typeof Reader!=='function'){announce('当前环境无法读取本地图片');return false}
  const reader=new Reader();reader.onload=()=>{
   const result=reader.result,current=root.businessAPI?.academicDraft?.();
   if(current?.disabled||current?.operation?.id!==operationId||view.selected!==name||!current?.draft?.decor?.blocks?.[name]){announce('页面已切换，本次图片没有写入');return}
   if(typeof result!=='string'||result.length>700000||!validImage(result)||!result.startsWith(`data:${file.type};base64,`)){announce('图片格式或大小不符合要求');return}
   input(['blocks',name,'image'],result,'string');announce('图片已加入当前草稿，请预览并保存');
  };reader.onerror=()=>announce('读取图片失败，请重试');reader.readAsDataURL(file);return true;
 }
 function refreshForm(){const host=root.document?.querySelector?.('.bd-form-editor');if(!host)return;const value=currentDraft();if(value) {const ctx=root.businessAPI?.academicDraft?.();const preview=host.querySelector('.bd-preview');if(preview)preview.innerHTML=phone({data:ctx?.data||{}},normalize(value),true);}}
 function edit(which){const ctx=root.businessAPI?.snapshot?.()||{},data=ctx.decor||{};const source=which==='published'?data.published:data.draft||data.published;return root.businessAPI?.open?.('store.design.save',{decor:clone(source||defaultTemplate())})||false}
 function useTemplate(){return root.businessAPI?.open?.('store.design.save',{decor:defaultTemplate()})||false}
 function publishDraft(){const record=root.businessAPI?.snapshot?.()?.decor;if(!record?.draft)return false;return root.businessAPI?.open?.('store.design.publish',{decor:clone(record.draft)})||false}
 function previewMode(value){if(!['draft','published'].includes(value))return false;view.preview=value;repaint();return true}
 function useAllCourses(){const ids=visibleCourses({data:root.businessAPI?.academicDraft?.()?.data||{}}).map(c=>c.id);setValue(['blocks','课程展示','courseIds'],ids,'array')}
 function editSelected(){const ctx=root.businessAPI?.snapshot?.()||{},record=ctx.decor||{},source=record.draft||record.published||defaultTemplate();return root.businessAPI?.open?.('store.design.save',{decor:clone(source)})||false}
 function reset(){view.selected='page';view.preview='draft'}
 root.SiyueBusinessDecor={renderPage,renderForm,reset,select,edit,editSelected,useTemplate,publishDraft,previewMode,input,upload,move,setModule,setCourse,useAllCourses,refreshForm,defaultTemplate};
})(typeof window!=='undefined'?window:globalThis);
