/**
 * Generic debug command core. Knows nothing about the game: subsystems register
 * named handlers, and every consumer (terminal view, Playwright bridge, URL
 * launcher) shares the same `run()` entry point.
 */

export interface DebugCommandSpec<C> {
    readonly name: string;
    readonly usage: string;
    readonly help: string;
    readonly run: (args: readonly string[], ctx: C) => string | void;
}

export interface DebugRunResult {
    readonly ok: boolean;
    readonly output: readonly string[];
}

/** Split a command line, honoring simple single/double quoted arguments. */
export function parseCommandLine(line: string): string[] {
    const parts: string[] = [];
    const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(line)) !== null) {
        parts.push(match[1] ?? match[2] ?? match[3]);
    }
    return parts;
}

/** Read `key=value` arguments; bare flags stay in the positional array. */
export function parseOptions(args: readonly string[]): Record<string, string> {
    const options: Record<string, string> = {};
    for (const arg of args) {
        const index = arg.indexOf("=");
        if (index > 0) options[arg.slice(0, index).toLowerCase()] = arg.slice(index + 1);
    }
    return options;
}

const HISTORY_CAP = 100;

export class CommandRegistry<C> {
    private readonly commands = new Map<string, DebugCommandSpec<C>>();
    private readonly historyLines: string[] = [];

    register(spec: DebugCommandSpec<C>): void {
        this.commands.set(spec.name.toLowerCase(), spec);
    }

    names(): string[] {
        return [...this.commands.keys()].sort();
    }

    help(): string[] {
        return [...this.commands.values()]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((command) => `${command.usage} — ${command.help}`);
    }

    history(): readonly string[] {
        return this.historyLines;
    }

    run(line: string, ctx: C): DebugRunResult {
        const trimmed = line.trim();
        if (!trimmed) return { ok: true, output: [] };
        if (this.historyLines[this.historyLines.length - 1] !== trimmed) {
            this.historyLines.push(trimmed);
            if (this.historyLines.length > HISTORY_CAP) this.historyLines.shift();
        }

        const [rawName, ...args] = parseCommandLine(trimmed);
        const name = rawName.toLowerCase();
        if (name === "help") {
            const topic = args[0]?.toLowerCase();
            if (topic) {
                const command = this.commands.get(topic);
                return command
                    ? { ok: true, output: [`${command.usage} — ${command.help}`] }
                    : { ok: false, output: [`没有名为「${topic}」的命令`] };
            }
            return { ok: true, output: this.help() };
        }

        const command = this.commands.get(name);
        if (!command) return { ok: false, output: [`未知命令：${name}（输入 help 查看全部）`] };
        try {
            const result = command.run(args, ctx);
            return { ok: true, output: typeof result === "string" ? result.split("\n") : [] };
        } catch (error) {
            return { ok: false, output: [`命令执行失败：${error instanceof Error ? error.message : String(error)}`] };
        }
    }
}
