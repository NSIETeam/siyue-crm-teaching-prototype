/* Keep existing action nodes and authorization; open them from the row. */
(function(){
 'use strict';
 const interactive='a,button,input,select,textarea,summary,[contenteditable="true"],[role="button"],[role="link"]';
 function prepare(table){
  const head=table.tHead?.rows[0]||[...table.rows].find(r=>r.querySelector('th'));
  if(!head||table.tHead?.rows.length>1)return;
  const headers=[...head.cells],indexes=headers.flatMap((c,i)=>/^操作$/.test(c.textContent.trim())?[i]:[]);
  if(!indexes.length)return;
  const textIndexes=indexes.filter(i=>[...table.rows].some(r=>r!==head&&r.cells.length===headers.length&&r.cells[i]?.textContent.trim().replace(/[—\s-]/g,''))&&![...table.rows].some(r=>r!==head&&r.cells.length===headers.length&&r.cells[i]?.querySelector('button,a,input,select,textarea')));for(const i of textIndexes)headers[i].textContent='操作内容';for(const i of textIndexes)indexes.splice(indexes.indexOf(i),1);if(!indexes.length)return;
  const count=headers.length;
  for(const row of [...table.rows]){
   if(row===head)continue;
   if(row.cells.length!==count){for(const c of row.cells)if(c.colSpan===count)c.colSpan=count-indexes.length;continue}
   const cells=indexes.map(i=>row.cells[i]);
   const actions=document.createElement('div');actions.className='sy-row-action-content';
   for(const cell of cells){actions.append(...cell.childNodes);cell.remove()}
   const controls=[...actions.querySelectorAll('button,a,input,select,textarea')];
   if(!controls.length&&!actions.textContent.trim().replace(/[—\s-]/g,''))continue;
   const detail=document.createElement('tr');detail.className='sy-row-action-detail';detail.hidden=true;
   const cell=document.createElement('td');cell.colSpan=count-indexes.length;cell.append(actions);detail.append(cell);row.after(detail);
   const close=document.createElement('button');close.type='button';close.className='btn small sy-row-action-close';close.textContent='收起';close.addEventListener('click',()=>{detail.hidden=true;row.setAttribute('aria-expanded','false');row.focus()});actions.append(close);
   row.classList.add('sy-row-action-trigger');if(!row.hasAttribute('tabindex'))row.tabIndex=0;
   row.setAttribute('aria-label','查看本行详情或操作');row.setAttribute('aria-expanded',controls.find(c=>c.hasAttribute('aria-expanded'))?.getAttribute('aria-expanded')||'false');
   function open(event){
    if(event.target!==row&&event.target.closest(interactive))return;
    if(event.type==='click'&&window.getSelection()?.toString())return;
    event.preventDefault();event.stopImmediatePropagation();
    const primary=controls.length===1&&controls[0].matches('button,a')&&/^(查看详情|详情|展开|收起|操作\s*↗?)$/.test(controls[0].textContent.trim())?controls[0]:null;
    if(primary&&!primary.disabled){primary.click();return}
    // Existing row detail handlers already expose their record-specific actions.
    if(typeof row.onclick==='function'){row.onclick.call(row,event);return}
    detail.hidden=!detail.hidden;row.setAttribute('aria-expanded',String(!detail.hidden));
   }
   row.addEventListener('click',open,true);
   row.addEventListener('keydown',event=>{if(event.target===row&&['Enter',' '].includes(event.key))open(event)});
  }
  for(const i of indexes.toReversed())headers[i].remove();
  const group=table.querySelector(':scope>colgroup');if(group)for(const i of indexes.toReversed())group.children[i]?.remove();
  delete table.dataset.syLayout;
 }
 let pending=false;
 function refresh(){pending=false;document.querySelectorAll('table').forEach(table=>{prepare(table);const head=table.tHead?.rows[0]||[...table.rows].find(r=>r.querySelector('th'));if(!head||table.tHead?.rows.length>1)return;const columns=[...head.cells].reduce((n,c)=>n+c.colSpan,0);for(const row of table.rows){if(row!==head&&row.cells.length===1&&row.cells[0].colSpan>1&&row.cells[0].colSpan!==columns)row.cells[0].colSpan=columns;}})}
 new MutationObserver(()=>{if(!pending){pending=true;queueMicrotask(refresh)}}).observe(document.body,{childList:true,subtree:true});refresh();
})();
