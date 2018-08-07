import { isDocumentOrComposite } from './utils';

const documentResolver = document => params => null;
const listResolver = document => params => null;
const countResolver = document => params => null;

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
