const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const c = vm.createContext({});
for (const file of ['utils.js', 'booking-financial.js']) vm.runInContext(fs.readFileSync('app/js/' + file, 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, ''), c);
const shell = fs.readFileSync('app/js/booking-shell.js', 'utf8');
vm.runInContext(shell.slice(shell.indexOf('function getBookingRawValue(')), c);
const today = new Date('2026-09-29T12:00:00Z');
test('overdue requires a positive balance and a valid earlier Madrid calendar day', () => {
 for (const [balance, date, expected] of [[1,'2026-09-28',true],[0,'2026-09-28',false],[-1,'2026-09-28',false],[null,'2026-09-28',false],[1,'2026-09-29',false],[1,'2026-09-30',false],[1,'',false],[1,'2026-02-30',false]]) {
  assert.equal(c.isFinancialOverdue({Balance_Amount:balance,Balance_due_date:date},today),expected);
 }
 assert.equal(c.isFinancialOverdue({Balance_Amount:1,Balance_due_date:'2026-09-29'},new Date('2026-09-29T22:30:00Z')),true);
});
test('snapshot preserves zeros, missing data, record currency and negative margins', () => {
 const booking = { Currency:'USD', Balance_Amount:0, Balance_due_date:'2026-09-28', Sales_Price_inc_Taxes:10429.03, Purchase_Price_inc_Taxes:7177.35, Total_Requested_Amount:' ', Paid_Amount:0 };
 const before = JSON.stringify(booking);
 const html = c.renderBookingFinancial(booking, c.getGrossMarginValue(booking), -200, today);
 assert.match(html,/10\.429,03/); assert.match(html,/7\.177,35/); assert.match(html,/US\$/);
 assert.match(html,/0,00/); assert.match(html,/—/); assert.match(html,/-200,00/); assert.match(html,/Negative margin/);
 assert.doesNotMatch(html,/Overdue/); assert.match(html,/28 Sept 2026/);
 for (const label of ['Net Margin','Gross Margin','Balance Amount','Balance Due Date','Total Requested Amount','Total Paid Amount','Total Refund Amount']) assert.equal(html.split('>'+label+'<').length-1,1);
 assert.equal(JSON.stringify(booking),before);
 assert.equal(c.getGrossMarginValue({Sales_Price_inc_Taxes:100,Purchase_Price_inc_Taxes:70}),30);
 assert.equal(c.getGrossMarginValue({Gross_Margin:0,Sales_Price_inc_Taxes:100,Purchase_Price_inc_Taxes:70}),0);
 assert.equal(c.getGrossMarginValue({Sales_Price_inc_Taxes:100}), '');
 assert.equal(c.getGrossMarginValue({Sales_Price_inc_Taxes:100,Purchase_Price_inc_Taxes:' '}), '');
 assert.equal(c.getGrossMarginValue({Sales_Price_inc_Taxes:100,Purchase_Price_inc_Taxes:'invalid'}), '');
 assert.equal(c.getNetMarginValue({}), '');
});
