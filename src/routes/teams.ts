import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db } from '../db/client.ts'

const TeamSchema = z.object({
  name: z.string().min(1),
  category: z.string().min(1),
  season: z.string().min(1),
})

export async function teamRoutes(app: FastifyInstance) {
  app.get('/teams', async () => {
    const { rows } = await db.query('SELECT * FROM teams ORDER BY category, name')
    return rows
  })

  app.post('/admin/teams', {
    onRequest: [app.authenticate, app.requireAdmin],
  }, async (req, reply) => {
    const body = TeamSchema.parse(req.body)
    const { rows } = await db.query<{ id: string }>(
      'INSERT INTO teams (name, category, season) VALUES ($1,$2,$3) RETURNING id',
      [body.name, body.category, body.season],
    )
    return reply.code(201).send({ id: rows[0].id })
  })

  app.patch('/admin/teams/:id', {
    onRequest: [app.authenticate, app.requireAdmin],
  }, async (req) => {
    const { id } = req.params as { id: string }
    const body = TeamSchema.partial().parse(req.body)
    const fields: string[] = []
    const values: unknown[] = []
    let idx = 1
    for (const [k, v] of Object.entries(body)) {
      if (v !== undefined) { fields.push(`${k} = $${idx++}`); values.push(v) }
    }
    values.push(id)
    await db.query(`UPDATE teams SET ${fields.join(', ')} WHERE id = $${idx}`, values)
    return { ok: true }
  })

  app.delete('/admin/teams/:id', {
    onRequest: [app.authenticate, app.requireAdmin],
  }, async (req, reply) => {
    await db.query('DELETE FROM teams WHERE id=$1', [(req.params as { id: string }).id])
    return { ok: true }
  })
}
