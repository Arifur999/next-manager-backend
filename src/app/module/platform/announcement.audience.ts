import { AnnouncementAudience, SubscriptionStatus } from "../../../generated/prisma/enums.js";

/**
 * Which subscription states each audience covers.
 *
 * `active` includes `past_due` for the same reason the MRR figure does: a
 * company inside its grace window is still a paying customer, and it is the one
 * most worth reaching before it stops being one.
 */
export const AUDIENCE_STATUSES: Record<AnnouncementAudience, SubscriptionStatus[] | null> = {
    all: null,
    trialing: [SubscriptionStatus.trialing],
    active: [SubscriptionStatus.active, SubscriptionStatus.past_due],
};

/** Does this company fall inside that audience right now? */
export const matchesAudience = (
    audience: AnnouncementAudience,
    subscriptionStatus: SubscriptionStatus | null
) => {
    const wanted = AUDIENCE_STATUSES[audience];
    if (wanted === null) return true;
    if (subscriptionStatus === null) return false;

    return wanted.includes(subscriptionStatus);
};
