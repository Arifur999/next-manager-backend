import { Request, Response } from "express";
import status from "http-status";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import catchAsync from "../../shared/catchAsync.js";
import { paginationMeta, parseListOptions } from "../../shared/listQuery.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { TransactionService, isTransactionKind } from "./transaction.service.js";

const getTransactions = catchAsync(async (req: Request, res: Response) => {
    const query = req.query as Record<string, unknown>;
    const options = parseListOptions(query);

    const { rows, total, totals } = await TransactionService.getTransactions(
        req.user as IRequestUser,
        options,
        {
            // An unknown kind is ignored rather than refused: a stale bookmark
            // should show everything, not an error page.
            kind:
                typeof query.kind === "string" && isTransactionKind(query.kind)
                    ? query.kind
                    : undefined,
            accountId: typeof query.account_id === "string" ? query.account_id : undefined,
        }
    );

    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Transactions retrieved successfully",
        data: rows,
        meta: { ...paginationMeta(options, total), totals },
    });
});

export const TransactionController = { getTransactions };
