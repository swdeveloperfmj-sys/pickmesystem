import { z } from "zod";
import { AuditLog, TransportRequest, User } from "./models.js";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
});
const query = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  search: z.string().trim().max(100).default(""),
  source: z.enum(["", "SYSTEM", "TRANSPORT"]).default(""),
  from: date.optional(), to: date.optional(),
}).refine((value) => !value.from || !value.to || value.from <= value.to, { message: "Start date must not follow end date." });

export function registerAuditLogs(app) {
  app.get("/api/super-admin/audit-logs", async (req, res) => {
    const filters = query.parse(req.query);
    const match = {};
    if (filters.source) match.source = filters.source;
    if (filters.from || filters.to) {
      match.at = {};
      // Date filters use Sri Lanka calendar days, matching the UI timezone.
      if (filters.from) match.at.$gte = new Date(`${filters.from}T00:00:00+05:30`);
      if (filters.to) match.at.$lt = new Date(new Date(`${filters.to}T00:00:00+05:30`).getTime() + 86400000);
    }
    if (filters.search) {
      const literal = filters.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      match.$or = ["event", "actorName", "ip", "note", "reference"].map((key) => ({ [key]: { $regex: literal, $options: "i" } }));
    }
    const [result] = await AuditLog.aggregate([
      { $lookup: { from: User.collection.name, localField: "userId", foreignField: "_id", as: "actor" } },
      { $project: { event: 1, ip: 1, at: "$createdAt", actorName: { $ifNull: [{ $arrayElemAt: ["$actor.fullName", 0] }, "Unknown / unauthenticated"] }, source: { $literal: "SYSTEM" }, reference: { $toString: "$_id" }, note: { $literal: "" } } },
      { $unionWith: { coll: TransportRequest.collection.name, pipeline: [
        { $unwind: { path: "$history", includeArrayIndex: "eventIndex" } },
        { $project: { _id: { $concat: [{ $toString: "$_id" }, "-", { $toString: "$eventIndex" }] }, event: "$history.action", at: "$history.at", actorName: "$history.actorName", note: "$history.note", reference: { $toString: "$_id" }, source: { $literal: "TRANSPORT" } } },
      ] } },
      { $match: match },
      { $facet: { rows: [{ $sort: { at: -1, _id: -1 } }, { $skip: (filters.page - 1) * 25 }, { $limit: 25 }], count: [{ $count: "total" }] } },
    ]);
    res.set("Cache-Control", "no-store").json({ logs: result.rows, total: result.count[0]?.total || 0, page: filters.page, pageSize: 25 });
  });
}
