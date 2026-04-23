import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import session from "express-session";
import router from "./routes";
import { logger } from "./lib/logger";

const isProduction = process.env.NODE_ENV === "production";

// Require a real SESSION_SECRET in production — never fall back to a default
const sessionSecret = process.env.SESSION_SECRET;
if (isProduction && !sessionSecret) {
  logger.error("SESSION_SECRET environment variable is required in production");
  process.exit(1);
}

// In production, only allow requests from the known Replit domain
const allowedOrigin = isProduction
  ? (process.env.REPLIT_DOMAINS
      ? `https://${process.env.REPLIT_DOMAINS.split(",")[0]}`
      : undefined)
  : true;

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(cors({
  origin: allowedOrigin,
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    secret: sessionSecret ?? "telegram-shop-dev-secret-not-for-production",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? "strict" : "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  })
);

app.use("/api", router);

export default app;
