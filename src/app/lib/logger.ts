import { env } from "../../config/env.js";

// JSON lines in production, short human lines in development, silent in tests.
// Never pass tokens, cookies, passwords, query strings or request bodies as fields.

type LogLevel = "debug" | "info" | "warn" | "error";
type LogFields = Record<string, unknown>;

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const threshold = env.NODE_ENV === "test" ? Infinity : env.NODE_ENV === "production" ? LEVELS.info : LEVELS.debug;

/** An error as plain fields: message and stack, never the raw object (pg errors carry connection details). */
const describeError = (error: unknown) =>
    error instanceof Error ? { err: error.message, stack: error.stack } : { err: String(error) };

const write = (level: LogLevel, msg: string, fields: LogFields = {}) => {
    if (LEVELS[level] < threshold) return;

    const { error, ...rest } = fields;
    const details = error === undefined ? rest : { ...rest, ...describeError(error) };
    const out = level === "error" ? console.error : level === "warn" ? console.warn : console.log;

    if (env.NODE_ENV === "production") {
        out(JSON.stringify({ level, time: new Date().toISOString(), msg, ...details }));
        return;
    }

    const { stack, ...shown } = details as LogFields & { stack?: string };
    const pairs = Object.entries(shown)
        .map(([key, value]) => `${key}=${typeof value === "string" ? value : JSON.stringify(value)}`)
        .join(" ");
    out(`${level.toUpperCase().padEnd(5)} ${msg}${pairs ? ` ${pairs}` : ""}${stack ? `\n${stack}` : ""}`);
};

export const logger = {
    debug: (msg: string, fields?: LogFields) => write("debug", msg, fields),
    info: (msg: string, fields?: LogFields) => write("info", msg, fields),
    warn: (msg: string, fields?: LogFields) => write("warn", msg, fields),
    error: (msg: string, fields?: LogFields) => write("error", msg, fields),
};
