/* A record opens one compact action panel. All financial writes use the shared payment handler. */
const financeQuickState={orderId:null,mode:'actions'};
function financeQuickCanView(){return permissionCanVisit('financeArrears')}
function financeQuickOrder(id){return a.orders.find(o=>o.id===id)}
function financeQuickClose(){document.querySelector('#finance-quick-panel')?.remove();financeQuickState.orderId=null;financeQuickState.mode='actions'}
function financeQuickIcon(kind){
 const paths={payment:'<path d="M3 7h18v13H3zM3 11h18M7 16h4M7 3v4m10-4v4"/>',qr:'<path d="M3 3h6v6H3zM15 3h6v6h-6zM3 15h6v6H3zM15 15h3v3h3v3h-6zM21 12v3M12 3v3M12 12h3M3 12h3"/>',close:'<path d="m6 6 12 12M6 18 18 6"/>'};
 return `<svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[kind]||''}</svg>`;
}
function financeQuickRowKey(event,id){if(event.key==='Enter'||event.key===' '){event.preventDefault();financeOpenQuickActions(id)}}
function financeOpenQuickActions(id){
 if(!financeQuickCanView()){toast('当前身份无权查看欠费记录');return}
 const order=financeQuickOrder(id);if(!order||!workflowOrderOutstanding(order)){toast('该订单已收清或已关闭，请刷新列表');return}
 financeQuickState.orderId=id;financeQuickState.mode='actions';financeQuickRender();
}
function financeQuickShowPaymentQR(id){
 if(id!==financeQuickState.orderId||!financeQuickCanView()){toast('请重新选择有权查看的订单');return}
 const order=financeQuickOrder(id);if(!order||!workflowOrderOutstanding(order)){financeQuickClose();toast('订单已收清或已关闭，无需出示付款二维码');return}
 financeQuickState.mode='qr';financeQuickRender();
}
function financeQuickShowActions(id){if(id!==financeQuickState.orderId||!financeQuickCanView())return;financeQuickState.mode='actions';financeQuickRender()}
function financeQuickConfirmPaid(id){
 if(!financeQuickCanView()||!workflowMay('payment')){toast('当前身份无确认到账权限');return}
 const order=financeQuickOrder(id);
 if(id!==financeQuickState.orderId||!order||!workflowOrderOutstanding(order)){toast('订单已变化，请重新打开记录');return}
 workflowSimulatePayment(id);
 const updated=financeQuickOrder(id);
 if(updated&&updated.paymentState==='已支付'&&!workflowOrderOutstanding(updated))financeQuickClose();else financeQuickRender();
}
function financeQuickReference(id){let n=2166136261;for(const c of String(id))n=Math.imul(n^c.charCodeAt(0),16777619);return (n>>>0).toString(16).toUpperCase().padStart(8,'0')}
function financeQuickQRPayload(id){return `SIYUE DEMO / NOT FOR PAYMENT / ${financeQuickReference(id)}`}

// Standards-based byte-mode QR, version 3-L, mask 0: one 55-data/15-parity block.
// Payload is ASCII demo text plus an opaque reference. No customer data or payment URL is encoded.
function financeQuickQRMatrix(text){
 const bytes=Array.from(String(text),c=>c.charCodeAt(0));if(bytes.length>53||bytes.some(x=>x>127))throw Error('二维码演示内容超出支持范围');
 const bits=[],append=(value,length)=>{for(let i=length-1;i>=0;i--)bits.push((value>>>i)&1)};
 append(4,4);append(bytes.length,8);bytes.forEach(x=>append(x,8));append(0,Math.min(4,440-bits.length));while(bits.length%8)bits.push(0);
 const data=[];for(let i=0;i<bits.length;i+=8)data.push(bits.slice(i,i+8).reduce((v,b)=>v*2+b,0));for(let i=0;data.length<55;i++)data.push(i%2?0x11:0xec);
 const multiply=(x,y)=>{let z=0;for(let i=7;i>=0;i--){z=(z<<1)^((z>>>7)*0x11d);z^=((y>>>i)&1)*x}return z};
 const generator=Array(15).fill(0);generator[14]=1;let root=1;
 for(let i=0;i<15;i++){for(let j=0;j<15;j++){generator[j]=multiply(generator[j],root);if(j<14)generator[j]^=generator[j+1]}root=multiply(root,2)}
 const parity=Array(15).fill(0);for(const byte of data){const factor=byte^parity.shift();parity.push(0);for(let i=0;i<15;i++)parity[i]^=multiply(generator[i],factor)}
 const codewords=data.concat(parity),size=29,matrix=Array.from({length:size},()=>Array(size).fill(false)),fixed=Array.from({length:size},()=>Array(size).fill(false));
 const set=(x,y,dark)=>{if(x>=0&&x<size&&y>=0&&y<size){matrix[y][x]=!!dark;fixed[y][x]=true}};
 for(let i=0;i<size;i++){set(6,i,i%2===0);set(i,6,i%2===0)}
 for(const [cx,cy] of [[3,3],[25,3],[3,25]])for(let y=-4;y<=4;y++)for(let x=-4;x<=4;x++){const d=Math.max(Math.abs(x),Math.abs(y));set(cx+x,cy+y,d!==2&&d!==4)}
 for(let y=-2;y<=2;y++)for(let x=-2;x<=2;x++)set(22+x,22+y,Math.max(Math.abs(x),Math.abs(y))!==1);
 const formatData=8;let remainder=formatData;for(let i=0;i<10;i++)remainder=(remainder<<1)^((remainder>>>9)*0x537);const format=((formatData<<10)|remainder)^0x5412;
 const formatBit=i=>((format>>>i)&1)!==0;
 for(let i=0;i<=5;i++)set(8,i,formatBit(i));set(8,7,formatBit(6));set(8,8,formatBit(7));set(7,8,formatBit(8));for(let i=9;i<15;i++)set(14-i,8,formatBit(i));
 for(let i=0;i<8;i++)set(size-1-i,8,formatBit(i));for(let i=8;i<15;i++)set(8,size-15+i,formatBit(i));set(8,size-8,true);
 let at=0;for(let right=size-1;right>=1;right-=2){if(right===6)right=5;for(let vertical=0;vertical<size;vertical++){const y=((right+1)&2)===0?size-1-vertical:vertical;for(let j=0;j<2;j++){const x=right-j;if(fixed[y][x])continue;const bit=at<codewords.length*8?((codewords[at>>>3]>>>(7-(at&7)))&1):0;matrix[y][x]=!!(bit^((x+y)%2===0?1:0));at++}}}
 return matrix;
}
function financeQuickQRSvg(id){const matrix=financeQuickQRMatrix(financeQuickQRPayload(id)),path=matrix.flatMap((row,y)=>row.map((dark,x)=>dark?`M${x+4} ${y+4}h1v1h-1z`:'')).join('');return `<svg class="finance-demo-qr" role="img" aria-label="当前订单演示二维码，不能真实收款" viewBox="0 0 37 37" shape-rendering="crispEdges"><rect width="37" height="37" fill="#fff"/><path d="${path}" fill="#172942"/></svg>`}
function financeQuickRender(){
 document.querySelector('#finance-quick-panel')?.remove();
 if(!financeQuickCanView()){financeQuickState.orderId=null;return}
 const order=financeQuickOrder(financeQuickState.orderId);if(!order){financeQuickState.orderId=null;return}
 const id=esc(JSON.stringify(order.id)),outstanding=workflowOrderOutstanding(order),canPay=workflowMay('payment'),due=Math.max(0,money(order.amount)-money(order.paid));
 const summary=`<div class="finance-quick-order"><strong>${esc(order.student||'未关联学员')}</strong><span>${esc(order.product||'报名订单')}</span><small>${esc(order.id)}</small></div><div class="finance-quick-totals"><div><span>应收</span><strong>¥${money(order.amount).toFixed(2)}</strong></div><div><span>实收</span><strong>¥${money(order.paid).toFixed(2)}</strong></div><div><span>剩余待收</span><strong>¥${due.toFixed(2)}</strong></div></div>`;
 const qr=financeQuickState.mode==='qr';
 const content=!outstanding?'<p class="notice">订单已收清或已关闭。</p>':qr?`<div class="finance-quick-qr"><span class="finance-demo-label">演示二维码 · 不能真实收款</span>${financeQuickQRSvg(order.id)}<span class="muted">演示单号 ${financeQuickReference(order.id)}</span><p class="help">扫码仅显示本单演示标识，不会打开支付或产生到账。</p></div>`:`<div class="finance-quick-actions">${canPay?`<button class="btn primary" onclick="financeQuickConfirmPaid(${id})">${financeQuickIcon('payment')}<span>确认已付费（模拟）</span></button>`:''}<button class="btn" onclick="financeQuickShowPaymentQR(${id})">${financeQuickIcon('qr')}<span>付款二维码</span></button></div><p class="help">${canPay?'确认后登记本单剩余款项到账，并同步报名名单。仅限原型模拟。':'当前身份可查看二维码；确认到账需财务或管理员权限。'}</p>`;
 const back=qr?`<button class="btn finance-quick-back" onclick="financeQuickShowActions(${id})"><svg class="back-icon" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><use href="#ui-back-arrow"></use></svg><span>返回操作</span></button>`:'';
 document.body.insertAdjacentHTML('beforeend',`<div class="modal-backdrop" id="finance-quick-panel" onclick="if(event.target===this)financeQuickClose()" onkeydown="if(event.key==='Escape')financeQuickClose()"><section class="modal finance-quick-modal" role="dialog" aria-modal="true" aria-labelledby="finance-quick-title"><div class="modal-head"><h2 id="finance-quick-title">${qr?'付款二维码':'欠费快捷操作'}</h2><button class="btn finance-quick-close" aria-label="关闭" onclick="financeQuickClose()">${financeQuickIcon('close')}</button></div>${summary}${content}${back}</section></div>`);
 document.querySelector('#finance-quick-panel .finance-quick-close')?.focus?.();
}
financeArrearsPage=function(){
 const unpaid=a.orders.filter(workflowOrderOutstanding),sum=unpaid.reduce((n,o)=>n+money(o.amount)-money(o.paid),0);
 return `<div class="structure-summary"><div class="card"><strong>${unpaid.length}</strong><span>欠费订单</span></div><div class="card"><strong>¥${sum.toFixed(2)}</strong><span>待收金额</span></div></div><div class="card pad finance-arrears">${aTable(['订单编号','学生','课程','应收','实收','待收','状态'],unpaid.map(o=>{const id=esc(JSON.stringify(o.id));return `<tr class="finance-action-row" tabindex="0" role="button" aria-label="${esc(o.student||'学员')}，${esc(o.product||'订单')}，打开欠费快捷操作" onclick="financeOpenQuickActions(${id})" onkeydown="financeQuickRowKey(event,${id})"><td>${esc(o.id)}</td><td>${esc(o.student)}</td><td>${esc(o.product)}</td><td>${esc(o.amount)}</td><td>${esc(o.paid)}</td><td class="finance-due">¥${(money(o.amount)-money(o.paid)).toFixed(2)}</td><td>${esc(o.paymentState||o.status)}</td></tr>`}))}${unpaid.length?'':'<div class="empty">暂无欠费订单</div>'}<div class="data-bar">共 ${unpaid.length} 条欠费订单</div></div>`;
};
