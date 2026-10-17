/**
 * A request path as it may appear in a log line: no query string, and any
 * segment shaped like a one-time link token (64 hex characters, from
 * createLinkToken) replaced, because invite and reset links carry the bearer
 * token in the path itself.
 */
const LINK_TOKEN = /^[0-9a-f]{64}$/i;

export const loggablePath = (url: string) =>
    url
        .split("?")[0]
        .split("/")
        .map((segment) => (LINK_TOKEN.test(segment) ? ":token" : segment))
        .join("/");
