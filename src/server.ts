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
    } catch (error) {
        console.error("Failed to start server:", error);
    }
};

const shutdown = (signal: string) => {
    console.log(`${signal} signal received. Shutting down server...`);
    // Its own connection, so it does not close with the HTTP server.
    void stopChatBus();
    if (server) {
        server.close(() => {
            console.log("Server closed gracefully.");
            process.exit(1);
        });
    }
    process.exit(1);
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
