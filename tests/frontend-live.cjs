const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const script = html.slice(html.indexOf('const { createApp }'), html.lastIndexOf('</script>'));
assert.doesNotMatch(html, /DEMO_|isDemoMode|resetToDemo|quickFillStaff|9999|7777|images\.unsplash/);
let config;
const storage = new Map();
const session = new Map();
let calls = 0;
let response = {success:true,devices:[],whitelist:[],audit_queue:[],edit_logs:[]};
const context = vm.createContext({
  Vue: {createApp: options => {config=options; return {mount() {}};}},
  localStorage: {getItem: key => storage.get(key) || null, setItem: (key,value) => storage.set(key,value), removeItem: key => storage.delete(key)},
  sessionStorage: {getItem: key => session.get(key) || null, setItem: (key,value) => session.set(key,value), removeItem: key => session.delete(key)},
  URL,
  confirm: () => true,
  fetch: async () => {calls++; if (response instanceof Error) throw response; return {json:async()=>response};},
  setTimeout() {}
});
vm.runInContext(script, context);
const app = config.data();
for(const [name,fn] of Object.entries(config.methods)) app[name]=fn.bind(app);
for(const [name,fn] of Object.entries(config.computed)) Object.defineProperty(app,name,{get:fn.bind(app)});
(async()=>{
  assert.equal(app.adminUser,null);
  storage.set('slam_staff_user', JSON.stringify({user_id:'admin',full_name:'Admin',role:'ADMIN'}));
  assert.equal(config.data().adminUser.user_id,'admin','Refresh restores staff login');
  app.adminUser=config.data().adminUser;
  app.logoutStaff();
  assert.equal(config.data().adminUser,null,'Logout clears saved login');
  storage.set('slam_staff_user','broken-json');
  assert.equal(config.data().adminUser,null,'Corrupt saved data cannot break startup');
  storage.set('slam_staff_user',JSON.stringify({user_id:'x',full_name:'X',role:'STUDENT'}));
  assert.equal(config.data().adminUser,null);
  storage.delete('slam_staff_user');
  assert.equal(app.staffLoginForm.pin,'');
  assert.equal(app.studentSession,'');
  assert.equal(app.currentStudent,null);
  assert.ok(app.apiUrl.startsWith('https://script.google.com/macros/s/'));
  assert.equal(app.configApiUrl,app.apiUrl);
  app.apiUrl='';
  await app.fetchData();
  assert.equal(calls,0);
  assert.ok(app.connectionError);
  assert.equal(app.devices.length,0);
  assert.throws(()=>app.requestApi({method:'POST'}));
  // Unified login routes students to the member session and restores it for the tab.
  app.apiUrl='https://example.com/api';
  const realRequestApi=app.requestApi;
  app.requestApi=async()=>({json:async()=>({success:true,user:{user_id:'sv01',full_name:'An',role:'STUDENT'},session:'STUDENT-SESSION'})});
  app.staffLoginForm={user_id:'sv01',pin:'test-sv-password'};
  await app.handleStaffLogin();
  assert.equal(app.currentStudent.user_id,'sv01');
  assert.equal(app.studentSession,'STUDENT-SESSION');
  assert.equal(app.adminUser,null);
  assert.equal(app.showStaffLoginModal,false);
  assert.equal(config.data().currentStudent.user_id,'sv01','Refresh restores student login');
  assert.equal(config.data().studentSession,'STUDENT-SESSION');
  app.logoutStaff();
  assert.equal(app.currentStudent,null);
  assert.equal(app.studentSession,'');
  assert.equal(config.data().currentStudent,null,'Logout clears saved student login');
  app.requestApi=realRequestApi;
  response={success:true,devices:[{device_id:'REAL'}],whitelist:[],audit_queue:[],edit_logs:[]};
  await app.fetchData();
  assert.equal(app.devices[0].device_id,'REAL');
  assert.equal(app.connectionError,'');
  response=new Error('offline');
  await app.fetchData();
  assert.equal(app.devices.length,0);
  assert.ok(app.connectionError.includes('offline'));
  response={success:false,message:'Denied'};
  await app.fetchData();
  assert.ok(app.connectionError.includes('Denied'));
  app.configApiUrl='https://malicious.com/api';
  app.saveSettings();
  assert.equal(app.apiUrl,'https://example.com/api', 'Non-admin cannot save API settings');
  app.configApiUrl='';
  app.saveSettings();
  assert.equal(app.apiUrl,'https://example.com/api');
  // A successful deletion disappears before the follow-up GET completes.
  app.adminUser={user_id:'admin',full_name:'Admin',role:'ADMIN'};
  app.devices=[{device_id:'D1'},{device_id:'D2'}];
  const originalRequest=app.requestApi;
  let finishRefresh;
  let refreshStarted=false;
  app.requestApi=async options=>{
    if(options.method==='POST') return {json:async()=>({success:true,message:'Deleted'})};
    refreshStarted=true;
    return new Promise(resolve=>{finishRefresh=()=>resolve({json:async()=>({success:true,devices:[{device_id:'D2'}],whitelist:[]})});});
  };
  const deletion=app.deleteDeviceAsAdmin(app.devices[0]);
  while(!refreshStarted) await Promise.resolve();
  assert.equal(app.devices.length,1);
  assert.equal(app.devices[0].device_id,'D2');
  assert.ok(app.deletingDeviceIds.includes('D1'));
  finishRefresh();
  await deletion;
  assert.equal(app.deletingDeviceIds.length,0);
  app.requestApi=async()=>({json:async()=>({success:false,message:'Denied'})});
  await app.deleteDeviceAsAdmin(app.devices[0]);
  assert.equal(app.devices[0].device_id,'D2','Failed deletion retains device');
  app.requestApi=originalRequest;
  console.log('PASS: live-only startup, API success/failure, empty state, missing API guard, no sample data');
})().catch(error=>{console.error(error);process.exitCode=1;});
