import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export const macroKeys=['kcal','protein','carbs','fat'];
export const meals=['Bez kategorii','Śniadanie','Obiad','Kolacja','Przekąska'];
export class AppError extends Error {constructor(message,status=400){super(message);this.status=status;}}
const portion=(p,grams)=>Object.fromEntries(macroKeys.map(k=>[k,p[k]*grams/100]));
const schema=`
CREATE TABLE IF NOT EXISTS profiles (id TEXT PRIMARY KEY,name TEXT NOT NULL,kcal REAL NOT NULL,protein REAL NOT NULL,carbs REAL NOT NULL,fat REAL NOT NULL,revision INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY,name TEXT NOT NULL,manufacturer TEXT NOT NULL DEFAULT '',kcal REAL NOT NULL,protein REAL NOT NULL,carbs REAL NOT NULL,fat REAL NOT NULL,note TEXT NOT NULL DEFAULT '',archived INTEGER NOT NULL DEFAULT 0,revision INTEGER NOT NULL DEFAULT 1,kind TEXT NOT NULL DEFAULT 'product',totalWeight REAL,ingredients TEXT NOT NULL DEFAULT '[]');
CREATE TABLE IF NOT EXISTS entries (id TEXT PRIMARY KEY,profileId TEXT NOT NULL REFERENCES profiles(id),date TEXT NOT NULL,productId TEXT NOT NULL REFERENCES products(id),productName TEXT NOT NULL,grams REAL NOT NULL,meal TEXT NOT NULL DEFAULT 'Bez kategorii',note TEXT NOT NULL DEFAULT '',kcal REAL NOT NULL,protein REAL NOT NULL,carbs REAL NOT NULL,fat REAL NOT NULL,revision INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS day_logs (id TEXT PRIMARY KEY,profileId TEXT NOT NULL REFERENCES profiles(id),date TEXT NOT NULL,weight REAL,note TEXT NOT NULL DEFAULT '',revision INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS plans (id TEXT PRIMARY KEY,profileId TEXT NOT NULL REFERENCES profiles(id),date TEXT NOT NULL,kind TEXT NOT NULL,productId TEXT REFERENCES products(id),productName TEXT NOT NULL DEFAULT '',grams REAL,meal TEXT NOT NULL DEFAULT 'Bez kategorii',note TEXT NOT NULL DEFAULT '',kcal REAL NOT NULL DEFAULT 0,protein REAL NOT NULL DEFAULT 0,carbs REAL NOT NULL DEFAULT 0,fat REAL NOT NULL DEFAULT 0,revision INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS plan_meal_notes (id TEXT PRIMARY KEY,profileId TEXT NOT NULL REFERENCES profiles(id),date TEXT NOT NULL,meal TEXT NOT NULL,note TEXT NOT NULL DEFAULT '',revision INTEGER NOT NULL DEFAULT 1,UNIQUE(profileId,date,meal));
CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS entries_profile_date ON entries(profileId,date);
CREATE INDEX IF NOT EXISTS logs_profile_date ON day_logs(profileId,date);
CREATE INDEX IF NOT EXISTS plans_profile_date ON plans(profileId,date);
`;

function validate(input){
 if(!input||typeof input!=='object'||Array.isArray(input))throw new AppError('Nieprawidłowe dane.');
 const a={...input};
 const text=(key,max=2000,required=false)=>{if(typeof a[key]!=='string'||a[key].length>max||(required&&!a[key].trim()))throw new AppError('Sprawdź pole: '+key+'.');};
 const num=(key,min,max)=>{if(typeof a[key]!=='number'||!Number.isFinite(a[key])||a[key]<min||a[key]>max)throw new AppError('Sprawdź wartość: '+key+'.');};
 const id=()=>text('id',100,true);
 const revision=(required=false)=>{if(required||a.revision!==undefined){num('revision',1,Number.MAX_SAFE_INTEGER);if(!Number.isInteger(a.revision))throw new AppError('Nieprawidłowa wersja wpisu.');}};
 const profile=()=>{if(!['janusz','grazyna'].includes(a.profileId))throw new AppError('Nieprawidłowy profil.');};
 const date=(key='date')=>{text(key,10,true);const d=new Date(a[key]+'T12:00:00Z');if(!/^\d{4}-\d{2}-\d{2}$/.test(a[key])||!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==a[key])throw new AppError('Nieprawidłowa data.');};
 const macros=()=>{for(const k of macroKeys)num(k,0,k==='kcal'?100000:10000);};
 const mealNote=()=>{
  if(a.mealNote===undefined)return;
  const n=a.mealNote;
  if(!n||typeof n!=='object'||Array.isArray(n)||typeof n.note!=='string'||n.note.length>4000||n.revision!==undefined&&(!Number.isSafeInteger(n.revision)||n.revision<1))throw new AppError('Nieprawidłowa notatka posiłku.');
  a.mealNote={note:n.note.trim(),revision:n.revision};
 };
 switch(a.action){
  case 'product':
   id();revision();text('name',300,true);a.name=a.name.trim();if(a.manufacturer===undefined)a.manufacturer='';text('manufacturer',300);a.manufacturer=a.manufacturer.trim();text('note');
   if(a.kind===undefined)a.kind='product';
   if(!['product','dish'].includes(a.kind))throw new AppError('Wybierz produkt lub danie.');
   if(a.kind==='dish'){
    num('totalWeight',Number.MIN_VALUE,100000);
    if(!Array.isArray(a.ingredients)||!a.ingredients.length||a.ingredients.length>200)throw new AppError('Dodaj od 1 do 200 składników dania.');
    a.ingredients=a.ingredients.map(ingredient=>{
     if(!ingredient||typeof ingredient!=='object'||typeof ingredient.productId!=='string'||!ingredient.productId.trim()||ingredient.productId.length>100||typeof ingredient.grams!=='number'||!Number.isFinite(ingredient.grams)||ingredient.grams<=0||ingredient.grams>100000)throw new AppError('Wybierz produkt i podaj dodatnią gramaturę każdego składnika.');
     if(ingredient.productId===a.id)throw new AppError('Danie nie może być własnym składnikiem.');
     return {productId:ingredient.productId,grams:ingredient.grams};
    });
   }else{macros();a.totalWeight=null;a.ingredients=[];}
   break;
  case 'archive':id();revision(true);if(a.archived!==0&&a.archived!==1)throw new AppError('Nieprawidłowa wartość archiwizacji.');break;
  case 'profile':id();if(!['janusz','grazyna'].includes(a.id))throw new AppError('Nieprawidłowy profil.');revision(true);macros();break;
  case 'entry':id();revision();profile();date();text('productId',100,true);num('grams',Number.MIN_VALUE,100000);text('note');if(!meals.includes(a.meal))throw new AppError('Nieprawidłowy posiłek.');break;
  case 'entryBatch':
   profile();date();
   if(!meals.includes(a.meal))throw new AppError('Nieprawidłowy posiłek.');
   if(!Array.isArray(a.items)||!a.items.length||a.items.length>100)throw new AppError('Dodaj od 1 do 100 produktów do posiłku.');
   a.items=a.items.map(item=>{
    if(!item||typeof item!=='object'||Array.isArray(item)||item.revision!==undefined)throw new AppError('Nieprawidłowy wpis posiłku.');
    return validate({...item,action:'entry',profileId:a.profileId,date:a.date,meal:a.meal});
   });
   if(new Set(a.items.map(item=>item.id)).size!==a.items.length)throw new AppError('Wpisy muszą mieć różne identyfikatory.');
   break;
  case 'deleteEntry':id();revision(true);break;
  case 'plan':
   id();revision();profile();date();
   if(!['food','note'].includes(a.kind))throw new AppError('Wybierz jedzenie lub notatkę.');
   if(!meals.includes(a.meal))throw new AppError('Nieprawidłowy posiłek.');
   text('note',2000,a.kind==='note');
   if(a.kind==='food'){text('productId',100,true);num('grams',Number.MIN_VALUE,100000);}
   else{a.productId=null;a.grams=null;a.note=a.note.trim();}
   mealNote();
   break;
  case 'deletePlan':id();profile();revision(true);break;
  case 'planMealEdit':
   profile();date();date('originalDate');mealNote();
   if(a.mealNote===undefined)throw new AppError('Podaj notatkę posiłku.');
   if(!meals.includes(a.meal)||!meals.includes(a.originalMeal))throw new AppError('Nieprawidłowy posiłek.');
   if(a.originalNoteRevision!==undefined&&(!Number.isSafeInteger(a.originalNoteRevision)||a.originalNoteRevision<1))throw new AppError('Nieprawidłowa wersja notatki.');
   if(!Array.isArray(a.originals)||!a.originals.length||a.originals.length>1000||!Array.isArray(a.items)||a.items.length>1000)throw new AppError('Nieprawidłowe pozycje posiłku.');
   a.originals=a.originals.map(item=>validate({...item,action:'deletePlan',profileId:a.profileId}));
   a.items=a.items.map(item=>validate({...item,action:'plan',profileId:a.profileId,date:a.date,meal:a.meal}));
   if(new Set(a.originals.map(item=>item.id)).size!==a.originals.length||new Set(a.items.map(item=>item.id)).size!==a.items.length)throw new AppError('Pozycje planu muszą mieć różne identyfikatory.');
   break;
  case 'planBatch':
   profile();date();
   mealNote();
   if(!meals.includes(a.meal))throw new AppError('Nieprawidłowy posiłek.');
   if(a.alsoOther===undefined)a.alsoOther=false;
   if(typeof a.alsoOther!=='boolean')throw new AppError('Nieprawidłowy wybór drugiej osoby.');
   if(!Array.isArray(a.items)||!a.items.length||a.items.length>100)throw new AppError('Dodaj od 1 do 100 pozycji planu.');
   a.items=a.items.map(item=>{
    if(!item||typeof item!=='object'||Array.isArray(item)||item.revision!==undefined)throw new AppError('Nieprawidłowa pozycja planu.');
    return validate({...item,action:'plan',profileId:a.profileId,date:a.date,meal:a.meal});
   });
   if(new Set(a.items.map(item=>item.id)).size!==a.items.length)throw new AppError('Pozycje planu muszą mieć różne identyfikatory.');
   break;
  case 'planMealNote':
   profile();date();
   if(!meals.includes(a.meal))throw new AppError('Nieprawidłowy posiłek.');
   if(a.mealNote===undefined)throw new AppError('Podaj notatkę posiłku.');
   mealNote();break;
  case 'log':profile();date();revision();text('note',4000);if(a.weight!==null)num('weight',1,500);break;
  default:throw new AppError('Nieznana operacja.');
 }
 return a;
}

export function openStore(dataDir=process.env.DATA_DIR||resolve(root,'data')){
 mkdirSync(dataDir,{recursive:true});
 const db=new DatabaseSync(resolve(dataDir,'dieta.sqlite'));
 db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
 db.exec(schema);
 function transaction(callback){db.exec('BEGIN IMMEDIATE');try{const result=callback();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}}
 transaction(()=>{
  if(!db.prepare('PRAGMA table_info(products)').all().some(column=>column.name==='manufacturer'))db.exec("ALTER TABLE products ADD COLUMN manufacturer TEXT NOT NULL DEFAULT ''");
  const productColumns=db.prepare('PRAGMA table_info(products)').all().map(column=>column.name);
  if(!productColumns.includes('kind'))db.exec("ALTER TABLE products ADD COLUMN kind TEXT NOT NULL DEFAULT 'product'");
  if(!productColumns.includes('totalWeight'))db.exec('ALTER TABLE products ADD COLUMN totalWeight REAL');
  if(!productColumns.includes('ingredients'))db.exec("ALTER TABLE products ADD COLUMN ingredients TEXT NOT NULL DEFAULT '[]'");
  if(db.prepare("SELECT value FROM metadata WHERE key='excel_import_v1'").get())return;
  const seed=JSON.parse(readFileSync(resolve(root,'lib/seed.json'),'utf8'));
  const insertProfile=db.prepare('INSERT OR IGNORE INTO profiles (id,name,kcal,protein,carbs,fat) VALUES (?,?,?,?,?,?)');
  for(const p of seed.profiles)insertProfile.run(p.id,p.name,p.kcal,p.protein,p.carbs,p.fat);
  const insertProduct=db.prepare('INSERT OR IGNORE INTO products (id,name,manufacturer,kcal,protein,carbs,fat,note,archived) VALUES (?,?,?,?,?,?,?,?,?)');
  for(const p of seed.products)insertProduct.run(p.id,p.name,p.manufacturer??'',p.kcal,p.protein,p.carbs,p.fat,p.note,p.archived);
  const insertEntry=db.prepare('INSERT OR IGNORE INTO entries (id,profileId,date,productId,productName,grams,meal,note,kcal,protein,carbs,fat) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
  for(const e of seed.entries)insertEntry.run(e.id,e.profileId,e.date,e.productId,e.productName,e.grams,e.meal,e.note,e.kcal,e.protein,e.carbs,e.fat);
  for(const l of seed.logs)db.prepare('INSERT OR IGNORE INTO day_logs (id,profileId,date,weight,note) VALUES (?,?,?,?,?)').run(l.id,l.profileId,l.date,l.weight,l.note);
  db.prepare("INSERT INTO metadata (key,value) VALUES ('excel_import_v1','done')").run();
 });
 function read(){return {products:db.prepare('SELECT * FROM products ORDER BY name COLLATE NOCASE').all().map(p=>({...p,ingredients:JSON.parse(p.ingredients)})),profiles:db.prepare('SELECT * FROM profiles ORDER BY id DESC').all(),entries:db.prepare('SELECT * FROM entries ORDER BY date DESC,id').all(),logs:db.prepare('SELECT * FROM day_logs ORDER BY date DESC').all(),plans:db.prepare('SELECT * FROM plans ORDER BY date,id').all(),planMealNotes:db.prepare('SELECT * FROM plan_meal_notes ORDER BY date,meal').all()};}
 function saveMealNote(a,merge=false){
  const current=db.prepare('SELECT * FROM plan_meal_notes WHERE profileId=? AND date=? AND meal=?').get(a.profileId,a.date,a.meal);
  const n=a.mealNote;
  if(!merge&&current?.revision!==n.revision)throw new AppError('Notatka posiłku zmieniła się na innym urządzeniu. Odśwież widok i spróbuj ponownie.',409);
  const note=merge?[...new Set([...(current?.note.split('\n')||[]),...n.note.split('\n')].map(line=>line.trim()).filter(Boolean))].join('\n'):n.note;
  if(!current&&!note)return {changes:1};
  if(current?.note===note)return {changes:1};
  return current?db.prepare('UPDATE plan_meal_notes SET note=?,revision=revision+1 WHERE id=? AND revision=?').run(note,current.id,current.revision):db.prepare('INSERT INTO plan_meal_notes (id,profileId,date,meal,note) VALUES (?,?,?,?,?)').run(randomUUID(),a.profileId,a.date,a.meal,note);
 }
 // Preserve old food annotations once, as a single note for each meal.
 transaction(()=>{
  const legacy=db.prepare("SELECT * FROM plans WHERE kind='food' AND length(trim(note))>0").all();
  for(const item of legacy)saveMealNote({...item,mealNote:{note:item.note.trim()}},true);
  if(legacy.length)db.exec("UPDATE plans SET note='',revision=revision+1 WHERE kind='food' AND length(trim(note))>0");
 });
 function savePlan(a){
  let result;
   const old=a.revision?db.prepare('SELECT * FROM plans WHERE id=? AND profileId=?').get(a.id,a.profileId):null;
   if(a.revision&&!old)throw new AppError('Nie znaleziono pozycji planu.',404);
   let name='',m=Object.fromEntries(macroKeys.map(k=>[k,0]));
   if(a.kind==='food'){
    const p=db.prepare('SELECT * FROM products WHERE id=?').get(a.productId);
    if(!p)throw new AppError('Nie znaleziono produktu.',404);
    if(p.archived&&old?.productId!==p.id)throw new AppError('Ten produkt jest zarchiwizowany.');
    // Keep the values used when planning, just as diary entries keep snapshots.
    const same=old?.kind==='food'&&old.productId===p.id;
    m=same?portion(Object.fromEntries(macroKeys.map(k=>[k,old[k]*100/old.grams])),a.grams):portion(p,a.grams);
    name=same?old.productName:p.name;
   }
   result=a.revision?db.prepare('UPDATE plans SET date=?,kind=?,productId=?,productName=?,grams=?,meal=?,note=?,kcal=?,protein=?,carbs=?,fat=?,revision=revision+1 WHERE id=? AND profileId=? AND revision=?').run(a.date,a.kind,a.productId,name,a.grams,a.meal,a.note,m.kcal,m.protein,m.carbs,m.fat,a.id,a.profileId,a.revision):db.prepare('INSERT INTO plans (id,profileId,date,kind,productId,productName,grams,meal,note,kcal,protein,carbs,fat) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(a.id,a.profileId,a.date,a.kind,a.productId,name,a.grams,a.meal,a.note,m.kcal,m.protein,m.carbs,m.fat);

  return result;
 }
 function saveEntry(a){
  const p=db.prepare('SELECT * FROM products WHERE id=?').get(a.productId);if(!p)throw new AppError('Nie znaleziono produktu.',404);
  const old=a.revision?db.prepare('SELECT * FROM entries WHERE id=? AND profileId=?').get(a.id,a.profileId):null;
  if(a.revision&&!old)throw new AppError('Nie znaleziono wpisu.',404);
  if(p.archived&&old?.productId!==p.id)throw new AppError('Ten produkt jest zarchiwizowany.');
  const m=old&&old.productId===p.id?portion(Object.fromEntries(macroKeys.map(k=>[k,old[k]*100/old.grams])),a.grams):portion(p,a.grams);
  const name=old&&old.productId===p.id?old.productName:p.name;
  return a.revision?db.prepare('UPDATE entries SET date=?,productId=?,productName=?,grams=?,meal=?,note=?,kcal=?,protein=?,carbs=?,fat=?,revision=revision+1 WHERE id=? AND profileId=? AND revision=?').run(a.date,p.id,name,a.grams,a.meal,a.note,m.kcal,m.protein,m.carbs,m.fat,a.id,a.profileId,a.revision):db.prepare('INSERT INTO entries (id,profileId,date,productId,productName,grams,meal,note,kcal,protein,carbs,fat) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(a.id,a.profileId,a.date,p.id,name,a.grams,a.meal,a.note,m.kcal,m.protein,m.carbs,m.fat);
 }
 function mutate(input){const a=validate(input);return transaction(()=>{
  let result;
  if(a.action==='entryBatch'){
   for(const item of a.items){
    if(db.prepare('SELECT id FROM entries WHERE id=?').get(item.id))throw new AppError('Ten wpis już istnieje.',409);
    saveEntry(item);
   }
   return {ok:true};
  }
  if(a.action==='planMealEdit'){
   const conflict=()=>{throw new AppError('Posiłek zmienił się na innym urządzeniu. Odśwież widok i spróbuj ponownie.',409);};
   const current=db.prepare('SELECT id,revision FROM plans WHERE profileId=? AND date=? AND meal=?').all(a.profileId,a.originalDate,a.originalMeal);
   if(current.length!==a.originals.length||current.some(p=>!a.originals.some(old=>old.id===p.id&&old.revision===p.revision)))conflict();
   const sourceNote=db.prepare('SELECT * FROM plan_meal_notes WHERE profileId=? AND date=? AND meal=?').get(a.profileId,a.originalDate,a.originalMeal);
   if(sourceNote?.revision!==a.originalNoteRevision)conflict();
   for(const item of a.items){
    const old=current.find(p=>p.id===item.id);
    if(old?item.revision!==old.revision:item.revision!==undefined||db.prepare('SELECT id FROM plans WHERE id=?').get(item.id))conflict();
    if(!savePlan(item).changes)conflict();
   }
   for(const old of current)if(!a.items.some(item=>item.id===old.id))db.prepare('DELETE FROM plans WHERE id=? AND profileId=? AND revision=?').run(old.id,a.profileId,old.revision);
   if(a.mealNote)saveMealNote(a);
   const moved=a.date!==a.originalDate||a.meal!==a.originalMeal;
   if(moved&&sourceNote?.note)saveMealNote({profileId:a.profileId,date:a.originalDate,meal:a.originalMeal,mealNote:{note:'',revision:sourceNote.revision}});
   return {ok:true};
  }
  if(a.action==='planBatch'){
   for(const item of a.items){
    if(db.prepare('SELECT id FROM plans WHERE id=?').get(item.id))throw new AppError('Ta pozycja planu już istnieje.',409);
    savePlan(item);
    if(a.alsoOther)savePlan({...item,id:randomUUID(),profileId:a.profileId==='janusz'?'grazyna':'janusz'});
   }
   if(a.mealNote){
    saveMealNote(a);
    if(a.alsoOther&&a.mealNote.note)saveMealNote({...a,profileId:a.profileId==='janusz'?'grazyna':'janusz'},true);
   }
   return {ok:true};
  }
  if(a.action==='product'){
   const duplicate=db.prepare('SELECT id,name FROM products WHERE archived=0 AND id!=?').all(a.id).some(p=>p.name.toLocaleLowerCase('pl')===a.name.toLocaleLowerCase('pl'));
   if(duplicate)throw new AppError('Produkt o tej nazwie już istnieje.',409);
   if(a.kind==='dish'){
    const totals=Object.fromEntries(macroKeys.map(k=>[k,0]));
    const old=a.revision?db.prepare('SELECT ingredients FROM products WHERE id=?').get(a.id):null;
    const oldIngredients=old?JSON.parse(old.ingredients):[];
    for(const ingredient of a.ingredients){
     const p=db.prepare('SELECT * FROM products WHERE id=?').get(ingredient.productId);
     if(!p)throw new AppError('Nie znaleziono produktu wybranego jako składnik.',404);
     if(p.kind==='dish')throw new AppError('Jako składnik wybierz produkt.');
     if(p.archived&&!oldIngredients.some(i=>i.productId===p.id))throw new AppError('Nie można dodać zarchiwizowanego produktu jako składnika.');
     const values=portion(p,ingredient.grams);
     for(const k of macroKeys)totals[k]+=values[k];
    }
    for(const k of macroKeys){a[k]=totals[k]*100/a.totalWeight;if(!Number.isFinite(a[k])||a[k]>(k==='kcal'?100000:10000))throw new AppError('Wartości na 100 g są zbyt duże. Sprawdź gramatury i wagę całego dania.');}
   }
   const ingredients=JSON.stringify(a.ingredients);
   result=a.revision?db.prepare('UPDATE products SET name=?,manufacturer=?,kcal=?,protein=?,carbs=?,fat=?,note=?,kind=?,totalWeight=?,ingredients=?,revision=revision+1 WHERE id=? AND revision=?').run(a.name,a.manufacturer,a.kcal,a.protein,a.carbs,a.fat,a.note,a.kind,a.totalWeight,ingredients,a.id,a.revision):db.prepare('INSERT INTO products (id,name,manufacturer,kcal,protein,carbs,fat,note,kind,totalWeight,ingredients) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(a.id,a.name,a.manufacturer,a.kcal,a.protein,a.carbs,a.fat,a.note,a.kind,a.totalWeight,ingredients);
  }else if(a.action==='archive')result=db.prepare('UPDATE products SET archived=?,revision=revision+1 WHERE id=? AND revision=?').run(a.archived,a.id,a.revision);
  else if(a.action==='profile')result=db.prepare('UPDATE profiles SET kcal=?,protein=?,carbs=?,fat=?,revision=revision+1 WHERE id=? AND revision=?').run(a.kcal,a.protein,a.carbs,a.fat,a.id,a.revision);
  else if(a.action==='entry')result=saveEntry(a);
  else if(a.action==='deleteEntry')result=db.prepare('DELETE FROM entries WHERE id=? AND revision=?').run(a.id,a.revision);
  else if(a.action==='plan'){result=savePlan(a);if(result.changes&&a.mealNote)saveMealNote(a);}
  else if(a.action==='planMealNote')result=saveMealNote(a);
  else if(a.action==='deletePlan')result=db.prepare('DELETE FROM plans WHERE id=? AND profileId=? AND revision=?').run(a.id,a.profileId,a.revision);
  else {const logId=a.profileId+'-'+a.date;result=a.revision?db.prepare('UPDATE day_logs SET weight=?,note=?,revision=revision+1 WHERE id=? AND revision=?').run(a.weight,a.note,logId,a.revision):db.prepare('INSERT OR IGNORE INTO day_logs (id,profileId,date,weight,note) VALUES (?,?,?,?,?)').run(logId,a.profileId,a.date,a.weight,a.note);}
  if(!result.changes)throw new AppError('Dane zmieniły się na innym urządzeniu. Odśwież widok i spróbuj ponownie.',409);
  return {ok:true};
 });}
 return {read,mutate,close:()=>db.close()};
}
