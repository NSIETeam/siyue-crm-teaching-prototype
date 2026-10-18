'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(process.env.SIYUE_AUDIT_TEST_ROOT||path.resolve(__dirname,'..'),'employee-auth.js'),'utf8');
const start=source.indexOf(' const auditPrefixes='),end=source.indexOf(' function auditTime',start),box={permissions:[]};
vm.runInNewContext(source.slice(start,end)+';api={action:auditAction,target:auditTarget,outcome:auditOutcome};',box);
test('current operation catalog has explicit human audit labels, including followup and trial review',()=>{
 for(const m of ['academic','crm','commerce','teacher-workflow','student-communication','scrm-core','scrm-service','scrm-import','scrm-views','trial-workflow'])for(const op of require('../backend/src/business-'+m+'.cjs').operations){const label=box.api.action({action:op.id,category:'business'});assert.notEqual(label,'业务办理操作',op.id);assert.notEqual(label,'其他业务操作',op.id);assert(!/^(线索|学生档案|班级|课程|表单审核|营销活动|收款与订单|报名与转班|系统设置)操作$/.test(label),op.id+' '+label);}
 assert.equal(box.api.action({action:'trial.review'}),'复核满员试听申请');
});
test('read audit labels are explicit and outcome cannot imply an executed mutation',()=>{
 for(const [action,label] of Object.entries({'crm.query':'查询客户与线索','crm.trials.read':'查看试听课表与申请','attendance.query':'查询考勤记录','attendance.export':'导出考勤记录','crm.import.inspect':'检查导入数据（未提交）'}))assert.equal(box.api.action({action,category:'system'}),label);
 assert.equal(box.api.outcome({outcome:'preview'}),'预览未提交');assert.equal(box.api.outcome({outcome:'replayed'}),'重复提交已去重');assert.equal(box.api.outcome({outcome:'denied'}),'已拒绝');
 const privateFields={summary:{changes:[{collection:'leads',id:'internal-id',phone:'13900000000',after:{phone:'13900000000'}}]}};assert(!box.api.target(privateFields).includes('13900000000'));assert(!box.api.target(privateFields).includes('internal-id'));
});
