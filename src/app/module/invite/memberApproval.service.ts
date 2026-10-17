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
 * Let somebody in.
 *
 * **This is where the seat is charged**, not at invite time. A pending person
 * has no access, so billing for them would be billing for nothing - and it
 * would let anybody holding a link exhaust the company's plan.
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
 * Turn somebody down.
 *
 * Soft-deleted and suspended together, the same as removing a member: a row
 * flagged deleted but still active would keep passing checkAuth. The account
 * is kept rather than erased so a second request from the same person is
 * visibly a second request.
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
