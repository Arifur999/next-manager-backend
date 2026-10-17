import { Request, Response } from "express";
import status from "http-status";
import catchAsync from "../../shared/catchAsync.js";
import { listQuerySchema, paginationMeta } from "../../shared/listQuery.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { OwnerWithdrawalService } from "./ownerWithdrawal.service.js";
import { requireUser } from "../../shared/requireUser.js";
import { idOf, queryOf } from "../../shared/requestSchemas.js";

const getAllWithdrawals = catchAsync(async (req: Request, res: Response) => {
    const options = queryOf(req, listQuerySchema);
    const { rows, total } = await OwnerWithdrawalService.getAllWithdrawals(requireUser(req), options);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Withdrawals retrieved successfully",
        data: rows,
        meta: paginationMeta(options, total),
    });
});

const createWithdrawal = catchAsync(async (req: Request, res: Response) => {
    const result = await OwnerWithdrawalService.createWithdrawal(req.body, requireUser(req));
    sendResponse(res, {
        success: true,
        httpStatus: status.CREATED,
        message: "Withdrawal recorded successfully",
        data: result,
    });
});

const updateWithdrawal = catchAsync(async (req: Request, res: Response) => {
    const result = await OwnerWithdrawalService.updateWithdrawal(idOf(req), req.body, requireUser(req));
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Withdrawal updated successfully",
        data: result,
    });
});

const deleteWithdrawal = catchAsync(async (req: Request, res: Response) => {
    const result = await OwnerWithdrawalService.deleteWithdrawal(idOf(req), requireUser(req));
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Withdrawal deleted successfully",
        data: result,
    });
});

export const OwnerWithdrawalController = {
    getAllWithdrawals,
    createWithdrawal,
    updateWithdrawal,
    deleteWithdrawal,
};
