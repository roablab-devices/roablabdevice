const assert=require('node:assert/strict');
const {harness}=require('./inventory-harness.cjs');
let count=0;
function test(name,fn){try{fn();count++;}catch(e){e.message=name+': '+e.message;throw e;}}
const success=r=>{assert.equal(r.success,true,r.message);return r;};
const payload=(extra={})=>({action:'booking_create',device_id:'ROBOT',user_id:'sv01',quantity:1,purpose:'Thực hành',booking_date:'2026-11-24',booking_session:'morning',request_id:'session-001',...extra});
function setup(config={}){const h=harness();h.addDevice('ROBOT',{usage_mode:'lab',total_quantity:6,max_minutes:240,...config});return h;}
function rejected(h,p,admin=false){const before=h.writes();const r=(admin?h.adminPost:h.post)(p);assert.equal(r.success,false);assert.equal(h.writes(),before);return r;}
test('Server resolves both sessions in Vietnam time and stores their labels',()=>{
 const h=setup();success(h.post(payload()));success(h.post(payload({booking_session:'afternoon',request_id:'session-002'})));
 const [am,pm]=h.get().bookings;assert.equal(am.session,'morning');assert.equal(am.start_at,'2026-11-24T01:00:00.000Z');assert.equal(am.end_at,'2026-11-24T05:00:00.000Z');
 assert.equal(am.status,'approved');assert.equal(am.reviewed_by,'');assert.equal(pm.status,'approved');
 assert.equal(pm.session,'afternoon');assert.equal(pm.start_at,'2026-11-24T06:00:00.000Z');assert.equal(pm.end_at,'2026-11-24T10:00:00.000Z');
});
test('Missing, unknown, malformed, impossible and distant dates fail without writes',()=>{
 const h=setup();for(const extra of [{booking_session:''},{booking_session:'evening'},{booking_date:''},{booking_date:'2027-02-30'},{booking_date:'2026-1-24'},{booking_date:'2028-11-24'},{booking_date:'2026-11-22'}])rejected(h,payload(extra));
});
test('A begun morning is unavailable while the upcoming afternoon remains bookable',()=>{
 const h=setup();h.stamp.value=new Date('2026-11-23T05:33:00Z').getTime();
 rejected(h,payload({booking_date:'2026-11-23'}));success(h.post(payload({booking_date:'2026-11-23',booking_session:'afternoon'})));
 h.stamp.value=new Date('2026-11-23T06:00:00Z').getTime();rejected(h,payload({booking_date:'2026-11-23',booking_session:'afternoon',request_id:'session-002'}));
});
test('Clients cannot supply custom timestamps or tamper with session times',()=>{
 const h=setup();rejected(h,payload({start_at:'2026-11-24T09:00:00+07:00'}));rejected(h,payload({end_at:'2026-11-24T11:00:00+07:00'}));
 const old={...payload(),booking_date:undefined,booking_session:undefined,start_at:'2026-11-24T09:00:00+07:00',end_at:'2026-11-24T11:00:00+07:00'};rejected(h,old);
 rejected(h,{...old,start_at:'2026-11-24T08:00:30+07:00',end_at:'2026-11-24T12:00:30+07:00'});
 success(h.post({...old,start_at:'2026-11-24T08:00:00+07:00',end_at:'2026-11-24T12:00:00+07:00'}));
});
test('Quantity is shared within a session and independent between sessions',()=>{
 const h=setup();success(h.post(payload({quantity:4})));rejected(h,payload({quantity:3,user_id:'sv02',request_id:'session-002'}));
 success(h.post(payload({quantity:2,user_id:'sv02',request_id:'session-004'})));rejected(h,payload({user_id:'sv02',request_id:'session-005'}));
 success(h.post(payload({quantity:6,booking_session:'afternoon',request_id:'session-003'})));
});
test('Staff blocks use sessions and enforce server permissions and capacity',()=>{
 const h=setup();const block=payload({action:'booking_block',quantity:6});rejected(h,block);
 const b=success(h.adminPost(block));assert.equal(h.get().bookings[0].session,'morning');rejected(h,payload({request_id:'session-002'}));
 success(h.adminPost({action:'booking_update',booking_id:b.booking_id,transition:'cancel'}));success(h.post(payload({request_id:'session-003'})));
});
test('Owners can start and finish an immediately registered session without staff approval',()=>{
 const h=setup();const b=success(h.post(payload({quantity:6})));
 rejected(h,{action:'booking_update',booking_id:b.booking_id,transition:'start',user_id:'sv01'});
 h.stamp.value=new Date('2026-11-24T01:00:00Z').getTime();
 success(h.post({action:'booking_update',booking_id:b.booking_id,transition:'start',user_id:'sv01'}));assert.equal(h.get().bookings[0].status,'active');
 success(h.post({action:'booking_update',booking_id:b.booking_id,transition:'finish',condition:'good',user_id:'sv01'}));assert.equal(h.get().bookings[0].status,'completed');
 success(h.post(payload({quantity:6,booking_session:'afternoon',user_id:'sv02',request_id:'session-002'})));
});
test('Legacy pending records can be confirmed by their owner only when capacity remains',()=>{
 const h=setup();const old=success(h.post(payload({quantity:4})));h.rows.Bookings[1][9]='pending';
 assert.match(success(h.post(payload({quantity:4}))).message,/chưa giữ chỗ/);
 const newer=success(h.post(payload({quantity:3,user_id:'sv02',request_id:'session-002'})));
 const confirm={action:'booking_update',booking_id:old.booking_id,transition:'confirm',user_id:'sv01',request_id:'confirm-001'};
 rejected(h,{...confirm,user_id:'sv02'});rejected(h,confirm);
 success(h.post({action:'booking_update',booking_id:newer.booking_id,transition:'cancel',user_id:'sv02'}));
 success(h.post(confirm));success(h.post(confirm));assert.equal(h.get().bookings[0].status,'approved');assert.equal(h.get().bookings[0].reviewed_by,'');
 rejected(h,payload({quantity:3,user_id:'sv02',request_id:'session-003'}));
});
test('Legacy confirmation checks current hours, maintenance and the session start',()=>{
 const h=setup();const old=success(h.post(payload()));h.rows.Bookings[1][9]='pending';
 const confirm={action:'booking_update',booking_id:old.booking_id,transition:'confirm',user_id:'sv01'};
 const row=h.rows.Devices.find(r=>r[0]==='ROBOT');row[18]='09:00';rejected(h,confirm);row[18]='08:00';
 row[17]='maintenance';rejected(h,confirm);row[17]='ready';h.stamp.value=new Date('2026-11-24T01:00:00Z').getTime();rejected(h,confirm);
});
test('Configured times apply to new bookings and existing records keep original times',()=>{
 const h=setup();success(h.post(payload()));
 success(h.adminPost({action:'admin_save_device',device_id:'ROBOT',morning_start:'08:30',morning_end:'11:30',afternoon_start:'13:30',afternoon_end:'17:30'}));
 success(h.post(payload({request_id:'session-002'})));const [old,current]=h.get().bookings;
 assert.equal(old.start_at,'2026-11-24T01:00:00.000Z');assert.equal(current.start_at,'2026-11-24T01:30:00.000Z');assert.equal(current.end_at,'2026-11-24T04:30:00.000Z');
 assert.equal(h.formats['Devices:3:23:1:4'],'@');
});
test('Invalid staff session configurations fail before writing',()=>{
 const h=setup();for(const extra of [{morning_start:'12:00'},{morning_end:'14:00'},{afternoon_end:'19:00'},{morning_start:'07:00'},{afternoon_start:'12:30'},{morning_start:'oops'},{max_minutes:120}])rejected(h,{action:'admin_save_device',device_id:'ROBOT',...extra},true);
});
test('Session time cells normalize Date, numeric and text representations',()=>{
 const h=setup();const row=h.rows.Devices.find(r=>r[0]==='ROBOT');
 row[22]=new Date('2026-11-23T01:00:00Z');row[23]=12/24;row[24]='1:00 PM';row[25]='17:00:00';
 const d=h.get().devices.find(d=>d.device_id==='ROBOT');assert.equal(d.morning_start,'08:00');assert.equal(d.morning_end,'12:00');assert.equal(d.afternoon_start,'13:00');assert.equal(d.afternoon_end,'17:00');success(h.post(payload()));
});
test('Retry remains idempotent after clock and session configuration change',()=>{
 const h=setup();const first=success(h.post(payload()));
 success(h.adminPost({action:'admin_save_device',device_id:'ROBOT',morning_start:'08:30'}));h.stamp.value=new Date('2026-11-24T06:00:00Z').getTime();
 const retry=success(h.post(payload()));assert.equal(retry.booking_id,first.booking_id);assert.equal(h.rows.Bookings.length,2);
 rejected(h,payload({booking_session:'afternoon'}));rejected(h,payload({booking_date:'2026-11-25'}));
});
test('A lost response from an older timestamp client still resolves after configuration changes',()=>{
 const h=setup({morning_start:'09:00',morning_end:'10:00'});
 const old={...payload(),booking_date:undefined,booking_session:undefined,start_at:'2026-11-24T09:00:00+07:00',end_at:'2026-11-24T10:00:00+07:00'};
 const first=success(h.post(old));success(h.adminPost({action:'admin_save_device',device_id:'ROBOT',morning_start:'08:00',morning_end:'12:00'}));
 h.stamp.value=new Date('2026-11-24T06:00:00Z').getTime();assert.equal(success(h.post(old)).booking_id,first.booking_id);assert.equal(h.rows.Bookings.length,2);
});
test('Upgrading an existing v2 sheet appends fields without rewriting historical bookings',()=>{
 const h=setup();success(h.post(payload()));h.rows.Bookings[1][5]='2026-11-24T02:00:00.000Z';h.rows.Bookings[1][6]='2026-11-24T03:00:00.000Z';
 h.rows.Bookings=h.rows.Bookings.map(row=>row.slice(0,22));h.rows.Devices=h.rows.Devices.map(row=>row.slice(0,22));
 const legacy=h.rows.Bookings[1].slice();assert.equal(h.get().schema_version,1);
 success(h.adminPost({action:'admin_upgrade_schema'}));assert.deepEqual(h.rows.Bookings[1],legacy);assert.equal(h.get().schema_version,2);assert.equal(h.get().bookings[0].start_at,legacy[5]);assert.equal(h.rows.Devices[0][22],'morning_start');assert.equal(h.rows.Bookings[0][22],'session');
 success(h.adminPost({action:'admin_upgrade_schema'}));assert.deepEqual(h.rows.Bookings[1],legacy);
});
test('Migration refuses an occupied new column without writes',()=>{
 const h=setup();h.rows.Devices[0][22]='custom';rejected(h,{action:'admin_upgrade_schema'},true);
 const other=setup();other.rows.Bookings[0][22]='custom';rejected(other,{action:'admin_upgrade_schema'},true);
});
console.log(`PASS: ${count} fixed-session backend scenarios (offline Apps Script mocks)`);
