import { Request, Response } from "express";
import status from "http-status";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import catchAsync from "../../shared/catchAsync.js";
import { paginationMeta, parseListOptions } from "../../shared/listQuery.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { ClientService } from "./client.service.js";

const getAllClients = catchAsync(async (req: Request, res: Response) => {
    const options = parseListOptions(req.query as Record<string, unknown>);
    const { rows, total } = await ClientService.getAllClients(req.user as IRequestUser, options);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Clients retrieved successfully",
        data: rows,
        meta: paginationMeta(options, total),
    });
});

const getSingleClient = catchAsync(async (req: Request, res: Response) => {
    const result = await ClientService.getSingleClient(req.params.id as string, req.user as IRequestUser);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Client retrieved successfully",
        data: result,
    });
});

const getClientFinancials = catchAsync(async (req: Request, res: Response) => {
    const result = await ClientService.getClientFinancials(req.params.id as string, req.user as IRequestUser);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Client financial summary retrieved successfully",
        data: result,
    });
});

const createClient = catchAsync(async (req: Request, res: Response) => {
    const result = await ClientService.createClient(req.body, req.user as IRequestUser);
    sendResponse(res, {
        success: true,
        httpStatus: status.CREATED,
        message: "Client created successfully",
        data: result,
    });
});

const updateClient = catchAsync(async (req: Request, res: Response) => {
    const result = await ClientService.updateClient(req.params.id as string, req.body, req.user as IRequestUser);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Client updated successfully",
        data: result,
    });
});

const deleteClient = catchAsync(async (req: Request, res: Response) => {
    const result = await ClientService.deleteClient(req.params.id as string, req.user as IRequestUser);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Client deleted successfully",
        data: result,
    });
});

export const ClientController = {
    getAllClients,
    getSingleClient,
    getClientFinancials,
    createClient,
    updateClient,
    deleteClient,
};
