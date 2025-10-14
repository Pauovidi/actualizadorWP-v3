export const isDemo =
  process.env.NEXT_PUBLIC_MODE === "demo" ||
  process.env.NEXT_PUBLIC_DEMO === "1";

export const smtp = {
  host: process.env.MAIL_HOST || "",
  port: Number(process.env.MAIL_PORT || 0),
  secure: false,
  auth: {
    user: process.env.MAIL_USER || "",
    pass: process.env.MAIL_PASS || "",
  },
  from: process.env.MAIL_FROM || "Actualizador WP <no-reply@example.com>",
};
