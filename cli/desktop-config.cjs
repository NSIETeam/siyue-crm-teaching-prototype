'use strict';
const path=require('node:path');
function config(){return {mcpServers:{siyue:{command:process.execPath,args:[path.resolve(__dirname,'../mcp/server.cjs')],...(process.env.SIYUE_CONFIG_DIR?{env:{SIYUE_CONFIG_DIR:path.resolve(process.env.SIYUE_CONFIG_DIR)}}:{})}}};}
module.exports={config};
