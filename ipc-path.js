import { homedir } from "node:os";
import { join } from "node:path";

const runtimeRoot = process.env.XDG_RUNTIME_DIR || join(homedir(), ".cache");

export const IPC_DIRECTORY = join(runtimeRoot, "opencode-omarchy-notifications");
