import status from "http-status";
import { Prisma } from "../../generated/prisma/client.js";
import { WorkflowKind } from "../../generated/prisma/enums.js";
import AppError from "../errorHelpers/AppError.js";
import { prisma } from "../lib/prisma.js";

/**
 * Checks that an id arriving in a request belongs to the caller's company
 * before it is stored. A foreign key only proves the row exists somewhere;
 * without these, one company could attach its records to another's.
 *
 * Each one answers 404 for a foreign or deleted row, so a probe cannot tell
 * "not yours" from "does not exist". An empty id is skipped: the field is
 * optional or being cleared. Run them on create AND update.
 */

type Db = Prisma.TransactionClient | typeof prisma;

export const assertOwnProject = async (db: Db, projectId: string | null | undefined, organizationId: string) => {
    if (!projectId) return;

    const project = await db.project.findFirst({
        where: { id: projectId, organization_id: organizationId, deleted_at: null },
        select: { id: true },
    });
    if (!project) throw new AppError(status.NOT_FOUND, "Project not found");
};

export const assertOwnClient = async (db: Db, clientId: string | null | undefined, organizationId: string) => {
    if (!clientId) return;

    const client = await db.client.findFirst({
        where: { id: clientId, organization_id: organizationId, deleted_at: null },
        select: { id: true },
    });
    if (!client) throw new AppError(status.NOT_FOUND, "Client not found");
};

/** `notFound` keeps each screen's own wording ("Assignee not found", ...). */
export const assertOwnMember = async (
    db: Db,
    userId: string | null | undefined,
    organizationId: string,
    notFound = "Team member not found"
) => {
    if (!userId) return;

    const member = await db.user.findFirst({
        where: { id: userId, organization_id: organizationId, deleted_at: null },
        select: { id: true },
    });
    if (!member) throw new AppError(status.NOT_FOUND, notFound);
};

export const assertOwnService = async (db: Db, serviceId: string | null | undefined, organizationId: string) => {
    if (!serviceId) return;

    const service = await db.service.findFirst({
        where: { id: serviceId, organization_id: organizationId },
        select: { id: true },
    });
    if (!service) throw new AppError(status.NOT_FOUND, "Service not found");
};

/** A status id must be this company's, and on the right board (project or task). */
export const assertOwnStatus = async (db: Db, statusId: string, organizationId: string, kind: WorkflowKind) => {
    const row = await db.workflowStatus.findFirst({
        where: { id: statusId, organization_id: organizationId, kind },
        select: { id: true, category: true },
    });
    if (!row) throw new AppError(status.NOT_FOUND, "That status does not exist on this board");

    return row;
};
