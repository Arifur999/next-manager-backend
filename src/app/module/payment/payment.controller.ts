import { Request, Response } from "express";
import status from "http-status";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import catchAsync from "../../shared/catchAsync.js";
import { paginationMeta, parseListOptions } from "../../shared/listQuery.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { PaymentService } from "./payment.service.js";

const getAllPayments = catchAsync(async (req: Request, res: Response) => {
    const options = parseListOptions(req.query as Record<string, unknown>);
    const { rows, total } = await PaymentService.getAllPayments(req.user as IRequestUser, options);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Payments retrieved successfully",
        data: rows,
        meta: paginationMeta(options, total),
    });
});

const createPayment = catchAsync(async (req: Request, res: Response) => {
    const result = await PaymentService.createPayment(req.body, req.user as IRequestUser);
    sendResponse(res, {
        success: true,
        httpStatus: status.CREATED,
        message: "Payment recorded successfully",
        data: result,
    });
});

const updatePayment = catchAsync(async (req: Request, res: Response) => {
    const result = await PaymentService.updatePayment(req.params.id as string, req.body, req.user as IRequestUser);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Payment updated successfully",
        data: result,
    });
});

const deletePayment = catchAsync(async (req: Request, res: Response) => {
    const result = await PaymentService.deletePayment(req.params.id as string, req.user as IRequestUser);
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
