export const isDemo =
  process.env.NEXT_PUBLIC_MODE === "demo" ||
  process.env.NEXT_PUBLIC_DEMO === "1";
