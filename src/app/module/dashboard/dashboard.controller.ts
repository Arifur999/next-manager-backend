import { Request, Response } from "express";
import status from "http-status";
import catchAsync from "../../shared/catchAsync.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { DashboardService } from "./dashboard.service.js";
import { requireUser } from "../../shared/requireUser.js";

const getOverview = catchAsync(async (req: Request, res: Response) => {
    const result = await DashboardService.getOverview(requireUser(req));
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Dashboard retrieved successfully",
        data: result,
    });
});

export const DashboardController = { getOverview };
