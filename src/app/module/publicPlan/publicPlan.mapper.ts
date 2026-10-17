import { Prisma } from "../../../generated/prisma/client.js";

/**
 * The plans the pricing page shows: on sale AND marked public. A test or
 * bespoke plan can be active for the company on it without being advertised.
 */
export const PUBLIC_PLAN_WHERE = { is_active: true, is_public: true } satisfies Prisma.PlanWhereInput;

/** The plan columns the public endpoint reads. Nothing else is selected. */
export const PUBLIC_PLAN_SELECT = {
    id: true,
    code: true,
    name: true,
    price_usd: true,
    max_seats: true,
    max_projects: true,
    features: true,
} satisfies Prisma.PlanSelect;

export type PublicPlanRow = Prisma.PlanGetPayload<{ select: typeof PUBLIC_PLAN_SELECT }>;

export interface PublicPlan {
    /** Stable key for the page; never changes when a plan is renamed. */
    code: string;
    name: string;
    price: number;
    currency: "USD";
    billing_interval: "month";
    /** Days of free trial on self sign-up; null when signing up does not start this plan. */
    trial_days: number | null;
    /** Null means unlimited. */
    max_seats: number | null;
    max_projects: number | null;
    features: string[];
}

/**
 * Built field by field from a whitelist, so a column added to Plan later can
 * never reach an anonymous visitor by accident. Prices are monthly USD: the
 * platform's MRR is the plain sum of price_usd.
 */
export const toPublicPlan = (
    plan: PublicPlanRow,
    signup: { defaultPlanId: string | null; trialDays: number }
): PublicPlan => ({
    code: plan.code,
    name: plan.name,
    price: plan.price_usd.toNumber(),
    currency: "USD",
    billing_interval: "month",
    trial_days: plan.id === signup.defaultPlanId ? signup.trialDays : null,
    max_seats: plan.max_seats,
    max_projects: plan.max_projects,
    features: [...plan.features],
});
