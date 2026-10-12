import status from "http-status";
import { Prisma } from "../../generated/prisma/client.js";
import AppError from "../errorHelpers/AppError.js";
import { lockRow } from "../utils/rowLock.js";

type Tx = Prisma.TransactionClient;

/**
 * Whether a company can add another person. Runs inside the transaction that
 * adds the row, after locking the subscription, so two admins cannot both take
 * the last free seat.
 */
export const assertSeatAvailable = async (
    tx: Tx,
    organizationId: string,
    // A pending member being approved already has a row; it must not count against itself.
    { excludingUserId }: { excludingUserId?: string } = {}
): Promise<void> => {
    await lockRow(tx, { kind: "subscription", organizationId });

    const subscription = await tx.subscription.findUnique({
        where: { organization_id: organizationId },
        select: { plan: { select: { name: true, max_seats: true } } },
    });

    // No subscription, or max_seats null: deliberately unlimited.
    if (!subscription || subscription.plan.max_seats === null) {
        return;
    }

    const used = await tx.user.count({
        where: {
            organization_id: organizationId,
            deleted_at: null,
            ...(excludingUserId ? { id: { not: excludingUserId } } : {}),
        },
    });

    if (used >= subscription.plan.max_seats) {
        throw new AppError(
            status.PAYMENT_REQUIRED,
            `${subscription.plan.name} includes ${subscription.plan.max_seats} seats and all of them are in use. Upgrade the plan, or deactivate someone first.`
        );
    }
};

/** The same question for projects. Archived projects still hold a slot. */
export const assertProjectAvailable = async (tx: Tx, organizationId: string): Promise<void> => {
    await lockRow(tx, { kind: "subscription", organizationId });

    const subscription = await tx.subscription.findUnique({
        where: { organization_id: organizationId },
        select: { plan: { select: { name: true, max_projects: true } } },
    });

    if (!subscription || subscription.plan.max_projects === null) {
        return;
    }

    const used = await tx.project.count({
        where: { organization_id: organizationId, deleted_at: null },
    });

    if (used >= subscription.plan.max_projects) {
        throw new AppError(
            status.PAYMENT_REQUIRED,
            `${subscription.plan.name} includes ${subscription.plan.max_projects} projects and all of them are in use. Upgrade the plan, or delete one first.`
        );
    }
};
