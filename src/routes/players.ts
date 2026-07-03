import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db } from '../db/client.ts'
import { playerPhotoKey, getPublicUrl, getUploadUrl, deleteObject } from '../lib/r2.ts'
import { randomUUID } from 'crypto'

const PlayerSchema = z.object({
  team_id: z.string().uuid(),
  name: z.string().min(1),
  position: z.string().optional(),
  number: z.coerce.number().int().optional(),
  bio: z.string().optional(),
  rarity: z.enum(['common', 'rare', 'legendary']),
  stats: z.record(z.string(), z.unknown()).optional(),
})

export async function playerRoutes(app: FastifyInstance) {
  // List all players (public)
  app.get('/players', async (req) => {
    const { team_id } = req.query as { team_id?: string }
    const { rows } = await db.query(
      `SELECT p.*, t.name AS team_name, t.category
       FROM players p JOIN teams t ON t.id = p.team_id
       ${team_id ? 'WHERE p.team_id = $1' : ''}
       ORDER BY t.name, p.number`,
      team_id ? [team_id] : [],
    )
    return rows.map((p) => ({ ...p, photo_url: getPublicUrl(p.photo_key) }))
  })

  // Get single player (public)
  app.get('/players/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const { rows } = await db.query(
      `SELECT p.*, t.name AS team_name, t.category
       FROM players p JOIN teams t ON t.id = p.team_id WHERE p.id=$1`,
      [id],
    )
    if (rows.length === 0) return reply.code(404).send({ error: 'Jugador no encontrado' })
    return { ...rows[0], photo_url: getPublicUrl(rows[0].photo_key) }
  })

  // Admin: create player + get upload URL
  app.post('/admin/players', {
    onRequest: [app.authenticate, app.requireAdmin],
  }, async (req, reply) => {
    const body = PlayerSchema.parse(req.body)
    const playerId = randomUUID()
    const photoKey = playerPhotoKey(playerId)

    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO players (id, team_id, name, position, number, bio, photo_key, rarity, stats)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [
        playerId,
        body.team_id,
        body.name,
        body.position ?? null,
        body.number ?? null,
        body.bio ?? null,
        photoKey,
        body.rarity,
        JSON.stringify(body.stats ?? {}),
      ],
    )

    const uploadUrl = await getUploadUrl(photoKey)
    return reply.code(201).send({ id: rows[0].id, upload_url: uploadUrl })
  })

  // Admin: update player
  app.patch('/admin/players/:id', {
    onRequest: [app.authenticate, app.requireAdmin],
  }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const body = PlayerSchema.partial().parse(req.body)

    const fields: string[] = []
    const values: unknown[] = []
    let idx = 1
    for (const [key, val] of Object.entries(body)) {
      if (val !== undefined) {
        fields.push(`${key} = $${idx++}`)
        values.push(key === 'stats' ? JSON.stringify(val) : val)
      }
    }
    if (fields.length === 0) return reply.code(400).send({ error: 'Nada que actualizar' })

    values.push(id)
    await db.query(`UPDATE players SET ${fields.join(', ')} WHERE id = $${idx}`, values)
    return { ok: true }
  })

  // Admin: delete player
  app.delete('/admin/players/:id', {
    onRequest: [app.authenticate, app.requireAdmin],
  }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const { rows } = await db.query<{ photo_key: string }>(
      'DELETE FROM players WHERE id=$1 RETURNING photo_key',
      [id],
    )
    if (rows.length === 0) return reply.code(404).send({ error: 'No encontrado' })
    await deleteObject(rows[0].photo_key).catch(() => null)
    return { ok: true }
  })

  // Admin: refresh upload URL for existing player
  app.post('/admin/players/:id/upload-url', {
    onRequest: [app.authenticate, app.requireAdmin],
  }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const { rows } = await db.query<{ photo_key: string }>('SELECT photo_key FROM players WHERE id=$1', [id])
    if (rows.length === 0) return reply.code(404).send({ error: 'No encontrado' })
    const url = await getUploadUrl(rows[0].photo_key)
    return { upload_url: url }
  })
}
