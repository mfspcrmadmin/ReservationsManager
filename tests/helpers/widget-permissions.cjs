const fs = require('node:fs');
const vm = require('node:vm');
exports.load = context => vm.runInContext(fs.readFileSync(require.resolve('../../app/js/widget-permissions.js'), 'utf8').replace(/^export /gm, ''), context);
exports.identity = (profile, id = 'user', email = 'user@example.com') => ({
  currentUserId: id, currentUserEmail: email,
  bookingTagRelationships: [{ id: 'relationship', User_ID: id, Email: email, Profile: profile, Status: 'Active', Record_Status__s: 'Available' }]
});
