import { Request, Response } from "express";
import status from "http-status";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import catchAsync from "../../shared/catchAsync.js";
import { paginationMeta, parseListOptions } from "../../shared/listQuery.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { TeamPayoutService } from "./teamPayout.service.js";

const getAllPayouts = catchAsync(async (req: Request, res: Response) => {
    const options = parseListOptions(req.query as Record<string, unknown>);
    const query = req.query as Record<string, unknown>;
    const { rows, total } = await TeamPayoutService.getAllPayouts(req.user as IRequestUser, options, {
        departmentId: typeof query.department_id === "string" ? query.department_id : undefined,
    });
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Payouts retrieved successfully",
        data: rows,
        meta: paginationMeta(options, total),
    });
});

const createPayout = catchAsync(async (req: Request, res: Response) => {
    const result = await TeamPayoutService.createPayout(req.body, req.user as IRequestUser);
    sendResponse(res, {
        success: true,
        httpStatus: status.CREATED,
        message: "Payout recorded successfully",
        data: result,
    });
});

const updatePayout = catchAsync(async (req: Request, res: Response) => {
    const result = await TeamPayoutService.updatePayout(req.params.id as string, req.body, req.user as IRequestUser);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Payout updated successfully",
        data: result,
    });
});

const deletePayout = catchAsync(async (req: Request, res: Response) => {
    const result = await TeamPayoutService.deletePayout(req.params.id as string, req.user as IRequestUser);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Payout deleted successfully",
        data: result,
    });
});

export const TeamPayoutController = {
    getAllPayouts,
    createPayout,
    updatePayout,
    deletePayout,
};
