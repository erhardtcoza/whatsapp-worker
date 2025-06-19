import adminHtml from './admin.html';

export default {
  async fetch(request, env, ctx) {
    const { pathname, searchParams } = new URL(request.url);

    // Admin panel UI
    if (pathname === '/admin') {
      return new Response(adminHtml, { headers: { 'Content-Type': 'text/html' } });
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

    // Webhook receiver for WhatsApp messages
    if (pathname === '/webhook' && request.method === 'POST') {
      const body = await request.json();
      const entry = body.entry?.[0];
      const message = entry?.changes?.[0]?.value?.messages?.[0];
      const from = message?.from;
      const type = message?.type;

      if (from && type === 'text') {
        const text = message.text.body;
        await env.DB.prepare(
          'INSERT INTO messages (from_number, body, timestamp, direction) VALUES (?, ?, ?, ?)'
        ).bind(from, text, Date.now(), 'in').run();

        return new Response('Received', { status: 200 });
      }

      return new Response('Ignored', { status: 204 });
    }

    // Broadcast form submission
    if (pathname === '/admin/broadcast' && request.method === 'POST') {
      const { message, numbers } = await request.json();
      const tasks = numbers.map(num => sendWhatsAppMessage(env, num, message));
      await Promise.all(tasks);
      return new Response('Broadcast sent');
    }

    // Send individual message
    if (pathname === '/admin/send' && request.method === 'POST') {
      const { to, body } = await request.json();
      const response = await sendWhatsAppMessage(env, to, body);
      return Response.json({ response });
    }

    return new Response('Not Found', { status: 404 });
  }
};

async function sendWhatsAppMessage(env, to, body) {
  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body }
  };

  const res = await fetch(`https://graph.facebook.com/v18.0/${env.PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.WHATSAPP_TOKEN}`
    },
    body: JSON.stringify(payload)
  });

  const result = await res.json();

  await env.DB.prepare(
    'INSERT INTO messages (from_number, body, timestamp, direction) VALUES (?, ?, ?, ?)'
  ).bind(to, body, Date.now(), 'out').run();

  return result;
}
