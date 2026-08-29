import assert from "node:assert/strict";
import { describe, it } from "node:test";

/**
 * The expiry sweep's decision table, extracted so it can be checked without a
 * database or a wait until 01:30.
 *
 * The transitions are what matter here, not the SQL. Two things this is
 * guarding against, both of which lock a paying customer out overnight:
 *
 *   1. A lapsed subscription going straight to `suspended`. There is a
 *      difference between "your payment has not arrived" and "we have cut you
 *      off", and skipping the middle state removes every chance to notice.
 *   2. The grace window being measured from the wrong date, so a trial that
 *      ended yesterday is suspended today.
 */

const DAY = 24 * 60 * 60 * 1000;
const GRACE_DAYS = 7;

type Sub = {
    status: "trialing" | "active" | "past_due" | "suspended" | "cancelled";
    trial_ends_at: Date | null;
    current_period_end: Date | null;
};

/**
 * Mirrors the two updateMany conditions in platform.service.ts, in order.
 *
 * A copy, and worth being honest about that: if the service's WHERE clauses
 * change this has to change with them. It is here because the alternative is
 * no test at all on the one job that can lock people out unattended.
 */
const sweep = (sub: Sub, now: Date): Sub["status"] => {
    const graceCutoff = new Date(now.getTime() - GRACE_DAYS * DAY);

    let status = sub.status;

    const lapsed =
        (status === "trialing" && sub.trial_ends_at !== null && sub.trial_ends_at < now) ||
        (status === "active" && sub.current_period_end !== null && sub.current_period_end < now);

    if (lapsed) status = "past_due";

    if (status === "past_due") {
        const beyondGrace =
            (sub.current_period_end !== null && sub.current_period_end < graceCutoff) ||
            (sub.current_period_end === null &&
                sub.trial_ends_at !== null &&
                sub.trial_ends_at < graceCutoff);

        if (beyondGrace) status = "suspended";
    }

    return status;
};

const now = new Date("2026-08-29T12:00:00.000Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * DAY);
const daysAhead = (n: number) => new Date(now.getTime() + n * DAY);

describe("expiry sweep", () => {
    it("leaves a trial that has not run out alone", () => {
        const status = sweep(
            { status: "trialing", trial_ends_at: daysAhead(3), current_period_end: null },
            now
        );
        assert.equal(status, "trialing");
    });

    it("moves a lapsed trial to past_due, not straight to suspended", () => {
        const status = sweep(
            { status: "trialing", trial_ends_at: daysAgo(1), current_period_end: null },
            now
        );
        assert.equal(status, "past_due");
    });

    it("moves a lapsed paid period to past_due", () => {
        const status = sweep(
            { status: "active", trial_ends_at: null, current_period_end: daysAgo(1) },
            now
        );
        assert.equal(status, "past_due");
    });

    it("leaves an active subscription with time left alone", () => {
        const status = sweep(
            { status: "active", trial_ends_at: null, current_period_end: daysAhead(20) },
            now
        );
        assert.equal(status, "active");
    });

    it("keeps a company inside the grace window in past_due", () => {
        // Six days past the end. Still writing, still nudged.
        const status = sweep(
            { status: "past_due", trial_ends_at: null, current_period_end: daysAgo(6) },
            now
        );
        assert.equal(status, "past_due");
    });

    it("suspends once the grace window has passed", () => {
        const status = sweep(
            { status: "past_due", trial_ends_at: null, current_period_end: daysAgo(8) },
            now
        );
        assert.equal(status, "suspended");
    });

    it("measures the grace window from the trial date when there is no period", () => {
        // The case that would otherwise fall through both clauses and leave a
        // company in past_due forever.
        const status = sweep(
            { status: "past_due", trial_ends_at: daysAgo(8), current_period_end: null },
            now
        );
        assert.equal(status, "suspended");
    });

    it("never resurrects a cancelled subscription", () => {
        const status = sweep(
            { status: "cancelled", trial_ends_at: daysAgo(30), current_period_end: daysAgo(30) },
            now
        );
        assert.equal(status, "cancelled");
    });

    it("leaves a subscription with no dates at all alone, forever", () => {
        // How every company that predates billing was migrated: active, no end
        // date. The sweep must never touch them.
        const status = sweep(
            { status: "active", trial_ends_at: null, current_period_end: null },
            now
        );
        assert.equal(status, "active");
    });

    it("does not re-suspend something already suspended", () => {
        const status = sweep(
            { status: "suspended", trial_ends_at: null, current_period_end: daysAgo(90) },
            now
        );
        assert.equal(status, "suspended");
    });
});
