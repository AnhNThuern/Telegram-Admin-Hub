import { type Request, type Response, type NextFunction } from "express";

declare module "express-session" {
  interface SessionData {
    adminId: number;
    adminUsername: string;
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.session?.adminId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}
