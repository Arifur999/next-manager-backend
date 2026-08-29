import status from "http-status";
import { Role, SubscriptionStatus } from "../../../generated/prisma/enums.js";
import AppError from "../../errorHelpers/AppError.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { prisma } from "../../lib/prisma.js";
import { seedLeadSources } from "../../shared/defaultLeadSources.js";
import { logPlatformActivity } from "../../shared/platformActivity.js";
import { passwordUtils } from "../../utils/password.js";
import {
    ICreateCompanyPayload,
    ICreatePlanPayload,
    ISetPlatformPermissionsPayload,
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

const createPlan = async (payload: ICreatePlanPayload, user: IRequestUser) => {
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

const updatePlan = async (id: string, payload: IUpdatePlanPayload, user: IRequestUser) => {
    const existing = await prisma.plan.findUnique({
        where: { id },
        select: { id: true, name: true, price_usd: true, max_seats: true },
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
const setSubscription = async (
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

/**
 * Provision a company from the platform side.
 *
 * The self-serve route already creates a company and its first admin together;
 * so does this, for the same reason - a workspace nobody can sign in to is not
 * a workspace. What is different is that the operator chooses the plan and the
 * trial, rather than the company landing on whatever the default is.
 *
 * One transaction. A half-created company - an organization with no admin, or
 * an admin with no subscription - is a support ticket rather than a state
 * anybody would notice.
 */
const createCompany = async (payload: ICreateCompanyPayload, user: IRequestUser) => {
    const existingUser = await prisma.user.findUnique({
        where: { email: payload.admin_email },
        select: { id: true },
    });

    if (existingUser) {
        throw new AppError(
            status.CONFLICT,
            "That email already has an account. One address cannot admin two companies."
        );
    }

    // Chosen, or the cheapest active one - never nothing. A company with no
    // subscription row passes every check, which is right for a workspace
    // predating billing and wrong for one created after it.
    const plan = payload.plan_id
        ? await prisma.plan.findUnique({ where: { id: payload.plan_id }, select: { id: true } })
        : await prisma.plan.findFirst({
            where: { is_active: true },
            orderBy: { sort_order: "asc" },
            select: { id: true },
        });

    if (!plan) {
        throw new AppError(
            status.BAD_REQUEST,
            payload.plan_id ? "Plan not found" : "No active plan exists to put this company on"
        );
    }

    const hashedPassword = await passwordUtils.hashPassword(payload.admin_password);
    const trialEndsAt = payload.trial_days
        ? new Date(Date.now() + payload.trial_days * 24 * 60 * 60 * 1000)
        : null;

    return prisma.$transaction(async (tx) => {
        const organization = await tx.organization.create({
            data: { name: payload.name, email: payload.email ?? payload.admin_email },
        });

        await seedLeadSources(tx, organization.id);

        const admin = await tx.user.create({
            data: {
                full_name: payload.admin_name,
                email: payload.admin_email,
                password: hashedPassword,
                role: Role.admin,
                organization_id: organization.id,
                email_verified: true,
            },
            select: { id: true, full_name: true, email: true, role: true },
        });

        const subscription = await tx.subscription.create({
            data: {
                organization_id: organization.id,
                plan_id: plan.id,
                status: trialEndsAt ? SubscriptionStatus.trialing : SubscriptionStatus.active,
                trial_ends_at: trialEndsAt,
                notes: "Created from the platform console.",
            },
            include: { plan: { select: PLAN_FIELDS } },
        });

        await logPlatformActivity(
            tx,
            {
                entityType: "company",
                entityId: organization.id,
                action: "created",
                summary: `Created ${organization.name} on ${subscription.plan.name}, admin ${admin.email}`,
            },
            user
        );

        return { organization, admin, subscription };
    });
};

/**
 * The numbers the operator opens the console to see.
 *
 * Monthly revenue counts trialing and cancelled companies as zero rather than
 * leaving them out: a trial is worth nothing yet and a cancellation is worth
 * nothing any more, and both facts are more useful than a total that quietly
 * ignores them. `past_due` IS counted - the money is owed, and treating it as
 * gone the day a card fails hides the thing worth chasing.
 */
const getOverview = async () => {
    const now = new Date();
    const inSevenDays = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const [byStatus, subscriptions, endingSoon, newestCompanies, totalCompanies] =
        await Promise.all([
            prisma.subscription.groupBy({ by: ["status"], _count: { _all: true } }),
            prisma.subscription.findMany({
                where: {
                    status: {
                        in: [
                            SubscriptionStatus.active,
                            SubscriptionStatus.past_due,
                        ],
                    },
                },
                select: { plan: { select: { price_usd: true } } },
            }),
            // What the operator acts on today: trials about to lapse and
            // periods about to end.
            prisma.subscription.findMany({
                where: {
                    OR: [
                        {
                            status: SubscriptionStatus.trialing,
                            trial_ends_at: { gte: now, lte: inSevenDays },
                        },
                        {
                            status: SubscriptionStatus.active,
                            current_period_end: { gte: now, lte: inSevenDays },
                        },
                    ],
                },
                select: {
                    status: true,
                    trial_ends_at: true,
                    current_period_end: true,
                    organization: { select: { id: true, name: true, email: true } },
                    plan: { select: { name: true, price_usd: true } },
                },
                orderBy: [{ trial_ends_at: "asc" }, { current_period_end: "asc" }],
            }),
            prisma.organization.findMany({
                select: {
                    id: true,
                    name: true,
                    created_at: true,
                    subscription: { select: { status: true, plan: { select: { name: true } } } },
                    _count: { select: { users: true } },
                },
                orderBy: { created_at: "desc" },
                take: 5,
            }),
            prisma.organization.count(),
        ]);

    const counts = Object.fromEntries(byStatus.map((row) => [row.status, row._count._all]));
    const mrr = subscriptions.reduce((running, row) => running + row.plan.price_usd.toNumber(), 0);

    return {
        companies: {
            total: totalCompanies,
            // A company with no subscription row is one the platform has not
            // set up. Surfaced rather than folded into a status, because it is
            // the operator's own loose end.
            unprovisioned:
                totalCompanies - byStatus.reduce((running, row) => running + row._count._all, 0),
            trialing: counts[SubscriptionStatus.trialing] ?? 0,
            active: counts[SubscriptionStatus.active] ?? 0,
            past_due: counts[SubscriptionStatus.past_due] ?? 0,
            suspended: counts[SubscriptionStatus.suspended] ?? 0,
            cancelled: counts[SubscriptionStatus.cancelled] ?? 0,
        },
        mrr_usd: Math.round(mrr * 100) / 100,
        ending_soon: endingSoon.map((row) => ({
            organization: row.organization,
            plan: row.plan.name,
            status: row.status,
            ends_at: row.trial_ends_at ?? row.current_period_end,
        })),
        newest: newestCompanies.map((row) => ({
            id: row.id,
            name: row.name,
            created_at: row.created_at,
            status: row.subscription?.status ?? null,
            plan: row.subscription?.plan.name ?? null,
            seats: row._count.users,
        })),
    };
};

/**
 * What the platform team has been doing.
 *
 * Read-only, like the company audit log and for the same reason: a history
 * somebody can edit answers no question worth asking. There is no update and
 * no delete here, not even for the operator who wrote the entry.
 */
const getActivity = async (filters: { entityType?: string; actorId?: string }, limit = 100) =>
    prisma.platformActivityLog.findMany({
        where: {
            ...(filters.entityType ? { entity_type: filters.entityType } : {}),
            ...(filters.actorId ? { actor_id: filters.actorId } : {}),
        },
        select: {
            id: true,
            entity_type: true,
            entity_id: true,
            action: true,
            summary: true,
            created_at: true,
            // Null once the operator is gone - the entry outlives them.
            actor: { select: { id: true, full_name: true, email: true } },
        },
        orderBy: { created_at: "desc" },
        take: Math.min(limit, 500),
    });

// ---------------------------------------------------------------------------
// The platform team
// ---------------------------------------------------------------------------

const ADMIN_FIELDS = {
    id: true,
    full_name: true,
    email: true,
    permissions: true,
    status: true,
    created_at: true,
} as const;

const getAdmins = async () =>
    prisma.user.findMany({
        where: { role: Role.super_admin, deleted_at: null },
        select: ADMIN_FIELDS,
        orderBy: { created_at: "asc" },
    });

/**
 * Set what one operator may do.
 *
 * An empty list means "everything", not "nothing" - that is the hatch in
 * requirePermission, and it is what keeps the first operator from locking
 * themselves out on the day this shipped. The screen has to say so, because
 * the opposite reading is the obvious one.
 *
 * Two guards, both about not stranding the platform:
 */
const setPermissions = async (
    id: string,
    payload: ISetPlatformPermissionsPayload,
    user: IRequestUser
) => {
    const target = await prisma.user.findFirst({
        where: { id, role: Role.super_admin, deleted_at: null },
        select: { id: true, full_name: true, email: true, permissions: true },
    });

    if (!target) {
        throw new AppError(status.NOT_FOUND, "Platform admin not found");
    }

    const nextGrantsAdminManage =
        payload.permissions.length === 0 || payload.permissions.includes("platform.admins.manage");

    if (!nextGrantsAdminManage) {
        // Somebody has to be able to hand permissions out. If this change would
        // leave nobody who can, the platform is stuck with whatever it has -
        // and the fix would be a database edit.
        const others = await prisma.user.count({
            where: {
                role: Role.super_admin,
                deleted_at: null,
                id: { not: id },
                OR: [
                    { permissions: { isEmpty: true } },
                    { permissions: { has: "platform.admins.manage" } },
                ],
            },
        });

        if (others === 0) {
            throw new AppError(
                status.CONFLICT,
                "This is the only account that can manage the platform team. Give somebody else that permission first."
            );
        }
    }

    return prisma.$transaction(async (tx) => {
        const updated = await tx.user.update({
            where: { id },
            data: { permissions: payload.permissions },
            select: ADMIN_FIELDS,
        });

        await logPlatformActivity(
            tx,
            {
                entityType: "admin",
                entityId: id,
                action: "updated",
                summary:
                    payload.permissions.length === 0
                        ? `Gave ${target.full_name} full access`
                        : `Set ${target.full_name}'s access to: ${payload.permissions.join(", ")}`,
            },
            user
        );

        return updated;
    });
};

export const PlatformService = {
    getPlans,
    createPlan,
    updatePlan,
    getCompanies,
    setSubscription,
    getMySubscription,
    expireSubscriptions,
    createCompany,
    getOverview,
    getActivity,
    getAdmins,
    setPermissions,
};
