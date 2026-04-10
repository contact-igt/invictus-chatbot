module.exports = {
  testEnvironment: "node",
  testMatch: ["**/tests/**/*.test.js"],
  // Support ES Modules — run with: node --experimental-vm-modules node_modules/.bin/jest
  extensionsToTreatAsEsm: [".js"],
  // Do not transform node_modules; source files are native ESM
  transform: {},
  // Increase timeout for integration tests that hit real DB
  testTimeout: 30000,
};
