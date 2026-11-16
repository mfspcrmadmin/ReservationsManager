const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../app/js/render.js'), 'utf8').replace(/\r\n/g, '\n');
const extract = name => { const start = source.indexOf('function ' + name + '('); return source.slice(start, source.indexOf('\n}', start) + 2); };
function setup() {
  const c = vm.createContext({ escapeHtml: value => String(value).replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
    getMailRecordId: record => record.id, getMailSubject: record => record.subject || '', formatMailValue: String,
    getMailField: () => '', getMailRecordTimeValue: () => '', renderMailRow: () => '', formatDateTime: String, renderServiceSupplierName: () => '' });
  vm.runInContext(extract('renderCommunicationServices') + '\n' + extract('renderMailList'), c);
  return c;
}
test('damaged historical links show their warning instead of preventing the service panel from rendering', () => {
  const c = setup(), element = { dataset: {} };
  c.renderCommunicationServices(element, { id: 'old', services: [], service_links_valid: false, service_link_errors: ['Relationship 123 has no Booking Service. <untrusted>'] }, { services: [] });
  assert.match(element.innerHTML, /role="alert".*Service links need review/);
  assert.match(element.innerHTML, /&lt;untrusted&gt;/);
  assert.ok(element.innerHTML.indexOf('<summary') < element.innerHTML.indexOf('role="alert"'));
});
test('valid drafts remain selectable next to an invalid communication', () => {
  const c = setup();
  const html = c.renderMailList([{ id: 'valid', communication_status: 'Draft' }, { id: 'broken', communication_status: 'Draft', service_links_valid: false, send_blocked: true }], 'drafts', 'valid', 'Empty');
  assert.match(html, /data-draft-select="valid"/);
  assert.doesNotMatch(html, /data-draft-select="broken"/);
  assert.match(html, /data-mail-record-id="broken"/);
});
