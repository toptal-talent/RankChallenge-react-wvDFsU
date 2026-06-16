import cssValidator from './cssValidator.js';
import jsValidator from './jsValidator.js';
import connectivityValidator from './connectivityValidator.js';
import backendAstValidator from './backendAstValidator.js';

export async function validate(challenge, files) {
  switch (challenge.validationType) {
    case 'css-property':
      return cssValidator(challenge, files);
    case 'js-eval':
    case 'network-request':
    case 'react-render':
      return jsValidator(challenge, files);
    case 'backend-parse':
      return backendAstValidator(challenge, files);
    case 'connectivity':
      return connectivityValidator(challenge, files);
    default:
      throw Object.assign(new Error(`Unknown validationType: ${challenge.validationType}`), { status: 400 });
  }
}
