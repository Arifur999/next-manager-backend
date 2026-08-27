import { Request, Response } from "express";
import status from "http-status";

const notFound = (req: Request, res: Response) => {
    res.status(status.NOT_FOUND).json({
        success: false,
        message: `Route not found: ${req.method} ${req.originalUrl}`,
    });
};

export default notFound;
