import { KpiMetric } from "../../../generated/prisma/enums.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { prisma } from "../../lib/prisma.js";
import { type Range } from "./kpi.range.js";
import {
    attainment,
    availableHours,
    onTimeDelivery,
    planVsActual,
    projectMargin,
    scopeChange,
    utilization,
} from "./kpi.formulas.js";
import { num, loadTargets, targetOf, loadHours, loadCapacity } from "./kpi.loaders.js";

/**
 * Delivery: is the work landing when it was promised, at the size it was sold.
 */
export const deliveryScope = async (user: IRequestUser, range: Range) => {
    const targets = await loadTargets(user.organizationId, range, null);

    const [delivered, overdue, projects, hours, capacity] = await Promise.all([
        prisma.projectMilestone.findMany({
            where: {
                organization_id: user.organizationId,
                deleted_at: null,
                submitted_at: { not: null, gte: range.from, lte: range.to },
            },
            select: { due_date: true, submitted_at: true, accepted_at: true },
        }),
        prisma.projectMilestone.count({
            where: {
                organization_id: user.organizationId,
                deleted_at: null,
                submitted_at: null,
                due_date: { lt: new Date() },
            },
        }),
        prisma.project.findMany({
            where: {
                organization_id: user.organizationId,
                deleted_at: null,
                baseline_set_at: { not: null },
            },
            select: {
                id: true,
                name: true,
                code: true,
                contract_value_usd: true,
                baseline_hours: true,
                baseline_value_usd: true,
            },
        }),
        loadHours(user.organizationId, range),
        loadCapacity(user.organizationId),
    ]);

    let onTimeCount = 0;
    for (const milestone of delivered) {
        // Compared on the day, not the instant: a milestone due on the 20th and
        // submitted at 6pm on the 20th is on time.
        const due = Date.UTC(
            milestone.due_date.getUTCFullYear(),
            milestone.due_date.getUTCMonth(),
            milestone.due_date.getUTCDate()
        );
        const submitted = milestone.submitted_at as Date;
        const submittedDay = Date.UTC(
            submitted.getUTCFullYear(),
            submitted.getUTCMonth(),
            submitted.getUTCDate()
        );
        if (submittedDay <= due) onTimeCount += 1;
    }

    // Actual hours per baselined project, so plan-vs-actual can be per project
    // rather than a single agency average that hides the one overrun.
    const actualByProject =
        projects.length > 0
            ? await prisma.timeEntry.groupBy({
                by: ["project_id"],
                where: {
                    organization_id: user.organizationId,
                    deleted_at: null,
                    project_id: { in: projects.map((project) => project.id) },
                },
                _sum: { hours: true },
            })
            : [];

    const actualBy = new Map(actualByProject.map((row) => [row.project_id, num(row._sum.hours)]));

    // Margin per project, in BDT for the same reason as everywhere else: costs
    // exist only in BDT, so that is the only currency both sides are real in.
    // Over the project's whole life, not the window - a project's margin is not
    // a property of the month you happen to be looking at.
    const projectIds = projects.map((project) => project.id);
    const lifetime = { organization_id: user.organizationId, deleted_at: null };

    const [projectIncome, projectExpenses, projectPayouts] =
        projectIds.length > 0
            ? await Promise.all([
                prisma.payment.groupBy({
                    by: ["project_id"],
                    where: { ...lifetime, project_id: { in: projectIds } },
                    _sum: { amount_bdt_reporting: true },
                }),
                prisma.expense.groupBy({
                    by: ["project_id"],
                    where: { ...lifetime, project_id: { in: projectIds } },
                    _sum: { amount_bdt: true },
                }),
                prisma.teamPayout.groupBy({
                    by: ["project_id"],
                    where: { ...lifetime, project_id: { in: projectIds } },
                    _sum: { amount_bdt: true },
                }),
            ])
            : [[], [], []];

    const incomeBy = new Map(
        projectIncome.map((row) => [row.project_id, num(row._sum.amount_bdt_reporting)])
    );
    const costBy = new Map<string, number>();
    for (const row of projectExpenses) {
        costBy.set(row.project_id ?? "", (costBy.get(row.project_id ?? "") ?? 0) + num(row._sum.amount_bdt));
    }
    for (const row of projectPayouts) {
        costBy.set(row.project_id ?? "", (costBy.get(row.project_id ?? "") ?? 0) + num(row._sum.amount_bdt));
    }

    const projectRows = projects.map((project) => ({
        id: project.id,
        name: project.name,
        code: project.code,
        plan_vs_actual_pct: planVsActual(
            actualBy.get(project.id) ?? 0,
            num(project.baseline_hours)
        ),
        scope_change_pct: scopeChange(
            num(project.contract_value_usd),
            num(project.baseline_value_usd)
        ),
        margin_pct: projectMargin(incomeBy.get(project.id) ?? 0, costBy.get(project.id) ?? 0),
        actual_hours: actualBy.get(project.id) ?? 0,
        baseline_hours: num(project.baseline_hours),
    }));

    // Hours and cost per department, over the window.
    //
    // Grouped through the person rather than stored on the row: a department
    // is a fact about somebody, and it moves when they move. Grouping in two
    // steps because neither timeEntry nor teamPayout can group by a field on
    // a relation.
    //
    // People with no department get a row of their own rather than being
    // dropped. Silently omitting them would make the departments add up to
    // less than the agency and give no clue why.
    const [departments, hoursByUser, payoutsByUser] = await Promise.all([
        prisma.department.findMany({
            where: { organization_id: user.organizationId },
            select: {
                id: true,
                name: true,
                members: { where: { deleted_at: null }, select: { id: true } },
            },
            orderBy: { name: "asc" },
        }),
        prisma.timeEntry.groupBy({
            by: ["user_id"],
            where: {
                organization_id: user.organizationId,
                deleted_at: null,
                date: { gte: range.from, lte: range.to },
            },
            _sum: { hours: true },
        }),
        prisma.teamPayout.groupBy({
            by: ["user_id"],
            where: {
                organization_id: user.organizationId,
                deleted_at: null,
                date: { gte: range.from, lte: range.to },
            },
            _sum: { amount_bdt: true },
        }),
    ]);

    const hoursOf = new Map(hoursByUser.map((row) => [row.user_id, num(row._sum.hours)]));
    const paidOf = new Map(payoutsByUser.map((row) => [row.user_id, num(row._sum.amount_bdt)]));
    const placed = new Set<string>();

    const departmentRows = departments.map((department) => {
        let hoursLogged = 0;
        let paidBdt = 0;

        for (const member of department.members) {
            placed.add(member.id);
            hoursLogged += hoursOf.get(member.id) ?? 0;
            paidBdt += paidOf.get(member.id) ?? 0;
        }

        return {
            id: department.id as string | null,
            name: department.name,
            people: department.members.length,
            hours_logged: hoursLogged,
            paid_bdt: paidBdt,
        };
    });

    const looseIds = new Set([...hoursOf.keys(), ...paidOf.keys()].filter((id) => !placed.has(id)));

    if (looseIds.size > 0) {
        let hoursLogged = 0;
        let paidBdt = 0;

        for (const id of looseIds) {
            hoursLogged += hoursOf.get(id) ?? 0;
            paidBdt += paidOf.get(id) ?? 0;
        }

        departmentRows.push({
            id: null,
            name: "No department",
            people: looseIds.size,
            hours_logged: hoursLogged,
            paid_bdt: paidBdt,
        });
    }

    const available = availableHours(capacity.weeklyHours, range.days);

    return {
        leading: {
            free_capacity_hours: Math.max(0, available - hours.total),
            overdue_milestones: overdue,
            utilization_pct: attainment(
                utilization(hours.billable, available),
                targetOf(targets, KpiMetric.utilization_pct)
            ),
        },
        lagging: {
            on_time_delivery_pct: attainment(
                onTimeDelivery(onTimeCount, delivered.length),
                targetOf(targets, KpiMetric.on_time_delivery_pct)
            ),
            milestones_delivered: delivered.length,
            milestones_on_time: onTimeCount,
            // Submitted and never signed off. Delivered is not done, and this
            // is the number that says how much is sitting on a client's desk.
            awaiting_acceptance: delivered.filter((milestone) => !milestone.accepted_at).length,
        },
        projects: projectRows,
        by_department: departmentRows,
        context: {
            available_hours: available,
            logged_hours: hours.total,
            baselined_projects: projects.length,
        },
    };
};
