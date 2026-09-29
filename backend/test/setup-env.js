// Keeps test output readable: application logs are silent unless a test installs its own logger
// (for example to assert exactly what a rejected webhook writes).
process.env.LOG_LEVEL = 'silent';
