'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawnSync}=require('node:child_process');
const {simulate}=require('./lesson-consumption-simulation.cjs');
const cli=path.join(__dirname,'siyue-cli.cjs');
test('simulation executes handlers, validates all scenarios and exports only scoped records',()=>{
 const payload=simulate();assert.equal(payload.schema,'siyue.lesson-consumption.simulation');assert.equal(payload.source.mode,'simulation');assert.equal(payload.report.checks.length,10);assert.ok(payload.report.checks.every(x=>x.status==='passed'));
 const data=payload.academic;assert.equal(data.students.length,3);assert.equal(data.classes.length,2);assert.equal(data.attendance.length,3);assert.equal(data.attendance.filter(x=>x.consumptionConfirmed).length,2);
 for(const rows of Object.values(data))for(const row of rows){assert.ok(row.id.startsWith(payload.runId));assert.equal(row.simulationRunId,payload.runId);}
 for(const row of data.attendance){assert.equal(data.students[row.studentIndex].id,row.studentId);assert.equal(data.classes[row.classIndex].id,row.classId);if(row.consumptionConfirmed)assert.ok(data.orders.some(o=>o.id===row.orderId));}
 assert.equal(payload.report.summary.consumedAmountMinor,60000);assert.equal(payload.report.summary.remainingRefundMinor,210000);
 assert.ok(payload.journal.some(x=>x.result==='已拦截'));assert.ok(payload.journal.every(x=>x.simulationRunId===payload.runId));
});
test('real command writes readable result and report without overwriting an earlier run',t=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'siyue-cli-simulation-'));t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
 const result=spawnSync(process.execPath,[cli,'simulate','lesson-consumption','--out',temp],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);
 const printed=JSON.parse(result.stdout),payload=JSON.parse(fs.readFileSync(printed.payloadPath,'utf8')),report=JSON.parse(fs.readFileSync(printed.reportPath,'utf8'));
 assert.equal(printed.runId,payload.runId);assert.equal(report.runId,payload.runId);assert.deepEqual(printed.summary,report.summary);
 const before=fs.readFileSync(printed.payloadPath,'utf8');const repeated=spawnSync(process.execPath,[cli,'simulate','lesson-consumption','--out',temp],{encoding:'utf8'});assert.notEqual(repeated.status,0);assert.equal(fs.readFileSync(printed.payloadPath,'utf8'),before);
});
test('unsupported writes and malformed simulation arguments fail explicitly; help identifies isolated simulation',()=>{
 for(const args of [['execute','session.attendance'],['simulate','unknown','--out','/tmp/unused'],['simulate','lesson-consumption'],['simulate','lesson-consumption','--out']]){const result=spawnSync(process.execPath,[cli,...args],{encoding:'utf8'});assert.notEqual(result.status,0);assert.match(result.stderr,/NOT_IMPLEMENTED|SIMULATION_FAILED/);}
 const result=spawnSync(process.execPath,[cli,'help'],{encoding:'utf8'});assert.equal(result.status,0);assert.match(result.stdout,/离线演示/);
});
