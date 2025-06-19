
export default {
  async fetch(request, env, ctx) {
    const { pathname, searchParams } = new URL(request.url)

    // Webhook verification
    if (pathname === '/webhook' && request.method === 'GET') {
      const mode = searchParams.get('hub.mode')
      const token = searchParams.get('hub.verify_token')
      const challenge = searchParams.get('hub.challenge')
      if (mode === 'subscribe' && token === env.VERIFY_TOKEN) {
        return new Response(challenge, { status: 200 })
      }
      return new Response('Forbidden', { status: 403 })
    }

    // Handle incoming webhook
    if (pathname === '/webhook' && request.method === 'POST') {
      const data = await request.json()
      const entry = data.entry?.[0]?.changes?.[0]?.value
      const msg = entry?.messages?.[0]
      const from = msg?.from
      const type = msg?.type

      let body = ''
      if (type === 'text') body = msg.text.body
      else if (type === 'image') {
        const mediaId = msg.image.id
        const mediaUrlRes = await fetch(`https://graph.facebook.com/v18.0/${mediaId}`, {
          headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}` }
        })
        const mediaUrlData = await mediaUrlRes.json()
        const mediaUrl = mediaUrlData.url

        const blob = await fetch(mediaUrl, {
          headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}` }
        }).then(r => r.arrayBuffer())

        const base64 = encode(blob)
        const key = `${Date.now()}-${mediaId}.jpg`
        await env['vinet-whatsapp-images'].put(key, base64, { httpMetadata: { contentType: 'image/jpeg' } })
        body = `Image received: https://pub-${env['vinet-whatsapp-images'].bucket_name}.r2.dev/${key}`
      } else if (type === 'location') {
        const { latitude, longitude } = msg.location
        body = `Location: https://maps.google.com/?q=${latitude},${longitude}`
      }

      const timestamp = Date.now()
      await env.DB.prepare(
        'INSERT INTO messages (from_number, body, direction, timestamp) VALUES (?, ?, ?, ?)'
      ).bind(from, body, 'in', timestamp).run()

      return new Response('ok')
    }

    // Admin routes
    if (pathname === '/admin/messages') {
      const tag = searchParams.get('tag')
      let query = 'SELECT * FROM messages'
      if (tag) query += ' WHERE tag = ?'
      query += ' ORDER BY timestamp DESC LIMIT 100'
      const stmt = env.DB.prepare(query)
      const res = tag ? await stmt.bind(tag).all() : await stmt.all()
      return Response.json(res.results)
    }

    if (pathname === '/admin/send' && request.method === 'POST') {
      const { to, message } = await request.json()
      const res = await fetch(`https://graph.facebook.com/v18.0/${env.PHONE_NUMBER_ID}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          text: { body: message }
        })
      })

      const response = await res.json()
      await env.DB.prepare(
        'INSERT INTO messages (from_number, body, direction, timestamp) VALUES (?, ?, ?, ?)'
      ).bind(to, message, 'out', Date.now()).run()

      return Response.json(response)
    }

    if (pathname === '/admin/tag' && request.method === 'POST') {
      const { id, tag } = await request.json()
      await env.DB.prepare('UPDATE messages SET tag = ? WHERE id = ?').bind(tag, id).run()
      return new Response('ok')
    }

    if (pathname === '/admin') {
      const html = await env['__vinet-whatsapp-worker-workers_sites_assets'].get('admin.html', 'text')
      return new Response(html, { headers: { 'Content-Type': 'text/html' } })
    }

    return new Response('Not Found', { status: 404 })
  }
}
