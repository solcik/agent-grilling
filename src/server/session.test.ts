import { Effect, Exit } from 'effect'
import { expect, test } from 'vitest'

import { parseSessionId, sessionDirectoryKey } from './session.js'

test('SessionId validates once and derives its stable directory key', async () => {
  const sessionId = await Effect.runPromise(parseSessionId('project/task'))

  expect(sessionId).toBe('project/task')
  expect(sessionDirectoryKey(sessionId)).toBe('cHJvamVjdC90YXNr')
})

test('SessionId rejects empty and whitespace-only values', async () => {
  const empty = await Effect.runPromiseExit(parseSessionId(''))
  const whitespace = await Effect.runPromiseExit(parseSessionId('   '))

  expect(Exit.isFailure(empty)).toBe(true)
  expect(Exit.isFailure(whitespace)).toBe(true)
})
