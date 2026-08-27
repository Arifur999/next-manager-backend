import { Request, Response } from "express";
import status from "http-status";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import catchAsync from "../../shared/catchAsync.js";
import { paginationMeta, parseListOptions } from "../../shared/listQuery.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { InvoiceService } from "./invoice.service.js";

const getAllInvoices = catchAsync(async (req: Request, res: Response) => {
    const options = parseListOptions(req.query as Record<string, unknown>);
    const { rows, total } = await InvoiceService.getAllInvoices(req.user as IRequestUser, options);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Invoices retrieved successfully",
        data: rows,
        meta: paginationMeta(options, total),
    });
});

const getSingleInvoice = catchAsync(async (req: Request, res: Response) => {
    const result = await InvoiceService.getSingleInvoice(req.params.id as string, req.user as IRequestUser);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Invoice retrieved successfully",
        data: result,
    });
});

const createInvoice = catchAsync(async (req: Request, res: Response) => {
    const result = await InvoiceService.createInvoice(req.body, req.user as IRequestUser);
    sendResponse(res, {
        success: true,
        httpStatus: status.CREATED,
        message: "Invoice created successfully",
        data: result,
    });
});

const updateInvoice = catchAsync(async (req: Request, res: Response) => {
    const result = await InvoiceService.updateInvoice(req.params.id as string, req.body, req.user as IRequestUser);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Invoice updated successfully",
        data: result,
    });
});

const deleteInvoice = catchAsync(async (req: Request, res: Response) => {
    const result = await InvoiceService.deleteInvoice(req.params.id as string, req.user as IRequestUser);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Invoice deleted successfully",
        data: result,
    });
});

export const InvoiceController = {
    getAllInvoices,
    getSingleInvoice,
    createInvoice,
    updateInvoice,
    deleteInvoice,
};
