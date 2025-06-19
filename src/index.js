export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname, searchParams } = url;

    // Admin HTML served from site bucket
    if (pathname === '/admin') {
      return env.ASSETS.fetch(request);
    }

    // List messages
    if (pathname === '/admin/messages') {
      const messages = await env.DB.prepare(
        `SELECT * FROM messages ORDER BY timestamp DESC LIMIT 100`
      ).all();
      return Response.json(messages.results);
    }

    // Tag messages
    if (pathname === '/admin/tag' && request.method === 'POST') {
      const { id, tag } = await request.json();
      await env.DB.prepare('UPDATE messages SET tag = ? WHERE id = ?').bind(tag, id).run();
      return new Response('Tag updated');
    }

    // Webhook verification
    if (pathname === '/webhook' && request.method === 'GET') {
      const mode = searchParams.get('hub.mode');
      const token = searchParams.get('hub.verify_token');
      const challenge = searchParams.get('hub.challenge');
      if (mode === 'subscribe' && token === env.VERIFY_TOKEN) {
        return new Response(challenge, { status: 200 });
      }
      return new Response('Forbidden', { status: 403 });
    }

    return new Response('Not Found', { status: 404 });
  }
};
