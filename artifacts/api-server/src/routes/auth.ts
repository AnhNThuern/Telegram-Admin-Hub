import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import bcrypt from "bcrypt";
import { db, adminsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import { validateBody } from "../middlewares/validate";
import { LoginBody } from "@workspace/api-zod";
import z from "zod";

const router: IRouter = Router();

const ChangePasswordBody = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6),
});

router.post("/auth/login", validateBody(LoginBody), async (req, res): Promise<void> => {
  const { username, password } = req.body as z.infer<typeof LoginBody>;

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

router.put("/auth/password", requireAuth, validateBody(ChangePasswordBody), async (req, res): Promise<void> => {
  const { currentPassword, newPassword } = req.body as z.infer<typeof ChangePasswordBody>;
  const [admin] = await db.select().from(adminsTable).where(eq(adminsTable.id, req.session.adminId!));
  if (!admin) {
    res.status(401).json({ error: "Session invalid" });
    return;
  }
  const valid = await bcrypt.compare(currentPassword, admin.passwordHash);
  if (!valid) {
    res.status(400).json({ error: "Current password is incorrect" });
    return;
  }
  const passwordHash = await bcrypt.hash(newPassword, 10);
  await db.update(adminsTable).set({ passwordHash }).where(eq(adminsTable.id, admin.id));
  res.json({ message: "Password changed successfully" });
});

export default router;
