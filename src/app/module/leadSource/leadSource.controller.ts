import { Request, Response } from "express";
import status from "http-status";
import catchAsync from "../../shared/catchAsync.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { LeadSourceService } from "./leadSource.service.js";
import { requireUser } from "../../shared/requireUser.js";
import { idOf } from "../../shared/requestSchemas.js";

const getAll = catchAsync(async (req: Request, res: Response) => {
    const result = await LeadSourceService.getAll(requireUser(req));
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Lead sources retrieved successfully",
        data: result,
    });
});

const create = catchAsync(async (req: Request, res: Response) => {
    const result = await LeadSourceService.create(req.body, requireUser(req));
    sendResponse(res, {
        success: true,
        httpStatus: status.CREATED,
        message: "Lead source added",
        data: result,
    });
});

const update = catchAsync(async (req: Request, res: Response) => {
    const result = await LeadSourceService.update(
        idOf(req),
        req.body,
        requireUser(req)
    );
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Lead source updated",
        data: result,
    });
});

const remove = catchAsync(async (req: Request, res: Response) => {
    const result = await LeadSourceService.remove(
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

export const LeadSourceController = { getAll, create, update, remove };
