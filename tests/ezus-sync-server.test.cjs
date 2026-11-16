const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('service and step matching read complete pages before deciding what is absent', () => {
  const code = read('_local/integrations/crm/source/syncservicesfromezuswithtoken.dg');
  assert.match(code, /servicesRead = standalone.sync_getBookingRecords\("Booking_Services",bookingId\).toMap/);
  assert.match(code, /stepsRead = standalone.sync_getBookingRecords\(stepModule,bookingId\).toMap/);
  assert.match(code, /stepsReadback = standalone.sync_getBookingRecords\(stepModule,bookingId\).toMap/);
  assert.doesNotMatch(code, /searchRecords\("Booking_Services"|searchRecords\(stepModule/);
  assert.ok(code.indexOf('return servicesRead') < code.indexOf('BSIdsToDeleteMap ='));
  assert.ok(code.indexOf('return stepsRead') < code.indexOf('toCreateSteps ='));
  assert.ok(code.indexOf('return stepsReadback') < code.indexOf('batchCreate ='));
});
test('the pagination boundary, missing pages, duplicate IDs and foreign bookings fail closed', () => {
  const code = read('_local/integrations/crm/source/sync_getBookingRecords.dg');
  assert.match(code, /searchRecords\(moduleName,[^\n]+pageNumber,200\)/);
  assert.match(code, /pageRows == null/);
  assert.match(code, /seen.containKey\(recordId\)/);
  assert.match(code, /rowBooking.get\("id"\)[^\n]+!= bookingId/);
  assert.match(code, /if\(pageRows.size\(\) < 200\)[\s\S]*?res.put\("error",false\)/);
  assert.equal((code.match(/res.put\("error",false\)/g) || []).length, 1);
  assert.match(code, /catch \(pageError\)/);
  assert.match(code, /pagination limit/);
});
test('step cleanup occurs after write validation and enqueues only confirmed inactive steps', () => {
  const code = read('_local/integrations/crm/source/syncservicesfromezuswithtoken.dg');
  const inactive = code.indexOf('up.put("Status","Inactive")');
  assert.ok(inactive > code.indexOf('if(hasSyncError || stepSyncErrors.size() > 0)'));
  assert.ok(inactive > code.indexOf('if(stepSyncErrors.size() > 0 || serviceSyncErrors.size() > 0)'));
  assert.ok(inactive > code.indexOf('bookingCommissionUpdateRes ='));
  assert.ok(code.indexOf('inactiveResult.get("id")') < code.indexOf('standalone.jobs_enqueueDeleteInactiveBookingStep('));
  assert.equal((code.match(/standalone.jobs_enqueueDeleteInactiveBookingStep\(/g) || []).length, 1);
  assert.match(code, /sourceStepRefs.containKey\(sourceRef\)/);
});
test('both full-sync copies reject dryRun before writers, jobs and token requests', () => {
  for (const file of ['_local/integrations/crm/source/syncprojectfromezus.dg', '_local/integrations/crm/reference/crm_functions/sync_syncFullProjectFromEzus']) {
    const code = read(file);
    const guard = code.indexOf('DRY_RUN_NOT_SUPPORTED');
    assert.ok(guard > 0);
    assert.ok(guard < code.indexOf('standalone.getEzusToken()'));
    assert.ok(code.indexOf('return res;', guard) < code.indexOf('standalone.getEzusToken()'));
    assert.match(code, /argsMap.get\("dryRun"\)/);
    assert.match(code, /options.get\("syncTravelers"\),ifnull\(options.get\("syncTravellers"\),true\)/);
  }
  assert.match(read('_local/integrations/crm/reference/crm_functions/sync_runProjectFromEzus'), /replaceAll\("travelers","travellers"\)/);
});
