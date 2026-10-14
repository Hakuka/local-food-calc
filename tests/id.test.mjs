import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import ts from 'typescript';
import {createApp} from '../server/index.mjs';

const source=readFileSync(new URL('../lib/id.ts',import.meta.url),'utf8');
const {outputText}=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}});
function browserId(crypto){
 const context={exports:{},crypto};
 runInNewContext(outputText,context);
 return context.exports.createId;
}

test('ID generation uses native randomUUID when available',()=>{
 const native={randomUUID(){assert.equal(this,native);return 'native-uuid';},getRandomValues(){assert.fail('Fallback should not run');}};
 assert.equal(browserId(native)(),'native-uuid');
});

test('HTTP fallback creates UUID v4 IDs without randomUUID, with fresh entropy for each call',()=>{
 let calls=0;
 const createId=browserId({getRandomValues(bytes){calls++;return webcrypto.getRandomValues(bytes);}});
 const ids=Array.from({length:1000},()=>createId());
 assert.equal(calls,1000);assert.equal(new Set(ids).size,ids.length);
 for(const id of ids)assert.match(id,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('HTTP fallback sets UUID version and variant for either extreme of random bytes',()=>{
 assert.equal(browserId({getRandomValues:bytes=>bytes.fill(0)})(),'00000000-0000-4000-8000-000000000000');
 assert.equal(browserId({getRandomValues:bytes=>bytes.fill(255)})(),'ffffffff-ffff-4fff-bfff-ffffffffffff');
});

test('An ID generated without randomUUID can save a diary entry through the HTTP API',async()=>{
 const folder=mkdtempSync(join(tmpdir(),'diet-http-id-test-'));
 const server=createApp({dataDir:folder});server.listen(0,'127.0.0.1');await once(server,'listening');
 const base='http://127.0.0.1:'+server.address().port;
 try{
  const data=await(await fetch(base+'/api/data')).json();const product=data.products.find(p=>!p.archived);
  const createId=browserId({getRandomValues:bytes=>webcrypto.getRandomValues(bytes)}),id=createId();
  const response=await fetch(base+'/api/data',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({action:'entry',id,profileId:'janusz',date:'2026-10-14',productId:product.id,grams:100,meal:'Obiad',note:''})});
  assert.equal(response.status,200);
  const saved=await(await fetch(base+'/api/data')).json();const entry=saved.entries.find(e=>e.id===id);
  assert.equal(entry.productId,product.id);assert.equal(entry.grams,100);assert.equal(entry.kcal,product.kcal);
 }finally{server.close();await once(server,'close');rmSync(folder,{recursive:true,force:true});}
});
