import { Request, Response } from "express";
import status from "http-status";
import catchAsync from "../../shared/catchAsync.js";
import { listQuerySchema, paginationMeta } from "../../shared/listQuery.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { TaskService } from "./task.service.js";
import { idOf, queryOf } from "../../shared/requestSchemas.js";
import { requireUser } from "../../shared/requireUser.js";
import { taskListQueryZodSchema } from "./task.validation.js";

const getAllTasks = catchAsync(async (req: Request, res: Response) => {
    const query = queryOf(req, taskListQueryZodSchema);
    const { page, limit, search, from, to } = query;
    const options = { page, limit, search, from, to };
    const { rows, total } = await TaskService.getAllTasks(
        requireUser(req),
        {
            projectId: query.project_id,
            assigneeId: query.assignee_id,
            statusId: query.status_id,
            statusName: query.status,
            mine: query.mine,
            // Every task on the clients this person brought in - the sales board.
            clientOwnerMine: query.client_owner,
            overdue: query.overdue,
            due: query.due,
            completed: query.completed,
        },
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
    const result = await TaskService.createTask(req.body, requireUser(req));
    sendResponse(res, {
        success: true,
        httpStatus: status.CREATED,
        message: "Task created successfully",
        data: result,
    });
});

const updateTask = catchAsync(async (req: Request, res: Response) => {
    const result = await TaskService.updateTask(idOf(req), req.body, requireUser(req));
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Task updated successfully",
        data: result,
    });
});

const deleteTask = catchAsync(async (req: Request, res: Response) => {
    const result = await TaskService.deleteTask(idOf(req), requireUser(req));
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Task deleted successfully",
        data: result,
    });
});

const getReport = catchAsync(async (req: Request, res: Response) => {
    const options = queryOf(req, listQuerySchema);
    const result = await TaskService.getReport(requireUser(req), options);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Task report retrieved successfully",
        data: result,
    });
});

export const TaskController = {
    getReport, getAllTasks, createTask, updateTask, deleteTask };
