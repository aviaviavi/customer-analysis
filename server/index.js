import express from 'express'
import cors from 'cors'
import Stripe from 'stripe'

const app = express()
const PORT = process.env.PORT || 8787
const LOG_PREFIX = '[stripe-export]'
const STATUS_FILTER = process.env.STRIPE_STATUS || 'all' // 'all' | 'active' | 'canceled' ...
const MAX_PAGES = Number(process.env.STRIPE_MAX_PAGES || 50) // safety cap for very large accounts
const PAGE_SIZE = Math.min(Number(process.env.STRIPE_PAGE_SIZE || 100), 100)
const TOTAL_TIMEOUT_MS = Number(process.env.STRIPE_REQUEST_TIMEOUT_MS || 120000)
const PAGE_TIMEOUT_MS = Math.max(Math.min(TOTAL_TIMEOUT_MS - 5000, 20000), 5000)

app.use(express.json({ limit: '1mb' }))
app.use(cors({
  origin: (origin, cb) => cb(null, origin || true),
  credentials: false,
}))

// Basic request logging
app.use((req, res, next) => {
  const start = Date.now()
  logInfo('HTTP request', { method: req.method, path: req.path })
  res.on('finish', () => {
    logInfo('HTTP response', { method: req.method, path: req.path, status: res.statusCode, durationMs: Date.now() - start })
  })
  next()
})

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() })
})

// Helper: first day of month (UTC)
function monthStart(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
}

// Helper: add months (UTC)
function addMonths(date, n) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + n, 1))
}

// Helper: format YYYY-MM
function ym(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

// Resolve Stripe key from env or Authorization: Bearer <key>
function resolveStripeKey(req) {
  const envKey = process.env.STRIPE_SECRET_KEY
  const auth = req.headers.authorization || ''
  const bearer = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : ''
  return bearer || envKey || ''
}

function logInfo(msg, meta = {}) {
  console.log(`${LOG_PREFIX} ${new Date().toISOString()} ${msg}`, meta)
}

function logError(msg, meta = {}) {
  console.error(`${LOG_PREFIX} ${new Date().toISOString()} ${msg}`, meta)
}

const withTimeout = (p, ms, label = 'operation') => {
  let to
  const timeout = new Promise((_, reject) => {
    to = setTimeout(() => {
      const err = new Error(`${label} timed out after ${ms}ms`)
      err.name = 'TimeoutError'
      reject(err)
    }, ms)
  })
  return Promise.race([
    p.finally(() => clearTimeout(to)),
    timeout,
  ])
}

// Build a CSV-like dataset compatible with the frontend from Stripe subscriptions
app.post('/api/stripe/export', async (req, res) => {
  try {
    const apiKey = resolveStripeKey(req)
    if (!apiKey) {
      return res.status(400).json({ error: 'Missing Stripe secret key (env STRIPE_SECRET_KEY or Authorization Bearer).' })
    }

    const stripe = new Stripe(apiKey, { apiVersion: '2024-06-20', maxNetworkRetries: 2 })
    const startTs = Date.now()
    const {
      status: bodyStatus,
      createdGte,
      createdLte,
      maxPages: bodyMaxPages,
      requestTimeoutMs,
      pageSize: bodyPageSize,
      currency: bodyCurrency,
    } = (req.body || {})
    const effTimeout = Number(requestTimeoutMs || TOTAL_TIMEOUT_MS)
    const effPageSize = Math.min(Number(bodyPageSize || PAGE_SIZE), 100)
    const effMaxPages = Number(bodyMaxPages || MAX_PAGES)
    const effStatus = bodyStatus || STATUS_FILTER
    const effCurrency = (bodyCurrency || process.env.STRIPE_CURRENCY || '').toLowerCase() || null

    logInfo('Request start', { path: req.path, statusFilter: effStatus, maxPages: effMaxPages, pageSize: effPageSize, totalTimeoutMs: effTimeout, createdGte, createdLte, currency: effCurrency })

    // Collect subscriptions (active and canceled) and related customers
    const subs = []
    let startingAfter
    let pageCount = 0
    let truncated = false
    const deadline = startTs + effTimeout
    do {
      if (Date.now() > deadline) {
        throw Object.assign(new Error('Export exceeded total timeout'), { name: 'TimeoutError' })
      }
      pageCount += 1
      logInfo('Fetching subscriptions page', { page: pageCount, startingAfter })
      const pageStart = Date.now()
      const page = await withTimeout(
        stripe.subscriptions.list({
          status: effStatus,
          // Avoid expanding objects to improve latency. 'price' is typically included on subscription items.
          limit: effPageSize,
          starting_after: startingAfter,
          ...(createdGte || createdLte ? { created: { ...(createdGte ? { gte: createdGte } : {}), ...(createdLte ? { lte: createdLte } : {}) } } : {}),
        }),
        PAGE_TIMEOUT_MS,
        `Stripe subscriptions.list page ${pageCount}`,
      )
      const pageDur = Date.now() - pageStart
      logInfo('Fetched subscriptions page', { page: pageCount, count: page.data.length, durationMs: pageDur })
      subs.push(...page.data)
      startingAfter = page.has_more ? page.data[page.data.length - 1].id : undefined
      if (pageCount >= effMaxPages) {
        truncated = Boolean(startingAfter)
        logInfo('Reached page cap; truncating export', { pageCount, truncated })
        break
      }
    } while (startingAfter)

    if (subs.length === 0) {
      logInfo('No subscriptions found')
      return res.json([])
    }

    // Determine month range across all subs
    const minStart = monthStart(new Date(Math.min(
      ...subs.map(s => (s.start_date || s.created) * 1000)
    )))
    const now = monthStart(new Date())

    const months = []
    for (let d = new Date(minStart); d <= now; d = addMonths(d, 1)) {
      months.push(ym(d))
    }

    // Group by customer
    const byCustomer = new Map()
    for (const s of subs) {
      const cust = s.customer
      // Without expansion, this is a string id; prefer id as the label (avoid extra API calls)
      const customerName = typeof cust === 'object' && cust ? (cust.name || cust.email || cust.id) : String(cust)
      const key = customerName || s.customer || 'unknown'
      if (!byCustomer.has(key)) {
        byCustomer.set(key, [])
      }
      byCustomer.get(key).push(s)
    }

    const rows = []
    for (const [customerName, list] of byCustomer.entries()) {
      // Compute start/end at customer level
      const startEpoch = Math.min(...list.map(s => (s.start_date || s.created) * 1000))
      const startDate = new Date(startEpoch)
      const endEpoch = (() => {
        const canceled = list.filter(s => s.canceled_at)
        if (canceled.length === list.length) {
          return Math.max(...canceled.map(s => s.canceled_at * 1000))
        }
        return null
      })()

      const row = {
        Customer: customerName,
        'Customer Start Date': `${startDate.getUTCFullYear()}-${String(startDate.getUTCMonth() + 1).padStart(2, '0')}-${String(startDate.getUTCDate()).padStart(2, '0')}`,
        'Customer End Date': endEpoch ? (() => {
          const d = new Date(endEpoch)
          return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
        })() : 'N/A',
      }

      // Initialize all months with 0
      for (const m of months) {
        row[m] = 0
      }

      // Accumulate MRR per subscription item per month
      for (const s of list) {
        const subStart = monthStart(new Date((s.start_date || s.created) * 1000))
        // If canceled, stop after cancellation month; else till now
        const lastActive = s.canceled_at ? monthStart(new Date(s.canceled_at * 1000)) : now

        // Compute MRR from items; ignore non-recurring prices and non-USD by default
        const mrr = (s.items?.data || []).reduce((sum, item) => {
          const price = item.price
          if (!price || !price.recurring) return sum
          // Filter currency if set
          if (price.currency && effCurrency && price.currency !== effCurrency) {
            return sum
          }
          const unit = (price.unit_amount || 0) / 100
          const qty = item.quantity || 1
          let monthly = unit * qty
          if (price.recurring.interval === 'year') monthly = monthly / 12
          // For week/day intervals, approximate to monthly
          if (price.recurring.interval === 'week') monthly = (unit * qty) * (52 / 12)
          if (price.recurring.interval === 'day') monthly = (unit * qty) * (365 / 12)
          return sum + monthly
        }, 0)

        for (let d = new Date(subStart); d <= lastActive; d = addMonths(d, 1)) {
          const key = ym(d)
          if (row[key] == null) row[key] = 0
          row[key] += Number(mrr.toFixed(2))
        }
      }

      rows.push(row)
    }

    // Keep only months that exist and have at least one non-zero
    const activeMonths = months.filter(m => rows.some(r => (r[m] || 0) > 0))
    const pruned = rows.map(r => {
      const base = {
        Customer: r.Customer,
        'Customer Start Date': r['Customer Start Date'],
        'Customer End Date': r['Customer End Date'],
      }
      for (const m of activeMonths) base[m] = Number((r[m] || 0).toFixed(2))
      return base
    })

    const durationMs = Date.now() - startTs
    logInfo('Export completed', { customers: pruned.length, months: activeMonths.length, subs: subs.length, truncated, durationMs })
    res.setHeader('X-Export-Duration-Ms', String(durationMs))
    if (truncated) res.setHeader('X-Export-Truncated', 'true')
    res.json(pruned)
  } catch (err) {
    // Provide clearer error messages to the client without leaking stack traces
    const isTimeout = err?.name === 'TimeoutError' || /ETIMEDOUT|timeout/i.test(err?.message || '')
    const status = isTimeout ? 504 : (err?.statusCode || (err?.type === 'StripeAuthenticationError' ? 401 : 500))
    let message = isTimeout ? 'Stripe request timed out' : 'Failed to fetch Stripe data'
    if (status === 401) message = 'Invalid Stripe API key'
    if (err?.type === 'StripeInvalidRequestError') message = 'Invalid request to Stripe API'
    if (err?.type === 'StripeRateLimitError') message = 'Stripe rate limit exceeded'
    if (err?.type === 'StripePermissionError') message = 'Stripe permission error'
    logError('Stripe export error', { status, type: err?.type, code: err?.code, message: err?.message })
    res.status(status).json({ error: message, details: err?.message || undefined })
  }
})

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`)
})

process.on('unhandledRejection', (reason) => {
  logError('UnhandledRejection', { reason })
})
process.on('uncaughtException', (err) => {
  logError('UncaughtException', { message: err?.message, stack: err?.stack })
})
