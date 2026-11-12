import test from 'node:test'
import assert from 'node:assert/strict'
import { readChatStream } from './chatStream.js'

function createReader(chunks) {
  const encoder = new TextEncoder()
  let index = 0

  return {
    async read() {
      if (index >= chunks.length) return { done: true }
      return { done: false, value: encoder.encode(chunks[index++]) }
    },
  }
}

test('reads text and a completion marker split across stream chunks', async () => {
  const output = []
  const result = await readChatStream(createReader(['Hello [DO', 'NE]']), chunk => output.push(chunk))

  assert.equal(result.text, 'Hello ')
  assert.equal(result.error, null)
  assert.equal(output.join(''), 'Hello ')
})

test('returns a server error message when the error marker is split across chunks', async () => {
  const output = []
  const result = await readChatStream(
    createReader(['Partial answer\n[ERR', 'OR]Groq model is unavailable']),
    chunk => output.push(chunk),
  )

  assert.equal(result.text, 'Partial answer\n')
  assert.equal(result.error, 'Groq model is unavailable')
  assert.equal(output.join(''), 'Partial answer\n')
})

test('keeps ordinary text at the end of a stream without a terminal marker', async () => {
  const result = await readChatStream(createReader(['A response']), () => {})

  assert.deepEqual(result, { text: 'A response', error: null })
})
