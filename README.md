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
import { connect } from "https://deno.land/x/sqlite_shell/mod.ts";

// Connect to a database
const db = await connect("test.db");
await db.execute(
  "CREATE TABLE IF NOT EXISTS people (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)",
);

const names = ["Peter Parker", "Clark Kent", "Bruce Wayne"];

// Run a simple query
for (const name of names) {
  await db.execute("INSERT INTO people (name) VALUES (?)", [name]);
}

// Print out data in table
for await (const { name } of db.query("SELECT name FROM people")) {
  console.log(name);
}

// Close connection
await db.close();
```

## How it works

Recent versions of [SQLite CLI] support JSON output mode, which makes it
possible to deterministically parse and split query results. This module depends
on this feature and will fail when used with an sqlite version that doesn't
support the `-json` command line flag.

The `connect` function imported from the main module will automatically download
the proper sqlite3 binary for the host platform and store in the user's cache
directory. This is done to simplify using this module, as it doesn't depend on
the sqlite3 installed on the host system which can have a different version.

To automatically download sqlite3 some extra dependencies are required (JSZip).
If this behavior is not desired, it is possible to manually import `Shell` from
the `shell.ts` module:

```typescript
import { Shell } from "https://deno.land/x/sqlite_shell/shell.ts";
// Connect to a database
const db = await Shell.create({ databasePath: "test.db" });
```

In the above example the "sqlite3" binary installed on the PATH will be used. It
is also possible to manually specify a path to "sqlite3" like so:

```typescript
import { Shell } from "https://deno.land/x/sqlite_shell/shell.ts";
// Connect to a database
const db = await Shell.create({
  sqliteProgram: "/path/to/sqlite3",
  databasePath: "test.db",
});
```

Since JSON output is parsed, binary data cannot be read transparently like in
other SQLite wrapper modules. If you SELECT a column that might have binary
data, it must be encoded to hex and then decoded on JS side:

```typescript
import { connect } from "https://deno.land/x/sqlite_shell/mod.ts";
import { decodeString } from "https://deno.land/std/encoding/hex.ts";

const db = await connect("test.db");
await db.execute(
  "CREATE TABLE IF NOT EXISTS people (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)",
);
await db.execute("INSERT INTO people (name) VALUES (?)", [
  new Uint8Array([1, 2, 3]),
]);
for await (
  const { hexName } of db.query("SELECT hex(name) as hexName FROM people")
) {
  console.log(decodeString(hexName as string));
}
await db.close();
```

Each Shell instance owns a single [SQLite CLI] process, so if you need
concurrent access, multiple Shell instances are required. In a server
environment, you probably want to have a pool that assigns Shell instances to
incoming connections.

Note that this module will not block special commands. Anything passed to
`query`/`execute` will be forwarded to [SQLite CLI]. For example, it is possible
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
