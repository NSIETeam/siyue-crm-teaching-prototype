const assert=require('node:assert/strict'),crypto=require('node:crypto'),boot=require('./runtime.cjs');
let count=0;function test(name,fn){fn();count++;console.log('PASS '+name)}
function fixture(){
 const b=boot();assert.equal(b.run('typeof financeOpenQuickActions'),'function','finance quick-action script must be loaded by index.html');
 b.panels=[];b.ctx.document.body.insertAdjacentHTML=(position,html)=>b.panels.push(html);
 b.run(`permissionState.identity='admin';state.page='financeArrears';state.mode='list';a.courses=[{id:'course',name:'演示课程',active:true,lessons:[{id:'l1'}]}];a.classes=[{id:'c1',name:'演示班',course:'演示课程',courseId:'course',date:'2099-01-01',time:'09:00–10:00',capacity:10,students:0,studentIds:[]},{id:'c2',name:'另一班',course:'演示课程',courseId:'course',date:'2099-01-01',time:'11:00–12:00',capacity:10,students:0,studentIds:[]}];a.students=[{id:'s1',name:'学生甲',phone:'13900000101',status:'潜在',className:'—',classIds:[]},{id:'s2',name:'学生乙',phone:'13900000102',status:'潜在',className:'—',classIds:[]}];a.orders=[{id:'order-a',studentId:'s1',student:'学生甲',classId:'c1',product:'演示课程',amount:'¥1000.00',paid:'¥200.00',paymentState:'待支付',entitlementState:'未生效',status:'等待付款',originLeadId:'lead-a'},{id:'order-b',studentId:'s2',student:'学生乙',classId:'c2',product:'演示课程',amount:'¥800.00',paid:'¥0.00',paymentState:'待支付',entitlementState:'未生效',status:'等待付款'}];a.attendance=[];a.refunds=[];a.sessionAdjustments=[];leadState.leads=[{leadId:'lead-a',name:'学生甲',owner:'王敏',stage:'跟进中',status:'following',history:[]}];Object.assign(financeQuickState,{orderId:null,expandedOrderId:null,mode:'actions',reviewSignature:null});`);
 return b;
}
function snapshot(b){return b.run('JSON.stringify(auditBusinessSnapshot())')}
function view(b){return b.elements.get('#view').innerHTML}

test('clicking any arrears cell or keyboard toggles exactly one inline action row without a modal',()=>{
 const b=fixture(),html=b.run('financeArrearsPage()');assert.equal((html.match(/class="finance-action-row/g)||[]).length,2);assert.equal((html.match(/role="button"/g)||[]).length,2);assert(html.includes('financeOpenQuickActions(&quot;order-a&quot;)'));assert(html.includes('financeQuickRowKey(event,&quot;order-b&quot;)'));
 let prevented=false;b.ctx.testKey={key:'Enter',preventDefault(){prevented=true}};b.run("financeQuickRowKey(testKey,'order-a')");assert(prevented);assert.equal(b.run('financeQuickState.expandedOrderId'),'order-a');assert.equal(b.run('state.page'),'financeArrears');assert.match(view(b),/colspan="7"/);assert.equal((view(b).match(/class="finance-inline-row"/g)||[]).length,1);assert.equal(b.panels.length,0);
 b.run("financeOpenQuickActions('order-a')");assert.equal(b.run('financeQuickState.expandedOrderId'),null);assert(!view(b).includes('class="finance-inline-row"'));
 b.run("financeOpenQuickActions('order-a')");b.ctx.testKey={key:' ',preventDefault(){prevented=true}};b.run("financeQuickRowKey(testKey,'order-b')");assert.equal(b.run('financeQuickState.expandedOrderId'),'order-b');assert.equal((view(b).match(/class="finance-inline-row"/g)||[]).length,1);assert(!view(b).includes('financeQuickReviewPayment(&quot;order-a&quot;)'));assert(view(b).includes('financeQuickReviewPayment(&quot;order-b&quot;)'));
});

test('payment opens a routed amount review and stale selection or changed amounts cannot be submitted silently',()=>{
 const b=fixture();b.run("financeOpenQuickActions('order-a')");const before=snapshot(b);b.run("financeQuickConfirmPaid('order-a')");assert.equal(snapshot(b),before);b.run("financeQuickReviewPayment('order-a')");assert.equal(b.run('state.page'),'financePayment');assert.equal(b.run('financeQuickState.mode'),'review');assert.equal(snapshot(b),before);
 for(const text of ['学生甲','order-a','¥1000.00','¥200.00','¥800.00','确认到账（模拟）'])assert(view(b).includes(text),text);assert(!view(b).includes('modal-backdrop'));assert.equal(b.panels.length,0);
 b.run("a.orders[0].paid='¥300.00'");const changed=snapshot(b);b.run("financeQuickConfirmPaid('order-a')");assert.equal(snapshot(b),changed);assert(b.messages.at(-1).includes('已变化'));assert(view(b).includes('¥700.00'));
 b.run("financeQuickShowActions('order-a');financeOpenQuickActions('order-b')");assert.equal(b.run('state.page'),'financeArrears');const switched=snapshot(b);b.run("financeQuickReviewPayment('order-a');financeQuickShowPaymentQR('order-a');financeQuickConfirmPaid('order-a')");assert.equal(snapshot(b),switched);assert.equal(b.run('financeQuickState.orderId'),'order-b');assert.equal(b.run('financeQuickState.mode'),'actions');
});

test('reviewed prototype payment uses the shared order, roster, student, and lead workflow exactly once',()=>{
 const b=fixture();b.run("financeOpenQuickActions('order-a');financeQuickReviewPayment('order-a');financeQuickConfirmPaid('order-a')");assert.equal(b.run('a.orders[0].paid'),'¥1000.00');assert.equal(b.run('a.orders[0].paymentState'),'已支付');assert.equal(b.run('a.orders[0].entitlementState'),'已生效');assert.equal(b.run('a.students[0].classIds[0]'),'c1');assert.equal(b.run('a.classes[0].students'),1);assert.equal(b.run('leadState.leads[0].stage'),'已报名');assert.equal(b.run('financeQuickState.mode'),'paid');assert.equal(b.run('state.page'),'financePayment');assert(view(b).includes('模拟到账已确认'));assert.equal(b.run('a.orders[1].paid'),'¥0.00');
 const after=snapshot(b);b.run("financeQuickConfirmPaid('order-a');financeOpenQuickActions('order-a')");assert.equal(snapshot(b),after);const reload=boot(b.storage);assert.equal(reload.run('a.orders[0].paid'),'¥1000.00');assert.equal(reload.run('a.classes[0].students'),1);
});

test('view-only arrears access permits the QR route but never grants payment review or confirmation',()=>{
 const b=fixture();b.run("permissionState.identity='manager';permissionRole().grants=['financeArrears'];render();financeOpenQuickActions('order-a')");assert(view(b).includes('付款二维码'));assert(!view(b).includes('financeQuickReviewPayment('));
 const before=snapshot(b);b.run("financeQuickShowPaymentQR('order-a');financeQuickReviewPayment('order-a');financeQuickConfirmPaid('order-a')");assert.equal(snapshot(b),before);assert.equal(b.run('financeQuickState.mode'),'qr');assert.equal(b.run('state.page'),'financePayment');assert(view(b).includes('不能真实收款'));
 b.run("permissionRole().grants=[];financeQuickShowActions('order-a');financeQuickShowPaymentQR('order-a');financeQuickConfirmPaid('order-a');render()");assert.equal(snapshot(b),before);assert(view(b).includes('无权限'));
 const unauthorized=fixture();unauthorized.run("permissionState.identity='sales';financeOpenQuickActions('order-a')");assert.equal(unauthorized.run('financeQuickState.orderId'),null);assert.equal(unauthorized.panels.length,0);
});

test('closed orders and changed financial permissions cannot be confirmed from an already open review',()=>{
 const b=fixture();b.run("financeOpenQuickActions('order-a');financeQuickReviewPayment('order-a');a.orders[0].entitlementState='已退课';a.orders[0].paymentState='已取消'");const before=snapshot(b);b.run("financeQuickConfirmPaid('order-a');financeQuickShowPaymentQR('order-a')");assert.equal(snapshot(b),before);assert.equal(b.run('financeQuickState.orderId'),null);assert(!b.run('financeArrearsPage()').includes('order-a'));
 const f=fixture();f.run("permissionState.identity='finance';render();financeOpenQuickActions('order-a');financeQuickReviewPayment('order-a');permissionRole().grants=['financeArrears']");const original=snapshot(f);f.run("financeQuickConfirmPaid('order-a')");assert.equal(snapshot(f),original);
});

test('capacity and storage failures retain the review and cannot display successful receipt',()=>{
 const full=fixture();full.run("a.classes[0].capacity=0;financeOpenQuickActions('order-a');financeQuickReviewPayment('order-a')");const before=snapshot(full);full.run("financeQuickConfirmPaid('order-a')");assert.equal(snapshot(full),before);assert.equal(full.run('financeQuickState.mode'),'review');assert(full.messages.at(-1).includes('已满'));
 const b=fixture();b.run("financeOpenQuickActions('order-a');financeQuickReviewPayment('order-a')");const original=snapshot(b);b.ctx.failStorage=true;b.messages.length=0;b.run("financeQuickConfirmPaid('order-a')");assert.equal(snapshot(b),original);assert.equal(b.run('financeQuickState.mode'),'review');assert.equal(b.messages.length,1);assert(b.messages[0].includes('未保存'));assert(view(b).includes('¥200.00'));assert(!view(b).includes('模拟到账已确认'));
});

test('QR uses a normal read-only page, remains order-specific, and contains no customer or payment data',()=>{
 const b=fixture();b.run("financeOpenQuickActions('order-a')");const before=snapshot(b);b.run("financeQuickShowPaymentQR('order-a')");assert.equal(snapshot(b),before);assert.equal(b.run('state.page'),'financePayment');
 const a=b.run("financeQuickQRPayload('order-a')"),other=b.run("financeQuickQRPayload('order-b')");assert.notEqual(a,other);assert(a.startsWith('SIYUE DEMO / NOT FOR PAYMENT / '));for(const text of ['学生甲','13900000101','1000','order-a','http'])assert(!a.includes(text),text);
 const html=view(b);assert(html.includes('finance-demo-qr'));assert(html.includes('不能真实收款'));assert(!html.includes('<img'));assert(!html.includes('https://'));assert(!html.includes('modal-backdrop'));assert.equal(b.panels.length,0);
 b.run("financeQuickShowActions('order-a')");assert.equal(b.run('state.page'),'financeArrears');assert.equal(b.run('financeQuickState.expandedOrderId'),'order-a');b.run('financeQuickClose()');assert.equal(b.run('financeQuickState.orderId'),null);assert.equal(snapshot(b),before);
});

test('standard QR encoder preserves an independently decoded version-3-L byte-mode vector',()=>{
 const b=fixture(),payload=b.run("financeQuickQRPayload('test-order')"),matrix=b.run('financeQuickQRMatrix('+JSON.stringify(payload)+')');assert.equal(payload,'SIYUE DEMO / NOT FOR PAYMENT / 5A7F0250');assert.equal(matrix.length,29);assert(matrix.every(row=>row.length===29&&row.every(x=>typeof x==='boolean')));
 // This exact matrix is verified by macOS Vision QR decoding outside the VM test harness.
 assert.equal(crypto.createHash('sha256').update(JSON.stringify(matrix)).digest('hex'),'21d9ef0232933a720594a70c59c4a2f06397cd122eeb98bc1a327932fded9983');assert.throws(()=>b.run("financeQuickQRMatrix('x'.repeat(54))"));
});
console.log(`Finance quick-action checks: ${count} passed`);
