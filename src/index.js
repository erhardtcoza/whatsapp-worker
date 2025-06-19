export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname, searchParams } = url;

    // Admin HTML served from site bucket
    if (pathname === '/admin') {
      return env.ASSETS.fetch(request);
    }
    // Send message from admin
    if (pathname === '/admin/send' && request.method === 'POST') {
      const { to, body } = await request.json();
      const res = await fetch(`https://graph.facebook.com/v18.0/${env.PHONE_NUMBER_ID}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          text: { body },
          type: 'text'
        })
      });
      const json = await res.json();
      console.log('WhatsApp Send Response:', json);

      if (json.messages) {
        await env.DB.prepare(`INSERT INTO messages (from_number, body, timestamp, direction, tag) VALUES (?, ?, ?, ?, ?)`)
          .bind(to, body, Date.now(), 'out', 'admin').run();
        return new Response('Message sent successfully');
      } else {
        return new Response('Failed to send message: ' + (json.error?.message || 'Unknown error'), { status: 500 });
      }
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
