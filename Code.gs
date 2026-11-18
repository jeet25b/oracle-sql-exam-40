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
    if (data.action !== "saveAttempt" && data.action !== "submit") throw new Error("Unknown action.");
    const stored = findAttempt(roll);
    if (!stored || !data.token || stored.value.token !== data.token) throw new Error("Your session could not be verified. Sign in again with your access code.");
    const attempt = stored.value;
    // A response can be lost after a successful spreadsheet write. Retries return the same result.
    if (!attempt.result) attempt.result = recordedResult(roll);
    if (attempt.result) {
      writeAttempt(stored.row,attempt);
      return jsonResponse({status:"ok",result:attempt.result});
    }
    const now=Date.now();
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
    updatedAt:now,questions:pool.slice(0,EXAM_SIZE),answers:{},flags:[],lockedQuestions:[],currentIdx:0,tabSwitches:0,result:null};
  const sheet=attemptSheet();sheet.appendRow([roll,attempt.token,JSON.stringify(attempt)]);SpreadsheetApp.flush();
  return {status:"ok",attempt:publicAttempt(attempt),serverNow:now};
}
function publicAttempt(attempt){
  return {roll:attempt.roll,name:attempt.name,batch:attempt.batch,token:attempt.token,startedAt:attempt.startedAt,deadline:attempt.deadline,updatedAt:attempt.updatedAt || attempt.startedAt,
    questions:attempt.questions.map(q=>({id:q.id,topic:q.topic,q:q.q,options:q.options})),
    answers:attempt.answers,flags:attempt.flags,lockedQuestions:attempt.lockedQuestions || [],currentIdx:attempt.currentIdx,tabSwitches:attempt.tabSwitches};
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
  attempt.updatedAt=Date.now();
  attempt.answers=clean;
  attempt.lockedQuestions=[...new Set([...(attempt.lockedQuestions || []), ...(Array.isArray(data.lockedQuestions)?data.lockedQuestions:[])])].filter(id=>ids.includes(id));
  attempt.flags=Array.isArray(data.flags)?[...new Set(data.flags)].filter(id=>ids.includes(id)):[];
  attempt.currentIdx=Number.isInteger(data.currentIdx)?Math.max(0,Math.min(ids.length-1,data.currentIdx)):0;
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
function appendResult(attempt){
  const ss=SpreadsheetApp.getActiveSpreadsheet();let sheet=ss.getSheetByName(RESULTS_SHEET);
  const r=attempt.result;
  if(!sheet || sheet.getLastRow()===0){
    if(!sheet)sheet=ss.insertSheet(RESULTS_SHEET);
    const headers=["Timestamp (IST)","Roll Number","Student Name","Batch","Total Score","Max Marks","Correct","Wrong","Unattempted","Question Breakdown JSON"];
    for(let i=1;i<=r.totalQuestions;i++)headers.push("Q"+i+"_Marks");
    sheet.appendRow(headers);sheet.getRange(1,1,1,headers.length).setFontWeight("bold");
  }
  const headers=sheet.getRange(1,1,1,10).getValues()[0];
  if(headers[1]!=="Roll Number" || headers[9]!=="Question Breakdown JSON")throw new Error("Results sheet uses an older layout. Rename it to Results_Archive before using this version.");
  sheet.appendRow([Utilities.formatDate(new Date(),"Asia/Kolkata","dd MMM yyyy, hh:mm:ss a"),attempt.roll,safeCell(attempt.name),safeCell(attempt.batch),r.score,r.totalQuestions,r.correctCount,r.wrongCount,r.unattemptedCount,JSON.stringify(r.details),...r.details.map(d=>d.mark)]);
}
function recordedResult(roll){
  const sheet=SpreadsheetApp.getActiveSpreadsheet().getSheetByName(RESULTS_SHEET);
  if(!sheet || sheet.getLastRow()<2)return null;
  const rows=sheet.getDataRange().getValues();
  const row=rows.slice(1).find(r=>normalizeRoll(r[1])===roll);if(!row)return null;
  const details=typeof row[9]==="string" && row[9]?JSON.parse(row[9]):[];
  return {score:Number(row[4]),totalQuestions:Number(row[5]),percentage:Math.round(Number(row[4])/Number(row[5])*10000)/100,
    correctCount:Number(row[6]),wrongCount:Number(row[7]),unattemptedCount:Number(row[8]),details:details};
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

function getAllResults() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(RESULTS_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return [];

  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const rows = [];

  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    const qMarks = [];
    for (let c = 10; c < headers.length; c++) {
      qMarks.push({ q: headers[c].replace("_Marks", ""), mark: r[c] });
    }
    rows.push({
      timestamp: r[0],
      rollNo: r[1],
      name: r[2],
      batch: r[3],
      score: r[4],
      maxMarks: r[5],
      correct: r[6],
      wrong: r[7],
      unattempted: r[8],
      details: r[9] ? JSON.parse(r[9]) : [],
      qMarks: qMarks
    });
  }
  return rows;
}


function normalizeRoll(value){return String(value || "").trim().toUpperCase();}
function jsonResponse(value){return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);}
