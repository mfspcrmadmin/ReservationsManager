const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const c=vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../app/js/studio-panel-resize.js'),'utf8').replace(/^export /gm,''),c);

test('panel sizing honors bounds and keeps a usable preview as the window narrows',()=>{
 for(const width of [951,1000,1150,1440,1920])for(const preferred of [{},{outline:380,properties:480},{outline:10,properties:900}]){
  const sizes=c.studioPanelWidths(width,preferred);
  assert.ok(sizes.outline>=200 && sizes.outline<=380);
  assert.ok(sizes.properties>=280 && sizes.properties<=480);
  assert.ok(width-sizes.outline-sizes.properties-12>=320);
 }
 const preferred={outline:380,properties:480};
 c.studioPanelWidths(951,preferred);
 assert.deepEqual(preferred,{outline:380,properties:480},'window resize does not discard preferred widths');
 assert.equal(c.studioPanelWidths(1440,preferred).outline,380);
});
