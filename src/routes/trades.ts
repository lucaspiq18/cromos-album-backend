import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db } from '../db/client.ts'
import { getPublicUrl } from '../lib/r2.ts'

const CreateTradeSchema = z.object({
  to_user_id: z.string().uuid(),
  offered_sticker_id: z.string().uuid(),
  requested_player_id: z.string().uuid(),
})

export async function tradeRoutes(app: FastifyInstance) {
  // My pending trades (incoming + outgoing)
  app.get('/trades', { onRequest: [app.authenticate] }, async (req) => {
    const userId = (req.user as { sub: string }).sub

    const { rows } = await db.query(
      `SELECT tr.id, tr.status, tr.created_at,
              tr.from_user_id, fu.username AS from_username,
              tr.to_user_id, tu.username AS to_username,
              tr.offered_sticker_id,
              op.id AS offered_player_id, op.name AS offered_player_name,
              op.rarity AS offered_rarity, op.photo_key AS offered_photo_key,
              rp.id AS requested_player_id, rp.name AS requested_player_name,
              rp.rarity AS requested_rarity, rp.photo_key AS requested_photo_key
       FROM trades tr
       JOIN users fu ON fu.id = tr.from_user_id
       JOIN users tu ON tu.id = tr.to_user_id
       JOIN stickers os ON os.id = tr.offered_sticker_id
       JOIN players op ON op.id = os.player_id
       JOIN players rp ON rp.id = tr.requested_player_id
       WHERE (tr.from_user_id=$1 OR tr.to_user_id=$1) AND tr.status='pending'
       ORDER BY tr.created_at DESC`,
      [userId],
    )
    return rows.map((r) => ({
      ...r,
      offered_photo_url: getPublicUrl(r.offered_photo_key),
      requested_photo_url: getPublicUrl(r.requested_photo_key),
    }))
  })

  // Create a trade offer
  app.post('/trades', { onRequest: [app.authenticate] }, async (req, reply) => {
    const userId = (req.user as { sub: string }).sub
    const body = CreateTradeSchema.parse(req.body)

    if (body.to_user_id === userId) {
      return reply.code(400).send({ error: 'No puedes intercambiar contigo mismo' })
    }

    // Verify the sticker belongs to the user and is a duplicate
    const { rows: stickerRows } = await db.query(
      'SELECT id FROM stickers WHERE id=$1 AND user_id=$2 AND is_duplicate=TRUE',
      [body.offered_sticker_id, userId],
    )
    if (stickerRows.length === 0) {
      return reply.code(403).send({ error: 'El cromo no existe o no es un duplicado tuyo' })
    }

    // Verify the other user has a duplicate of the requested player
    const { rows: theirRows } = await db.query(
      `SELECT s.id FROM stickers s WHERE s.user_id=$1 AND s.player_id=$2 AND s.is_duplicate=TRUE LIMIT 1`,
      [body.to_user_id, body.requested_player_id],
    )
    if (theirRows.length === 0) {
      return reply.code(400).send({ error: 'El otro usuario no tiene ese cromo duplicado' })
    }

    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO trades (from_user_id, to_user_id, offered_sticker_id, requested_player_id)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [userId, body.to_user_id, body.offered_sticker_id, body.requested_player_id],
    )
    return reply.code(201).send({ id: rows[0].id })
  })

  // Accept a trade
  app.post('/trades/:id/accept', { onRequest: [app.authenticate] }, async (req, reply) => {
    const userId = (req.user as { sub: string }).sub
    const { id } = req.params as { id: string }

    const { rows } = await db.query(
      `SELECT tr.*, s.player_id AS offered_player_id
       FROM trades tr JOIN stickers s ON s.id = tr.offered_sticker_id
       WHERE tr.id=$1 AND tr.to_user_id=$2 AND tr.status='pending'`,
      [id, userId],
    )
    if (rows.length === 0) return reply.code(404).send({ error: 'Intercambio no encontrado' })
    const trade = rows[0]

    // Find the receiver's duplicate to give away
    const { rows: theirSticker } = await db.query<{ id: string }>(
      `SELECT id FROM stickers WHERE user_id=$1 AND player_id=$2 AND is_duplicate=TRUE LIMIT 1`,
      [userId, trade.requested_player_id],
    )
    if (theirSticker.length === 0) {
      return reply.code(409).send({ error: 'Ya no tienes ese duplicado' })
    }

    const client = await db.connect()
    try {
      await client.query('BEGIN')

      // Transfer offered sticker to receiver (to_user)
      await client.query(
        'UPDATE stickers SET user_id=$1, is_duplicate=FALSE WHERE id=$2',
        [userId, trade.offered_sticker_id],
      )
      // Mark receiver's old copy of this player as duplicate if they already had it
      await client.query(
        `UPDATE stickers SET is_duplicate=TRUE
         WHERE user_id=$1 AND player_id=$2 AND is_duplicate=FALSE AND id != $3`,
        [userId, trade.offered_player_id, trade.offered_sticker_id],
      )

      // Transfer receiver's sticker to offerer (from_user)
      await client.query(
        'UPDATE stickers SET user_id=$1, is_duplicate=FALSE WHERE id=$2',
        [trade.from_user_id, theirSticker[0].id],
      )
      await client.query(
        `UPDATE stickers SET is_duplicate=TRUE
         WHERE user_id=$1 AND player_id=$2 AND is_duplicate=FALSE AND id != $3`,
        [trade.from_user_id, trade.requested_player_id, theirSticker[0].id],
      )

      await client.query(
        "UPDATE trades SET status='accepted', resolved_at=NOW() WHERE id=$1",
        [id],
      )
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }

    return { ok: true }
  })

  // Reject or cancel a trade
  app.post('/trades/:id/reject', { onRequest: [app.authenticate] }, async (req, reply) => {
    const userId = (req.user as { sub: string }).sub
    const { id } = req.params as { id: string }

    const { rows } = await db.query(
      `UPDATE trades SET status=CASE WHEN from_user_id=$1 THEN 'cancelled' ELSE 'rejected' END,
       resolved_at=NOW()
       WHERE id=$2 AND (from_user_id=$1 OR to_user_id=$1) AND status='pending'
       RETURNING id`,
      [userId, id],
    )
    if (rows.length === 0) return reply.code(404).send({ error: 'Intercambio no encontrado' })
    return { ok: true }
  })
}
