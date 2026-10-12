import cookieParser from "cookie-parser";
import cors from "cors";
import express, { Application, Request, Response } from "express";
import cron from "node-cron";
import { apiRateLimit } from "./app/middleware/rateLimit.js";
import { globalErrorHandler } from "./app/middleware/globalErrorHandler.js";
import notFound from "./app/middleware/notFound.js";
import { PlatformService } from "./app/module/platform/platform.service.js";
import { PlatformFinanceService } from "./app/module/platform/platformFinance.service.js";
import { SecurityService } from "./app/module/security/security.service.js";
import { indexRoute } from "./app/routes/index.js";
import { syncTodaysRate } from "./app/utils/currencyRate.js";
import { isAllowedOrigin } from "./app/shared/allowedOrigins.js";
import { prisma } from "./app/lib/prisma.js";
import { sendResponse } from "./app/shared/sendResponse.js";
import { chatBusReady } from "./app/socket/chatBus.js";
import { socketStats } from "./app/socket/chatSocket.js";

const app: Application = express();

// Daily at 00:30 UTC, just after the providers publish. Storing the rate keeps
// a history to report against and means a payment recorded while the provider
// is down still gets a sensible default instead of failing.
//
// This is only ever the MID-MARKET rate, which is not what any processor
// actually pays - it is a default and a reporting figure. The rate on an
// exchange is the real one, typed in by whoever did it.
cron.schedule("30 0 * * *", async () => {
    try {
        const result = await syncTodaysRate();
        if (result) {
            console.log(`[currency] USD/BDT ${result.rate} via ${result.provider}`);
        }
    } catch (error) {
        console.error("[currency] daily sync failed:", (error as Error).message);
    }
});

// Subscriptions that have run out.
//
// An hour after the rate sync so the two never contend for the same startup
// moment. Idempotent by construction - it moves rows whose date has already
// passed, so a missed night is caught by the next one rather than needing a
// backfill.
cron.schedule("30 1 * * *", async () => {
    try {
        const result = await PlatformService.expireSubscriptions();
        if (result.moved_to_past_due > 0 || result.suspended > 0) {
            console.log(
                `[billing] ${result.moved_to_past_due} moved to past_due, ${result.suspended} suspended`
            );
        }
    } catch (error) {
        console.error("[billing] expiry sweep failed:", (error as Error).message);
    }
});

// A photograph of the platform's own numbers, once a day.
//
// The MRR trend cannot be computed backwards - subscriptions carry no history,
// and a line derived from created_at could never dip. So it is accumulated
// forward from here, one row per day, upserted so a double fire corrects
// rather than doubles.
cron.schedule("45 1 * * *", async () => {
    try {
        const snapshot = await PlatformFinanceService.takeSnapshot();
        console.log(
            `[platform] snapshot: MRR $${snapshot.mrr_usd}, ${snapshot.companies_total} companies`
        );
    } catch (error) {
        console.error("[platform] snapshot failed:", (error as Error).message);
    }
});

// Login history ages out.
//
// Ninety days is long enough to investigate something and short enough not to
// hoard other people's addresses forever. Idempotent by construction - it
// deletes rows whose date has already passed, so a missed night is caught by
// the next one rather than needing a backfill.
cron.schedule("15 2 * * *", async () => {
    try {
        const result = await SecurityService.pruneLoginEvents();
        if (result.deleted > 0) {
            console.log(`[security] pruned ${result.deleted} login events`);
        }
    } catch (error) {
        console.error("[security] prune failed:", (error as Error).message);
    }
});

// Behind a reverse proxy the client address arrives in X-Forwarded-For. Without
// this every request looks like it came from the proxy, which would put all
// users in one rate-limit bucket and let a single attacker lock out everybody.
// 1 = trust exactly one proxy hop.
app.set("trust proxy", 1);

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
