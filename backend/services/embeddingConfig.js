export const EMBEDDING_MODEL = 'gemini-embedding-001'
export const EMBEDDING_DIMENSION = 3072

const EMBEDDING_REQUESTS_PER_MINUTE = 80
const EMBEDDING_RATE_WINDOW_MS = 60_000

export function createEmbeddingRateLimiter({
    requestsPerMinute = EMBEDDING_REQUESTS_PER_MINUTE,
    now = Date.now,
    sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
} = {}) {
    if (!Number.isInteger(requestsPerMinute) || requestsPerMinute < 1) {
        throw new Error('Embedding requests per minute must be a positive integer.')
    }

    let availableRequests = requestsPerMinute
    let lastRefill = now()
    let queue = Promise.resolve()

    return requestCount => {
        if (!Number.isInteger(requestCount) || requestCount < 1 || requestCount > requestsPerMinute) {
            return Promise.reject(new Error('Embedding request count exceeds the configured rate limit.'))
        }

        const scheduled = queue.then(async () => {
            while (availableRequests < requestCount) {
                const currentTime = now()
                availableRequests = Math.min(
                    requestsPerMinute,
                    availableRequests + Math.max(0, currentTime - lastRefill)
                        * requestsPerMinute / EMBEDDING_RATE_WINDOW_MS,
                )
                lastRefill = currentTime

                if (availableRequests < requestCount) {
                    await sleep(Math.ceil(
                        (requestCount - availableRequests)
                            * EMBEDDING_RATE_WINDOW_MS / requestsPerMinute,
                    ))
                }
            }

            const currentTime = now()
            availableRequests = Math.min(
                requestsPerMinute,
                availableRequests + Math.max(0, currentTime - lastRefill)
                    * requestsPerMinute / EMBEDDING_RATE_WINDOW_MS,
            )
            lastRefill = currentTime
            availableRequests -= requestCount
        })

        queue = scheduled.catch(() => {})
        return scheduled
    }
}

export function getPublicEmbeddingError(error) {
    if (error?.status === 429) {
        return 'Gemini embedding rate limit reached. Wait about one minute and retry. '
            + 'If it continues, check the Gemini API quota for this project.'
    }
    return error?.message || 'Failed to generate document embeddings.'
}

export async function embedDocumentsInBatches(
    texts,
    embedBatch,
    batchSize = 32,
    waitForQuota = async () => {},
) {
    if (!Number.isInteger(batchSize) || batchSize < 1) {
        throw new Error('Embedding batch size must be a positive integer.')
    }

    const vectors = []
    for (let start = 0; start < texts.length; start += batchSize) {
        const batch = texts.slice(start, start + batchSize)
        await waitForQuota(batch.length)
        const batchVectors = await embedBatch(batch)

        if (!Array.isArray(batchVectors) || batchVectors.length !== batch.length) {
            throw new Error(
                `Gemini returned ${batchVectors?.length ?? 0} embeddings for ${batch.length} documents.`,
            )
        }

        for (const vector of batchVectors) {
            validateEmbeddingDimension(Array.isArray(vector) ? vector.length : 0)
            vectors.push(vector)
        }
    }

    return vectors
}

export function validateEmbeddingDimension(actualDimension) {
    if (actualDimension !== EMBEDDING_DIMENSION) {
        throw new Error(
            `Embedding model "${EMBEDDING_MODEL}" returned ${actualDimension} dimensions; `
            + `expected ${EMBEDDING_DIMENSION}.`,
        )
    }
}

export function validatePineconeDimension(actualDimension) {
    if (actualDimension !== EMBEDDING_DIMENSION) {
        throw new Error(
            `Pinecone index has ${actualDimension} dimensions but "${EMBEDDING_MODEL}" `
            + `requires ${EMBEDDING_DIMENSION}. Set PINECONE_INDEX to a compatible index.`,
        )
    }
}
