import { filter, map, reduce, camelCase, upperFirst } from 'lodash';
import R, {
  propEq,
  has,
  compose,
  prop,
  anyPass,
  T,
  always,
  cond,
  equals,
  any,
  ap,
  ifElse,
  path,
  join,
  concat,
  pathEq
} from 'ramda';

const transformCase = compose(
  upperFirst,
  camelCase
);

const scalarTypes = [
  'String',
  'Int',
  'Float',
  'Boolean',
  'Date',
  'Any',
  'Upload'
];
const isScalar = compose(
  any(R.__, scalarTypes),
  equals
);
const isDocument = propEq('type', 'document');
const isComposite = propEq('type', 'composite');
const isList = propEq('type', 'list');
const hasFilter = has('filter');
// const isPivot = propEq('type', 'pivot');
const isDocumentOrComposite = anyPass([isDocument, isComposite]);

const isGraphQLNumber = compose(
  any(R.__, ['number', 'money', 'percentage', 'autoNumber']),
  equals
);

const isGraphQLDate = compose(
  any(R.__, ['dateTime', 'date', 'time']),
  equals
);

const graphType = cond([
  [
    compose(
      equals('boolean'),
      prop('type')
    ),
    always('Boolean')
  ],
  [
    compose(
      equals('geoloc'),
      prop('type')
    ),
    always('[Float]')
  ],
  [
    compose(
      equals('composite'),
      prop('type')
    ),
    prop('objectRefId')
  ],
  [
    compose(
      equals('lookup'),
      prop('type')
    ),
    prop('document')
  ],
  [
    compose(
      equals('inheritLookup'),
      prop('type')
    ),
    prop('document')
  ],
  [
    compose(
      equals('address'),
      prop('type')
    ),
    always('Address')
  ],
  [
    compose(
      equals('personName'),
      prop('type')
    ),
    always('PersonName')
  ],
  [
    compose(
      equals('phone'),
      prop('type')
    ),
    always('Phone')
  ],
  [
    compose(
      equals('file'),
      prop('type')
    ),
    always('File')
  ],
  [
    compose(
      equals('filter'),
      prop('type')
    ),
    field => `[${prop('document', field)}]`
  ],
  [
    compose(
      isGraphQLNumber,
      prop('type')
    ),
    always('Float')
  ],
  [
    compose(
      isGraphQLDate,
      prop('type')
    ),
    always('Date')
  ],
  [T, always('String')]
]);

const inputGraphType = field => {
  const type = graphType(field);
  const isArray = /^\[.*/.test(type);
  const typeName = type.replace(/[\[\]]/g, '');
  const inputType = isScalar(typeName) ? typeName : `${typeName}Input`;
  if (isArray) {
    return `[${inputType}]`;
  } else {
    return inputType;
  }
};

const buildSchema = ({ metadata }) => {
  const documents = filter(metadata, isDocumentOrComposite);
  const types = join(
    '\n',
    reduce(
      documents,
      (acc, doc) =>
        concat(acc, [
          `type ${doc.name} {`,
          `\tid: String!`,
          ...map(
            doc.fields,
            field =>
              `\t${field.name}: ${field.isList ? '[' : ''}${graphType(field)}${
                field.isList ? ']' : ''
              }${field.isRequired ? '!' : ''}`
          ),
          '}\n'
        ]),
      []
    )
  );

  const inputTypes = join(
    '\n',
    reduce(
      documents,
      (acc, doc) =>
        concat(acc, [
          `input ${doc.name}Input {`,
          `\tid: String`,
          ...map(
            doc.fields,
            field =>
              `\t${field.name}: ${field.isList ? '[' : ''}${inputGraphType(
                field
              )}${field.isList ? ']' : ''}${field.isRequired ? '!' : ''}`
          ),
          '}\n'
        ]),
      []
    )
  );

  const filterTypes = join(
    '\n',
    reduce(
      documents,
      (acc, doc) =>
        concat(acc, [
          `input ${doc.name}Filter {`,
          `\tid: String`,
          ...map(doc.fields, field => `\t${field.name}: [Filter]`),
          '}\n'
        ]),
      []
    )
  );

  const documentQueries = join(
    '\n',
    reduce(
      documents,
      (acc, doc) =>
        concat(acc, [
          `\t${doc.name}Document(id: String!): ${doc.name}`,
          `\t${doc.name}List(filter: ${
            doc.name
          }Filter, offset: Float, limit: Float): ${doc.name}`,
          `\t${doc.name}Count(filter: ${
            doc.name
          }Input, offset: Float, limit: Float): Float`
        ]),
      []
    )
  );

  const mutations = join(
    '\n',
    reduce(
      documents,
      (acc, doc) =>
        concat(acc, [
          `\t${doc.name}Create(body: ${doc.name}Input!): ${doc.name}`,
          `\t${doc.name}Update(id: String!, body: ${
            doc.name
          }Input!, insertIfNotExists: Boolean): ${doc.name}`,
          `\t${doc.name}Remove(id: String!): Boolean`,
          ...reduce(
            filter(doc.fields, { isList: true }),
            (fieldsAcc, field) =>
              concat(fieldsAcc, [
                `\t${doc.name}${transformCase(
                  field.name
                )}ArrayAdd (id: String!, value:${inputGraphType(field)}!): ${
                  doc.name
                }`,
                `\t${doc.name}${transformCase(
                  field.name
                )}ArrayUpdate (id: String!, idOrIndex: Any!, insertIfNotExists: Boolean, value:${inputGraphType(
                  field
                )}!): ${doc.name}`,
                `\t${doc.name}${transformCase(
                  field.name
                )}ArrayRemove (id: String!, idOrIndex: Any!): ${doc.name}`
              ]),
            []
          )
        ]),
      []
    )
  );

  return `
scalar Any
scalar Date

type File {
	filename: String!
	mimetype: String!
	encoding: String!
}

input FileInput {
	filename: String
	mimetype: String
	encoding: String
}

input Filter {
	operator: String!
	value: String
	start: String
	end: String
	values: [String]
	pattern: String
}

type Address {
	id: String!
	placeType: String
	place: String
	number: String
	complement: String
	district: String
	city: String
	state: String
	postalCode: String
	country: String
	geolocation: [Float]
}

type PersonName {
	id: String!
	first: String
	last: String
	full: String
}

type Phone {
	id: String!
	type: String
	countryCode: Int
	phoneNumber: String
	extention: String
}

input PhoneInput {
	id: String
	type: String
	countryCode: Int
	phoneNumber: String
	extention: String
}

input AddressInput {
	id: String
	placeType: String
	place: String
	number: String
	complement: String
	district: String
	city: String
	state: String
	postalCode: String
	country: String
	geolocation: [Float]
}

input PersonNameInput {
	id: String
	first: String
	last: String
	full: String
}


input QueryOptions {
	skip: Int
	limit: Int
}



${types}

${inputTypes}

${filterTypes}

type Query {
${documentQueries}
}

type Mutation {
${mutations}
}`;
};
export default buildSchema;
