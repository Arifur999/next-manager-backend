import "../../testing/testEnv.js";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SubscriptionStatus } from "../../../generated/prisma/enums.js";
import { expiryWhere } from "./platformSubscription.service.js";

/**
 * The expiry sweep's decision table, checked against the real WHERE clauses
 * from expiryWhere(), so changing the service changes what this tests.
 *
 * Two things this guards against, both of which lock a paying customer out
 * overnight:
 *
 *   1. A lapsed subscription going straight to `suspended`. There is a
 *      difference between "your payment has not arrived" and "we have cut you
 *      off", and skipping the middle state removes every chance to notice.
 *   2. The grace window being measured from the wrong date, so a trial that
 *      ended yesterday is suspended today.
 */

const DAY = 24 * 60 * 60 * 1000;

type Sub = {
    status: SubscriptionStatus;
    trial_ends_at: Date | null;
    current_period_end: Date | null;
};

type Condition = { lt: Date } | Date | string | null;
type Where = { OR?: Where[] } & { [field: string]: Condition | Where[] | undefined };

/**
 * Evaluates the small part of Prisma's filter language the sweep uses:
 * equality (including null), `{ lt }` on dates, and OR. Anything else throws,
 * so a new kind of condition in the service cannot pass by being ignored.
 */
const matches = (sub: Sub, where: Where): boolean =>
    Object.entries(where).every(([field, condition]) => {
        if (field === "OR") {
            if (!Array.isArray(condition)) throw new Error("OR must be a list");
            return condition.some((branch) => matches(sub, branch));
        }
        if (field !== "status" && field !== "trial_ends_at" && field !== "current_period_end") {
            throw new Error(`The test does not know the field ${field}`);
        }

        const value = sub[field];
        if (condition === null || typeof condition === "string") return value === condition;
        if (condition instanceof Date) return value instanceof Date && value.getTime() === condition.getTime();
        if (condition !== undefined && !Array.isArray(condition) && "lt" in condition) {
            return value instanceof Date && value < condition.lt;
        }
        throw new Error(`The test does not know the condition on ${field}`);
    });

/** The two updateMany calls, in the order expireSubscriptions runs them. */
const sweep = (sub: Sub, now: Date): Sub["status"] => {
    const where = expiryWhere(now);
    let current = sub;

    if (matches(current, where.lapsed)) current = { ...current, status: SubscriptionStatus.past_due };
    if (matches(current, where.beyondGrace)) current = { ...current, status: SubscriptionStatus.suspended };

    return current.status;
};

const now = new Date("2026-08-29T12:00:00.000Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * DAY);
const daysAhead = (n: number) => new Date(now.getTime() + n * DAY);

describe("expiry sweep", () => {
    it("leaves a trial that has not run out alone", () => {
        const status = sweep(
            { status: SubscriptionStatus.trialing, trial_ends_at: daysAhead(3), current_period_end: null },
            now
        );
        assert.equal(status, SubscriptionStatus.trialing);
    });

    it("moves a lapsed trial to past_due, not straight to suspended", () => {
        const status = sweep(
            { status: SubscriptionStatus.trialing, trial_ends_at: daysAgo(1), current_period_end: null },
            now
        );
        assert.equal(status, SubscriptionStatus.past_due);
    });

    it("moves a lapsed paid period to past_due", () => {
        const status = sweep(
            { status: SubscriptionStatus.active, trial_ends_at: null, current_period_end: daysAgo(1) },
            now
        );
        assert.equal(status, SubscriptionStatus.past_due);
    });

    it("leaves an active subscription with time left alone", () => {
        const status = sweep(
            { status: SubscriptionStatus.active, trial_ends_at: null, current_period_end: daysAhead(20) },
            now
        );
        assert.equal(status, SubscriptionStatus.active);
    });

    it("keeps a company inside the grace window in past_due", () => {
        // Six days past the end. Still writing, still nudged.
        const status = sweep(
            { status: SubscriptionStatus.past_due, trial_ends_at: null, current_period_end: daysAgo(6) },
            now
        );
        assert.equal(status, SubscriptionStatus.past_due);
    });

    it("suspends once the grace window has passed", () => {
        const status = sweep(
            { status: SubscriptionStatus.past_due, trial_ends_at: null, current_period_end: daysAgo(8) },
            now
        );
        assert.equal(status, SubscriptionStatus.suspended);
    });

    it("measures the grace window from the trial date when there is no period", () => {
        // The case that would otherwise fall through both clauses and leave a
        // company in past_due forever.
        const status = sweep(
            { status: SubscriptionStatus.past_due, trial_ends_at: daysAgo(8), current_period_end: null },
            now
        );
        assert.equal(status, SubscriptionStatus.suspended);
    });

    it("never resurrects a cancelled subscription", () => {
        const status = sweep(
            { status: SubscriptionStatus.cancelled, trial_ends_at: daysAgo(30), current_period_end: daysAgo(30) },
            now
        );
        assert.equal(status, SubscriptionStatus.cancelled);
    });

    it("leaves a subscription with no dates at all alone, forever", () => {
        // How every company that predates billing was migrated: active, no end
        // date. The sweep must never touch them.
        const status = sweep(
            { status: SubscriptionStatus.active, trial_ends_at: null, current_period_end: null },
            now
        );
        assert.equal(status, SubscriptionStatus.active);
    });

    it("does not re-suspend something already suspended", () => {
        const status = sweep(
            { status: SubscriptionStatus.suspended, trial_ends_at: null, current_period_end: daysAgo(90) },
            now
        );
        assert.equal(status, SubscriptionStatus.suspended);
    });
});
