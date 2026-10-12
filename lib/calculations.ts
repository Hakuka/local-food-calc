import { type Entry, type Macros, type Product, type DishIngredient, macroKeys } from './types';
export function portion(product:Macros, grams:number):Macros {
  return {kcal:product.kcal*grams/100,protein:product.protein*grams/100,carbs:product.carbs*grams/100,fat:product.fat*grams/100};
}
export function sumMacros(entries:Macros[]):Macros {
  return entries.reduce((s,e)=>{for(const k of macroKeys)s[k]+=e[k];return s;},{kcal:0,protein:0,carbs:0,fat:0});
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
export function dateLabel(date:string,options:Intl.DateTimeFormatOptions={day:'numeric',month:'long',year:'numeric'}):string {return new Intl.DateTimeFormat('pl-PL',options).format(new Date(date+'T12:00:00Z'));}
export function daily(entries:Entry[],profileId:string,date:string):Macros {return sumMacros(entries.filter(e=>e.profileId===profileId&&e.date===date));}
