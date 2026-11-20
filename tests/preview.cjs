const http=require('node:http'),fs=require('node:fs'),path=require('node:path');const {createBackend}=require('./harness.cjs');const backend=createBackend();const root=path.join(__dirname,'..');
const server=http.createServer(async(req,res)=>{
 if(req.url.startsWith('/api')){res.setHeader('Content-Type','application/json');if(req.method==='POST'){let body='';for await(const chunk of req)body+=chunk;try{res.end(JSON.stringify(backend.post(JSON.parse(body))))}catch(e){res.statusCode=400;res.end(JSON.stringify({status:'error',message:e.message}));}}else res.end(JSON.stringify(backend.get(Object.fromEntries(new URL(req.url,'http://localhost').searchParams))));return;}
 const name=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html';
 if(!['index.html','exam.js','exam.css','teacher.html'].includes(name)){res.statusCode=404;res.end();return;}
 let content=fs.readFileSync(path.join(root,name),'utf8');if(name==='exam.js'||name==='teacher.html')content=content.replace(/const SCRIPT_URL = "[^"]+";/,'const SCRIPT_URL = "http://127.0.0.1:4173/api";');
 res.setHeader('Content-Type',name.endsWith('.css')?'text/css':name.endsWith('.js')?'application/javascript':'text/html');res.end(content);
});server.listen(4173,'127.0.0.1',()=>console.log('Local preview: http://127.0.0.1:4173 · simulated roster TEST001 / test-code-001; no real records'));
