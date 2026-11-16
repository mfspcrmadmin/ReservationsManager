const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),vm=require('vm');
const c=vm.createContext({});vm.runInContext(fs.readFileSync(path.join(__dirname,'../app/js/document-output-dates.js'),'utf8').replace(/^export /gm,''),c);
test('document formatting preserves local dates and times across offsets and browser zones',()=>{
 for(const raw of ['2026-07-14T00:05:09+14:00','2026-07-14T00:05:09-12:00','2026-07-14T00:05:09Z'])assert.equal(c.formatDocumentTemporal(raw,'datetime'),'14 Jul 26 12:05 AM');
 assert.equal(c.formatDocumentTemporal('2026-07-14T10:00:00+02:00','datetime',{date:'dd/MM/yyyy',time:'h:mm a',timezone:'shown'}),'14/07/2026 10:00 AM (UTC+02:00)');
 assert.equal(c.formatDocumentTemporal('2026-07-14T16:30:45+05:45','datetime',{datetime:'time',time:'HH:mm:ss',timezone:'shown'}),'4:30:45 PM (UTC+05:45)');
 assert.equal(c.formatDocumentTemporal('2026-07-14T16:30:45+05:45','datetime',{datetime:'date',date:'dd MMMM yyyy',timezone:'shown'}),'14 July 2026');
});
test('all date formats, noon/midnight and pure times are explicit',()=>{
 const outputs=['14 Jul 26','14 Jul 2026','14 July 2026','14/07/2026','07/14/2026','2026-07-14'];
 for(const [index,date] of vm.runInContext('outputDateFormats',c).entries())assert.equal(c.formatDocumentTemporal('2026-07-14','date',{date}),outputs[index]);
 for(const [input,output] of [['9:05','9:05 AM'],['00:00','12:00 AM'],['12:00','12:00 PM'],['23:59:45','11:59 PM']])assert.equal(c.formatDocumentTemporal(input,'auto',{time:'h:mm a'}),output);
 assert.equal(c.formatDocumentTravelDates('2026-07-14 - 2026-07-20',{date:'dd/MM/yyyy'}),'14/07/2026 - 20/07/2026');
});
test('empty values, invalid dates and prose are preserved; timezone wording is removed from labels',()=>{
 for(const raw of ['','2026-02-29','2026-13-01','2026-01-32','2026-07-14T25:00:00Z','Meet on 2026-07-14','14 July 2026'])assert.equal(c.formatDocumentTemporal(raw),raw);
 assert.equal(c.formatDocumentTemporal('2024-02-29'),'29 Feb 24');
 assert.equal(c.documentDateLabel('End (with timezone)'),'End');assert.equal(c.documentDateLabel('Start with timezone'),'Start');
});

test('field formats are scoped by record and field, inherit defaults, and do not mutate settings',()=>{
 const settings={rules:{date_display:{date:'dd/MM/yyyy',time:'HH:mm',datetime:'date_time',timezone:'hidden'},field_dates:{'crm-step:1|End_Date_Time':{time:'h:mm a'},'crm-step:2|End_Date_Time':{time:'HH:mm:ss'}}}};
 const original=JSON.stringify(settings),value='2026-07-14T10:30:45+02:00';
 assert.equal(c.formatDocumentTemporal(value,'datetime',c.documentDateOptions(settings,'crm-step:1|End_Date_Time')),'14/07/2026 10:30 AM');
 assert.equal(c.formatDocumentTemporal(value,'datetime',c.documentDateOptions(settings,'crm-step:1|Start_Date_Time')),'14/07/2026 10:30 AM');
 assert.equal(c.formatDocumentTemporal(value,'datetime',c.documentDateOptions(settings,'crm-step:2|End_Date_Time')),'14/07/2026 10:30:45 AM');
 assert.equal(JSON.stringify(settings),original);
});
