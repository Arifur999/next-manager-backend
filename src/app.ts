import cookieParser from "cookie-parser";
import cors from "cors";
import express, { Application, Request, Response } from "express";
import { apiRateLimit } from "./app/middleware/rateLimit.js";
import { globalErrorHandler } from "./app/middleware/globalErrorHandler.js";
import notFound from "./app/middleware/notFound.js";
import { indexRoute } from "./app/routes/index.js";
import { isAllowedOrigin } from "./app/shared/allowedOrigins.js";
import { prisma } from "./app/lib/prisma.js";
import { sendResponse } from "./app/shared/sendResponse.js";
import { chatBusReady } from "./app/socket/chatBus.js";
import { socketStats } from "./app/socket/chatSocket.js";
import { requestLogger } from "./app/middleware/requestLogger.js";

const app: Application = express();

// Behind a reverse proxy the client address arrives in X-Forwarded-For. Without
// this every request looks like it came from the proxy, which would put all
// users in one rate-limit bucket and let a single attacker lock out everybody.
// 1 = trust exactly one proxy hop.
app.set("trust proxy", 1);
app.disable("x-powered-by");

app.use(requestLogger);

app.use(cors({
    origin(origin, callback) {
        callback(null, isAllowedOrigin(origin));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    allowedHeaders: ["Content-Type", "Authorization"],
}));

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use("/api/v1", apiRateLimit, indexRoute);

// For the container healthcheck: up only when the database answers.
app.get("/health", async (_req: Request, res: Response) => {
    const runtime = { chatBus: chatBusReady(), sockets: socketStats() };

    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), 3000);
    });

    try {
        await Promise.race([prisma.$queryRaw`SELECT 1`, timeout]);
        sendResponse(res, { httpStatus: 200, success: true, message: "Healthy", data: { db: "ok", ...runtime } });
    } catch {
        sendResponse(res, { httpStatus: 503, success: false, message: "Database unavailable", data: { db: "down", ...runtime } });
    } finally {
        clearTimeout(timer);
    }
});

app.get("/", async (req: Request, res: Response) => {
    res.status(200).json({
        success: true,
        message: "Naxified Management API is working",
    });
});

// notFound BEFORE globalErrorHandler, which is the order Express actually needs.
//
// It appears to work the other way round by accident: globalErrorHandler takes
// four arguments, so Express treats it as an error handler and skips it in the
// normal chain, letting notFound answer. But an error thrown from notFound
// itself would then have no handler after it, and the reversed order says the
// opposite of what it does.
app.use(notFound);
app.use(globalErrorHandler);

export default app;
