import { Request, Response } from "express";
import status from "http-status";
import catchAsync from "../../shared/catchAsync.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { KpiTargetService } from "./kpiTarget.service.js";
import { idOf, queryOf } from "../../shared/requestSchemas.js";
import { requireUser } from "../../shared/requireUser.js";
import { kpiTargetListQueryZodSchema } from "./kpiTarget.validation.js";

const getAllTargets = catchAsync(async (req: Request, res: Response) => {
    // Not paginated: a company has a handful of targets, not a feed of them.
    const { user_id, metric, period } = queryOf(req, kpiTargetListQueryZodSchema);
    const { rows } = await KpiTargetService.getAllTargets(requireUser(req), {
        userId: user_id,
        metric,
        period,
    });
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Targets retrieved successfully",
        data: rows,
    });
});

const createTarget = catchAsync(async (req: Request, res: Response) => {
    const result = await KpiTargetService.createTarget(req.body, requireUser(req));
    sendResponse(res, {
        success: true,
        httpStatus: status.CREATED,
        message: "Target set successfully",
        data: result,
    });
});

const updateTarget = catchAsync(async (req: Request, res: Response) => {
    const result = await KpiTargetService.updateTarget(
        idOf(req),
        req.body,
        requireUser(req)
    );
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Target updated successfully",
        data: result,
    });
});

const deleteTarget = catchAsync(async (req: Request, res: Response) => {
    const result = await KpiTargetService.deleteTarget(
        idOf(req),
        requireUser(req)
    );
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: result.message,
        data: result,
    });
});

export const KpiTargetController = {
    getAllTargets,
    createTarget,
    updateTarget,
    deleteTarget,
};
