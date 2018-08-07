import nodered from 'node-red';
import adminFlows from 'node-red/red/api/admin/flows';
import bodyParser from 'body-parser';
import config from './config';

const setupNodeRed = (server, app) => {
  nodered.init(server, config);
  app.post(`${config.httpAdminRoot}/flows`, bodyParser.json(), (req, res) => {
    const {
      body: { flows }
    } = req;
    console.log('=============================');
    console.log(flows);
    //TODO: Gravar o fluxo
    adminFlows.post(req, res);
  });
  app.use(config.httpNodeRoot, bodyParser.json(), nodered.httpNode);
  app.use(config.httpAdminRoot, nodered.httpAdmin);
  nodered.start();
};

export default setupNodeRed;
