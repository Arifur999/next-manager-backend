import { Request } from "express";
import status from "http-status";
import { Role, SubscriptionStatus } from "../../generated/prisma/enums.js";
import AppError from "../errorHelpers/AppError.js";
import { prisma } from "../lib/prisma.js";

/**
 * May this company still write? Called at the end of checkAuth.
 *
 * Deliberately open in three places, each a lockout if closed: super_admin
 * belongs to no company and is the one who fixes a suspended one; reads always
 * pass, so a lapsed company keeps its own books and can see why it is
 * suspended; past_due gets in, because it is the grace window.
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
 * Not an Express middleware: checkAuth runs inside each route definition, so
 * anything mounted around a router would run before req.user exists. Throwing
 * lets checkAuth's own catch hand the error on.
 */
export const enforceSubscription = async (req: Request): Promise<void> => {
    const user = req.user;

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

    // No row yet means a company the platform has not set up. Let through:
    // guessing wrong would lock a paying customer out, and the console shows it.
    if (!subscription) return;

    if (!ALLOWED.includes(subscription.status)) {
        throw new AppError(
            status.PAYMENT_REQUIRED,
            REASONS[subscription.status] ?? "This workspace has no active subscription."
        );
    }
};
