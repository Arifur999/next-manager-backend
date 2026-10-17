import { Request, Response } from "express";
import status from "http-status";
import catchAsync from "../../shared/catchAsync.js";
import { listQuerySchema, paginationMeta } from "../../shared/listQuery.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { ChatService } from "./chat.service.js";
import { idOf, queryOf } from "../../shared/requestSchemas.js";
import { requireUser } from "../../shared/requireUser.js";
import { conversationListQueryZodSchema } from "./chat.validation.js";

const getConversations = catchAsync(async (req: Request, res: Response) => {
    const query = queryOf(req, conversationListQueryZodSchema);
    // Every sub-view the sidebar offers is a filter over this one list, not a
    // separate endpoint: Unread, Direct, Groups, Project and Archived.
    const { rows } = await ChatService.getConversations(requireUser(req), {
        type: query.type,
        unreadOnly: query.unread,
        archived: query.archived,
    });

    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Conversations retrieved successfully",
        data: rows,
    });
});

const createConversation = catchAsync(async (req: Request, res: Response) => {
    const result = await ChatService.createConversation(req.body, requireUser(req));
    sendResponse(res, {
        success: true,
        httpStatus: status.CREATED,
        message: "Conversation ready",
        data: result,
    });
});

const getMessages = catchAsync(async (req: Request, res: Response) => {
    const options = queryOf(req, listQuerySchema);
    const { rows, total } = await ChatService.getMessages(
        idOf(req),
        requireUser(req),
        options
    );
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Messages retrieved successfully",
        data: rows,
        meta: paginationMeta(options, total),
    });
});

const sendMessage = catchAsync(async (req: Request, res: Response) => {
    const result = await ChatService.sendMessage(
        idOf(req),
        req.body,
        requireUser(req)
    );
    sendResponse(res, {
        success: true,
        httpStatus: status.CREATED,
        message: "Message sent",
        data: result,
    });
});

const markRead = catchAsync(async (req: Request, res: Response) => {
    const result = await ChatService.markRead(idOf(req), requireUser(req));
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: result.message,
        data: result,
    });
});

const addMembers = catchAsync(async (req: Request, res: Response) => {
    const result = await ChatService.addMembers(
        idOf(req),
        req.body,
        requireUser(req)
    );
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: result.message,
        data: result,
    });
});

const leave = catchAsync(async (req: Request, res: Response) => {
    const result = await ChatService.leave(idOf(req), requireUser(req));
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: result.message,
        data: result,
    });
});

const setArchived = catchAsync(async (req: Request, res: Response) => {
    const result = await ChatService.setArchived(
        idOf(req),
        req.body?.archived !== false,
        requireUser(req)
    );
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: result.message,
        data: result,
    });
});

const getUnreadTotal = catchAsync(async (req: Request, res: Response) => {
    const result = await ChatService.getUnreadTotal(requireUser(req));
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Unread count retrieved successfully",
        data: result,
    });
});

export const ChatController = {
    getConversations,
    createConversation,
    getMessages,
    sendMessage,
    markRead,
    addMembers,
    leave,
    setArchived,
    getUnreadTotal,
};
