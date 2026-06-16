import { parse } from '@babel/parser';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const traverse = require('@babel/traverse').default;

export default function backendAstValidator(challenge, files) {
  const editableFile = challenge.files.find(f => f.editable);
  if (!editableFile) return { passed: false, score: 0, checks: [], message: 'No editable file found' };

  const code = files[editableFile.filename] || editableFile.content;
  const rules = challenge.validation?.parseRules || [];

  let ast;
  try {
    ast = parse(code, { sourceType: 'module', plugins: ['jsx'], errorRecovery: true });
  } catch (e) {
    return {
      passed: false,
      score: 0,
      checks: [{ description: 'Parse code', passed: false, message: `Syntax error: ${e.message}` }],
      message: 'Code has syntax errors.',
    };
  }

  const checks = rules.map(rule => {
    try {
      const result = applyRule(ast, code, rule);
      return { description: rule.description, passed: result.passed, message: result.message };
    } catch (e) {
      return { description: rule.description, passed: false, message: e.message };
    }
  });

  const allPassed = checks.every(c => c.passed);
  return {
    passed: allPassed,
    score: allPassed
      ? challenge.points
      : Math.floor(challenge.points * (checks.filter(c => c.passed).length / checks.length)),
    checks,
    message: allPassed ? 'All checks passed!' : 'Some checks failed. Keep going!',
  };
}

function applyRule(ast, code, rule) {
  switch (rule.rule) {
    case 'contains-string':
      return code.includes(rule.value)
        ? { passed: true, message: rule.passMessage || 'Found' }
        : { passed: false, message: rule.failMessage || `Missing: "${rule.value}"` };

    case 'no-string':
      return !code.includes(rule.value)
        ? { passed: true, message: rule.passMessage || 'Correct' }
        : { passed: false, message: rule.failMessage || `Should not contain: "${rule.value}"` };

    case 'has-declaration-before-use': {
      let declLine = Infinity, useLine = Infinity;
      traverse(ast, {
        VariableDeclaration(path) {
          if (path.toString().includes(rule.declarationName))
            declLine = Math.min(declLine, path.node.loc?.start?.line ?? Infinity);
        },
        CallExpression(path) {
          if (path.toString().includes(rule.useSite))
            useLine = Math.min(useLine, path.node.loc?.start?.line ?? Infinity);
        },
      });
      return declLine < useLine
        ? { passed: true, message: rule.passMessage || 'Declaration order correct' }
        : { passed: false, message: rule.failMessage || `"${rule.declarationName}" must be declared before it is used` };
    }

    case 'function-param-count': {
      let found = false;
      traverse(ast, {
        Function(path) {
          if (path.toString().split('{')[0].includes(rule.fnSignature) && path.node.params.length === rule.count)
            found = true;
        },
      });
      return found
        ? { passed: true, message: rule.passMessage || 'Correct parameter count' }
        : { passed: false, message: rule.failMessage || `Expected function matching "${rule.fnSignature}" to have ${rule.count} parameters` };
    }

    case 'array-includes': {
      let found = false;
      traverse(ast, {
        ArrayExpression(path) {
          if (path.node.elements.map(el => el?.value ?? null).includes(rule.value)) found = true;
        },
      });
      return found
        ? { passed: true, message: rule.passMessage || `Found "${rule.value}"` }
        : { passed: false, message: rule.failMessage || `Array must include "${rule.value}"` };
    }

    case 'property-value': {
      let found = false;
      traverse(ast, {
        ObjectProperty(path) {
          const key = path.node.key.name || path.node.key.value;
          if (key === rule.key && String(path.node.value.value) === String(rule.value)) found = true;
        },
      });
      return found
        ? { passed: true, message: rule.passMessage || `Property ${rule.key}: ${rule.value} found` }
        : { passed: false, message: rule.failMessage || `Expected ${rule.key} to be ${rule.value}` };
    }

    case 'uses-res-json': {
      let found = false;
      traverse(ast, {
        CallExpression(path) {
          const c = path.node.callee;
          if (c.type === 'MemberExpression' && c.object.name === 'res' && c.property.name === 'json')
            found = true;
        },
      });
      return found
        ? { passed: true, message: 'res.json() used correctly' }
        : { passed: false, message: 'Use res.json() instead of res.send()' };
    }

    case 'has-try-catch': {
      let found = false;
      traverse(ast, { TryStatement() { found = true; } });
      return found
        ? { passed: true, message: 'Error handling present' }
        : { passed: false, message: 'Add try/catch error handling' };
    }

    default:
      return { passed: false, message: `Unknown rule: ${rule.rule}` };
  }
}
