import { spawn } from 'node:child_process'
import { RUNTIME_TIMEOUT_MS } from './model.ts'

export interface CommandResult { code: number; stdout: string; stderr: string }
export interface CommandOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  timeout?: number
  onOutput?: (chunk: Buffer) => void
  input?: string
}

export function run(command: string, args: string[], options: CommandOptions = {}): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd, env: options.env ?? process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    const deadline = setTimeout(() => child.kill('SIGKILL'), options.timeout ?? RUNTIME_TIMEOUT_MS)
    child.stdout.on('data', (chunk: Buffer) => { stdout.push(chunk); options.onOutput?.(chunk) })
    child.stderr.on('data', (chunk: Buffer) => { stderr.push(chunk); options.onOutput?.(chunk) })
    child.on('error', error => { clearTimeout(deadline); reject(error) })
    child.on('close', code => {
      clearTimeout(deadline)
      resolve({ code: code ?? 137, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() })
    })
    child.stdin.on('error', () => { /* Early command exit may close stdin before input finishes. */ })
    child.stdin.end(options.input)
  })
}

export async function checked(command: string, args: string[], options: CommandOptions = {}): Promise<string> {
  const result = await run(command, args, options)
  if (result.code !== 0) throw new Error(`${command} failed (${result.code}): ${result.stderr.trim() || result.stdout.trim()}`)
  return result.stdout.trim()
}

export function quote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}
