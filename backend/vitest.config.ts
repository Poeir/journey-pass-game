import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

// Baseline env so importing modules that chain to `@/config.js` doesn't
// `process.exit(1)`. Tests that need different values either set them via
// `vi.stubEnv` + `vi.resetModules` or mock `@/config.js` directly.
const TEST_ENV = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://test:test@localhost:5432/test',
  SESSION_SECRET: 'a'.repeat(64),
  FRONTEND_ORIGIN: 'http://localhost:5173',
  CLOUDINARY_CLOUD_NAME: 'test-cloud',
  CLOUDINARY_API_KEY: 'test-key',
  CLOUDINARY_API_SECRET: 'test-secret',
  ADMIN_USERNAME: 'admin',
  ADMIN_PASSWORD: 'admin-pw-12345',
};

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    env: TEST_ENV,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/test-utils/**', 'src/server.ts', 'src/db/prisma.ts'],
    },
  },
});
