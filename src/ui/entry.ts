import { Effect } from 'effect'
import { Runtime } from 'foldkit'

import { Message } from './message.js'
import { Flags, Model } from './model.js'
import { init, update } from './update.js'
import { view } from './view.js'

const readInitialTheme = (): boolean => {
  try {
    return localStorage.getItem('grill-theme') === 'light'
  } catch {
    return false
  }
}

const flags: Effect.Effect<Flags> = Effect.sync(() => Flags.make({ isLight: readInitialTheme() }))

// @foldkit/devtools (time-travel + message inspector) is loaded only in development.
// `import.meta.env.DEV` is statically false in a production build, so vite dead-code-
// eliminates the dynamic import — the overlay never ships in, or clutters, the built panel.
const devTools = import.meta.env.DEV
  ? { overlay: (await import('@foldkit/devtools')).overlay, Message }
  : { Message }

const application = Runtime.makeApplication({
  Model,
  Flags,
  flags,
  init,
  update,
  view,
  container: document.getElementById('root'),
  devTools,
})

Runtime.run(application)
