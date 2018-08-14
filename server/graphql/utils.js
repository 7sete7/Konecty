import { camelCase, upperFirst, isObject, isArray, reduce, map } from 'lodash';
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
  any
} from 'ramda';

const scalarTypes = [
  'String',
  'Int',
  'Float',
  'Boolean',
  'Date',
  'Any',
  'Upload'
];

export const transformCase = compose(
  upperFirst,
  camelCase
);

export const isScalar = compose(
  any(R.__, scalarTypes),
  equals
);
export const isDocument = propEq('type', 'document');
export const isComposite = propEq('type', 'composite');
export const isList = propEq('type', 'list');
export const hasFilter = has('filter');
export const isPivot = propEq('type', 'pivot');
export const isDocumentOrComposite = anyPass([isDocument, isComposite]);

export const isGraphQLNumber = compose(
  any(R.__, ['number', 'money', 'percentage', 'autoNumber']),
  equals
);

export const isGraphQLDate = compose(
  any(R.__, ['dateTime', 'date', 'time']),
  equals
);

export const graphType = cond([
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
  [
    compose(
      equals('email'),
      prop('type')
    ),
    always('Email')
  ],
  [T, always('String')]
]);

export const inputGraphType = field => {
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

export const renameId = doc => {
  if (isArray(doc)) {
    return map(doc, renameId);
  }
  if (isObject(doc)) {
    return reduce(
      doc,
      (acc, v, k) => ({
        ...acc,
        [k === '_id' ? 'id' : k]: renameId(v)
      }),
      {}
    );
  }
  return doc;
};
