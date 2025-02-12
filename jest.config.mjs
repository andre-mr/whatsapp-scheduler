export default {
    transform: {},
    testEnvironment: 'node',
    moduleNameMapper: {
        '^(\\.{1,2}/.*)\\.js$': '$1'
    },
    setupFiles: ['./jest.setup.js']
};