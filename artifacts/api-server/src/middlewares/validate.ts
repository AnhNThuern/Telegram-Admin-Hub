import type { Request, Response, NextFunction } from "express";
import { z } from "zod";

function formatZodError(err: z.ZodError): string {
  return err.issues.map((i: z.ZodIssue) => `${i.path.join(".")}: ${i.message}`).join("; ");
}

export function validateBody<T extends z.ZodTypeAny>(schema: T) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({ error: "Validation error", details: formatZodError(result.error) });
      return;
    }
    req.body = result.data;
    next();
  };
}

export function validateParams<T extends z.ZodTypeAny>(schema: T) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      res.status(400).json({ error: "Invalid parameters", details: formatZodError(result.error) });
      return;
    }
    Object.assign(req.params, result.data);
    next();
  };
}

export function validateQuery<T extends z.ZodTypeAny>(schema: T) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      res.status(400).json({ error: "Invalid query parameters", details: formatZodError(result.error) });
      return;
    }
    req.query = result.data as Record<string, string>;
    next();
  };
}
