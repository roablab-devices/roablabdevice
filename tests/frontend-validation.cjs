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
 Object.assign(app.resourceForm,{quantity:1,purpose:'Thử robot',start_at:'2026-11-21T12:03',end_at:'2026-11-21T16:03',note:''});
 return{app,device,clock,calls:()=>calls};
}
test('Screenshot shows both six-hour duration and closing-time violations',()=>{
 const{app}=setup();app.resourceForm.end_at='2026-11-21T18:03';
 assert.equal(app.resourceRangeAvailability,1);assert.equal(app.resourceDialogValid,false);
 assert.equal(app.resourceDialogIssues.length,2);assert.match(app.resourceDialogIssues.find(i=>i.field==='duration').message,/360.*240/);
 assert.match(app.resourceDialogIssues.find(i=>i.field==='end_at').message,/18:03.*18:00/);
 assert.equal(app.resourceSuggestedEnd,'2026-11-21T16:03');app.applyResourceSuggestedEnd();assert.equal(app.resourceDialogValid,true);assert.equal(app.resourceDialogIssues.length,0);
});
test('A duration under four hours still cannot end after closing',()=>{
 const{app}=setup();Object.assign(app.resourceForm,{start_at:'2026-11-21T15:30',end_at:'2026-11-21T18:03'});
 assert.equal(app.resourceFieldInvalid('end_at'),true);assert.equal(app.resourceFieldInvalid('duration'),false);
 assert.equal(app.resourceSuggestedEnd,'2026-11-21T18:00');app.applyResourceSuggestedEnd();assert.equal(app.resourceDialogValid,true);
});
test('An overlong booking inside opening hours reports the time limit',()=>{
 const{app}=setup();Object.assign(app.resourceForm,{start_at:'2026-11-22T09:00',end_at:'2026-11-22T15:00'});
 assert.equal(app.resourceFieldInvalid('duration'),true);assert.equal(app.resourceFieldInvalid('end_at'),false);assert.equal(app.resourceDialogValid,false);
});
test('Past starts, reversed times and crossing days each explain the block',()=>{
 const{app}=setup();app.resourceForm.start_at='2026-11-21T11:59';assert.match(app.resourceDialogIssues.find(i=>i.field==='start_at').message,/tương lai/);assert.equal(app.resourceSuggestedEnd,'');
 app.resourceForm.start_at='2026-11-21T16:04';assert.match(app.resourceDialogIssues.find(i=>i.field==='end_at').message,/sau giờ bắt đầu/);
 app.resourceForm.end_at='2026-11-22T09:00';assert.equal(app.resourceFieldInvalid('date_range'),true);
});
test('Missing and nonexistent dates cannot produce a valid booking',()=>{
 const{app}=setup();app.resourceForm.start_at='';assert.equal(app.resourceFieldInvalid('start_at'),true);assert.equal(app.resourceDialogValid,false);
 app.resourceForm.start_at='2027-02-30T09:00';assert.equal(Number.isNaN(app.parseResourceLocalTime(app.resourceForm.start_at)),true);assert.equal(app.resourceFieldInvalid('start_at'),true);
 Object.assign(app.resourceForm,{start_at:'2027-11-23T09:00',end_at:'2027-11-23T10:00'});assert.match(app.resourceDialogIssues.find(i=>i.field==='start_at').message,/1 năm/);
});
test('Missing purpose, invalid quantity and missing identity are explained',()=>{
 const{app}=setup();app.resourceForm.purpose='';assert.equal(app.resourceFieldInvalid('purpose'),true);
 app.resourceForm.quantity=0;assert.equal(app.resourceFieldInvalid('quantity'),true);
 app.currentStudent=null;assert.match(app.resourceDialogIssues.find(i=>i.field==='form').message,/MSSV/);assert.equal(app.resourceDialogValid,false);
});
test('Conflicting quantity explains why a time slot cannot be submitted',()=>{
 const{app}=setup();app.bookings=[{booking_id:'EXISTING',device_id:'ROBOT',status:'approved',quantity:1,start_at:'2026-11-21T06:00:00Z',end_at:'2026-11-21T07:00:00Z'}];
 assert.equal(app.resourceRangeAvailability,0);assert.equal(app.resourceDialogValid,false);assert.match(app.resourceDialogIssues.find(i=>i.field==='quantity').message,/chọn giờ khác/);
});
test('Partial return and finish still require a note for reported faults',()=>{
 const{app,device}=setup();app.openResourceDialog('return',device,{loan_id:'LN1',outstanding:2});app.resourceForm.condition='faulty';assert.equal(app.resourceFieldInvalid('note'),true);app.resourceForm.note='Lỗi trục';assert.equal(app.resourceDialogValid,true);
 app.openResourceDialog('finish',device,{user_id:'sv01',quantity:1});app.resourceForm.condition='faulty';assert.equal(app.resourceFieldInvalid('note'),true);
});
test('Lost-response retry stays enabled even when availability has changed',()=>{
 const{app,device}=setup();app.openResourceDialog('borrow',device);app.resourceRetryPending=true;device.stock.available=0;
 assert.equal(app.resourceDialogValid,true);assert.equal(app.resourceDialogIssues.length,0);assert.equal(app.resourceSuggestedEnd,'');
});
test('Submitting rechecks the clock and does not send an expired start',async()=>{
 const{app,clock,calls}=setup();assert.equal(app.resourceDialogValid,true);clock.value=new Date('2026-11-21T05:04:00Z').getTime();
 await app.submitResourceDialog();assert.equal(calls(),0);assert.equal(app.resourceFieldInvalid('start_at'),true);assert.equal(app.resourceDialogValid,false);
});
(async()=>{for(const{name,fn}of scenarios){try{await fn();}catch(error){error.message=name+': '+error.message;throw error;}}console.log(`PASS: ${scenarios.length} confirmation-validation scenarios`);})().catch(error=>{console.error(error);process.exitCode=1;});
