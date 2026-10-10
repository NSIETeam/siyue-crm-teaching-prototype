const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
for(const file of fs.readdirSync(root).filter(f=>f.endsWith('.js')))execFileSync(process.execPath,['--check',path.join(root,file)],{stdio:'inherit'});
for(const file of ['audit.cjs','crm.cjs','academic.cjs','full-smoke.cjs','mall.cjs'])execFileSync(process.execPath,[path.join(__dirname,file)],{cwd:root,stdio:'inherit'});
