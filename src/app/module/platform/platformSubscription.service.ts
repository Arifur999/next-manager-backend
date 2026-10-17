import status from "http-status";
import { Prisma } from "../../../generated/prisma/client.js";
import { SubscriptionStatus } from "../../../generated/prisma/enums.js";
import AppError from "../../errorHelpers/AppError.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { prisma } from "../../lib/prisma.js";
import { logPlatformActivity } from "../../shared/platformActivity.js";
import { ISetSubscriptionPayload } from "./platform.validation.js";
import { PLAN_FIELDS } from "./platformPlan.service.js";

/**
 * Put a company on a plan, or move it: one upsert for every transition, since a
 * company has exactly one subscription.
 */
export const setSubscription = async (
    organizationId: string,
    payload: ISetSubscriptionPayload,
    user: IRequestUser
) => {
    const [organization, plan, before] = await Promise.all([
        // The name is read for the audit entry, not for the update. "Suspended
        // a4f2-…-9c1b" answers nothing an operator scanning the feed is asking.
        prisma.organization.findUnique({
            where: { id: organizationId },
            select: { id: true, name: true },
        }),
        prisma.plan.findUnique({
            where: { id: payload.plan_id },
            select: { id: true, name: true },
        }),
        prisma.subscription.findUnique({
            where: { organization_id: organizationId },
            select: { status: true, plan: { select: { name: true } } },
        }),
    ]);

    if (!organization) throw new AppError(status.NOT_FOUND, "Company not found");
    if (!plan) throw new AppError(status.NOT_FOUND, "Plan not found");

    const nextStatus = payload.status ?? SubscriptionStatus.active;

    const dates = {
        ...(payload.trial_ends_at !== undefined
            ? { trial_ends_at: payload.trial_ends_at ? new Date(payload.trial_ends_at) : null }
            : {}),
        ...(payload.current_period_end !== undefined
            ? {
                current_period_end: payload.current_period_end
                    ? new Date(payload.current_period_end)
                    : null,
            }
            : {}),
    };

    return prisma.$transaction(async (tx) => {
        const subscription = await tx.subscription.upsert({
            where: { organization_id: organizationId },
            create: {
                organization_id: organizationId,
                plan_id: payload.plan_id,
                status: nextStatus,
                notes: payload.notes ?? "",
                ...dates,
            },
            update: {
                plan_id: payload.plan_id,
                status: nextStatus,
                // Restoring a company clears the cancellation. Leaving it set
                // would show an active subscription with a cancellation date on
                // it, which reads as a bug to whoever looks next.
                ...(nextStatus === SubscriptionStatus.cancelled
                    ? { cancelled_at: new Date() }
                    : { cancelled_at: null }),
                ...(payload.notes !== undefined ? { notes: payload.notes } : {}),
                ...dates,
            },
            include: { plan: { select: PLAN_FIELDS } },
        });

        // Both halves named, because either can move and the two mean very
        // different things: a plan change is commercial, a status change is
        // whether they can work today.
        const moved: string[] = [];

        if (before && before.status !== nextStatus) {
            moved.push(`${before.status} to ${nextStatus}`);
        } else if (!before) {
            moved.push(`set up as ${nextStatus}`);
        }

        if (before && before.plan.name !== plan.name) {
            moved.push(`${before.plan.name} to ${plan.name}`);
        } else if (!before) {
            moved.push(`on ${plan.name}`);
        }

        await logPlatformActivity(
            tx,
            {
                entityType: "subscription",
                entityId: organizationId,
                action: "status_changed",
                summary:
                    moved.length > 0
                        ? `${organization.name}: ${moved.join(", ")}`
                        : `Edited ${organization.name}'s subscription`,
            },
            user
        );

        return subscription;
    });
};

/**
 * What a company can see about its own standing. Any member may read it: "you
 * are out of seats" is useless without being able to look up the limit.
 */
export const getMySubscription = async (user: IRequestUser) => {
    const subscription = await prisma.subscription.findUnique({
        where: { organization_id: user.organizationId },
        include: { plan: { select: PLAN_FIELDS } },
    });

    const [seatsUsed, projectsUsed] = await Promise.all([
        prisma.user.count({ where: { organization_id: user.organizationId, deleted_at: null } }),
        prisma.project.count({ where: { organization_id: user.organizationId, deleted_at: null } }),
    ]);

    return {
        subscription,
        usage: {
            seats_used: seatsUsed,
            projects_used: projectsUsed,
            seats_limit: subscription?.plan.max_seats ?? null,
            projects_limit: subscription?.plan.max_projects ?? null,
        },
    };
};

// ---------------------------------------------------------------------------
// Expiry
// ---------------------------------------------------------------------------

/**
 * The nightly expiry sweep, in two steps: a lapsed trial or period goes
 * past_due, never straight to suspended (that would cut off writes overnight
 * with no warning), then anything past_due beyond the grace window is suspended.
 */
export const GRACE_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The two sweeps' conditions, as data, so a unit test checks the real clauses.
 * `lapsed` runs first; `beyondGrace` then catches anything past_due too long.
 */
export const expiryWhere = (now: Date) => {
    const graceCutoff = new Date(now.getTime() - GRACE_DAYS * DAY_MS);

    return {
        lapsed: {
            OR: [
                { status: SubscriptionStatus.trialing, trial_ends_at: { lt: now } },
                { status: SubscriptionStatus.active, current_period_end: { lt: now } },
            ],
        },
        beyondGrace: {
            status: SubscriptionStatus.past_due,
            OR: [
                { current_period_end: { lt: graceCutoff } },
                { current_period_end: null, trial_ends_at: { lt: graceCutoff } },
            ],
        },
    } satisfies Record<string, Prisma.SubscriptionWhereInput>;
};

export const expireSubscriptions = async (now: Date = new Date()) => {
    const where = expiryWhere(now);

    const lapsed = await prisma.subscription.updateMany({
        where: where.lapsed,
        data: { status: SubscriptionStatus.past_due },
    });

    const suspended = await prisma.subscription.updateMany({
        where: where.beyondGrace,
        data: { status: SubscriptionStatus.suspended },
    });

    return { moved_to_past_due: lapsed.count, suspended: suspended.count };
};
