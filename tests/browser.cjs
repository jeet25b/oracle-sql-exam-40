const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
const targets=await(await fetch('http://127.0.0.1:9223/json/list')).json();const target=targets.find(t=>t.type==='page');assert(target,'No browser page');
const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});let seq=0;const pending=new Map(),errors=[];
ws.onmessage=event=>{const m=JSON.parse(event.data);if(m.id){const p=pending.get(m.id);if(!p)return;pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text+': '+(m.params.exceptionDetails.exception?.description||''));};
const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;const timeout=setTimeout(()=>{pending.delete(id);reject(Error("RPC timeout: "+method))},15000);pending.set(id,{resolve:r=>{clearTimeout(timeout);resolve(r)},reject:e=>{clearTimeout(timeout);reject(e)}});ws.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
async function wait(expression){for(let i=0;i<80;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,100));}throw Error('Timeout: '+expression);}
const out=path.join(__dirname,'..','.preview');fs.mkdirSync(out,{recursive:true});
async function shot(name){const r=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});fs.writeFileSync(path.join(out,name+'.png'),Buffer.from(r.data,'base64'));}

await send('Page.enable');await send('Runtime.enable');
// Headless Chrome cannot reliably enter native OS fullscreen. Test the API contract here;
// actual browser/Windows fullscreen remains a manual staging check.
await send('Page.addScriptToEvaluateOnNewDocument',{source:`let qaFull=false;Object.defineProperty(document,'fullscreenElement',{get(){return qaFull?document.documentElement:null}});HTMLElement.prototype.requestFullscreen=async()=>{qaFull=true;document.dispatchEvent(new Event('fullscreenchange'))};`});await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false});
await send('Storage.clearDataForOrigin',{origin:'http://127.0.0.1:4173',storageTypes:'all'});
await send('Page.navigate',{url:'http://127.0.0.1:4173'});await wait('document.getElementById("accessBanner")?.textContent.includes("open")');
assert(await evaluate('document.documentElement.scrollWidth<=innerWidth'));await shot('desktop-login');
await evaluate('document.getElementById("themeBtn").click()');await shot('desktop-dark');
await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});assert(await evaluate('document.documentElement.scrollWidth<=innerWidth'));await shot('mobile-login');
await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false});
await evaluate(`for(const [id,value]of Object.entries({rollInput:'TEST001',nameInput:'Alex',accessCode:'test-code-001',courseInput:'B.Tech',branchInput:'CSE',semInput:'3',batchInput:'A',groupInput:'1'}))document.getElementById(id).value=value;document.getElementById('acknowledge').checked=true;document.getElementById('startBtn').scrollIntoView({block:'center'})`);
const startPoint=await evaluate('(()=>{const r=document.getElementById("startBtn").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()');
await send('Input.dispatchMouseEvent',{type:'mousePressed',...startPoint,button:'left',clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',...startPoint,button:'left',clickCount:1});
await wait('document.getElementById("qCounter").textContent.includes("Question 1")');
const first=await evaluate('attempt.questions[0].id');
await evaluate('document.querySelector("input[type=radio]").click();document.getElementById("submitQuestionBtn").click()');
await wait('document.getElementById("qCounter").textContent.includes("Question 2")');
assert(await evaluate('document.querySelector(".pal-btn").classList.contains("selected-answer")'));
assert.equal(await evaluate('document.querySelectorAll(".incorrect,.feedback-wrong,.feedback-correct").length'),0);
await evaluate('document.getElementById("prevBtn").click()');assert(await evaluate('document.querySelector("input[type=radio]").checked'));
await send('Input.dispatchMouseEvent',{type:'mousePressed',x:500,y:400,button:'left',clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:500,y:400,button:'left',clickCount:1});await evaluate('window.dispatchEvent(new Event("blur"))');
await wait('document.getElementById("submitQuestionBtn").textContent.includes("locked")');assert(await evaluate('attempt.lockedQuestions.length>=2'));
await shot('desktop-exam');await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});assert(await evaluate('document.documentElement.scrollWidth<=innerWidth'));await shot('mobile-exam');
const old=await evaluate('attempt.token');await send('Page.reload');await wait('document.getElementById("qCounter")?.textContent.includes("Question")');
assert.equal(await evaluate('attempt.token'),old);assert.equal(await evaluate('attempt.answers['+first+']'),0);
await evaluate('document.getElementById("submitExamBtn").click()');await wait('document.getElementById("submitDialog").open');await shot('mobile-confirmation');
await evaluate('document.getElementById("confirmFinalBtn").click()');await wait('document.getElementById("resultHeading").textContent.includes("successfully")');
assert.equal(await evaluate('document.querySelectorAll(".result-stats .stat").length'),5);assert.equal(await evaluate('document.getElementById("receiptBtn")'),null);await shot('mobile-results');
await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false});await shot('desktop-results');
await evaluate('document.getElementById("nextStudentBtn").click()');await wait('document.getElementById("accessBanner")?.textContent.includes("open")');assert.equal(await evaluate('localStorage.getItem("oracle-sql-attempt-v2")'),null);
await send('Page.navigate',{url:'http://127.0.0.1:4173/teacher.html'});await wait('document.getElementById("passkeyInput")!==null');
await evaluate('document.getElementById("passkeyInput").value="test-admin-key";authenticate()');await wait('allResults.length===1');
assert((await evaluate('document.getElementById("resultsBody").innerText')).includes('TEST001'));await evaluate('sortResults("score");openModal(0)');await shot('teacher-detail');
assert.equal(errors.length,0,errors.join('\n'));console.log('PASS: desktop/mobile layouts, fullscreen API simulation, submit/advance without correctness, seen locks, automatic refresh resume, final Results, next student, teacher login/sort/detail. No runtime exceptions.');
await send('Browser.close');ws.close();
})().catch(e=>{console.error(e);process.exitCode=1;process.exit(1)});
