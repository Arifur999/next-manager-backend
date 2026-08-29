import status from "http-status";
import { SubscriptionStatus } from "../../../generated/prisma/enums.js";
import AppError from "../../errorHelpers/AppError.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { prisma } from "../../lib/prisma.js";
import {
    ICreatePlanPayload,
    ISetSubscriptionPayload,
    IUpdatePlanPayload,
} from "./platform.validation.js";

/**
 * The platform's view of its customers.
 *
 * The rule that shapes every query here: **super_admin can see that a company
 * exists, how big it is, and what it pays - and nothing about its money.** No
 * balances, no payments, no client names, no vault. Provisioning a workspace
 * is not a licence to read the books of the business inside it, and the
 * boundary is easier to keep if the queries never select those columns at all.
 */

const PLAN_FIELDS = {
    id: true,
    code: true,
    name: true,
    description: true,
    price_usd: true,
    max_seats: true,
    max_projects: true,
    features: true,
    is_active: true,
    sort_order: true,
} as const;

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

const getPlans = async () =>
    prisma.plan.findMany({ select: PLAN_FIELDS, orderBy: { sort_order: "asc" } });

const createPlan = async (payload: ICreatePlanPayload) => {
    const existing = await prisma.plan.findUnique({
        where: { code: payload.code },
        select: { id: true },
    });

    if (existing) {
        throw new AppError(status.CONFLICT, `A plan with the code "${payload.code}" already exists`);
    }

    return prisma.plan.create({
        data: {
            code: payload.code,
            name: payload.name,
            description: payload.description ?? "",
            price_usd: payload.price_usd ?? 0,
            max_seats: payload.max_seats ?? null,
            max_projects: payload.max_projects ?? null,
            features: payload.features ?? [],
            is_active: payload.is_active ?? true,
            sort_order: payload.sort_order ?? 0,
        },
        select: PLAN_FIELDS,
    });
};

const updatePlan = async (id: string, payload: IUpdatePlanPayload) => {
    const existing = await prisma.plan.findUnique({ where: { id }, select: { id: true } });

    if (!existing) {
        throw new AppError(status.NOT_FOUND, "Plan not found");
    }

    return prisma.plan.update({ where: { id }, data: payload, select: PLAN_FIELDS });
};

// ---------------------------------------------------------------------------
// Companies
// ---------------------------------------------------------------------------

/**
 * Every company, with how much of its plan it is using.
 *
 * Seats and projects are counted rather than stored. A stored count is a
 * number that drifts the first time somebody is deactivated outside the one
 * code path that maintains it, and the limit would then be enforced against a
 * figure nobody can reconcile.
 */
const getCompanies = async () => {
    const organizations = await prisma.organization.findMany({
        select: {
            id: true,
            name: true,
            email: true,
            created_at: true,
            subscription: {
                select: {
                    id: true,
                    status: true,
                    trial_ends_at: true,
                    current_period_end: true,
                    cancelled_at: true,
                    notes: true,
                    plan: { select: PLAN_FIELDS },
                },
            },
            // Counts only. Deliberately no clients, no accounts, no payments -
            // see the note at the top of this file.
            _count: { select: { users: true, projects: true } },
        },
        orderBy: { created_at: "desc" },
    });

    return organizations.map((organization) => ({
        id: organization.id,
        name: organization.name,
        email: organization.email,
        created_at: organization.created_at,
        subscription: organization.subscription,
        usage: {
            seats_used: organization._count.users,
            projects_used: organization._count.projects,
            seats_limit: organization.subscription?.plan.max_seats ?? null,
            projects_limit: organization.subscription?.plan.max_projects ?? null,
        },
    }));
};

/**
 * Put a company on a plan, or move it.
 *
 * One endpoint for every transition the platform makes. Upsert rather than
 * create-or-update by hand, because the unique index means a company has
 * exactly one subscription and the two branches would only differ in which
 * error they threw.
 */
const setSubscription = async (organizationId: string, payload: ISetSubscriptionPayload) => {
    const [organization, plan] = await Promise.all([
        prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true } }),
        prisma.plan.findUnique({ where: { id: payload.plan_id }, select: { id: true } }),
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

    return prisma.subscription.upsert({
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
};

/**
 * What a company can see about its own standing.
 *
 * Readable by anyone signed in, not just admin: "you are out of seats" is a
 * message a project manager can hit, and it is useless without being able to
 * look up what the limit actually is.
 */
const getMySubscription = async (user: IRequestUser) => {
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
 * Move subscriptions whose date has passed.
 *
 * Run nightly, and exported so it can be called directly by a test rather than
 * waiting for a cron to fire.
 *
 * Two steps, in order, because they are different transitions:
 *
 *   1. A trial that ran out goes `past_due`, not `suspended`. There is a
 *      difference between "your card has not gone through" and "we have cut
 *      you off", and skipping the middle state means a company loses write
 *      access overnight with no warning.
 *   2. Anything that has been `past_due` beyond the grace window is suspended.
 */
const GRACE_DAYS = 7;

const expireSubscriptions = async (now: Date = new Date()) => {
    const graceCutoff = new Date(now.getTime() - GRACE_DAYS * 24 * 60 * 60 * 1000);

    const lapsed = await prisma.subscription.updateMany({
        where: {
            OR: [
                { status: SubscriptionStatus.trialing, trial_ends_at: { lt: now } },
                { status: SubscriptionStatus.active, current_period_end: { lt: now } },
            ],
        },
        data: { status: SubscriptionStatus.past_due },
    });

    const suspended = await prisma.subscription.updateMany({
        where: {
            status: SubscriptionStatus.past_due,
            OR: [
                { current_period_end: { lt: graceCutoff } },
                { current_period_end: null, trial_ends_at: { lt: graceCutoff } },
            ],
        },
        data: { status: SubscriptionStatus.suspended },
    });

    return { moved_to_past_due: lapsed.count, suspended: suspended.count };
};

export const PlatformService = {
    getPlans,
    createPlan,
    updatePlan,
    getCompanies,
    setSubscription,
    getMySubscription,
    expireSubscriptions,
};
