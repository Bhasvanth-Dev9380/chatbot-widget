/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as employee from "../employee.js";
import type * as entity from "../entity.js";
import type * as functions from "../functions.js";
import type * as helpers from "../helpers.js";
import type * as product from "../product.js";
import type * as settings from "../settings.js";
import type * as slmWaitlist from "../slmWaitlist.js";
import type * as tokens from "../tokens.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import { anyApi, componentsGeneric } from "convex/server";

const fullApi: ApiFromModules<{
  employee: typeof employee;
  entity: typeof entity;
  functions: typeof functions;
  helpers: typeof helpers;
  product: typeof product;
  settings: typeof settings;
  slmWaitlist: typeof slmWaitlist;
  tokens: typeof tokens;
}> = anyApi as any;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
> = anyApi as any;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
> = anyApi as any;

export const components = componentsGeneric() as unknown as {};
