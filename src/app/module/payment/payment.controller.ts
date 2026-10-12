import { Request, Response } from "express";
import status from "http-status";
import catchAsync from "../../shared/catchAsync.js";
import { paginationMeta, parseListOptions } from "../../shared/listQuery.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { PaymentService } from "./payment.service.js";
import { requireUser } from "../../shared/requireUser.js";
import { idOf } from "../../shared/requestSchemas.js";

const getAllPayments = catchAsync(async (req: Request, res: Response) => {
    const options = parseListOptions(req.query as Record<string, unknown>);
    const { rows, total } = await PaymentService.getAllPayments(requireUser(req), options);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Payments retrieved successfully",
        data: rows,
        meta: paginationMeta(options, total),
    });
});

const createPayment = catchAsync(async (req: Request, res: Response) => {
    const result = await PaymentService.createPayment(req.body, requireUser(req));
    sendResponse(res, {
        success: true,
        httpStatus: status.CREATED,
        message: "Payment recorded successfully",
        data: result,
    });
});

const updatePayment = catchAsync(async (req: Request, res: Response) => {
    const result = await PaymentService.updatePayment(idOf(req), req.body, requireUser(req));
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Payment updated successfully",
        data: result,
    });
});

const deletePayment = catchAsync(async (req: Request, res: Response) => {
    const result = await PaymentService.deletePayment(idOf(req), requireUser(req));
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Payment deleted successfully",
        data: result,
    });
});

export const PaymentController = {
    getAllPayments,
    createPayment,
    updatePayment,
    deletePayment,
};
