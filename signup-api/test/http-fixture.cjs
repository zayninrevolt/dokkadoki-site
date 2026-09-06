const vm=require('vm'),fs=require('fs'),path=require('path'),http=require('http'),{createRequire}=require('module');
const filename=path.resolve(__dirname,'../server.js'),load=createRequire(filename);
const fault=process.argv[2];
const pool={query:async(sql)=>{if(sql.startsWith('SELECT id, title, title_normalized'))return [[{id:1,title:'One Piece',title_normalized:'one piece',request_count:1}]];if(sql.startsWith('INSERT INTO manga_request_votes'))throw new Error('simulated database failure');return [[]];}};
const sandbox={require:n=>n==='mysql2/promise'?{createPool:()=>pool}:n==='./env-loader'?{loadEnvFile:()=>{}}:load(n),module:{exports:{}},__dirname:path.dirname(filename),process:{env:{VOTE_SALT:'fixture-only-value-12345678901234567890'}},console:{log(){},error(){}},URL,Buffer,AbortSignal};
vm.runInNewContext(fs.readFileSync(filename,'utf8')+'\nmodule.exports.fixtureServer=server;',sandbox,{filename});
const s=sandbox.module.exports.fixtureServer;
function request(url,body){return new Promise((resolve,reject)=>{const r=http.request({host:'127.0.0.1',port:s.address().port,path:url,method:body?'POST':'GET'},res=>{let data='';res.on('data',c=>data+=c);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(data)}));});r.on('error',reject);r.setTimeout(1500,()=>r.destroy(new Error('request timed out')));r.end(body);});}
(async()=>{await new Promise(r=>s.listen(0,'127.0.0.1',r));try{const result=await request(fault==='url'?'//[':'/api/request-manga',fault==='url'?undefined:JSON.stringify({title:'One Piece'}));const health=await request('/api/health');console.log(JSON.stringify({result,health}));}finally{await new Promise(r=>s.close(r));}})().catch(e=>{console.error(e.message);process.exitCode=1;});
