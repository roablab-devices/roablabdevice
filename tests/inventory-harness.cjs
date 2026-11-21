const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../Code.gs'), 'utf8');

function harness({now = '2026-11-23T01:00:00.000Z', migrate = true, timezone = 'Asia/Ho_Chi_Minh', sourceOverride = source} = {}) {
  const rows = {
    Devices: [['ID','Name','Category','Location','Accessories','Image','Specs','Document','Status','Holder','Holder name','Purpose','Updated'], ['D1','Single device','Khác','Lab','','','','','Trong kho','','','','']],
    Users: [['ID','PIN','Name','Phone','Role','Cohort'], ['admin','test-admin-password','Admin','','ADMIN'], ['qa','test-qa-password','QA','','INSPECTOR'], ['sv01','','An','','STUDENT'], ['sv02','','Bình','','STUDENT']],
    Logs: [['Time','ID','User','Action','Devices','Purpose','Accessories','Condition','Note','Photo','Preview','Audit','Inspector','Audit note']]
  };
  let writes = 0, locked = false, uid = 0, failWrite = false;
  const cache = new Map();
  const formats = {};
  const stamp = {value:new Date(now).getTime()};
  class ClockDate extends Date { constructor(...args) { super(...(args.length ? args : [stamp.value])); } static now() { return stamp.value; } }
  function sheet(name) {
    return {
      getDataRange: () => ({getValues: () => rows[name].map(r => [...r])}),
      getLastRow: () => rows[name].length,
      appendRow: row => { if (failWrite) throw Error('Simulated write failure'); writes++; rows[name].push([...row]); },
      deleteRow: r => {writes++;rows[name].splice(r-1,1);},
      setFrozenRows() {},
      getRange: (r,c,nr=1,nc=1) => {
        const range = {
          setValues(matrix) { if (failWrite) throw Error('Simulated write failure'); writes++; matrix.forEach((row,i) => row.forEach((value,j) => {if(!rows[name][r+i-1])rows[name][r+i-1]=[];rows[name][r+i-1][c+j-1]=value;}));return range; },
          setValue(value) {return range.setValues([[value]]);},
          setFormula(value) {return range.setValue(value);},
          setNumberFormat(value) {if(failWrite)throw Error('Simulated write failure');writes++;formats[name+':'+r+':'+c+':'+nr+':'+nc]=value;return range;},
          setFontWeight() {return range;},setBackground() {return range;},setFontColor() {return range;}
        };return range;
      }
    };
  }
  const ss = {getSheetByName: name => rows[name] ? sheet(name) : null,insertSheet:name => {rows[name]=[];return sheet(name);},getSpreadsheetTimeZone:()=>timezone};
  const context = vm.createContext({Date:ClockDate,console,
    SpreadsheetApp:{getActiveSpreadsheet:()=>ss,flush(){}},
    LockService:{getScriptLock:()=>({waitLock(){if(locked)throw Error('busy');locked=true;},releaseLock(){locked=false;}})},
    CacheService:{getScriptCache:()=>({get:key=>cache.get(key),put:(key,value)=>cache.set(key,value),remove:key=>cache.delete(key)})},
    ContentService:{MimeType:{JSON:'json'},createTextOutput:text=>({setMimeType:()=>JSON.parse(text)})},
    Utilities:{DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},computeDigest:(algorithm,value)=>Array.from(require('node:crypto').createHash('sha256').update(value).digest()),getUuid:()=> 'uuid-' + (++uid),formatDate:(date,zone,pattern)=>pattern==='HH:mm' ? new Intl.DateTimeFormat('en-GB',{timeZone:zone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(date) : new Date(date).toISOString().slice(0,19).replace('T',' '),base64Decode:text=>Array.from(Buffer.from(text,'base64')),newBlob:(bytes,type,name)=>({bytes,type,name})},
    Logger:{log(){}},DriveApp:{getFolderById(){throw Error('Unexpected upload');}}
  });
  vm.runInContext(sourceOverride, context);
  const post = payload => context.doPost({postData:{contents:JSON.stringify(payload)}});
  const login = (id='admin',pin='test-admin-password') => {const response=post({action:'admin_login',user_id:id,pin});if(!response.success)throw Error(response.message);return response.staff_session;};
  const admin=login(), qa=login('qa','test-qa-password');
  const adminPost=payload=>post({...payload,staff_session:admin});
  const qaPost=payload=>post({...payload,staff_session:qa});
  if(migrate) {const result=adminPost({action:'admin_upgrade_schema'});if(!result.success)throw Error(result.message);}
  function addDevice(id, config={}) {
    const result=adminPost({action:'admin_save_device',device_id:id,name:id,usage_mode:'portable',tracking_mode:'quantity',total_quantity:20,unavailable_quantity:0,service_status:'ready',open_hour:'08:00',close_hour:'18:00',max_minutes:480,buffer_minutes:0,...config});
    if(!result.success)throw Error(result.message);return result;
  }
  const get=()=>context.doGet({});
  const stock=id=>get().devices.find(d=>d.device_id===id).stock;
  return {rows,context,ss,post,adminPost,qaPost,addDevice,get,stock,cache,formats,admin,qa,stamp,writes:()=>writes,setFailWrite:value=>failWrite=value,setLocked:value=>locked=value};
}
module.exports = {harness};
