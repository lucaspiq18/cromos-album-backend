import { db } from '../db/client.ts'

type Rarity = 'common' | 'rare' | 'legendary'

interface RarityWeights {
  common: number
  rare: number
  legendary: number
}

function pickRarity(weights: RarityWeights): Rarity {
  const roll = Math.random() * 100
  if (roll < weights.legendary) return 'legendary'
  if (roll < weights.legendary + weights.rare) return 'rare'
  return 'common'
}

async function pickPlayer(rarity: Rarity): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    'SELECT id FROM players WHERE rarity = $1 ORDER BY RANDOM() LIMIT 1',
    [rarity],
  )
  if (rows.length === 0) {
    // fallback to any rarity if none found for target rarity
    const fallback = await db.query<{ id: string }>('SELECT id FROM players ORDER BY RANDOM() LIMIT 1')
    if (fallback.rows.length === 0) throw new Error('No players found in database')
    return fallback.rows[0].id
  }
  return rows[0].id
}

export async function openPack(
  userId: string,
  purchaseId: string,
  stickerCount: number,
  weights: RarityWeights,
): Promise<string[]> {
  // Determine which players already exist in album (non-duplicate)
  const { rows: existing } = await db.query<{ player_id: string }>(
    'SELECT player_id FROM stickers WHERE user_id = $1 AND is_duplicate = FALSE',
    [userId],
  )
  const albumSet = new Set(existing.map((r) => r.player_id))

  const playerIds: string[] = []
  for (let i = 0; i < stickerCount; i++) {
    const rarity = pickRarity(weights)
    const playerId = await pickPlayer(rarity)
    playerIds.push(playerId)
  }

  // Insert stickers in a transaction
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    const stickerIds: string[] = []
    for (const playerId of playerIds) {
      const isDuplicate = albumSet.has(playerId)
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO stickers (user_id, player_id, purchase_id, is_duplicate)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [userId, playerId, purchaseId, isDuplicate],
      )
      stickerIds.push(rows[0].id)
      // Once we've inserted the first non-duplicate, mark it in the set
      if (!isDuplicate) albumSet.add(playerId)
    }
    await client.query('COMMIT')
    return stickerIds
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}
