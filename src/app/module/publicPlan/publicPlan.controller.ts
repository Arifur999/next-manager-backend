import { Request, Response } from "express";
import status from "http-status";
import catchAsync from "../../shared/catchAsync.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { PublicPlanService } from "./publicPlan.service.js";

const getActivePlans = catchAsync(async (_req: Request, res: Response) => {
    const result = await PublicPlanService.getActivePlans();
    // The same for every visitor and rarely changed, so browsers and the proxy may keep it briefly.
    res.set("Cache-Control", "public, max-age=300");
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Plans retrieved successfully",
        data: result,
    });
});

export const PublicPlanController = { getActivePlans };
