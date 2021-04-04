import { readerFromStreamReader } from "https://deno.land/std@0.92.0/io/mod.ts";

const downloadBase = "https://sqlite.org/2021";

const filename = {
  linux: "sqlite-tools-linux-x86-3350400.zip",
  darwin: "sqlite-tools-osx-x86-3350400.zip",
  windows: "sqlite-tools-win32-x86-3350400.zip"
}[Deno.build.os]

const url = `${downloadBase}/${filename}`;
const response = await fetch(url);
const file = await Deno.open(filename, { create: true, write: true });
const reader = readerFromStreamReader(response.body!.getReader());
await Deno.copy(reader, file);
file.close();

