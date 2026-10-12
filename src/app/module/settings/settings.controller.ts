import { Request, Response } from "express";
import status from "http-status";
import catchAsync from "../../shared/catchAsync.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { SettingsService } from "./settings.service.js";
import { requireUser } from "../../shared/requireUser.js";

const getOrganization = catchAsync(async (req: Request, res: Response) => {
    const result = await SettingsService.getOrganization(requireUser(req));
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Organization retrieved successfully",
        data: result,
    });
});

const updateOrganization = catchAsync(async (req: Request, res: Response) => {
    const result = await SettingsService.updateOrganization(req.body, requireUser(req));
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Organization updated successfully",
        data: result,
    });
});

const getRateSettings = catchAsync(async (req: Request, res: Response) => {
    const result = await SettingsService.getRateSettings(requireUser(req));
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Exchange rate settings retrieved successfully",
        data: result,
    });
});

const setDefaultRate = catchAsync(async (req: Request, res: Response) => {
    const result = await SettingsService.setDefaultRate(req.body, requireUser(req));
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Default rate updated successfully",
        data: result,
    });
});

const refreshRate = catchAsync(async (req: Request, res: Response) => {
    const result = await SettingsService.refreshRate();
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Exchange rate refreshed successfully",
        data: result,
    });
});

export const SettingsController = {
    getOrganization,
    updateOrganization,
    getRateSettings,
    setDefaultRate,
    refreshRate,
};
