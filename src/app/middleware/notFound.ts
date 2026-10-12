import { Request, Response } from "express";
import status from "http-status";

const notFound = (req: Request, res: Response) => {
    const message = `Route not found: ${req.method} ${req.originalUrl}`;
    res.status(status.NOT_FOUND).json({
        success: false,
        message,
        errorSource: [{ path: req.path, message }],
        requestId: req.id,
    });
};

export default notFound;
