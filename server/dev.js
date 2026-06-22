import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const commands = [
  spawn(process.execPath, [join(root, 'server', 'server.js')], { cwd: root, stdio: 'inherit' }),
  spawn(process.execPath, [join(root, 'node_modules', 'vite', 'bin', 'vite.js')], { cwd: root, stdio: 'inherit' }),
]

let stopping = false
const stop = (exitCode = 0) => {
  if (stopping) return
  stopping = true
  for (const command of commands) command.kill()
  process.exitCode = exitCode
}

for (const command of commands) {
  command.on('error', (error) => {
    console.error(error.message)
    stop(1)
  })
  command.on('exit', (code, signal) => {
    if (!stopping) {
      console.error(`Development process stopped (${signal || `exit ${code}`}).`)
      stop(code || 1)
    }
  })
}

process.on('SIGINT', () => stop())
process.on('SIGTERM', () => stop())
