import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AnnouncementAudience, SubscriptionStatus } from "../../../generated/prisma/enums.js";
import { matchesAudience } from "./announcement.audience.js";

describe("matchesAudience", () => {
    it("reaches every company with the all audience, subscribed or not", () => {
        for (const status of [...Object.values(SubscriptionStatus), null]) {
            assert.equal(matchesAudience(AnnouncementAudience.all, status), true, `status ${status}`);
        }
    });

    it("counts a past_due company as an active customer", () => {
        assert.equal(matchesAudience(AnnouncementAudience.active, SubscriptionStatus.active), true);
        assert.equal(matchesAudience(AnnouncementAudience.active, SubscriptionStatus.past_due), true);
    });

    it("keeps trial notices to trialing companies", () => {
        assert.equal(matchesAudience(AnnouncementAudience.trialing, SubscriptionStatus.trialing), true);
        assert.equal(matchesAudience(AnnouncementAudience.trialing, SubscriptionStatus.active), false);
    });

    it("gives a company without a subscription only the all audience", () => {
        assert.equal(matchesAudience(AnnouncementAudience.active, null), false);
        assert.equal(matchesAudience(AnnouncementAudience.trialing, null), false);
    });
});
