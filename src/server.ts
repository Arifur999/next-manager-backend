import { Server } from "http";
import app from "./app.js";
import { seedSuperAdmin } from "./app/utils/seed.js";
import { env } from "./config/env.js";

let server: Server;

const bootstrap = async () => {
    try {
        await seedSuperAdmin();
        server = app.listen(env.PORT, () => {
            console.log(`Server is running on http://localhost:${env.PORT}`);
        });
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
