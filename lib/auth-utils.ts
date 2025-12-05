// src/lib/auth-utils.ts
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "./auth";

export const requireAuth = async () => {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  // Already authenticated → continue
  if (session) return session;

  // DEMO MODE: auto-login
  if (process.env.DEMO_MODE === "true") {
    redirect("/api/demo-login");
  }

  // Normal mode → redirect to login page
  redirect("/login");
};

export const requireUnauth = async () => {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  // If logged in → go home
  if (session) {
    redirect("/");
  }
};
