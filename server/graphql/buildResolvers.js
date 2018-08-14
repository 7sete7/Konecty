import { filter, reduce, replace, map, first } from 'lodash';

import { isDocumentOrComposite, renameId } from './utils';

const documentResolver = document => (_, { id: dataId }, { authTokenId }) => {
  const { data } = Meteor.call('data:find:byId', {
    authTokenId,
    document,
    dataId
  });
  return renameId(first(data));
};

const listResolver = document => (
  _,
  { filter = { match: 'and', conditions: [] }, sort, offset = 0, limit = 50 },
  { authTokenId }
) => {
  const { data } = Meteor.call('data:find:all', {
    authTokenId,
    document,
    filter,
    sort,
    limit,
    start: offset,
    withDetailFields: true,
    getTotal: false
  });
  return map(data, renameId);
};
const countResolver = document => (
  _,
  { filter = { match: 'and', conditions: [] } },
  { authTokenId }
) => {
  const { total } = Meteor.call('data:find:all', {
    authTokenId,
    document,
    filter,
    limit: 1,
    start: 0,
    withDetailFields: false,
    getTotal: true
  });
  return total;
};

const buildResolvers = ({ metadata }) => {
  const documents = filter(metadata, isDocumentOrComposite);

  const documentResolvers = reduce(
    documents,
    (acc, doc) => ({
      ...acc,
      [`${doc.name}Document`]: documentResolver(doc.name),
      [`${doc.name}List`]: listResolver(doc.name),
      [`${doc.name}Count`]: countResolver(doc.name)
    }),
    {}
  );

  return {
    Query: {
      ...documentResolvers
    }
  };
};

export default buildResolvers;
