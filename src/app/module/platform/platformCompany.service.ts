import status from "http-status";
import { Role, SubscriptionStatus } from "../../../generated/prisma/enums.js";
import AppError from "../../errorHelpers/AppError.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { prisma } from "../../lib/prisma.js";
import { seedLeadSources } from "../../shared/defaultLeadSources.js";
import { seedLeaveTypes } from "../../shared/defaultLeaveTypes.js";
import { seedRolePermissions } from "../../shared/defaultPermissions.js";
import { seedWorkflowStatuses } from "../../shared/defaultWorkflowStatuses.js";
import { logPlatformActivity } from "../../shared/platformActivity.js";
import { passwordUtils } from "../../utils/password.js";
import { ICreateCompanyPayload } from "./platform.validation.js";
import { sameEmail } from "../../shared/emailField.js";
import { PLAN_FIELDS } from "./platformPlan.service.js";

/**
 * The platform's view of its customers.
 *
 * The rule that shapes every query here: **super_admin can see that a company
 * exists, how big it is, and what it pays - and nothing about its money.** No
 * balances, no payments, no client names, no vault. Provisioning a workspace
 * is not a licence to read the books of the business inside it, and the
 * boundary is easier to keep if the queries never select those columns at all.
 */

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
export const getCompanies = async (filters: { status?: SubscriptionStatus; search?: string } = {}) => {
    const organizations = await prisma.organization.findMany({
        where: {
            ...(filters.status ? { subscription: { status: filters.status } } : {}),
            ...(filters.search
                ? {
                    OR: [
                        { name: { contains: filters.search, mode: "insensitive" } },
                        { email: { contains: filters.search, mode: "insensitive" } },
                        // Searching by the person you sell to, which is
                        // usually how an operator remembers a customer.
                        {
                            users: {
                                some: {
                                    role: Role.admin,
                                    deleted_at: null,
                                    OR: [
                                        { full_name: { contains: filters.search, mode: "insensitive" } },
                                        { email: { contains: filters.search, mode: "insensitive" } },
                                    ],
                                },
                            },
                        },
                    ],
                }
                : {}),
        },
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
            // The person this was sold to. Name and email only - not the whole
            // staff list, which would be every customer's people on one
            // screen and is not what running a platform needs.
            users: {
                where: { role: Role.admin, deleted_at: null },
                select: { id: true, full_name: true, email: true, status: true },
                orderBy: { created_at: "asc" },
                take: 1,
            },
            // Counts only. Deliberately no clients, no accounts, no payments -
            // see the note at the top of this file.
            _count: { select: { users: true, projects: true } },
        },
        orderBy: { created_at: "desc" },
    });

    // When each company was last used, from its own activity log. One grouped
    // query rather than one per company, and it is the closest honest signal
    // to "are they still here" - a company that has not written a row in six
    // weeks has probably stopped, whatever their subscription says.
    const lastSeen = await prisma.activityLog.groupBy({
        by: ["organization_id"],
        where: { organization_id: { in: organizations.map((row) => row.id) } },
        _max: { created_at: true },
    });

    const lastSeenBy = new Map(
        lastSeen.map((row) => [row.organization_id, row._max.created_at])
    );

    return organizations.map((organization) => ({
        id: organization.id,
        name: organization.name,
        email: organization.email,
        created_at: organization.created_at,
        subscription: organization.subscription,
        // Null when nothing has ever been recorded. Different from "a long
        // time ago", and the screen says so rather than showing a date that
        // does not exist.
        last_active_at: lastSeenBy.get(organization.id) ?? null,
        admin: organization.users[0] ?? null,
        usage: {
            seats_used: organization._count.users,
            projects_used: organization._count.projects,
            seats_limit: organization.subscription?.plan.max_seats ?? null,
            projects_limit: organization.subscription?.plan.max_projects ?? null,
        },
    }));
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
export const createCompany = async (payload: ICreateCompanyPayload, user: IRequestUser) => {
    const existingUser = await prisma.user.findFirst({
        where: { email: sameEmail(payload.admin_email) },
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
    //
    // Deliberately NOT the platform default plan: that setting is about a
    // company signing itself up. This form is somebody provisioning a customer
    // who already agreed a price, and the price they agreed is the one typed
    // in, not whatever the sign-up page happens to offer this week.
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
        await seedWorkflowStatuses(tx, organization.id);
        await seedLeaveTypes(tx, organization.id);
        await seedRolePermissions(tx, organization.id);

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
export const getOverview = async () => {
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
