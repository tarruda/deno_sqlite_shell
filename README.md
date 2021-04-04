# Deno SQLite Shell

This is a SQLite module for Deno, an alternative to [deno-sqlite] or
[deno-sqlite-plugin].

Instead of compiling SQLite to WASM or implementing a wrapper in Rust, this
module has a simpler implementation: It spawns a long-running child [SQLite CLI]
process and communicates with it via stdin/stdout.

## Usage

API is similar to that of [deno-sqlite], but mostly async since this module is
delegating actual SQLite library usage to a child process. Also it doesn't have
prepared statements, so performance can be hurt.

```typescript
import { Shell } from "https://deno.land/x/sqlite_shell/mod.ts";

// Open a database by creating a Shell instance
const shell = await Shell.create({databasePath: "test.db"});
await shell.execute(
  "CREATE TABLE IF NOT EXISTS people (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)",
);

const names = ["Peter Parker", "Clark Kent", "Bruce Wayne"];

// Run a simple query
for (const name of names) {
  await shell.execute("INSERT INTO people (name) VALUES (?)", [name]);
}

// Print out data in table
for await (const {name} of shell.query("SELECT name FROM people")) {
  console.log(name);
}

// Close connection
await shell.close();
```

## How it works

Recent versions of [SQLite CLI] support JSON output mode, which makes it easy to
parse and split query results. This module depends on this feature and will fail
if the installed sqlite version doesn't support the `-json` command line flag.

The fact that it parses JSON output means binary data cannot be read
transparently like in other SQLite wrapper modules. If you SELECT a column that
might have binary data, it must be encoded to hex and then decoded on JS side:

```typescript
import { Shell } from "https://deno.land/x/sqlite_shell/mod.ts";
import { decodeString } from "https://deno.land/std/encoding/hex.ts";

const shell = await Shell.create({databasePath: "test.db"});
await shell.execute(
  "CREATE TABLE IF NOT EXISTS people (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)",
);
await shell.execute("INSERT INTO people (name) VALUES (?)", [new Uint8Array([1,
2, 3])]);
for await (const {hexName} of shell.query("SELECT hex(name) as hexName FROM people")) {
  console.log(decodeString(hexName as string));
}
await shell.close();
```

Each Shell instance owns a single [SQLite CLI] process, so if you need
concurrent access, multiple Shell instances are required. In an HTTP server
environment, you probably want to have a pool that assigns Shell instances to
incoming connections.

Note that this module will not hold your hand: You can pass any input to `Shell`
instances and it will be forwarded to [SQLite CLI]. For example, it is possible
to invoke `.mode list` to change the output format, which will completely break
parsing.

## Why?

I wrote this module for three reasons:

- I/O performance on [deno-sqlite] is really hurt by WASM. In fact, even though
  this module communicates with subprocesses and has no prepared statements, you
  might find it will outperform [deno-sqlite] on some real world usage
  scenarios.
- [deno-sqlite-plugin] is depending on `--unstable`, which might break on Deno
  updates.
- But the main reason is that I'm new to Deno and wanted an exercise to get a
  bit more familiar with its standard I/O API, which is different than Streams
  API used in Node.js.


[deno-sqlite]: https://deno.land/x/sqlite
[deno-sqlite-plugin]: https://github.com/crabmusket/deno_sqlite_plugin
[SQLite CLI]: https://sqlite.org/cli.html
