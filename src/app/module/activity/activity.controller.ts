import { Request, Response } from "express";
import status from "http-status";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import catchAsync from "../../shared/catchAsync.js";
import { paginationMeta, parseListOptions } from "../../shared/listQuery.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { ActivityService } from "./activity.service.js";

const parseFilters = (query: Record<string, unknown>) => ({
    userId: typeof query.user_id === "string" ? query.user_id : undefined,
    entityType: typeof query.entity_type === "string" ? query.entity_type : undefined,
    action: typeof query.action === "string" ? query.action : undefined,
});

const getActivity = catchAsync(async (req: Request, res: Response) => {
    const query = req.query as Record<string, unknown>;
    const options = parseListOptions(query);
    const { rows, total } = await ActivityService.getActivity(
        req.user as IRequestUser,
        parseFilters(query),
        options
    );
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Activity retrieved successfully",
        data: rows,
        meta: paginationMeta(options, total),
    });
});

const getActivityFilters = catchAsync(async (req: Request, res: Response) => {
    const result = await ActivityService.getActivityFilters(req.user as IRequestUser);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Activity filters retrieved successfully",
        data: result,
    });
});

export const ActivityController = { getActivity, getActivityFilters };
