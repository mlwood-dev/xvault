export default {
  testEnvironment: "node",
  testMatch: ["**/test/**/*.jest.test.js"],
  setupFilesAfterEnv: ["<rootDir>/test/setup/jest.setup.js"],
  coverageProvider: "v8",
  collectCoverage: true,
  collectCoverageFrom: [
    "src/contract/state.js",
    "src/contract/index.js",
    "src/contract/xrplUtils.js",
    "src/crypto/vaultCrypto.js",
    "src/crypto/xrplPubkey.js"
  ],
  coverageDirectory: "coverage/jest"
};
