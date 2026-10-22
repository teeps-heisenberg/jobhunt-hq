import { defineConfig } from 'drizzle-kit';

/** Used only by `pnpm db:generate` to write SQL migrations into ./drizzle. */
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/tables.ts',
  out: './drizzle',
  strict: true,
  verbose: true,
});
