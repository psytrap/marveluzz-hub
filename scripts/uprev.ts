// Marveluzz Hub - Automated Version Uprev Mechanism
// Bumps APP_VERSION in src/main.ts and public/index.html
// Also synchronizes REQUIRED_SCHEMA_VERSION with the latest supabase/migrations/ timestamp

const MAIN_TS_PATH = "./src/main.ts";
const INDEX_HTML_PATH = "./public/index.html";
const MIGRATIONS_DIR = "./supabase/migrations";

async function uprevVersion() {
  const bumpType = Deno.args[0] || "patch";
  
  // 1. Read src/main.ts
  let mainContent = await Deno.readTextFile(MAIN_TS_PATH);
  const versionMatch = mainContent.match(/const APP_VERSION = "([^"]+)";/);
  if (!versionMatch) {
    console.error("❌ Could not find APP_VERSION definition in src/main.ts");
    Deno.exit(1);
  }

  const currentVersion = versionMatch[1];
  const parts = currentVersion.split(".").map(Number);
  
  if (parts.length !== 3 || parts.some(isNaN)) {
    console.error(`❌ Invalid current APP_VERSION format: '${currentVersion}'`);
    Deno.exit(1);
  }

  let [major, minor, patch] = parts;

  if (bumpType === "patch") {
    patch += 1;
  } else if (bumpType === "minor") {
    minor += 1;
    patch = 0;
  } else if (bumpType === "major") {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (/^\d+\.\d+\.\d+$/.test(bumpType)) {
    const customParts = bumpType.split(".").map(Number);
    [major, minor, patch] = customParts;
  } else {
    console.error(`❌ Unknown uprev target '${bumpType}'. Use 'patch', 'minor', 'major', or a semver string like '1.0.2'.`);
    Deno.exit(1);
  }

  const newVersion = `${major}.${minor}.${patch}`;

  // 2. Scan latest migration timestamp in supabase/migrations/
  let latestSchemaVersion = "20260728000000";
  try {
    for await (const dirEntry of Deno.readDir(MIGRATIONS_DIR)) {
      if (dirEntry.isFile && dirEntry.name.endsWith(".sql")) {
        const tsMatch = dirEntry.name.match(/^(\d{14})_/);
        if (tsMatch && tsMatch[1] > latestSchemaVersion) {
          latestSchemaVersion = tsMatch[1];
        }
      }
    }
  } catch {
    // directory read error ignored
  }

  // 3. Update src/main.ts
  mainContent = mainContent.replace(
    /const APP_VERSION = "[^"]+";/,
    `const APP_VERSION = "${newVersion}";`
  );
  mainContent = mainContent.replace(
    /const REQUIRED_SCHEMA_VERSION = "[^"]+";/,
    `const REQUIRED_SCHEMA_VERSION = "${latestSchemaVersion}";`
  );
  await Deno.writeTextFile(MAIN_TS_PATH, mainContent);

  // 4. Update public/index.html
  let indexContent = await Deno.readTextFile(INDEX_HTML_PATH);
  indexContent = indexContent.replace(
    /<strong id="ui-version-badge">v[^<]+<\/strong>/,
    `<strong id="ui-version-badge">v${newVersion}</strong>`
  );
  indexContent = indexContent.replace(
    /<strong id="db-version-badge">v[^<]+<\/strong>/,
    `<strong id="db-version-badge">v${latestSchemaVersion}</strong>`
  );
  await Deno.writeTextFile(INDEX_HTML_PATH, indexContent);

  console.log(`🚀 Automated Version Uprev Completed:`);
  console.log(`   📦 App Version    : v${currentVersion} ➔ v${newVersion}`);
  console.log(`   🗄️ DB Schema Ver  : v${latestSchemaVersion}`);
  console.log(`   Updated: ${MAIN_TS_PATH}`);
  console.log(`   Updated: ${INDEX_HTML_PATH}`);
}

if (import.meta.main) {
  await uprevVersion();
}
