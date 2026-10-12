import { Request, Response } from "express";
import status from "http-status";
import catchAsync from "../../shared/catchAsync.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { AnnouncementService } from "./announcement.service.js";
import { idOf } from "../../shared/requestSchemas.js";
import { requireUser } from "../../shared/requireUser.js";

const getAnnouncements = catchAsync(async (_req: Request, res: Response) => {
    const result = await AnnouncementService.getAnnouncements();
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Announcements retrieved successfully",
        data: result,
    });
});

const createAnnouncement = catchAsync(async (req: Request, res: Response) => {
    const result = await AnnouncementService.createAnnouncement(requireUser(req), req.body);
    sendResponse(res, {
        success: true,
        httpStatus: status.CREATED,
        message: "Draft saved successfully",
        data: result,
    });
});

const updateAnnouncement = catchAsync(async (req: Request, res: Response) => {
    const result = await AnnouncementService.updateAnnouncement(
        requireUser(req),
        idOf(req),
        req.body
    );
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Draft updated successfully",
        data: result,
    });
});

/**
 * The message says what actually happened to the email, rather than assuming
 * it went out. An operator who is told "published" and later finds nobody was
 * mailed has been misled by their own tool.
 */
const publishAnnouncement = catchAsync(async (req: Request, res: Response) => {
    const result = await AnnouncementService.publishAnnouncement(requireUser(req), idOf(req));

    const message = !result.email
        ? "Published successfully"
        : result.email.delivered === result.email.attempted
          ? `Published, and emailed to ${result.email.delivered} of your customers`
          : `Published, but the email reached ${result.email.delivered} of ${result.email.attempted} addresses`;

    sendResponse(res, { success: true, httpStatus: status.OK, message, data: result });
});

const deleteAnnouncement = catchAsync(async (req: Request, res: Response) => {
    const result = await AnnouncementService.deleteAnnouncement(requireUser(req), idOf(req));
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Announcement removed successfully",
        data: result,
    });
});

// ---------------------------------------------------------------- customer

const getMyAnnouncements = catchAsync(async (req: Request, res: Response) => {
    const result = await AnnouncementService.getMyAnnouncements(requireUser(req));
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Notifications retrieved successfully",
        data: result,
    });
});

const getUnreadCount = catchAsync(async (req: Request, res: Response) => {
    const result = await AnnouncementService.getUnreadCount(requireUser(req));
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Unread count retrieved successfully",
        data: result,
    });
});

const markRead = catchAsync(async (req: Request, res: Response) => {
    const result = await AnnouncementService.markRead(requireUser(req), idOf(req));
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Marked as read",
        data: result,
    });
});

const markAllRead = catchAsync(async (req: Request, res: Response) => {
    const result = await AnnouncementService.markAllRead(requireUser(req));
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "All marked as read",
        data: result,
    });
});

export const AnnouncementController = {
    getAnnouncements,
    createAnnouncement,
    updateAnnouncement,
    publishAnnouncement,
    deleteAnnouncement,
    getMyAnnouncements,
    getUnreadCount,
    markRead,
    markAllRead,
};
