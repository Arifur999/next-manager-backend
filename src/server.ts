import { Server } from "http";
import app from "./app.js";
import { seedSuperAdmin } from "./app/utils/seed.js";
import { startChatBus, stopChatBus } from "./app/socket/chatBus.js";
import { attachChatSocket, deliverLocally } from "./app/socket/chatSocket.js";
import { env } from "./config/env.js";

let server: Server;

const bootstrap = async () => {
    try {
        await seedSuperAdmin();
        server = app.listen(env.PORT, () => {
            console.log(`Server is running on http://localhost:${env.PORT}`);
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
            console.error("Server failed to bind:", error);
            process.exit(1);
        });
    } catch (error) {
        console.error("Failed to start server:", error);
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
 * Stop serving, finish what is in flight, and exit 0.
 *
 * Two bugs lived here. The exit was SYNCHRONOUS after `server.close()`, so
 * the callback it was given never ran: nothing drained, the chat bus
 * connection was dropped mid-flight, and "Server closed gracefully." was a
 * line that could never print. And the code was 1, so every deliberate
 * `docker stop` looked like a crash - compose would restart a container the
 * operator had just stopped, and an orchestrator would record a rollout as a
 * CrashLoopBackOff.
 */
const shutdown = (signal: string) => {
    // A second SIGTERM while draining must not start a second drain.
    if (shuttingDown) return;
    shuttingDown = true;

    console.log(`${signal} signal received. Shutting down server...`);

    // Nothing may hang the stop forever. Docker sends SIGKILL when its grace
    // period runs out anyway; exiting first means the logs say why.
    const giveUp = setTimeout(() => {
        console.error("Shutdown timed out with connections still open. Exiting.");
        process.exit(1);
    }, 10_000);

    const finish = async () => {
        // Its own connection, so it does not close with the HTTP server.
        await stopChatBus().catch(() => {});
        clearTimeout(giveUp);
        console.log("Server closed gracefully.");
        process.exit(0);
    };

    if (server) {
        server.close(() => void finish());
    } else {
        // Signalled before listen() ever returned - there is nothing to drain.
        void finish();
    }
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

process.on("uncaughtException", (error) => {
    console.log("Uncaught Exception Detected... Shutting down server", error);
    if (server) {
        server.close(() => {
            process.exit(1);
        });
    }
    process.exit(1);
});

process.on("unhandledRejection", (error) => {
    console.log("Unhandled Rejection Detected... Shutting down server", error);
    if (server) {
        server.close(() => {
            process.exit(1);
        });
    }
    process.exit(1);
});

bootstrap();
