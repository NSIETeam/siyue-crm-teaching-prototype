/* Link readable entity names to the existing, permission-checked detail views. */
(function(root){
 'use strict';
 const escapeAttr=value=>String(value??'');
 const kindPage={student:'studentDetail',course:'course',classes:'classes',campus:'campus',teacher:'teacherArchives',staff:'staffArchives'};
 const kindTitle={student:'学员档案',course:'课程详情',classes:'班级详情',campus:'校区详情',teacher:'教师档案',staff:'员工档案'};
 const entityName=row=>String(row?.name||row?.title||'').trim();
 const entityId=row=>String(row?.id||row?.leadId||'');
 const canVisit=page=>typeof root.permissionCanVisit==='function'&&root.permissionCanVisit(page);
 function legacyState(){try{return typeof state!=='undefined'?state:{}}catch{return {}}}
 function legacyAcademic(){try{return typeof a!=='undefined'?a:{}}catch{return {}}}
 function snapshot(){try{return root.businessAPI?.snapshot?.()||{}}catch{return {}}}
 function rowsFor(kind){const data=snapshot(),legacy=legacyAcademic();const plural={student:'students',course:'courses',classes:'classes',campus:'campuses'}[kind];if(!plural)return[];const current=data[plural];if(Array.isArray(current)&&current.length)return current;if(kind==='campus')return legacyState().campuses||[];return legacy[plural]||[]}
 function add(targets,kind,rows,permission){
  if(!canVisit(permission))return;
  for(const row of Array.isArray(rows)?rows:[]){const name=entityName(row),id=entityId(row);if(name.length<2||!id)continue;
   const key=kind+'\0'+id,existing=targets.get(name)||new Map();existing.set(key,{kind,id,name,row});targets.set(name,existing);
  }
 }
 function inventory(){
  if(root.SIYUE_JAVA_AUTH_MODE)return new Map();
  const data=snapshot(),out=new Map();
  add(out,'student',rowsFor('student'),'studentDetail');
  add(out,'course',rowsFor('course'),'course');
  add(out,'classes',rowsFor('classes'),'classes');
  add(out,'campus',rowsFor('campus'),'campus');
  if(typeof root.profileQuickCanArchive==='function'){
   if(root.profileQuickCanArchive('teacher')){
    const teachers=typeof root.profileQuickTeacherList==='function'?root.profileQuickTeacherList():[];
    for(const row of teachers){const name=entityName(row),key=typeof root.profileQuickTeacherKey==='function'?root.profileQuickTeacherKey(row):'';if(name.length<2||!key)continue;const map=out.get(name)||new Map();map.set('teacher\0'+key,{kind:'teacher',id:key,name,row});out.set(name,map)}
   }
   if(root.profileQuickCanArchive('staff'))for(const row of legacyState().staff||[]){const name=entityName(row),key=typeof root.profileQuickStaffKey==='function'?root.profileQuickStaffKey(row):entityId(row);if(name.length<2||!key)continue;const map=out.get(name)||new Map();map.set('staff\0'+key,{kind:'staff',id:key,name,row});out.set(name,map)}
  }
  return out;
 }
 function rowContext(node){
  const row=node.parentElement?.closest('tr');if(!row)return null;
  const profileRow=row.closest('[data-profile-kind][data-profile-key]');
  if(profileRow){let key=profileRow.dataset.profileKey;try{key=decodeURIComponent(key)}catch{}const kind=profileRow.dataset.profileKind;return {kind,id:kind==='teacher'?key:key.replace(/^id:/,'')}}
  const handler=row.getAttribute('onclick')||'';
  let match=handler.match(/businessAPI\.expand\('(courses|classes|campuses|students)',\s*(\d+)\)/);
  if(match){const kind=({courses:'course',classes:'classes',campuses:'campus',students:'student'})[match[1]],record=rowsFor(kind)[Number(match[2])];if(record)return {kind,id:entityId(record)}}
  match=handler.match(/a\.selectedStudent\s*=\s*(\d+)/);if(match){const record=legacyAcademic().students?.[Number(match[1])];if(record)return {kind:'student',id:entityId(record)}}
  return null;
 }
 function resolve(name,map,node){
  const candidates=[...(map.get(name)?.values()||[])];if(!candidates.length)return null;if(candidates.length===1)return candidates[0];
  const context=rowContext(node);if(context){const matches=candidates.filter(x=>x.kind===context.kind&&x.id===context.id);if(matches.length===1)return matches[0]}
  const row=node.parentElement?.closest('tr'),text=row?.textContent||'';if(row){const matches=candidates.filter(x=>{const id=String(x.row?.id||'');const phone=String(x.row?.phone||x.row?.contactPhone||'');return id.length>=5&&text.includes(id)||phone.length>=7&&text.includes(phone)});if(matches.length===1)return matches[0]}
  return null;
 }
 function boundary(char){return !char||/[\s:：,，;；、·|/()\[\]{}（）【】<>《》—–-]/u.test(char)}
 function findMatch(text,start,map){
  let best=null;
  for(const name of map.keys()){
   let at=text.indexOf(name,start);
   while(at>=0){const end=at+name.length;if(boundary(text[at-1])&&boundary(text[end])){const hit={at,end,name};if(!best||hit.at<best.at||hit.at===best.at&&hit.name.length>best.name.length)best=hit;break}at=text.indexOf(name,at+1)}
  }
  return best;
 }
 const skip='a,button,input,select,textarea,option,script,style,summary,[contenteditable="true"],[data-entity-links-disabled],[data-siyue-entity-link]';
 function linkNode(node,map){
  const parent=node.parentElement;if(!parent||parent.closest(skip)||!node.nodeValue?.trim())return;
  const text=node.nodeValue,fragment=root.document.createDocumentFragment();let cursor=0,changed=false;
  while(cursor<text.length){const hit=findMatch(text,cursor,map);if(!hit){fragment.append(root.document.createTextNode(text.slice(cursor)));break}
   const target=resolve(hit.name,map,node);if(!target){fragment.append(root.document.createTextNode(text.slice(cursor,hit.end)));cursor=hit.end;continue}
   if(hit.at>cursor)fragment.append(root.document.createTextNode(text.slice(cursor,hit.at)));
   const button=root.document.createElement('button');button.type='button';button.className='sy-entity-link';button.dataset.siyueEntityLink='true';button.dataset.entityKind=target.kind;button.dataset.entityId=escapeAttr(target.id);button.setAttribute('aria-label','查看'+kindTitle[target.kind]+'：'+target.name);button.textContent=target.name;fragment.append(button);cursor=hit.end;changed=true;
  }
  if(changed)node.replaceWith(fragment);
 }
 function decorate(){
  const view=root.document.querySelector('#view');if(!view||root.SIYUE_JAVA_AUTH_MODE)return;
  const map=inventory();if(!map.size)return;
  const walker=root.document.createTreeWalker(view,root.NodeFilter.SHOW_TEXT);const nodes=[];while(walker.nextNode())nodes.push(walker.currentNode);for(const node of nodes)linkNode(node,map);
 }
 function open(target){
  const {kind,id}=target,page=kindPage[kind];if(!page||!canVisit(page)){root.toast?.('当前账号没有查看此资料的权限');return false}
  if(kind==='student'){
   if(root.businessAPI?.showStudent?.(id))return true;
   const token=encodeURIComponent(id).replace(/'/g,'%27');return root.profileQuickStudentArchive?.(token)||false;
  }
  if(kind==='teacher'||kind==='staff'){
   const token=encodeURIComponent(id).replace(/'/g,'%27'),fn=kind==='teacher'?root.profileQuickTeacherArchive:root.profileQuickStaffArchive;return typeof fn==='function'?fn(token):false;
  }
  const plural={course:'courses',classes:'classes',campus:'campuses'}[kind],rows=rowsFor(kind),index=rows.findIndex(row=>entityId(row)===id);if(index<0){root.toast?.('资料已变化，请刷新后重试');return false}
  const nav=root.businessAPI?.navigate;if(typeof nav!=='function'||!nav(page))return false;
  const tableKind=plural;root.businessAPI.expand(tableKind,index);
  (root.requestAnimationFrame||((fn)=>setTimeout(fn,0)))(()=>{const details=root.document.querySelector('#view .bp-expanded details');if(details){details.open=true;details.scrollIntoView?.({block:'nearest'})}});
  return true;
 }
 root.document.addEventListener('click',event=>{const button=event.target.closest?.('[data-siyue-entity-link]');if(!button)return;event.preventDefault();event.stopPropagation();open({kind:button.dataset.entityKind,id:button.dataset.entityId})},true);
 let queued=false;const observer=new MutationObserver(()=>{if(queued)return;queued=true;queueMicrotask(()=>{queued=false;decorate()})});
 const start=()=>{const view=root.document.querySelector('#view');if(view)observer.observe(view,{childList:true,subtree:true});decorate()};
 if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',start,{once:true});else start();
 root.SiyueEntityLinks={refresh:decorate,open};
})(window);
