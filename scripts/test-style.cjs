const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const css=fs.readFileSync(path.resolve(__dirname,'../assets/css/main.css'),'utf8');
function value(selector,property){const escaped=selector.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');const rule=css.match(new RegExp(escaped+'\\s*\\{([^}]+)'));assert.ok(rule,selector);const match=rule[1].match(new RegExp('(?:^|;)\\s*'+property+':([^;]+)'));assert.ok(match,property);return match[1].trim().replace(/var\(--([\w-]+)\)/g,(_,v)=>css.match(new RegExp('--'+v+':(#[a-f0-9]+)'))[1]);}
function lum(hex){if(hex.length===4)hex='#'+[...hex.slice(1)].map(x=>x+x).join('');return [1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4).reduce((s,c,i)=>s+c*[.2126,.7152,.0722][i],0);}
function contrast(a,b){const [x,y]=[lum(a),lum(b)].sort((a,b)=>a-b);return (y+.05)/(x+.05);}
for(const selector of ['.post-body a','.ebay-card .ebay-price','.post-card .read-more','.signup .form-error'])test(selector+' has AA normal-text contrast on white',()=>assert.ok(contrast(value(selector,'color'),'#ffffff')>=4.5));
test('button text meets AA across both gradient endpoints',()=>{const colours=value('.btn','background').match(/#[a-f0-9]{6}/g);for(const c of colours)assert.ok(contrast(value('.btn','color'),c)>=4.5);});
test('buttons wrap rather than exceed narrow cards',()=>assert.equal(value('.btn','white-space'),'normal'));
