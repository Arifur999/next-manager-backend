import { Request, Response } from "express";
import status from "http-status";
import { KpiMetric, KpiPeriod } from "../../../generated/prisma/enums.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import catchAsync from "../../shared/catchAsync.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { KpiTargetService } from "./kpiTarget.service.js";

// An unknown metric in the query string widens the view rather than erroring:
// a stale bookmark should still show something.
const parseFilters = (query: Record<string, unknown>) => ({
    userId: typeof query.user_id === "string" ? query.user_id : undefined,
    metric:
        typeof query.metric === "string" && query.metric in KpiMetric
            ? (query.metric as KpiMetric)
            : undefined,
    period:
        typeof query.period === "string" && query.period in KpiPeriod
            ? (query.period as KpiPeriod)
            : undefined,
});

const getAllTargets = catchAsync(async (req: Request, res: Response) => {
    // Not paginated: a company has a handful of targets, not a feed of them.
    const { rows } = await KpiTargetService.getAllTargets(
        req.user as IRequestUser,
        parseFilters(req.query as Record<string, unknown>)
    );
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Targets retrieved successfully",
        data: rows,
    });
});

const createTarget = catchAsync(async (req: Request, res: Response) => {
    const result = await KpiTargetService.createTarget(req.body, req.user as IRequestUser);
    sendResponse(res, {
        success: true,
        httpStatus: status.CREATED,
        message: "Target set successfully",
        data: result,
    });
});

const updateTarget = catchAsync(async (req: Request, res: Response) => {
    const result = await KpiTargetService.updateTarget(
        req.params.id as string,
        req.body,
        req.user as IRequestUser
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
        req.params.id as string,
        req.user as IRequestUser
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
