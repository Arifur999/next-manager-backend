import { Request } from "express";
import status from "http-status";
import { SubscriptionStatus } from "../../generated/prisma/enums.js";
import { Role } from "../../generated/prisma/enums.js";
import AppError from "../errorHelpers/AppError.js";
import { IRequestUser } from "../interfaces/requestUser.interface.js";
import { prisma } from "../lib/prisma.js";

/**
 * Is this company still allowed in.
 *
 * Called from the end of checkAuth, which is the only place req.user exists
 * early enough to be useful. See enforceSubscription below for why it is not
 * an Express middleware.
 *
 * Two deliberate holes, each one a lockout waiting to happen if it were closed:
 *
 *   1. **super_admin passes.** They belong to no company, so there is nothing
 *      to check - and they are the person who fixes a suspended company.
 *   2. **Reads pass.** A company whose subscription lapsed can still look at
 *      its own books; what it loses is the ability to write. Locking somebody
 *      out of their own financial records over a card that expired is not a
 *      billing policy, it is holding data hostage. This is also what lets a
 *      suspended company open the screen explaining why it is suspended.
 *
 * `past_due` gets in. It exists precisely to be the grace window between the
 * period ending and access actually stopping.
 */

const ALLOWED: SubscriptionStatus[] = [
    SubscriptionStatus.trialing,
    SubscriptionStatus.active,
    SubscriptionStatus.past_due,
];

const REASONS: Record<string, string> = {
    [SubscriptionStatus.suspended]:
        "This workspace is suspended. Reading still works; contact support to restore access.",
    [SubscriptionStatus.cancelled]:
        "This subscription has been cancelled. Your data is intact - renew to start writing again.",
};

/**
 * Called at the end of checkAuth, once req.user exists.
 *
 * Not an Express middleware, because it cannot be mounted as one: checkAuth
 * runs inside each route definition, so anything wrapped around a sub-router
 * would run before it and have no user to check. Throwing from here lets
 * checkAuth's own catch pass it to the error handler.
 */
export const enforceSubscription = async (req: Request): Promise<void> => {
    const user = req.user as IRequestUser | undefined;

    // checkAuth sets this immediately before calling. No user means the call
    // order changed, which is a bug to fix rather than a request to refuse.
    if (!user) return;

    if (user.role === Role.super_admin) return;

    // Reads are never blocked - a lapsed company keeps access to its own
    // records. See the note above.
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return;

    const subscription = await prisma.subscription.findUnique({
        where: { organization_id: user.organizationId },
        select: { status: true },
    });

    // No subscription row at all means a company the platform has not set up
    // yet. Allowed through rather than blocked: the failure mode of guessing
    // wrong here is locking a paying customer out over a missing row, and the
    // platform console is where that gets noticed instead.
    if (!subscription) return;

    if (!ALLOWED.includes(subscription.status)) {
        throw new AppError(
            status.PAYMENT_REQUIRED,
            REASONS[subscription.status] ?? "This workspace has no active subscription."
        );
    }
};

/**
 * Whether a company can add another person.
 *
 * Called from user.service.ts at the moment of creation rather than checked on
 * the way in, because the count has to be taken inside the same transaction
 * that adds the row - two admins inviting simultaneously against the last free
 * seat would both see room otherwise.
 */
export const assertSeatAvailable = async (organizationId: string): Promise<void> => {
    const subscription = await prisma.subscription.findUnique({
        where: { organization_id: organizationId },
        select: { plan: { select: { name: true, max_seats: true } } },
    });

    // No subscription, or a plan with no ceiling. Null is not zero: a plan
    // with max_seats null is deliberately unlimited.
    if (!subscription || subscription.plan.max_seats === null) {
        return;
    }

    const used = await prisma.user.count({
        where: { organization_id: organizationId, deleted_at: null },
    });

    if (used >= subscription.plan.max_seats) {
        throw new AppError(
            status.PAYMENT_REQUIRED,
            // The plan is named because "seat limit reached" leaves the reader
            // with nowhere to go. Naming the tier says what to change.
            `${subscription.plan.name} includes ${subscription.plan.max_seats} seats and all of them are in use. Upgrade the plan, or deactivate someone first.`
        );
    }
};

/**
 * The same question for projects.
 *
 * Deactivated rather than deleted people still hold a seat; archived projects
 * still hold a project slot. Both are counted the way a customer would count
 * them - what exists, not what is currently busy.
 */
export const assertProjectAvailable = async (organizationId: string): Promise<void> => {
    const subscription = await prisma.subscription.findUnique({
        where: { organization_id: organizationId },
        select: { plan: { select: { name: true, max_projects: true } } },
    });

    if (!subscription || subscription.plan.max_projects === null) {
        return;
    }

    const used = await prisma.project.count({
        where: { organization_id: organizationId, deleted_at: null },
    });

    if (used >= subscription.plan.max_projects) {
        throw new AppError(
            status.PAYMENT_REQUIRED,
            `${subscription.plan.name} includes ${subscription.plan.max_projects} projects and all of them are in use. Upgrade the plan, or delete one first.`
        );
    }
};
