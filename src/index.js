export default {
  async fetch(request, env, ctx) {
    const { pathname, searchParams } = new URL(request.url);

    // Admin UI
    if (pathname === '/admin') {
      return env.ASSETS.fetch(request);
    }

    // Grouped messages endpoint
    if (pathname === '/admin/messages') {
      const messages = await env.DB.prepare(
        `SELECT * FROM messages ORDER BY timestamp DESC LIMIT 300`
      ).all();

      const grouped = {};
      for (const m of messages.results) {
        if (!grouped[m.from_number]) grouped[m.from_number] = [];
        grouped[m.from_number].push(m);
      }

      return Response.json(grouped);
    }

    // Tag update endpoint
    if (pathname === '/admin/tag' && request.method === 'POST') {
      const { id, tag } = await request.json();
      await env.DB.prepare('UPDATE messages SET tag = ? WHERE id = ?')
        .bind(tag, id)
        .run();
      return new Response('Tag updated');
    }

    // Webhook verification
    if (pathname === '/webhook' && request.method === 'GET') {
      const u = new URL(request.url);
      const mode = u.searchParams.get('hub.mode');
      const token = u.searchParams.get('hub.verify_token');
      const challenge = u.searchParams.get('hub.challenge');

      if (mode === 'subscribe' && token === env.VERIFY_TOKEN) {
        return new Response(challenge, { status: 200 });
      }
      return new Response('Forbidden', { status: 403 });
    }

    return new Response('Not Found', { status: 404 });
  }
}
