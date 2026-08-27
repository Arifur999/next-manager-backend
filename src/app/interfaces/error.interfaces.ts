export interface IError {
    path: string;
    message: string;
}

export interface ISimplifiedError {
    statusCode: number;
    message: string;
    errorSource: IError[];
}

export interface IErrorResponse {
    success: false;
    message: string;
    errorSource: IError[];
    error?: unknown;
    stack?: string;
}
