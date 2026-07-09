// jest.config.cjs
module.exports = {
  testEnvironment: 'node', // Use Node.js environment for tests
  transform: {
    '^.+\\.[cm]?js$': 'babel-jest', // Transpile JavaScript and ES module files using Babel
  },
  moduleFileExtensions: ['js', 'mjs'], // Support .js and .mjs files
};
