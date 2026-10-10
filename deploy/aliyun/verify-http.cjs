'use strict';
// Read-only GET verification. Run only against the chosen deployment URL.
const fs=require('node:fs');
const crypto=require('node:crypto');
async function verify(base,manifestFile){
 const url=new URL(base);if(!['http:','https:'].includes(url.protocol)||!url.pathname.endsWith('/')||url.username||url.password||url.search||url.hash)throw Error('Use an HTTP(S) deployment URL ending in / without credentials, query or fragment');
 const manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8'));let checked=0;
 for(const file of manifest.files){
  if(!/^(?:[A-Za-z0-9_-]+\.(?:html|js|css)|assets\/[A-Za-z0-9_.-]+\.(?:png|svg|jpg|webp|woff2))$/.test(file.path))throw Error('Invalid manifest path');
  const target=new URL(file.path,url);target.searchParams.set('release-check',manifest.releaseId);
  const response=await fetch(target,{redirect:'error',signal:AbortSignal.timeout(15000)});
  if(response.status!==200)throw Error(`${file.path}: HTTP ${response.status}`);
  const bytes=Buffer.from(await response.arrayBuffer());const hash=crypto.createHash('sha256').update(bytes).digest('hex');
  if(hash!==file.sha256||bytes.length!==file.bytes)throw Error(`${file.path}: deployed bytes differ from release`);
  const mime=response.headers.get('content-type')||'';
  const expected=file.path.endsWith('.html')?/^text\/html\b/:file.path.endsWith('.css')?/^text\/css\b/:file.path.endsWith('.js')?/^(?:application|text)\/javascript\b/:file.path.endsWith('.png')?/^image\/png\b/:null;
  if(expected&&!expected.test(mime))throw Error(`${file.path}: incorrect MIME type ${mime}`);
  checked++;
 }
 for(const blocked of ['backend/src/server.cjs','backend/contracts/openapi.json','cli/operations.json','docs/siyue-system-design.html','.git/config','release-manifest.json']){
  const response=await fetch(new URL(blocked,url),{redirect:'error',signal:AbortSignal.timeout(15000)});await response.arrayBuffer();
  if(![403,404].includes(response.status))throw Error(`Non-public path did not stay blocked: ${blocked} (HTTP ${response.status})`);
 }
 return {releaseId:manifest.releaseId,checked,nonPublicPaths:'blocked'};
}
if(require.main===module){const [base,manifest]=process.argv.slice(2);if(!base||!manifest){console.error('Usage: node verify-http.cjs https://chosen-host/chosen-prefix/ /local/release-manifest.json');process.exitCode=2;}else verify(base,manifest).then(r=>console.log(JSON.stringify(r,null,2))).catch(e=>{console.error(e.message);process.exitCode=1;});}
module.exports={verify};
