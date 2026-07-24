import { NodeHttpClient } from '@effect/platform-node'
import { Effect } from 'effect'
import { HttpApiClient } from 'effect/unstable/httpapi'

import { GrillApi } from '../server/api.js'

export const makeClient = (baseUrl: string) =>
  HttpApiClient.make(GrillApi, { baseUrl }).pipe(Effect.provide(NodeHttpClient.layerNodeHttp))
