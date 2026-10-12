import { Server } from "http";
import app from "./app.js";
import { seedSuperAdmin } from "./app/utils/seed.js";
import { startChatBus, stopChatBus } from "./app/socket/chatBus.js";
import { attachChatSocket, deliverLocally } from "./app/socket/chatSocket.js";
import { env } from "./config/env.js";
import { logger } from "./app/lib/logger.js";
import { prisma } from "./app/lib/prisma.js";

let server: Server;

const bootstrap = async () => {
    try {
        await seedSuperAdmin();
        server = app.listen(env.PORT, () => {
            logger.info("Server is running", { url: `http://localhost:${env.PORT}` });
        });

        // The chat socket shares this HTTP server rather than binding a
        // port of its own, so it needs no extra firewall rule and inherits
        // the same TLS termination in front of it.
        //
        // The socket keeps its connections in THIS process's memory, which is
        // what makes the process stateful. The bus is what makes that safe
        // behind more than one instance: a message published on any instance
        // reaches every instance, and each delivers to its own sockets.
        //
        // Started before the socket server so a connection that arrives in the
        // first millisecond is never served by a process that cannot hear the
        // bus yet.
        startChatBus((event) =>
            deliverLocally(event.recipients, {
                type: "message",
                conversation_id: event.conversationId,
            })
        );

        attachChatSocket(server);

        // listen() reports EADDRINUSE and friends by EMITTING, not by
        // throwing, so the try above never sees them. Without this a port
        // clash is a process that logged a success line and serves nothing.
        server.on("error", (error) => {
            logger.error("Server failed to bind", { error });
            process.exit(1);
        });
    } catch (error) {
        logger.error("Failed to start server", { error });
        // Exiting rather than returning. app.ts schedules four cron jobs at
        // import time, and those timers hold the event loop open on their own -
        // so a bootstrap that merely returned left a process that is alive,
        // listening to nothing, and reported as healthy forever. A container
        // that cannot start has to be a container that stopped.
        process.exit(1);
    }
};

let shuttingDown = false;

/**
 * Stop serving, let in-flight requests finish, close the chat bus and Prisma,
 * then exit: 0 for a requested stop, 1 for a crash.
 */
const shutdown = (reason: string, exitCode: 0 | 1, error?: unknown) => {
    // A second signal or a crash while draining must not start a second drain.
    if (shuttingDown) return;
    shuttingDown = true;

    logger[exitCode === 0 ? "info" : "error"]("Shutting down server", { reason, ...(error ? { error } : {}) });

    // Nothing may hang the stop forever; exiting first means the logs say why.
    const giveUp = setTimeout(() => {
        logger.error("Shutdown timed out with connections still open. Exiting.");
        process.exit(1);
    }, 10_000);

    const finish = async () => {
        await stopChatBus().catch(() => {});
        await prisma.$disconnect().catch(() => {});
        clearTimeout(giveUp);
        logger.info("Server closed.");
        process.exit(exitCode);
    };

    if (server) {
        server.close(() => void finish());
    } else {
        void finish();
    }
};

process.on("SIGTERM", () => shutdown("SIGTERM", 0));
process.on("SIGINT", () => shutdown("SIGINT", 0));
process.on("uncaughtException", (error) => shutdown("uncaughtException", 1, error));
process.on("unhandledRejection", (error) => shutdown("unhandledRejection", 1, error));

bootstrap();
