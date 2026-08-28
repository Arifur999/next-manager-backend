import { Request, Response } from "express";
import status from "http-status";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import catchAsync from "../../shared/catchAsync.js";
import { parseListOptions } from "../../shared/listQuery.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { LeadService } from "./lead.service.js";

const getPipeline = catchAsync(async (req: Request, res: Response) => {
    const options = parseListOptions(req.query as Record<string, unknown>);
    const result = await LeadService.getPipeline(req.user as IRequestUser, options);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Pipeline retrieved successfully",
        data: result,
    });
});

const createLead = catchAsync(async (req: Request, res: Response) => {
    const result = await LeadService.createLead(req.body, req.user as IRequestUser);
    sendResponse(res, {
        success: true,
        httpStatus: status.CREATED,
        message: "Lead created successfully",
        data: result,
    });
});

const updateLead = catchAsync(async (req: Request, res: Response) => {
    const result = await LeadService.updateLead(req.params.id as string, req.body, req.user as IRequestUser);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Lead updated successfully",
        data: result,
    });
});

const convertToClient = catchAsync(async (req: Request, res: Response) => {
    const result = await LeadService.convertToClient(req.params.id as string, req.user as IRequestUser);
    sendResponse(res, {
        success: true,
        httpStatus: status.CREATED,
        message: "Lead converted to client successfully",
        data: result,
    });
});

const getStageEvents = catchAsync(async (req: Request, res: Response) => {
    const result = await LeadService.getStageEvents(req.params.id as string, req.user as IRequestUser);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Stage history retrieved successfully",
        data: result,
    });
});

const deleteLead = catchAsync(async (req: Request, res: Response) => {
    const result = await LeadService.deleteLead(req.params.id as string, req.user as IRequestUser);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Lead deleted successfully",
        data: result,
    });
});

export const LeadController = {
    getPipeline,
    createLead,
    updateLead,
    getStageEvents,
    convertToClient,
    deleteLead,
};
