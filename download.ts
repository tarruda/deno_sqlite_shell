import { readerFromStreamReader } from "https://deno.land/std@0.92.0/io/mod.ts";
import { createHash } from "https://deno.land/std@0.92.0/hash/mod.ts";
import { dirname } from "https://deno.land/std@0.92.0/path/mod.ts";
import JSZip from "https://dev.jspm.io/jszip@3.5.0";

import { Shell } from "./shell.ts";

const platform = Deno.build.os;

async function downloadSqlite(outPath: string) {
  const downloadBase = "https://sqlite.org/2021";

  const filenames = {
    linux: "sqlite-tools-linux-x86-3350400.zip",
    darwin: "sqlite-tools-osx-x86-3350400.zip",
    windows: "sqlite-tools-win32-x86-3350400.zip",
  };

  const sha256 = {
    linux: "48fe2dccd23398deb298bae88bebda70ab6bd96a2c9c604bf568b3387ad34d21",
    darwin: "cfd5693711793d38621295e0047c49bc8d249e97c720f6f57a68fe3a23570bf9",
    windows: "32522cca09c3a31331661445f4eafeac6e3880222e4910db47fa1fe81d2015a5",
  }[platform];

  const hash = createHash("sha256");
  const url = `${downloadBase}/${filenames[platform]}`;
  const response = await fetch(url);
  if (!response.body) {
    throw new Error(`Request to ${url} failed`);
  }
  const buffer = new Deno.Buffer();
  for await (const chunk of response.body) {
    hash.update(chunk);
    buffer.writeSync(chunk);
  }

  if (sha256 !== hash.toString("hex")) {
    throw new Error(`${url} didn't match expected sha256 sum`);
  }

  // deno-lint-ignore no-explicit-any
  const zip = new (JSZip as any)();
  await zip.loadAsync(buffer.bytes({ copy: false }));
  const unzipedData = new Deno.Buffer(
    (await zip.file(/\/sqlite3(?:\.exe)?$/)[0].async("uint8array")).buffer,
  );
  await Deno.mkdir(dirname(outPath), { recursive: true });
  const file = await Deno.open(outPath, { create: true, write: true });
  await Deno.copy(unzipedData, file);
  file.close();
  if (platform !== "windows") {
    await Deno.chmod(outPath, 0o755);
  }
}

export async function connect(databasePath?: string): Promise<Shell> {
  const sqliteProgram = {
    linux: `${Deno.env.get("XDG_CACHE_HOME") ??
      `${Deno.env.get("HOME")}/.cache`}/deno_sqlite_shell/sqlite3`,
    darwin: `${Deno.env.get("HOME")}/Library/Caches/deno_sqlite_shell/sqlite3`,
    windows: `${Deno.env.get("LOCALAPPDATA")}\\deno_sqlite_shell\\sqlite3.exe`,
  }[platform];
  const st = await (async () => {
    try {
      return await Deno.stat(sqliteProgram);
    } catch (err) {
      return null;
    }
  })();
  if (!st || !st.isFile) {
    await downloadSqlite(sqliteProgram);
  }
  return Shell.create({ sqliteProgram, databasePath });
}
