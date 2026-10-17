import pg from "pg";
import { env } from "../../config/env.js";
import { logger } from "../lib/logger.js";
import { prisma } from "../lib/prisma.js";

/**
 * How one instance tells the others that something happened, so a message
 * posted to instance A still reaches a socket held on instance B.
 *
 * Postgres LISTEN/NOTIFY rather than Redis: the database is already there. ONE
 * dedicated connection, not the Prisma pool: a LISTEN belongs to a session, and
 * a pooled connection can change hands and silently drop it.
 *
 * The payload is a HINT, never the message: NOTIFY caps payloads at 8000 bytes
 * while a body may be 4000 characters, and the browser refetches anyway.
 */

const CHANNEL = "chat_events";

export type ChatEvent = {
    /** Who should be told. Resolved from the database before publishing. */
    recipients: string[];
    conversationId: string;
};

type Handler = (event: ChatEvent) => void;

let client: pg.Client | null = null;
let handler: Handler | null = null;
let closed = false;
let attempt = 0;

const connect = async () => {
    if (closed) return;

    const self = new pg.Client({ connectionString: env.DATABASE_URL });
    let retired = false;

    // error, end and a failed connect can all fire for one dropped connection;
    // only the first schedules a reconnect, or listeners multiply.
    const retire = () => {
        if (retired) return;
        retired = true;
        if (client === self) client = null;
        self.end().catch(() => {});
        void reconnect();
    };

    self.on("notification", (message) => {
        if (message.channel !== CHANNEL || !message.payload) return;

        try {
            handler?.(JSON.parse(message.payload) as ChatEvent);
        } catch {
            // A payload we cannot read is not worth taking the listener down
            // for. The page it would have nudged refetches on its own when it
            // is next opened.
        }
    });

    // A dropped listener is silent: HTTP keeps working while live updates stop.
    // So it reconnects rather than logging once and giving up.
    self.on("error", retire);
    self.on("end", retire);

    try {
        await self.connect();
        await self.query(`LISTEN ${CHANNEL}`);
    } catch (error) {
        logger.error("Chat bus could not connect", { error });
        retire();
        return;
    }

    if (closed || retired) {
        self.end().catch(() => {});
        return;
    }

    client = self;
    attempt = 0;
    logger.info("Chat bus listening");
};

const reconnect = async () => {
    if (closed) return;

    attempt += 1;
    // Backs off to thirty seconds. A database that is down for a minute should
    // not be hit every 200ms by every instance at once.
    const wait = Math.min(1000 * 2 ** attempt, 30_000);
    setTimeout(() => void connect(), wait);
};

/** Start listening. Called once at boot, beside the socket server. */
export const startChatBus = (onEvent: Handler) => {
    handler = onEvent;
    void connect();
};

/**
 * Tell every instance, this one included: published through the Prisma pool,
 * Postgres delivers to the publisher's own listener too, so there is one
 * delivery path. A failed publish never fails the request - the message is
 * stored, and the page catches up when it is next opened.
 */
export const publishChatEvent = async (
    event: ChatEvent,
    notify: (channel: string, payload: string) => Promise<unknown> = (channel, payload) =>
        prisma.$executeRaw`SELECT pg_notify(${channel}, ${payload})`
) => {
    try {
        await notify(CHANNEL, JSON.stringify(event));
    } catch (error) {
        logger.error("Chat bus could not publish", { error });
    }
};

export const stopChatBus = async () => {
    closed = true;
    const open = client;
    client = null;
    await open?.end().catch(() => {});
};

/** Whether the listener is currently connected, for the health endpoint. */
export const chatBusReady = () => client !== null;
