import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import bcrypt from "bcrypt";
import { db, adminsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

router.post("/auth/login", async (req, res): Promise<void> => {
  const { username, password } = req.body;
  if (!username || !password) {
    res.status(400).json({ error: "Username and password are required" });
    return;
  }

  const [admin] = await db.select().from(adminsTable).where(eq(adminsTable.username, username));
  if (!admin) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  const valid = await bcrypt.compare(password, admin.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  req.session.adminId = admin.id;
  req.session.adminUsername = admin.username;

  res.json({
    id: admin.id,
    username: admin.username,
    displayName: admin.displayName,
    createdAt: admin.createdAt,
  });
});

router.post("/auth/logout", (req, res): void => {
  req.session.destroy(() => {
    res.json({ message: "Logged out successfully" });
  });
});

router.get("/auth/me", requireAuth, async (req, res): Promise<void> => {
  const [admin] = await db.select().from(adminsTable).where(eq(adminsTable.id, req.session.adminId!));
  if (!admin) {
    res.status(401).json({ error: "Session invalid" });
    return;
  }
  res.json({
    id: admin.id,
    username: admin.username,
    displayName: admin.displayName,
    createdAt: admin.createdAt,
  });
});

export default router;
