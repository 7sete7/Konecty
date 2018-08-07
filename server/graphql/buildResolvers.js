import { filter, reduce } from 'lodash';

import { isDocumentOrComposite } from './utils';

const documentResolver = params => null;
const listResolver = (
  _,
  { filter, sort, offset = 0, limit = 50 },
  __,
  { returnType }
) => {
  console.log(returnType);

  // const result = Meteor.call('data:find:all', {
  // authTokenId: sessionUtils.getAuthTokenIdFromReq(req),
  // authTokenId: '/Ft1vJNPrsqCw/ovElcCjMxZSsbVJumM/7AeCpO9lI0=',
  // document: returnType
  // displayName: req.params.query.displayName,
  // displayType: req.params.query.displayType,
  // fields: req.params.query.fields,
  // filter: req.params.query.filter,
  // sort: req.params.query.sort,
  // limit: req.params.query.limit,
  // start: req.params.query.start,
  // withDetailFields: req.params.query.withDetailFields,
  // getTotal: true
  // });
  // console.log(result);

  return null;
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
