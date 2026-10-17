import "../../testing/testEnv.js";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SubscriptionStatus } from "../../../generated/prisma/enums.js";
import { subscriptionFilter } from "./platformCompany.service.js";
import { companyListQueryZodSchema } from "./platform.validation.js";

describe("companyListQueryZodSchema", () => {
    it("takes a subscription status or none", () => {
        assert.equal(companyListQueryZodSchema.parse({ status: "none" }).status, "none");
        assert.equal(companyListQueryZodSchema.parse({ status: "trialing" }).status, SubscriptionStatus.trialing);
        assert.equal(companyListQueryZodSchema.safeParse({ status: "bogus" }).success, false);
    });

    it("leaves paging off unless a limit is sent, and caps it", () => {
        assert.equal(companyListQueryZodSchema.parse({}).limit, undefined);
        assert.equal(companyListQueryZodSchema.parse({ limit: "25", page: "3" }).page, 3);
        assert.equal(companyListQueryZodSchema.parse({ limit: "5000" }).limit, 200);
    });

    it("keeps the search, trimmed, and drops an empty one", () => {
        assert.equal(companyListQueryZodSchema.parse({ search: "  acme " }).search, "acme");
        assert.equal(companyListQueryZodSchema.parse({ search: "  " }).search, undefined);
    });
});

describe("subscriptionFilter", () => {
    it("filters nothing without a status", () => {
        assert.deepEqual(subscriptionFilter(undefined), {});
    });

    it("finds companies with no subscription row for none", () => {
        assert.deepEqual(subscriptionFilter("none"), { subscription: { is: null } });
    });

    it("matches the subscription's status otherwise", () => {
        assert.deepEqual(subscriptionFilter(SubscriptionStatus.past_due), { subscription: { is: { status: SubscriptionStatus.past_due } } });
    });
});
