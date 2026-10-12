import { Request, Response } from "express";
import status from "http-status";
import catchAsync from "../../shared/catchAsync.js";
import { paginationMeta } from "../../shared/listQuery.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { ActivityService } from "./activity.service.js";
import { queryOf } from "../../shared/requestSchemas.js";
import { requireUser } from "../../shared/requireUser.js";
import { activityListQueryZodSchema } from "./activity.validation.js";

const getActivity = catchAsync(async (req: Request, res: Response) => {
    const { user_id, entity_type, action, ...options } = queryOf(req, activityListQueryZodSchema);
    const { rows, total } = await ActivityService.getActivity(
        requireUser(req),
        { userId: user_id, entityType: entity_type, action },
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
    const result = await ActivityService.getActivityFilters(requireUser(req));
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Activity filters retrieved successfully",
        data: result,
    });
});

export const ActivityController = { getActivity, getActivityFilters };
