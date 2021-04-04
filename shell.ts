import { readLines } from "https://deno.land/std@0.92.0/io/mod.ts";
import { encodeToString as toHex } from "https://deno.land/std@0.92.0/encoding/hex.ts";

const SQLITE3_PROGRAM = "sqlite3";
const SQLITE3_ARGS = [
  "-batch",
  "-noheader",
  "-json",
  "-cmd",
  ".binary on",
  "-cmd",
  ".print *",
];

type PipedRunOptions = Omit<Deno.RunOptions, "stdout" | "stdin"> & {
  stdout: "piped";
  stdin: "piped";
};
type JSONPrimitive = string | number | boolean | null;
type Parameter = JSONPrimitive | Uint8Array;
type ParametersObject = { [key: string]: Parameter };
type ParametersArray = Array<Parameter>;
type QueryParameters = ParametersArray | ParametersObject;
interface JSONRow {
  [key: string]: JSONPrimitive;
}

interface CreateOpts {
  databasePath?: string;
  sqliteProgram?: string;
  sqliteArgs?: string[];
}

export function formatParam(param: Parameter): string {
  switch (typeof param) {
    case "string":
      // it seems the only escaping required for SQLite strings is the single
      // quote character
      return `'${param.replace(/'/g, "''")}'`;
    case "number":
    case "boolean":
      return param.toString();
    default:
      if (param instanceof Uint8Array) {
        return `x'${toHex(param)}'`;
      } else {
        return "NULL";
      }
  }
}

function paramReplacer(paramFetcher: (match: string) => Parameter) {
  let inQuote = false;
  return function (match: string) {
    if (match === "'") {
      inQuote = !inQuote;
      return match;
    }
    if (inQuote) {
      return match;
    }
    return formatParam(paramFetcher(match));
  };
}

function bindPositional(query: string, params: ParametersArray) {
  let idx = 0;
  const rv = query.replace(
    /['?]/g,
    paramReplacer(function (_) {
      const i = idx++;
      const value = params[i];
      if (value === undefined) {
        throw new Error(`Cannot find parameter with index "${i}"`);
      }
      return value;
    }),
  );
  if (idx <= params.length - 1) {
    throw new Error(`Not all parameters were used by "${query}"`);
  }
  return rv;
}

function bindNamed(query: string, params: ParametersObject) {
  return query.replace(
    /('|[@:$]\w+)/g,
    paramReplacer(function (match) {
      const key = match.slice(1);
      const value = params[key];
      if (value === undefined) {
        throw new Error(`Cannot find parameter with key "${key}"`);
      }
      return value;
    }),
  );
}

export function bindParams(query: string, params: QueryParameters) {
  if (Array.isArray(params)) {
    return bindPositional(query, params);
  } else {
    return bindNamed(query, params);
  }
}

export class Shell {
  private readonly encoder = new TextEncoder();
  private executing = false;

  static async create(opts: CreateOpts = {}): Promise<Shell> {
    const cmd = [opts.sqliteProgram ?? SQLITE3_PROGRAM]
      .concat(opts.sqliteArgs ? opts.sqliteArgs : SQLITE3_ARGS)
      .concat(opts.databasePath ? [opts.databasePath] : []);
    const proc = Deno.run({ cmd, stdin: "piped", stdout: "piped" });
    let started = false;
    for await (const line of readLines(proc.stdout)) {
      started = line.trim() === `*`;
      break;
    }
    if (!started) {
      proc.stdin.close();
      proc.stdout.close();
      await proc.status();
      proc.close();
      throw new Error(`Sqlite startup failed`);
    }
    return new Shell(proc);
  }

  private constructor(private process: Deno.Process<PipedRunOptions>) {}

  async *queryRaw(text: string, params?: QueryParameters) {
    if (this.executing) {
      throw new Error("Already processing another query");
    }
    this.executing = true;
    if (params) {
      text = bindParams(text, params);
    }
    try {
      const bytes = this.encoder.encode(`${text};\n.print *\n`);
      this.process.stdin.write(bytes);
      let i = 0;
      for await (const line of readLines(this.process.stdout)) {
        if (line === "*") {
          break;
        }
        // skip the opening bracket in the first line
        const rowStart = i++ === 0 ? 1 : 0;
        // Always strip the last character: It will be "]" on the last row and
        // "," otherwise.
        yield line.slice(rowStart, -1);
      }
    } finally {
      this.executing = false;
    }
  }

  async *query(text: string, params?: QueryParameters) {
    for await (const json of this.queryRaw(text, params)) {
      yield JSON.parse(json) as JSONRow;
    }
  }

  async queryAll(text: string, params?: QueryParameters): Promise<JSONRow[]> {
    const rv: Array<JSONRow> = [];
    for await (const row of this.query(text, params)) {
      rv.push(row);
    }
    return rv;
  }

  async execute(text: string, params?: QueryParameters) {
    for await (const _ of this.queryRaw(text, params));
  }

  async close() {
    this.process.stdin.close();
    this.process.stdout.close();
    const status = await this.process.status();
    this.process.close();
    if (status.code) {
      throw new Error(`SQLite exited with status: ${status.code}`);
    }
  }
}
