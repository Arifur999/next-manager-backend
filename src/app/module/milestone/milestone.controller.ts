import { Request, Response } from "express";
import status from "http-status";
import catchAsync from "../../shared/catchAsync.js";
import { paginationMeta } from "../../shared/listQuery.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { MilestoneService } from "./milestone.service.js";
import { idOf, queryOf } from "../../shared/requestSchemas.js";
import { requireUser } from "../../shared/requireUser.js";
import { milestoneListQueryZodSchema } from "./milestone.validation.js";

const getAllMilestones = catchAsync(async (req: Request, res: Response) => {
    const { project_id, outstanding, ...options } = queryOf(req, milestoneListQueryZodSchema);
    const { rows, total } = await MilestoneService.getAllMilestones(
        requireUser(req),
        { projectId: project_id, outstanding },
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
    const result = await MilestoneService.createMilestone(req.body, requireUser(req));
    sendResponse(res, {
        success: true,
        httpStatus: status.CREATED,
        message: "Milestone created successfully",
        data: result,
    });
});

const updateMilestone = catchAsync(async (req: Request, res: Response) => {
    const result = await MilestoneService.updateMilestone(
        idOf(req),
        req.body,
        requireUser(req)
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
        idOf(req),
        req.body,
        requireUser(req)
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
        idOf(req),
        req.body,
        requireUser(req)
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
        idOf(req),
        requireUser(req)
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
        idOf(req),
        requireUser(req)
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
