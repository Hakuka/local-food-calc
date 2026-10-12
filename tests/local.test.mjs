import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {DatabaseSync} from 'node:sqlite';
import {openStore} from '../server/storage.mjs';
import {createApp} from '../server/index.mjs';
const dir=()=>mkdtempSync(join(tmpdir(),'diet-local-test-'));
const product={action:'product',id:'test-product',name:'Test produktu',kcal:100,protein:10,carbs:12,fat:3,note:'Notatka do produktu'};
const entry={action:'entry',id:'test-entry',profileId:'grazyna',date:'2026-10-11',productId:'test-product',grams:150,meal:'Obiad',note:'Notatka wpisu'};
const secondProduct={...product,id:'second-product',name:'Drugi składnik',kcal:300,protein:20,carbs:40,fat:10};
const dish={action:'product',kind:'dish',id:'test-dish',name:'Testowe danie',note:'Po ugotowaniu',totalWeight:250,ingredients:[{productId:product.id,grams:200},{productId:secondProduct.id,grams:100}]};

test('Dish values use finished weight, ignore supplied macros and preserve recipes across restarts',()=>{
 const folder=dir();let s=openStore(folder);
 try{
  s.mutate(product);s.mutate(secondProduct);s.mutate({...dish,kcal:999,protein:999,carbs:999,fat:999});
  s.close();s=openStore(folder);
  let saved=s.read().products.find(p=>p.id===dish.id);
  assert.equal(saved.kind,'dish');assert.equal(saved.totalWeight,250);assert.deepEqual(saved.ingredients,dish.ingredients);
  assert.equal(saved.kcal,200);assert.equal(saved.protein,16);assert.equal(saved.carbs,25.6);assert.equal(saved.fat,6.4);
  s.mutate({...dish,revision:1,totalWeight:500});
  saved=s.read().products.find(p=>p.id===dish.id);
  assert.equal(saved.kcal,100);assert.equal(saved.protein,8);assert.equal(saved.carbs,12.8);assert.equal(saved.fat,3.2);
  s.mutate({...dish,revision:2,totalWeight:100,ingredients:[{productId:product.id,grams:50},{productId:product.id,grams:50}]});
  assert.equal(s.read().products.find(p=>p.id===dish.id).kcal,100);
 }finally{s.close();rmSync(folder,{recursive:true,force:true});}
});

test('Dish edits recalculate ingredients and preserve historical diary portions and revisions',()=>{
 const folder=dir();const s=openStore(folder);
 try{
  s.mutate(product);s.mutate(secondProduct);s.mutate(dish);
  const dishEntry={...entry,productId:dish.id,grams:150};s.mutate(dishEntry);
  s.mutate({...product,revision:1,kcal:200});
  assert.equal(s.read().products.find(p=>p.id===dish.id).kcal,200);
  s.mutate({...dish,revision:1});
  assert.equal(s.read().products.find(p=>p.id===dish.id).kcal,280);
  assert.throws(()=>s.mutate({...dish,revision:1,totalWeight:400}),e=>e.status===409);
  assert.equal(s.read().products.find(p=>p.id===dish.id).totalWeight,250);
  assert.equal(s.read().entries.find(e=>e.id===entry.id).kcal,300);
  s.mutate({...dishEntry,revision:1,grams:300});
  assert.equal(s.read().entries.find(e=>e.id===entry.id).kcal,600);
  s.mutate({...dishEntry,id:'new-dish-entry'});
  assert.equal(s.read().entries.find(e=>e.id==='new-dish-entry').kcal,420);
 }finally{s.close();rmSync(folder,{recursive:true,force:true});}
});

test('Dishes require valid ingredients and a positive finished weight; failed saves do not persist',()=>{
 const folder=dir();const s=openStore(folder);
 try{
  s.mutate(product);s.mutate(secondProduct);
  for(const totalWeight of [undefined,null,0,-1,NaN,Infinity,100001])assert.throws(()=>s.mutate({...dish,totalWeight}),e=>e.status===400);
  for(const ingredients of [undefined,null,[],Array(201).fill(dish.ingredients[0]),[null],[{productId:'',grams:100}],[{productId:product.id,grams:0}],[{productId:product.id,grams:-5}],[{productId:product.id,grams:'100'}],[{productId:product.id,grams:Infinity}],[{productId:dish.id,grams:100}]])assert.throws(()=>s.mutate({...dish,ingredients}),e=>e.status===400);
  assert.throws(()=>s.mutate({...dish,ingredients:[{productId:'missing',grams:100}]}),e=>e.status===404);
  assert.throws(()=>s.mutate({...dish,totalWeight:Number.MIN_VALUE}),e=>e.status===400);
  assert.equal(s.read().products.some(p=>p.id===dish.id),false);
  s.mutate(dish);
  assert.throws(()=>s.mutate({...dish,id:'other-dish',name:'Inne danie',ingredients:[{productId:dish.id,grams:100}]}),e=>e.status===400);
 }finally{s.close();rmSync(folder,{recursive:true,force:true});}
});

test('Archived ingredients remain editable in existing recipes and cannot be added to new recipes',()=>{
 const folder=dir();const s=openStore(folder);
 try{
  s.mutate(product);s.mutate(secondProduct);s.mutate(dish);
  s.mutate({action:'archive',id:product.id,revision:1,archived:1});
  s.mutate({...dish,revision:1,totalWeight:500});
  assert.equal(s.read().products.find(p=>p.id===dish.id).kcal,100);
  assert.throws(()=>s.mutate({...dish,id:'other-dish',name:'Inne danie'}),e=>e.status===400);
 }finally{s.close();rmSync(folder,{recursive:true,force:true});}
});

test('Legacy databases gain recipe fields without changing history or existing product values',()=>{
 const folder=dir();let s=openStore(folder);
 try{
  s.mutate(product);s.mutate(entry);const before=s.read();s.close();
  const legacy=new DatabaseSync(join(folder,'dieta.sqlite'));
  try{legacy.exec('ALTER TABLE products DROP COLUMN kind; ALTER TABLE products DROP COLUMN totalWeight; ALTER TABLE products DROP COLUMN ingredients');}finally{legacy.close();}
  s=openStore(folder);assert.deepEqual(s.read(),before);
  assert.ok(s.read().products.every(p=>p.kind==='product'&&p.totalWeight===null&&p.ingredients.length===0));
  s.mutate(secondProduct);s.mutate(dish);
  assert.equal(s.read().products.find(p=>p.id===dish.id).kcal,200);
 }finally{s.close();rmSync(folder,{recursive:true,force:true});}
});

test('First launch creates an empty database with both profiles and their goals',()=>{
 const folder=dir();const s=openStore(folder);
 try{const d=s.read();assert.deepEqual(d.products,[]);assert.deepEqual(d.entries,[]);assert.deepEqual(d.logs,[]);
 assert.deepEqual(d.profiles.map(p=>({...p})),[{id:'janusz',name:'Janusz',kcal:2550,protein:147,carbs:293,fat:89,revision:1},{id:'grazyna',name:'Grażyna',kcal:1750,protein:92,carbs:210,fat:60,revision:1}]);
 }finally{s.close();rmSync(folder,{recursive:true,force:true});}
});
test('Database and notes survive restart; seed does not duplicate data',()=>{
 const folder=dir();let s=openStore(folder);
 try{s.mutate(product);s.mutate(entry);s.mutate({action:'log',profileId:'grazyna',date:'2026-10-11',weight:63.2,note:'Notatka dzienna'});s.close();s=openStore(folder);const d=s.read();assert.equal(d.products.length,1);assert.equal(d.entries.length,1);assert.equal(d.profiles.length,2);assert.equal(d.entries.find(e=>e.id==='test-entry').kcal,150);assert.equal(d.logs.find(l=>l.id==='grazyna-2026-10-11').weight,63.2);assert.equal(d.products.find(p=>p.id==='test-product').note,product.note);}
 finally{s.close();rmSync(folder,{recursive:true,force:true});}
});

test('Manufacturer can be added, edited, cleared and persisted across restarts',()=>{
 const folder=dir();let s=openStore(folder);
 try{
  s.mutate({...product,name:'  Test produktu  ',manufacturer:'  Producent próbny  '});
  let saved=s.read().products.find(p=>p.id===product.id);
  assert.equal(saved.name,product.name);assert.equal(saved.manufacturer,'Producent próbny');
  s.mutate({...product,revision:1,manufacturer:'Inny producent'});
  s.close();s=openStore(folder);saved=s.read().products.find(p=>p.id===product.id);
  assert.equal(saved.manufacturer,'Inny producent');assert.equal(saved.revision,2);
  s.mutate({...product,revision:2,manufacturer:''});
  assert.equal(s.read().products.find(p=>p.id===product.id).manufacturer,'');
  s.mutate({...product,id:'without-manufacturer',name:'Bez producenta'});
  assert.equal(s.read().products.find(p=>p.id==='without-manufacturer').manufacturer,'');
 }finally{s.close();rmSync(folder,{recursive:true,force:true});}
});

test('Product name is required for creation and editing; manufacturer is optional and validated',()=>{
 const folder=dir();const s=openStore(folder);
 try{
  for(const name of [undefined,null,'','   ','\t\n'])assert.throws(()=>s.mutate({...product,name}),e=>e.status===400);
  for(const manufacturer of [null,123,'x'.repeat(301)])assert.throws(()=>s.mutate({...product,manufacturer}),e=>e.status===400);
  s.mutate(product);
  for(const name of [undefined,null,'','   ','\t\n'])assert.throws(()=>s.mutate({...product,revision:1,name}),e=>e.status===400);
  const saved=s.read().products.find(p=>p.id===product.id);
  assert.equal(saved.name,product.name);assert.equal(saved.revision,1);
 }finally{s.close();rmSync(folder,{recursive:true,force:true});}
});

test('Existing databases gain manufacturer without changing products or historical data',()=>{
 const folder=dir();let s=openStore(folder);
 try{
  s.mutate(product);s.mutate(entry);s.mutate({action:'archive',id:product.id,revision:1,archived:1});
  const before=s.read();s.close();
  const legacy=new DatabaseSync(join(folder,'dieta.sqlite'));
  try{legacy.exec('ALTER TABLE products DROP COLUMN manufacturer');}finally{legacy.close();}
  s=openStore(folder);const after=s.read();
  assert.deepEqual(after,before);assert.ok(after.products.every(p=>p.manufacturer===''));
  s.mutate({...product,revision:2,manufacturer:'Producent po migracji'});
  s.close();s=openStore(folder);
  const saved=s.read().products.find(p=>p.id===product.id);
  assert.equal(saved.manufacturer,'Producent po migracji');assert.equal(saved.archived,1);assert.equal(saved.revision,3);
  assert.deepEqual(s.read().entries,before.entries);
 }finally{s.close();rmSync(folder,{recursive:true,force:true});}
});
test('Editing catalog preserves snapshots; changing grams scales the historical values',()=>{
 const folder=dir();const s=openStore(folder);
 try{s.mutate(product);s.mutate(entry);s.mutate({...product,revision:1,kcal:200});assert.equal(s.read().entries.find(e=>e.id==='test-entry').kcal,150);s.mutate({...entry,revision:1,grams:300});assert.equal(s.read().entries.find(e=>e.id==='test-entry').kcal,300);s.mutate({...entry,id:'new-entry'});assert.equal(s.read().entries.find(e=>e.id==='new-entry').kcal,300);assert.equal(s.read().entries.filter(e=>e.profileId==='janusz').length,0);}
 finally{s.close();rmSync(folder,{recursive:true,force:true});}
});
test('Concurrent edits and stale deletions are rejected without overwriting data',()=>{
 const folder=dir();const s=openStore(folder);
 try{s.mutate(product);s.mutate({...product,revision:1,kcal:200});assert.throws(()=>s.mutate({...product,revision:1,kcal:300}),e=>e.status===409);assert.equal(s.read().products.find(p=>p.id==='test-product').kcal,200);s.mutate(entry);s.mutate({...entry,revision:1,grams:200});assert.throws(()=>s.mutate({action:'deleteEntry',id:'test-entry',revision:1}),e=>e.status===409);s.mutate({action:'deleteEntry',id:'test-entry',revision:2});assert.equal(s.read().entries.some(e=>e.id==='test-entry'),false);}
 finally{s.close();rmSync(folder,{recursive:true,force:true});}
});
test('Validation rejects invalid dates/grams and archive preserves history',()=>{
 const folder=dir();const s=openStore(folder);
 try{s.mutate(product);assert.throws(()=>s.mutate({...entry,date:'2026-02-30'}),e=>e.status===400);assert.throws(()=>s.mutate({...entry,grams:-5}),e=>e.status===400);s.mutate(entry);s.mutate({action:'archive',id:'test-product',revision:1,archived:1});assert.throws(()=>s.mutate({...entry,id:'new'}),e=>e.status===400);assert.equal(s.read().entries.find(e=>e.id==='test-entry').kcal,150);s.mutate({...entry,revision:1,grams:300});assert.equal(s.read().entries.find(e=>e.id==='test-entry').kcal,300);}
 finally{s.close();rmSync(folder,{recursive:true,force:true});}
});
test('Assigning a date to a draft preserves imported nutrients',()=>{
 const folder=dir();let s=openStore(folder);
 try{
  s.mutate(product);s.mutate(entry);s.close();
  const legacy=new DatabaseSync(join(folder,'dieta.sqlite'));
  try{legacy.prepare('UPDATE entries SET date=? WHERE id=?').run('',entry.id);}finally{legacy.close();}
  s=openStore(folder);
  const e=s.read().entries.find(e=>!e.date);s.mutate({...e,action:'entry',date:'2026-10-11'});const saved=s.read().entries.find(row=>row.id===e.id);assert.equal(saved.date,'2026-10-11');assert.equal(saved.kcal,e.kcal);assert.equal(s.read().entries.filter(e=>!e.date).length,0);}
 finally{s.close();rmSync(folder,{recursive:true,force:true});}
});
test('Local HTTP API reads/writes SQLite, rejects foreign origins, serves bundled UI',async()=>{
 const folder=dir();const server=createApp({dataDir:folder});server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
 try{let r=await fetch(base+'/api/data');assert.equal(r.status,200);assert.equal((await r.json()).products.length,0);
 r=await fetch(base+'/api/data',{method:'POST',headers:{Origin:'https://foreign.test','Content-Type':'application/json'},body:JSON.stringify(product)});assert.equal(r.status,403);
 r=await fetch(base+'/api/data',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify(product)});assert.equal(r.status,200);
 r=await fetch(base+'/api/data');assert.equal((await r.json()).products.some(p=>p.id==='test-product'),true);
 r=await fetch(base+'/');assert.equal(r.status,200);assert.match(await r.text(),/Dieta domowa/);
 r=await fetch(base+'/data/dieta.sqlite');assert.equal(r.status,404);
 }finally{server.close();await once(server,'close');rmSync(folder,{recursive:true,force:true});}
});
