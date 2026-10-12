import { Request, Response } from "express";
import status from "http-status";
import catchAsync from "../../shared/catchAsync.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { ProjectMemberService } from "./projectMember.service.js";
import { idOf, paramsOf, projectIdParams } from "../../shared/requestSchemas.js";
import { requireUser } from "../../shared/requireUser.js";

const getAssignmentOverview = catchAsync(async (req: Request, res: Response) => {
    const result = await ProjectMemberService.getAssignmentOverview(requireUser(req));
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Assignments retrieved successfully",
        data: result,
    });
});

const getProjectMembers = catchAsync(async (req: Request, res: Response) => {
    const result = await ProjectMemberService.getProjectMembers(
        paramsOf(req, projectIdParams).projectId,
        requireUser(req)
    );
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Project members retrieved successfully",
        data: result,
    });
});

const assignMember = catchAsync(async (req: Request, res: Response) => {
    const result = await ProjectMemberService.assignMember(req.body, requireUser(req));
    sendResponse(res, {
        success: true,
        httpStatus: status.CREATED,
        message: "Assigned to the project",
        data: result,
    });
});

const removeMember = catchAsync(async (req: Request, res: Response) => {
    const result = await ProjectMemberService.removeMember(
        idOf(req),
        requireUser(req)
    );
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Removed from the project",
        data: result,
    });
});

export const ProjectMemberController = {
    getAssignmentOverview,
    getProjectMembers,
    assignMember,
    removeMember,
};
