import status from "http-status";
import { Prisma } from "../../generated/prisma/client.js";
import AppError from "../errorHelpers/AppError.js";

type Tx = Prisma.TransactionClient;

export type LockTarget =
    | { kind: "account" | "payrollRun"; id: string; organizationId: string }
    | { kind: "subscription" | "organizationAdmins"; organizationId: string };

/**
 * SELECT ... FOR UPDATE inside the caller's transaction, so a check-then-write
 * guard cannot be passed by two requests at once. Returns how many rows were
 * locked. A missing account or payroll run is a 404; a company without a
 * subscription (unlimited) locks nothing and returns 0.
 */
export const lockRow = async (tx: Tx, target: LockTarget): Promise<number> => {
    let rows: unknown[];

    switch (target.kind) {
        case "account":
            rows = await tx.$queryRaw`SELECT id FROM accounts WHERE id = ${target.id} AND organization_id = ${target.organizationId} AND deleted_at IS NULL FOR UPDATE`;
            break;
        case "payrollRun":
            rows = await tx.$queryRaw`SELECT id FROM payroll_runs WHERE id = ${target.id} AND organization_id = ${target.organizationId} FOR UPDATE`;
            break;
        case "subscription":
            rows = await tx.$queryRaw`SELECT id FROM subscriptions WHERE organization_id = ${target.organizationId} FOR UPDATE`;
            break;
        case "organizationAdmins":
            rows = await tx.$queryRaw`SELECT id FROM users WHERE organization_id = ${target.organizationId} AND role = 'admin' FOR UPDATE`;
            break;
    }

    if (rows.length === 0 && (target.kind === "account" || target.kind === "payrollRun")) {
        throw new AppError(status.NOT_FOUND, target.kind === "account" ? "Account not found" : "Payroll run not found");
    }

    return rows.length;
};
