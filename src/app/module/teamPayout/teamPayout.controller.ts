import { Request, Response } from "express";
import status from "http-status";
import catchAsync from "../../shared/catchAsync.js";
import { paginationMeta, parseListOptions } from "../../shared/listQuery.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { TeamPayoutService } from "./teamPayout.service.js";
import { requireUser } from "../../shared/requireUser.js";
import { idOf } from "../../shared/requestSchemas.js";

const getAllPayouts = catchAsync(async (req: Request, res: Response) => {
    const options = parseListOptions(req.query as Record<string, unknown>);
    const query = req.query as Record<string, unknown>;
    const { rows, total } = await TeamPayoutService.getAllPayouts(requireUser(req), options, {
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
    const result = await TeamPayoutService.createPayout(req.body, requireUser(req));
    sendResponse(res, {
        success: true,
        httpStatus: status.CREATED,
        message: "Payout recorded successfully",
        data: result,
    });
});

const updatePayout = catchAsync(async (req: Request, res: Response) => {
    const result = await TeamPayoutService.updatePayout(idOf(req), req.body, requireUser(req));
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Payout updated successfully",
        data: result,
    });
});

const deletePayout = catchAsync(async (req: Request, res: Response) => {
    const result = await TeamPayoutService.deletePayout(idOf(req), requireUser(req));
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
