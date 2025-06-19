// src/index.js
import { encode } from 'base64-arraybuffer';

export default {
  async fetch(request, env, ctx) {
    const { pathname, searchParams } = new URL(request.url);

    if (pathname === '/admin') {
      return new Response(adminHtml, { headers: { 'Content-Type': 'text/html' } });
    }

    if (pathname === '/admin/messages') {
      const messages = await env.DB.prepare('SELECT * FROM messages ORDER BY timestamp DESC LIMIT 100').all();
      return Response.json(messages.results);
    }

    if (pathname === '/admin/tag' && request.method === 'POST') {
      const { id, tag } = await request.json();
      await env.DB.prepare('UPDATE messages SET tag = ? WHERE id = ?').bind(tag, id).run();
      return new Response('Tag updated');
    }

    if (pathname === '/admin/send' && request.method === 'POST') {
      const { to, body } = await request.json();
      const resp = await fetch(`https://graph.facebook.com/v19.0/${env.PHONE_NUMBER_ID}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          text: { body }
        })
      });
      const data = await resp.json();
      console.log("WhatsApp Send Response:", data);
      await env.DB.prepare(
        'INSERT INTO messages (from_number, body, direction, timestamp, tag) VALUES (?, ?, ?, ?, ?)'
      ).bind(to, body, 'out', Date.now(), 'none').run();
      return Response.json({ success: true });
    }

    if (pathname === '/admin/settings' && request.method === 'GET') {
      const raw = await env['__vinet-whatsapp-worker-workers_sites_assets'].get('settings');
      return Response.json(raw ? JSON.parse(raw) : {});
    }

    if (pathname === '/admin/settings' && request.method === 'POST') {
      const incoming = await request.json();
      await env['__vinet-whatsapp-worker-workers_sites_assets'].put('settings', JSON.stringify(incoming));
      return new Response('Saved');
    }

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
};

const adminHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Vinet Admin Portal</title>
  <style>
    body { font-family: sans-serif; padding: 2rem; background: #f9f9f9; }
    h1 { color: #b00; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #ccc; padding: 0.5rem; }
    th { background: #eee; }
    select, input { padding: 0.3rem; }
  </style>
</head>
<body>
  <h1>Vinet WhatsApp Admin Portal</h1>
  <div>
    <h2>Send Message</h2>
    <form id="sendForm">
      <input name="to" placeholder="Customer Number" required />
      <input name="body" placeholder="Message Body" required />
      <button type="submit">Send</button>
    </form>
  </div>
  <div>
    <h2>Settings</h2>
    <form id="settingsForm">
      <textarea id="settingsInput" rows="10" cols="50"></textarea><br/>
      <button type="submit">Save Settings</button>
    </form>
  </div>
  <div id="messages">Loading messages...</div>

  <script>
    async function loadMessages() {
      const res = await fetch('/admin/messages');
      const messages = await res.json();
      const html = '<table><tr><th>From</th><th>Body</th><th>Tag</th><th>Time</th></tr>' +
        messages.map(m => \`
          <tr>
            <td>\${m.from_number}</td>
            <td>\${m.body}</td>
            <td>
              <select onchange="updateTag('\${m.id}', this.value)">
                \${['none','support','sales','accounts','lead'].map(tag => \`
                  <option value="\${tag}" \${tag === m.tag ? 'selected' : ''}>\${tag}</option>
                \`).join('')}
              </select>
            </td>
            <td>\${new Date(m.timestamp).toLocaleString()}</td>
          </tr>
        \`).join('') + '</table>';
      document.getElementById('messages').innerHTML = html;
    }

    async function updateTag(id, tag) {
      await fetch('/admin/tag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, tag })
      });
    }

    document.getElementById('sendForm').onsubmit = async (e) => {
      e.preventDefault();
      const to = e.target.to.value;
      const body = e.target.body.value;
      await fetch('/admin/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to, body })
      });
      alert('Message sent');
      e.target.reset();
    };

    document.getElementById('settingsForm').onsubmit = async (e) => {
      e.preventDefault();
      const input = document.getElementById('settingsInput').value;
      await fetch('/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: input
      });
      alert('Settings saved');
    };

    async function loadSettings() {
      const res = await fetch('/admin/settings');
      const json = await res.json();
      document.getElementById('settingsInput').value = JSON.stringify(json, null, 2);
    }

    loadSettings();
    loadMessages();
  </script>
</body>
</html>`;
