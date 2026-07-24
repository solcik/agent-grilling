import { Runtime } from 'foldkit'

import { Message, Model, init, update, view } from './main.js'

// @foldkit/devtools (time-travel + message inspector) is loaded only in development.
// `import.meta.env.DEV` is statically false in a production build, so vite dead-code-
// eliminates the dynamic import — the overlay never ships in, or clutters, the built panel.
const devTools = import.meta.env.DEV
  ? { overlay: (await import('@foldkit/devtools')).overlay, Message }
  : { Message }

const application = Runtime.makeApplication({
  Model,
  init,
  update,
  view,
  container: document.getElementById('root'),
  devTools,
})

Runtime.run(application)
