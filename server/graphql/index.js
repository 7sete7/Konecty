import { Meteor } from 'meteor/meteor';
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
      authTokenId: '/Ft1vJNPrsqCw/ovElcCjMxZSsbVJumM/7AeCpO9lI0='
    });

    const typeDefs = gql`
      ${buildSchema({ metadata })}
    `;

    const server = new ApolloServer({ typeDefs });
    app.get('/graphql/docs', (req, res) => {
      const parsedUrl = parse(req.url, true);
      const { pathname, query } = parsedUrl;

      const handler = cond([
        [endsWith('schema'), always('/schema')],
        [T, always('/')]
      ]);

      return nextApp.render(req, res, handler(pathname), query);
    });

    server.applyMiddleware({ app });
  });
};

export default setupGraphQL;
