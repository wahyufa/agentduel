import { NextRequest } from 'next/server'
import { AGENTS } from '@/lib/agents'

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1'
const MODEL = 'minimax/minimax-m2.5:free'

export async function POST(req: NextRequest) {
  const { agentId, topic, history } = await req.json()

  const agent = AGENTS[agentId]
  if (!agent) return new Response('Agent not found', { status: 404 })

  // Build messages: system prompt + debate history
  const messages = [
    { role: 'system', content: agent.systemPrompt },
    {
      role: 'user',
      content: `You are in a live debate. The topic is: "${topic}". ${
        history.length === 0
          ? 'Make your opening argument. Be direct and bold.'
          : `The debate so far:\n${history.map((h: { speaker: string; text: string }) => `${h.speaker}: ${h.text}`).join('\n')}\n\nNow respond to the last point. Be sharp and direct.`
      }`,
    },
  ]

  const upstreamRes = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://agentduel.xyz',
      'X-Title': 'AgentDuel',
    },
    body: JSON.stringify({
      model: MODEL,
      stream: true,
      max_tokens: 120,
      temperature: 0.85,
      messages,
    }),
  })

  if (!upstreamRes.ok) {
    const err = await upstreamRes.text()
    return new Response(`OpenRouter error: ${err}`, { status: 500 })
  }

  // Stream directly to client
  const stream = new ReadableStream({
    async start(controller) {
      const reader = upstreamRes.body!.getReader()
      const decoder = new TextDecoder()

      while (true) {
        const { done, value } = await reader.read()
        if (done) { controller.close(); break }

        const chunk = decoder.decode(value)
        const lines = chunk.split('\n').filter(l => l.startsWith('data: '))

        for (const line of lines) {
          const data = line.replace('data: ', '').trim()
          if (data === '[DONE]') { controller.close(); return }

          try {
            const json = JSON.parse(data)
            const text = json.choices?.[0]?.delta?.content
            if (text) controller.enqueue(new TextEncoder().encode(text))
          } catch {}
        }
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    },
  })
}
