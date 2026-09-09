export const SCHEMA_VERSION = 1
export const APPLICATION_SOCKET = 'application.sock'
export const GUEST_APPLICATION_SOCKET = '/tmp/studio-workspace-http.sock'
export const DNS_SUFFIX = 'herdr.test'
export const CONFIG_FILE = '.workspace.json'
export const DEVELOPMENT_IMAGE = 'studio-dev:node24-pnpm11'
export const OWNER_LABEL = 'dev.herdr.workspace'
export const REVISION_LABEL = 'dev.herdr.revision'
export const RUNTIME_TIMEOUT_MS = 120_000
export const READINESS_TIMEOUT_MS = 180_000
export const POLL_INTERVAL_MS = 250
export const ID_LENGTH = 16
export const SLUG_LENGTH = 24

export interface ProjectRecipe {
  version: 1
  project: string
  image: string
  cpus: number
  memory: string
  prepare: string[]
  prepareInputs: string[]
  persistPaths: string[]
  start: string
  port: number
  env: Record<string, string>
  sourceRevision?: string
}

export interface Project {
  root: string
  commonDir: string
  id: string
}

export interface Workspace {
  version: 1
  id: string
  project: Project
  branch: string
  path: string
  container: string
  recipe: ProjectRecipe
  revision: string
  preparation: string | null
  phase: 'preparing' | 'ready' | 'stopped' | 'failed' | 'removed'
  hostname: string
  error?: string
  herdr?: { socket: string; workspace: string; agentPane: string; terminalPane?: string }
}

export interface RuntimeInspection {
  configuration: { labels: Record<string, string>; image: { reference: string } }
  status: { state: string; networks: { ipv4Address?: string }[] }
}
