const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const {harness}=require('./inventory-harness.cjs');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const script=html.slice(html.indexOf('const { createApp }'),html.lastIndexOf('</script>'));
const h=harness(); h.addDevice('MOTOR');h.addDevice('ROBOT',{usage_mode:'lab',total_quantity:6});
let config, failAfterWrite=false;
const storage=new Map(),session=new Map();
const ctx=vm.createContext({Vue:{createApp:o=>{config=o;return{mount(){}};}},URL,Date:h.context.Date,
 localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
 sessionStorage:{getItem:k=>session.get(k)||null,setItem:(k,v)=>session.set(k,v),removeItem:k=>session.delete(k)},
 crypto:require('node:crypto').webcrypto,confirm:()=>true,setTimeout(){},
 fetch:async(url,options)=>{const result=options && options.method==='POST' ? h.post(JSON.parse(options.body)) : h.get();if(failAfterWrite){failAfterWrite=false;throw Error('Simulated response lost');}return{json:async()=>result};}
});
vm.runInContext(script,ctx);
const app=config.data();
Object.entries(config.methods).forEach(([key,fn])=>app[key]=fn.bind(app));
Object.entries(config.computed).forEach(([key,fn])=>Object.defineProperty(app,key,{get:fn.bind(app)}));
(async()=>{
 app.currentStudent={user_id:'sv01',full_name:'An',role:'STUDENT'};app.studentSession=h.students.sv01;await app.fetchData();assert.equal(app.schemaVersion,2);
 app.openResourceDialog('borrow',app.deviceById('MOTOR'));app.resourceForm.quantity=4;app.resourceForm.purpose='Đồ án';assert.equal(app.resourceDialogValid,true);
 await app.submitResourceDialog();assert.equal(app.loans[0].outstanding,4);assert.equal(app.deviceById('MOTOR').stock.available,16);assert.equal(app.myHoldingCount,4);
 const loan=app.loans[0];app.openResourceDialog('return',app.deviceById('MOTOR'),loan);app.resourceForm.quantity=2;
 await app.submitResourceDialog();assert.equal(app.loans[0].outstanding,2);assert.equal(app.quantityReturns[0].audit_status,'pending');
 app.adminUser={user_id:'qa',full_name:'QA',role:'INSPECTOR'};app.staffSession=h.qa;
 await app.auditQuantityReturn(app.quantityReturns[0],'approved');assert.equal(app.deviceById('MOTOR').stock.available,18);
 app.openResourceDialog('borrow',app.deviceById('MOTOR'));app.resourceForm.quantity=1;app.resourceForm.purpose='Test mất phản hồi';
 failAfterWrite=true;await app.submitResourceDialog();assert.equal(app.resourceRetryPending,true);const num=h.rows.Loans.length;
 await app.submitResourceDialog();assert.equal(h.rows.Loans.length,num);assert.equal(app.resourceDialog,null,'Retry recovers the committed loan');
 app.openDeviceAgenda(app.deviceById('ROBOT'));app.openBookingForSelected();
 Object.assign(app.resourceForm,{quantity:4,purpose:'Thực hành',booking_date:'2026-11-24',booking_session:'morning'});
 assert.equal(app.resourceRangeAvailability,6);assert.equal(app.resourceDialogValid,true);await app.submitResourceDialog();
 const booking=app.bookings[0];assert.equal(booking.status,'approved');app.selectedBookingId=booking.booking_id;
 assert.equal(app.bookingStatusLabel(app.selectedBooking),'Đã đăng ký');
 assert.equal(app.bookingActions(app.selectedBooking).some(a=>a.id==='approve' || a.id==='confirm'),false);
 app.openResourceDialog('booking',app.deviceById('ROBOT'));Object.assign(app.resourceForm,{quantity:3,purpose:'Test trùng',booking_date:'2026-11-24',booking_session:'morning'});
 assert.equal(app.resourceRangeAvailability,2);assert.equal(app.resourceDialogValid,false);app.closeResourceDialog();
 app.agendaAnchor='2026-11-23';assert.equal(app.agendaDays[0].date,'2026-11-23');assert.equal(app.agendaDays[6].date,'2026-11-29');assert.equal(app.agendaDays[1].items.length,1);
 h.stamp.value=new Date('2026-11-24T02:00:00Z').getTime();app.resourceClock=h.stamp.value;
 assert.ok(app.bookingActions(app.selectedBooking).some(a=>a.id==='start'));await app.performBookingAction(app.selectedBooking,'start');assert.equal(app.selectedBooking.status,'active');
 await app.performBookingAction(app.selectedBooking,'finish');assert.equal(app.resourceDialog.kind,'finish');app.resourceForm.condition='faulty';assert.equal(app.resourceDialogValid,false);app.resourceForm.note='Báo lỗi truyền động';assert.equal(app.resourceDialogValid,true);await app.submitResourceDialog();assert.equal(app.selectedBooking.status,'fault_hold');
 app.openAddDeviceModal();assert.equal(app.deviceForm.total_quantity,1);assert.equal(app.deviceForm.usage_mode,'portable');app.openEditDeviceModal(app.deviceById('ROBOT'));assert.equal(app.deviceForm.total_quantity,6);assert.equal(app.deviceForm.usage_mode,'lab');
 app.adminStudentSearch='An';assert.ok(app.adminStudentResults[0].borrowed_devices.some(d=>d.device_id==='MOTOR'));
 const bad=h.rows.Devices.find(r=>r[0]==='ROBOT');bad[18]='18:00';bad[19]='08:00';
 await app.fetchData();assert.equal(app.connectionError,'');assert.equal(app.invalidConfigurationDevices.length,1);assert.equal(app.devices.length,3);
 const invalid=app.deviceById('ROBOT');assert.equal(app.isDeviceAvailable(invalid),false);assert.equal(app.resourceDeviceLabel(invalid),'Cần sửa cấu hình');
 app.resourceDialog=null;app.openResourceDialog('booking',invalid);assert.equal(app.resourceDialog,null,'Invalid configuration blocks booking');
 app.openEditDeviceModal(invalid);Object.assign(app.deviceForm,{open_hour:'08:00',close_hour:'18:00',accessories:'Nguồn, Cáp'});
 await app.saveDeviceAsAdmin();assert.equal(app.invalidConfigurationDevices.length,0,'Staff can repair the invalid row through the UI');assert.equal(app.deviceById('ROBOT').open_hour,'08:00');
 app.logoutStaff();app.openResourceDialog('borrow',app.deviceById('MOTOR'));assert.equal(app.currentStudent,null);
 console.log('PASS: frontend/backend quantity, partial return, QA, retry, booking, filters, staff session and invalid-hours recovery');
})().catch(e=>{console.error(e);process.exitCode=1;});
