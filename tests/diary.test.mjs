import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import ts from 'typescript';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {openStore} from '../server/storage.mjs';
import {createApp} from '../server/index.mjs';

function moduleUrl(path,imports={}){
 let {outputText}=ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}});
 for(const [name,url] of Object.entries(imports))outputText=outputText.replaceAll(`from '${name}'`,`from '${url}'`).replaceAll(`from "${name}"`,`from "${url}"`);
 return 'data:text/javascript;base64,'+Buffer.from(outputText).toString('base64');
}
const typesUrl=moduleUrl('../lib/types.ts');
const imports={'../lib/types':typesUrl,'../lib/calculations':moduleUrl('../lib/calculations.ts',{'./types':typesUrl}),'../lib/id':moduleUrl('../lib/id.ts'),react:import.meta.resolve('react'),'react/jsx-runtime':import.meta.resolve('react/jsx-runtime'),'lucide-react':import.meta.resolve('lucide-react')};
const {EntryForm,DiaryEntries}=await import(moduleUrl('../app/diary.tsx',{...imports,'./planner':moduleUrl('../app/planner.tsx',imports)}));
const product={action:'product',id:'diary-product',name:'Ryż',manufacturer:'Test',note:'',kcal:100,protein:10,carbs:12,fat:3};
const other={...product,id:'diary-other',name:'Fasola',kcal:200};
const batch={action:'entryBatch',profileId:'janusz',date:'2026-10-20',meal:'Obiad',items:[{id:'diary-first',productId:product.id,grams:150,note:'Ugotowane'},{id:'diary-second',productId:other.id,grams:50,note:''}]};
const dir=()=>mkdtempSync(join(tmpdir(),'diet-diary-test-'));

test('Diary batch saves every portion to one profile, day and meal and survives restart',()=>{
 const folder=dir();let store=openStore(folder);
 try{
  store.mutate(product);store.mutate(other);const before=store.read();
  store.mutate({...batch,items:batch.items.map(item=>({...item,profileId:'grazyna',date:'2026-10-21',meal:'Kolacja',kcal:999}))});
  let data=store.read();const entries=data.entries.filter(e=>batch.items.some(i=>i.id===e.id));
  assert.equal(entries.length,2);assert.equal(entries.reduce((sum,e)=>sum+e.kcal,0),250);
  assert.ok(entries.every(e=>e.profileId===batch.profileId&&e.date===batch.date&&e.meal===batch.meal));
  assert.deepEqual(data.entries.filter(e=>e.profileId==='grazyna'),before.entries.filter(e=>e.profileId==='grazyna'));
  assert.deepEqual(data.plans,before.plans);assert.deepEqual(data.logs,before.logs);
  store.mutate({...product,revision:1,kcal:400});
  store.mutate({action:'entry',...entries.find(e=>e.id==='diary-first'),grams:300});
  assert.equal(store.read().entries.find(e=>e.id==='diary-first').kcal,300);
  data=store.read();store.close();store=openStore(folder);assert.deepEqual(store.read(),data);
 }finally{store.close();rmSync(folder,{recursive:true,force:true});}
});

test('Diary batches roll back on missing/archived foods or existing IDs, including retries',()=>{
 const folder=dir(),store=openStore(folder);
 try{
  store.mutate(product);store.mutate(other);
  const before=store.read();
  assert.throws(()=>store.mutate({...batch,items:[batch.items[0],{...batch.items[1],productId:'missing'}]}),e=>e.status===404);
  assert.deepEqual(store.read(),before);
  store.mutate({action:'archive',id:other.id,revision:1,archived:1});const archived=store.read();
  assert.throws(()=>store.mutate(batch),e=>e.status===400);assert.deepEqual(store.read(),archived);
  store.mutate({action:'archive',id:other.id,revision:2,archived:0});store.mutate(batch);const saved=store.read();
  assert.throws(()=>store.mutate(batch),e=>e.status===409);assert.deepEqual(store.read(),saved);
  assert.throws(()=>store.mutate({...batch,items:[{...batch.items[0],id:'new-row'},batch.items[1]]}),e=>e.status===409);
  assert.deepEqual(store.read(),saved);
 }finally{store.close();rmSync(folder,{recursive:true,force:true});}
});

test('Diary batch validates all rows and rejects edits, duplicate IDs, invalid dates and quantities',()=>{
 const folder=dir(),store=openStore(folder);
 try{
  store.mutate(product);store.mutate(other);const before=store.read();
  const invalid=[{...batch,items:[]},{...batch,items:Array.from({length:101},(_,i)=>({...batch.items[0],id:String(i)}))},{...batch,items:[batch.items[0],batch.items[0]]},{...batch,date:'2026-02-30'},{...batch,meal:'Nieznany'},{...batch,profileId:'someone'}];
  for(const changes of [{grams:0},{grams:-1},{grams:Infinity},{grams:100001},{grams:'100'},{revision:1},{note:'x'.repeat(2001)}])invalid.push({...batch,items:[batch.items[0],{...batch.items[1],...changes}]});
  for(const payload of invalid){assert.throws(()=>store.mutate(payload),e=>e.status===400);assert.deepEqual(store.read(),before);}
 }finally{store.close();rmSync(folder,{recursive:true,force:true});}
});

test('Diary renders one group per meal with portion totals and keeps every product action',()=>{
 const entry={id:'a',profileId:'janusz',date:batch.date,productId:product.id,productName:'Ryż',grams:100,meal:'Obiad',note:'Ugotowane',revision:1,kcal:100,protein:10,carbs:12,fat:3};
 const entries=[entry,{...entry,id:'b',productName:'Jajko',meal:'Śniadanie',grams:50,kcal:80},{...entry,id:'c',productName:'Fasola',grams:150,kcal:200},{...entry,id:'d',productName:'Historyczny produkt',meal:'Inny posiłek'}];
 const markup=renderToStaticMarkup(createElement(DiaryEntries,{entries,edit:()=>{},remove:()=>{}}));
 assert.equal((markup.match(/<tbody/g)||[]).length,3);
 assert.equal((markup.match(/aria-label="Obiad"/g)||[]).length,1);
 assert.ok(markup.indexOf('aria-label="Śniadanie"')<markup.indexOf('aria-label="Obiad"'));
 assert.match(markup,/<th scope="row">Obiad<\/th><td>250 g<\/td><td>300<\/td>/);
 assert.match(markup,/<tfoot><tr><td>Razem<\/td><td>400 g<\/td><td>480<\/td>/);
 for(const row of entries){assert.ok(markup.includes('aria-label="Edytuj '+row.productName+'"'));assert.ok(markup.includes('aria-label="Usuń '+row.productName+'"'));}
 assert.match(markup,/Inny posiłek/);assert.match(markup,/Ugotowane/);
});

test('Diary form shares the planner food picker and preserves historical preview when editing',()=>{
 const chosen={...product,kind:'product',archived:0,revision:2,totalWeight:null,ingredients:[],kcal:999};
 const props={products:[chosen],profileId:'janusz',date:batch.date,busy:false,submit:async()=>true,close:()=>{}};
 let markup=renderToStaticMarkup(createElement(EntryForm,props));
 assert.match(markup,/Dodaj kolejną pozycję/);assert.match(markup,/Szukaj produktu lub dania/);assert.doesNotMatch(markup,/Własny tekst/);
 assert.match(markup,/<button class="btn primary" disabled="">Zapisz/);
 markup=renderToStaticMarkup(createElement(EntryForm,{...props,entry:{id:'old',productId:product.id,profileId:'janusz',date:batch.date,meal:'Obiad',note:'',grams:150,kcal:150,protein:15,carbs:18,fat:4.5,revision:1,productName:'Ryż'}}));
 assert.match(markup,/150 <span>kcal<\/span>/);assert.doesNotMatch(markup,/Dodaj kolejną pozycję/);
 assert.match(markup,/Gramatura — Ryż/);
});

test('HTTP API accepts a diary batch and rejects a bad second row without partial writes',async()=>{
 const folder=dir(),server=createApp({dataDir:folder});server.listen(0,'127.0.0.1');await once(server,'listening');
 const base='http://127.0.0.1:'+server.address().port;
 const post=payload=>fetch(base+'/api/data',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify(payload)});
 try{
  for(const p of [product,other])assert.equal((await post(p)).status,200);
  assert.equal((await post({...batch,items:[batch.items[0],{...batch.items[1],productId:'missing'}]})).status,404);
  let data=await (await fetch(base+'/api/data')).json();assert.ok(!data.entries.some(e=>e.id==='diary-first'));
  assert.equal((await post(batch)).status,200);
  data=await (await fetch(base+'/api/data')).json();assert.equal(data.entries.filter(e=>batch.items.some(item=>item.id===e.id)).length,2);
 }finally{server.close();await once(server,'close');rmSync(folder,{recursive:true,force:true});}
});
