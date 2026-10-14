import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {DatabaseSync} from 'node:sqlite';
import ts from 'typescript';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {openStore} from '../server/storage.mjs';
import {createApp} from '../server/index.mjs';

// Load the actual frontend helpers and components with the project's compiler.
function moduleUrl(path,imports={}){
 let {outputText}=ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}});
 for(const [name,url] of Object.entries(imports))outputText=outputText.replaceAll(`from '${name}'`,`from '${url}'`).replaceAll(`from "${name}"`,`from "${url}"`);
 return 'data:text/javascript;base64,'+Buffer.from(outputText).toString('base64');
}
const idsUrl=moduleUrl('../lib/id.ts');
const typesUrl=moduleUrl('../lib/types.ts');
const calculationsUrl=moduleUrl('../lib/calculations.ts',{'./types':typesUrl});
const {startOfWeek,plannerDates,navigatePlanner,plannedDayTotals,plannedPortion,shoppingLists,sumMacros,today,dateLabel}=await import(calculationsUrl);
const {Planner,PlanForm,MealNoteForm,ShoppingResults}=await import(moduleUrl('../app/planner.tsx',{'../lib/types':typesUrl,'../lib/calculations':calculationsUrl,'../lib/id':idsUrl,react:import.meta.resolve('react'),'react/jsx-runtime':import.meta.resolve('react/jsx-runtime'),'lucide-react':import.meta.resolve('lucide-react')}));
const product={action:'product',id:'planner-product',name:'Ryż do planu',manufacturer:'Test',kcal:100,protein:10,carbs:12,fat:3,note:''};
const plan={action:'plan',id:'planned-food',profileId:'janusz',date:'2026-10-19',kind:'food',productId:product.id,grams:150,meal:'Obiad',note:''};
const note={...plan,id:'planned-note',kind:'note',productId:null,grams:null,note:'Zamawiamy pizzę'};
const dir=()=>mkdtempSync(join(tmpdir(),'diet-planner-test-'));

test('New planner forms render over HTTP when crypto.randomUUID is unavailable',t=>{
 const native=globalThis.crypto;
 t.mock.getter(globalThis,'crypto',()=>({getRandomValues:native.getRandomValues.bind(native)}));
 const html=renderToStaticMarkup(createElement(PlanForm,{products:[],plans:[],profileId:'janusz',date:'2026-10-19',busy:false,submit:async()=>true,close:()=>{},remove:()=>{}}));
 assert.match(html,/Szukaj produktu lub dania/);assert.match(html,/Dodaj kolejną pozycję/);
});

test('Planner opens on Monday and includes complete weeks across months, years and DST',()=>{
 for(const [date,monday] of [['2026-10-14','2026-10-12'],['2026-10-18','2026-10-12'],['2026-10-19','2026-10-19'],['2027-01-01','2026-12-28'],['2026-03-29','2026-03-23'],['2026-10-25','2026-10-19']]){
  assert.equal(startOfWeek(date),monday);
  const week=plannerDates(date,'week'),month=plannerDates(date,'month');
  assert.equal(week.length,7);assert.equal(week[0],monday);assert.equal(month[0],monday);
  assert.ok(month.length>=7&&month.length<=42);assert.equal(month.length%7,0);
  const d=new Date(date+'T12:00Z'),end=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0,12)).toISOString().slice(0,10);
  assert.ok(month.includes(end));assert.equal(Date.parse(month.at(-1))-Date.parse(startOfWeek(end)),6*86400000);
  assert.equal(new Date(month.at(-1)+'T12:00Z').getUTCDay(),0);
  for(let i=1;i<month.length;i++)assert.equal(Date.parse(month[i])-Date.parse(month[i-1]),86400000);
 }
 assert.equal(plannerDates('2027-02-01','month').length,28);
 assert.equal(plannerDates('2028-02-07','month').length,28);
 assert.equal(plannerDates('2026-10-14','month').at(-1),'2026-11-01');
 assert.equal(plannerDates('2027-11-15','month').at(-1),'2027-12-05'); // month ends on Tuesday
 assert.equal(plannerDates('2026-11-01','month').at(-1),'2026-12-06'); // week starts in October
 assert.equal(plannerDates('2026-10-31','month').length,7);
});

test('Plans and notes persist separately from diaries, logs and profile goals',()=>{
 const folder=dir();let s=openStore(folder);
 try{
  const before=s.read();s.mutate(product);s.mutate(plan);s.mutate({...note,kcal:999,protein:999,carbs:999,fat:999});
  s.mutate({...plan,id:'other-profile',profileId:'grazyna',grams:200});
  s.close();s=openStore(folder);const d=s.read();
  assert.deepEqual(d.entries,before.entries);assert.deepEqual(d.logs,before.logs);assert.deepEqual(d.profiles,before.profiles);
  const food=d.plans.find(p=>p.id===plan.id),savedNote=d.plans.find(p=>p.id===note.id);
  assert.equal(food.kcal,150);assert.equal(food.protein,15);assert.equal(food.carbs,18);assert.equal(food.fat,4.5);
  assert.equal(savedNote.note,note.note);assert.equal(savedNote.grams,null);assert.equal(savedNote.productId,null);
  for(const k of ['kcal','protein','carbs','fat'])assert.equal(savedNote[k],0);
  assert.equal(d.plans.find(p=>p.id==='other-profile').kcal,200);
 }finally{s.close();rmSync(folder,{recursive:true,force:true});}
});

test('Range navigation is reversible and moves between calendar months or weeks',()=>{
 for(const start of ['2027-01-18','2027-02-01','2027-03-01','2028-02-07'])for(const view of ['week','month']){
  const initial={start,past:[],future:[]};const next=navigatePlanner(initial,view,1),previous=navigatePlanner(initial,view,-1);
  assert.equal(navigatePlanner(next,view,-1).start,start);assert.equal(navigatePlanner(previous,view,1).start,start);
  if(view==='week'){
   assert.equal(Date.parse(next.start)-Date.parse(start),7*86400000);
   assert.equal(Date.parse(start)-Date.parse(previous.start),7*86400000);
  }else{
   const d=new Date(start+'T12:00Z');
   assert.equal(next.start,new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1)).toISOString().slice(0,10));
   assert.equal(previous.start,new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()-1,1)).toISOString().slice(0,10));
  }
 }
});

test('Planner preview replaces edited portions, handles moves and excludes notes and other profiles',()=>{
 const folder=dir();const s=openStore(folder);
 try{
  s.mutate(product);s.mutate(plan);s.mutate(note);s.mutate({...plan,id:'other',profileId:'grazyna',grams:900});
  const data=s.read(),item=data.plans.find(p=>p.id===plan.id),p=data.products.find(p=>p.id===product.id);
  assert.equal(plannedDayTotals(data.plans,'janusz',plan.date).saved.kcal,150);
  const preview=plannedPortion(item,p,300);assert.equal(preview.kcal,300);
  const totals=plannedDayTotals(data.plans,'janusz',plan.date,item.id,preview);
  assert.equal(totals.saved.kcal,150);assert.equal(totals.after.kcal,300);
  assert.equal(plannedDayTotals(data.plans,'janusz',plan.date,undefined,preview).after.kcal,450);
  assert.equal(plannedDayTotals(data.plans,'janusz','2026-10-20',item.id,preview).after.kcal,300);
  assert.equal(plannedDayTotals(data.plans,'janusz',plan.date,item.id,null).after.kcal,0);
  assert.equal(plannedDayTotals(data.plans,'janusz',plan.date,note.id,null).after.kcal,150);
  const dinner=sumMacros([plannedPortion(undefined,p,100),plannedPortion(undefined,p,250)]);
  assert.equal(plannedDayTotals(data.plans,'janusz',plan.date,undefined,dinner).after.kcal,500);
 }finally{s.close();rmSync(folder,{recursive:true,force:true});}
});

test('Plans capture product/dish values; edits scale snapshots and switching to a note clears macros',()=>{
 const folder=dir();const s=openStore(folder);
 try{
  s.mutate(product);s.mutate(plan);s.mutate({...product,revision:1,kcal:200});
  let data=s.read(),item=data.plans.find(p=>p.id===plan.id),p=data.products.find(p=>p.id===product.id);
  assert.equal(plannedPortion(item,p,300).kcal,300);
  s.mutate({...plan,revision:1,grams:300,date:'2026-10-20'});
  s.mutate({...plan,id:'new-plan'});
  assert.equal(s.read().plans.find(p=>p.id===plan.id).kcal,300);assert.equal(s.read().plans.find(p=>p.id==='new-plan').kcal,300);
  s.mutate({...product,id:'dish',name:'Danie do planu',kind:'dish',totalWeight:200,ingredients:[{productId:product.id,grams:100}]});
  s.mutate({...plan,id:'dish-plan',productId:'dish',grams:200});
  assert.equal(s.read().plans.find(p=>p.id==='dish-plan').kcal,200);
  s.mutate({...note,id:plan.id,revision:2});item=s.read().plans.find(p=>p.id===plan.id);
  assert.equal(item.kind,'note');assert.equal(item.kcal,0);assert.equal(item.grams,null);assert.equal(item.productName,'');
 }finally{s.close();rmSync(folder,{recursive:true,force:true});}
});

test('Planner validation, archiving and concurrent edits protect saved plans',()=>{
 const folder=dir();const s=openStore(folder);
 try{
  s.mutate(product);
  for(const changes of [{date:'2026-02-30'},{date:''},{grams:0},{grams:-1},{grams:100001},{grams:'100'},{kind:'unknown'},{profileId:'missing'},{meal:'missing'}])assert.throws(()=>s.mutate({...plan,...changes}),e=>e.status===400);
  for(const text of ['', '   ', null, 'x'.repeat(2001)])assert.throws(()=>s.mutate({...note,note:text}),e=>e.status===400);
  assert.throws(()=>s.mutate({...plan,productId:'missing'}),e=>e.status===404);
  assert.equal(s.read().plans.length,0);s.mutate(plan);
  s.mutate({...plan,revision:1,grams:200});
  assert.throws(()=>s.mutate({...plan,revision:1,grams:300}),e=>e.status===409);
  assert.throws(()=>s.mutate({action:'deletePlan',id:plan.id,profileId:'janusz',revision:1}),e=>e.status===409);
  assert.throws(()=>s.mutate({action:'deletePlan',id:plan.id,profileId:'grazyna',revision:2}),e=>e.status===409);
  s.mutate({action:'archive',id:product.id,revision:1,archived:1});
  assert.throws(()=>s.mutate({...plan,id:'archived'}),e=>e.status===400);
  s.mutate({...plan,revision:2,grams:300});assert.equal(s.read().plans[0].kcal,300);
  s.mutate({action:'deletePlan',id:plan.id,profileId:'janusz',revision:3});assert.equal(s.read().plans.length,0);
 }finally{s.close();rmSync(folder,{recursive:true,force:true});}
});

test('Existing databases gain planner storage without altering prior data',()=>{
 const folder=dir();let s=openStore(folder);
 try{
  s.mutate(product);const before=s.read();s.close();
  const old=new DatabaseSync(join(folder,'dieta.sqlite'));try{old.exec('DROP TABLE plans');}finally{old.close();}
  s=openStore(folder);assert.deepEqual(s.read(),before);s.mutate(plan);assert.equal(s.read().plans.length,1);
 }finally{s.close();rmSync(folder,{recursive:true,force:true});}
});

test('Calendar displays plans without nutritional totals; editor displays saved and replacement totals',()=>{
 const folder=dir();const s=openStore(folder);
 try{
  s.mutate(product);s.mutate({...plan,date:today()});s.mutate({...note,date:today()});const d=s.read();
  const calendar=renderToStaticMarkup(createElement(Planner,{plans:d.plans,add:()=>{},edit:()=>{}}));
  assert.match(calendar,/Ryż do planu/);assert.match(calendar,/Zamawiamy pizzę/);assert.match(calendar,/150 g/);
  assert.doesNotMatch(calendar,/150 kcal/);assert.match(calendar,/aria-pressed="true">Miesiąc/);
  assert.equal((calendar.match(/class="planner-day/g)||[]).length,plannerDates(today(),'month').length);
  const firstDay=calendar.slice(calendar.indexOf('class="planner-day'));
  assert.ok(firstDay.indexOf('<header>')<firstDay.indexOf('class="planner-add"'));
  assert.ok(firstDay.indexOf('class="planner-add"')<firstDay.indexOf('class="planner-items"'));
  assert.match(calendar,/heading-title-row.*Data planera/);
  assert.doesNotMatch(calendar,/class="date-context"/);
  const visibleDates=plannerDates(today(),'month');
  const displayedRange=dateLabel(visibleDates[0],{day:'numeric',month:'short',year:'numeric'})+' – '+dateLabel(visibleDates.at(-1),{day:'numeric',month:'short',year:'numeric'});
  assert.equal(calendar.split(displayedRange).length-1,1);assert.match(calendar,/planner-range-picker/);
  assert.match(calendar,/class="btn secondary planner-current-week"/);
  assert.match(calendar,/Wygeneruj tygodniową listę zakupów/);assert.match(calendar,/Ogólna lista zakupów/);
  const form=renderToStaticMarkup(createElement(PlanForm,{item:d.plans.find(p=>p.id===plan.id),products:d.products,plans:d.plans,profileId:'janusz',date:today(),busy:false,submit:async()=>true,close:()=>{},remove:()=>{}}));
  assert.match(form,/Już zapisane/);assert.match(form,/Ta porcja/);assert.match(form,/Po zapisaniu/);
  assert.equal((form.match(/150 kcal/g)||[]).length,3);
  assert.doesNotMatch(form,/Planujesz posiłki na/);assert.doesNotMatch(form,/Dodaj również drugiej osobie/);
  const adding=renderToStaticMarkup(createElement(PlanForm,{product:d.products.find(p=>p.id===product.id),products:d.products,plans:[...d.plans,{...d.plans[0],id:'partner',profileId:'grazyna',kcal:9876}],profileId:'janusz',date:today(),busy:false,submit:async()=>true,close:()=>{},remove:()=>{}}));
  assert.match(adding,/Dodaj kolejną pozycję/);assert.match(adding,/Dodaj również drugiej osobie/);assert.match(adding,/Dodawane pozycje/);
  assert.doesNotMatch(adding,/9876|9\s?876/);assert.doesNotMatch(adding,/Planujesz posiłki na/);
  assert.equal((adding.match(/>Notatka do posiłku</g)||[]).length,1);
  assert.match(adding,/class="plan-food-line".*class="plan-grams"/);
 }finally{s.close();rmSync(folder,{recursive:true,force:true});}
});

test('Shopping lists sum foods across days and meals, with separate totals for each visible week',()=>{
 const folder=dir();const s=openStore(folder);
 try{
  s.mutate(product);
  s.mutate({...plan,date:'2026-10-19',grams:100});
  s.mutate({...plan,id:'same-day',date:'2026-10-19',meal:'Kolacja',grams:50});
  s.mutate({...plan,id:'end-of-week',date:'2026-10-25',grams:75});
  s.mutate({...plan,id:'next-week',date:'2026-10-26',grams:300});
  s.mutate({...plan,id:'before-range',date:'2026-10-18',grams:999});
  s.mutate({...plan,id:'after-range',date:'2026-11-02',grams:999});
  const data=s.read(),before=s.read(),dates=plannerDates('2026-10-19','month');
  const weekly=shoppingLists(data.plans,data.products,dates,'weekly');
  assert.equal(weekly.length,2);assert.equal(weekly[0].start,'2026-10-19');assert.equal(weekly[0].end,'2026-10-25');
  assert.equal(weekly[0].items.length,1);assert.equal(weekly[0].items[0].grams,225);
  assert.equal(weekly[1].items[0].grams,300);
  const overall=shoppingLists(data.plans,data.products,dates,'overall');assert.equal(overall.length,1);assert.equal(overall[0].items[0].grams,525);
  const week=shoppingLists(data.plans,data.products,plannerDates('2026-10-19','week'),'weekly');assert.equal(week.length,1);assert.equal(week[0].items[0].grams,225);
  assert.deepEqual(data,before);assert.deepEqual(s.read(),before);
 }finally{s.close();rmSync(folder,{recursive:true,force:true});}
});

test('Shopping lists expand dish portions by finished weight and combine ingredients with direct products',()=>{
 const folder=dir();const s=openStore(folder);
 try{
  s.mutate(product);s.mutate({...product,id:'butter',name:'Masło do testowej listy',manufacturer:'Inny producent'});
  s.mutate({...product,id:'dish',name:'Gotowy obiad',kind:'dish',totalWeight:400,ingredients:[{productId:product.id,grams:200},{productId:'butter',grams:50}]});
  s.mutate({...plan,productId:'dish',grams:200});
  s.mutate({...plan,id:'direct-rice',grams:50});
  s.mutate({...plan,id:'second-dish',date:'2026-10-20',productId:'dish',grams:100});
  s.mutate({action:'archive',id:'butter',revision:1,archived:1});
  const data=s.read(),list=shoppingLists(data.plans,data.products,plannerDates(plan.date,'week'),'overall')[0];
  assert.equal(list.items.length,2);assert.equal(list.items.find(p=>p.productId===product.id).grams,200);
  assert.equal(list.items.find(p=>p.productId==='butter').grams,37.5);
  assert.equal(list.items.find(p=>p.productId==='butter').manufacturer,'Inny producent');
  assert.ok(!list.items.some(p=>p.productId==='dish'));
  const fallback=shoppingLists(data.plans,[],plannerDates(plan.date,'week'),'overall')[0];
  assert.equal(fallback.items.find(p=>p.productId==='dish').name,'Gotowy obiad');assert.equal(fallback.items.find(p=>p.productId==='dish').grams,300);
 }finally{s.close();rmSync(folder,{recursive:true,force:true});}
});

test('Shopping lists show notes separately and include every visible week even when empty',()=>{
 const folder=dir();const s=openStore(folder);
 try{
  s.mutate({...note,date:'2026-10-21'});
  s.mutate({action:'planMealNote',profileId:'janusz',date:'2026-10-26',meal:'Obiad',mealNote:{note:'Przygotować wcześniej'}});
  s.mutate({action:'planMealNote',profileId:'janusz',date:'2026-11-02',meal:'Obiad',mealNote:{note:'Poza zakresem'}});
  const data=s.read(),dates=plannerDates('2026-10-05','month');
  const weekly=shoppingLists(data.plans,data.products,dates,'weekly',data.planMealNotes);
  assert.equal(weekly.length,4);assert.ok(weekly.every(list=>list.items.length===0));
  assert.equal(weekly[2].notes[0].note,note.note);assert.equal(weekly[3].notes[0].note,'Przygotować wcześniej');
  const overall=shoppingLists(data.plans,data.products,dates,'overall',data.planMealNotes);assert.equal(overall[0].notes.length,2);
  assert.equal(shoppingLists([],[],plannerDates('2026-08-01','month'),'weekly').length,6);
  assert.deepEqual(shoppingLists(data.plans,data.products,[],'weekly'),[]);
  const rendered=renderToStaticMarkup(createElement(ShoppingResults,{lists:weekly,mode:'weekly',close:()=>{}}));
  assert.equal((rendered.match(/class="shopping-list"/g)||[]).length,4);assert.match(rendered,/Zamawiamy pizzę/);
  assert.match(rendered,/Brak produktów do kupienia/);assert.doesNotMatch(rendered,/Poza zakresem/);
 }finally{s.close();rmSync(folder,{recursive:true,force:true});}
});

test('Shopping lists keep products with different IDs separate and show one combined list for the range',()=>{
 const folder=dir();const s=openStore(folder);
 try{
  s.mutate(product);s.mutate({...product,id:'other',name:'Drugi ryż'});
  s.mutate(plan);s.mutate({...plan,id:'other-item',productId:'other',grams:75});
  const data=s.read(),lists=shoppingLists(data.plans,data.products,plannerDates(plan.date,'week'),'overall');
  assert.equal(lists.length,1);assert.equal(lists[0].items.length,2);
  const html=renderToStaticMarkup(createElement(ShoppingResults,{lists,mode:'overall',close:()=>{}}));
  assert.match(html,/Ogólna lista zakupów/);assert.match(html,/150 g/);assert.match(html,/75 g/);
  assert.equal((html.match(/class="shopping-list"/g)||[]).length,1);assert.doesNotMatch(html,/kcal/);
 }finally{s.close();rmSync(folder,{recursive:true,force:true});}
});

test('A shared meal note survives adding more foods, editing portions and restart',()=>{
 const folder=dir();let s=openStore(folder);
 try{
  s.mutate(product);const before=s.read();
  const batch={action:'planBatch',profileId:'janusz',date:plan.date,meal:'Śniadanie',items:[plan,{...plan,id:'bread',grams:50}],mealNote:{note:'Podgrzać pieczywo'}};
  s.mutate(batch);let data=s.read();assert.equal(data.planMealNotes.length,1);
  assert.equal(data.planMealNotes[0].note,'Podgrzać pieczywo');assert.ok(data.plans.every(p=>p.note===''));
  s.mutate({...batch,items:[{...plan,id:'butter',grams:10}],mealNote:undefined});
  data=s.read();assert.equal(data.plans.length,3);assert.equal(data.planMealNotes.length,1);
  s.mutate({...data.plans[0],action:'plan',grams:200});
  assert.equal(s.read().planMealNotes[0].note,'Podgrzać pieczywo');
  const n=s.read().planMealNotes[0];
  s.mutate({action:'planMealNote',profileId:n.profileId,date:n.date,meal:n.meal,mealNote:{note:'Zjeść na ciepło',revision:n.revision}});
  assert.equal(s.read().planMealNotes[0].note,'Zjeść na ciepło');
  assert.deepEqual(s.read().entries,before.entries);assert.deepEqual(s.read().logs,before.logs);
  const saved=s.read();s.close();s=openStore(folder);assert.deepEqual(s.read(),saved);
  const updated=s.read().planMealNotes[0];
  s.mutate({action:'planMealNote',profileId:updated.profileId,date:updated.date,meal:updated.meal,mealNote:{note:'',revision:updated.revision}});
  assert.equal(s.read().planMealNotes[0].note,'');assert.equal(s.read().plans.length,3);
 }finally{s.close();rmSync(folder,{recursive:true,force:true});}
});

test('Shared meal notes are copied once and remain independent between meals, days and profiles',()=>{
 const folder=dir();const s=openStore(folder);
 try{
  s.mutate(product);
  const batch={action:'planBatch',profileId:'janusz',date:plan.date,meal:'Obiad',alsoOther:true,items:[plan,{...plan,id:'second',grams:250}],mealNote:{note:'Wspólna notatka'}};
  s.mutate(batch);let notes=s.read().planMealNotes;assert.equal(notes.length,2);
  const first=notes.find(n=>n.profileId==='janusz'),second=notes.find(n=>n.profileId==='grazyna');
  assert.notEqual(first.id,second.id);assert.equal(first.note,second.note);
  s.mutate({action:'planMealNote',profileId:second.profileId,date:second.date,meal:second.meal,mealNote:{note:'Druga osoba',revision:second.revision}});
  assert.equal(s.read().planMealNotes.find(n=>n.id===first.id).note,'Wspólna notatka');
  s.mutate({...batch,items:[{...plan,id:'third'}],mealNote:{note:first.note,revision:first.revision}});
  notes=s.read().planMealNotes;assert.equal(notes.length,2);
  assert.equal(notes.find(n=>n.id===second.id).note,'Druga osoba\nWspólna notatka');
  s.mutate({...batch,items:[{...plan,id:'fourth'}],mealNote:{note:first.note,revision:first.revision}});
  assert.equal(s.read().planMealNotes.find(n=>n.id===second.id).note,'Druga osoba\nWspólna notatka');
  s.mutate({...batch,meal:'Kolacja',items:[{...plan,id:'dinner'}]});
  s.mutate({...batch,date:'2026-10-20',items:[{...plan,id:'tomorrow'}]});
  assert.equal(s.read().planMealNotes.length,6);
 }finally{s.close();rmSync(folder,{recursive:true,force:true});}
});

test('Invalid and stale shared notes reject whole batches and portion edits atomically',()=>{
 const folder=dir();const s=openStore(folder);
 try{
  s.mutate(product);const batch={action:'planBatch',profileId:'janusz',date:plan.date,meal:'Obiad',alsoOther:true,items:[plan],mealNote:{note:'Pierwsza'}};
  for(const mealNote of [null,[],{note:1},{note:'x'.repeat(4001)},{note:'X',revision:0},{note:'X',revision:1.5}])assert.throws(()=>s.mutate({...batch,mealNote}),e=>e.status===400);
  assert.equal(s.read().plans.length,0);assert.equal(s.read().planMealNotes.length,0);
  s.mutate(batch);const before=s.read();
  assert.throws(()=>s.mutate({...batch,items:[{...plan,id:'stale'}]}),e=>e.status===409);assert.deepEqual(s.read(),before);
  const row=before.plans.find(p=>p.profileId==='janusz');
  assert.throws(()=>s.mutate({...row,action:'plan',grams:999,mealNote:{note:'Zła wersja',revision:7}}),e=>e.status===409);assert.deepEqual(s.read(),before);
  assert.throws(()=>s.mutate({action:'planMealNote',profileId:'janusz',date:plan.date,meal:'Obiad'}),e=>e.status===400);
 }finally{s.close();rmSync(folder,{recursive:true,force:true});}
});

test('Legacy product annotations migrate into one meal note without losing text or food data',()=>{
 const folder=dir();let s=openStore(folder);
 try{
  s.mutate(product);s.mutate({...plan,note:'Na ciepło'});s.mutate({...plan,id:'second',note:'Bez soli'});s.mutate({...plan,id:'third',note:'Na ciepło'});s.mutate(note);
  const before=s.read();s.close();s=openStore(folder);const after=s.read();
  assert.equal(after.planMealNotes.length,1);assert.equal(after.planMealNotes[0].note,'Na ciepło\nBez soli');
  assert.ok(after.plans.filter(p=>p.kind==='food').every(p=>p.note===''));
  assert.equal(after.plans.find(p=>p.id===note.id).note,note.note);
  for(const row of before.plans)assert.equal(after.plans.find(p=>p.id===row.id).kcal,row.kcal);
  assert.deepEqual(after.entries,before.entries);s.close();s=openStore(folder);assert.deepEqual(s.read(),after);
 }finally{s.close();rmSync(folder,{recursive:true,force:true});}
});

test('Calendar shows one shared note per meal and the editor uses the selected meal note only',()=>{
 const folder=dir();const s=openStore(folder);
 try{
  s.mutate(product);s.mutate({action:'planBatch',profileId:'janusz',date:today(),meal:'Śniadanie',items:[plan,{...plan,id:'second'}],mealNote:{note:'Wspólna uwaga'}});
  const data=s.read(),n=data.planMealNotes[0];
  const calendar=renderToStaticMarkup(createElement(Planner,{plans:data.plans,mealNotes:data.planMealNotes,add:()=>{},edit:()=>{},editMealNote:()=>{}}));
  assert.equal((calendar.match(/Wspólna uwaga/g)||[]).length,1);
  const form=renderToStaticMarkup(createElement(PlanForm,{item:data.plans[0],products:data.products,plans:data.plans,mealNotes:data.planMealNotes,profileId:'janusz',date:today(),busy:false,submit:async()=>true,close:()=>{},remove:()=>{}}));
  assert.equal((form.match(/>Notatka do posiłku</g)||[]).length,1);assert.match(form,/Wspólna uwaga/);
  const noteEditor=renderToStaticMarkup(createElement(MealNoteForm,{note:n,busy:false,submit:async()=>true,close:()=>{}}));assert.match(noteEditor,/Wspólna uwaga/);
 }finally{s.close();rmSync(folder,{recursive:true,force:true});}
});

test('Batch saves multiple foods and notes, optionally as independent copies for both profiles',()=>{
 const folder=dir();let s=openStore(folder);
 try{
  s.mutate(product);const before=s.read();
  const batch={action:'planBatch',profileId:'janusz',date:plan.date,meal:'Obiad',alsoOther:true,items:[plan,{...plan,id:'second-food',grams:250},note]};
  s.mutate(batch);let data=s.read();
  assert.equal(data.plans.length,6);assert.deepEqual(data.entries,before.entries);assert.deepEqual(data.logs,before.logs);
  for(const profileId of ['janusz','grazyna']){
   const items=data.plans.filter(p=>p.profileId===profileId);
   assert.equal(items.length,3);assert.ok(items.every(p=>p.date===plan.date&&p.meal==='Obiad'));
   assert.equal(plannedDayTotals(data.plans,profileId,plan.date).saved.kcal,400);
   assert.equal(items.find(p=>p.kind==='note').note,note.note);
  }
  const source=data.plans.find(p=>p.id===plan.id),copy=data.plans.find(p=>p.profileId==='grazyna'&&p.grams===150);
  assert.notEqual(source.id,copy.id);
  s.mutate({...copy,action:'plan',grams:300});
  assert.equal(s.read().plans.find(p=>p.id===source.id).grams,150);
  assert.equal(s.read().plans.find(p=>p.id===copy.id).grams,300);
  s.mutate({...source,action:'plan',grams:100});
  assert.equal(s.read().plans.find(p=>p.id===copy.id).grams,300);
  s.mutate({action:'deletePlan',id:source.id,profileId:'janusz',revision:2});
  assert.ok(s.read().plans.some(p=>p.id===copy.id));
  s.mutate({...batch,profileId:'grazyna',alsoOther:false,items:[{...note,id:'only-partner'}]});
  assert.equal(s.read().plans.filter(p=>p.profileId==='janusz').length,2);
  const saved=s.read();s.close();s=openStore(folder);assert.deepEqual(s.read(),saved);
 }finally{s.close();rmSync(folder,{recursive:true,force:true});}
});

test('Batch validation and failed saves roll back every item and both profile copies',()=>{
 const folder=dir();const s=openStore(folder);
 try{
  s.mutate(product);const batch={action:'planBatch',profileId:'janusz',date:plan.date,meal:'Obiad',alsoOther:true,items:[plan,note]};
  for(const changes of [{items:[]},{items:null},{items:[null]},{items:Array(101).fill(plan)},{items:[plan,plan]},{alsoOther:'yes'},{date:'2026-02-30'},{profileId:'missing'},{meal:'missing'},{items:[{...plan,revision:1}]},{items:[{...plan,grams:0}]}]){
   assert.throws(()=>s.mutate({...batch,...changes}),e=>e.status===400);assert.equal(s.read().plans.length,0);
  }
  assert.throws(()=>s.mutate({...batch,items:[plan,{...plan,id:'bad',productId:'missing'}]}),e=>e.status===404);
  assert.equal(s.read().plans.length,0);
  s.mutate(plan);const before=s.read();
  assert.throws(()=>s.mutate({...batch,items:[note,plan]}),e=>e.status===409);assert.deepEqual(s.read(),before);
  s.mutate({action:'archive',id:product.id,revision:1,archived:1});
  assert.throws(()=>s.mutate({...batch,items:[note,{...plan,id:'archived'}]}),e=>e.status===400);
  assert.equal(s.read().plans.length,1);
 }finally{s.close();rmSync(folder,{recursive:true,force:true});}
});

test('HTTP API saves and exports planner items independently from diary history',async()=>{
 const folder=dir();const server=createApp({dataDir:folder});server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
 try{
  const initial=await(await fetch(base+'/api/data')).json();assert.deepEqual(initial.plans,[]);
  for(const action of [product,plan,note]){
   const r=await fetch(base+'/api/data',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify(action)});assert.equal(r.status,200);
  }
  const exported=await(await fetch(base+'/api/data')).json();assert.equal(exported.plans.length,2);assert.deepEqual(exported.entries,initial.entries);
  const batch={action:'planBatch',profileId:'janusz',date:plan.date,meal:'Kolacja',alsoOther:true,items:[{...plan,id:'batch-food'},{...note,id:'batch-note'}]};
  const response=await fetch(base+'/api/data',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify(batch)});assert.equal(response.status,200);
  const withBatch=await(await fetch(base+'/api/data')).json();assert.equal(withBatch.plans.length,6);assert.deepEqual(withBatch.entries,initial.entries);
  assert.equal(withBatch.plans.filter(p=>p.profileId==='grazyna').length,2);
 }finally{server.close();await once(server,'close');rmSync(folder,{recursive:true,force:true});}
});
