import { Buffer } from 'node:buffer'
import { Effect, Schema } from 'effect'

export const SessionId = Schema.String.check(
  Schema.isPattern(/\S/, { message: 'A session id is required.' }),
).pipe(Schema.brand('SessionId'))

export type SessionId = typeof SessionId.Type

export const parseSessionId = Effect.fn('SessionId.parse')((value: string) =>
  Schema.decodeUnknownEffect(SessionId)(value),
)

export const sessionDirectoryKey = (sessionId: SessionId): string =>
  Buffer.from(sessionId).toString('base64url')
