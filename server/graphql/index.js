import { Meteor } from 'meteor/meteor';
import bodyParser from 'body-parser';
import { makeExecutableSchema } from 'graphql-tools';
import { ApolloServer, gql } from 'apollo-server-express';
import next from 'next';
import { parse } from 'url';
import { cond, always, T, endsWith } from 'ramda';

import buildSchema from './buildSchema';

const setupGraphQL = async app => {
  const dev = process.env.NODE_ENV !== 'production';
  const nextApp = next({
    dev,
    dir: './docs'
  });

  nextApp.prepare().then(() => {
    const metadata = Meteor.call('menu', {
      authTokenId: 'ud4CBxcjBYOot9lmBdGaqtKSEduEDcPDDYOUPREJBkw='
    });

    const typeDefs = gql`
      ${buildSchema({ metadata })}
    `;
    // const schema = makeExecutableSchema({
    //   typeDefs
    // });
    // const server = new ApolloServer({ typeDefs, resolvers });
    const server = new ApolloServer({ typeDefs });
    app.get('/graphql/docs', (req, res) => {
      const parsedUrl = parse(req.url, true);
      const { pathname, query } = parsedUrl;

      const handler = cond([
        [endsWith('schema'), always('/schema')],
        [T, always('/')]
      ]);
      console.log(handler(pathname));
      return nextApp.render(req, res, handler(pathname), query);
    });

    server.applyMiddleware({ app });

    //   app.use(
    //     '/graphql',
    //     bodyParser.json(),
    //     graphqlExpress(req => ({
    //       schema,
    //       context: {
    //         authorization: req.headers.authorization,
    //         authResult: req.authResult
    //       }
    //     }))
    //   );
    //   app.use(
    //     '/graphiql',
    //     graphiqlExpress({
    //       endpointURL: '/graphql'
    //     })
    //   );
  });
};

export default setupGraphQL;
