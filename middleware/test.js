import { isMainThread } from 'worker_threads';
import ro from './requireObjects.js';

export default function testMiddleware() {
    ro();
}

if (!isMainThread) {
    testMiddleware();
}
