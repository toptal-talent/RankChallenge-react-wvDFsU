import { parse } from '@babel/parser';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const traverse = require('@babel/traverse').default;

function analyzeNetworkChallenge(challenge, files) {
  const editableFile = challenge.files.find(f => f.editable);
  if (!editableFile) return [];

  const code = files[editableFile.filename] || editableFile.content;
  const checks = challenge.validation?.checks || [];

  let ast;
  try {
    ast = parse(code, { sourceType: 'module', plugins: ['jsx'] });
  } catch (e) {
    return checks.map(c => ({ description: c.description, passed: false, message: `Parse error: ${e.message}` }));
  }

  return checks.map(check => {
    try {
      const result = evaluateAstCheck(ast, check, code);
      return { description: check.description, passed: result.passed, message: result.message };
    } catch (e) {
      return { description: check.description, passed: false, message: e.message };
    }
  });
}

function evaluateAstCheck(ast, check, code) {
  const rule = check.astRule;
  if (!rule) return { passed: true, message: 'No rule' };

  let found = false;

  if (rule.type === 'contains-string') {
    found = code.includes(rule.value);
  } else if (rule.type === 'no-string') {
    found = !code.includes(rule.value);
  } else if (rule.type === 'has-await') {
    traverse(ast, { AwaitExpression() { found = true; } });
  } else if (rule.type === 'has-try-catch') {
    traverse(ast, { TryStatement() { found = true; } });
  } else if (rule.type === 'has-method') {
    traverse(ast, {
      MemberExpression(path) {
        if (path.node.property.name === rule.value) found = true;
      },
    });
  }

  return found
    ? { passed: true, message: check.passMessage || 'Passed' }
    : { passed: false, message: check.failMessage || `Expected: ${JSON.stringify(rule)}` };
}

export default function jsValidator(challenge, files) {
  const checks = analyzeNetworkChallenge(challenge, files);
  if (checks.length === 0) return { passed: true, score: challenge.points, checks: [], message: 'Accepted' };
  const allPassed = checks.every(c => c.passed);
  return {
    passed: allPassed,
    score: allPassed ? challenge.points : 0,
    checks,
    message: allPassed ? 'All checks passed!' : 'Some checks failed.',
  };
}
