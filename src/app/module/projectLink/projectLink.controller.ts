import { Request, Response } from "express";
import status from "http-status";
import catchAsync from "../../shared/catchAsync.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { ProjectLinkService } from "./projectLink.service.js";
import { idOf, queryOf } from "../../shared/requestSchemas.js";
import { requireUser } from "../../shared/requireUser.js";
import { projectLinkListQueryZodSchema } from "./projectLink.validation.js";

const getAll = catchAsync(async (req: Request, res: Response) => {
    const { project_id } = queryOf(req, projectLinkListQueryZodSchema);
    const result = await ProjectLinkService.getAll(requireUser(req), { projectId: project_id });
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Links retrieved successfully",
        data: result,
    });
});

const create = catchAsync(async (req: Request, res: Response) => {
    const result = await ProjectLinkService.create(req.body, requireUser(req));
    sendResponse(res, {
        success: true,
        httpStatus: status.CREATED,
        message: "Link added",
        data: result,
    });
});

const update = catchAsync(async (req: Request, res: Response) => {
    const result = await ProjectLinkService.update(
        idOf(req),
        req.body,
        requireUser(req)
    );
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Link updated",
        data: result,
    });
});

const remove = catchAsync(async (req: Request, res: Response) => {
    const result = await ProjectLinkService.remove(
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

export const ProjectLinkController = { getAll, create, update, remove };
