import {useState,type FormEvent} from 'react';
import {Check,Pencil,Plus,Trash2} from 'lucide-react';
import {type Entry,type Product,type Macros,macroKeys,macroLabels,meals} from '../lib/types';
import {portion,sumMacros} from '../lib/calculations';
import {createId} from '../lib/id';
import {PlanDraftRow,type PlanDraft} from './planner';

const number=(n:number,digits=1)=>new Intl.NumberFormat('pl-PL',{maximumFractionDigits:digits}).format(n);
const emptyRow=():PlanDraft=>({id:createId(),kind:'food',productId:'',grams:'100',note:''});

export function EntryForm({entry,product,products,profileId,date,busy,submit,close}:{entry?:Entry;product?:Product;products:Product[];profileId:string;date:string;busy:boolean;submit:(payload:unknown)=>Promise<boolean>;close:()=>void}){
 const [rows,setRows]=useState<PlanDraft[]>(()=>[{...emptyRow(),...(entry?{id:entry.id}:{}),productId:entry?.productId||product?.id||'',grams:entry?String(entry.grams):'100'}]);
 const [day,setDay]=useState(entry?entry.date:date);const [meal,setMeal]=useState(entry?.meal||'Bez kategorii');const [note,setNote]=useState(entry?.note||'');const [error,setError]=useState('');
 const validRow=(row:PlanDraft)=>products.some(p=>p.id===row.productId)&&Number.isFinite(Number(row.grams))&&Number(row.grams)>0&&Number(row.grams)<=100000;
 const valid=rows.length>0&&rows.every(validRow);
 const portions=rows.filter(validRow).map(row=>{
  const chosen=products.find(p=>p.id===row.productId)!;
  const values=entry&&entry.productId===chosen.id?Object.fromEntries(macroKeys.map(k=>[k,entry[k]*100/entry.grams])) as Macros:chosen;
  return portion(values,Number(row.grams));
 });
 const preview=portions.length?sumMacros(portions):null;
 async function save(event:FormEvent){
  event.preventDefault();setError('');
  if(!valid){setError('Wybierz produkt lub danie i podaj dodatnią gramaturę każdej pozycji.');return;}
  const items=rows.map(row=>({id:row.id,productId:row.productId,grams:Number(row.grams),note}));
  const payload=entry?{...items[0],action:'entry',revision:entry.revision,profileId:entry.profileId,date:day,meal}:{action:'entryBatch',profileId,date:day,meal,items};
  if(await submit(payload))close();
 }
 return <form className="plan-form" onSubmit={save}>
  <fieldset className="plan-fields" disabled={busy}><div className="form-grid"><label>Dzień<input type="date" required value={day} onChange={e=>setDay(e.target.value)}/></label><label>Posiłek<select value={meal} onChange={e=>setMeal(e.target.value)}>{meals.map(m=><option key={m}>{m}</option>)}</select></label></div></fieldset>
  <div className="plan-drafts">{rows.map((row,index)=><PlanDraftRow key={row.id} row={row} index={index} products={products} busy={busy} allowNotes={false} change={next=>{setRows(current=>current.map(r=>r.id===row.id?next:r));setError('');}} remove={!entry&&rows.length>1?()=>setRows(current=>current.filter(r=>r.id!==row.id)):undefined}/>)}</div>
  {!entry&&<button type="button" className="btn secondary plan-add-row" disabled={busy||rows.length>=100} onClick={()=>setRows(current=>[...current,emptyRow()])}><Plus size={16}/>Dodaj kolejną pozycję</button>}
  {preview&&<section className="diary-meal-preview" aria-label="Wartości dodawanych produktów" aria-live="polite"><h3>{entry?'Wartości wpisu':'Razem dodawane produkty'}</h3><div className="portion-preview">{macroKeys.map(k=><div key={k}><small>{macroLabels[k]}</small><strong>{number(preview[k],k==='kcal'?0:1)} <span>{k==='kcal'?'kcal':'g'}</span></strong></div>)}</div></section>}
  <label>{entry?'Notatka do wpisu':'Notatka do dodawanych wpisów'}<textarea maxLength={2000} rows={2} disabled={busy} value={note} onChange={e=>setNote(e.target.value)} placeholder="Opcjonalnie"/></label>
  {error&&<p className="inline-error" role="alert">{error}</p>}
  <footer className="form-actions"><button type="button" className="btn secondary" disabled={busy} onClick={close}>Anuluj</button><button className="btn primary" disabled={busy||!valid}>{busy?'Zapisywanie…':'Zapisz'}{!busy&&<Check size={17}/>}</button></footer>
 </form>;
}

export function DiaryEntries({entries,edit,remove}:{entries:Entry[];edit:(entry:Entry)=>void;remove:(entry:Entry)=>void}){
 const groups=[...new Set([...meals,...entries.map(e=>e.meal)])].map(meal=>({meal,entries:entries.filter(e=>e.meal===meal)})).filter(group=>group.entries.length);
 const totalCells=(items:Entry[])=>{const totals=sumMacros(items);return <><td>{number(items.reduce((sum,e)=>sum+e.grams,0))} g</td>{macroKeys.map(k=><td key={k}>{number(totals[k],k==='kcal'?0:1)}{k==='kcal'?'':' g'}</td>)}</>;};
 return <div className="table-scroll"><table className="diary-table"><thead><tr><th>Produkt</th><th>Gramatura</th><th>kcal</th><th>Białko</th><th>Węgle</th><th>Tłuszcze</th><th><span className="sr-only">Akcje</span></th></tr></thead>
  {groups.map(group=><tbody key={group.meal} aria-label={group.meal}><tr className="diary-meal-heading"><th scope="row">{group.meal}</th>{totalCells(group.entries)}<td/></tr>{group.entries.map(e=><tr key={e.id}><td><strong>{e.productName}</strong>{e.note&&<small>{e.note}</small>}</td><td>{number(e.grams)} <span className="muted">g</span></td><td className="kcal-cell">{number(e.kcal,0)}</td><td>{number(e.protein)} g</td><td>{number(e.carbs)} g</td><td>{number(e.fat)} g</td><td className="row-actions"><button className="icon-btn" aria-label={'Edytuj '+e.productName} onClick={()=>edit(e)}><Pencil size={16}/></button><button className="icon-btn danger" aria-label={'Usuń '+e.productName} onClick={()=>remove(e)}><Trash2 size={16}/></button></td></tr>)}</tbody>)}
  <tfoot><tr><td>Razem</td>{totalCells(entries)}<td/></tr></tfoot>
 </table></div>;
}
