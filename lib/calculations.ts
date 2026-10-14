import { type Entry, type Macros, type Product, type DishIngredient, type PlanItem, type PlanMealNote, macroKeys } from './types';
export function portion(product:Macros, grams:number):Macros {
  return {kcal:product.kcal*grams/100,protein:product.protein*grams/100,carbs:product.carbs*grams/100,fat:product.fat*grams/100};
}
export function sumMacros(entries:Macros[]):Macros {
  return entries.reduce((s,e)=>{for(const k of macroKeys)s[k]+=e[k];return s;},{kcal:0,protein:0,carbs:0,fat:0});
}
export function plannedPortion(item:PlanItem|undefined,product:Product,grams:number):Macros {
  const values=item?.kind==='food'&&item.productId===product.id?Object.fromEntries(macroKeys.map(k=>[k,item[k]*100/item.grams!])) as Macros:product;
  return portion(values,grams);
}
export function plannedDayTotals(plans:PlanItem[],profileId:string,date:string,itemId?:string,preview?:Macros|null):{saved:Macros;after:Macros} {
  const foods=plans.filter(p=>p.profileId===profileId&&p.date===date&&p.kind==='food');
  return {saved:sumMacros(foods),after:sumMacros([...foods.filter(p=>p.id!==itemId),...(preview?[preview]:[])])};
}
export type ShoppingItem={productId:string;name:string;manufacturer:string;grams:number};
export type ShoppingList={start:string;end:string;items:ShoppingItem[];notes:{id:string;date:string;meal:string;note:string}[]};
export function shoppingLists(plans:PlanItem[],products:Product[],dates:string[],mode:'weekly'|'overall',mealNotes:PlanMealNote[]=[]):ShoppingList[] {
  if(!dates.length)return [];
  const catalog=new Map(products.map(p=>[p.id,p]));
  const groups=mode==='overall'?[dates]:Array.from({length:Math.ceil(dates.length/7)},(_,i)=>dates.slice(i*7,i*7+7));
  return groups.map(days=>{
    const visible=new Set(days),totals=new Map<string,ShoppingItem>();
    function add(productId:string,name:string,grams:number){
      const p=catalog.get(productId),existing=totals.get(productId);
      if(existing)existing.grams+=grams;
      else totals.set(productId,{productId,name:p?.name||name,manufacturer:p?.manufacturer||'',grams});
    }
    const selected=plans.filter(p=>visible.has(p.date));
    for(const item of selected){
      if(item.kind!=='food'||!item.productId||item.grams===null)continue;
      const p=catalog.get(item.productId);
      if(p?.kind==='dish'&&p.totalWeight&&p.totalWeight>0&&p.ingredients.length){
        for(const ingredient of p.ingredients)add(ingredient.productId,'Produkt spoza bazy',ingredient.grams*item.grams/p.totalWeight);
      }else add(item.productId,item.productName,item.grams);
    }
    const notes=[...selected.filter(p=>p.kind==='note').map(p=>({id:'plan:'+p.id,date:p.date,meal:p.meal,note:p.note})),...mealNotes.filter(n=>visible.has(n.date)&&n.note).map(n=>({id:'meal:'+n.id,date:n.date,meal:n.meal,note:n.note}))].sort((a,b)=>a.date.localeCompare(b.date));
    return {start:days[0],end:days.at(-1)!,items:[...totals.values()].sort((a,b)=>a.name.localeCompare(b.name,'pl')||a.productId.localeCompare(b.productId)),notes};
  });
}
export function dishMacros(ingredients:DishIngredient[],products:Product[],totalWeight:number):Macros|null {
  if(!ingredients.length||!Number.isFinite(totalWeight)||totalWeight<=0)return null;
  const portions:Macros[]=[];
  for(const ingredient of ingredients){
    const product=products.find(p=>p.id===ingredient.productId);
    if(!product||!Number.isFinite(ingredient.grams)||ingredient.grams<=0)return null;
    portions.push(portion(product,ingredient.grams));
  }
  const totals=sumMacros(portions);
  return Object.fromEntries(macroKeys.map(k=>[k,totals[k]*100/totalWeight])) as Macros;
}
export function today():string {return new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Warsaw'}).format(new Date());}
export function shiftDate(date:string,days:number):string {const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
export function startOfWeek(date:string):string {const weekday=new Date(date+'T12:00:00Z').getUTCDay();return shiftDate(date,-((weekday+6)%7));}
export function plannerDates(date:string,view:'week'|'month'):string[] {
  const start=startOfWeek(date);
  const d=new Date(date+'T12:00:00Z');
  const monthEnd=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0,12)).toISOString().slice(0,10);
  const lastSunday=shiftDate(startOfWeek(monthEnd),6);
  const days=view==='week'?7:Math.round((Date.parse(lastSunday)-Date.parse(start))/86400000)+1;
  return Array.from({length:days},(_,i)=>shiftDate(start,i));
}
export type PlannerRange={start:string;past:string[];future:string[]};
export function navigatePlanner(range:PlannerRange,view:'week'|'month',direction:1|-1):PlannerRange {
  const d=new Date(range.start+'T12:00:00Z');
  const target=view==='week'?shiftDate(range.start,direction*7):new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+direction,1,12)).toISOString().slice(0,10);
  if(direction===1)return {start:range.future[0]??target,past:[...range.past,range.start],future:range.future.slice(1)};
  return {start:range.past.at(-1)??target,past:range.past.slice(0,-1),future:[range.start,...range.future]};
}
export function dateLabel(date:string,options:Intl.DateTimeFormatOptions={day:'numeric',month:'long',year:'numeric'}):string {return new Intl.DateTimeFormat('pl-PL',options).format(new Date(date+'T12:00:00Z'));}
export function daily(entries:Entry[],profileId:string,date:string):Macros {return sumMacros(entries.filter(e=>e.profileId===profileId&&e.date===date));}
