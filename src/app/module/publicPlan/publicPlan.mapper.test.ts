import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "../../../generated/prisma/client.js";
import { PublicPlanRow, toPublicPlan } from "./publicPlan.mapper.js";

const row = (overrides: Partial<PublicPlanRow> = {}): PublicPlanRow => ({
    id: "plan-1",
    code: "starter",
    name: "Starter",
    price_usd: new Prisma.Decimal("29.00"),
    max_seats: 5,
    max_projects: null,
    features: ["Time tracking", "Invoices"],
    ...overrides,
});

const signup = { defaultPlanId: "plan-1", trialDays: 14 };

describe("toPublicPlan", () => {
    it("returns exactly the public fields", () => {
        assert.deepEqual(Object.keys(toPublicPlan(row(), signup)).sort(), [
            "billing_interval",
            "code",
            "currency",
            "features",
            "max_projects",
            "max_seats",
            "name",
            "price",
            "trial_days",
        ]);
    });

    it("never carries the internal id, even when the row has more columns", () => {
        const wider = { ...row(), is_active: true, sort_order: 3, description: "internal note" };
        const plan = toPublicPlan(wider, signup);
        assert.equal("id" in plan, false);
        assert.equal("is_active" in plan, false);
        assert.equal("sort_order" in plan, false);
    });

    it("turns the Decimal price into a number with its currency and interval", () => {
        const plan = toPublicPlan(row(), signup);
        assert.equal(plan.price, 29);
        assert.equal(plan.currency, "USD");
        assert.equal(plan.billing_interval, "month");
    });

    it("keeps null limits as unlimited rather than zero", () => {
        const plan = toPublicPlan(row({ max_seats: null }), signup);
        assert.equal(plan.max_seats, null);
        assert.equal(plan.max_projects, null);
    });

    it("offers the trial only on the plan sign-up starts", () => {
        assert.equal(toPublicPlan(row(), signup).trial_days, 14);
        assert.equal(toPublicPlan(row({ id: "plan-2" }), signup).trial_days, null);
        assert.equal(toPublicPlan(row(), { defaultPlanId: null, trialDays: 14 }).trial_days, null);
    });

    it("copies the feature list instead of sharing it", () => {
        const source = row();
        const plan = toPublicPlan(source, signup);
        plan.features.push("Extra");
        assert.deepEqual(source.features, ["Time tracking", "Invoices"]);
    });
});
