'use strict';
// Read-only comparison against the source-only production capture.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'production-version.json'),'utf8'));
let checked=0;
for(const [name,expected] of Object.entries(manifest.files)){
 if(path.isAbsolute(name)||name.split('/').includes('..'))throw Error('Unsafe manifest path');
 const file=path.join(root,name);
 if(!fs.lstatSync(file).isFile()||fs.lstatSync(file).isSymbolicLink())throw Error('Not a regular source file: '+name);
 const actual=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
 if(actual!==expected)throw Error('Source differs from captured production: '+name);
 checked++;
}
console.log(`${checked} production source files match ${manifest.frontendRelease} / ${manifest.backendRelease}`);
