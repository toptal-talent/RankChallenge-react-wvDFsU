import { parse } from '@babel/parser';
import { createRequire } from 'module';
import http from 'http';

const require = createRequire(import.meta.url);
const traverse = require('@babel/traverse').default;

export default async function connectivityValidator(challenge, files) {
  const editableFile = challenge.files.find(f => f.editable);
  const code = files[editableFile ? editableFile.filename : 'api-connector.js'] || '';
  const steps = [];

  let ast;
  try {
    ast = parse(code, { sourceType: 'module', plugins: ['jsx'], errorRecovery: false });
    steps.push({ step: 'Syntax check', passed: true, message: 'No syntax errors' });
  } catch (e) {
    steps.push({ step: 'Syntax check', passed: false, message: `Syntax error: ${e.message}` });
    return buildResult(steps, challenge.points);
  }

  const portOk = code.includes('3001') && !code.match(/BASE_PORT\s*=\s*3000[^1]/);
  steps.push({
    step: 'Correct port (3001)',
    passed: portOk,
    message: portOk ? 'Port 3001 configured correctly' : 'BASE_PORT must be 3001, not 3000',
  });

  let hasExportConst = false, hasModuleExports = false;
  traverse(ast, {
    ExportNamedDeclaration() { hasExportConst = true; },
    ExportDefaultDeclaration() { hasExportConst = true; },
    AssignmentExpression(path) {
      if (path.get('left').matchesPattern('module.exports')) hasModuleExports = true;
    },
  });
  const noMixedExports = !(hasExportConst && hasModuleExports);
  steps.push({
    step: 'Consistent module system (no mixed ESM/CJS)',
    passed: noMixedExports,
    message: noMixedExports
      ? 'Module exports are consistent'
      : 'Do not mix `export const` (ESM) with `module.exports` (CJS). Use one or the other.',
  });

  const hasOkCheck = code.includes('response.ok') || code.includes('res.ok') || code.includes('.ok');
  steps.push({
    step: 'Response status check before parsing',
    passed: hasOkCheck,
    message: hasOkCheck ? 'Response.ok check present' : 'Add `if (!response.ok) throw new Error(...)` before calling `.json()`',
  });

  const hasContentType =
    code.includes("'Content-Type'") || code.includes('"Content-Type"') || code.includes('content-type');
  steps.push({
    step: 'Content-Type header on POST requests',
    passed: hasContentType,
    message: hasContentType ? 'Content-Type header present' : "Add `'Content-Type': 'application/json'` to fetch headers",
  });

  if (steps.every(s => s.passed)) {
    try {
      const ok = await livePing();
      steps.push({
        step: 'Live server ping',
        passed: ok,
        message: ok ? 'Server responded with { status: "ok" }' : 'Server ping failed — check the server is running',
      });
    } catch (e) {
      steps.push({ step: 'Live server ping', passed: false, message: `Ping error: ${e.message}` });
    }
  } else {
    steps.push({ step: 'Live server ping', passed: false, message: 'Fix earlier issues before live ping is attempted' });
  }

  return buildResult(steps, challenge.points);
}

function livePing() {
  return new Promise(resolve => {
    const req = http.get('http://localhost:3001/api/ping', res => {
      let body = '';
      res.on('data', d => { body += d; });
      res.on('end', () => {
        try { resolve(JSON.parse(body).status === 'ok'); }
        catch { resolve(false); }
      });
    });
    req.on('error', () => resolve(false));
    req.setTimeout(3000, () => { req.destroy(); resolve(false); });
  });
}

function buildResult(steps, maxPoints) {
  const passed = steps.every(s => s.passed);
  const passedCount = steps.filter(s => s.passed).length;
  return {
    passed,
    score: passed ? maxPoints : Math.floor(maxPoints * (passedCount / steps.length)),
    checks: steps,
    message: passed
      ? 'All systems go! Frontend can now communicate with the backend.'
      : `${passedCount}/${steps.length} checks passed. Keep fixing!`,
  };
}
