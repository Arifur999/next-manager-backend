import { Request, Response } from "express";
import status from "http-status";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import catchAsync from "../../shared/catchAsync.js";
import { paginationMeta, parseListOptions } from "../../shared/listQuery.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { TaskService } from "./task.service.js";

// Anything unrecognised is ignored rather than rejected: a stale bookmark with
// an old status value should show the unfiltered board, not an error page.
const parseFilters = (query: Record<string, unknown>) => ({
    projectId: typeof query.project_id === "string" ? query.project_id : undefined,
    assigneeId: typeof query.assignee_id === "string" ? query.assignee_id : undefined,
    statusId: typeof query.status_id === "string" ? query.status_id : undefined,
    statusName: typeof query.status === "string" ? query.status : undefined,
    mine: query.mine === "true",
    // Every task on the clients this person brought in - the sales board.
    // Deliberately a fixed "me" rather than an id from the query: taking one
    // would let anybody read anybody else's book by guessing.
    clientOwnerMine: query.client_owner === "me",
    overdue: query.overdue === "true",
});

const getAllTasks = catchAsync(async (req: Request, res: Response) => {
    const query = req.query as Record<string, unknown>;
    const options = parseListOptions(query);
    const { rows, total } = await TaskService.getAllTasks(
        req.user as IRequestUser,
        parseFilters(query),
        options
    );
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Tasks retrieved successfully",
        data: rows,
        meta: paginationMeta(options, total),
    });
});

const createTask = catchAsync(async (req: Request, res: Response) => {
    const result = await TaskService.createTask(req.body, req.user as IRequestUser);
    sendResponse(res, {
        success: true,
        httpStatus: status.CREATED,
        message: "Task created successfully",
        data: result,
    });
});

const updateTask = catchAsync(async (req: Request, res: Response) => {
    const result = await TaskService.updateTask(req.params.id as string, req.body, req.user as IRequestUser);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Task updated successfully",
        data: result,
    });
});

const deleteTask = catchAsync(async (req: Request, res: Response) => {
    const result = await TaskService.deleteTask(req.params.id as string, req.user as IRequestUser);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Task deleted successfully",
        data: result,
    });
});

export const TaskController = { getAllTasks, createTask, updateTask, deleteTask };
