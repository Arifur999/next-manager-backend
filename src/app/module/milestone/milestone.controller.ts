import { Request, Response } from "express";
import status from "http-status";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import catchAsync from "../../shared/catchAsync.js";
import { paginationMeta, parseListOptions } from "../../shared/listQuery.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { MilestoneService } from "./milestone.service.js";

const parseFilters = (query: Record<string, unknown>) => ({
    projectId: typeof query.project_id === "string" ? query.project_id : undefined,
    outstanding:
        query.outstanding === "true" ? true : query.outstanding === "false" ? false : undefined,
});

const getAllMilestones = catchAsync(async (req: Request, res: Response) => {
    const query = req.query as Record<string, unknown>;
    const options = parseListOptions(query);
    const { rows, total } = await MilestoneService.getAllMilestones(
        req.user as IRequestUser,
        parseFilters(query),
        options
    );
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Milestones retrieved successfully",
        data: rows,
        meta: paginationMeta(options, total),
    });
});

const createMilestone = catchAsync(async (req: Request, res: Response) => {
    const result = await MilestoneService.createMilestone(req.body, req.user as IRequestUser);
    sendResponse(res, {
        success: true,
        httpStatus: status.CREATED,
        message: "Milestone created successfully",
        data: result,
    });
});

const updateMilestone = catchAsync(async (req: Request, res: Response) => {
    const result = await MilestoneService.updateMilestone(
        req.params.id as string,
        req.body,
        req.user as IRequestUser
    );
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Milestone updated successfully",
        data: result,
    });
});

const submitMilestone = catchAsync(async (req: Request, res: Response) => {
    const result = await MilestoneService.submitMilestone(
        req.params.id as string,
        req.body,
        req.user as IRequestUser
    );
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Milestone submitted",
        data: result,
    });
});

const acceptMilestone = catchAsync(async (req: Request, res: Response) => {
    const result = await MilestoneService.acceptMilestone(
        req.params.id as string,
        req.body,
        req.user as IRequestUser
    );
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Milestone accepted",
        data: result,
    });
});

const reopenMilestone = catchAsync(async (req: Request, res: Response) => {
    const result = await MilestoneService.reopenMilestone(
        req.params.id as string,
        req.user as IRequestUser
    );
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Milestone reopened",
        data: result,
    });
});

const deleteMilestone = catchAsync(async (req: Request, res: Response) => {
    const result = await MilestoneService.deleteMilestone(
        req.params.id as string,
        req.user as IRequestUser
    );
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: result.message,
        data: result,
    });
});

export const MilestoneController = {
    getAllMilestones,
    createMilestone,
    updateMilestone,
    submitMilestone,
    acceptMilestone,
    reopenMilestone,
    deleteMilestone,
};
