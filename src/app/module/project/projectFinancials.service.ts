import status from "http-status";
import { InvoiceStatus } from "../../../generated/prisma/enums.js";
import AppError from "../../errorHelpers/AppError.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { prisma } from "../../lib/prisma.js";

/**
 * The Finance tab on a project. Profit is in BDT, the one currency both sides
 * exist in (payouts and expenses have no USD figure), with income at each
 * payment's FROZEN reporting rate so a finished project's profit never drifts.
 */
const getProjectFinancials = async (id: string, user: IRequestUser) => {
    const project = await prisma.project.findFirst({
        where: { id, organization_id: user.organizationId, deleted_at: null },
        select: { id: true, contract_value_usd: true },
    });

    if (!project) {
        throw new AppError(status.NOT_FOUND, "Project not found");
    }

    const scope = { project_id: id, organization_id: user.organizationId, deleted_at: null };

    const [received, invoiced, payouts, expenses] = await Promise.all([
        prisma.payment.aggregate({
            where: scope,
            _sum: { amount_usd: true, amount_bdt_reporting: true },
        }),
        prisma.invoice.aggregate({
            where: {
                project_id: id,
                organization_id: user.organizationId,
                deleted_at: null,
                status: { notIn: [InvoiceStatus.draft, InvoiceStatus.cancelled] },
            },
            _sum: { total: true },
        }),
        prisma.teamPayout.aggregate({ where: scope, _sum: { amount_bdt: true } }),
        prisma.expense.aggregate({ where: scope, _sum: { amount_bdt: true } }),
    ]);

    const receivedUsd = received._sum.amount_usd?.toNumber() ?? 0;
    const receivedBdt = received._sum.amount_bdt_reporting?.toNumber() ?? 0;
    const invoicedUsd = invoiced._sum.total?.toNumber() ?? 0;
    const teamCostBdt = payouts._sum.amount_bdt?.toNumber() ?? 0;
    const expenseBdt = expenses._sum.amount_bdt?.toNumber() ?? 0;

    return {
        contract_value_usd: project.contract_value_usd.toNumber(),
        invoiced_usd: invoicedUsd,
        received_usd: receivedUsd,
        // Never negative: an overpayment is a credit to deal with elsewhere,
        // not a negative receivable that would offset another project.
        outstanding_usd: Math.max(invoicedUsd - receivedUsd, 0),
        received_bdt: receivedBdt,
        team_cost_bdt: teamCostBdt,
        expense_bdt: expenseBdt,
        total_cost_bdt: teamCostBdt + expenseBdt,
        // Money actually received, minus money actually spent. Not "contract
        // value minus cost" - unpaid work is not profit.
        profit_bdt: receivedBdt - teamCostBdt - expenseBdt,
    };
};

export const ProjectFinancialsService = { getProjectFinancials };
