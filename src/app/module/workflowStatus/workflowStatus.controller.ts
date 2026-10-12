import { Request, Response } from "express";
import status from "http-status";
import { WorkflowKind } from "../../../generated/prisma/enums.js";
import catchAsync from "../../shared/catchAsync.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { WorkflowStatusService } from "./workflowStatus.service.js";
import { idOf } from "../../shared/requestSchemas.js";
import { requireUser } from "../../shared/requireUser.js";

const getAll = catchAsync(async (req: Request, res: Response) => {
    const kind = (req.query as Record<string, unknown>).kind;

    const result = await WorkflowStatusService.getAll(
        requireUser(req),
        typeof kind === "string" && kind in WorkflowKind ? (kind as WorkflowKind) : undefined
    );

    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Statuses retrieved successfully",
        data: result,
    });
});

const create = catchAsync(async (req: Request, res: Response) => {
    const result = await WorkflowStatusService.create(req.body, requireUser(req));
    sendResponse(res, {
        success: true,
        httpStatus: status.CREATED,
        message: "Status added successfully",
        data: result,
    });
});

const update = catchAsync(async (req: Request, res: Response) => {
    const result = await WorkflowStatusService.update(
        idOf(req),
        req.body,
        requireUser(req)
    );
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Status updated successfully",
        data: result,
    });
});

const remove = catchAsync(async (req: Request, res: Response) => {
    const result = await WorkflowStatusService.remove(
        idOf(req),
        requireUser(req)
    );
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Status removed successfully",
        data: result,
    });
});

export const WorkflowStatusController = { getAll, create, update, remove };
