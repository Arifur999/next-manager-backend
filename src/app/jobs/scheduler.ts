import cron, { type ScheduledTask } from "node-cron";
import { logger } from "../lib/logger.js";
import { expireSubscriptions } from "../module/platform/platformSubscription.service.js";
import { PlatformFinanceService } from "../module/platform/platformFinance.service.js";
import { SecurityService } from "../module/security/security.service.js";
import { syncTodaysRate } from "../utils/currencyRate.js";

/**
 * The nightly jobs. Started by server.ts after the server listens, so a script
 * or test that imports app.ts does not start timers.
 */
export const startScheduledJobs = (): ScheduledTask[] => {
    const tasks: ScheduledTask[] = [];

    // Daily at 00:30 UTC, just after the providers publish. Storing the rate keeps
    // a history to report against and means a payment recorded while the provider
    // is down still gets a sensible default instead of failing.
    //
    // This is only ever the MID-MARKET rate, which is not what any processor
    // actually pays - it is a default and a reporting figure. The rate on an
    // exchange is the real one, typed in by whoever did it.
    tasks.push(cron.schedule("30 0 * * *", async () => {
        try {
            const result = await syncTodaysRate();
            if (result) {
                logger.info("Currency rate synced", { rate: result.rate, provider: result.provider });
            }
        } catch (error) {
            logger.error("Currency daily sync failed", { error });
        }
    }));

    // Subscriptions that have run out.
    //
    // An hour after the rate sync so the two never contend for the same startup
    // moment. Idempotent by construction - it moves rows whose date has already
    // passed, so a missed night is caught by the next one rather than needing a
    // backfill.
    tasks.push(cron.schedule("30 1 * * *", async () => {
        try {
            const result = await expireSubscriptions();
            if (result.moved_to_past_due > 0 || result.suspended > 0) {
                logger.info("Subscription expiry sweep", {
                    movedToPastDue: result.moved_to_past_due,
                    suspended: result.suspended,
                });
            }
        } catch (error) {
            logger.error("Subscription expiry sweep failed", { error });
        }
    }));

    // A photograph of the platform's own numbers, once a day.
    //
    // The MRR trend cannot be computed backwards - subscriptions carry no history,
    // and a line derived from created_at could never dip. So it is accumulated
    // forward from here, one row per day, upserted so a double fire corrects
    // rather than doubles.
    tasks.push(cron.schedule("45 1 * * *", async () => {
        try {
            const snapshot = await PlatformFinanceService.takeSnapshot();
            logger.info("Platform snapshot taken", {
                mrrUsd: snapshot.mrr_usd,
                companies: snapshot.companies_total,
            });
        } catch (error) {
            logger.error("Platform snapshot failed", { error });
        }
    }));

    // Login history ages out.
    //
    // Ninety days is long enough to investigate something and short enough not to
    // hoard other people's addresses forever. Idempotent by construction - it
    // deletes rows whose date has already passed, so a missed night is caught by
    // the next one rather than needing a backfill.
    tasks.push(cron.schedule("15 2 * * *", async () => {
        try {
            const result = await SecurityService.pruneLoginEvents();
            if (result.deleted > 0) {
                logger.info("Login events pruned", { deleted: result.deleted });
            }
        } catch (error) {
            logger.error("Login event prune failed", { error });
        }
    }));

    return tasks;
};
