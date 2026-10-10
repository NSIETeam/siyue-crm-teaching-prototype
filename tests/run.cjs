const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
for(const file of fs.readdirSync(root).filter(f=>f.endsWith('.js')))execFileSync(process.execPath,['--check',path.join(root,file)],{stdio:'inherit'});
for(const file of ['audit.cjs','crm.cjs','academic.cjs','academic-class-audit.cjs','academic-schedule-audit.cjs','academic-scheduling-flow.cjs','academic-session-audit.cjs','full-smoke.cjs','mall.cjs','withdrawal.cjs','finance-quick-actions.cjs','profile-quick-actions.cjs','operation-journal.cjs','workspace-navigation.cjs','temp-transfer-eligibility.cjs','lesson-consumption.cjs','batch-enrollment-corrections.cjs','sales-metrics.cjs','crm-audit.cjs','crm-import.cjs','commerce-audit.cjs','finance-audit.cjs','platform-audit.cjs','employee-auth.cjs','business-api.cjs','public-form.cjs'])execFileSync(process.execPath,[path.join(__dirname,file)],{cwd:root,stdio:'inherit'});

execFileSync(process.execPath,['--test','cli/simulation.test.cjs','cli/auth.test.cjs'],{cwd:root,stdio:'inherit'});
