/* eslint-disable */
/**
 * Generated `ComponentApi` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type { FunctionReference } from "convex/server";

/**
 * A utility for referencing a Convex component's exposed API.
 *
 * Useful when expecting a parameter like `components.myComponent`.
 * Usage:
 * ```ts
 * async function myFunction(ctx: QueryCtx, component: ComponentApi) {
 *   return ctx.runQuery(component.someFile.someQuery, { ...args });
 * }
 * ```
 */
export type ComponentApi<Name extends string | undefined = string | undefined> =
  {
    employee: {
      add: FunctionReference<
        "mutation",
        "internal",
        {
          displayName?: string;
          email: string;
          employeeId?: string;
          entityId: string;
          firstName: string;
          lastName: string;
          profileImageUrl?: string;
          roles?: Array<string>;
          status?: "ACTIVE" | "INVITED" | "SUSPENDED";
        },
        any,
        Name
      >;
      findEntitiesByEmail: FunctionReference<
        "query",
        "internal",
        { email: string },
        any,
        Name
      >;
      get: FunctionReference<
        "query",
        "internal",
        { employeeId: string; entityId: string },
        any,
        Name
      >;
      getEntityIdByEmail: FunctionReference<
        "query",
        "internal",
        { email: string },
        any,
        Name
      >;
      getUserIdByEmail: FunctionReference<
        "query",
        "internal",
        { email: string },
        any,
        Name
      >;
      list: FunctionReference<
        "query",
        "internal",
        { entityId: string },
        any,
        Name
      >;
      remove: FunctionReference<
        "mutation",
        "internal",
        { employeeId: string; entityId: string },
        any,
        Name
      >;
      update: FunctionReference<
        "mutation",
        "internal",
        {
          displayName?: string;
          email?: string;
          employeeId: string;
          entityId: string;
          firstName?: string;
          lastName?: string;
          profileImageUrl?: string;
          roles?: Array<string>;
          status?: "ACTIVE" | "INVITED" | "SUSPENDED";
        },
        any,
        Name
      >;
    };
    entity: {
      create: FunctionReference<
        "mutation",
        "internal",
        {
          address?: {
            city?: string;
            country?: string;
            line1?: string;
            line2?: string;
            state?: string;
            zip?: string;
          };
          autoRechargeEnabled?: boolean;
          businessRegistrationNumber?: string;
          email?: string;
          firstName?: string;
          lastName?: string;
          name: string;
          phoneNumber?: string;
          tags?: Array<string>;
          userId?: string;
          websiteUrl?: string;
        },
        any,
        Name
      >;
      get: FunctionReference<
        "query",
        "internal",
        { entityId: string },
        any,
        Name
      >;
      getDetails: FunctionReference<
        "query",
        "internal",
        { entityId: string },
        any,
        Name
      >;
      list: FunctionReference<"query", "internal", {}, any, Name>;
      remove: FunctionReference<
        "mutation",
        "internal",
        { entityId: string },
        any,
        Name
      >;
      update: FunctionReference<
        "mutation",
        "internal",
        {
          activePlans?: any;
          address?: {
            city?: string;
            country?: string;
            line1?: string;
            line2?: string;
            state?: string;
            zip?: string;
          };
          autoRechargeEnabled?: boolean;
          businessRegistrationNumber?: string;
          email?: string;
          entitlements?: any;
          entityId: string;
          isActive?: boolean;
          name?: string;
          phoneNumber?: string;
          tags?: Array<string>;
          websiteUrl?: string;
        },
        any,
        Name
      >;
    };
    product: {
      assignProduct: FunctionReference<
        "mutation",
        "internal",
        {
          allocated?: number;
          employeeId: string;
          entityId: string;
          isEnabled?: boolean;
          productId: string;
        },
        any,
        Name
      >;
      assignProductByEmail: FunctionReference<
        "mutation",
        "internal",
        { allocated?: number; email: string; productId: string },
        any,
        Name
      >;
      assignProductsToEmployee: FunctionReference<
        "mutation",
        "internal",
        { employeeId: string; entityId: string; products: any },
        any,
        Name
      >;
      assignProductToEmployee: FunctionReference<
        "mutation",
        "internal",
        {
          allocated?: number;
          customFields?: any;
          employeeId: string;
          enabled?: boolean;
          entityId: string;
          productId: string;
        },
        any,
        Name
      >;
      assignStandaloneProduct: FunctionReference<
        "mutation",
        "internal",
        {
          employeeId: string;
          entityId: string;
          isEnabled?: boolean;
          metadata?: any;
          productId: string;
        },
        any,
        Name
      >;
      assignStandaloneProductByEmail: FunctionReference<
        "mutation",
        "internal",
        {
          email: string;
          isEnabled?: boolean;
          metadata?: any;
          productId: string;
        },
        any,
        Name
      >;
      deleteProductByEmail: FunctionReference<
        "mutation",
        "internal",
        { email: string; productId: string },
        any,
        Name
      >;
      getCurrentCounter: FunctionReference<
        "query",
        "internal",
        { entityId: string },
        any,
        Name
      >;
      getEmployeeProduct: FunctionReference<
        "query",
        "internal",
        { employeeId: string; entityId: string; productId: string },
        any,
        Name
      >;
      getPlan: FunctionReference<
        "query",
        "internal",
        { entityId: string; planId: string; productId: string },
        any,
        Name
      >;
      getProduct: FunctionReference<
        "query",
        "internal",
        { entityId: string; productId: string },
        any,
        Name
      >;
      getProductByEmail: FunctionReference<
        "query",
        "internal",
        { email: string; productId: string },
        any,
        Name
      >;
      incrementCounter: FunctionReference<
        "mutation",
        "internal",
        {
          employeeId?: string;
          entityId: string;
          idempotencyKey?: string;
          productId: string;
          units: number;
        },
        any,
        Name
      >;
      isProductActive: FunctionReference<
        "query",
        "internal",
        { employeeId: string; entityId: string; productId: string },
        any,
        Name
      >;
      listEmployeeProducts: FunctionReference<
        "query",
        "internal",
        {
          assignedOnly?: boolean;
          employeeId: string;
          entityId: string;
          productType?: "token" | "feature" | "all";
        },
        any,
        Name
      >;
      listPlans: FunctionReference<
        "query",
        "internal",
        { entityId: string; productId: string },
        any,
        Name
      >;
      listProducts: FunctionReference<
        "query",
        "internal",
        { entityId: string },
        any,
        Name
      >;
      listProductsByEmail: FunctionReference<
        "query",
        "internal",
        { email: string },
        any,
        Name
      >;
      readSubscriptionStatus: FunctionReference<
        "query",
        "internal",
        { entityId: string },
        any,
        Name
      >;
      readTokenStatus: FunctionReference<
        "query",
        "internal",
        { entityId: string },
        any,
        Name
      >;
      removeProductFromEmployee: FunctionReference<
        "mutation",
        "internal",
        { employeeId: string; entityId: string; productId: string },
        any,
        Name
      >;
      setProductEnabled: FunctionReference<
        "mutation",
        "internal",
        {
          employeeId: string;
          entityId: string;
          isEnabled: boolean;
          productId: string;
        },
        any,
        Name
      >;
      upsertPlan: FunctionReference<
        "mutation",
        "internal",
        {
          billingCycle?: "monthly" | "annual";
          currency?: string;
          entitlements?: any;
          entityId: string;
          features?: Array<string>;
          isActive?: boolean;
          limits?: any;
          name: string;
          overage?: any;
          planId: string;
          price: number;
          productId: string;
          trialDays?: number;
        },
        any,
        Name
      >;
      upsertProduct: FunctionReference<
        "mutation",
        "internal",
        {
          defaultPlanId?: string;
          entityId: string;
          overrides?: any;
          productId: string;
          status?: "active" | "paused";
        },
        any,
        Name
      >;
    };
    settings: {
      create: FunctionReference<
        "mutation",
        "internal",
        {
          businessType?: string;
          customerServiceEmail?: string;
          customerServicePhoneNumber?: string;
          entityBackground?: string;
          entityId: string;
          extraInformation?: string;
          isActive?: boolean;
          laborAndWarranty?: string;
          logo?: string;
          pricing?: string;
          productsAndServices?: string;
          promptUrl?: string;
          serviceArea?: string;
          websiteUrl?: string;
        },
        any,
        Name
      >;
      get: FunctionReference<
        "query",
        "internal",
        { entityId: string; settingsId: string },
        any,
        Name
      >;
      list: FunctionReference<
        "query",
        "internal",
        { entityId: string },
        any,
        Name
      >;
      remove: FunctionReference<
        "mutation",
        "internal",
        { entityId: string; settingsId: string },
        any,
        Name
      >;
      update: FunctionReference<
        "mutation",
        "internal",
        {
          businessType?: string;
          customerServiceEmail?: string;
          customerServicePhoneNumber?: string;
          entityBackground?: string;
          entityId: string;
          extraInformation?: string;
          isActive?: boolean;
          laborAndWarranty?: string;
          logo?: string;
          pricing?: string;
          productsAndServices?: string;
          promptUrl?: string;
          serviceArea?: string;
          settingsId: string;
          websiteUrl?: string;
        },
        any,
        Name
      >;
    };
    slmWaitlist: {
      checkWaitlistStatus: FunctionReference<
        "query",
        "internal",
        { entityId: string },
        any,
        Name
      >;
      getAllWaitlistEntries: FunctionReference<
        "query",
        "internal",
        {},
        any,
        Name
      >;
      joinWaitlist: FunctionReference<
        "mutation",
        "internal",
        { email: string; entityId: string; entityName?: string },
        any,
        Name
      >;
      updateWaitlistStatus: FunctionReference<
        "mutation",
        "internal",
        { status: "pending" | "approved" | "rejected"; waitlistId: string },
        any,
        Name
      >;
    };
    tokens: {
      getUserTokens: FunctionReference<
        "query",
        "internal",
        { employeeId: string; entityId: string; productId?: string },
        any,
        Name
      >;
      incrementUserTokens: FunctionReference<
        "mutation",
        "internal",
        {
          employeeId: string;
          entityId: string;
          productId: string;
          units?: number;
        },
        any,
        Name
      >;
      resetUserTokens: FunctionReference<
        "mutation",
        "internal",
        { employeeId: string; entityId: string; productId?: string },
        any,
        Name
      >;
      setUserTokens: FunctionReference<
        "mutation",
        "internal",
        {
          allocated?: number;
          employeeId: string;
          entityId: string;
          productId?: string;
          products?: any;
        },
        any,
        Name
      >;
    };
  };
