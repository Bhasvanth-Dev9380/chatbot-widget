// scripts/start-with-vault.mjs
import vault from "node-vault";
import { spawn } from "child_process";

// 🔐 Vault config from environment variables
const VAULT_ADDR = process.env.VAULT_ADDR;
const VAULT_TOKEN = process.env.VAULT_TOKEN;
const VAULT_SECRET_PATH = process.env.VAULT_SECRET_PATH;

// Use KV v1 mount by default, adjust if needed
const VAULT_KV_MOUNT = process.env.VAULT_KV_MOUNT || "kv";

async function loadSecretsFromVault(client) {
  // KV v2 path
  const v2Path = `${VAULT_KV_MOUNT}/data/${VAULT_SECRET_PATH}`;
  try {
    console.log(`🔎 Trying KV v2 path: ${v2Path}`);
    const res = await client.read(v2Path);
    const secrets = res?.data?.data;
    if (!secrets) {
      throw new Error("KV v2 format missing data.data");
    }
    console.log("✅ Loaded secrets using KV v2");
    return secrets;
  } catch (err) {
    console.warn(`⚠️ KV v2 read failed: ${err.message}`);
    console.warn("   Falling back to KV v1…");

    // KV v1 path
    const v1Path = `${VAULT_KV_MOUNT}/${VAULT_SECRET_PATH}`;
    console.log(`🔎 Trying KV v1 path: ${v1Path}`);
    const res = await client.read(v1Path);
    const secrets = res?.data;
    if (!secrets) {
      throw new Error("KV v1 format missing data");
    }
    console.log("✅ Loaded secrets using KV v1");
    return secrets;
  }
}

async function main() {
  // Check for required Vault variables
  if (!VAULT_TOKEN) {
    console.error("❌ VAULT_TOKEN environment variable is not set");
    process.exit(1);
  }

  if (!VAULT_ADDR) {
    console.error("❌ VAULT_ADDR environment variable is not set");
    process.exit(1);
  }

  if (!VAULT_SECRET_PATH) {
    console.error("❌ VAULT_SECRET_PATH environment variable is not set");
    process.exit(1);
  }

  console.log("🔐 Connecting to Vault...");
  const client = vault({
    endpoint: VAULT_ADDR,
    token: VAULT_TOKEN,
  });

  let secrets;
  try {
    secrets = await loadSecretsFromVault(client);
    console.log(`✅ Loaded ${Object.keys(secrets).length} secrets from Vault`);
  } catch (err) {
    console.error("❌ Failed to load secrets from Vault:", err.message);
    process.exit(1);
  }

  // Inject secrets into process.env
  for (const [key, value] of Object.entries(secrets)) {
    process.env[key] = String(value);
  }

  console.log("🚀 Starting Next.js production server...");

  // Get port from environment or default to 8080
  const port = process.env.PORT || "8080";

  // Start Next.js production server
  const child = spawn("npx", ["next", "start", "-p", port], {
    env: process.env,
    stdio: "inherit",
  });

  child.on("error", (err) => {
    console.error("❌ Failed to start Next.js:", err);
    process.exit(1);
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      console.log(`Next.js was killed with signal ${signal}`);
    } else {
      console.log(`Next.js exited with code ${code}`);
    }
    process.exit(code || 0);
  });
}

main().catch((err) => {
  console.error("❌ Startup script failed:", err);
  process.exit(1);
});
