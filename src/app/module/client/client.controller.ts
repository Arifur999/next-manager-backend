import { Request, Response } from "express";
import { ClientStatus } from "../../../generated/prisma/enums.js";
import status from "http-status";
import catchAsync from "../../shared/catchAsync.js";
import { paginationMeta, parseListOptions } from "../../shared/listQuery.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { ClientService } from "./client.service.js";
import { requireUser } from "../../shared/requireUser.js";
import { idOf } from "../../shared/requestSchemas.js";

const getAllClients = catchAsync(async (req: Request, res: Response) => {
    const query = req.query as Record<string, unknown>;
    const options = parseListOptions(query);
    const { rows, total } = await ClientService.getAllClients(requireUser(req), options, {
        status:
            typeof query.status === "string" && query.status in ClientStatus
                ? (query.status as ClientStatus)
                : undefined,
        mine: query.mine === "true",
    });
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Clients retrieved successfully",
        data: rows,
        meta: paginationMeta(options, total),
    });
});

const getSingleClient = catchAsync(async (req: Request, res: Response) => {
    const result = await ClientService.getSingleClient(idOf(req), requireUser(req));
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Client retrieved successfully",
        data: result,
    });
});

const getClientFinancials = catchAsync(async (req: Request, res: Response) => {
    const result = await ClientService.getClientFinancials(idOf(req), requireUser(req));
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Client financial summary retrieved successfully",
        data: result,
    });
});

const createClient = catchAsync(async (req: Request, res: Response) => {
    const result = await ClientService.createClient(req.body, requireUser(req));
    sendResponse(res, {
        success: true,
        httpStatus: status.CREATED,
        message: "Client created successfully",
        data: result,
    });
});

const updateClient = catchAsync(async (req: Request, res: Response) => {
    const result = await ClientService.updateClient(idOf(req), req.body, requireUser(req));
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Client updated successfully",
        data: result,
    });
});

const deleteClient = catchAsync(async (req: Request, res: Response) => {
    const result = await ClientService.deleteClient(idOf(req), requireUser(req));
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
