// Import first in a unit test that loads config/env.ts, so `npm test` runs
// the same with or without a .env file. Only a variable already set in the
// shell wins; unit tests never reach the database or send mail.
const placeholders: Record<string, string> = {
    // "test" keeps the logger quiet; a test that needs another mode sets env.NODE_ENV itself.
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://unit:unit@localhost:5432/unit_tests",
    ACCESS_TOKEN_SECRET: "unit-test-access-secret",
    REFRESH_TOKEN_SECRET: "unit-test-refresh-secret",
    SUPER_ADMIN_EMAIL: "super@unit.test",
    SUPER_ADMIN_PASSWORD: "unit-test-password",
    VAULT_ENCRYPTION_KEY: "0".repeat(64),
};

for (const [name, value] of Object.entries(placeholders)) {
    process.env[name] ??= value;
}
