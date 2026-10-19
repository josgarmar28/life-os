import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const shared = fileURLToPath(new URL('../../supabase/functions/_shared', import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@shared': shared } },
  server: { fs: { allow: ['..', '../../supabase/functions'] } },
  build: { sourcemap: false, target: 'es2020' },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
