const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),crypto=require('node:crypto');
function createBackend(){
 const sheets=new Map();let clock=Date.now(),locked=false;
 class Sheet{
  constructor(rows=[]){this.rows=rows;}
  getLastRow(){return this.rows.length;}
  getMaxColumns(){return Math.max(26,...this.rows.map(r=>r.length));}
  insertColumnsAfter(){return this;}
  appendRow(row){this.rows.push([...row]);return this;}
  getRange(row,col,n=1,m=1){const self=this;return {
   getValues(){return Array.from({length:n},(_,i)=>Array.from({length:m},(_,j)=>self.rows[row-1+i]?.[col-1+j]??''));},
   getDisplayValues(){return this.getValues().map(r=>r.map(String));},
   setValue(value){while(self.rows.length<row)self.rows.push([]);self.rows[row-1][col-1]=value;return this;},setValues(values){for(let i=0;i<n;i++){while(self.rows.length<row+i)self.rows.push([]);for(let j=0;j<m;j++)self.rows[row-1+i][col-1+j]=values[i][j];}return this;},setNumberFormat(){return this;},setFontWeight(){return this;}
  };}
  getDataRange(){return this.getRange(1,1,this.rows.length,Math.max(1,...this.rows.map(r=>r.length)));}
 }
 sheets.set('Settings',new Sheet([['Key','Value'],['OPEN_TIME',new Date(clock-3600000).toISOString()],['CLOSE_TIME',new Date(clock+7200000).toISOString()],['DurationMinutes',60]]));
 sheets.set('Students',new Sheet([['Roll Number','Student Name','Access Code'],['TEST001','Alex Morgan','test-code-001'],['TEST002','Sam Lee','test-code-002']]));
 const spreadsheet={getSheetByName:n=>sheets.get(n)||null,insertSheet:n=>{const s=new Sheet();sheets.set(n,s);return s;}};
 class MockDate extends Date{constructor(...a){super(...(a.length?a:[clock]));}static now(){return clock;}}
 const ctx=vm.createContext({Date:MockDate,SpreadsheetApp:{getActiveSpreadsheet:()=>spreadsheet,flush(){}},Utilities:{getUuid:()=>crypto.randomUUID(),formatDate:date=>new Date(date).toISOString().slice(0,16)},PropertiesService:{getScriptProperties:()=>({getProperty:key=>key==='ADMIN_PASSKEY'?'test-admin-key':null})},LockService:{getScriptLock:()=>({tryLock(){if(locked)return false;locked=true;return true;},waitLock(){if(locked)throw Error('Lock already held');locked=true;},hasLock:()=>locked,releaseLock(){locked=false;}})},ContentService:{MimeType:{JSON:'json'},createTextOutput:text=>({text,setMimeType(){return this;}})}});
 const root=path.join(__dirname,'..');vm.runInContext(fs.readFileSync(path.join(root,'QuestionBank.gs'),'utf8'),ctx);vm.runInContext(fs.readFileSync(path.join(root,'Code.gs'),'utf8'),ctx);
 const post=payload=>{ctx.payload=JSON.stringify(payload);return JSON.parse(vm.runInContext('doPost({postData:{contents:payload}})',ctx).text);};
 const get=params=>{ctx.params=params;return JSON.parse(vm.runInContext('doGet({parameter:params})',ctx).text);};
 return {post,get,ctx,sheets,now:()=>clock,advance:ms=>clock+=ms,setClock:value=>clock=value,locked:()=>locked};
}
module.exports={createBackend};
