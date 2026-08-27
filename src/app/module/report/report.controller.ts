import { Request, Response } from "express";
import status from "http-status";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import catchAsync from "../../shared/catchAsync.js";
import { parseListOptions } from "../../shared/listQuery.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { ReportService } from "./report.service.js";

const getProfitAndLoss = catchAsync(async (req: Request, res: Response) => {
    const options = parseListOptions(req.query as Record<string, unknown>);
    const result = await ReportService.getProfitAndLoss(req.user as IRequestUser, options);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Profit and loss retrieved successfully",
        data: result,
    });
});

const getCashFlow = catchAsync(async (req: Request, res: Response) => {
    const options = parseListOptions(req.query as Record<string, unknown>);
    const result = await ReportService.getCashFlow(req.user as IRequestUser, options);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Cash flow retrieved successfully",
        data: result,
    });
});

const getClientRevenue = catchAsync(async (req: Request, res: Response) => {
    const options = parseListOptions(req.query as Record<string, unknown>);
    const result = await ReportService.getClientRevenue(req.user as IRequestUser, options);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Client revenue retrieved successfully",
        data: result,
    });
});

const getProjectProfitability = catchAsync(async (req: Request, res: Response) => {
    const options = parseListOptions(req.query as Record<string, unknown>);
    const result = await ReportService.getProjectProfitability(req.user as IRequestUser, options);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Project profitability retrieved successfully",
        data: result,
    });
});

const getMonthlySeries = catchAsync(async (req: Request, res: Response) => {
    const raw = Number(req.query.months);
    // Clamped rather than rejected: a silly ?months value should narrow the
    // chart, not break the page.
    const months = Number.isInteger(raw) && raw > 0 ? Math.min(raw, 36) : 12;
    const result = await ReportService.getMonthlySeries(req.user as IRequestUser, months);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Monthly series retrieved successfully",
        data: result,
    });
});

export const ReportController = {
    getProfitAndLoss,
    getCashFlow,
    getClientRevenue,
    getProjectProfitability,
    getMonthlySeries,
};
