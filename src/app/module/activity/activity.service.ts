import { Prisma } from "../../../generated/prisma/client.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { prisma } from "../../lib/prisma.js";
import { dateRangeWhere, pageSlice, type ListOptions } from "../../shared/listQuery.js";

/**
 * Reading the audit trail.
 *
 * The rows have been written since the first module shipped and there was no
 * way to read them - an audit trail nobody can open is a log file, not an
 * audit trail. This is the read side.
 *
 * Deliberately read-only. There is no update and no delete, not even for an
 * admin: a history somebody can edit answers no question worth asking, and the
 * one thing this exists for is being able to say what actually happened.
 */

const INCLUDE = {
    user: { select: { id: true, full_name: true, email: true, avatar_url: true } },
} as const;

const getActivity = async (
    user: IRequestUser,
    filters: { userId?: string; entityType?: string; action?: string },
    options: ListOptions = {}
) => {
    const where: Prisma.ActivityLogWhereInput = {
        organization_id: user.organizationId,
        ...dateRangeWhere(options, "created_at"),
        ...(filters.userId ? { user_id: filters.userId } : {}),
        ...(filters.entityType ? { entity_type: filters.entityType } : {}),
        ...(filters.action ? { action: filters.action } : {}),
    };

    // Newest first, which is the index's own order.
    const orderBy: Prisma.ActivityLogOrderByWithRelationInput = { created_at: "desc" };
    const slice = pageSlice(options);

    if (!slice) {
        const rows = await prisma.activityLog.findMany({ where, include: INCLUDE, orderBy });
        return { rows, total: rows.length };
    }

    const [rows, total] = await Promise.all([
        prisma.activityLog.findMany({
            where,
            include: INCLUDE,
            orderBy,
            skip: slice.skip,
            take: slice.take,
        }),
        prisma.activityLog.count({ where }),
    ]);

    return { rows, total };
};

/**
 * The entity types and actions actually present, for the filter controls.
 *
 * Read from the data rather than from a hardcoded list, so a module added
 * later shows up in the filter without anybody remembering to add it here.
 */
const getActivityFilters = async (user: IRequestUser) => {
    const [types, actions] = await Promise.all([
        prisma.activityLog.groupBy({
            by: ["entity_type"],
            where: { organization_id: user.organizationId },
            _count: { _all: true },
            orderBy: { entity_type: "asc" },
        }),
        prisma.activityLog.groupBy({
            by: ["action"],
            where: { organization_id: user.organizationId },
            _count: { _all: true },
            orderBy: { action: "asc" },
        }),
    ]);

    return {
        entity_types: types.map((row) => ({ value: row.entity_type, count: row._count._all })),
        actions: actions.map((row) => ({ value: row.action, count: row._count._all })),
    };
};

export const ActivityService = { getActivity, getActivityFilters };
