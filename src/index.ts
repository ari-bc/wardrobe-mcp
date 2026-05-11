import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

interface Env {
  DB: D1Database;
  AUTH_TOKEN: string;
}

export class MyMCP extends McpAgent<Env> {
  server = new McpServer({ name: "Aria's Wardrobe", version: "1.0.0" });

  async init() {
    const db = this.env.DB;

    this.server.tool(
      "list_items",
      "List wardrobe items. Filter by category, vibe substring, formality, or status (default 'active'; use 'archived' for items on the way out).",
      {
        category: z.string().optional(),
        vibe: z.string().optional(),
        formality: z.string().optional(),
        status: z.string().optional(),
      },
      async ({ category, vibe, formality, status }) => {
        const where: string[] = [];
        const binds: any[] = [];
        if (category) { where.push("category = ?"); binds.push(category); }
        if (vibe) { where.push("vibe LIKE ?"); binds.push(`%${vibe}%`); }
        if (formality) { where.push("formality LIKE ?"); binds.push(`%${formality}%`); }
        where.push("status = ?"); binds.push(status || "active");
        const sql = `SELECT id, name, category, colour, fabric, vibe, formality, warmth, notes FROM items WHERE ${where.join(" AND ")} ORDER BY category, id`;
        const { results } = await db.prepare(sql).bind(...binds).all();
        return { content: [{ type: "text", text: JSON.stringify({ count: results.length, items: results }, null, 2) }] };
      }
    );

    this.server.tool(
      "get_item",
      "Get full details of a single wardrobe item by id.",
      { id: z.string() },
      async ({ id }) => {
        const item = await db.prepare("SELECT * FROM items WHERE id = ?").bind(id).first();
        return { content: [{ type: "text", text: item ? JSON.stringify(item, null, 2) : `Not found: ${id}` }] };
      }
    );

    this.server.tool(
      "add_item",
      "Add a new wardrobe item. id should be unique, lowercase-hyphenated, prefixed by category (e.g. TOP-velvet-burgundy, DRS-halter-mini-black).",
      {
        id: z.string(),
        category: z.string(),
        name: z.string().optional(),
        colour: z.string().optional(),
        fabric: z.string().optional(),
        silhouette: z.string().optional(),
        neckline: z.string().optional(),
        length: z.string().optional(),
        sleeves: z.string().optional(),
        cleavage: z.string().optional(),
        midriff: z.string().optional(),
        back: z.string().optional(),
        legs: z.string().optional(),
        tattoos: z.string().optional(),
        bra: z.string().optional(),
        warmth: z.number().int().min(1).max(5).optional(),
        formality: z.string().optional(),
        vibe: z.string().optional(),
        notes: z.string().optional(),
        starred: z.number().int().min(0).max(1).optional(),
      },
      async (input) => {
        const cols = Object.keys(input).filter(k => (input as any)[k] !== undefined);
        const vals = cols.map(c => (input as any)[c]);
        const placeholders = cols.map(() => "?").join(", ");
        try {
          await db.prepare(`INSERT INTO items (${cols.join(", ")}) VALUES (${placeholders})`).bind(...vals).run();
          return { content: [{ type: "text", text: `Added: ${input.id}` }] };
        } catch (e: any) {
          return { content: [{ type: "text", text: `Error: ${e.message}` }] };
        }
      }
    );

    this.server.tool(
      "update_item",
      "Update fields on an existing item. Pass id and any fields to change. Use status='archived' to retire a piece.",
      {
        id: z.string(),
        category: z.string().optional(),
        name: z.string().optional(),
        colour: z.string().optional(),
        fabric: z.string().optional(),
        silhouette: z.string().optional(),
        neckline: z.string().optional(),
        length: z.string().optional(),
        sleeves: z.string().optional(),
        cleavage: z.string().optional(),
        midriff: z.string().optional(),
        back: z.string().optional(),
        legs: z.string().optional(),
        tattoos: z.string().optional(),
        bra: z.string().optional(),
        warmth: z.number().int().min(1).max(5).optional(),
        formality: z.string().optional(),
        vibe: z.string().optional(),
        notes: z.string().optional(),
        starred: z.number().int().min(0).max(1).optional(),
        status: z.string().optional(),
      },
      async (input) => {
        const { id, ...rest } = input;
        const cols = Object.keys(rest).filter(k => (rest as any)[k] !== undefined);
        if (cols.length === 0) return { content: [{ type: "text", text: "No fields to update" }] };
        const sets = cols.map(c => `${c} = ?`).concat(["updated_at = unixepoch()"]);
        const binds = cols.map(c => (rest as any)[c]).concat([id]);
        const res = await db.prepare(`UPDATE items SET ${sets.join(", ")} WHERE id = ?`).bind(...binds).run();
        return { content: [{ type: "text", text: `Updated ${id} (${res.meta.changes} row(s) changed)` }] };
      }
    );

    this.server.tool(
      "archive_item",
      "Soft-delete: mark as 'archived' (on the way out). Prefer this over delete_item for normal retirements.",
      { id: z.string() },
      async ({ id }) => {
        await db.prepare("UPDATE items SET status = 'archived', updated_at = unixepoch() WHERE id = ?").bind(id).run();
        return { content: [{ type: "text", text: `Archived: ${id}` }] };
      }
    );

    this.server.tool(
      "delete_item",
      "Permanently delete. Only for true mistakes or duplicates — prefer archive_item.",
      { id: z.string() },
      async ({ id }) => {
        await db.prepare("DELETE FROM items WHERE id = ?").bind(id).run();
        return { content: [{ type: "text", text: `Deleted: ${id}` }] };
      }
    );

    this.server.tool(
      "search_items",
      "Free-text search across id, name, colour, fabric, vibe, silhouette, and notes.",
      { q: z.string() },
      async ({ q }) => {
        const like = `%${q}%`;
        const { results } = await db.prepare(
          `SELECT id, name, category, colour, vibe, notes FROM items
           WHERE id LIKE ? OR name LIKE ? OR colour LIKE ? OR fabric LIKE ?
              OR vibe LIKE ? OR silhouette LIKE ? OR notes LIKE ?
           ORDER BY category, id`
        ).bind(like, like, like, like, like, like, like).all();
        return { content: [{ type: "text", text: JSON.stringify({ count: results.length, items: results }, null, 2) }] };
      }
    );
  }
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);

    const authHeader = request.headers.get("Authorization") || "";
    const headerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    const queryToken = url.searchParams.get("token");
    if ((headerToken || queryToken) !== env.AUTH_TOKEN) {
      return new Response("Unauthorized", { status: 401 });
    }

    if (url.pathname === "/sse" || url.pathname === "/sse/message") {
      return MyMCP.serveSSE("/sse").fetch(request, env, ctx);
    }
    if (url.pathname === "/mcp") {
      return MyMCP.serve("/mcp").fetch(request, env, ctx);
    }
    return new Response("Wardrobe MCP — connect to /mcp", { status: 404 });
  },
};
