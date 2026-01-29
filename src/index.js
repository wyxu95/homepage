import { initializeNooxy } from 'nooxy';
import { SITE_CONFIG } from '../nooxy/config.js';

const proxy = initializeNooxy(SITE_CONFIG);

export default {
  async fetch(request) {
    return proxy(request);
  },
};
