import { Request, Response } from "express";
import status from "http-status";
import catchAsync from "../../shared/catchAsync.js";
import { paginationMeta } from "../../shared/listQuery.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { TransactionService } from "./transaction.service.js";
import { requireUser } from "../../shared/requireUser.js";
import { queryOf } from "../../shared/requestSchemas.js";
import { transactionListQueryZodSchema } from "./transaction.validation.js";

const getTransactions = catchAsync(async (req: Request, res: Response) => {
    const { kind, account_id, ...options } = queryOf(req, transactionListQueryZodSchema);
    const { rows, total, totals } = await TransactionService.getTransactions(
        requireUser(req),
        options,
        { kind, accountId: account_id }
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
