'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../business-api.js'),'utf8');
const settle=()=>new Promise(setImmediate),plain=value=>JSON.parse(JSON.stringify(value));
const user=(id,roleIds,permissions)=>({id,version:1,roleIds,permissions,mustChangePassword:false});
const admin=user('synthetic-admin',['superadmin'],['dashboard.read','settings.read','lead.read','promotion.create','schedule.read']);
function harness(){
 let actor=null,subscriber,writes=0;const pending=[],navUpdates=[],searchResults=['stale admin result'];
 const input={value:'未保存的账号表单内容',selectionStart:3,selectionEnd:5},note={textContent:''},crumb={textContent:'设置与账号'};
 const view={get innerHTML(){return 'existing account form'},set innerHTML(value){writes++},querySelector(){return null},scrollTop:0,scrollLeft:0};
 const menus={settings:false,leads:false,marketing:false,teaching:false};
 const sandbox={SIYUE_AUTH_API:'/crm-api/',document:{activeElement:input,querySelector:selector=>selector==='#view'?view:selector==='#crumb'?crumb:null,querySelectorAll:()=>[],getElementById:id=>id==='employee-prototype-notice'?note:null,addEventListener(){}},state:{page:'accountSettings'},a:{},leadState:{},mallState:{},mfState:{},workflowState:{},sysRules:{},render(){},nav(){},accountOpen(){},workspaceBack(){},permissionCanVisit:()=>true,toast(){},SiyueOperationSearch:{clear(){searchResults.length=0}},permissionRefreshNavigation(){const grants=actor?.permissions||[];Object.assign(menus,{settings:grants.includes('settings.read'),leads:grants.includes('lead.read'),marketing:grants.includes('promotion.create'),teaching:grants.includes('schedule.read')});navUpdates.push({actor:actor?.id||null,...menus})},employeeAuth:{subscribe(fn){subscriber=fn;fn(null)},current:()=>actor,request(endpoint){const identity=actor.id;return new Promise((resolve,reject)=>pending.push({identity,endpoint,resolve,reject}))}}};
 sandbox.window=sandbox;vm.createContext(sandbox);vm.runInContext(source,sandbox);
 const flush=async(identity,{error=false}={})=>{for(const entry of pending.filter(item=>item.identity===identity)){pending.splice(pending.indexOf(entry),1);if(error)entry.reject(Error('synthetic transport failure'));else entry.resolve(entry.endpoint.startsWith('v1/state')?{revision:1,capabilities:{businessReady:true},state:{leads:[{id:'lead-'+identity}],staff:[{id:'staff-'+identity}],campuses:[{id:'campus-'+identity}],courses:[],classes:[],students:[]}}:{operations:[{id:'lead.create',permission:'lead.create',execution:'server'}]})}await settle();};
 return {sandbox,input,note,view,menus,navUpdates,searchResults,api:sandbox.businessAPI,get writes(){return writes},login(next){actor=next;subscriber(next)},logout(){actor=null;subscriber(null)},flush};
}
for(const [role,permissions,expected]of [
 ['sales',['dashboard.read','lead.read'],{settings:false,leads:true,marketing:false,teaching:false}],
 ['academic',['dashboard.read','lead.read','schedule.read'],{settings:false,leads:true,marketing:false,teaching:true}],
 ['operations',['dashboard.read','lead.read','promotion.create'],{settings:false,leads:true,marketing:true,teaching:false}]
])test('account page admin logout then '+role+' login refreshes shared navigation and connection status without rebuilding the account form',async()=>{
 const h=harness();h.login(admin);await h.flush(admin.id);assert.equal(h.api.status().ready,true);assert.equal(h.menus.settings,true);assert.equal(h.note.textContent,'业务数据已连接服务器');
 const input=h.input,focus=h.sandbox.document.activeElement,writes=h.writes;h.logout();assert.equal(h.api.snapshot(),null);assert.deepEqual(plain(h.api.catalog()),[]);assert.deepEqual(plain(h.sandbox.leadState.leads),[]);assert.deepEqual(plain(h.sandbox.state.staff),[]);assert.deepEqual(h.menus,{settings:false,leads:false,marketing:false,teaching:false});assert.equal(h.note.textContent,'业务服务未连接');
 const next=user('synthetic-'+role,[role],permissions);h.login(next);assert.equal(h.api.status().loading,true);assert.equal(h.note.textContent,'正在同步服务器数据');assert.deepEqual(h.menus,expected);await h.flush(next.id);
 assert.equal(h.api.status().ready,true);assert.equal(h.api.status().loading,false);assert.equal(h.note.textContent,h.api.statusText());assert.equal(h.note.textContent,'业务数据已连接服务器');assert.deepEqual(plain(h.api.snapshot().leads),[{id:'lead-'+next.id}]);assert.deepEqual(h.menus,expected);assert.equal(h.searchResults.length,0);
 assert.equal(h.writes,writes);assert.equal(h.sandbox.document.activeElement,focus);assert.equal(h.input,input);assert.equal(input.value,'未保存的账号表单内容');assert.equal(input.selectionStart,3);assert.equal(input.selectionEnd,5);assert.equal(h.sandbox.state.page,'accountSettings');
 const reloaded=h.api.reload();assert.equal(h.note.textContent,'正在同步服务器数据');await h.flush(next.id);assert.equal(await reloaded,true);assert.equal(h.note.textContent,'业务数据已连接服务器');assert.equal(h.writes,writes);assert.equal(h.sandbox.document.activeElement,focus);assert.equal(input.value,'未保存的账号表单内容');assert.equal(input.selectionStart,3);assert.equal(input.selectionEnd,5);
});
test('a late admin response cannot restore old records or navigation after account-page identity changes',async()=>{
 const h=harness();h.login(admin);h.logout();const next=user('synthetic-operations',['operations'],['lead.read']);h.login(next);await h.flush(next.id);await h.flush(admin.id);
 assert.equal(h.api.status().ready,true);assert.deepEqual(plain(h.api.snapshot().leads),[{id:'lead-'+next.id}]);assert.equal(h.menus.settings,false);assert.equal(h.note.textContent,'业务数据已连接服务器');assert.equal(h.navUpdates.at(-1).actor,next.id);
});
test('account-page connection failure clears the syncing notice without overwriting the current account form',async()=>{
 const h=harness(),next=user('synthetic-sales',['sales'],['lead.read']);h.login(next);const writes=h.writes;await h.flush(next.id,{error:true});assert.equal(h.api.status().loading,false);assert.equal(h.api.status().ready,false);assert.equal(h.note.textContent,'业务服务未连接');assert.equal(h.writes,writes);assert.equal(h.sandbox.document.activeElement,h.input);
});
