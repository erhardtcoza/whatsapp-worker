
async function sendWhatsAppMessage(to, message, env) {
  const url = `https://graph.facebook.com/v17.0/${env.PHONE_NUMBER_ID}/messages`;
  const body = {
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body: message }
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.WHATSAPP_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  const json = await res.json();
  console.log('WhatsApp Send Response:', json);
  return json;
}

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);

    // WEBHOOK VERIFICATION
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

    // ADMIN HTML
    if (pathname === '/admin') {
      const html = await env.__vinet-whatsapp-worker-workers_sites_assets.get('admin.html', 'text');
      return new Response(html, { headers: { 'Content-Type': 'text/html' } });
    }

    // ADMIN MESSAGES API
    if (pathname === '/admin/messages') {
      const url = new URL(request.url);
      const searchParams = url.searchParams;
      const tag = searchParams.get('tag');

      let query = 'SELECT * FROM messages';
      let bindParams = [];

      if (tag) {
        query += ' WHERE tag = ?';
        bindParams.push(tag);
      }

      query += ' ORDER BY timestamp DESC LIMIT 100';
      const messages = await env.DB.prepare(query).bind(...bindParams).all();
      return Response.json(messages.results);
    }

    // SEND MESSAGE API
    if (pathname === '/admin/send' && request.method === 'POST') {
      const body = await request.json();
      const { to, message } = body;

      const payload = {
        messaging_product: 'whatsapp',
        to,
        text: { body: message }
      };

      const response = await fetch(`https://graph.facebook.com/v18.0/${env.PHONE_NUMBER_ID}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      const result = await response.json();
      console.log("WhatsApp Send Response:", result);

      await env.DB.prepare(
        'INSERT INTO messages (from_number, body, direction, timestamp) VALUES (?, ?, ?, ?)'
      ).bind(to, message, 'out', Date.now()).run();

      return Response.json({ success: true });
    }

    return new Response('Not Found', { status: 404 });
  }
};
