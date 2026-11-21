const assert = require('node:assert/strict');
const {harness} = require('./inventory-harness.cjs');
let count = 0;
function test(name, fn) { try { fn(); count++; } catch (error) { error.message = name + ': ' + error.message; throw error; } }
const success = r => { assert.equal(r.success, true, r.message); return r; };
function configHours(h, start, end) { h.rows.Devices[1][18] = start; h.rows.Devices[1][19] = end; }

test('Time cells returned as Date load correctly in spreadsheet timezone', () => {
  const h = harness({timezone:'Etc/GMT-7'});
  configHours(h, new Date('1899-12-30T01:00:00Z'), new Date('1899-12-30T11:00:00Z'));
  const before=h.writes(), result=success(h.get());
  assert.equal(result.devices[0].open_hour,'08:00'); assert.equal(result.devices[0].close_hour,'18:00');
  assert.equal(result.devices[0].configuration_error,''); assert.equal(h.writes(),before,'GET never repairs/writes data');
});
test('Date hours use spreadsheet timezone even when it differs from Vietnam', () => {
  const h=harness({timezone:'UTC'});configHours(h,new Date('1899-12-30T08:00:00Z'),new Date('1899-12-30T18:00:00Z'));
  const d=success(h.get()).devices[0];assert.equal(d.open_hour,'08:00');assert.equal(d.close_hour,'18:00');
});
test('Spreadsheet numeric time fractions preserve midnight and minutes', () => {
  const h=harness();configHours(h,0,18/24);let d=success(h.get()).devices[0];assert.equal(d.open_hour,'00:00');assert.equal(d.close_hour,'18:00');
  configHours(h,8.5/24,17.75/24);d=success(h.get()).devices[0];assert.equal(d.open_hour,'08:30');assert.equal(d.close_hour,'17:45');
});
test('Common time strings normalize while missing fields retain defaults', () => {
  const h=harness();for(const [start,end,open,close] of [['8:00','18:00:00','08:00','18:00'],[' 08:30 ','6:15 PM','08:30','18:15'],['12:00 AM','12:00 PM','00:00','12:00'],['',null,'08:00','18:00'],["'08:00","'18:00",'08:00','18:00']]) {
    configHours(h,start,end);const d=success(h.get()).devices[0];assert.equal(d.open_hour,open);assert.equal(d.close_hour,close);assert.equal(d.configuration_error,'');
  }
});
test('Invalid hours isolate one device and preserve other devices and whitelist', () => {
  const h=harness();h.addDevice('MOTOR');configHours(h,'18:00','08:00');const before=h.writes();
  const r=success(h.get());assert.equal(r.devices.length,2);assert.ok(r.whitelist.length);assert.equal(h.writes(),before);
  const invalid=r.devices.find(d=>d.device_id==='D1');assert.match(invalid.configuration_error,/Giờ mở cửa/);assert.equal(invalid.configuration_row,2);assert.equal(invalid.stock.available,0);
  assert.equal(r.devices.find(d=>d.device_id==='MOTOR').stock.available,20);
  const post=h.post({action:'transaction',tx_type:'Mượn mới',user_id:'sv01',device_ids:['D1']});assert.equal(post.success,false);assert.equal(h.writes(),before);
});
test('Malformed, out-of-range and equal hours remain invalid', () => {
  const h=harness();for(const [start,end] of [['24:00','18:00'],['08:60','18:00'],['08:00:60','18:00'],['13:00 PM','18:00'],['08:00','08:00'],[1,'18:00'],[false,'18:00'],[new Date('invalid'),'18:00']]) {
    configHours(h,start,end);const r=success(h.get());assert.ok(r.devices[0].configuration_error,String(start));
  }
});
test('Staff can repair malformed previous hours without changing inventory mode', () => {
  const h=harness();h.addDevice('ROBOT',{usage_mode:'lab',total_quantity:2});const row=h.rows.Devices.find(r=>r[0]==='ROBOT');row[18]='18:00';row[19]='08:00';
  assert.ok(success(h.get()).devices.find(d=>d.device_id==='ROBOT').configuration_error);
  success(h.adminPost({action:'admin_save_device',device_id:'ROBOT',name:'ROBOT',open_hour:'08:00',close_hour:'18:00'}));
  assert.equal(success(h.get()).devices.find(d=>d.device_id==='ROBOT').configuration_error,'');
  assert.equal(h.formats['Devices:3:19:1:2'],'@');
});
test('Invalid submitted hours are rejected before any write', () => {
  const h=harness();const before=h.writes();assert.equal(h.adminPost({action:'admin_save_device',device_id:'D1',open_hour:'18:00',close_hour:'08:00'}).success,false);assert.equal(h.writes(),before);
});
test('Schema upgrade normalizes Date cells and persists hours as plain text', () => {
  const h=harness({migrate:false,timezone:'Etc/GMT-7'});configHours(h,new Date('1899-12-30T01:00:00Z'),new Date('1899-12-30T11:00:00Z'));
  success(h.adminPost({action:'admin_upgrade_schema'}));assert.equal(h.rows.Devices[1][18],'08:00');assert.equal(h.rows.Devices[1][19],'18:00');assert.equal(h.formats['Devices:2:19:1:2'],'@');
  success(h.adminPost({action:'admin_upgrade_schema'}));
});
test('Invalid legacy data identifies the device when a migration is blocked', () => {
  const h=harness({migrate:false});configHours(h,'18:00','08:00');const before=h.writes();const result=h.adminPost({action:'admin_upgrade_schema'});assert.equal(result.success,false);assert.match(result.message,/\[D1\]/);assert.equal(h.writes(),before);
});
test('Scheduled use still checks actual opening hours after Date normalization', () => {
  const h=harness({timezone:'Etc/GMT-7'});h.addDevice('ROBOT',{usage_mode:'lab',tracking_mode:'individual',total_quantity:1});
  const row=h.rows.Devices.find(r=>r[0]==='ROBOT');row[18]=new Date('1899-12-30T01:00:00Z');row[19]=new Date('1899-12-30T11:00:00Z');
  const payload={action:'booking_create',device_id:'ROBOT',user_id:'sv01',quantity:1,purpose:'Test giờ',booking_date:'2026-11-24',booking_session:'morning',request_id:'hours-test-001'};
  success(h.post(payload));assert.equal(h.post({...payload,request_id:'hours-test-002',start_at:'2026-11-24T07:30:00+07:00'}).success,false);
});
console.log(`PASS: ${count} spreadsheet-hour regression scenarios`);
