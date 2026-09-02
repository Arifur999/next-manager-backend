import { Server } from "http";
import app from "./app.js";
import { seedSuperAdmin } from "./app/utils/seed.js";
import { attachChatSocket } from "./app/socket/chatSocket.js";
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
        // DEPLOYMENT: this makes the process stateful. Live connections live
        // in memory on ONE instance, so behind more than one instance a
        // message posted to instance A does not reach a socket held by
        // instance B. Nothing is LOST - messages are persisted over HTTP and
        // the thread is fetched on open - but the live update stops working
        // until the page is reloaded. Running more than one instance needs
        // sticky sessions or a shared pub/sub, and that is a decision to make
        // before scaling out rather than after.
        attachChatSocket(server);
    } catch (error) {
        console.error("Failed to start server:", error);
    }
};

const shutdown = (signal: string) => {
    console.log(`${signal} signal received. Shutting down server...`);
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
