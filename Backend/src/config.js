import { z } from "zod";
export function readConfig(env = process.env) {
  return z
    .object({
      MONGODB_URI: z.string().min(1),
      JWT_SECRET: z.string().min(32),
      JWT_EXPIRES_IN: z
        .string()
        .regex(/^[1-9]\d*[smhd]$/)
        .default("8h"),
      SMTP_HOST: z.string().min(1),
      SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
      SMTP_SECURE: z
        .enum(["true", "false"])
        .default("false")
        .transform((v) => v === "true"),
      SMTP_USER: z.string().optional(),
      SMTP_PASS: z.string().optional(),
      SMTP_FROM_NAME: z.string().default("Company Transport Management System"),
      SMTP_FROM_EMAIL: z.email(),
      OTP_EXPIRES_MINUTES: z.coerce.number().int().min(1).max(5).default(5),
      OTP_RESEND_SECONDS: z.coerce.number().int().min(60).default(60),
      APP_ORIGIN: z
        .url()
        .refine((value) => {
          const url = new URL(value);
          return (
            ["http:", "https:"].includes(url.protocol) && url.origin === value
          );
        }, "Use an exact HTTP(S) origin without a trailing slash or path")
        .default("http://localhost:5173"),
      NODE_ENV: z
        .enum(["development", "production", "test"])
        .default("development"),
      PORT: z.coerce.number().int().min(1).max(65535).default(5000),
    })
    .refine(
      (value) =>
        value.NODE_ENV !== "production" ||
        value.APP_ORIGIN.startsWith("https://"),
      {
        path: ["APP_ORIGIN"],
        message: "Production requires an HTTPS origin",
      },
    )
    .parse(env);
}
