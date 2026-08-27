import { Request, Response } from "express";
import status from "http-status";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import catchAsync from "../../shared/catchAsync.js";
import { paginationMeta, parseListOptions } from "../../shared/listQuery.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { ExchangeService } from "./exchange.service.js";

const getAllExchanges = catchAsync(async (req: Request, res: Response) => {
    const options = parseListOptions(req.query as Record<string, unknown>);
    const { rows, total } = await ExchangeService.getAllExchanges(req.user as IRequestUser, options);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Exchanges retrieved successfully",
        data: rows,
        meta: paginationMeta(options, total),
    });
});

const createExchange = catchAsync(async (req: Request, res: Response) => {
    const result = await ExchangeService.createExchange(req.body, req.user as IRequestUser);
    sendResponse(res, {
        success: true,
        httpStatus: status.CREATED,
        message: "Exchange recorded successfully",
        data: result,
    });
});

const deleteExchange = catchAsync(async (req: Request, res: Response) => {
    const result = await ExchangeService.deleteExchange(req.params.id as string, req.user as IRequestUser);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Exchange deleted successfully",
        data: result,
    });
});

export const ExchangeController = {
    getAllExchanges,
    createExchange,
    deleteExchange,
};
