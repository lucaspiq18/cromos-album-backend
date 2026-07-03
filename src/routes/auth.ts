import { FastifyInstance } from 'fastify'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { db } from '../db/client.ts'
import { getOrCreateCustomer } from '../lib/stripe.ts'

const RegisterSchema = z.object({
  email: z.string().email(),
  username: z.string().min(3).max(30),
  password: z.string().min(6),
})

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
})

export async function authRoutes(app: FastifyInstance) {
  app.post('/auth/register', async (req, reply) => {
    const body = RegisterSchema.parse(req.body)

    const existing = await db.query('SELECT id FROM users WHERE email=$1 OR username=$2', [
      body.email,
      body.username,
    ])
    if (existing.rows.length > 0) {
      return reply.code(409).send({ error: 'Email o username ya en uso' })
    }

    const hash = await bcrypt.hash(body.password, 12)
    const customerId = await getOrCreateCustomer(body.email, body.username).catch(() => null)

    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO users (email, username, password_hash, stripe_customer_id)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [body.email, body.username, hash, customerId],
    )

    const token = app.jwt.sign({ sub: rows[0].id, role: 'user' })
    return { token }
  })

  app.post('/auth/login', async (req, reply) => {
    const body = LoginSchema.parse(req.body)

    const { rows } = await db.query<{ id: string; password_hash: string }>(
      'SELECT id, password_hash FROM users WHERE email=$1',
      [body.email],
    )
    if (rows.length === 0) return reply.code(401).send({ error: 'Credenciales inválidas' })

    const valid = await bcrypt.compare(body.password, rows[0].password_hash)
    if (!valid) return reply.code(401).send({ error: 'Credenciales inválidas' })

    const token = app.jwt.sign({ sub: rows[0].id, role: 'user' })
    return { token }
  })

  // Admin login
  app.post('/auth/admin/login', async (req, reply) => {
    const body = LoginSchema.parse(req.body)

    const { rows } = await db.query<{ id: string; password_hash: string }>(
      'SELECT id, password_hash FROM admins WHERE email=$1',
      [body.email],
    )
    if (rows.length === 0) return reply.code(401).send({ error: 'Credenciales inválidas' })

    const valid = await bcrypt.compare(body.password, rows[0].password_hash)
    if (!valid) return reply.code(401).send({ error: 'Credenciales inválidas' })

    const token = app.jwt.sign({ sub: rows[0].id, role: 'admin' })
    return { token }
  })
}
