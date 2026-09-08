import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";

export interface ContainerSandboxConfig {
	enabled: boolean;
	image: string;
	containerName: string | null;
	workdir: string;
	mountCwd: boolean;
	cpus: number;
	memory: string;
	env: Record<string, string>;
	runArgs: string[];
	initArgs: string[];
}

export const DEFAULT_CONFIG: ContainerSandboxConfig = {
	enabled: true,
	image: "node:24",
	containerName: null,
	workdir: "/workspace",
	mountCwd: true,
	cpus: 4,
	memory: "4G",
	env: { COREPACK_ENABLE_DOWNLOAD_PROMPT: "0" },
	runArgs: [],
	initArgs: ["sleep", "infinity"],
};

type PartialConfig = Partial<ContainerSandboxConfig>;

export function loadConfig(cwd: string): ContainerSandboxConfig {
	const globalConfig = readJsonConfig(
		join(getAgentDir(), "extensions", "container-sandbox.json"),
	);
	const projectConfig = readJsonConfig(join(cwd, CONFIG_DIR_NAME, "container.json"));
	return mergeConfigs(mergeConfigs(DEFAULT_CONFIG, globalConfig), projectConfig);
}

function readJsonConfig(path: string): Partial<ContainerSandboxConfig> {
	if (!existsSync(path)) return {};
	try {
		return JSON.parse(readFileSync(path, "utf-8")) as Partial<ContainerSandboxConfig>;
	} catch (err) {
		console.error(`Warning: could not parse ${path}: ${err instanceof Error ? err.message : err}`);
		return {};
	}
}

function mergeConfigs(base: ContainerSandboxConfig, overrides: Partial<ContainerSandboxConfig>): ContainerSandboxConfig {
	const merged: ContainerSandboxConfig = { ...base, ...stripUndefined(overrides) };
	if (overrides.env) merged.env = { ...base.env, ...overrides.env };
	return merged;
}

function stripUndefined<T extends object>(value: T): Partial<T> {
	return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export function resolveContainerName(config: ContainerSandboxConfig, projectPath: string): string {
	if (config.containerName) return config.containerName;
	const slug = projectPath.split("/").filter(Boolean).pop() ?? "project";
	const safeSlug = slug.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 24);
	return `pi-${safeSlug}-${fnv1aHex(projectPath).slice(0, 6)}`;
}

export function resolveMountSource(config: ContainerSandboxConfig, projectPath: string): string | null {
	return config.mountCwd ? projectPath : null;
}

function fnv1aHex(input: string): string {
	let hash = 0x811c9dc5;
	for (let i = 0; i < input.length; i++) {
		hash ^= input.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash.toString(16).padStart(8, "0");
}