// Compile the exact Vue browser build used by index.html. No browser rendering claim.
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
(async()=>{
 const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
 const url=html.match(/<script src="([^"]+vue[^\"]+)"/)[1];
 const response=await fetch(url);if(!response.ok)throw Error('Cannot load Vue compiler: '+response.status);
 const ctx=vm.createContext({console});vm.runInContext(await response.text(),ctx);
 const start=html.indexOf('<div id="app"');if(start<0)throw Error('Missing app root');
 const template=html.slice(start,html.indexOf('<!-- VUE 3 APPLICATION LOGIC -->'));
 const errors=[];
 // Override the browser entity decoder because this compile-only check has no DOM.
 const render=ctx.Vue.compile(template,{onError:e=>errors.push(e.message),decodeEntities:text=>text.replace(/&(?:amp|lt|gt|quot|apos|#39);/g,e=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&#39;':"'"}[e]))});
 if(errors.length)throw Error(errors.join('\n'));
 // Render the real template to VNodes to verify role-dependent visibility without a browser.
 const assert=require('node:assert/strict');
 let config;
 const storage={getItem(){return null;},setItem(){},removeItem(){}};
 const appContext=vm.createContext({Vue:{createApp:o=>{config=o;return{mount(){}};}},localStorage:storage,sessionStorage:storage,URL,Date,setTimeout(){}});
 vm.runInContext(html.slice(html.indexOf('const { createApp }'),html.lastIndexOf('</script>')),appContext);
 const app=config.data();
 Object.entries(config.methods).forEach(([k,fn])=>app[k]=fn.bind(app));
 Object.entries(config.computed).forEach(([k,fn])=>Object.defineProperty(app,k,{get:fn.bind(app)}));
 app.devices=[{device_id:'TEST',name:'Thiết bị thử',category:'Test',status:'Trong kho',accessories:'Cáp',specs_note:'5V',location:'Tủ A'}];
 app.schemaVersion=1;
 function visibleText(node){
   if(node==null)return '';
   if(Array.isArray(node))return node.map(visibleText).join(' ');
   if(typeof node!=='object')return String(node);
   if(node.type===ctx.Vue.Comment || node.type==='dialog' && !node.props?.open || node.dirs?.some(d=>d.dir===ctx.Vue.vShow && !d.value))return '';
   return visibleText(node.children);
 }
 function view(){return visibleText(render.call(app,app,[])).replace(/\s+/g,' ');}
 let text=view();
 assert.match(text,/Thiết bị thử/);assert.match(text,/Tài liệu/);assert.match(text,/Lịch & phiếu mượn/);
 assert.match(text,/Đăng nhập cán bộ/);
 assert.doesNotMatch(text,/Kiểm định|Quản trị|Nâng cấp dữ liệu|Nhật ký|CẨM NANG/);
 app.adminUser={user_id:'admin',full_name:'Admin',role:'ADMIN'};
 text=view();assert.match(text,/Quản trị/);assert.match(text,/Kiểm định/);assert.match(text,/Nâng cấp dữ liệu/);assert.match(text,/Nhật ký/);
 app.currentViewMode='ADMIN';assert.match(view(),/TRUNG TÂM QUẢN TRỊ THIẾT BỊ/);
 app.adminUser={user_id:'qa',full_name:'QA',role:'INSPECTOR'};
 app.currentViewMode='SHOWROOM';
 text=view();assert.match(text,/Kiểm định/);assert.doesNotMatch(text,/Quản trị|Nâng cấp dữ liệu/);
 app.currentViewMode='INSPECTOR';assert.match(view(),/KIỂM ĐỊNH ĐỐI SOÁT HÌNH ẢNH/);
 app.currentViewMode='SHOWROOM';
 app.adminUser=null;app.enterAdminMode();assert.equal(app.currentViewMode,'SHOWROOM');assert.equal(app.showStaffLoginModal,true);
 app.showStaffLoginModal=false;app.enterInspectionMode();assert.equal(app.currentViewMode,'SHOWROOM');assert.equal(app.showStaffLoginModal,true);
 app.bookings=[{booking_id:'OTHER',user_id:'other',status:'active'}];assert.equal(app.attentionBookings.length,0);
 app.adminUser={user_id:'admin',full_name:'Admin',role:'ADMIN'};assert.equal(app.attentionBookings.length,1);
 console.log('PASS: guest, QA and Admin template visibility; guest navigation gates; attention list respects ownership');
 console.log('PASS: complete template compiles with Vue '+ctx.Vue.version+' (no visual/browser verification)');
})().catch(e=>{console.error(e);process.exitCode=1;});
