const { z } = require("zod");

const httpUrlField = z
  .string({ required_error: "URL is required." })
  .trim()
  .refine(
    (val) => {
      try {
        const u = new global.URL(val);
        return u.protocol === "http:" || u.protocol === "https:";
      } catch {
        return false;
      }
    },
    { message: "Please enter a valid http:// or https:// URL." }
  );

const signupSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(100),
  email: z.string().trim().email("Please enter a valid email address."),
  password: z.string().min(6, "Password must be at least 6 characters."),
});

const loginSchema = z.object({
  email: z.string().trim().email("Please enter a valid email address."),
  password: z.string().min(1, "Password is required."),
});

const createUrlSchema = z.object({
  url: httpUrlField,
  customAlias: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v === "" ? undefined : v))
    .refine((v) => !v || /^[a-zA-Z0-9_-]{3,30}$/.test(v), {
      message: "Custom alias must be 3–30 characters (letters, numbers, - or _).",
    }),
  expiresAt: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v === "" ? undefined : v)),
  maxClicks: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => {
      if (v === undefined || v === null || String(v).trim() === "") return undefined;
      return Number(v);
    })
    .refine((v) => v === undefined || (Number.isInteger(v) && v >= 1), {
      message: "Max clicks must be a positive integer.",
    }),
  linkPassword: z
    .string()
    .optional()
    .transform((v) => (v && v.trim() ? v.trim() : undefined)),
  tags: z.union([z.string(), z.array(z.string())]).optional(),
  utmSource: z.string().trim().optional(),
  utmMedium: z.string().trim().optional(),
  utmCampaign: z.string().trim().optional(),
  webhookUrl: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v === "" ? undefined : v)),
});

const editUrlSchema = z.object({
  redirectId: httpUrlField,
  webhookUrl: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v === "" ? "" : v)),
});

module.exports = {
  signupSchema,
  loginSchema,
  createUrlSchema,
  editUrlSchema,
};
