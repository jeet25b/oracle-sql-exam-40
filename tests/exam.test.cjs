const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.join(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8'),js=fs.readFileSync(path.join(root,'exam.js'),'utf8');
function ui(){
 const elements={},windowEvents={},documentEvents={};
 function element(){return {children:[],textContent:'',value:'',className:'',attributes:{},classList:{toggle(){},add(){},remove(){}},setAttribute(k,v){this.attributes[k]=v},getAttribute(k){return this.attributes[k]},removeAttribute(k){delete this.attributes[k]},replaceChildren(){this.children=[]},appendChild(e){this.children.push(e);return e},append(...e){this.children.push(...e)},addEventListener(){},focus(){},close(){this.open=false},showModal(){this.open=true}};}
 const document={documentElement:{dataset:{}},getElementById:id=>elements[id]??=(element()),createElement:()=>element(),addEventListener(name,handler){documentEvents[name]=handler}};
 const local=new Map();const ctx=vm.createContext({document,window:{addEventListener(name,handler){windowEvents[name]=handler}},navigator:{onLine:true},localStorage:{setItem:(k,v)=>local.set(k,v),getItem:k=>local.get(k)},setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,clearInterval(){},AbortController,Date,Blob,URL,console});
 vm.runInContext(js,ctx);vm.runInContext(`attempt={roll:'TEST001',name:'Alex',batch:'B.Tech-CSE-3-A-1',token:'token',questions:[{id:1,ans:0,options:['A','B']},{id:2,ans:1,options:['A','B']},{id:3,ans:0,options:['A','B']}],answers:{1:0,2:0},flags:[2],currentIdx:0};buildPalette();`,ctx);
 return {ctx,elements,local,windowEvents,documentEvents};
}
test('frontend syntax and event-bound IDs are present',()=>{
 new vm.Script(js);assert(!/[\u00c2\u00e2]/.test(js),'dynamic messages must retain clean UTF-8 punctuation');
 const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(ids.length,new Set(ids).size,'duplicate IDs');
 for(const [,id]of js.matchAll(/\$\("([^"]+)"\)/g))assert(ids.includes(id),'missing ID '+id);
 assert(!html.includes('Teacher Results'));assert(!html.includes('important_questions.js'));assert(!/\.ans\b/.test(js));
 assert(html.includes('type="password"'));assert(html.includes('<fieldset'));assert(html.includes('<dialog'));
});
test('all answered numbers stay green before submission and status labels include review flags',()=>{
 const {ctx,elements}=ui();vm.runInContext('updatePalette()',ctx);const b=elements.questionPalette.children;
 assert(b[0].className.includes('answered'));assert(b[1].className.includes('answered'));assert(!b[1].className.includes('incorrect'));assert(b[1].className.includes('flagged'));assert(b[1].attributes['aria-label'].includes('flagged'));assert(!b[2].className.includes('answered'));
});
test('server results turn incorrect numbers red after submission and pending has no grading',()=>{
 const {ctx,elements}=ui();vm.runInContext('submitPending=true;updatePalette()',ctx);assert(!elements.questionPalette.children[1].className.includes('incorrect'));
 vm.runInContext(`finalized=true;result={details:[{status:'correct'},{status:'wrong'},{status:'unattempted'}]};updatePalette()`,ctx);
 assert(elements.questionPalette.children[1].className.includes('incorrect'));assert(elements.questionPalette.children[0].className.includes('answered'));assert(elements.questionPalette.children.every(b=>b.attributes["aria-disabled"]==="true"));assert(!elements.questionPalette.children[2].className.includes('incorrect'));
});
test('device recovery excludes access codes and retains pending submission',()=>{
 const {ctx,local}=ui();vm.runInContext('submitPending=true;localSave()',ctx);const saved=JSON.parse(local.get('oracle-sql-attempt-v2'));assert(saved.submitPending);assert.equal(saved.attempt.token,'token');assert(!('accessCode'in saved));assert(!('accessCode'in saved.attempt));
});
test('timer uses deadline rather than interval count and warns near expiry',()=>{
 const {ctx,elements}=ui();vm.runInContext('deadline=Date.now()+119000;tick()',ctx);assert.match(elements.timerDisplay.textContent,/01:5[89]/);assert(elements.timeWarning.textContent.includes('2 minutes'));
});
test('tab changes and window blur permanently lock only the current question and retain its answer',async()=>{
 const {ctx,elements,local,windowEvents,documentEvents}=ui();
 await vm.runInContext('initialize()',ctx);
 vm.runInContext('deadline=Date.now()+600000;syncProgress=async()=>{};',ctx);
 windowEvents.blur();
 assert.equal(vm.runInContext('attempt.lockedQuestions.includes(1)',ctx),true);
 assert.equal(vm.runInContext('attempt.answers[1]',ctx),0);
 assert(elements.optionsContainer.children.every(label=>label.children[0].disabled));
 assert(elements.clearBtn.disabled);assert(elements.submitQuestionBtn.disabled);
 // Direct event invocation must also fail, in addition to disabled controls.
 elements.optionsContainer.children[1].children[0].onchange();elements.clearBtn.onclick();
 assert.equal(vm.runInContext('attempt.answers[1]',ctx),0);
 ctx.document.hidden=true;documentEvents.visibilitychange();
 assert.equal(vm.runInContext('attempt.tabSwitches',ctx),1,'blur plus hidden must not double count');
 vm.runInContext('navigate(1)',ctx);assert(elements.optionsContainer.children.every(label=>!label.children[0].disabled));
 documentEvents.visibilitychange();assert.equal(vm.runInContext('attempt.lockedQuestions.includes(2)',ctx),true);
 const saved=JSON.parse(local.get('oracle-sql-attempt-v2'));assert.deepEqual(saved.attempt.lockedQuestions,[1,2]);
});
test('blank question remains blank when locked and submitted exams do not acquire new locks',()=>{
 const {ctx}=ui();vm.runInContext('deadline=Date.now()+600000;currentIdx=0;attempt.currentIdx=2;syncProgress=async()=>{};lockCurrentQuestion();',ctx);
 assert.equal(vm.runInContext('attempt.answers[3]',ctx),undefined);assert.equal(vm.runInContext('questionBlocked()',ctx),true);
 vm.runInContext('finalized=true;attempt.currentIdx=1;lockCurrentQuestion();',ctx);assert.equal(vm.runInContext('attempt.lockedQuestions.includes(2)',ctx),false);
});
test('old deployed API is blocked before login with an actionable update message',async()=>{
 const {ctx,elements}=ui();
 ctx.fetch=async()=>({ok:true,json:async()=>({state:'OPEN',isOpen:true})});
 const visible={};elements.studentForm={classList:{toggle:(name,hidden)=>visible.hidden=hidden}};
 await vm.runInContext('checkExamWindow()',ctx);
 assert(elements.accessBanner.textContent.includes('server needs an update'));assert.equal(visible.hidden,true);
});
test('old POST action errors explain deployment rather than showing a raw API error',async()=>{
 const {ctx}=ui();ctx.fetch=async()=>({ok:true,json:async()=>({status:'error',message:'Invalid POST action'})});
 await assert.rejects(vm.runInContext('api({action:"startAttempt"})',ctx),/deploy the latest Apps Script/);
});
test('invalid session offers verification instead of retrying the same token',async()=>{
 const {ctx,elements}=ui();
 vm.runInContext('api=async()=>{throw new Error("Your session could not be verified. Sign in again with your access code.")}',ctx);
 await vm.runInContext('submitExam()',ctx);
 assert.equal(vm.runInContext('needsSessionVerification',ctx),true);
 assert(elements.resultSummary.textContent.includes('Verify session and submit'));
 await vm.runInContext('submitExam()',ctx);assert.equal(elements.sessionDialog.open,true);
});
if(!process.argv.includes('--frontend-only')){
 const {createBackend}=require('./harness.cjs');
 const start=(b,roll='TEST001',code='test-code-001')=>b.post({action:'startAttempt',rollNo:roll,name:'Untrusted name',batch:'B.Tech-CSE-3-A-1',accessCode:code});
 test('roster verification blocks invalid codes, does not leak keys, preserves registered identity',()=>{
  const b=createBackend();assert.equal(start(b,'TEST001','wrong').status,'error');const data=start(b);assert.equal(data.status,'ok');assert.equal(data.attempt.name,'Alex Morgan');assert.equal(data.attempt.questions.length,40);assert(data.attempt.questions.every(q=>!('ans'in q)));assert.equal(b.locked(),false);
 });
 test('refresh and concurrent logins resume one fixed attempt and server deadline',()=>{
  const b=createBackend(),first=start(b);b.advance(30000);const second=start(b);assert.equal(first.attempt.token,second.attempt.token);assert.equal(first.attempt.deadline,second.attempt.deadline);assert.deepEqual(first.attempt.questions,second.attempt.questions);assert.equal(b.sheets.get('Attempts').rows.length,2);
 });
 test('save validates token/options and restores answers and flags',()=>{
  const b=createBackend(),a=start(b).attempt,id=a.questions[0].id;
  assert.equal(b.post({action:'saveAttempt',rollNo:a.roll,token:'wrong',answers:{}}).status,'error');
  assert.equal(b.post({action:'saveAttempt',rollNo:a.roll,token:a.token,answers:{[id]:99}}).status,'error');
  assert.equal(b.post({action:'saveAttempt',rollNo:a.roll,token:a.token,answers:{[id]:0},flags:[id],currentIdx:2}).status,'ok');
  const resumed=start(b).attempt;assert.equal(resumed.answers[id],0);assert.deepEqual(resumed.flags,[id]);assert.equal(resumed.currentIdx,2);
 });
 test('server grades canonical keys, ignores forged scores, duplicate retries return one result',()=>{
  const b=createBackend(),a=start(b).attempt;const stored=JSON.parse(b.sheets.get('Attempts').rows[1][2]);
  const answers={[a.questions[0].id]:stored.questions[0].ans,[a.questions[1].id]:(stored.questions[1].ans+1)%4};
  const payload={action:'submit',rollNo:a.roll,token:a.token,answers,score:40,correctCount:40};const r=b.post(payload);
  assert.equal(r.status,'ok');assert.equal(r.result.score,1);assert.equal(r.result.wrongCount,1);assert.equal(r.result.unattemptedCount,38);assert(r.result.details.every(d=>!('correct'in d)));
  assert.deepEqual(b.post(payload).result,r.result);assert.equal(b.sheets.get('Results').rows.length,2);
  assert.equal(start(b).result.score,1);assert.equal(b.locked(),false);
 });
 test('late offline submission uses the last online save, not new answers',()=>{
  const b=createBackend(),a=start(b).attempt;const stored=JSON.parse(b.sheets.get('Attempts').rows[1][2]);const id=a.questions[0].id;
  b.post({action:'saveAttempt',rollNo:a.roll,token:a.token,answers:{[id]:stored.questions[0].ans}});
  b.setClock(a.deadline+16000);const r=b.post({action:'submit',rollNo:a.roll,token:a.token,answers:{}});assert.equal(r.result.score,1);assert.equal(r.result.unattemptedCount,39);
 });
 test('expired attempt finalizes on resume without resetting timer',()=>{
  const b=createBackend(),a=start(b).attempt;b.setClock(a.deadline+16000);const resumed=start(b);assert.equal(resumed.attempt.token,a.token);assert.equal(resumed.result.score,0);assert.equal(b.sheets.get('Results').rows.length,2);start(b);assert.equal(b.sheets.get('Results').rows.length,2);
 });
 test('schedule preserves duration, handles missing settings and never accepts invalid windows',()=>{
  const b=createBackend();assert.equal(b.get({action:'status'}).state,'OPEN');assert.equal(b.get({action:'status'}).apiVersion,3);
  assert.equal(b.post({action:'updateWindow',key:'test-admin-key',openTime:'invalid',closeTime:'invalid'}).status,'error');
  b.sheets.get('Settings').rows=[['Key','Value']];assert.equal(b.get({action:'status'}).state,'LOCKED');assert.equal(start(b).status,'error');
 });
 test('teacher API requires private script property and returns compatible result schema',()=>{
  const b=createBackend(),a=start(b).attempt;b.post({action:'submit',rollNo:a.roll,token:a.token,answers:{}});
  assert.equal(b.get({action:'results',key:'wrong'}).status,'error');const data=b.get({action:'results',key:'test-admin-key'});assert.equal(data.status,'ok');assert.equal(data.results[0].rollNo,'TEST001');assert.equal(data.results[0].maxMarks,40);
 });
 test('backend locks survive resume and reject changed or cleared answers on save and submission',()=>{
  const b=createBackend(),a=start(b).attempt,first=a.questions[0].id,blank=a.questions[1].id;
  const save=(answers,lockedQuestions=[])=>b.post({action:'saveAttempt',rollNo:a.roll,token:a.token,answers,lockedQuestions});
  assert.equal(save({[first]:0},[first,blank]).status,'ok');
  let resumed=start(b).attempt;assert.deepEqual(resumed.lockedQuestions,[first,blank]);assert.equal(resumed.answers[first],0);assert.equal(resumed.answers[blank],undefined);
  save({[first]:1,[blank]:0},[]);resumed=start(b).attempt;assert.equal(resumed.answers[first],0);assert.equal(resumed.answers[blank],undefined);
  save({});resumed=start(b).attempt;assert.equal(resumed.answers[first],0);assert.equal(resumed.lockedQuestions.length,2);
  const r=b.post({action:'submit',rollNo:a.roll,token:a.token,answers:{[first]:1,[blank]:1},lockedQuestions:[]});
  assert.equal(r.result.details[0].selected,0);assert.equal(r.result.details[1].status,'unattempted');
 });

 test('session recovery requires access code, preserves the attempt and does not create another',()=>{
  const b=createBackend(),a=start(b).attempt;
  const request={action:'recoverAttempt',rollNo:a.roll,accessCode:'wrong',startedAt:a.startedAt,questionIds:a.questions.map(q=>q.id)};
  assert.equal(b.post(request).status,'error');request.accessCode='test-code-001';
  const recovered=b.post(request);assert.equal(recovered.status,'ok');assert.equal(recovered.attempt.token,a.token);assert.equal(recovered.attempt.deadline,a.deadline);assert.equal(b.sheets.get('Attempts').rows.length,2);
  request.startedAt++;assert.equal(b.post(request).status,'error');assert.equal(b.sheets.get('Attempts').rows.length,2);
  request.rollNo='TEST002';request.accessCode='test-code-002';assert.equal(b.post(request).status,'error');assert.equal(b.sheets.get('Attempts').rows.length,2);
 });

}
