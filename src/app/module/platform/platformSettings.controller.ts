import { Request, Response } from "express";
import status from "http-status";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import catchAsync from "../../shared/catchAsync.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { PlatformSettingsService } from "./platformSettings.service.js";

const getSettings = catchAsync(async (_req: Request, res: Response) => {
    const result = await PlatformSettingsService.getSettings();
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Settings retrieved successfully",
        data: result,
    });
});

const updateSettings = catchAsync(async (req: Request, res: Response) => {
    const result = await PlatformSettingsService.updateSettings(
        req.user as IRequestUser,
        req.body
    );
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Settings saved successfully",
        data: result,
    });
});

export const PlatformSettingsController = { getSettings, updateSettings };
