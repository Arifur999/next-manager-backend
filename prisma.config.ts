import 'dotenv/config';
import { defineConfig } from 'prisma/config';
import { PrismaPg } from '@prisma/adapter-pg';

export default defineConfig({
  schema: 'prisma/schema',
  datasource: {
    url: process.env.DATABASE_URL as string,
  },
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx src/app/utils/seed.ts',
  },
  adapter: async () => {
    return new PrismaPg({ connectionString: process.env.DATABASE_URL as string });
  },
});
