import { Request, Response } from "express";
import status from "http-status";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import catchAsync from "../../shared/catchAsync.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { DashboardService } from "./dashboard.service.js";

const getOverview = catchAsync(async (req: Request, res: Response) => {
    const result = await DashboardService.getOverview(req.user as IRequestUser);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Dashboard retrieved successfully",
        data: result,
    });
});

export const DashboardController = { getOverview };
