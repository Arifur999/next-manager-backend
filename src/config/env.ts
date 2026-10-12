import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

// Empty strings count as unset, so `FOO=` in a .env file falls back to the default.
const optional = (fallback: string) =>
    z.preprocess((value) => (value === "" ? undefined : value), z.string().default(fallback));

const required = (name: string) => z.string(`${name} is not set`).min(1, `${name} is not set`);

const envSchema = z
    .object({
        NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
        PORT: z.coerce.number().int().positive().default(5000),
        DATABASE_URL: required("DATABASE_URL"),
        ACCESS_TOKEN_SECRET: required("ACCESS_TOKEN_SECRET"),
        REFRESH_TOKEN_SECRET: required("REFRESH_TOKEN_SECRET"),
        ACCESS_TOKEN_EXPIRES_IN: optional("1d"),
        REFRESH_TOKEN_EXPIRES_IN: optional("7d"),
        // Origin(s) the web app is served from, comma-separated. Reset and
        // invite links are built from the first one.
        FRONTEND_URL: z.string().optional(),
        SUPER_ADMIN_EMAIL: required("SUPER_ADMIN_EMAIL"),
        SUPER_ADMIN_PASSWORD: required("SUPER_ADMIN_PASSWORD"),
        // AES-256-GCM key for vault credentials, 64 hex chars (openssl rand -hex 32).
        // Losing it loses every stored password.
        VAULT_ENCRYPTION_KEY: required("VAULT_ENCRYPTION_KEY"),
        // Mail is optional: without SMTP_HOST the app runs and mail is logged instead of sent.
        SMTP_HOST: optional(""),
        SMTP_PORT: z.preprocess((value) => (value === "" ? undefined : value), z.coerce.number().int().positive().default(587)),
        SMTP_USER: optional(""),
        SMTP_PASSWORD: optional(""),
        MAIL_FROM: optional(""),
    })
    .superRefine((values, ctx) => {
        if (values.NODE_ENV !== "production") return;

        const issue = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });

        if (values.ACCESS_TOKEN_SECRET.length < 32) issue("ACCESS_TOKEN_SECRET", "must be at least 32 characters in production");
        if (values.REFRESH_TOKEN_SECRET.length < 32) issue("REFRESH_TOKEN_SECRET", "must be at least 32 characters in production");
        // Equal secrets would let a refresh token pass checkAuth as an access token.
        if (values.ACCESS_TOKEN_SECRET === values.REFRESH_TOKEN_SECRET) issue("REFRESH_TOKEN_SECRET", "must differ from ACCESS_TOKEN_SECRET");
        // Without it every reset and invite link points at localhost.
        if (!values.FRONTEND_URL) issue("FRONTEND_URL", "is required in production");
        if (!/^[0-9a-fA-F]{64}$/.test(values.VAULT_ENCRYPTION_KEY)) issue("VAULT_ENCRYPTION_KEY", "must be 64 hex characters");
        if (values.SUPER_ADMIN_PASSWORD.length < 12) issue("SUPER_ADMIN_PASSWORD", "must be at least 12 characters in production");
    });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
    // stderr directly: the logger reads this module, so it cannot be used yet.
    const lines = parsed.error.issues.map((issue) => `  ${issue.path.join(".")}: ${issue.message}`);
    process.stderr.write(`Invalid environment, refusing to start:\n${lines.join("\n")}\n`);
    process.exit(1);
}

export const env = {
    ...parsed.data,
    FRONTEND_URL: parsed.data.FRONTEND_URL || "http://localhost:3000",
};
