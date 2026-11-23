import type { Response } from "express";

export function sendError(
  res: Response,
  status: number,
  code: string,
  message: string,
  details?: unknown,
): void {
  res.status(status).json({
    error: details === undefined ? { code, message } : { code, message, details },
  });
}
