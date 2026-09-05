import { Prisma } from "../../generated/prisma/client.js";
import { defaultPermissionRows } from "./permissionCatalogue.js";

/**
 * The permission template a new agency starts with.
 *
 * Called from EVERY path that creates an organization - self sign-up, the
 * console's create-company form, and accepting an agency invite - beside
 * seedLeadSources, seedWorkflowStatuses and seedLeaveTypes. Missing one is how
 * the LeadSource bug shipped, and here it would be worse: an agency with no
 * permission rows would fall back to the code's own defaults and look fine
 * until somebody opened the screen and found it empty.
 *
 * The rows are transcribed from what the services did BEFORE any of this
 * existed. That is the whole standard for this step: an agency must upgrade
 * into the product it already had, and both permission matrices are the proof
 * - neither is allowed to move.
 */
export const seedRolePermissions = async (
    tx: Prisma.TransactionClient,
    organizationId: string
) =>
    tx.rolePermission.createMany({
        data: defaultPermissionRows().map((row) => ({ ...row, organization_id: organizationId })),
        // Harmless if this ever runs twice for the same agency: the unique index
        // on (organization, role, module, action) is what makes that safe.
        skipDuplicates: true,
    });
