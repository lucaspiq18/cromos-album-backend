import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import multipart from '@fastify/multipart'
import fastifyPlugin from 'fastify-plugin'

import authPlugin from './plugins/auth.ts'
import { authRoutes } from './routes/auth.ts'
import { teamRoutes } from './routes/teams.ts'
import { playerRoutes } from './routes/players.ts'
import { packRoutes } from './routes/packs.ts'
import { albumRoutes } from './routes/album.ts'
import { tradeRoutes } from './routes/trades.ts'

const app = Fastify({
  logger: true,
  // Store raw body for Stripe webhook verification
  bodyLimit: 1048576,
})

// Raw body for Stripe webhooks
app.addContentTypeParser('application/json', { parseAs: 'buffer' }, function (req, body, done) {
  try {
    const json = JSON.parse(body.toString())
    ;(req as unknown as { rawBody: Buffer }).rawBody = body as Buffer
    done(null, json)
  } catch (err) {
    done(err as Error, undefined)
  }
})

await app.register(cors, { origin: true })
await app.register(jwt, { secret: process.env.JWT_SECRET! })
await app.register(multipart)
await app.register(authPlugin)

await app.register(authRoutes)
await app.register(teamRoutes)
await app.register(playerRoutes)
await app.register(packRoutes)
await app.register(albumRoutes)
await app.register(tradeRoutes)

app.get('/health', () => ({ ok: true }))

try {
  await app.listen({ port: parseInt(process.env.PORT ?? '3000'), host: '0.0.0.0' })
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
