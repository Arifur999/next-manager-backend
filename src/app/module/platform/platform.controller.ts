import { Request, Response } from "express";
import status from "http-status";
import { SubscriptionStatus } from "../../../generated/prisma/enums.js";
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
    const result = await PlatformService.createPlan(req.body, req.user as IRequestUser);
    sendResponse(res, {
        success: true,
        httpStatus: status.CREATED,
        message: "Plan created successfully",
        data: result,
    });
});

const updatePlan = catchAsync(async (req: Request, res: Response) => {
    const result = await PlatformService.updatePlan(
        req.params.id as string,
        req.body,
        req.user as IRequestUser
    );
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Plan updated successfully",
        data: result,
    });
});

const getCompanies = catchAsync(async (req: Request, res: Response) => {
    const query = req.query as Record<string, unknown>;
    const result = await PlatformService.getCompanies({
        // An unknown status widens the view rather than erroring - a stale
        // bookmark should still show something.
        status:
            typeof query.status === "string" && query.status in SubscriptionStatus
                ? (query.status as SubscriptionStatus)
                : undefined,
        search: typeof query.search === "string" ? query.search.trim() || undefined : undefined,
    });
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
        req.body,
        req.user as IRequestUser
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
    const result = await PlatformService.createCompany(req.body, req.user as IRequestUser);
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
    const query = req.query as Record<string, unknown>;
    const result = await PlatformService.getActivity(
        {
            entityType: typeof query.entity_type === "string" ? query.entity_type : undefined,
            actorId: typeof query.actor_id === "string" ? query.actor_id : undefined,
        },
        typeof query.limit === "string" ? Number(query.limit) || 100 : 100
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
        req.params.id as string,
        req.body,
        req.user as IRequestUser
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
