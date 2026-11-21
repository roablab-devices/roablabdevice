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
 ctx.Vue.compile(template,{onError:e=>errors.push(e.message),decodeEntities:text=>text.replace(/&(?:amp|lt|gt|quot|apos|#39);/g,e=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&#39;':"'"}[e]))});
 if(errors.length)throw Error(errors.join('\n'));
 console.log('PASS: complete template compiles with Vue '+ctx.Vue.version+' (no visual/browser verification)');
})().catch(e=>{console.error(e);process.exitCode=1;});
