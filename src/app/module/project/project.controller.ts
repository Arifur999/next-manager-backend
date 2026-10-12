import { Request, Response } from "express";
import status from "http-status";
import catchAsync from "../../shared/catchAsync.js";
import { paginationMeta, parseListOptions } from "../../shared/listQuery.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { ProjectService } from "./project.service.js";
import { idOf } from "../../shared/requestSchemas.js";
import { requireUser } from "../../shared/requireUser.js";

const getAllProjects = catchAsync(async (req: Request, res: Response) => {
    const query = req.query as Record<string, unknown>;
    const options = parseListOptions(query);
    const { rows, total } = await ProjectService.getAllProjects(requireUser(req), options, {
        statusName: typeof query.status === "string" ? query.status : undefined,
        mine: query.mine === "true",
    });
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Projects retrieved successfully",
        data: rows,
        meta: paginationMeta(options, total),
    });
});

const getSingleProject = catchAsync(async (req: Request, res: Response) => {
    const result = await ProjectService.getSingleProject(idOf(req), requireUser(req));
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Project retrieved successfully",
        data: result,
    });
});

const getProjectFinancials = catchAsync(async (req: Request, res: Response) => {
    const result = await ProjectService.getProjectFinancials(idOf(req), requireUser(req));
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Project financials retrieved successfully",
        data: result,
    });
});

const createProject = catchAsync(async (req: Request, res: Response) => {
    const result = await ProjectService.createProject(req.body, requireUser(req));
    sendResponse(res, {
        success: true,
        httpStatus: status.CREATED,
        message: "Project created successfully",
        data: result,
    });
});

const updateProject = catchAsync(async (req: Request, res: Response) => {
    const result = await ProjectService.updateProject(idOf(req), req.body, requireUser(req));
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Project updated successfully",
        data: result,
    });
});

const setBaseline = catchAsync(async (req: Request, res: Response) => {
    const result = await ProjectService.setBaseline(
        idOf(req),
        req.body,
        requireUser(req)
    );
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Baseline set",
        data: result,
    });
});

const deleteProject = catchAsync(async (req: Request, res: Response) => {
    const result = await ProjectService.deleteProject(idOf(req), requireUser(req));
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
    setBaseline,
    deleteProject,
};
