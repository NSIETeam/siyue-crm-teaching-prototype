'use strict';
// Emits a candidate location snippet only. Never edits or reloads Nginx.
const fs=require('node:fs');
function config(prefix,appRoot){
 if(!/^\/(?:[A-Za-z0-9_-]+\/)+$/.test(prefix))throw Error('prefix must be a dedicated non-root path ending in /');
 if(!/^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+$/.test(appRoot))throw Error('app-root must be an absolute directory using letters, digits, - or _');
 return `# Candidate only: include inside the inventoried existing server block.\n# No listen/server_name/TLS/proxy settings are changed.\nlocation = ${prefix.slice(0,-1)} {\n    return 308 ${prefix};\n}\nlocation ^~ ${prefix} {\n    alias ${appRoot}/current/public/;\n    index index.html;\n    autoindex off;\n    open_file_cache off;\n    expires -1;\n    limit_except GET HEAD { deny all; }\n    # No local add_header directive: retain the server's inherited security headers.\n    # Unknown files return 404; no backend proxy and no generic SPA fallback.\n}\n`;
}
if(require.main===module){
 try{const args=process.argv.slice(2);let prefix,root,out;for(let i=0;i<args.length;i+=2){if(args[i]==='--prefix')prefix=args[i+1];else if(args[i]==='--app-root')root=args[i+1];else if(args[i]==='--out')out=args[i+1];else throw Error('Usage: --prefix /dedicated-path/ --app-root /absolute/root [--out candidate.conf]');}const text=config(prefix,root);if(out)fs.writeFileSync(out,text,{flag:'wx'});else process.stdout.write(text);}
 catch(error){console.error(error.message);process.exitCode=1;}
}
module.exports={config};
