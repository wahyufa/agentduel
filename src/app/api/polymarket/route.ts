import { NextResponse } from 'next/server'

export type PolyMarket = {
  id: string
  question: string
  yesPrice: number  // 0-100 integer
  volume: number
  endDate: string | null
}

function parseStringArray(val: unknown): string[] {
  if (Array.isArray(val)) return val
  if (typeof val === 'string') {
    try { return JSON.parse(val) } catch { return [] }
  }
  return []
}

export async function GET() {
  try {
    const url = new URL('https://gamma-api.polymarket.com/markets')
    url.searchParams.set('active', 'true')
    url.searchParams.set('closed', 'false')
    url.searchParams.set('limit', '100')
    url.searchParams.set('order', 'volume')
    url.searchParams.set('ascending', 'false')

    const res = await fetch(url.toString(), {
      next: { revalidate: 300 },
      headers: { 'Accept': 'application/json' },
    })

    if (!res.ok) {
      return NextResponse.json({ error: 'Polymarket API error', status: res.status }, { status: 502 })
    }

    const raw: unknown[] = await res.json()

    const markets: PolyMarket[] = raw
      .filter((m: any) => {
        const outcomes = parseStringArray(m.outcomes)
        const hasYesNo = outcomes.some((o: string) => /yes/i.test(o))
        return m.active && !m.closed && hasYesNo && m.question
      })
      .map((m: any) => {
        const prices = parseStringArray(m.outcomePrices)
        const yesPrice = Math.round(parseFloat(prices[0] ?? '0.5') * 100)
        return {
          id: String(m.id),
          question: String(m.question),
          yesPrice,
          volume: Math.round(m.volume ?? 0),
          endDate: m.endDate ?? null,
        }
      })
      .slice(0, 60)

    return NextResponse.json(markets)
  } catch (err) {
    console.error('[/api/polymarket]', err)
    return NextResponse.json({ error: 'Failed to fetch Polymarket data' }, { status: 500 })
  }
}
