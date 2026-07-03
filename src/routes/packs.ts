import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db } from '../db/client.ts'
import { stripe, createPaymentIntent } from '../lib/stripe.ts'
import { openPack } from '../lib/packs.ts'
import { getPublicUrl } from '../lib/r2.ts'

const BuySchema = z.object({
  pack_type_id: z.string().uuid(),
  quantity: z.number().int().min(1).max(10).default(1),
})

export async function packRoutes(app: FastifyInstance) {
  // List available pack types
  app.get('/packs', async () => {
    const { rows } = await db.query('SELECT * FROM pack_types WHERE active = TRUE ORDER BY price_cents')
    return rows
  })

  // Create payment intent to buy packs
  app.post('/packs/buy', { onRequest: [app.authenticate] }, async (req, reply) => {
    const userId = (req.user as { sub: string }).sub
    const body = BuySchema.parse(req.body)

    const { rows: packRows } = await db.query(
      'SELECT * FROM pack_types WHERE id=$1 AND active=TRUE',
      [body.pack_type_id],
    )
    if (packRows.length === 0) return reply.code(404).send({ error: 'Tipo de sobre no encontrado' })
    const pack = packRows[0]

    const { rows: userRows } = await db.query<{ stripe_customer_id: string }>(
      'SELECT stripe_customer_id FROM users WHERE id=$1',
      [userId],
    )
    const customerId = userRows[0].stripe_customer_id
    const total = pack.price_cents * body.quantity

    const intent = await createPaymentIntent(total, customerId)

    const { rows: purchaseRows } = await db.query<{ id: string }>(
      `INSERT INTO purchases (user_id, pack_type_id, quantity, total_cents, stripe_payment_intent_id, status)
       VALUES ($1,$2,$3,$4,$5,'pending') RETURNING id`,
      [userId, body.pack_type_id, body.quantity, total, intent.id],
    )

    return {
      purchase_id: purchaseRows[0].id,
      client_secret: intent.client_secret,
      amount: total,
    }
  })

  // Stripe webhook: payment succeeded → generate stickers
  app.post('/webhooks/stripe', {
    config: { rawBody: true },
  }, async (req, reply) => {
    const sig = req.headers['stripe-signature'] as string
    let event
    try {
      event = stripe.webhooks.constructEvent(
        (req as unknown as { rawBody: Buffer }).rawBody,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET!,
      )
    } catch {
      return reply.code(400).send({ error: 'Invalid signature' })
    }

    if (event.type === 'payment_intent.succeeded') {
      const intent = event.data.object as { id: string }
      const { rows } = await db.query(
        `SELECT p.*, pt.sticker_count, pt.rarity_weights
         FROM purchases p JOIN pack_types pt ON pt.id = p.pack_type_id
         WHERE p.stripe_payment_intent_id=$1 AND p.status='pending'`,
        [intent.id],
      )
      if (rows.length === 0) return reply.send({ received: true })

      const purchase = rows[0]
      const totalStickers = purchase.sticker_count * purchase.quantity

      await openPack(purchase.user_id, purchase.id, totalStickers, purchase.rarity_weights)
      await db.query("UPDATE purchases SET status='completed' WHERE id=$1", [purchase.id])
    }

    if (event.type === 'payment_intent.payment_failed') {
      const intent = event.data.object as { id: string }
      await db.query(
        "UPDATE purchases SET status='failed' WHERE stripe_payment_intent_id=$1",
        [intent.id],
      )
    }

    return { received: true }
  })

  // Get stickers from a completed purchase (to show in opening animation)
  app.get('/packs/purchases/:id/stickers', { onRequest: [app.authenticate] }, async (req, reply) => {
    const userId = (req.user as { sub: string }).sub
    const { id } = req.params as { id: string }

    const { rows } = await db.query(
      `SELECT s.id, s.is_duplicate, s.created_at,
              p.id AS player_id, p.name, p.position, p.rarity, p.stats, p.photo_key,
              t.name AS team_name
       FROM stickers s
       JOIN players p ON p.id = s.player_id
       JOIN teams t ON t.id = p.team_id
       WHERE s.purchase_id=$1 AND s.user_id=$2
       ORDER BY s.created_at`,
      [id, userId],
    )
    if (rows.length === 0) return reply.code(404).send({ error: 'Compra no encontrada' })

    return rows.map((r) => ({ ...r, photo_url: getPublicUrl(r.photo_key) }))
  })
}
