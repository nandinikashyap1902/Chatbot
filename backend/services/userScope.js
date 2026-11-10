export const RELEVANCE_THRESHOLD = 0.55

const USER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isValidUserId(userId) {
    return typeof userId === 'string' && USER_ID_PATTERN.test(userId)
}

export function userScopedFilter(userId) {
    return { userId: { $eq: userId } }
}

export function previousUserDocumentsFilter(userId, sourceId) {
    return {
        userId: { $eq: userId },
        sourceId: { $ne: sourceId },
    }
}

export function userScopedMetadata(metadata, { userId, sourceId, sourceName, sourceType, chunkIndex }) {
    return {
        ...metadata,
        source: sourceType,
        filename: sourceName,
        chunkIndex,
        userId,
        sourceId,
    }
}

export async function getRelevantContext(query, userId, vectorStore, waitForEmbeddingQuota = async () => {}) {
    if (query.trim().length < 10) return null

    await waitForEmbeddingQuota(1)
    const results = await vectorStore.similaritySearchWithScore(
        query,
        3,
        userScopedFilter(userId),
    )
    const relevant = results.filter(([, score]) => score >= RELEVANCE_THRESHOLD)

    if (relevant.length === 0) {
        console.log(`[RAG] No relevant docs (best: ${results[0]?.[1]?.toFixed(3) || 'N/A'}) — answering freely`)
        return null
    }

    console.log(`[RAG] Using ${relevant.length} docs (best score: ${relevant[0][1].toFixed(3)})`)
    return relevant.map(([doc]) => doc.pageContent).join('\n')
}
