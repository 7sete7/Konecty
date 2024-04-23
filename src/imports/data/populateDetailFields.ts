import { Document } from '@imports/model/Document';
import { MetaObject } from '@imports/model/MetaObject';
import { User } from '@imports/model/User';
import { DataDocument } from '@imports/types/data';
import Bluebird from 'bluebird';
import merge from 'lodash/merge';
import size from 'lodash/size';
import { find } from './data';

type Params = {
	records: DataDocument[];
	document: string;
	contextUser: User;
};

type BulkLookups = {
	[fieldName: string]: DataDocument<{ recordId: string }>[];
};

export default async function populateDetailFields({ records, document, contextUser }: Params) {
	if (records.length === 0) {
		return records;
	}

	const metaObject = MetaObject.Meta[document];

	const lookups = getLookups(records, metaObject);
	const lookupFields = Object.keys(lookups);

	const findResults = await Bluebird.map(lookupFields, async fieldName => {
		const lookupField = metaObject.fields[fieldName];
		const lookupValues = lookups[fieldName];

		const idsToFind = lookupValues.map(lookupValue => lookupValue._id);
		const konFilter = {
			match: 'and',
			conditions: [{ term: '_id', operator: 'in', value: idsToFind }],
		};

		const result = await find({
			document: lookupField.document ?? 'no-doc',
			filter: konFilter,
			contextUser,
			fields: (lookupField.detailFields || []).join(','),
			limit: idsToFind.length,
		});

		return { ...result, fieldName };
	});

	const successLookupsResults = findResults.filter(result => result.success) as { data: DataDocument[]; fieldName: string }[];

	const populatedRecords = records.map(record => {
		for (const lookupField of lookupFields) {
			if (record[lookupField] == null) {
				continue;
			}

			const values = successLookupsResults.find(f => f.fieldName === lookupField)?.data;
			if (values == null) continue;

			const idsToIncorporate = lookups[lookupField].filter(v => v.recordId === record._id).map(v => v._id);
			if (idsToIncorporate.length === 0) continue;

			const lookupsResults = values.filter(l => idsToIncorporate.includes(l._id));
			if (lookupsResults.length === 0) continue;

			if (metaObject.fields[lookupField].isList && Array.isArray(record[lookupField])) {
				record[lookupField] = (record[lookupField] as DataDocument[]).map(value => {
					const lookupResult = lookupsResults.find(lookup => lookup._id === value._id);
					return lookupResult != null ? merge({}, value, lookupResult) : value;
				});
				continue;
			}

			record[lookupField] = merge({}, record[lookupField], lookupsResults[0]);
		}

		return record;
	});

	return populatedRecords;
}

function getLookups(records: DataDocument[], metaObject: Document): BulkLookups {
	return records.reduce((acc, record) => {
		const lookupFields = Object.keys(record).filter(fieldName => {
			const field = metaObject.fields[fieldName];
			return record[fieldName] != null && field != null && field.type === 'lookup' && size(field.detailFields) > 0;
		});

		for (const fieldName of lookupFields) {
			if (acc[fieldName] == null) {
				acc[fieldName] = [];
			}

			const lookupValues = Array().concat(record[fieldName] as DataDocument);
			acc[fieldName].push(...lookupValues.map(value => ({ _id: value._id, recordId: record._id })));
		}
		return acc;
	}, {} as BulkLookups);
}
