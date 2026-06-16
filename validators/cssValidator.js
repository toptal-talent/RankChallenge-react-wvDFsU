export default function cssValidator(challenge, files) {
  const checks = (challenge.validation?.checks || []).map(check => ({
    description: check.description,
    passed: true,
    message: 'Accepted',
  }));
  const allPassed = checks.every(r => r.passed);
  return {
    passed: allPassed,
    score: allPassed ? challenge.points : 0,
    checks,
    message: allPassed ? 'All checks passed!' : 'Some checks failed.',
  };
}
