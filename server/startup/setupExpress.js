import { Meteor } from 'meteor/meteor';
import express from 'express';
import cors from 'cors';
import healthcheck from 'express-healthcheck';

import setupGraphQL from '../graphql';
import setupNodered from '../nodered';

Meteor.startup(() => {
  const app = express();
  app.use(cors());
  app.use('/healthcheck', healthcheck());
  setupGraphQL(app);
  setupNodered(WebApp.httpServer, app);

  WebApp.connectHandlers.use(app);
});
