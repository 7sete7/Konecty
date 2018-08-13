import { filter, map, reduce } from 'lodash';
import { join, concat } from 'ramda';

import {
  transformCase,
  isDocumentOrComposite,
  graphType,
  inputGraphType
} from './utils';

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

  const documentQueries = join(
    '\n',
    reduce(
      documents,
      (acc, doc) =>
        concat(acc, [
          `\t${doc.name}Document(id: String!): ${doc.name}`,
          `\t${
            doc.name
          }List(filter: Filter, sort: Sort, offset: Float, limit: Float): [${
            doc.name
          }]`,
          `\t${doc.name}Count(filter: Filter): Float`
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

input FilterCondition {
  term: String!
  operator: String!
  value: Any
}

input Filter {
	match: String!
	conditions: [FilterCondition]!
}

enum SortDirection {
  ASC
  DESC
}

input Sort {
  property: String!
  direction: SortDirection
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

type Query {
${documentQueries}
}

type Mutation {
${mutations}
}`;
};
export default buildSchema;
