import { Request, Response } from "express";
import status from "http-status";
import catchAsync from "../../shared/catchAsync.js";
import { listQuerySchema } from "../../shared/listQuery.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { ReportService } from "./report.service.js";
import { requireUser } from "../../shared/requireUser.js";
import { queryOf } from "../../shared/requestSchemas.js";
import { clientRevenueQueryZodSchema, monthlySeriesQueryZodSchema } from "./report.validation.js";

const getProfitAndLoss = catchAsync(async (req: Request, res: Response) => {
    const options = queryOf(req, listQuerySchema);
    const result = await ReportService.getProfitAndLoss(requireUser(req), options);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Profit and loss retrieved successfully",
        data: result,
    });
});

const getCashFlow = catchAsync(async (req: Request, res: Response) => {
    const options = queryOf(req, listQuerySchema);
    const result = await ReportService.getCashFlow(requireUser(req), options);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Cash flow retrieved successfully",
        data: result,
    });
});

const getClientRevenue = catchAsync(async (req: Request, res: Response) => {
    const { mine, ...options } = queryOf(req, clientRevenueQueryZodSchema);

    // Sales is forced into their own book by the reports scope in the service;
    // `mine` only lets somebody with the whole view narrow it themselves.
    const result = await ReportService.getClientRevenue(requireUser(req), options, { mine });
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Client revenue retrieved successfully",
        data: result,
    });
});

const getProjectProfitability = catchAsync(async (req: Request, res: Response) => {
    const options = queryOf(req, listQuerySchema);
    const result = await ReportService.getProjectProfitability(requireUser(req), options);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Project profitability retrieved successfully",
        data: result,
    });
});

const getMonthlySeries = catchAsync(async (req: Request, res: Response) => {
    const { months } = queryOf(req, monthlySeriesQueryZodSchema);
    const result = await ReportService.getMonthlySeries(requireUser(req), months);
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
