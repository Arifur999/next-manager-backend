import { Request, Response } from "express";
import status from "http-status";
import catchAsync from "../../shared/catchAsync.js";
import { listQuerySchema, paginationMeta } from "../../shared/listQuery.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { DuePaymentService } from "./duePayment.service.js";
import { requireUser } from "../../shared/requireUser.js";
import { idOf, queryOf } from "../../shared/requestSchemas.js";
import { dueTransactionListQueryZodSchema } from "./duePayment.validation.js";

const getAllPeople = catchAsync(async (req: Request, res: Response) => {
    const options = queryOf(req, listQuerySchema);
    const { rows } = await DuePaymentService.getAllPeople(requireUser(req), options);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Due people retrieved successfully",
        data: rows,
    });
});

const createPerson = catchAsync(async (req: Request, res: Response) => {
    const result = await DuePaymentService.createPerson(req.body, requireUser(req));
    sendResponse(res, {
        success: true,
        httpStatus: status.CREATED,
        message: "Person created successfully",
        data: result,
    });
});

const updatePerson = catchAsync(async (req: Request, res: Response) => {
    const result = await DuePaymentService.updatePerson(idOf(req), req.body, requireUser(req));
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Person updated successfully",
        data: result,
    });
});

const deletePerson = catchAsync(async (req: Request, res: Response) => {
    const result = await DuePaymentService.deletePerson(idOf(req), requireUser(req));
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Person deleted successfully",
        data: result,
    });
});

const getTransactions = catchAsync(async (req: Request, res: Response) => {
    const { person_id, ...options } = queryOf(req, dueTransactionListQueryZodSchema);
    const { rows, total } = await DuePaymentService.getTransactions(requireUser(req), person_id, options);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Due transactions retrieved successfully",
        data: rows,
        meta: paginationMeta(options, total),
    });
});

const createTransaction = catchAsync(async (req: Request, res: Response) => {
    const result = await DuePaymentService.createTransaction(req.body, requireUser(req));
    sendResponse(res, {
        success: true,
        httpStatus: status.CREATED,
        message: "Due transaction recorded successfully",
        data: result,
    });
});

const deleteTransaction = catchAsync(async (req: Request, res: Response) => {
    const result = await DuePaymentService.deleteTransaction(idOf(req), requireUser(req));
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Due transaction deleted successfully",
        data: result,
    });
});

export const DuePaymentController = {
    getAllPeople,
    createPerson,
    updatePerson,
    deletePerson,
    getTransactions,
    createTransaction,
    deleteTransaction,
};
