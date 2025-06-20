import { getAssetFromKV } from '@cloudflare/kv-asset-handler';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // Redirect /admin to /admin.html
    if (pathname === "/admin") {
      const absoluteUrl = new URL("/admin.html", request.url).toString();
      return Response.redirect(absoluteUrl, 302);
    }

    // API: List messages (paginated, grouped)
    if (pathname === "/admin/messages" && request.method === "GET") {
      const searchParams = url.searchParams;
      const page = parseInt(searchParams.get("page")) || 1;
      const perPage = parseInt(searchParams.get("perPage")) || 50;
      const q = searchParams.get("q")?.trim() || "";
      const tag = searchParams.get("tag") || "";
      const dir = searchParams.get("dir") || "";

      let where = [], params = [];
      if (q) {
        where.push("(body LIKE ? OR from_number LIKE ? OR CAST(customer_id AS TEXT) LIKE ?)");
        params.push(`%${q}%`, `%${q}%`, `%${q}%`);
      }
      if (tag) {
        where.push("tag = ?");
        params.push(tag);
      }
      if (dir) {
        where.push("direction = ?");
        params.push(dir);
      }
      const whereClause = where.length ? "WHERE " + where.join(" AND ") : "";

      // Count total
      const countSql = `SELECT COUNT(*) as cnt FROM messages ${whereClause}`;
      const { results: [{ cnt: totalCount }] } = await env.DB.prepare(countSql).bind(...params).all();
      const totalPages = Math.ceil(totalCount / perPage);

      // Query page
      const sql = `
        SELECT * FROM messages
        ${whereClause}
        ORDER BY timestamp DESC
        LIMIT ? OFFSET ?
      `;
      const pageParams = params.concat([perPage, (page - 1) * perPage]);
      const { results } = await env.DB.prepare(sql).bind(...pageParams).all();

      // Group by from_number
      const groups = {};
      for (const m of results) {
        const number = m.from_number || "";
        if (!groups[number]) groups[number] = [];
        groups[number].push({
          id: m.id,
          from_number: number,
          body: m.body,
          tag: m.tag || "unverified",
          direction: m.direction,
          timestamp: m.timestamp,
          customer_id: m.customer_id,
        });
      }
      return Response.json({ groups, totalPages });
    }

    // API: Tag a message
    if (pathname === "/admin/tag" && request.method === "POST") {
      const { id, tag } = await request.json();
      await env.DB.prepare("UPDATE messages SET tag = ? WHERE id = ?").bind(tag, id).run();
      return Response.json({ ok: true });
    }

    // API: Reply/send WhatsApp message
    if (pathname === "/admin/reply" && request.method === "POST") {
      const { id, number, body } = await request.json();
      const waUrl = `https://graph.facebook.com/v17.0/${env.PHONE_NUMBER_ID}/messages`;
      const waBody = {
        messaging_product: 'whatsapp',
        to: number,
        type: 'text',
        text: { body }
      };
      await fetch(waUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(waBody)
      });
      const now = Math.floor(Date.now() / 1000);
      await env.DB.prepare(`
        INSERT INTO messages (from_number, body, tag, timestamp, direction, customer_id)
        VALUES (?, ?, 'unverified', ?, 'outgoing', NULL)
      `).bind(number, body, now).run();
      return Response.json({ ok: true });
    }

    // Serve static assets from KV
    try {
      return await getAssetFromKV(
        { request },
        {
          cacheControl: { bypassCache: true },
          ASSET_NAMESPACE: env.__vinet-whatsapp-worker-workers_sites_assets
        }
      );
    } catch (e) {
      return new Response("Not found", { status: 404 });
    }
  }
}
