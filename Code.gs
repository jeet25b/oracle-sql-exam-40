// Apps Script backend. Add QuestionBank.gs to the same PRIVATE Apps Script project.
const SETTINGS_SHEET = "Settings";
const RESULTS_SHEET = "Results";
const ATTEMPTS_SHEET = "Attempts";
const STUDENTS_SHEET = "Students";
const EXAM_SIZE = 40;
const DEFAULT_DURATION = 60;
const API_VERSION = 3;
function adminPasskey() {
  const key = PropertiesService.getScriptProperties().getProperty("ADMIN_PASSKEY");
  if (!key) throw new Error("Faculty access is not configured. Set ADMIN_PASSKEY in Apps Script properties.");
  return key;
}
function doGet(e) {
  try {
    const params = e && e.parameter || {};
    if (!params.action || params.action === "status") return jsonResponse(getExamWindowStatus());
    if (params.action === "results") {
      if (!params.key || params.key !== adminPasskey()) throw new Error("Invalid teacher passkey.");
      return jsonResponse({status:"ok",window:getExamWindowStatus(),results:getAllResults()});
    }
    return jsonResponse({status:"error",message:"Unknown action."});
  } catch (err) { return jsonResponse({status:"error",message:err.message}); }
}
function doPost(e) {
  let lock = null;
  try {
    const data = JSON.parse(e.postData.contents);
    lock = LockService.getScriptLock(); lock.waitLock(30000);
    if (data.action === "updateWindow") {
      if (!data.key || data.key !== adminPasskey()) throw new Error("Invalid teacher passkey.");
      const open = new Date(data.openTime), close = new Date(data.closeTime);
      if (!isFinite(open.getTime()) || !isFinite(close.getTime()) || close <= open) throw new Error("Enter a valid opening and closing time.");
      const ss=SpreadsheetApp.getActiveSpreadsheet();
      let sheet=ss.getSheetByName(SETTINGS_SHEET);
      if(!sheet){sheet=ss.insertSheet(SETTINGS_SHEET);sheet.appendRow(["Key","Value"]);}
      const values=sheet.getDataRange().getValues();
      [["OPEN_TIME",data.openTime],["CLOSE_TIME",data.closeTime]].forEach(pair=>{
        const index=values.findIndex(row=>row[0]===pair[0]);
        if(index>=0)sheet.getRange(index+1,2).setValue(pair[1]);else sheet.appendRow(pair);
      });
      SpreadsheetApp.flush();
      return jsonResponse({status:"ok",message:"Exam window updated successfully.",window:getExamWindowStatus()});
    }
    const roll = normalizeRoll(data.rollNo);
    if (!/^[A-Z0-9][A-Z0-9._\/-]{2,59}$/.test(roll)) throw new Error("Enter a valid university roll number (3–60 characters).");
    if (data.action === "startAttempt") return jsonResponse(startAttempt(data, roll));
    if (data.action === "recoverAttempt") {
      verifyStudent(roll, data.accessCode);
      const saved = findAttempt(roll);
      if (!saved) throw new Error("The original attempt is missing from the server. Ask your teacher to restore its Attempts record. Your device answers have not been deleted.");
      const value = saved.value;
      const ids = value.questions.map(q => q.id);
      if (value.startedAt !== data.startedAt || JSON.stringify(ids) !== JSON.stringify(data.questionIds)) {
        throw new Error("The server holds a different attempt for this roll number. Ask your teacher to restore the original Attempts record. Saved answers cannot be transferred to a different exam.");
      }
      if(value.result)ensureResultSaved(value);
      return jsonResponse({status:"ok",attempt:publicAttempt(value),result:value.result || recordedResult(roll),serverNow:Date.now()});
    }
    if (data.action !== "saveAttempt" && data.action !== "submit" && data.action !== "submitQuestion") throw new Error("Unknown action.");
    const stored = findAttempt(roll);
    if (!stored || !data.token || stored.value.token !== data.token) throw new Error("Your session could not be verified. Sign in again with your access code.");
    const attempt = stored.value;
    // A response can be lost after a successful spreadsheet write. Retries return the same result.
    if (!attempt.result) attempt.result = recordedResult(roll);
    if (attempt.result) {
      ensureResultSaved(attempt);
      writeAttempt(stored.row,attempt);
      return jsonResponse({status:"ok",result:attempt.result});
    }
    const now=Date.now();
    if(data.action === "submitQuestion") {
      if(now>attempt.deadline)throw new Error("Time has expired. Submit the exam to view your result.");
      const question=attempt.questions.find(q=>q.id===data.questionId);
      if(!question)throw new Error("Invalid question.");
      if((attempt.lockedQuestions || []).includes(question.id))throw new Error("This question is locked.");
      updateAnswers(attempt,data);
      if(!Number.isInteger(attempt.answers[question.id]))throw new Error("Select an answer first.");
      attempt.feedback=attempt.feedback || {};
      attempt.feedback[question.id]={correct:question.ans,selected:attempt.answers[question.id]};
      writeAttempt(stored.row,attempt);
      return jsonResponse({status:"ok",questionId:question.id,correctOption:question.ans,selectedOption:attempt.answers[question.id]});
    }
    if (data.action === "saveAttempt") {
      if(now<=attempt.deadline){updateAnswers(attempt,data);writeAttempt(stored.row,attempt);}
      return jsonResponse({status:"ok",serverNow:now,lockedQuestions:attempt.lockedQuestions || [],answers:attempt.answers});
    }
    // Allow 15 seconds for the final request to arrive. Later retries grade the last online save.
    if(now<=attempt.deadline+15000) updateAnswers(attempt,data);
    attempt.result = gradeAttempt(attempt);
    appendResult(attempt);
    SpreadsheetApp.flush();
    writeAttempt(stored.row,attempt);
    return jsonResponse({status:"ok",result:attempt.result});
  } catch(err) { return jsonResponse({status:"error",message:err.message || String(err)}); }
  finally { if(lock && lock.hasLock()) lock.releaseLock(); }
}
function verifyStudent(roll, code) {
  const sheet=SpreadsheetApp.getActiveSpreadsheet().getSheetByName(STUDENTS_SHEET);
  if(!sheet || sheet.getLastRow()<2) throw new Error("Student access is not configured. Ask your teacher to set up the student roster.");
  const rows=sheet.getRange(2,1,sheet.getLastRow()-1,3).getDisplayValues();
  const row=rows.find(r=>normalizeRoll(r[0])===roll);
  if(!row || !code || String(row[2])!==String(code)) throw new Error("The roll number or student access code is incorrect.");
  return {name:String(row[1]).trim()};
}
function startAttempt(data, roll) {
  const student=verifyStudent(roll,data.accessCode);
  const stored=findAttempt(roll);
  if(stored){
    const attempt=stored.value;
    attempt.result=attempt.result || recordedResult(roll);
    if(!attempt.result && Date.now()>attempt.deadline+15000){
      attempt.result=gradeAttempt(attempt);appendResult(attempt);SpreadsheetApp.flush();
    }
    if(attempt.result)ensureResultSaved(attempt);
    writeAttempt(stored.row,attempt);
    return {status:"ok",attempt:publicAttempt(attempt),result:attempt.result || null,serverNow:Date.now()};
  }
  if(recordedResult(roll)) throw new Error("Only one attempt is allowed. This roll number has already submitted the exam.");
  const win=getExamWindowStatus();
  if(!win.isOpen) throw new Error(win.message || "The exam is not open.");
  const pool=MASTER_QUESTION_BANK.filter(q=>q.important===true).slice();
  if(pool.length<EXAM_SIZE) throw new Error("The question bank must contain at least 40 eligible questions.");
  for(let i=pool.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[pool[i],pool[j]]=[pool[j],pool[i]];}
  const now=Date.now();
  const name=student.name || String(data.name || "").trim();
  const batch=String(data.batch || "").trim();
  if(!name || name.length>120 || !batch || batch.length>180) throw new Error("Complete your name and academic details.");
  const attempt={roll:roll,name:name,batch:batch,token:Utilities.getUuid(),startedAt:now,
    deadline:Math.min(now+win.durationMinutes*60000,new Date(win.closeISO).getTime()),
    updatedAt:now,questions:balanceAnswerPositions(pool.slice(0,EXAM_SIZE)),answers:{},flags:[],lockedQuestions:[],seenQuestions:[],feedback:{},currentIdx:0,tabSwitches:0,focusLosses:0,result:null};
  const sheet=attemptSheet();sheet.appendRow([roll,attempt.token,JSON.stringify(attempt)]);SpreadsheetApp.flush();
  return {status:"ok",attempt:publicAttempt(attempt),serverNow:now};
}
// Assign a shuffled, exactly balanced answer-position schedule per new attempt.
function balanceAnswerPositions(questions){
  if(questions.length!==40)throw new Error("Balanced exams require exactly 40 questions.");
  const positions=Array.from({length:40},(_,i)=>i%4);
  for(let i=positions.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[positions[i],positions[j]]=[positions[j],positions[i]];}
  return questions.map((q,index)=>{
    if(!Array.isArray(q.options) || q.options.length!==4 || !Number.isInteger(q.ans) || q.ans<0 || q.ans>3)throw new Error("Each exam question must have four options and a valid answer key.");
    const distractors=q.options.filter((_,i)=>i!==q.ans);
    for(let i=distractors.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[distractors[i],distractors[j]]=[distractors[j],distractors[i]];}
    const options=distractors.slice();options.splice(positions[index],0,q.options[q.ans]);
    return Object.assign({},q,{options:options,ans:positions[index]});
  });
}
function publicAttempt(attempt){
  return {roll:attempt.roll,name:attempt.name,batch:attempt.batch,token:attempt.token,startedAt:attempt.startedAt,deadline:attempt.deadline,updatedAt:attempt.updatedAt || attempt.startedAt,
    questions:attempt.questions.map(q=>({id:q.id,topic:q.topic,q:q.q,options:q.options})),
    answers:attempt.answers,flags:attempt.flags,seenQuestions:attempt.seenQuestions || [],feedback:attempt.feedback || {},lockedQuestions:attempt.lockedQuestions || [],currentIdx:attempt.currentIdx,tabSwitches:attempt.tabSwitches,focusLosses:attempt.focusLosses || 0};
}
function attemptSheet(){
  const ss=SpreadsheetApp.getActiveSpreadsheet();let sheet=ss.getSheetByName(ATTEMPTS_SHEET);
  if(!sheet){sheet=ss.insertSheet(ATTEMPTS_SHEET);sheet.appendRow(["Roll Number","Attempt Token","Attempt JSON"]);}
  return sheet;
}
function findAttempt(roll){
  const sheet=SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ATTEMPTS_SHEET);
  if(!sheet || sheet.getLastRow()<2)return null;
  const rows=sheet.getRange(2,1,sheet.getLastRow()-1,3).getValues();
  for(let i=0;i<rows.length;i++)if(normalizeRoll(rows[i][0])===roll)return {row:i+2,value:JSON.parse(rows[i][2])};
  return null;
}
function writeAttempt(row,attempt){attemptSheet().getRange(row,3).setValue(JSON.stringify(attempt));SpreadsheetApp.flush();}
function updateAnswers(attempt,data){
  if(!data.answers || typeof data.answers!=="object" || Array.isArray(data.answers))throw new Error("Invalid answer data.");
  const clean={};
  attempt.questions.forEach(q=>{
    // Once recorded, a lock cannot be removed by a later save, refresh or final submission.
    const selected=(attempt.lockedQuestions || []).includes(q.id) ? attempt.answers[q.id] : data.answers[q.id];
    if(selected!==undefined){if(!Number.isInteger(selected) || selected<0 || selected>=q.options.length)throw new Error("Invalid answer option.");clean[q.id]=selected;}
  });
  const ids=attempt.questions.map(q=>q.id);
  attempt.seenQuestions=[...new Set([...(attempt.seenQuestions || []), ...(Array.isArray(data.seenQuestions)?data.seenQuestions:[])])].filter(id=>ids.includes(id));
  const lostFocus=Number(data.tabSwitches)>(attempt.tabSwitches || 0) || Number(data.focusLosses)>(attempt.focusLosses || 0);
  attempt.updatedAt=Date.now();
  attempt.answers=clean;
  attempt.lockedQuestions=[...new Set([...(attempt.lockedQuestions || []), ...(Array.isArray(data.lockedQuestions)?data.lockedQuestions:[]), ...(lostFocus?attempt.seenQuestions:[])])].filter(id=>ids.includes(id));
  attempt.flags=Array.isArray(data.flags)?[...new Set(data.flags)].filter(id=>ids.includes(id)):[];
  attempt.currentIdx=Number.isInteger(data.currentIdx)?Math.max(0,Math.min(ids.length-1,data.currentIdx)):0;
  attempt.focusLosses=Math.max(attempt.focusLosses || 0,Math.max(0,Math.floor(Number(data.focusLosses)||0)));
  attempt.tabSwitches=Math.max(attempt.tabSwitches || 0,Math.max(0,Number(data.tabSwitches)||0));
}
function gradeAttempt(attempt){
  const details=attempt.questions.map((q,i)=>{
    const selected=attempt.answers[q.id];const mark=selected===q.ans?1:0;
    return {qNo:i+1,questionId:q.id,selected:Number.isInteger(selected)?selected:"NA",mark:mark,
      status:selected===undefined?"unattempted":mark?"correct":"wrong"};
  });
  const correct=details.filter(d=>d.status==="correct").length,wrong=details.filter(d=>d.status==="wrong").length;
  return {score:correct,totalQuestions:details.length,percentage:Math.round(correct/details.length*10000)/100,
    correctCount:correct,wrongCount:wrong,unattemptedCount:details.length-correct-wrong,details:details,
    submittedAt:new Date().toISOString(),timeTakenSec:Math.max(0,Math.round((Math.min(Date.now(),attempt.deadline)-attempt.startedAt)/1000))};
}
function safeCell(value){const text=String(value || "");return /^[=+@\-]/.test(text)?"'"+text:text;}
// Resolve both the original nine-column Results layout and the newer detailed layout.
function resultColumn(headers, names){return headers.findIndex(h=>names.includes(String(h).trim()));}
function readResult(headers,row){
  const value=(names,fallback="")=>{const i=resultColumn(headers,names);return i<0 || row[i]===undefined || row[i]===""?fallback:row[i];};
  const score=Number(value(["Total Score","Score"],0)),total=Number(value(["Max Marks","TotalQuestions"],40));
  let details=[];const raw=value(["Question Breakdown JSON"]);
  if(raw){try{details=JSON.parse(raw);}catch(_){details=[];}}
  return {timestamp:value(["Timestamp (IST)","Timestamp"]),rollNo:value(["Roll Number","RollNumber"]),name:value(["Student Name","StudentName"]),batch:value(["Batch"]),
    score:score,maxMarks:total,tabSwitches:value(["TabSwitches"]),focusLosses:value(["FocusLosses"]),lockedQuestions:value(["LockedQuestions"]),percentage:total?Math.round(score/total*10000)/100:0,
    correct:value(["Correct"],details.length?details.filter(d=>d.status==="correct").length:""),
    wrong:value(["Wrong"],details.length?details.filter(d=>d.status==="wrong").length:""),
    unattempted:value(["Unattempted"],details.length?details.filter(d=>d.status==="unattempted").length:""),details:details,
    qMarks:headers.flatMap((h,i)=>/^Q\d+_Marks$/.test(String(h))?[{q:String(h).replace("_Marks",""),mark:row[i]??""}]:[])};
}
function appendResult(attempt){
  const ss=SpreadsheetApp.getActiveSpreadsheet();let sheet=ss.getSheetByName(RESULTS_SHEET);
  if(!sheet)sheet=ss.insertSheet(RESULTS_SHEET);
  if(!sheet.getLastRow())sheet.appendRow(["Timestamp (IST)","Roll Number","Student Name","Batch","Total Score","Max Marks","Correct","Wrong","Unattempted","Question Breakdown JSON"]);
  const headers=sheet.getDataRange().getValues()[0].map(String);
  if(resultColumn(headers,["Roll Number","RollNumber"])<0 || resultColumn(headers,["Score","Total Score"])<0)throw new Error("Results headers are not recognized. Keep RollNumber/Score or Roll Number/Total Score headers.");
  const r=attempt.result;
  const fields=[[["Timestamp (IST)","Timestamp"],Utilities.formatDate(new Date(r.submittedAt || Date.now()),"Asia/Kolkata","dd MMM yyyy, hh:mm:ss a")],
    [["Roll Number","RollNumber"],attempt.roll],[["Student Name","StudentName"],safeCell(attempt.name)],[["Batch"],safeCell(attempt.batch)],
    [["Total Score","Score"],r.score],[["Max Marks","TotalQuestions"],r.totalQuestions],[["Percentage"],r.percentage/100],
    [["TimeTakenSec"],r.timeTakenSec??""],[["TabSwitches"],attempt.tabSwitches||0],[["FocusLosses"],attempt.focusLosses??""],[["LockedQuestions"],(attempt.lockedQuestions || []).length],[["Correct"],r.correctCount],[["Wrong"],r.wrongCount],[["Unattempted"],r.unattemptedCount],[["Question Breakdown JSON"],JSON.stringify(r.details)]];
  r.details.forEach(d=>{
    const q=attempt.questions.find(q=>q.id===d.questionId),prefix="Q"+d.qNo;
    fields.push([[prefix+"_Marks"],d.mark],[[prefix+"_QuestionID"],d.questionId],[[prefix+"_Question"],safeCell(q?q.q:"")],
      [[prefix+"_Selected"],Number.isInteger(d.selected)?String.fromCharCode(65+d.selected):"Unanswered"],
      [[prefix+"_Correct"],q?String.fromCharCode(65+q.ans):""],[[prefix+"_Status"],d.status]);
  });
  const row=[];
  fields.forEach(([aliases,value])=>{let i=resultColumn(headers,aliases);if(i<0){i=headers.length;headers.push(aliases[0]);}row[i]=value;});
  const needed=headers.length-sheet.getMaxColumns();if(needed>0)sheet.insertColumnsAfter(sheet.getMaxColumns(),needed);
  sheet.getRange(1,1,1,headers.length).setValues([headers]).setFontWeight("bold");
  sheet.appendRow(headers.map((_,i)=>row[i]??""));
  const percent=resultColumn(headers,["Percentage"]);sheet.getRange(sheet.getLastRow(),percent+1).setNumberFormat("0.00%");
}
function recordedResult(roll){
  const sheet=SpreadsheetApp.getActiveSpreadsheet().getSheetByName(RESULTS_SHEET);
  if(!sheet || sheet.getLastRow()<2)return null;
  const rows=sheet.getDataRange().getValues(),headers=rows[0],column=resultColumn(headers,["Roll Number","RollNumber"]);
  if(column<0)return null;
  const row=rows.slice(1).find(r=>normalizeRoll(r[column])===roll);if(!row)return null;
  const r=readResult(headers,row);
  return {score:r.score,totalQuestions:r.maxMarks,percentage:r.percentage,correctCount:r.correct,wrongCount:r.wrong,unattemptedCount:r.unattempted,details:r.details};
}
function ensureResultSaved(attempt){
  if(!recordedResult(attempt.roll)){appendResult(attempt);SpreadsheetApp.flush();}
}
// Run manually from Apps Script to restore completed Attempts that are missing from Results.
// It never finalizes unfinished attempts and never creates duplicate roll-number rows.
function repairMissingResults(){
  const lock=LockService.getScriptLock();lock.waitLock(30000);
  try{
    const sheet=SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ATTEMPTS_SHEET);
    if(!sheet || sheet.getLastRow()<2)return 0;
    let count=0;
    sheet.getRange(2,1,sheet.getLastRow()-1,3).getValues().forEach(row=>{
      const attempt=JSON.parse(row[2]);
      if(attempt.result && !recordedResult(attempt.roll)){ensureResultSaved(attempt);count++;}
    });
    console.log("Restored "+count+" missing results.");return count;
  }finally{if(lock.hasLock())lock.releaseLock();}
}
function getExamWindowStatus(){
  const sheet=SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SETTINGS_SHEET);
  const settings={};if(sheet && sheet.getLastRow()>1)sheet.getRange(2,1,sheet.getLastRow()-1,2).getValues().forEach(r=>settings[r[0]]=r[1]);
  const openValue=settings.OPEN_TIME || settings.StartTimeIST,closeValue=settings.CLOSE_TIME || settings.EndTimeIST;
  const open=new Date(openValue || NaN),close=new Date(closeValue || NaN);
  const duration=Number(settings.DurationMinutes || DEFAULT_DURATION);
  const base={apiVersion:API_VERSION,examTitle:String(settings.ExamTitle || "Oracle SQL Assessment"),durationMinutes:isFinite(duration)&&duration>0?duration:DEFAULT_DURATION};
  if(!isFinite(open.getTime()) || !isFinite(close.getTime()) || close<=open)return Object.assign(base,{state:"LOCKED",isOpen:false,message:"The exam schedule has not been configured. Please contact your teacher."});
  const now=Date.now(),state=now<open.getTime()?"NOT_STARTED":now>=close.getTime()?"CLOSED":"OPEN";
  return Object.assign(base,{state:state,isOpen:state==="OPEN",openISO:open.toISOString(),closeISO:close.toISOString(),
    openFormatted:Utilities.formatDate(open,"Asia/Kolkata","dd MMM yyyy, HH:mm")+" IST (UTC+05:30)",
    closeFormatted:Utilities.formatDate(close,"Asia/Kolkata","dd MMM yyyy, HH:mm")+" IST (UTC+05:30)"});
}

function getAllResults(){
  const sheet=SpreadsheetApp.getActiveSpreadsheet().getSheetByName(RESULTS_SHEET);
  if(!sheet || sheet.getLastRow()<2)return [];
  const rows=sheet.getDataRange().getValues();return rows.slice(1).map(row=>readResult(rows[0],row));
}

function normalizeRoll(value){return String(value || "").trim().toUpperCase();}
function jsonResponse(value){return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);}
