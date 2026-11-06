import { setShared, shared } from "herdr";
import { SHARED } from "./config.js";

/** Names and colours the person gave their workspaces, by Sealskin home: { [home]: { name, hue } }. */
export const readRegistry = () => shared(SHARED.workspaces) ?? {};

export const writeRegistry = (registry) => setShared(SHARED.workspaces, registry);

export const rememberWorkspace = (home, meta) => writeRegistry({ ...readRegistry(), [home]: meta });
