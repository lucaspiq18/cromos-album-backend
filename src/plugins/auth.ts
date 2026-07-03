import fp from 'fastify-plugin'
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'

export default fp(async function (app: FastifyInstance) {
  app.decorate('authenticate', async function (req: FastifyRequest, reply: FastifyReply) {
    try {
      await req.jwtVerify()
    } catch {
      reply.code(401).send({ error: 'No autorizado' })
    }
  })

  app.decorate('requireAdmin', async function (req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as { role?: string }
    if (user?.role !== 'admin') {
      reply.code(403).send({ error: 'Acceso solo para administradores' })
    }
  })
})

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>
    requireAdmin: (req: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
}
