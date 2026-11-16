// Every authorisation decision lives here, so the UI can hide buttons for
// convenience while the real check runs on the server for every call.
import { ConvexError } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

export type Viewer = Doc<"users">;

// The identity comes from a Clerk JWT that Convex has already verified.
// We never trust a user id passed as a function argument.
export async function getViewer(ctx: QueryCtx): Promise<Viewer | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return await ctx.db
    .query("users")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();
}

export async function requireUser(ctx: QueryCtx): Promise<Viewer> {
  const viewer = await getViewer(ctx);
  if (!viewer) throw new ConvexError("Sign in first");
  return viewer;
}

export async function requireAdmin(ctx: QueryCtx): Promise<Viewer> {
  const viewer = await requireUser(ctx);
  if (viewer.role !== "admin") throw new ConvexError("Admins only");
  return viewer;
}

// Pure rules, kept separate from the database so the tests can read like the spec.
export const canEditTool = (viewer: Viewer, tool: Doc<"tools">) =>
  tool.ownerId === viewer._id;

export const canRemoveTool = (viewer: Viewer, tool: Doc<"tools">) =>
  tool.ownerId === viewer._id || viewer.role === "admin";

// Only the lender decides on, and closes, loans of their own tools. Admins can
// view every loan but do not act on someone else's behalf.
export const canDecideLoan = (viewer: Viewer, loan: Doc<"loans">) =>
  loan.ownerId === viewer._id;

export const canViewLoan = (viewer: Viewer, loan: Doc<"loans">) =>
  loan.ownerId === viewer._id || loan.borrowerId === viewer._id || viewer.role === "admin";

// Dates are calendar days (YYYY-MM-DD) compared as strings; "today" is UTC.
// Known limit: UTC "today", store a per-user time zone if reminders must follow local midnight.
export const todayUtc = (nowMs = Date.now()) => new Date(nowMs).toISOString().slice(0, 10);

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(value); // rejects 2026-02-31
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000);
}

export function cleanText(value: string, field: string, max: number, min = 1): string {
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) {
    throw new ConvexError(`${field} must be ${min}-${max} characters`);
  }
  return trimmed;
}
