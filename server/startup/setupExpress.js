import { Meteor } from 'meteor/meteor';
import express from 'express';
import cors from 'cors';
import healthcheck from 'express-healthcheck';

import setupGraphQL from '../graphql';

Meteor.startup(() => {
  // Accounts.setPassword('4ffcf81084aecfbaff50fd05', 'konecty123@');
  // console.log('senha trocada');
  const app = express();
  app.use(cors());
  app.use('/healthcheck', healthcheck());
  setupGraphQL(app);
  // app.get('/hello', (req, res) => {
  //   res.status(200).json({ message: 'Hello World!!!' });
  // });

  WebApp.connectHandlers.use(app);
});
