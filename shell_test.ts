import { assertEquals,
         assertThrows,
         assertThrowsAsync
} from "https://deno.land/std@0.91.0/testing/asserts.ts";

import { Shell, formatParam, bindParams } from './shell.ts';

async function setup () {
  const shell = await Shell.create();
  await shell.execute(`CREATE TABLE IF NOT EXISTS dbz_chars (
    id INTEGER PRIMARY KEY,
    name TEXT,
    power REAL
  )`);
  await shell.execute('BEGIN');
  for (const [name, power] of [
    ['goku', 100000],
    ['gohan', 70000],
    ['vegeta', 80000],
    ['goten', 45000.3],
    ['trunks', 47000.8],
  ]) {
    await shell.execute(
      `INSERT INTO dbz_chars (name, power) VALUES (?, ?)`, [name, power]);
  }
  await shell.execute('COMMIT');
  return shell;
}

async function teardown (shell: Shell) {
  await shell.close();
}

Deno.test("formatParam", () => {
  assertEquals(formatParam(null), 'NULL');
  assertEquals(formatParam(1), '1');
  assertEquals(formatParam(5.6), '5.6');
  assertEquals(formatParam(true), 'true');
  assertEquals(formatParam(false), 'false');
  assertEquals(formatParam('true'), "'true'");
  assertEquals(formatParam('false'), "'false'");
  assertEquals(formatParam("some 'string' with quotes"), "'some ''string'' with quotes'");
  assertEquals(formatParam(new Uint8Array([0xde, 0xad, 0xbe, 0xef])), "x'deadbeef'");
});

Deno.test("bindParams positional", () => {
  assertEquals(bindParams(
    "c1 = ? AND c2 = '?' AND c3 = ? AND c4 = ?", [1, 'string1', '2']),
    "c1 = 1 AND c2 = '?' AND c3 = 'string1' AND c4 = '2'");
  assertEquals(bindParams(
    "c1 = ? AND c2 = '?' AND c3 = ? AND c4 = ?", [true, false, "some 'quotes' in str"]),
    "c1 = true AND c2 = '?' AND c3 = false AND c4 = 'some ''quotes'' in str'");
  assertEquals(bindParams(
    "c1 = ? AND c2 = '?' AND c3 = ? AND c4 = ?", [4.5, 2.3, new Uint8Array([0, 1, 2, 3, 4, 5])]),
    "c1 = 4.5 AND c2 = '?' AND c3 = 2.3 AND c4 = x'000102030405'");
});

Deno.test("bindParams positional with less values than placeholders", () => {
  assertThrows(() => {
    bindParams(
    "c1 = ? AND c2 = '?' AND c3 = ? AND c4 = ?", [1, 'string1']);
  }, Error, `Cannot find parameter with index "2"`);
});

Deno.test("bindParams positional with more values than placeholders", () => {
  assertThrows(() => {
    bindParams(
    "c1 = ? AND c2 = '?' AND c3 = ? AND c4 = ?", [1, 'string1', '2', '3']);
  }, Error, `Not all parameters were used by "c1 = ? AND c2 = '?' AND c3 = ? AND c4 = ?"`);
});

Deno.test("bindParams named", () => {
  assertEquals(bindParams(
    "c1 = :c1 AND c2 = ':c2' AND c3 = :c3 AND c4 = :c4", {c1:1, c3:'string1', c4:'2'}),
    "c1 = 1 AND c2 = ':c2' AND c3 = 'string1' AND c4 = '2'");
  assertEquals(bindParams(
    "c1 = :c1 AND c2 = ':c2' AND c3 = :c3 AND c4 = :c4", {c1:true, c2: 'unused', c3:false, c4:"some 'quotes' in str"}),
    "c1 = true AND c2 = ':c2' AND c3 = false AND c4 = 'some ''quotes'' in str'");
  assertEquals(bindParams(
    "c1 = :c1 AND c2 = ':c2' AND c3 = :c3 AND c4 = :c4", {c1:4.5, c3:2.3, c4:new Uint8Array([0, 1, 2, 3, 4, 5])}),
    "c1 = 4.5 AND c2 = ':c2' AND c3 = 2.3 AND c4 = x'000102030405'");
});

Deno.test("bindParams named missing", () => {
  assertThrows(() => {
    bindParams(
    "c1 = :c1 AND c2 = ':c2' AND c3 = :c3 AND c4 = :c4", {c1:1, c4:'string1'});
  }, Error, `Cannot find parameter with key "c3"`);
});

Deno.test("query", async () => {
  const shell = await setup();

  assertEquals(await shell.queryAll('SELECT * FROM dbz_chars'), [
    { id: 1, name: "goku", power: 100000.0 },
    { id: 2, name: "gohan", power: 70000.0 },
    { id: 3, name: "vegeta", power: 80000.0 },
    { id: 4, name: "goten", power: 45000.3 },
    { id: 5, name: "trunks", power: 47000.8 }
  ])

  await teardown(shell);
});

Deno.test("query raw", async () => {
  const shell = await setup();

  const results = [];
  for await (const line of shell.queryRaw('SELECT * FROM dbz_chars')) {
    results.push(line);
  }
  assertEquals(results, [
    '{"id":1,"name":"goku","power":100000.0}',
    '{"id":2,"name":"gohan","power":70000.0}',
    '{"id":3,"name":"vegeta","power":80000.0}',
    '{"id":4,"name":"goten","power":45000.30000000000291}',
    '{"id":5,"name":"trunks","power":47000.80000000000291}',
  ])

  await teardown(shell);
});

Deno.test("query while already processing query", async () => {
  const shell = await setup();

  for await (const _ of shell.queryRaw('SELECT * FROM dbz_chars')) {
    await assertThrowsAsync(async () => {
      await shell.execute(
        "INSERT INTO dbz_chars (name, power) VALUES ('goku', 200000)");
    }, Error, 'Already processing another query');
  }

  // finished iterator, can insert now
  await shell.execute(
    "INSERT INTO dbz_chars (name, power) VALUES ('goku', 200000)");

  await teardown(shell);
});


Deno.test("start missing program", async () => {
  await assertThrowsAsync(async () => {
    await Shell.create({sqliteProgram: 'invalid-sqlite3'});
  }, Error);
});

Deno.test("start wrong args", async () => {
  await assertThrowsAsync(async () => {
    await Shell.create({sqliteArgs: ['-invalid-sqlite-cli-arg']});
  }, Error, 'Sqlite startup failed');
});

Deno.test("sanity tests with real file", async () => {
  const databasePath = await Deno.makeTempFile()
  const shell = await Shell.create({databasePath});

  await shell.execute(`CREATE TABLE IF NOT EXISTS dbz_chars (
    id INTEGER PRIMARY KEY,
    name TEXT,
    power REAL
  )`);

  await shell.execute('BEGIN');
  for (const [name, power] of [
    ['goku', 100000],
    ['gohan', 70000],
    ['vegeta', 80000],
    ['goten', 45000.3],
    ['trunks', 47000.8],
  ]) {
    await shell.execute(
      `INSERT INTO dbz_chars (name, power) VALUES (?, ?)`, [name, power]);
  }
  await shell.execute('COMMIT');
  await shell.close();

  const shell2 = await Shell.create({databasePath});
  assertEquals(await shell2.queryAll('SELECT * FROM dbz_chars'), [
    { id: 1, name: "goku", power: 100000.0 },
    { id: 2, name: "gohan", power: 70000.0 },
    { id: 3, name: "vegeta", power: 80000.0 },
    { id: 4, name: "goten", power: 45000.3 },
    { id: 5, name: "trunks", power: 47000.8 }
  ])

  await shell2.close();
  await Deno.remove(databasePath);
});

Deno.test("sqlite exiting with wrong status should throw on close()", async () => {
  const shell = await Shell.create();
  await shell.execute('.exit 1');
  await assertThrowsAsync(async () => {
    await shell.close();
  }, Error, 'SQLite exited with status: 1');
});
