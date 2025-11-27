import { Request, Response, NextFunction } from 'express';

export interface ApiError extends Error {
  statusCode?: number;
  isOperational?: boolean;
}

export const errorHandler = (
  err: ApiError,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  // Set default error status code
  const statusCode = err.statusCode || 500;
  
  // Don't leak stack trace in production
  const message = process.env.NODE_ENV === 'production' 
    ? (statusCode === 500 ? 'Internal Server Error' : err.message) 
    : err.message;

  console.error(err);

  res.status(statusCode).json({
    success: false,
    error: message,
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack })
  });
};