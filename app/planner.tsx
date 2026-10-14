import {useId,useState,type FormEvent} from 'react';
import {CalendarDays,ChevronLeft,ChevronRight,Package,Plus,Search,ShoppingBasket,StickyNote,Trash2,X} from 'lucide-react';
import {type PlanItem,type PlanMealNote,type Product,macroKeys,macroLabels,meals} from '../lib/types';
import {dateLabel,navigatePlanner,plannerDates,plannedDayTotals,plannedPortion,shiftDate,shoppingLists,sumMacros,today,type PlannerRange,type ShoppingList} from '../lib/calculations';
import {createId} from '../lib/id';

const number=(n:number,digits=1)=>new Intl.NumberFormat('pl-PL',{maximumFractionDigits:digits}).format(n);
const normalize=(s:string)=>s.toLocaleLowerCase('pl').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ł/g,'l');
export const planName=(item:PlanItem)=>item.kind==='note'?item.note:item.productName;
const rangeLabel=(start:string,end:string)=>dateLabel(start,{day:'numeric',month:'short',year:'numeric'})+' – '+dateLabel(end,{day:'numeric',month:'short',year:'numeric'});

function PlannerDateControls({date,change,previous,next,label,rangeText,busy=false,required=false}:{date:string;change:(date:string)=>void;previous:()=>void;next:()=>void;label:string;rangeText?:string;busy?:boolean;required?:boolean}){
 const rangeId=useId();
 const showCalendar=(input:HTMLInputElement)=>{try{input.showPicker?.();}catch{}};
 return <div className="date-controls diary-date-controls planner-date-controls"><button type="button" className="icon-btn" aria-label={'Poprzedni — '+label} disabled={busy||!date} onClick={previous}><ChevronLeft size={19}/></button><label className={'date-picker'+(rangeText?' planner-range-picker':'')}>{rangeText&&<><span id={rangeId}>{rangeText}</span><CalendarDays size={16} aria-hidden="true"/></>}<input type="date" aria-label={label} aria-describedby={rangeText?rangeId:undefined} required={required} disabled={busy} value={date} onChange={e=>change(e.target.value)} onClick={e=>{if(rangeText)showCalendar(e.currentTarget);}} onKeyDown={e=>{if(rangeText&&(e.key==='Enter'||e.key===' ')){e.preventDefault();showCalendar(e.currentTarget);}}}/></label><button type="button" className="icon-btn" aria-label={'Następny — '+label} disabled={busy||!date} onClick={next}><ChevronRight size={19}/></button></div>;
}

export function Planner({plans,products=[],mealNotes=[],add,edit,editMealNote}:{plans:PlanItem[];products?:Product[];mealNotes?:PlanMealNote[];add:(date:string)=>void;edit:(item:PlanItem)=>void;editMealNote?:(note:PlanMealNote)=>void}){
 const [view,setView]=useState<'week'|'month'>('month');
 const [range,setRange]=useState<PlannerRange>(()=>({start:today(),past:[],future:[]}));const {start}=range;
 const dates=plannerDates(start,view);const current=today();
 const [shoppingMode,setShoppingMode]=useState<'weekly'|'overall'|null>(null);
 return <section className="planner" aria-label="Plan posiłków">
  <section className="page-heading diary-heading planner-heading"><div><p className="eyebrow">ZAPLANUJ SWÓJ TYDZIEŃ</p><div className="heading-title-row"><h1>Planer<span className="heading-dot">.</span></h1><PlannerDateControls date={start} label="Data planera" rangeText={rangeLabel(dates[0],dates.at(-1)!)} change={date=>{if(date)setRange({start:date,past:[],future:[]});}} previous={()=>setRange(current=>navigatePlanner(current,view,-1))} next={()=>setRange(current=>navigatePlanner(current,view,1))}/><div className="planner-toolbar">
   <div className="planner-controls"><button type="button" className="btn secondary planner-current-week" onClick={()=>setRange({start:today(),past:[],future:[]})}><CalendarDays size={16}/>Bieżący tydzień</button><div className="segmented" role="group" aria-label="Widok planera">{(['week','month'] as const).map(mode=><button key={mode} type="button" className={view===mode?'selected':''} aria-pressed={view===mode} onClick={()=>{setView(mode);setRange({start,past:[],future:[]});}}>{mode==='week'?'Tydzień':'Miesiąc'}</button>)}</div></div>
  </div></div></div></section>
  <div className="planner-scroll"><div className={'planner-calendar '+view}>
   <div className="planner-weekdays" aria-hidden="true">{['Poniedziałek','Wtorek','Środa','Czwartek','Piątek','Sobota','Niedziela'].map(day=><div key={day}>{day}</div>)}</div>
   <div className="planner-grid">{dates.map(day=>{
    const items=plans.filter(item=>item.date===day);
    const notes=mealNotes.filter(note=>note.date===day&&note.note);
    return <section key={day} className={'planner-day'+(day===current?' is-today':'')} aria-label={dateLabel(day)}>
     <header><time dateTime={day} aria-current={day===current?'date':undefined}>{dateLabel(day,{day:'numeric',month:'short'})}</time>{day===current&&<small>Dziś</small>}</header>
     <button type="button" className="planner-add" onClick={()=>add(day)} aria-label={'Dodaj do planu na '+dateLabel(day)}><Plus size={15}/>Dodaj pozycję</button>
     <ul className="planner-items">{items.map(item=><li key={item.id}><button type="button" className={'planner-item '+item.kind} onClick={()=>edit(item)} aria-label={'Edytuj plan: '+planName(item)}>{item.kind==='note'?<StickyNote size={14}/>:<Package size={14}/>}<span>{item.meal!=='Bez kategorii'&&<small>{item.meal}</small>}<span className="planner-item-name">{planName(item)}</span>{item.kind==='food'&&<small>{number(item.grams!)} g</small>}</span></button></li>)}{notes.map(note=><li key={note.id}><button type="button" className="planner-item note" onClick={()=>editMealNote?.(note)} aria-label={'Edytuj notatkę posiłku: '+note.meal}><StickyNote size={14}/><span><small>{note.meal}</small><span className="planner-item-name">{note.note}</span></span></button></li>)}</ul>
    </section>;
   })}</div>
  </div></div>
  <div className="planner-shopping-actions"><button type="button" className="btn primary" aria-expanded={shoppingMode==='weekly'} aria-controls={shoppingMode==='weekly'?'planner-shopping-results':undefined} onClick={()=>setShoppingMode('weekly')}><ShoppingBasket size={18}/>Wygeneruj tygodniową listę zakupów</button><button type="button" className="btn secondary" aria-expanded={shoppingMode==='overall'} aria-controls={shoppingMode==='overall'?'planner-shopping-results':undefined} onClick={()=>setShoppingMode('overall')}><ShoppingBasket size={18}/>Ogólna lista zakupów</button></div>
  {shoppingMode&&<ShoppingResults mode={shoppingMode} lists={shoppingLists(plans,products,dates,shoppingMode,mealNotes)} close={()=>setShoppingMode(null)}/>}
  <div className="info-line"><CalendarDays size={17}/>Planowane posiłki i notatki nie są wliczane do dziennika ani podsumowań. Wartości odżywcze zobaczysz podczas edycji planu.</div>
 </section>;
}

export function ShoppingResults({lists,mode,close}:{lists:ShoppingList[];mode:'weekly'|'overall';close:()=>void}){
 return <section id="planner-shopping-results" className="panel shopping-results" aria-label="Listy zakupów"><header className="panel-heading"><div><h2>{mode==='weekly'?'Tygodniowe listy zakupów':'Ogólna lista zakupów'}</h2><p>Produkty dla wybranego profilu. Dania są rozpisane na składniki według receptur z bazy.</p></div><button type="button" className="icon-btn" aria-label="Zamknij listę zakupów" onClick={close}><X size={18}/></button></header><div className={'shopping-lists '+mode+(lists.length===1?' single':'')}>{lists.map(list=><article className="shopping-list" key={list.start}><h3>{rangeLabel(list.start,list.end)}</h3>{list.items.length?<ul className="shopping-products">{list.items.map(item=><li key={item.productId}><span>{item.name}{item.manufacturer&&<small>{item.manufacturer}</small>}</span><strong>{number(item.grams)} g</strong></li>)}</ul>:<p className="shopping-empty">Brak produktów do kupienia w tym okresie.</p>}{list.notes.length>0&&<div className="shopping-notes"><h4>Notatki do planu</h4><ul>{list.notes.map(note=><li key={note.id}><small>{dateLabel(note.date,{day:'numeric',month:'short'})} · {note.meal}</small><p>{note.note}</p></li>)}</ul></div>}</article>)}</div></section>;
}

export type PlanDraft={id:string;kind:'food'|'note';productId:string;grams:string;note:string};
const emptyDraft=():PlanDraft=>({id:createId(),kind:'food',productId:'',grams:'100',note:''});
const validDraft=(row:PlanDraft)=>row.kind==='note'?!!row.note.trim():!!row.productId&&Number.isFinite(Number(row.grams))&&Number(row.grams)>0&&Number(row.grams)<=100000;

function PlanDraftRow({row,index,products,busy,change,remove}:{row:PlanDraft;index:number;products:Product[];busy:boolean;change:(row:PlanDraft)=>void;remove?:()=>void}){
 const group=useId();const [query,setQuery]=useState('');const chosen=products.find(p=>p.id===row.productId);
 const matches=products.filter(p=>!p.archived&&normalize(p.name+' '+p.manufacturer+' '+p.note).includes(normalize(query)));
 const selected=row.kind==='food'&&chosen;
 const removeButton=remove?<button type="button" className={'icon-btn danger'+(selected?'':' plan-row-remove')} aria-label={'Usuń pozycję '+(index+1)} onClick={remove}><Trash2 size={16}/></button>:null;
 return <fieldset className={'plan-draft'+(selected?' selected-food':'')} disabled={busy}>
  <legend className={selected?'sr-only':undefined}>Pozycja {index+1}</legend>
  {!selected&&<>{removeButton}<div className="item-kind"><div className="item-kind-options">{([{value:'food',label:'Produkt / danie',icon:Package},{value:'note',label:'Własny tekst',icon:StickyNote}] as const).map(option=><label key={option.value}><input type="radio" name={group} aria-label={option.label+' — pozycja '+(index+1)} checked={row.kind===option.value} onChange={()=>change({...row,kind:option.value})}/><span><option.icon size={16}/>{option.label}</span></label>)}</div></div></>}
  {row.kind==='food'&&(chosen?<div className="plan-food-line"><div className="chosen-product"><Package size={18}/><span>{chosen.name}{chosen.manufacturer&&<small className="muted"> · {chosen.manufacturer}</small>}</span><button type="button" className="text-btn" onClick={()=>{change({...row,productId:''});setQuery('');}}>Zmień</button></div><label className="plan-grams">Gramy (g)<input aria-label={'Gramatura — '+chosen.name} type="number" min="0.01" max="100000" step="any" required value={row.grams} onChange={e=>change({...row,grams:e.target.value})}/></label>{removeButton}</div>:<div className="product-picker"><div className="search-input"><Search size={17}/><input autoFocus aria-label={'Szukaj produktu lub dania — pozycja '+(index+1)} placeholder="Szukaj produktu lub dania…" value={query} onChange={e=>setQuery(e.target.value)}/></div><div className="picker-list">{matches.map(p=><button type="button" key={p.id} onClick={()=>change({...row,productId:p.id})}><span>{p.kind==='dish'?'(Danie) ':''}{p.name}{p.manufacturer&&<small> · {p.manufacturer}</small>}</span><small>{number(p.kcal,0)} kcal / 100 g</small></button>)}{!matches.length&&<p>Brak pasujących pozycji w bazie.</p>}</div></div>)}
  {row.kind==='note'&&<label>Własny tekst<textarea required maxLength={2000} rows={2} value={row.note} onChange={e=>change({...row,note:e.target.value})} placeholder="np. Zamawiamy pizzę"/></label>}
 </fieldset>;
}

export function PlanForm({item,product,products,plans,mealNotes=[],profileId,date,busy,submit,close,remove}:{item?:PlanItem;product?:Product;products:Product[];plans:PlanItem[];mealNotes?:PlanMealNote[];profileId:string;date:string;busy:boolean;submit:(payload:unknown)=>Promise<boolean>;close:()=>void;remove:(item:PlanItem)=>void}){
 const [rows,setRows]=useState<PlanDraft[]>(()=>[{id:item?.id||createId(),kind:item?.kind||'food',productId:product?.id||item?.productId||'',grams:item?.grams!=null?String(item.grams):'100',note:item?.note||''}]);
 const [day,setDay]=useState(item?.date||date);const [meal,setMeal]=useState(item?.meal||'Bez kategorii');const [alsoOther,setAlsoOther]=useState(false);const [error,setError]=useState('');
 const [noteDrafts,setNoteDrafts]=useState<Record<string,string>>({});
 const noteKey=day+'|'+meal;const mealNote=mealNotes.find(n=>n.profileId===profileId&&n.date===day&&n.meal===meal);
 const sharedNote=noteDrafts[noteKey]??mealNote?.note??'';
 const portions=rows.flatMap(row=>{
  const chosen=products.find(p=>p.id===row.productId);
  return row.kind==='food'&&chosen&&validDraft(row)?[plannedPortion(item,chosen,Number(row.grams))]:[];
 });
 const preview=portions.length?sumMacros(portions):null;
 const {saved,after}=plannedDayTotals(plans,profileId,day,item?.id,preview);
 const valid=rows.length>0&&rows.every(row=>validDraft(row)&&(row.kind==='note'||products.some(p=>p.id===row.productId)));
 async function save(e:FormEvent){
  e.preventDefault();setError('');
  if(!valid){setError('Uzupełnij każdą pozycję: wybierz jedzenie i gramaturę lub wpisz notatkę.');return;}
  const items=rows.map(row=>({id:row.id,kind:row.kind,productId:row.kind==='food'?row.productId:null,grams:row.kind==='food'?Number(row.grams):null,note:row.kind==='food'?'':row.note}));
  const shared=noteDrafts[noteKey]!==undefined||(!item&&alsoOther&&sharedNote.trim())?{mealNote:{note:sharedNote,revision:mealNote?.revision}}:{};
  const payload=item?{...items[0],action:'plan',revision:item.revision,profileId,date:day,meal,...shared}:{action:'planBatch',profileId,date:day,meal,alsoOther,items,...shared};
  if(await submit(payload))close();
 }
 return <form className="plan-form" onSubmit={save}>
  <fieldset className="plan-fields" disabled={busy}><div className="form-grid"><div className="plan-date-field"><span>Dzień</span><PlannerDateControls date={day} label="Dzień planowanego posiłku" required busy={busy} change={setDay} previous={()=>setDay(shiftDate(day,-1))} next={()=>setDay(shiftDate(day,1))}/></div><label>Posiłek<select value={meal} onChange={e=>setMeal(e.target.value)}>{meals.map(m=><option key={m}>{m}</option>)}</select></label></div></fieldset>
  <div className="plan-drafts">{rows.map((row,index)=><PlanDraftRow key={row.id} row={row} index={index} products={products} busy={busy} change={next=>{setRows(current=>current.map(r=>r.id===row.id?next:r));setError('');}} remove={!item&&rows.length>1?()=>setRows(current=>current.filter(r=>r.id!==row.id)):undefined}/>)}</div>
  {!item&&<button type="button" className="btn secondary plan-add-row" disabled={busy||rows.length>=100} onClick={()=>setRows(current=>[...current,emptyDraft()])}><Plus size={16}/>Dodaj kolejną pozycję</button>}
  <label>Notatka do posiłku<textarea maxLength={4000} rows={2} disabled={busy} value={sharedNote} onChange={e=>setNoteDrafts(current=>({...current,[noteKey]:e.target.value}))} placeholder="Jedna wspólna notatka do tego posiłku"/></label>
  {!item&&<label className="plan-copy-toggle"><input type="checkbox" role="switch" checked={alsoOther} disabled={busy} onChange={e=>setAlsoOther(e.target.checked)}/><span><strong>Dodaj również drugiej osobie</strong><small>Jednorazowa kopia. Późniejsze zmiany w każdym planie są niezależne.</small></span></label>}
  {error&&<p className="inline-error" role="alert">{error}</p>}
  <section className="plan-totals" aria-label="Wartości zaplanowane na dzień" aria-live="polite"><h3>Wartości zaplanowane na ten dzień</h3><div className="plan-totals-scroll"><table><thead><tr><th>Plan</th>{macroKeys.map(k=><th key={k}>{macroLabels[k]}</th>)}</tr></thead><tbody><tr><th>Już zapisane</th>{macroKeys.map(k=><td key={k}>{number(saved[k],k==='kcal'?0:1)} {k==='kcal'?'kcal':'g'}</td>)}</tr>{preview&&<tr><th>{item?'Ta porcja':'Dodawane pozycje'}</th>{macroKeys.map(k=><td key={k}>{number(preview[k],k==='kcal'?0:1)} {k==='kcal'?'kcal':'g'}</td>)}</tr>}<tr className="plan-after"><th>Po zapisaniu</th>{macroKeys.map(k=><td key={k}>{number(after[k],k==='kcal'?0:1)} {k==='kcal'?'kcal':'g'}</td>)}</tr></tbody></table></div><p className="form-hint">Notatki nie mają wartości odżywczych.{item?' Podgląd zastępuje edytowaną pozycję nowymi wartościami.':''}</p></section>
  <footer className="form-actions">{item&&<button type="button" className="icon-btn danger plan-remove" aria-label="Usuń pozycję planu" disabled={busy} onClick={()=>remove(item)}><Trash2 size={18}/></button>}<button type="button" className="btn secondary" disabled={busy} onClick={close}>Anuluj</button><button className="btn primary" disabled={busy||!valid}>{busy?'Zapisywanie…':'Zapisz plan'}</button></footer>
 </form>;
}

export function MealNoteForm({note,busy,submit,close}:{note:PlanMealNote;busy:boolean;submit:(payload:unknown)=>Promise<boolean>;close:()=>void}){
 const [text,setText]=useState(note.note);
 return <form className="plan-form" onSubmit={async e=>{e.preventDefault();if(await submit({action:'planMealNote',profileId:note.profileId,date:note.date,meal:note.meal,mealNote:{note:text,revision:note.revision}}))close();}}><p className="form-hint">{note.meal} · {dateLabel(note.date)}</p><label>Notatka do posiłku<textarea autoFocus maxLength={4000} rows={3} disabled={busy} value={text} onChange={e=>setText(e.target.value)} placeholder="Pozostaw puste, aby usunąć notatkę"/></label><footer className="form-actions"><button type="button" className="btn secondary" disabled={busy} onClick={close}>Anuluj</button><button className="btn primary" disabled={busy}>{busy?'Zapisywanie…':'Zapisz notatkę'}</button></footer></form>;
}
