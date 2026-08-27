import { Request, Response } from "express";
import status from "http-status";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import catchAsync from "../../shared/catchAsync.js";
import { paginationMeta, parseListOptions } from "../../shared/listQuery.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { OwnerWithdrawalService } from "./ownerWithdrawal.service.js";

const getAllWithdrawals = catchAsync(async (req: Request, res: Response) => {
    const options = parseListOptions(req.query as Record<string, unknown>);
    const { rows, total } = await OwnerWithdrawalService.getAllWithdrawals(req.user as IRequestUser, options);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Withdrawals retrieved successfully",
        data: rows,
        meta: paginationMeta(options, total),
    });
});

const createWithdrawal = catchAsync(async (req: Request, res: Response) => {
    const result = await OwnerWithdrawalService.createWithdrawal(req.body, req.user as IRequestUser);
    sendResponse(res, {
        success: true,
        httpStatus: status.CREATED,
        message: "Withdrawal recorded successfully",
        data: result,
    });
});

const updateWithdrawal = catchAsync(async (req: Request, res: Response) => {
    const result = await OwnerWithdrawalService.updateWithdrawal(req.params.id as string, req.body, req.user as IRequestUser);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Withdrawal updated successfully",
        data: result,
    });
});

const deleteWithdrawal = catchAsync(async (req: Request, res: Response) => {
    const result = await OwnerWithdrawalService.deleteWithdrawal(req.params.id as string, req.user as IRequestUser);
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
