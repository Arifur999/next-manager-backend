import status from "http-status";
import { UserStatus } from "../../../generated/prisma/enums.js";
import AppError from "../../errorHelpers/AppError.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { prisma } from "../../lib/prisma.js";
import { logActivity } from "../../shared/activity.js";
import { assertSeatAvailable } from "../../shared/planLimits.js";
import { IRejectMemberPayload } from "./invite.validation.js";

const findPendingMember = async (id: string, user: IRequestUser) => {
    const member = await prisma.user.findFirst({
        where: {
            id,
            organization_id: user.organizationId,
            deleted_at: null,
            status: UserStatus.pending,
        },
        select: { id: true, full_name: true, email: true, role: true },
    });

    if (!member) {
        throw new AppError(status.NOT_FOUND, "No pending request found for that person");
    }

    return member;
};

/**
 * Let somebody in. The seat is charged here, not at invite time: a pending
 * person has no access, and charging earlier would let a link exhaust the plan.
 */
const approveMember = async (id: string, user: IRequestUser) => {
    const member = await findPendingMember(id, user);

    return prisma.$transaction(async (tx) => {
        await assertSeatAvailable(tx, user.organizationId, { excludingUserId: member.id });

        const approved = await tx.user.update({
            where: { id },
            data: { status: UserStatus.active },
            select: { id: true, full_name: true, email: true, role: true, status: true },
        });

        await logActivity(
            tx,
            {
                entityType: "user",
                entityId: id,
                action: "status_changed",
                summary: `Approved ${member.full_name} as ${member.role}`,
            },
            user,
        );

        return approved;
    });
};

/**
 * Turn somebody down: soft-deleted and suspended together, as when removing a
 * member, since a deleted but active row would still pass checkAuth. Kept, so
 * a second request from the same person shows as one.
 */
const rejectMember = async (id: string, payload: IRejectMemberPayload, user: IRequestUser) => {
    const member = await findPendingMember(id, user);

    await prisma.$transaction(async (tx) => {
        await tx.user.update({
            where: { id },
            data: {
                status: UserStatus.suspended,
                deleted_at: new Date(),
                deleted_by: user.userId,
            },
        });

        await logActivity(
            tx,
            {
                entityType: "user",
                entityId: id,
                action: "deleted",
                summary: payload.reason
                    ? `Turned down ${member.full_name}'s request: ${payload.reason}`
                    : `Turned down ${member.full_name}'s request to join`,
            },
            user,
        );
    });

    return { message: "Request turned down" };
};

export const MemberApprovalService = {
    approveMember,
    rejectMember,
};
