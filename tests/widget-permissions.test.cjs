const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { load, identity } = require('./helpers/widget-permissions.cjs');
const c = vm.createContext({}); load(c);
test('each CRM profile retains its explicit privileges without granting native permissions', () => {
  for (const profile of ['Standard', 'Sales Standard', 'Reservations Standard', 'Sales-Res Standard', 'Finance Standard', 'Product Standard', 'Administrator', 'Finance Administrator', 'Product Administrator']) {
    const state = identity(profile), p = c.getWidgetPermissions(state);
    assert.equal(p.manageDocuments, profile === 'Administrator');
    assert.equal(p.adminActions, profile === 'Administrator');
    assert.equal(p.managePrepaymentRequester, ['Administrator', 'Finance Administrator'].includes(profile));
    assert.equal(p.overridePrepaymentCutoff, p.managePrepaymentRequester);
    assert.equal('executeBlueprint' in p, false);
    assert.ok(c.resolveWidgetRelationship(state));
  }
});
test('missing, inactive, ambiguous, conflicting and unknown relationships deny privileges', () => {
  const mutations = [
    s => { delete s.currentUserId; }, s => { delete s.currentUserEmail; },
    s => { s.bookingTagRelationships[0].Status = 'Inactive'; },
    s => { s.bookingTagRelationships[0].Status = 'Deprecated'; },
    s => { delete s.bookingTagRelationships[0].Status; },
    s => { s.bookingTagRelationships[0].Record_Status__s = 'Draft'; },
    s => { s.bookingTagRelationships[0].Record_Status__s = 'Trash'; },
    s => { s.bookingTagRelationships.push({ ...s.bookingTagRelationships[0], id: 'duplicate' }); },
    s => { s.bookingTagRelationships.push({ ...s.bookingTagRelationships[0], id: 'conflict', User_ID: 'other' }); },
    s => { s.bookingTagRelationships[0].Email = 'other@example.com'; },
    s => { s.bookingTagRelationships[0].User_ID = 'other'; },
    s => { s.bookingTagRelationships[0].Profile = 'Unknown Administrator'; }
  ];
  for (const mutate of mutations) {
    const state = identity('Administrator'); mutate(state);
    state.currentUserIsAdministrator = true;
    state.currentUserRelationshipProfile = 'Administrator';
    assert.equal(c.resolveWidgetRelationship(state), null);
    assert.equal(c.getWidgetPermissions(state).adminActions, false);
    assert.equal(c.getWidgetPermissions(state).managePrepaymentRequester, false);
  }
});
test('display-name matches and cached role flags never establish identity', () => {
  const state = { currentUserId: 'user', currentUserEmail: 'user@example.com', currentUserName: 'Same name', currentUserIsAdministrator: true, currentUserRelationshipProfile: 'Administrator',
    bookingTagRelationships: [{ User_Alias: 'Same name', Profile: 'Administrator', Status: 'Active' }] };
  assert.equal(c.getWidgetPermissions(state).manageDocuments, false);
});
test('revocation takes effect without trusting cached administrator flags', () => {
  const state = identity('Administrator');
  assert.equal(c.getWidgetPermissions(state).manageDocuments, true);
  state.bookingTagRelationships[0].Profile = 'Standard';
  assert.equal(c.getWidgetPermissions(state).manageDocuments, false);
  state.bookingTagRelationships[0].Status = 'Inactive';
  assert.equal(c.resolveWidgetRelationship(state), null);
});
test('case and surrounding whitespace normalize while both identity values remain mandatory', () => {
  const state = identity('  Finance Administrator  ');
  state.currentUserEmail = ' USER@EXAMPLE.COM ';
  assert.equal(c.getWidgetPermissions(state).managePrepaymentRequester, true);
  assert.equal(c.getWidgetPermissions(state).manageDocuments, false);
});
