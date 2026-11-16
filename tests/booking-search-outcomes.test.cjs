const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function extract(file, name) {
  const source = fs.readFileSync(require.resolve('../app/js/' + file), 'utf8').replace(/\r\n/g, '\n');
  const start = source.search(new RegExp('^(?:export )?(?:async )?function ' + name + '\\(', 'm'));
  return source.slice(start, source.indexOf('\n}', start) + 2).replace(/^export /, '');
}
function setup() {
  const context = vm.createContext({ MODULES: { bookings: 'Deals' }, escapeCriteriaValue: String, normalizeBookingCandidate: value => value,
    dedupeBookings: records => [...new Map(records.map(record => [record.id, record])).values()],
    crmSearchRecord: async () => [], crmSearchWord: async () => [] });
  vm.runInContext(extract('data.js', 'searchBookingByInput'), context);
  return context;
}
test('empty successful searches and blank input return no matches', async () => {
  const c = setup();
  assert.equal((await c.searchBookingByInput('reference')).length, 0);
  c.crmSearchRecord = () => assert.fail('Blank input must not search');
  assert.equal((await c.searchBookingByInput(' ')).length, 0);
});
test('reference, name and word failures never become an empty or partial result', async () => {
  for (const failing of ['MFSP_Reference', 'Deal_Name', 'text']) {
    const c = setup();
    c.crmSearchRecord = async (_, criteria) => {
      if (criteria.includes(failing)) throw Object.assign(new Error('Permission denied'), { code: 'NO_PERMISSION' });
      return [{ id: 'existing-match' }];
    };
    c.crmSearchWord = async () => { if (failing === 'text') throw new Error('Connection lost'); return []; };
    await assert.rejects(c.searchBookingByInput('reference'), /Booking search could not be completed.*Permission denied|Booking search could not be completed.*Connection lost/);
  }
});
test('successful searches merge and deduplicate their matches', async () => {
  const c = setup();
  c.crmSearchRecord = async () => [{ id: 'a' }];
  c.crmSearchWord = async () => [{ id: 'b' }];
  assert.deepEqual(Array.from(await c.searchBookingByInput('reference'), record => record.id), ['a', 'b']);
});
function loadSetup() {
  const errors = [], opened = [];
  const state = {}, elements = { bookingSearch: { value: 'query' } };
  const context = vm.createContext({ state, elements, getBookingFromSearch: () => null,
    searchBookingByInput: async () => { throw new Error('Search timed out'); },
    hideSearchResults() {}, setError: (_, message) => errors.push(message),
    cacheBookingLookup() {}, loadBookingWorkspace: async id => opened.push(id) });
  vm.runInContext(extract('booking-controller.js', 'onLoadBookingClick'), context);
  return { context, state, elements, errors, opened };
}
test('load action shows search failures without saying no booking or opening a partial result', async () => {
  const f = loadSetup();
  await f.context.onLoadBookingClick();
  assert.deepEqual(f.errors, ['Search timed out']);
  assert.deepEqual(f.opened, []);
});
test('late search failures cannot replace a newer query', async () => {
  const f = loadSetup(); let reject;
  f.context.searchBookingByInput = () => new Promise((_, fail) => { reject = fail; });
  const pending = f.context.onLoadBookingClick();
  f.elements.bookingSearch.value = 'new query';
  reject(new Error('Old failure')); await pending;
  assert.deepEqual(f.errors, []);
});

test('failed booking detail hydration cannot leave incomplete records to be filtered as empty', async () => {
  const c = vm.createContext({ normalizeBookingCandidate: value => value, getBookingOwnerInfo: () => ({}), MODULES: { bookings: 'Deals' },
    crmGetRecord: async () => { throw Object.assign(new Error('Denied'), { code: 'NO_PERMISSION' }); } });
  vm.runInContext(extract('booking-controller.js', 'hydrateBookingRecordsIfNeeded'), c);
  await assert.rejects(c.hydrateBookingRecordsIfNeeded([{ id: 'a' }]), error => error.code === 'NO_PERMISSION' && /all booking details.*Denied/.test(error.message));
  c.crmGetRecord = async () => null;
  await assert.rejects(c.hydrateBookingRecordsIfNeeded([{ id: 'a' }]), /CRM did not confirm/);
});

test('actual queue renderer displays a failed search without stale counts or an empty-result message', () => {
  const node = () => ({ classList: { toggle() {} }, setAttribute() {}, removeAttribute() {}, closest() { return null; }, querySelector() { return null; } });
  const names = ['bookingBrowserBody', 'bookingBrowserHead', 'bookingBrowserOwner', 'bookingBrowserSearchBy', 'bookingBrowserStagesMenu', 'bookingBrowserStagesToggle', 'bookingBrowserCount'];
  const elements = Object.fromEntries(names.map(name => [name, node()]));
  const state = { initialized: true, bookings: [{ id: 'stale' }], bookingBrowserError: 'Permission denied', bookingBrowserPendingStages: [], bookingBrowserStages: [] };
  const context = vm.createContext({
    observeQueueDeskCells() {}, observeQueueTaskCells() {}, buildBookingBrowserOwnerOptions: () => [], buildBookingBrowserStageOptions: () => [],
    sortTableRows: rows => rows, filterBookingsForBrowser: rows => rows, getQueueTablePreferences: () => ({}), getQueueVisibleColumns: () => [],
    applyBookingBrowserLayoutState() {}, queueColumnButton: () => '', configureQueueTable() {}, bindTableSort() {},
    buildBookingBrowserSearchByOptions: () => '', buildBookingBrowserOwnerOptionMarkup: () => '', escapeHtml: String
  });
  vm.runInContext(extract('booking-shell.js', 'renderBookingBrowser'), context);
  context.renderBookingBrowser({ elements, state });
  assert.equal(elements.bookingBrowserCount.textContent, 'Search failed');
  assert.match(elements.bookingBrowserBody.innerHTML, /Could not load bookings.*Permission denied/s);
  assert.doesNotMatch(elements.bookingBrowserBody.innerHTML, /No bookings found|data-browser-booking-id/);
});
