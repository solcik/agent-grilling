import { it } from '@effect/vitest'
import { Effect, Exit, Schema } from 'effect'
import { describe, expect } from 'vitest'

import { Answer, Round } from './contract.js'
import { answer, richRoundInput } from '../test-fixtures.js'

// Effect-native decode tests (via @effect/vitest `it.effect`), complementing the
// synchronous round-trips in contract.test.ts. Decoding is the boundary the whole
// product depends on, so it is worth exercising it in the error channel too.
describe('grill contract — Effect decoding', () => {
  it.effect('decodes a rich round inside Effect.gen', () =>
    Effect.gen(function* () {
      const round = yield* Schema.decodeUnknownEffect(Round)(richRoundInput)
      expect(round.roundId).toBe(richRoundInput.roundId)
      expect(round.questions.length).toBeGreaterThan(0)
    }),
  )

  it.effect('round-trips an answer through encode then decode', () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(Answer)(answer)
      const decoded = yield* Schema.decodeUnknownEffect(Answer)(encoded)
      expect(decoded).toEqual(answer)
    }),
  )

  it.effect('surfaces a ParseError in the error channel for an illegal answer', () =>
    Effect.gen(function* () {
      const outcome = yield* Schema.decodeUnknownEffect(Answer)({ roundId: 'r1' }).pipe(Effect.exit)
      expect(Exit.isFailure(outcome)).toBe(true)
    }),
  )
})
