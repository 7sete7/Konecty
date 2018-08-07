const isDev = process.env.NODE_ENV !== 'production';

export default {
  httpAdminRoot: process.env.NODERED_ADMIN_PATH || '/red',
  httpNodeRoot: process.env.NODERED_API_PATH || '/api',
  userDir: isDev ? `./.nodered` : './',
  nodesDir: isDev ? `./.nodered` : './',
  flowFile: 'flows.json',
  flowFilePretty: true,
  functionGlobalContext: {
    env: process.env,
    lodash: require('lodash')
  }
};
