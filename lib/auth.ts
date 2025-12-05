import { checkout, polar, portal } from "@polar-sh/better-auth";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import prisma from "@/lib/db";
import { polarClient } from "./polar";
import { randomUUID } from "crypto"; 

// ✅ Convex imports
import { ConvexHttpClient } from "convex/browser"; // or "convex/node" depending on your setup
import { api } from "../../convex/_generated/api"; // adjust path

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
  },
  socialProviders: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID as string,
      clientSecret: process.env.GITHUB_CLIENT_SECRET as string,
    },
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID as string,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
    },
  },
  plugins: [
    polar({
      client: polarClient,
      createCustomerOnSignUp: true,
      use: [
        checkout({
          products: [
            {
              productId: "5607e0ef-7abe-4a63-a1ea-cdc4d5c85b5b",
              slug: "pro",
            },
          ],
          successUrl: process.env.POLAR_SUCCESS_URL,
          authenticatedUsersOnly: true,
        }),
        portal(),
      ],
    }),
  ],

  // ✅ THIS is what you want, not hooks.user
  databaseHooks: {
    user: {
      create: {
        async after(user, ctx) {
          // user here is the Better Auth user

          // Safeguard: don't crash auth if Convex is down
          try {
            await convex.mutation(api.users.add, {
  name: user.name ?? user.email,
  email: user.email,
  authId: user.id,
  organizationId:randomUUID().replace(/-/g, "").slice(0, 5), // ✅ now we pass organizationId
});
          } catch (e) {
            console.error("Failed to sync user to Convex:", e);
          }
        },
      },
    },
  },
});
