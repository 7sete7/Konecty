import { filter, reduce, replace, map } from 'lodash';

import { isDocumentOrComposite, renameId } from './utils';

const documentResolver = params => null;
const listResolver = (
  _,
  { filter = { match: 'and', conditions: [] }, sort, offset = 0, limit = 50 },
  { authTokenId },
  { returnType }
) => {
  const { data } = Meteor.call('data:find:all', {
    authTokenId,
    document: replace(returnType, /[\[|\]]/g, ''), // `${returnType}`
    filter,
    sort,
    limit,
    start: offset,
    withDetailFields: true,
    getTotal: false
  });
  return map(data, renameId);
};
const countResolver = params => null;

const buildResolvers = ({ metadata }) => {
  const documents = filter(metadata, isDocumentOrComposite);

  const documentResolvers = reduce(
    documents,
    (acc, doc) => ({
      ...acc,
      [`${doc.name}Document`]: documentResolver,
      [`${doc.name}List`]: listResolver,
      [`${doc.name}Count`]: countResolver
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
