// Unrelated flow tests inject this dependency; lock semantics are exercised
// separately with the real coordinator in record-edit-locks.test.cjs.
module.exports = {
  begin: async () => {}, check: async () => {}, release: async () => {},
  beginMany: async () => {}, releaseMany: async () => {}, releaseAll: async () => {},
  write: async (_, __, save) => save()
};
