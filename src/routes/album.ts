import { FastifyInstance } from 'fastify'
import { db } from '../db/client.ts'
import { getPublicUrl } from '../lib/r2.ts'

export async function albumRoutes(app: FastifyInstance) {
  // My album: unique players collected
  app.get('/album', { onRequest: [app.authenticate] }, async (req) => {
    const userId = (req.user as { sub: string }).sub

    const { rows: allPlayers } = await db.query(
      `SELECT p.id, p.name, p.position, p.number, p.rarity, p.stats, p.photo_key,
              t.id AS team_id, t.name AS team_name, t.category
       FROM players p JOIN teams t ON t.id = p.team_id
       ORDER BY t.name, p.number`,
    )

    const { rows: collected } = await db.query<{ player_id: string }>(
      'SELECT player_id FROM stickers WHERE user_id=$1 AND is_duplicate=FALSE',
      [userId],
    )
    const collectedSet = new Set(collected.map((r) => r.player_id))

    return allPlayers.map((p) => ({
      ...p,
      photo_url: collectedSet.has(p.id) ? getPublicUrl(p.photo_key) : null,
      collected: collectedSet.has(p.id),
    }))
  })

  // My duplicate stickers (available to trade)
  app.get('/album/duplicates', { onRequest: [app.authenticate] }, async (req) => {
    const userId = (req.user as { sub: string }).sub

    const { rows } = await db.query(
      `SELECT s.id AS sticker_id, p.id AS player_id, p.name, p.rarity, p.photo_key,
              t.name AS team_name, COUNT(*) OVER (PARTITION BY s.player_id) AS copies
       FROM stickers s
       JOIN players p ON p.id = s.player_id
       JOIN teams t ON t.id = p.team_id
       WHERE s.user_id=$1 AND s.is_duplicate=TRUE
       ORDER BY p.rarity DESC, p.name`,
      [userId],
    )
    return rows.map((r) => ({ ...r, photo_url: getPublicUrl(r.photo_key) }))
  })

  // Ranking: users sorted by collection completion %
  app.get('/album/ranking', async () => {
    const { rows: total } = await db.query<{ count: string }>('SELECT COUNT(*) FROM players')
    const totalPlayers = parseInt(total[0].count)

    const { rows } = await db.query(
      `SELECT u.username,
              COUNT(DISTINCT s.player_id) AS collected,
              ROUND(COUNT(DISTINCT s.player_id) * 100.0 / $1, 1) AS pct
       FROM users u
       LEFT JOIN stickers s ON s.user_id = u.id AND s.is_duplicate = FALSE
       GROUP BY u.id, u.username
       ORDER BY collected DESC
       LIMIT 50`,
      [totalPlayers],
    )
    return { total_players: totalPlayers, ranking: rows }
  })
}
