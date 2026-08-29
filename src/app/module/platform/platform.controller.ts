import { Request, Response } from "express";
import status from "http-status";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import catchAsync from "../../shared/catchAsync.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { PlatformService } from "./platform.service.js";

const getPlans = catchAsync(async (_req: Request, res: Response) => {
    const result = await PlatformService.getPlans();
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Plans retrieved successfully",
        data: result,
    });
});

const createPlan = catchAsync(async (req: Request, res: Response) => {
    const result = await PlatformService.createPlan(req.body);
    sendResponse(res, {
        success: true,
        httpStatus: status.CREATED,
        message: "Plan created successfully",
        data: result,
    });
});

const updatePlan = catchAsync(async (req: Request, res: Response) => {
    const result = await PlatformService.updatePlan(req.params.id as string, req.body);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Plan updated successfully",
        data: result,
    });
});

const getCompanies = catchAsync(async (_req: Request, res: Response) => {
    const result = await PlatformService.getCompanies();
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Companies retrieved successfully",
        data: result,
    });
});

const setSubscription = catchAsync(async (req: Request, res: Response) => {
    const result = await PlatformService.setSubscription(
        req.params.organizationId as string,
        req.body
    );
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Subscription updated",
        data: result,
    });
});

const getMySubscription = catchAsync(async (req: Request, res: Response) => {
    const result = await PlatformService.getMySubscription(req.user as IRequestUser);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Subscription retrieved successfully",
        data: result,
    });
});

const createCompany = catchAsync(async (req: Request, res: Response) => {
    const result = await PlatformService.createCompany(req.body);
    sendResponse(res, {
        success: true,
        httpStatus: status.CREATED,
        message: "Company created",
        data: result,
    });
});

const getOverview = catchAsync(async (_req: Request, res: Response) => {
    const result = await PlatformService.getOverview();
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Overview retrieved successfully",
        data: result,
    });
});

export const PlatformController = {
    getPlans,
    createPlan,
    updatePlan,
    getCompanies,
    setSubscription,
    getMySubscription,
    createCompany,
    getOverview,
};
