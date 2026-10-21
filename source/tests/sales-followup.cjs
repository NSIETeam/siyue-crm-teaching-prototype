'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const authSource=fs.readFileSync(path.join(__dirname,'employee-auth.cjs'),'utf8').split('const user=')[0];
const authCreate=new Function('require','__dirname',authSource+';return create')(require('node:module').createRequire(path.join(__dirname,'employee-auth.cjs')),__dirname);
const code=fs.readFileSync(path.join(__dirname,'../business-api.js'),'utf8');
const user={id:'manager-one',name:'校区负责人',username:'manager-one',roleIds:['principal'],permissions:['report.read','audit.read','sales.activity.read','lead.read'],scope:{type:'all'},mustChangePassword:false,version:1};
const response=(body,status=200)=>({ok:status<400,status,json:async()=>body});
function snapshot(){return {revision:3,capabilities:{businessReady:true,paymentProvider:false},state:{courses:[],classes:[],students:[],leads:[],orders:[],campuses:[],staff:[],dictionary:{},settings:{},activities:{coupon:[],group:[],joint:[]},forms:[],decor:{},directory:[]}}}
async function fixture(identity=user){
 const b=await authCreate(identity),calls=[];
 let responder=async url=>String(url).endsWith('/v1/state')?response(snapshot()):String(url).endsWith('/v1/catalog')?response({operations:[]}):response({});
 b.respond(async(url,options={})=>{calls.push({url:String(url),options});return responder(String(url),options)});
 b.run(code);await new Promise(resolve=>setImmediate(resolve));
 return {...b,calls,respondBusiness(fn){responder=fn}};
}
const report={scope:'全部授权数据',cohortDescription:'按线索分配批次统计',items:[{employeeId:'seller-a',employeeName:'销售甲',assignedUnique:4,convertedUnique:1,conversionRate:null,lowSample:true,overdueUnique:1,overdueRate:null,receivedMinor:12000,refundedMinor:0,netReceivedMinor:12000,avgHoursToConversion:5}]};
const localDateTime=value=>{const d=new Date(value),pad=x=>String(x).padStart(2,'0');return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`};
const followup=(id,note,at='2025-02-02T10:00:00.000Z',extra={})=>({id,at,actorId:'seller-a',actorName:'销售甲',leadId:'lead-'+id,leadName:'学生'+id,action:'lead.followup',channel:'电话',note,nextFollowAt:null,...extra});

 test('sales row opens all-history followups separately from date-filtered operation logs and deduplicates pages',async()=>{
 const b=await fixture(),pageOne={view:'followups',scope:'全部授权数据',items:[followup('f2','讨论课程安排','2025-02-02T10:00:00.000Z',{leadName:'学生乙',channel:'线上会议',nextFollowAt:'2025-02-05T09:00:00.000Z'})],hasMore:true,nextCursor:'f2'},pageTwo={view:'followups',scope:'全部授权数据',items:[followup('f2','重复副本','2025-02-02T10:00:00.000Z'),followup('f1','旧记录 <img src=x onerror=alert(1)>','2024-01-03T10:00:00.000Z',{leadName:'学生甲'})],hasMore:false,nextCursor:null};
 b.respondBusiness(async url=>{const value=String(url);if(value.includes('/v1/reports/sales'))return response(report);if(value.includes('/v1/sales/activity')&&value.includes('view=followups'))return response(value.includes('cursor=f2')?pageTwo:pageOne);if(value.includes('/v1/sales/activity'))return response({items:[{at:'2025-02-01T10:00:00.000Z',leadName:'学生乙',action:'lead.followup',summary:'跟进已记录'}],hasMore:false,nextCursor:null});return response({})});
 b.run("nav('salesMetrics')");await new Promise(resolve=>setImmediate(resolve));
 let html=b.elements.get('#view').innerHTML;assert.match(html,/class="business-sales-row business-sales-row-clickable"[^>]*onclick="businessAPI\.salesFollowupsToggle\(&quot;seller-a&quot;\)/);assert.match(html,/操作日志/);
 b.run("businessAPI.salesReportDate('from','2025-01-01');businessAPI.salesReportDate('to','2025-03-01')");
 assert.equal(await b.run("businessAPI.salesFollowupsToggle('seller-a')"),true);
 html=b.elements.get('#view').innerHTML;assert.match(html,/全部历史跟进记录/);assert.match(html,/学生乙/);assert.match(html,/线上会议/);assert.match(html,/讨论课程安排/);assert.match(html,new RegExp(localDateTime('2025-02-05T09:00:00.000Z').replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));assert.match(html,/加载更多跟进记录/);
 const followupRequest=b.calls.findLast(call=>call.url.includes('/v1/sales/activity')&&call.url.includes('view=followups'));assert(followupRequest);const firstParams=new URLSearchParams(followupRequest.url.split('?')[1]);assert.equal(firstParams.get('employeeId'),'seller-a');assert.equal(firstParams.get('limit'),'50');assert.equal(firstParams.get('from'),null);assert.equal(firstParams.get('to'),null);
 assert.equal(await b.run("businessAPI.salesFollowupsMore('seller-a','f2')"),true);html=b.elements.get('#view').innerHTML;assert.match(html,/学生甲/);assert.match(html,/旧记录 &lt;img src=x onerror=alert\(1\)&gt;/);assert.doesNotMatch(html,/重复副本/);assert.doesNotMatch(html,/<img src=x onerror=alert\(1\)>/);assert.doesNotMatch(html,/加载更多跟进记录/);
 const nextRequest=b.calls.findLast(call=>call.url.includes('/v1/sales/activity')&&call.url.includes('view=followups'));assert.equal(new URLSearchParams(nextRequest.url.split('?')[1]).get('cursor'),'f2');assert.equal(new URLSearchParams(nextRequest.url.split('?')[1]).get('from'),null);
 assert.equal(await b.run("businessAPI.salesActivity('seller-a')"),true);html=b.elements.get('#view').innerHTML;assert.match(html,/操作日志/);assert.match(html,/转化原始率/);const logRequest=b.calls.findLast(call=>call.url.includes('/v1/sales/activity')&&!call.url.includes('view=followups'));assert(logRequest);const logParams=new URLSearchParams(logRequest.url.split('?')[1]);assert.equal(logParams.get('from'),'2025-01-01');assert.equal(logParams.get('to'),'2025-03-01');
});

test('lead.assign grants sales activity and followup visibility; other report readers get no clickable prompt',async()=>{
 const allowed=await fixture({...user,permissions:['report.read','lead.assign']});allowed.respondBusiness(async url=>String(url).includes('/v1/reports/sales')?response(report):response({view:'followups',items:[],hasMore:false,nextCursor:null}));allowed.run("nav('salesMetrics')");await new Promise(resolve=>setImmediate(resolve));let html=allowed.elements.get('#view').innerHTML;assert.match(html,/role="button"/);assert.equal(await allowed.run("businessAPI.salesFollowupsToggle('seller-a')"),true);
 const denied=await fixture({...user,permissions:['report.read']});denied.respondBusiness(async url=>String(url).includes('/v1/reports/sales')?response(report):response({}));denied.run("nav('salesMetrics')");await new Promise(resolve=>setImmediate(resolve));html=denied.elements.get('#view').innerHTML;assert.match(html,/style="cursor:default"/);assert.doesNotMatch(html,/role="button"|tabindex="0"|onclick="businessAPI\.salesFollowupsToggle|点击查看跟进记录|操作日志/);assert.doesNotMatch(html,/点击销售行查看该员工全部历史跟进记录/);assert.equal(await denied.run("businessAPI.salesFollowupsToggle('seller-a')"),false);
});

test('archived salesperson remains labeled while historical followups stay expandable',async()=>{
 const b=await fixture();b.respondBusiness(async url=>String(url).includes('/v1/reports/sales')?response({...report,items:[{...report.items[0],archived:true}]}):response({view:'followups',items:[followup('archived','归档员工历史')],hasMore:false,nextCursor:null}));b.run("nav('salesMetrics')");await new Promise(resolve=>setImmediate(resolve));let html=b.elements.get('#view').innerHTML;assert.match(html,/销售甲<\/span><small class="business-sales-archived">离职归档/);assert.equal(await b.run("businessAPI.salesFollowupsToggle('seller-a')"),true);html=b.elements.get('#view').innerHTML;assert.match(html,/归档员工历史/);
});

test('closing or switching seller ignores a late followup response',async()=>{
 const b=await fixture();let resolveA,resolveB;
 b.respondBusiness(url=>{const value=String(url);if(value.includes('/v1/reports/sales'))return Promise.resolve(response({...report,items:[...report.items,{...report.items[0],employeeId:'seller-b',employeeName:'销售乙'}]}));if(value.includes('employeeId=seller-a'))return new Promise(resolve=>resolveA=resolve);if(value.includes('employeeId=seller-b'))return new Promise(resolve=>resolveB=resolve);return Promise.resolve(response({}))});
 b.run("nav('salesMetrics')");await new Promise(resolve=>setImmediate(resolve));const first=b.run("businessAPI.salesFollowupsToggle('seller-a')");await new Promise(resolve=>setImmediate(resolve));b.run("businessAPI.salesFollowupsToggle('seller-b')");await new Promise(resolve=>setImmediate(resolve));
 resolveA(response({view:'followups',items:[followup('old','不应出现','2020-01-01T00:00:00Z',{leadName:'旧销售隐私线索'})],hasMore:false,nextCursor:null}));await first;assert.doesNotMatch(b.elements.get('#view').innerHTML,/旧销售隐私线索|不应出现/);
 resolveB(response({view:'followups',items:[followup('new','当前记录','2025-01-01T00:00:00Z',{leadName:'销售乙当前线索'})],hasMore:false,nextCursor:null}));await new Promise(resolve=>setImmediate(resolve));const html=b.elements.get('#view').innerHTML;assert.match(html,/销售乙当前线索/);assert.match(html,/当前记录/);assert.doesNotMatch(html,/旧销售隐私线索|不应出现/);
});

test('closing a pending seller row prevents its response from reopening the details',async()=>{
 const b=await fixture();let release;b.respondBusiness(url=>String(url).includes('/v1/reports/sales')?Promise.resolve(response(report)):String(url).includes('/v1/sales/activity')?new Promise(resolve=>release=resolve):Promise.resolve(response({})));
 b.run("nav('salesMetrics')");await new Promise(resolve=>setImmediate(resolve));const pending=b.run("businessAPI.salesFollowupsToggle('seller-a')");b.run("businessAPI.salesFollowupsToggle('seller-a')");release(response({view:'followups',items:[followup('late','过期响应','2025-01-01T00:00:00Z',{leadName:'不应重开'})],hasMore:false,nextCursor:null}));await pending;
 assert.match(b.elements.get('#view').innerHTML,/aria-expanded="false"/);assert.doesNotMatch(b.elements.get('#view').innerHTML,/不应重开|过期响应/);
});

test('INVALID_CURSOR reloads the first page without cursor or date filters',async()=>{
 const b=await fixture();let requests=0;b.respondBusiness(url=>{const value=String(url);if(value.includes('/v1/reports/sales'))return Promise.resolve(response(report));if(value.includes('/v1/sales/activity')&&value.includes('view=followups')){requests++;if(requests===1)return Promise.resolve(response({view:'followups',items:[followup('old','旧首屏')],hasMore:true,nextCursor:'stale-cursor'}));if(requests===2)return Promise.resolve(response({code:'INVALID_CURSOR',message:'分页位置已失效'},409));return Promise.resolve(response({view:'followups',items:[followup('fresh','刷新后的首屏')],hasMore:false,nextCursor:null}))}return Promise.resolve(response({}))});
 b.run("nav('salesMetrics')");await new Promise(resolve=>setImmediate(resolve));assert.equal(await b.run("businessAPI.salesFollowupsToggle('seller-a')"),true);assert.equal(await b.run("businessAPI.salesFollowupsMore('seller-a','stale-cursor')"),true);assert.equal(requests,3);const calls=b.calls.filter(call=>call.url.includes('/v1/sales/activity')&&call.url.includes('view=followups'));assert.equal(new URLSearchParams(calls[0].url.split('?')[1]).get('cursor'),null);assert.equal(new URLSearchParams(calls[1].url.split('?')[1]).get('cursor'),'stale-cursor');assert.equal(new URLSearchParams(calls[2].url.split('?')[1]).get('cursor'),null);for(const call of calls){const params=new URLSearchParams(call.url.split('?')[1]);assert.equal(params.get('from'),null);assert.equal(params.get('to'),null)}assert.match(b.elements.get('#view').innerHTML,/刷新后的首屏/);
});

test('authentication identity change clears prior salesperson followups',async()=>{
 const b=await fixture();let authVersion=1;b.respondBusiness(url=>{const value=String(url);if(value.endsWith('/v1/auth/me'))return Promise.resolve(response({user:{...user,version:++authVersion},csrfToken:'rotated-csrf',expiresAt:'2099-01-01'}));if(value.endsWith('/v1/state'))return Promise.resolve(response(snapshot()));if(value.endsWith('/v1/catalog'))return Promise.resolve(response({operations:[]}));if(value.includes('/v1/reports/sales'))return Promise.resolve(response(report));if(value.includes('view=followups'))return Promise.resolve(response({view:'followups',items:[followup('private-old','上一账号敏感跟进')],hasMore:false,nextCursor:null}));return Promise.resolve(response({}))});
 b.run("nav('salesMetrics')");await new Promise(resolve=>setImmediate(resolve));assert.equal(await b.run("businessAPI.salesFollowupsToggle('seller-a')"),true);assert.match(b.elements.get('#view').innerHTML,/上一账号敏感跟进/);await b.run('employeeAuth.refresh()');await new Promise(resolve=>setImmediate(resolve));const html=b.elements.get('#view').innerHTML;assert.doesNotMatch(html,/上一账号敏感跟进/);assert.match(html,/销售统计/);
});

test('followup errors can be retried and an empty authorized result is explicit',async()=>{
 const b=await fixture();let attempts=0;b.respondBusiness(url=>{const value=String(url);if(value.includes('/v1/reports/sales'))return Promise.resolve(response(report));if(value.includes('/v1/sales/activity')){attempts++;return attempts===1?Promise.reject(new Error('网络暂不可用')):Promise.resolve(response({view:'followups',items:[],hasMore:false,nextCursor:null}))}return Promise.resolve(response({}))});
 b.run("nav('salesMetrics')");await new Promise(resolve=>setImmediate(resolve));assert.equal(await b.run("businessAPI.salesFollowupsToggle('seller-a')"),false);let html=b.elements.get('#view').innerHTML;assert.match(html,/网络暂不可用/);assert.match(html,/重试/);assert.equal(await b.run("businessAPI.salesFollowupsRetry('seller-a')"),true);html=b.elements.get('#view').innerHTML;assert.match(html,/暂无跟进记录/);assert.equal(attempts,2);
});
