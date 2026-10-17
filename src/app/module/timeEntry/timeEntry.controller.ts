import { Request, Response } from "express";
import status from "http-status";
import catchAsync from "../../shared/catchAsync.js";
import { listQuerySchema, paginationMeta } from "../../shared/listQuery.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { TimeCapacityService } from "./timeCapacity.service.js";
import { TimeEntryService } from "./timeEntry.service.js";
import { idOf, paramsOf, userIdParams, queryOf } from "../../shared/requestSchemas.js";
import { requireUser } from "../../shared/requireUser.js";
import { timeEntryListQueryZodSchema, timeSummaryQueryZodSchema } from "./timeEntry.validation.js";

const getAllEntries = catchAsync(async (req: Request, res: Response) => {
    const { user_id, project_id, approved, ...options } = queryOf(req, timeEntryListQueryZodSchema);
    const { rows, total } = await TimeEntryService.getAllEntries(
        requireUser(req),
        { userId: user_id, projectId: project_id, approved },
        options
    );
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Time entries retrieved successfully",
        data: rows,
        meta: paginationMeta(options, total),
    });
});

const getSummary = catchAsync(async (req: Request, res: Response) => {
    const { user_id, ...options } = queryOf(req, timeSummaryQueryZodSchema);
    const result = await TimeEntryService.getSummary(requireUser(req), { userId: user_id }, options);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Time summary retrieved successfully",
        data: result,
    });
});

const createEntry = catchAsync(async (req: Request, res: Response) => {
    const result = await TimeEntryService.createEntry(req.body, requireUser(req));
    sendResponse(res, {
        success: true,
        httpStatus: status.CREATED,
        message: "Time logged",
        data: result,
    });
});

const updateEntry = catchAsync(async (req: Request, res: Response) => {
    const result = await TimeEntryService.updateEntry(
        idOf(req),
        req.body,
        requireUser(req)
    );
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Time entry updated",
        data: result,
    });
});

const approveEntry = catchAsync(async (req: Request, res: Response) => {
    const result = await TimeEntryService.setApproval(
        idOf(req),
        true,
        requireUser(req)
    );
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Time entry approved",
        data: result,
    });
});

const unapproveEntry = catchAsync(async (req: Request, res: Response) => {
    const result = await TimeEntryService.setApproval(
        idOf(req),
        false,
        requireUser(req)
    );
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Approval removed",
        data: result,
    });
});

const deleteEntry = catchAsync(async (req: Request, res: Response) => {
    const result = await TimeEntryService.deleteEntry(idOf(req), requireUser(req));
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Time entry deleted",
        data: result,
    });
});

const getCapacities = catchAsync(async (req: Request, res: Response) => {
    const result = await TimeCapacityService.getCapacities(requireUser(req));
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Capacities retrieved successfully",
        data: result,
    });
});

const getWorkload = catchAsync(async (req: Request, res: Response) => {
    const options = queryOf(req, listQuerySchema);
    const result = await TimeCapacityService.getWorkload(requireUser(req), options);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Workload retrieved successfully",
        data: result,
    });
});

const setCapacity = catchAsync(async (req: Request, res: Response) => {
    const result = await TimeCapacityService.setCapacity(
        paramsOf(req, userIdParams).userId,
        req.body,
        requireUser(req)
    );
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Capacity updated",
        data: result,
    });
});

export const TimeEntryController = {
    getAllEntries,
    getSummary,
    createEntry,
    updateEntry,
    approveEntry,
    unapproveEntry,
    deleteEntry,
    getCapacities,
    getWorkload,
    setCapacity,
};
