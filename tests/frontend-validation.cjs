const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const script=html.slice(html.indexOf('const { createApp }'),html.lastIndexOf('</script>'));
const scenarios=[];
function test(name,fn){scenarios.push({name,fn});}
function setup(){
 let config,calls=0;const clock={value:new Date('2026-11-21T05:00:00Z').getTime()};
 class ClockDate extends Date{constructor(...args){super(...(args.length?args:[clock.value]));}static now(){return clock.value;}}
 const context=vm.createContext({Date:ClockDate,Vue:{createApp:o=>{config=o;return{mount(){}};}},URL,localStorage:{getItem:()=>null},setTimeout(){},fetch:async()=>{calls++;throw Error('Unexpected request');}});
 vm.runInContext(script,context);const app=config.data();
 Object.entries(config.methods).forEach(([name,fn])=>app[name]=fn.bind(app));
 Object.entries(config.computed).forEach(([name,fn])=>Object.defineProperty(app,name,{get:fn.bind(app)}));
 const device={device_id:'ROBOT',name:'reBot Arm B601',usage_mode:'lab',tracking_mode:'individual',total_quantity:1,unavailable_quantity:0,service_status:'ready',open_hour:'08:00',close_hour:'18:00',max_minutes:240,buffer_minutes:0,stock:{available:1,total:1}};
 app.schemaVersion=2;app.currentStudent={user_id:'sv01',full_name:'An'};app.devices=[device];app.openResourceDialog('booking',device);
 Object.assign(app.resourceForm,{quantity:1,purpose:'Thử robot',booking_date:'2026-11-21',booking_session:'afternoon',note:''});
 return{app,device,clock,calls:()=>calls};
}
test('At noon morning is closed and afternoon is a valid fixed session',()=>{
 const{app}=setup();assert.equal(app.resourceSessions.length,2);
 assert.equal(app.resourceSessions[0].reason,'Buổi đã bắt đầu');
 const slot=app.resourceSessions[1];assert.equal(slot.startHour,'13:00');assert.equal(slot.endHour,'17:00');assert.equal(slot.available,1);assert.equal(slot.reason,'');
 assert.equal(app.resourceDialogValid,true);assert.equal(app.resourceRangeAvailability,1);
});
test('Opening defaults to today and requires an explicit session choice',()=>{
 const{app,device}=setup();app.openResourceDialog('booking',device);
 assert.equal(app.resourceForm.booking_date,'2026-11-21');assert.equal(app.resourceForm.booking_session,'');assert.equal(app.resourceFieldInvalid('booking_session'),true);assert.equal(app.resourceDialogValid,false);
 assert.equal('start_at' in app.resourceForm,false);assert.equal('end_at' in app.resourceForm,false);
});
test('Past sessions and unknown identifiers cannot be submitted',()=>{
 const{app}=setup();app.resourceForm.booking_session='morning';assert.equal(app.resourceFieldInvalid('booking_session'),true);
 app.resourceForm.booking_session='evening';assert.equal(app.resourceSelectedSession,null);assert.equal(app.resourceDialogValid,false);
 app.resourceForm.booking_session='afternoon';app.resourceForm.booking_date='2026-11-20';assert.equal(app.resourceDialogValid,false);
});
test('Missing, nonexistent and out-of-range dates are rejected',()=>{
 const{app}=setup();for(const date of ['', '2027-02-30','2026-1-21']){app.resourceForm.booking_date=date;assert.equal(app.resourceFieldInvalid('booking_date'),true);assert.equal(app.resourceDialogValid,false);}
 app.resourceForm.booking_date='2027-11-23';assert.match(app.resourceDialogIssues[0].message,/1 năm/);
});
test('A future day offers both sessions and honors configured times',()=>{
 const{app,device}=setup();app.resourceForm.booking_date='2026-11-22';assert.ok(app.resourceSessions.every(s=>!s.reason));
 Object.assign(device,{morning_start:'08:30',morning_end:'11:30',afternoon_start:'13:30',afternoon_end:'17:30'});
 assert.equal(app.resourceSelectedSession.startHour,'13:30');assert.equal(app.resourceSelectedSession.endHour,'17:30');assert.equal(app.resourceDialogValid,true);
});
test('Sessions outside opening hours or duration limit explain configuration issues',()=>{
 const{app,device}=setup();device.close_hour='16:00';assert.match(app.resourceSelectedSession.reason,/cán bộ sửa/);assert.equal(app.resourceDialogValid,false);
 device.close_hour='18:00';device.max_minutes=120;assert.equal(app.resourceDialogValid,false);
});
test('Each session reports its own quantity and ignores pending bookings',()=>{
 const{app,device}=setup();device.total_quantity=4;app.resourceForm.booking_date='2026-11-22';
 app.bookings=[{device_id:'ROBOT',status:'approved',quantity:3,start_at:'2026-11-22T08:00:00+07:00',end_at:'2026-11-22T12:00:00+07:00'},
 {device_id:'ROBOT',status:'pending',quantity:4,start_at:'2026-11-22T13:00:00+07:00',end_at:'2026-11-22T17:00:00+07:00'}];
 assert.equal(app.resourceSessions[0].available,1);assert.equal(app.resourceSessions[1].available,4);
 app.resourceForm.booking_session='morning';app.resourceForm.quantity=2;assert.equal(app.resourceFieldInvalid('quantity'),true);assert.equal(app.resourceDialogValid,false);
});
test('Cleanup buffer, fault holds and overdue sessions still reduce capacity',()=>{
 const{app,device}=setup();device.buffer_minutes=90;app.resourceForm.booking_date='2026-11-22';
 app.bookings=[{device_id:'ROBOT',status:'approved',quantity:1,start_at:'2026-11-22T08:00:00+07:00',end_at:'2026-11-22T12:00:00+07:00'}];assert.equal(app.resourceRangeAvailability,0);
 app.bookings=[{device_id:'ROBOT',status:'fault_hold',quantity:1}];assert.equal(app.resourceRangeAvailability,0);
 app.bookings=[{device_id:'ROBOT',status:'active',quantity:1,start_at:'2026-11-20T08:00:00+07:00',end_at:'2026-11-20T12:00:00+07:00'}];assert.equal(app.resourceRangeAvailability,0);
});
test('Missing purpose, invalid quantity and missing identity are explained',()=>{
 const{app}=setup();app.resourceForm.purpose='';assert.equal(app.resourceFieldInvalid('purpose'),true);
 app.resourceForm.quantity=0;assert.equal(app.resourceFieldInvalid('quantity'),true);
 app.currentStudent=null;assert.match(app.resourceDialogIssues.find(i=>i.field==='form').message,/Đăng nhập tài khoản sinh viên/);assert.equal(app.resourceDialogValid,false);
});
test('Maintenance disables both session choices',()=>{
 const{app,device}=setup();device.service_status='maintenance';app.resourceForm.booking_date='2026-11-22';assert.ok(app.resourceSessions.every(s=>/bảo trì/.test(s.reason)));assert.equal(app.resourceDialogValid,false);
});
test('Registered bookings need no approval and legacy owners can confirm their own record',()=>{
 const{app}=setup();const booking={user_id:'sv01',kind:'use',status:'approved',start_at:'2026-11-22T08:00:00+07:00',end_at:'2026-11-22T12:00:00+07:00'};
 assert.equal(app.bookingStatusLabel(booking),'Đã đăng ký');assert.equal(app.bookingActions(booking).some(a=>['approve','confirm'].includes(a.id)),false);
 booking.status='pending';assert.match(app.bookingStatusLabel(booking),/Lịch cũ/);assert.ok(app.bookingActions(booking).some(a=>a.id==='confirm'));assert.equal(app.bookingActions(booking).some(a=>a.id==='approve'),false);
 app.currentStudent={user_id:'sv02'};assert.equal(app.bookingActions(booking).some(a=>a.id==='confirm'),false);
});
test('Partial return and finish still require notes for faults',()=>{
 const{app,device}=setup();app.openResourceDialog('return',device,{loan_id:'LN1',outstanding:2});app.resourceForm.condition='faulty';assert.equal(app.resourceFieldInvalid('note'),true);app.resourceForm.note='Lỗi trục';assert.equal(app.resourceDialogValid,true);
 app.openResourceDialog('finish',device,{user_id:'sv01',quantity:1});app.resourceForm.condition='faulty';assert.equal(app.resourceFieldInvalid('note'),true);
});
test('Lost-response retry remains enabled after a session starts',()=>{
 const{app,clock}=setup();app.resourceRetryPending=true;clock.value=new Date('2026-11-21T06:01:00Z').getTime();app.resourceClock=clock.value;assert.equal(app.resourceDialogValid,true);
});
test('Submitting rechecks the clock at the session boundary',async()=>{
 const{app,clock,calls}=setup();assert.equal(app.resourceDialogValid,true);clock.value=new Date('2026-11-21T06:00:00Z').getTime();
 await app.submitResourceDialog();assert.equal(calls(),0);assert.equal(app.resourceFieldInvalid('booking_session'),true);assert.equal(app.resourceDialogValid,false);
});
test('Template contains date and radio choices without manual time inputs',()=>{
 const form=html.slice(html.indexOf('<form v-if="resourceDialog"'),html.indexOf('<!-- MODAL: ADD/EDIT DEVICE -->'));
 assert.match(form,/type="date"/);assert.match(form,/type="radio"/);assert.doesNotMatch(form,/datetime-local|type="time"/);
});
(async()=>{for(const{name,fn}of scenarios){try{await fn();}catch(error){error.message=name+': '+error.message;throw error;}}console.log(`PASS: ${scenarios.length} session-selection and confirmation scenarios`);})().catch(error=>{console.error(error);process.exitCode=1;});
