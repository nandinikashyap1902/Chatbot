import test from 'node:test'
import assert from 'node:assert/strict'
import {
    getRelevantContext,
    isValidUserId,
    previousUserDocumentsFilter,
    userScopedFilter,
    userScopedMetadata,
} from '../services/userScope.js'
import {
    EMBEDDING_DIMENSION,
    EMBEDDING_MODEL,
    createEmbeddingRateLimiter,
    embedDocumentsInBatches,
    getPublicEmbeddingError,
    validateEmbeddingDimension,
    validatePineconeDimension,
} from '../services/embeddingConfig.js'
import { GROQ_CHAT_MODEL } from '../services/groqConfig.js'
import { getPublicChatError } from '../services/chatErrors.js'

const firstUserId = 'c4a0bfa1-09ee-4b14-a09d-a65cb70f2d85'
const secondUserId = '73d584ab-3f9f-45bc-9dc8-8303814a0cf8'

test('accepts UUID user IDs and rejects missing or malformed IDs', () => {
    assert.equal(isValidUserId(firstUserId), true)
    assert.equal(isValidUserId(undefined), false)
    assert.equal(isValidUserId('user-1'), false)
})

test('creates a Pinecone metadata filter for exactly one user', () => {
    assert.deepEqual(userScopedFilter(firstUserId), {
        userId: { $eq: firstUserId },
    })
    assert.deepEqual(previousUserDocumentsFilter(firstUserId, 'new-source'), {
        userId: { $eq: firstUserId },
        sourceId: { $ne: 'new-source' },
    })
})

test('overwrites document metadata ownership with the request user', () => {
    assert.deepEqual(userScopedMetadata(
        { userId: secondUserId, source: 'untrusted' },
        { userId: firstUserId, sourceId: 'source-1', sourceName: 'notes.txt', sourceType: 'file', chunkIndex: 2 },
    ), {
        userId: firstUserId,
        source: 'file',
        filename: 'notes.txt',
        chunkIndex: 2,
        sourceId: 'source-1',
    })
})

test('searches only the requesting user and keeps relevant chunks', async () => {
    let searchArgs
    const quotaCalls = []
    const vectorStore = {
        async similaritySearchWithScore(...args) {
            searchArgs = args
            return [
                [{ pageContent: 'Relevant chunk' }, 0.8],
                [{ pageContent: 'Below threshold' }, 0.4],
            ]
        },
    }

    const context = await getRelevantContext(
        'a sufficiently long question',
        firstUserId,
        vectorStore,
        async count => quotaCalls.push(count),
    )

    assert.equal(context, 'Relevant chunk')
    assert.deepEqual(quotaCalls, [1])
    assert.deepEqual(searchArgs, [
        'a sufficiently long question',
        3,
        { userId: { $eq: firstUserId } },
    ])
})

test('skips retrieval for short queries', async () => {
    let searched = false
    const vectorStore = {
        async similaritySearchWithScore() {
            searched = true
            return []
        },
    }

    assert.equal(await getRelevantContext('hello', firstUserId, vectorStore), null)
    assert.equal(searched, false)
})

test('embedding model and Pinecone index dimensions must match', () => {
    assert.equal(EMBEDDING_MODEL, 'gemini-embedding-001')
    assert.equal(EMBEDDING_DIMENSION, 3072)
    assert.doesNotThrow(() => validateEmbeddingDimension(3072))
    assert.doesNotThrow(() => validatePineconeDimension(3072))
    assert.throws(() => validateEmbeddingDimension(0), /returned 0 dimensions/)
    assert.throws(() => validatePineconeDimension(768), /has 768 dimensions/)
})

test('embeds document batches sequentially and preserves vector order', async () => {
    const calls = []
    const quotaCalls = []
    const vectors = await embedDocumentsInBatches(
        ['one', 'two', 'three'],
        async batch => {
            calls.push(batch)
            return batch.map((_, index) => Array(EMBEDDING_DIMENSION).fill(calls.length + index))
        },
        2,
        async count => quotaCalls.push(count),
    )

    assert.deepEqual(calls, [['one', 'two'], ['three']])
    assert.deepEqual(quotaCalls, [2, 1])
    assert.deepEqual(vectors.map(vector => vector[0]), [1, 2, 2])
})

test('shares the embedding quota across concurrent uploads', async () => {
    let currentTime = 0
    const limiter = createEmbeddingRateLimiter({
        requestsPerMinute: 4,
        now: () => currentTime,
        sleep: async milliseconds => { currentTime += milliseconds },
    })

    await Promise.all([limiter(3), limiter(2)])
    assert.equal(currentTime, 15_000)
})

test('turns Gemini rate-limit errors into a concise retry message', () => {
    assert.match(
        getPublicEmbeddingError({ status: 429, message: 'provider details' }),
        /Wait about one minute and retry/,
    )
    assert.equal(
        getPublicEmbeddingError(new Error('Unexpected Gemini failure')),
        'Unexpected Gemini failure',
    )
})

test('rejects empty or incomplete embedding responses before Pinecone upsert', async () => {
    await assert.rejects(
        embedDocumentsInBatches(['document'], async () => [[]]),
        /returned 0 dimensions/,
    )
    await assert.rejects(
        embedDocumentsInBatches(['one', 'two'], async () => [Array(EMBEDDING_DIMENSION).fill(1)]),
        /returned 1 embeddings for 2 documents/,
    )
})

test('propagates Gemini batch errors rather than converting them to empty vectors', async () => {
    const failure = new Error('Gemini request was rate limited')
    await assert.rejects(
        embedDocumentsInBatches(['document'], async () => { throw failure }),
        error => error === failure,
    )
})

test('uses the active Groq replacement model by default', () => {
    assert.equal(GROQ_CHAT_MODEL, 'openai/gpt-oss-20b')
})

test('explains unavailable Groq model errors without exposing provider internals', () => {
    const message = getPublicChatError({
        status: 404,
        error: { error: { code: 'model_not_found' } },
    })

    assert.match(message, /openai\/gpt-oss-20b/)
    assert.match(message, /GROQ_CHAT_MODEL/)
})

test('returns a useful message when Groq rejects chat request parameters', () => {
    assert.match(
        getPublicChatError({ status: 400 }),
        /Groq rejected the chat request/,
    )
})
