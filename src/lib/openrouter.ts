const OPENROUTER_BASE = 'https://openrouter.ai/api/v1'
const MODEL = 'minimax/minimax-m2.5:free'

export type Message = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export async function streamDebateResponse(
  messages: Message[],
  onChunk: (text: string) => void,
  onDone: () => void
): Promise<void> {
  const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
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

  if (!res.ok) {
    throw new Error(`OpenRouter error: ${res.status}`)
  }

  const reader = res.body?.getReader()
  if (!reader) throw new Error('No response body')

  const decoder = new TextDecoder()

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    const chunk = decoder.decode(value)
    const lines = chunk.split('\n').filter(l => l.startsWith('data: '))

    for (const line of lines) {
      const data = line.replace('data: ', '').trim()
      if (data === '[DONE]') { onDone(); return }

      try {
        const json = JSON.parse(data)
        const text = json.choices?.[0]?.delta?.content
        if (text) onChunk(text)
      } catch {}
    }
  }

  onDone()
}
