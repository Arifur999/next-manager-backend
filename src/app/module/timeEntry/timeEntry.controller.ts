import { Request, Response } from "express";
import status from "http-status";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import catchAsync from "../../shared/catchAsync.js";
import { paginationMeta, parseListOptions } from "../../shared/listQuery.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { TimeEntryService } from "./timeEntry.service.js";

// Anything unparseable is ignored rather than rejected: a stale bookmark should
// widen the view, not produce an error page.
const parseFilters = (query: Record<string, unknown>) => ({
    userId: typeof query.user_id === "string" ? query.user_id : undefined,
    projectId: typeof query.project_id === "string" ? query.project_id : undefined,
    approved:
        query.approved === "true" ? true : query.approved === "false" ? false : undefined,
});

const getAllEntries = catchAsync(async (req: Request, res: Response) => {
    const query = req.query as Record<string, unknown>;
    const options = parseListOptions(query);
    const { rows, total } = await TimeEntryService.getAllEntries(
        req.user as IRequestUser,
        parseFilters(query),
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
    const query = req.query as Record<string, unknown>;
    const options = parseListOptions(query);
    const result = await TimeEntryService.getSummary(
        req.user as IRequestUser,
        { userId: typeof query.user_id === "string" ? query.user_id : undefined },
        options
    );
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Time summary retrieved successfully",
        data: result,
    });
});

const createEntry = catchAsync(async (req: Request, res: Response) => {
    const result = await TimeEntryService.createEntry(req.body, req.user as IRequestUser);
    sendResponse(res, {
        success: true,
        httpStatus: status.CREATED,
        message: "Time logged",
        data: result,
    });
});

const updateEntry = catchAsync(async (req: Request, res: Response) => {
    const result = await TimeEntryService.updateEntry(
        req.params.id as string,
        req.body,
        req.user as IRequestUser
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
        req.params.id as string,
        true,
        req.user as IRequestUser
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
        req.params.id as string,
        false,
        req.user as IRequestUser
    );
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Approval removed",
        data: result,
    });
});

const deleteEntry = catchAsync(async (req: Request, res: Response) => {
    const result = await TimeEntryService.deleteEntry(req.params.id as string, req.user as IRequestUser);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Time entry deleted",
        data: result,
    });
});

const getCapacities = catchAsync(async (req: Request, res: Response) => {
    const result = await TimeEntryService.getCapacities(req.user as IRequestUser);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Capacities retrieved successfully",
        data: result,
    });
});

const getWorkload = catchAsync(async (req: Request, res: Response) => {
    const options = parseListOptions(req.query as Record<string, unknown>);
    const result = await TimeEntryService.getWorkload(req.user as IRequestUser, options);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Workload retrieved successfully",
        data: result,
    });
});

const setCapacity = catchAsync(async (req: Request, res: Response) => {
    const result = await TimeEntryService.setCapacity(
        req.params.userId as string,
        req.body,
        req.user as IRequestUser
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
