import status from "http-status";
import AppError from "../../errorHelpers/AppError.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { prisma } from "../../lib/prisma.js";
import { logPlatformActivity } from "../../shared/platformActivity.js";
import { ICreatePlanPayload, IUpdatePlanPayload } from "./platform.validation.js";

export const PLAN_FIELDS = {
    id: true,
    code: true,
    name: true,
    description: true,
    price_usd: true,
    max_seats: true,
    max_projects: true,
    features: true,
    is_active: true,
    is_public: true,
    sort_order: true,
} as const;

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

export const getPlans = async () =>
    prisma.plan.findMany({ select: PLAN_FIELDS, orderBy: { sort_order: "asc" } });

export const createPlan = async (payload: ICreatePlanPayload, user: IRequestUser) => {
    const existing = await prisma.plan.findUnique({
        where: { code: payload.code },
        select: { id: true },
    });

    if (existing) {
        throw new AppError(status.CONFLICT, `A plan with the code "${payload.code}" already exists`);
    }

    return prisma.$transaction(async (tx) => {
        const plan = await tx.plan.create({
            data: {
                code: payload.code,
                name: payload.name,
                description: payload.description ?? "",
                price_usd: payload.price_usd ?? 0,
                max_seats: payload.max_seats ?? null,
                max_projects: payload.max_projects ?? null,
                features: payload.features ?? [],
                is_active: payload.is_active ?? true,
                is_public: payload.is_public ?? true,
                sort_order: payload.sort_order ?? 0,
            },
            select: PLAN_FIELDS,
        });

        await logPlatformActivity(
            tx,
            {
                entityType: "plan",
                entityId: plan.id,
                action: "created",
                summary: `Created the ${plan.name} plan at $${plan.price_usd}/month`,
            },
            user
        );

        return plan;
    });
};

export const updatePlan = async (id: string, payload: IUpdatePlanPayload, user: IRequestUser) => {
    const existing = await prisma.plan.findUnique({
        where: { id },
        select: { id: true, name: true, price_usd: true, max_seats: true, is_public: true },
    });

    if (!existing) {
        throw new AppError(status.NOT_FOUND, "Plan not found");
    }

    return prisma.$transaction(async (tx) => {
        const plan = await tx.plan.update({ where: { id }, data: payload, select: PLAN_FIELDS });

        // Names what actually moved. Editing a plan changes what every company
        // on it is charged and limited to, so "updated the Growth plan" is not
        // enough to reconstruct afterwards.
        const changes: string[] = [];

        if (!existing.price_usd.equals(plan.price_usd)) {
            changes.push(`price $${existing.price_usd} to $${plan.price_usd}`);
        }

        if (existing.max_seats !== plan.max_seats) {
            changes.push(
                `seats ${existing.max_seats ?? "unlimited"} to ${plan.max_seats ?? "unlimited"}`
            );
        }

        if (existing.name !== plan.name) {
            changes.push(`renamed from ${existing.name}`);
        }

        if (existing.is_public !== plan.is_public) {
            changes.push(plan.is_public ? "shown on the pricing page" : "hidden from the pricing page");
        }

        await logPlatformActivity(
            tx,
            {
                entityType: "plan",
                entityId: id,
                action: "updated",
                summary:
                    changes.length > 0
                        ? `Changed the ${plan.name} plan: ${changes.join(", ")}`
                        : `Edited the ${plan.name} plan`,
            },
            user
        );

        return plan;
    });
};
