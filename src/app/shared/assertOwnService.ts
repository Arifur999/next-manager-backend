import status from "http-status";
import { Prisma } from "../../generated/prisma/client.js";
import AppError from "../errorHelpers/AppError.js";
import { IRequestUser } from "../interfaces/requestUser.interface.js";
import { prisma } from "../lib/prisma.js";

/**
 * A service id arriving in a request is checked against the caller's own
 * agency before it is stored.
 *
 * The foreign key only proves the row exists. Without this, one agency could
 * bill against another agency's catalogue entry - and the report of what each
 * service has earned would quietly include somebody else's work.
 */
export const assertOwnService = async (
    tx: Prisma.TransactionClient | typeof prisma,
    serviceId: string | null | undefined,
    user: IRequestUser
) => {
    if (!serviceId) return;

    const service = await tx.service.findFirst({
        where: { id: serviceId, organization_id: user.organizationId },
        select: { id: true },
    });

    if (!service) {
        throw new AppError(status.NOT_FOUND, "Service not found");
    }
};
