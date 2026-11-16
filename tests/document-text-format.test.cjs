const {test}=require('node:test');
const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');const vm=require('vm');
const c=vm.createContext({});vm.runInContext(fs.readFileSync(path.join(__dirname,'../app/js/document-text-format.js'),'utf8').replace(/^export /gm,''),c);
test('renders nested Ezus tokens, breaks and safe literal HTML',()=>{
 assert.equal(c.formatDocumentText('Before [[b]]bold [[i]]italic[[/i]][[/b]][[br]][[red]]red[[/red]]'),'Before <strong>bold <em>italic</em></strong><br><span style="color:#d70018">red</span>');
 assert.equal(c.formatDocumentText('[[b]]<img src=x onerror=alert(1)>[[/b]]'),'<strong>&lt;img src=x onerror=alert(1)&gt;</strong>');
});
test('malformed markup is preserved visibly and never produces unbalanced HTML',()=>{
 for(const input of ['[[b]]unclosed','[[/b]]','[[b]][[i]]crossed[[/b]][[/i]]','[[','[[unknown]]value[[/unknown]]','[[constructor]]x[[/constructor]]','[[__proto__]]x[[/__proto__]]'])assert.equal(c.formatDocumentText(input),input);
 assert.equal(c.formatDocumentText('One\nTwo'),'One\nTwo');
});

test('custom colors use strict hexadecimal values and cannot inject CSS or HTML',()=>{
 assert.equal(c.formatDocumentText('[[color:#12ABef]]Blue[[/color]]'),'<span style="color:#12abef">Blue</span>');
 for(const value of ['[[color:red]]bad[[/color]]','[[color:#123456;display:none]]bad[[/color]]'])assert.equal(c.formatDocumentText(value),value);
});
