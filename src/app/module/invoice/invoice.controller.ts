import { Request, Response } from "express";
import status from "http-status";
import catchAsync from "../../shared/catchAsync.js";
import { listQuerySchema, paginationMeta } from "../../shared/listQuery.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { InvoiceService } from "./invoice.service.js";
import { requireUser } from "../../shared/requireUser.js";
import { idOf, queryOf } from "../../shared/requestSchemas.js";

const getAllInvoices = catchAsync(async (req: Request, res: Response) => {
    const options = queryOf(req, listQuerySchema);
    const { rows, total } = await InvoiceService.getAllInvoices(requireUser(req), options);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Invoices retrieved successfully",
        data: rows,
        meta: paginationMeta(options, total),
    });
});

const getSingleInvoice = catchAsync(async (req: Request, res: Response) => {
    const result = await InvoiceService.getSingleInvoice(idOf(req), requireUser(req));
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Invoice retrieved successfully",
        data: result,
    });
});

const createInvoice = catchAsync(async (req: Request, res: Response) => {
    const result = await InvoiceService.createInvoice(req.body, requireUser(req));
    sendResponse(res, {
        success: true,
        httpStatus: status.CREATED,
        message: "Invoice created successfully",
        data: result,
    });
});

const updateInvoice = catchAsync(async (req: Request, res: Response) => {
    const result = await InvoiceService.updateInvoice(idOf(req), req.body, requireUser(req));
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Invoice updated successfully",
        data: result,
    });
});

const deleteInvoice = catchAsync(async (req: Request, res: Response) => {
    const result = await InvoiceService.deleteInvoice(idOf(req), requireUser(req));
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
