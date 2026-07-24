import { Schema } from 'effect'
import { describe, expect, test } from 'vitest'

import { Answer, Inbox, Round } from './contract.js'
import { answer, inbox, richRound, richRoundInput } from '../test-fixtures.js'

describe('grill contract', () => {
  test('round-trips rich rounds with all context variants and option previews', () => {
    const decoded = Schema.decodeUnknownSync(Round)(richRoundInput)

    expect(Schema.encodeUnknownSync(Round)(decoded)).toEqual(richRoundInput)
    expect(decoded).toEqual(richRound)
  })

  test('round-trips answers and inbox rows', () => {
    expect(Schema.decodeUnknownSync(Answer)(Schema.encodeUnknownSync(Answer)(answer))).toEqual(
      answer,
    )
    expect(Schema.decodeUnknownSync(Inbox)(Schema.encodeUnknownSync(Inbox)(inbox))).toEqual(inbox)
  })
})
