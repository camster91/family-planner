// Set test JWT secret before any module loads
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-jest';
process.env.SKIP_ENV_VALIDATION = 'true';
