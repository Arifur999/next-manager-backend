import { Request, Response } from "express";
import status from "http-status";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import catchAsync from "../../shared/catchAsync.js";
import { paginationMeta, parseListOptions } from "../../shared/listQuery.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { ProjectService } from "./project.service.js";

const getAllProjects = catchAsync(async (req: Request, res: Response) => {
    const options = parseListOptions(req.query as Record<string, unknown>);
    const { rows, total } = await ProjectService.getAllProjects(req.user as IRequestUser, options);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Projects retrieved successfully",
        data: rows,
        meta: paginationMeta(options, total),
    });
});

const getSingleProject = catchAsync(async (req: Request, res: Response) => {
    const result = await ProjectService.getSingleProject(req.params.id as string, req.user as IRequestUser);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Project retrieved successfully",
        data: result,
    });
});

const getProjectFinancials = catchAsync(async (req: Request, res: Response) => {
    const result = await ProjectService.getProjectFinancials(req.params.id as string, req.user as IRequestUser);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Project financials retrieved successfully",
        data: result,
    });
});

const createProject = catchAsync(async (req: Request, res: Response) => {
    const result = await ProjectService.createProject(req.body, req.user as IRequestUser);
    sendResponse(res, {
        success: true,
        httpStatus: status.CREATED,
        message: "Project created successfully",
        data: result,
    });
});

const updateProject = catchAsync(async (req: Request, res: Response) => {
    const result = await ProjectService.updateProject(req.params.id as string, req.body, req.user as IRequestUser);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Project updated successfully",
        data: result,
    });
});

const deleteProject = catchAsync(async (req: Request, res: Response) => {
    const result = await ProjectService.deleteProject(req.params.id as string, req.user as IRequestUser);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Project deleted successfully",
        data: result,
    });
});

export const ProjectController = {
    getAllProjects,
    getSingleProject,
    getProjectFinancials,
    createProject,
    updateProject,
    deleteProject,
};
