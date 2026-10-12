import { KpiMetric } from "../../../generated/prisma/enums.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { prisma } from "../../lib/prisma.js";
import { type Range } from "./kpi.range.js";
import { attainment, availableHours, onTimeDelivery, utilization } from "./kpi.formulas.js";
import { loadTargets, targetOf, loadHours, loadCapacity } from "./kpi.loaders.js";

/**
 * One person's own numbers.
 *
 * Deliberately narrow. Operations should see what they did and what they owe,
 * not the agency's margin - a number they cannot act on and were not given the
 * context to read.
 */
export const meScope = async (user: IRequestUser, range: Range) => {
    const targets = await loadTargets(user.organizationId, range, user.userId);

    const [hours, capacity, myMilestones, myTasks] = await Promise.all([
        loadHours(user.organizationId, range, user.userId),
        loadCapacity(user.organizationId, user.userId),
        prisma.projectMilestone.findMany({
            where: {
                organization_id: user.organizationId,
                deleted_at: null,
                submitted_at: { not: null, gte: range.from, lte: range.to },
                project: { members: { some: { user_id: user.userId } } },
            },
            select: { due_date: true, submitted_at: true },
        }),
        prisma.task.count({
            where: {
                organization_id: user.organizationId,
                deleted_at: null,
                assignee_id: user.userId,
                completed_at: null,
            },
        }),
    ]);

    const available = availableHours(capacity.weeklyHours, range.days);

    let onTimeCount = 0;
    for (const milestone of myMilestones) {
        const due = Date.UTC(
            milestone.due_date.getUTCFullYear(),
            milestone.due_date.getUTCMonth(),
            milestone.due_date.getUTCDate()
        );
        const submitted = milestone.submitted_at as Date;
        if (
            Date.UTC(
                submitted.getUTCFullYear(),
                submitted.getUTCMonth(),
                submitted.getUTCDate()
            ) <= due
        ) {
            onTimeCount += 1;
        }
    }

    return {
        leading: {
            utilization_pct: attainment(
                utilization(hours.billable, available),
                targetOf(targets, KpiMetric.utilization_pct)
            ),
            billable_hours: attainment(
                { value: hours.billable },
                targetOf(targets, KpiMetric.billable_hours)
            ),
        },
        lagging: {
            on_time_delivery_pct: attainment(
                onTimeDelivery(onTimeCount, myMilestones.length),
                targetOf(targets, KpiMetric.on_time_delivery_pct)
            ),
            open_tasks: myTasks,
        },
        context: {
            available_hours: available,
            logged_hours: hours.total,
            billable_hours: hours.billable,
            // Approval is somebody else's action, so the gap between logged
            // and approved is worth seeing rather than silently absorbing.
            approved_billable_hours: hours.approvedBillable,
            milestones_delivered: myMilestones.length,
        },
    };
};
