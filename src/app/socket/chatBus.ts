import pg from "pg";
import { env } from "../../config/env.js";
import { logger } from "../lib/logger.js";
import { prisma } from "../lib/prisma.js";

/**
 * How one instance tells the others that something happened.
 *
 * The chat socket keeps its connections in memory, which makes the process
 * stateful: a message posted to instance A reaches nobody holding a socket on
 * instance B. Nothing is lost — messages are persisted over HTTP and the thread
 * is fetched when a page opens — but the live update silently stops working the
 * moment a second instance exists, which is the worst kind of scaling bug
 * because everything looks fine on one.
 *
 * Postgres LISTEN/NOTIFY carries the hint between instances. Deliberately not
 * Redis: the database is already there, already has credentials, already has a
 * backup story, and adding a second piece of infrastructure to move one string
 * between processes is a cost this does not need to pay.
 *
 * ONE dedicated connection, not the Prisma pool. A LISTEN belongs to a session
 * and a pooled connection can be handed to somebody else between statements —
 * the listen would be silently dropped and nothing would ever arrive again.
 *
 * The payload is a HINT, never the message. Two reasons, and either alone would
 * decide it: a NOTIFY payload is capped at 8000 bytes while a message body may
 * be 4000 characters, and the browser already refetches rather than trusting
 * what a socket hands it — which is what makes a dropped connection harmless.
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
 * Tell every instance, including this one.
 *
 * Published through the Prisma pool rather than the listening connection, which
 * is busy being a listener. Postgres delivers a notification to every session
 * listening on the channel — the publisher's own listener included, since it is
 * a different session — so there is ONE delivery path rather than a local one
 * and a remote one that could drift apart.
 *
 * Failing to publish must never fail the request that caused it: the message is
 * already stored, and the worst case is that somebody's page updates when they
 * next open it instead of a second sooner.
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
