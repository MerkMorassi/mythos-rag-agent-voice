

import { VirtualFs, VFile } from "./virtualFs";
import { AGENTS } from "../agents";
// FIX: Replaced deprecated document functions with vector equivalents.
import { getAgentConfig, saveAgentConfig, getAllVectors, executeSql, updateDocumentPermissions, deleteVector } from "./db";
import { AccessControl } from "./accessControl";

export interface ShellResult {
    output: string;
    newDir?: string;
    action?: { type: 'SWITCH_AGENT', payload: string };
}

export class ShellService {
    private currentUser: string;
    private currentDir: string;
    private isSudo: boolean = false; // Ephemeral sudo state for current command

    constructor(initialUser: string = 'guest') {
        this.currentUser = initialUser;
        this.currentDir = '/';
    }

    public setUser(user: string) {
        this.currentUser = user.toLowerCase();
    }

    public getPrompt(): string {
        const char = this.currentUser === 'root' ? '#' : '$';
        return `${this.currentUser}@mythos:${this.currentDir}${char}`;
    }

    public async execute(cmdStr: string): Promise<ShellResult> {
        let args = cmdStr.trim().split(/\s+/);
        let cmd = args[0].toLowerCase();
        
        // --- SUDO LOGIC ---
        this.isSudo = false;
        if (cmd === 'sudo') {
            this.isSudo = true;
            args.shift(); // remove sudo
            if (args.length === 0) return { output: 'usage: sudo [command]' };
            cmd = args[0].toLowerCase();
        }

        if (!cmd) return { output: '' };

        try {
            switch (cmd) {
                case 'help':
                    return { output: `
MYTHOS SHELL v2.0.0 (UNIX-like)
-------------------------------
ls [path]       List directory contents
cd [path]       Change directory
cat [file]      Display file content
grep [pat] [f]  Search file content
find [path]...  Search for files (supports -name, -type, -exec)
chmod [-R] [m]  Change mode (recursive supported)
rm [file]       Remove file (Lore only)
whoami          Print current user
su [agent]      Switch active agent
sql [query]     Execute Virtual SQL (SELECT, UPDATE, DELETE)
clear           Clear terminal
sudo [cmd]      Execute as root
` };

                case 'ls': {
                    const path = args[1] ? this.resolvePath(args[1]) : this.currentDir;
                    const files = await VirtualFs.list(path);
                    if (files.length === 0) return { output: 'total 0' };
                    
                    const lines = files.map(f => {
                        const size = f.size.toString().padStart(6);
                        const date = new Date().toLocaleDateString();
                        const color = f.type === 'dir' ? '#4ade80' : '#a78bfa';
                        return `<span style="color:#666">${f.permissions}</span> <span style="color:#888">${f.owner}</span> <span style="color:#666">${size}</span> <span style="color:#666">${date}</span> <span style="color:${color};font-weight:bold">${f.name}</span>`;
                    });
                    return { output: lines.join('<br/>') };
                }

                case 'cd': {
                    const target = args[1] || '/';
                    const newPath = this.resolvePath(target);
                    if (['/', '/agents', '/lore', '/logs', '/sys'].includes(newPath)) {
                        this.currentDir = newPath;
                        return { output: '', newDir: newPath };
                    }
                    return { output: `bash: cd: ${target}: No such directory` };
                }

                case 'whoami':
                    return { output: this.isSudo ? 'root' : this.currentUser };

                case 'cat': {
                    if (!args[1]) return { output: 'usage: cat [file]' };
                    const target = this.resolvePath(args[1]);
                    const content = await VirtualFs.read(target);
                    if (content === null) return { output: `cat: ${args[1]}: No such file or directory` };
                    return { output: `<pre style="white-space:pre-wrap;color:#aaddff">${content}</pre>` };
                }

                case 'grep': {
                    // grep "pattern" file
                    // simple implementation: grep pattern file
                    if (args.length < 3) return { output: 'usage: grep [pattern] [file]' };
                    const pattern = args[1].replace(/['"]/g, '');
                    const file = args[2];
                    const target = this.resolvePath(file);
                    const content = await VirtualFs.read(target);
                    
                    if (content === null) return { output: `grep: ${file}: No such file` };
                    
                    const lines = content.split('\n');
                    const matches = lines
                        .filter(l => l.includes(pattern))
                        .map(l => l.replace(pattern, `<span style="color:red;background:yellow;font-weight:bold">${pattern}</span>`));
                    
                    if (matches.length === 0) return { output: '' };
                    return { output: matches.join('<br/>') };
                }

                case 'su': {
                    const targetHandle = args[1];
                    if (!targetHandle) return { output: 'usage: su [agent_handle]' };
                    
                    const agent = AGENTS.find(a => a.handle.toLowerCase() === targetHandle.toLowerCase());
                    if (!agent) return { output: `su: user ${targetHandle} does not exist` };
                    
                    this.currentUser = agent.handle.toLowerCase();
                    return { 
                        output: `Switched to user ${this.currentUser}`,
                        action: { type: 'SWITCH_AGENT', payload: agent.id }
                    };
                }

                case 'rm': {
                    // rm /lore/filename
                    const target = args[1];
                    if (!target) return { output: 'usage: rm [file]' };
                    if (!this.checkPermission('write')) return { output: `rm: cannot remove '${target}': Permission denied` };

                    const resolved = this.resolvePath(target);
                    if (!resolved.startsWith('/lore')) return { output: `rm: cannot remove '${target}': Read-only file system (Agents are protected)` };

                    const docs = await getAllVectors();
                    const fileName = resolved.split('/').pop();
                    // FIX: Changed property from title to source to match VectorRecord
                    const doc = docs.find(d => (d.source || d.id).replace(/[^a-zA-Z0-9.-]/g, '_').toLowerCase().substring(0, 40) === fileName);

                    if (doc) {
                        // FIX: Replaced deleteDocument with deleteVector
                        await deleteVector(doc.id);
                        return { output: `removed '${target}'` };
                    }
                    return { output: `rm: cannot remove '${target}': No such file` };
                }

                case 'chmod': {
                    // Syntax: chmod [-R] mode file...
                    let modeIndex = 1;
                    let recursive = false;
                    
                    if (args[1] === '-R') {
                        recursive = true;
                        modeIndex = 2;
                    }
                    
                    const mode = args[modeIndex];
                    const targetPath = args[modeIndex + 1];

                    if (!mode || !targetPath) return { output: 'usage: chmod [-R] [mode] [path]' };
                    if (!/^[0-7]{3}$/.test(mode)) return { output: `chmod: invalid mode: '${mode}'` };
                    
                    // Permission Check
                    if (!this.checkPermission('admin')) return { output: `chmod: changing permissions of '${targetPath}': Operation not permitted` };

                    const resolved = this.resolvePath(targetPath);

                    // --- RECURSIVE LOGIC ---
                    if (recursive) {
                        // If path is /, /agents, /lore
                        let count = 0;
                        if (resolved === '/agents' || resolved === '/') {
                            for (const a of AGENTS) {
                                const cfg = await getAgentConfig(a.id);
                                await saveAgentConfig(a.id, { ...cfg, accessLevel: mode });
                                count++;
                            }
                        }
                        if (resolved === '/lore' || resolved === '/') {
                            const docs = await getAllVectors();
                            for (const d of docs) {
                                await updateDocumentPermissions(d.id, mode);
                                count++;
                            }
                        }
                        return { output: `chmod: updated ${count} files recursively to ${mode}` };
                    } 
                    // --- SINGLE FILE LOGIC ---
                    else {
                        if (resolved.startsWith('/agents')) {
                            const handle = resolved.split('/').pop()!;
                            const agent = AGENTS.find(a => a.handle.toLowerCase() === handle);
                            if (agent) {
                                const cfg = await getAgentConfig(agent.id);
                                await saveAgentConfig(agent.id, { ...cfg, accessLevel: mode });
                                return { output: `mode of '${handle}' changed to ${mode}` };
                            }
                        }
                        if (resolved.startsWith('/lore')) {
                            const fileName = resolved.split('/').pop()!;
                            const docs = await getAllVectors();
                            // FIX: Changed property from title to source to match VectorRecord
                            const doc = docs.find(d => (d.source || d.id).replace(/[^a-zA-Z0-9.-]/g, '_').toLowerCase().substring(0, 40) === fileName);
                            if (doc) {
                                await updateDocumentPermissions(doc.id, mode);
                                return { output: `mode of '${fileName}' changed to ${mode}` };
                            }
                        }
                        return { output: `chmod: cannot access '${targetPath}': No such file` };
                    }
                }

                case 'find': {
                    // Syntax: find [path] -name [pattern] -exec [cmd] {} \;
                    // Simplified: find [path] -name [pattern]
                    // If -exec is present, we try to run it.
                    
                    const startPath = args[1] || '.';
                    let resolvedStart = this.resolvePath(startPath);
                    
                    // Collect all files recursively from startPath
                    let allFiles: VFile[] = [];
                    if (resolvedStart === '/' || resolvedStart === '/agents') {
                        allFiles = allFiles.concat(await VirtualFs.list('/agents'));
                    }
                    if (resolvedStart === '/' || resolvedStart === '/lore') {
                        allFiles = allFiles.concat(await VirtualFs.list('/lore'));
                    }

                    // Parse flags
                    let namePattern = '*';
                    let execCmdTemplate = '';
                    
                    for (let i = 2; i < args.length; i++) {
                        if (args[i] === '-name' && args[i+1]) {
                            namePattern = args[i+1].replace(/['"]/g, '');
                            i++;
                        }
                        if (args[i] === '-exec') {
                            // read until semicolon or end
                            const execParts = [];
                            let j = i + 1;
                            while (j < args.length && args[j] !== ';') {
                                execParts.push(args[j]);
                                j++;
                            }
                            execCmdTemplate = execParts.join(' ');
                            i = j; 
                        }
                    }

                    // Regex for name pattern
                    const regex = new RegExp(namePattern.replace(/\*/g, '.*'));
                    const matches = allFiles.filter(f => regex.test(f.name));

                    let outputLines = [];
                    
                    if (execCmdTemplate) {
                        for (const file of matches) {
                            const cmdToRun = execCmdTemplate.replace('{}', file.path);
                            // Recursively execute!
                            const res = await this.execute(cmdToRun);
                            if (res.output) outputLines.push(res.output);
                        }
                    } else {
                        outputLines = matches.map(f => f.path);
                    }

                    if (outputLines.length === 0) return { output: '' };
                    return { output: outputLines.join('<br/>') };
                }

                case 'sql': {
                    const rawSql = args.slice(1).join(' ');
                    if (!rawSql) return { output: "usage: sql [query]" };
                    
                    if (!this.checkPermission('read') && rawSql.toUpperCase().startsWith('SELECT')) return { output: "sql: Permission denied (SELECT)" };
                    if (!this.checkPermission('write') && (rawSql.toUpperCase().startsWith('UPDATE') || rawSql.toUpperCase().startsWith('DELETE'))) return { output: "sql: Permission denied (WRITE)" };

                    const result = await executeSql(rawSql);
                    return { output: result };
                }

                default:
                    return { output: `bash: ${cmd}: command not found` };
            }
        } catch (e: any) {
            return { output: `bash: error: ${e.message}` };
        }
    }

    private resolvePath(path: string): string {
        if (path.startsWith('/')) return path;
        if (path === '..') {
            if (this.currentDir === '/') return '/';
            return '/' + this.currentDir.split('/').slice(1, -1).join('/');
        }
        if (path === '.') return this.currentDir;
        
        const sep = this.currentDir === '/' ? '' : '/';
        return `${this.currentDir}${sep}${path}`;
    }

    private checkPermission(type: 'read' | 'write' | 'execute' | 'admin'): boolean {
        if (this.isSudo) return true;
        if (this.currentUser === 'root') return true;
        
        // For guest/agents, we can do a lookup of their specific agent config bits if needed.
        // For simplicity in this shell mock:
        if (this.currentUser === 'guest') return type === 'read';
        
        // Agent checks
        const agent = AGENTS.find(a => a.handle.toLowerCase() === this.currentUser);
        if (agent) {
            // e.g. 755 -> user=7, group=5, world=5
            // But we don't have a full FS implementation of ownership per file here.
            // We'll rely on the Agent's "role" implicitly.
            if (type === 'admin') {
                // Only Archivax or user with ADMIN_OVERRIDE (bit 4 in 3rd digit)
                const level = agent.accessLevel;
                const sysBit = parseInt(level[2]);
                return sysBit >= 4;
            }
            return true; // Agents can generally read/write in their shell session unless admin
        }
        
        return false;
    }
}