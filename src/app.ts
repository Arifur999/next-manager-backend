import cookieParser from "cookie-parser";
import cors from "cors";
import express, { Application, Request, Response } from "express";
import cron from "node-cron";
import { apiRateLimit } from "./app/middleware/rateLimit.js";
import { globalErrorHandler } from "./app/middleware/globalErrorHandler.js";
import notFound from "./app/middleware/notFound.js";
import { indexRoute } from "./app/routes/index.js";
import { syncTodaysRate } from "./app/utils/currencyRate.js";
import { env } from "./config/env.js";

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

// Behind a reverse proxy the client address arrives in X-Forwarded-For. Without
// this every request looks like it came from the proxy, which would put all
// users in one rate-limit bucket and let a single attacker lock out everybody.
// 1 = trust exactly one proxy hop.
app.set("trust proxy", 1);

// FRONTEND_URL may be a single origin or a comma-separated list (e.g. both the
// www and bare-domain variants of a site).
const staticAllowedOrigins = env.FRONTEND_URL.split(",")
    .map((url) => url.trim())
    .filter(Boolean);

const isDevelopment = env.NODE_ENV !== "production";

function isAllowedOrigin(origin?: string): boolean {
    // No Origin header: same-origin navigations, curl, server-to-server. The
    // Next.js server calls this API without one on every server-rendered page.
    if (!origin) return true;
    if (staticAllowedOrigins.includes(origin)) return true;
    if (isDevelopment && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
    return false;
}

// Never a wildcard-subdomain allowance here. A free-to-register preview host
// accepted as a credentialed origin is one config change away from being a real
// cross-workspace read of every tenant's data.
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
