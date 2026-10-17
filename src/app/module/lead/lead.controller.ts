import { Request, Response } from "express";
import status from "http-status";
import catchAsync from "../../shared/catchAsync.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { LeadService } from "./lead.service.js";
import { requireUser } from "../../shared/requireUser.js";
import { idOf, queryOf } from "../../shared/requestSchemas.js";
import { leadListQueryZodSchema } from "./lead.validation.js";

const getPipeline = catchAsync(async (req: Request, res: Response) => {
    const { mine, ...options } = queryOf(req, leadListQueryZodSchema);
    const result = await LeadService.getPipeline(requireUser(req), options, { mine });
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Pipeline retrieved successfully",
        data: result,
    });
});

const createLead = catchAsync(async (req: Request, res: Response) => {
    const result = await LeadService.createLead(req.body, requireUser(req));
    sendResponse(res, {
        success: true,
        httpStatus: status.CREATED,
        message: "Lead created successfully",
        data: result,
    });
});

const updateLead = catchAsync(async (req: Request, res: Response) => {
    const result = await LeadService.updateLead(idOf(req), req.body, requireUser(req));
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Lead updated successfully",
        data: result,
    });
});

const convertToClient = catchAsync(async (req: Request, res: Response) => {
    const result = await LeadService.convertToClient(idOf(req), requireUser(req));
    sendResponse(res, {
        success: true,
        httpStatus: status.CREATED,
        message: "Lead converted to client successfully",
        data: result,
    });
});

const getStageEvents = catchAsync(async (req: Request, res: Response) => {
    const result = await LeadService.getStageEvents(idOf(req), requireUser(req));
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Stage history retrieved successfully",
        data: result,
    });
});

const deleteLead = catchAsync(async (req: Request, res: Response) => {
    const result = await LeadService.deleteLead(idOf(req), requireUser(req));
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
