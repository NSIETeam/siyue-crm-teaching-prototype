'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{reportQuery}=require('./report-query.cjs');
test('sales report and activity query filters map to the service contract',()=>{
 assert.equal(reportQuery(['--employee','emp 1','--from','2026-10-01','--to','2026-10-11'],'sales'),'?employeeId=emp+1&from=2026-10-01&to=2026-10-11');
 assert.equal(reportQuery(['--employee','e1','--lead','l1','--from','2026-10-01','--action','lead.followup','--limit','25','--cursor','next+page'],'activity'),'?employeeId=e1&leadId=l1&from=2026-10-01&action=lead.followup&limit=25&cursor=next%2Bpage');
 assert.equal(reportQuery(['--view','followups','--employee','e1','--limit','50','--cursor','followup:lead-1:row-1'],'activity'),'?view=followups&employeeId=e1&limit=50&cursor=followup%3Alead-1%3Arow-1');
 assert.equal(reportQuery(['--employee','teacher 1'],'teacher'),'?employeeId=teacher+1');
 assert.equal(reportQuery(['--employee','teacher 1','--days','60'],'teacher'),'?employeeId=teacher+1&observationDays=60');
 assert.equal(reportQuery([],'sales'),'');
});
test('report filters reject invalid dates, reversed ranges, unsupported flags and bad pagination',()=>{
 for(const [args,kind]of[[['--from','2026-02-30'],'sales'],[['--from','2026-10-12','--to','2026-10-11'],'sales'],[['--limit','201'],'activity'],[['--limit','0'],'activity'],[['--view','unknown'],'activity'],[['--surprise','x'],'activity'],[['--employee'],'sales'],[['--from','2026-10-01'],'teacher'],[['--days','0'],'teacher'],[['--days','366'],'teacher']])assert.throws(()=>reportQuery(args,kind),e=>e.code==='INVALID_ARGUMENT');
});
