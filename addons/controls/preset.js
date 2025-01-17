const { ensureDocsBeforeControls } = require('./dist/cjs/preset/ensureDocsBeforeControls');

function config(entry = []) {
  return [...entry, require.resolve('./dist/esm/preset/addParameter')];
}

function managerEntries(entry = [], options) {
  ensureDocsBeforeControls(options.configDir);
  return [...entry, require.resolve('./dist/esm/register')];
}

module.exports = { managerEntries, config };
