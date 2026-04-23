import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import dashboardRouter from "./dashboard";
import categoriesRouter from "./categories";
import productsRouter from "./products";
import ordersRouter from "./orders";
import transactionsRouter from "./transactions";
import customersRouter from "./customers";
import promotionsRouter from "./promotions";
import botRouter from "./bot";
import botLogsRouter from "./bot_logs";
import paymentsRouter from "./payments";
import retrySweepRouter from "./retry_sweep";
import restockQueueRouter from "./restock_queue";
import systemSettingsRouter from "./system_settings";
import i18nRouter from "./i18n";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(dashboardRouter);
router.use(categoriesRouter);
router.use(productsRouter);
router.use(ordersRouter);
router.use(transactionsRouter);
router.use(customersRouter);
router.use(promotionsRouter);
router.use(botRouter);
router.use(botLogsRouter);
router.use(paymentsRouter);
router.use(retrySweepRouter);
router.use(restockQueueRouter);
router.use(systemSettingsRouter);
router.use(i18nRouter);

export default router;
