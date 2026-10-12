import { Request, Response } from "express";
import status from "http-status";
import catchAsync from "../../shared/catchAsync.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { PlatformService } from "./platform.service.js";
import { idOf, paramsOf, organizationIdParams, queryOf } from "../../shared/requestSchemas.js";
import { requireUser } from "../../shared/requireUser.js";
import { companyListQueryZodSchema, platformActivityQueryZodSchema } from "./platform.validation.js";

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
    const result = await PlatformService.createPlan(req.body, requireUser(req));
    sendResponse(res, {
        success: true,
        httpStatus: status.CREATED,
        message: "Plan created successfully",
        data: result,
    });
});

const updatePlan = catchAsync(async (req: Request, res: Response) => {
    const result = await PlatformService.updatePlan(
        idOf(req),
        req.body,
        requireUser(req)
    );
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Plan updated successfully",
        data: result,
    });
});

const getCompanies = catchAsync(async (req: Request, res: Response) => {
    const result = await PlatformService.getCompanies(queryOf(req, companyListQueryZodSchema));
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Companies retrieved successfully",
        data: result,
    });
});

const setSubscription = catchAsync(async (req: Request, res: Response) => {
    const result = await PlatformService.setSubscription(
        paramsOf(req, organizationIdParams).organizationId,
        req.body,
        requireUser(req)
    );
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Subscription updated",
        data: result,
    });
});

const getMySubscription = catchAsync(async (req: Request, res: Response) => {
    const result = await PlatformService.getMySubscription(requireUser(req));
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Subscription retrieved successfully",
        data: result,
    });
});

const createCompany = catchAsync(async (req: Request, res: Response) => {
    const result = await PlatformService.createCompany(req.body, requireUser(req));
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

const getActivity = catchAsync(async (req: Request, res: Response) => {
    const query = queryOf(req, platformActivityQueryZodSchema);
    const result = await PlatformService.getActivity(
        { entityType: query.entity_type, actorId: query.actor_id },
        { page: query.page, limit: query.limit }
    );
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Activity retrieved successfully",
        data: result,
    });
});

const getAdmins = catchAsync(async (_req: Request, res: Response) => {
    const result = await PlatformService.getAdmins();
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Platform admins retrieved successfully",
        data: result,
    });
});

const setPermissions = catchAsync(async (req: Request, res: Response) => {
    const result = await PlatformService.setPermissions(
        idOf(req),
        req.body,
        requireUser(req)
    );
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Access updated",
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
    getActivity,
    getAdmins,
    setPermissions,
};
