import status from "http-status";
import { Prisma } from "../../../generated/prisma/client.js";
import AppError from "../../errorHelpers/AppError.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import type { PermissionScope } from "../../shared/permissionCatalogue.js";
import { resolveScope } from "../../shared/resolveScope.js";

/**
 * Handing a task to somebody is the tasks assign square, apart from editing it:
 * "all" hands it to anybody in the agency, "assigned" to somebody on the task's
 * project, "own" only to yourself, "none" not at all. Clearing the assignee is
 * allowed to any scope but "none".
 */
export const assignRefusal = (
    scope: PermissionScope,
    assignment: { assigneeId: string | null; callerId: string; onProject: boolean }
): string | null => {
    if (scope === "all") return null;
    if (scope === "none") return "You do not have permission for this action. Ask an admin to allow: tasks — assign.";
    if (assignment.assigneeId === null || assignment.assigneeId === assignment.callerId) return null;
    if (scope === "assigned" && assignment.onProject) return null;

    return scope === "assigned"
        ? "You can only hand this task to somebody on its project."
        : "You can only take this task yourself.";
};

const isOnProject = async (tx: Prisma.TransactionClient, projectId: string, userId: string, organizationId: string) =>
    Boolean(
        await tx.projectMember.findFirst({
            where: { project_id: projectId, user_id: userId, organization_id: organizationId },
            select: { id: true },
        })
    );

/** Refuses an assignment the caller's assign scope does not reach, with a 403 naming why. */
export const assertMayAssign = async (
    tx: Prisma.TransactionClient,
    user: IRequestUser,
    task: { projectId: string; assigneeId: string | null }
) => {
    const scope = await resolveScope(user, "tasks", "assign");

    // Only "assigned" needs to know who is on the project, so only it asks.
    const onProject =
        scope === "assigned" &&
        task.assigneeId !== null &&
        (await isOnProject(tx, task.projectId, task.assigneeId, user.organizationId));

    const refusal = assignRefusal(scope, { assigneeId: task.assigneeId, callerId: user.userId, onProject });

    if (refusal) {
        throw new AppError(status.FORBIDDEN, refusal);
    }
};
