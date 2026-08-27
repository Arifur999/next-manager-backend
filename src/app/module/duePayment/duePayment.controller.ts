import { Request, Response } from "express";
import status from "http-status";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import catchAsync from "../../shared/catchAsync.js";
import { paginationMeta, parseListOptions } from "../../shared/listQuery.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { DuePaymentService } from "./duePayment.service.js";

const getAllPeople = catchAsync(async (req: Request, res: Response) => {
    const options = parseListOptions(req.query as Record<string, unknown>);
    const { rows } = await DuePaymentService.getAllPeople(req.user as IRequestUser, options);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Due people retrieved successfully",
        data: rows,
    });
});

const createPerson = catchAsync(async (req: Request, res: Response) => {
    const result = await DuePaymentService.createPerson(req.body, req.user as IRequestUser);
    sendResponse(res, {
        success: true,
        httpStatus: status.CREATED,
        message: "Person created successfully",
        data: result,
    });
});

const updatePerson = catchAsync(async (req: Request, res: Response) => {
    const result = await DuePaymentService.updatePerson(req.params.id as string, req.body, req.user as IRequestUser);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Person updated successfully",
        data: result,
    });
});

const deletePerson = catchAsync(async (req: Request, res: Response) => {
    const result = await DuePaymentService.deletePerson(req.params.id as string, req.user as IRequestUser);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Person deleted successfully",
        data: result,
    });
});

const getTransactions = catchAsync(async (req: Request, res: Response) => {
    const query = req.query as Record<string, unknown>;
    const options = parseListOptions(query);
    const personId = typeof query.person_id === "string" ? query.person_id : undefined;
    const { rows, total } = await DuePaymentService.getTransactions(req.user as IRequestUser, personId, options);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Due transactions retrieved successfully",
        data: rows,
        meta: paginationMeta(options, total),
    });
});

const createTransaction = catchAsync(async (req: Request, res: Response) => {
    const result = await DuePaymentService.createTransaction(req.body, req.user as IRequestUser);
    sendResponse(res, {
        success: true,
        httpStatus: status.CREATED,
        message: "Due transaction recorded successfully",
        data: result,
    });
});

const deleteTransaction = catchAsync(async (req: Request, res: Response) => {
    const result = await DuePaymentService.deleteTransaction(req.params.id as string, req.user as IRequestUser);
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
