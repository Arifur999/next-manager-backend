import { prisma } from "../../lib/prisma.js";
import { getPlatformSettings } from "../../shared/platformSettings.js";
import { PUBLIC_PLAN_SELECT, PUBLIC_PLAN_WHERE, PublicPlan, toPublicPlan } from "./publicPlan.mapper.js";

/** Plans on sale and public, in the order the platform team arranged them. */
const getActivePlans = async (): Promise<PublicPlan[]> => {
    const [plans, settings] = await Promise.all([
        prisma.plan.findMany({
            where: PUBLIC_PLAN_WHERE,
            select: PUBLIC_PLAN_SELECT,
            orderBy: [{ sort_order: "asc" }, { price_usd: "asc" }],
        }),
        getPlatformSettings(),
    ]);

    const signup = { defaultPlanId: settings.default_plan_id, trialDays: settings.default_trial_days };
    return plans.map((plan) => toPublicPlan(plan, signup));
};

export const PublicPlanService = { getActivePlans };
