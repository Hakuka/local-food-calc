import {spawn} from 'node:child_process';
const children=[spawn(process.execPath,['--watch','server/index.mjs'],{stdio:'inherit',env:{...process.env,HOST:'127.0.0.1',PORT:'3000'}}),spawn(process.execPath,['node_modules/vite/bin/vite.js'],{stdio:'inherit'})];
let closing=false;
function close(code=0){if(closing)return;closing=true;for(const child of children)child.kill();process.exitCode=code;}
process.on('SIGINT',()=>close());process.on('SIGTERM',()=>close());
for(const child of children){child.on('error',error=>{console.error(error.message);close(1);});child.on('exit',(code)=>{if(!closing)close(code||0);});}
