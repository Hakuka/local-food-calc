import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,dirname,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {openStore,AppError} from './storage.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const contentTypes={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.json':'application/json; charset=utf-8'};
const json=(response,status,data)=>{response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});response.end(JSON.stringify(data));};
async function body(request){let chunks=[],size=0;for await(const chunk of request){size+=chunk.length;if(size>256*1024)throw new AppError('Za duży rozmiar żądania.',413);chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new AppError('Nieprawidłowy JSON.');}}
export function createApp({dataDir,distDir=resolve(root,'dist')}={}){
 const store=openStore(dataDir);const dist=resolve(distDir);
 const server=createServer(async(request,response)=>{
  try{
   const url=new URL(request.url,'http://localhost');
   if(url.pathname==='/api/data'){
    if(request.method==='GET')return json(response,200,store.read());
    if(request.method==='POST'){
     const origin=request.headers.origin;
     if(!origin||new URL(origin).host!==request.headers.host)throw new AppError('Niedozwolone źródło żądania.',403);
     if(!(request.headers['content-type']||'').toLowerCase().startsWith('application/json'))throw new AppError('Oczekiwany format application/json.',415);
     return json(response,200,store.mutate(await body(request)));
    }
    return json(response,405,{error:'Niedozwolona metoda.'});
   }
   if(url.pathname==='/api/health'&&request.method==='GET')return json(response,200,{ok:true,storage:'local-sqlite'});
   if(url.pathname.startsWith('/api/'))return json(response,404,{error:'Nie znaleziono endpointu.'});
   if(request.method!=='GET'&&request.method!=='HEAD')return json(response,405,{error:'Niedozwolona metoda.'});
   const pathname=decodeURIComponent(url.pathname);
   if(pathname.includes('\0'))return json(response,400,{error:'Nieprawidłowa ścieżka.'});
   const file=resolve(dist,'.'+pathname);
   if(!file.startsWith(dist+sep)&&file!==dist)return json(response,403,{error:'Niedozwolona ścieżka.'});
   const finalPath=pathname==='/'||!extname(pathname)?resolve(dist,'index.html'):file;
   let bytes;
   try{bytes=await readFile(finalPath);}catch(error){if(error.code==='ENOENT'){response.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});response.end('Brak plików aplikacji. Uruchom: npm run build');return;}throw error;}
   response.writeHead(200,{'Content-Type':contentTypes[extname(finalPath)]||'application/octet-stream','Cache-Control':extname(finalPath)==='.html'?'no-store':'public, max-age=3600','X-Content-Type-Options':'nosniff'});response.end(request.method==='HEAD'?undefined:bytes);
  }catch(error){if(error instanceof AppError)return json(response,error.status,{error:error.message});console.error(error.message);return json(response,500,{error:'Operacja nie powiodła się. Spróbuj ponownie.'});}
 });
 server.on('close',()=>store.close());
 return server;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const port=Number(process.env.PORT||3000),host=process.env.HOST||'127.0.0.1';
 const app=createApp();
 app.listen(port,host,()=>{console.log('Dieta domowa działa lokalnie: http://'+(host==='0.0.0.0'?'localhost':host)+':'+port);console.log('Dane SQLite: '+resolve(process.env.DATA_DIR||resolve(root,'data'),'dieta.sqlite'));});
 const close=()=>app.close(()=>process.exit(0));process.on('SIGINT',close);process.on('SIGTERM',close);
}
