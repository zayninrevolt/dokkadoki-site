const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),vm=require('vm');
const root=path.resolve(__dirname,'..');
function run(home=false,rangeValue='all') {
 const cards=[['Expired','2026-09-01','2026-09-01'],['Ongoing','2026-09-04','2026-09-20'],['Future','2026-09-18','2026-09-18'],['Later','2026-09-21','2026-09-21'],['Fourth','2026-09-22','2026-09-22']].map(([textContent,start,end])=>({textContent,hidden:false,getAttribute:k=>k==='data-event-start'?start+'T12:00:00+01:00':k==='data-event-end'?end+'T23:00:00+01:00':null}));
 const elements={'[data-events-list]':{querySelectorAll:()=>cards},'#event-search':{value:'',addEventListener(){}},'#event-range':{value:rangeValue,addEventListener(){}},'#event-results':{},'[data-events-empty]':{},'[data-events-no-match]':{},'[data-events-home]':home?{}:null};
 const RealDate=Date; class Clock extends RealDate {constructor(...args){super(...(args.length?args:['2026-09-10T12:00:00+01:00']));}static now(){return new Clock().getTime();}}
 const document={querySelector:q=>elements[q]||null,getElementById:id=>elements['#'+id]||null,querySelectorAll:()=>cards};
 const context={document,Date:Clock,Intl,console,module:{exports:{}},window:{}};
 const file=path.join(root,'static/js/events.js');
 if(fs.existsSync(file))vm.runInNewContext(fs.readFileSync(file,'utf8'),context);
 else {const base=fs.readFileSync(path.join(root,'layouts/_default/baseof.html'),'utf8');vm.runInNewContext(base.slice(base.indexOf('(function(){'),base.indexOf('/* ---- drifting')),context);if(!home){const list=fs.readFileSync(path.join(root,'layouts/events/list.html'),'utf8');vm.runInNewContext(list.match(/<script>([\s\S]*?)<\/script>/)[1],context);}}
 return cards.filter(c=>!c.hidden).map(c=>c.textContent);
}
test('all upcoming never revives expired cards',()=>assert.deepEqual(run(),['Ongoing','Future','Later','Fourth']));
test('date windows include ongoing events',()=>assert.deepEqual(run(false,'30'),['Ongoing','Future','Later','Fourth']));
test('homepage renders enough candidates to replenish expired cards',()=>assert.doesNotMatch(fs.readFileSync(path.join(root,'layouts/home.html'),'utf8'),/with first 4 \$upcoming/));
test('homepage caps three nonexpired cards',()=>assert.deepEqual(run(true),['Ongoing','Future','Later']));
