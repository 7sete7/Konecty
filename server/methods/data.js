import { Meteor } from 'meteor/meteor';
import { Random } from 'meteor/random';

import moment from 'moment';

import isObject from 'lodash/isObject';
import isString from 'lodash/isString';
import _isNaN from 'lodash/isNaN';
import each from 'lodash/each';
import isArray from 'lodash/isArray';
import uniq from 'lodash/uniq';
import compact from 'lodash/compact';
import extend from 'lodash/extend';
import isEmpty from 'lodash/isEmpty';
import pick from 'lodash/pick';
import find from 'lodash/find';
import clone from 'lodash/clone';
import isNumber from 'lodash/isNumber';
import _first from 'lodash/first';
import words from 'lodash/words';
import tail from 'lodash/tail';
import has from 'lodash/has';
import map from 'lodash/map';
import get from 'lodash/get';
import size from 'lodash/size';

import { post } from 'request';

import { getAccessFor, getFieldPermissions, getFieldConditions, removeUnauthorizedDataForRead } from '/imports/utils/accessUtils';
import { filterUtils } from '/imports/utils/konutils/filterUtils';
import { metaUtils } from '/imports/utils/konutils/metaUtils';
import { sortUtils } from '/imports/utils/konutils/sortUtils';
import { utils } from '/imports/utils/konutils/utils';
import { Meta, Models, Namespace, DisplayMeta, References } from '/imports/model/MetaObject';
import { renderTemplate } from '/lib/renderTemplate';
import { logger } from '/imports/utils/logger';

/* Get next user of queue
	@param authTokenId
	@param document
	@param queueId
*/
Meteor.registerMethod('data:queue:next', 'withUser', 'withAccessForDocument', function (request) {
	const user = metaUtils.getNextUserFromQueue(request.queueId, this.user);

	if (!user) {
		return { success: false };
	}

	return { success: true, user };
});

/* Get a list of records
	@param authTokenId
	@param document
	@param displayName
	@param displayType
	@param fields
	@param filter
	@param sort
	@param limit
	@param start
	@param getTotal
*/
Meteor.registerMethod('data:find:all', 'withUser', 'withAccessForDocument', function (request) {
	let accessField, condition;

	// Verify if user have permission to read records
	if (this.access.isReadable !== true) {
		return new Meteor.Error('internal-error', `[${request.document}] You don't have permission to read records`);
	}

	const model = Models[request.document];
	if (!model) {
		return new Meteor.Error('internal-error', `[${request.document}] Document does not exists`);
	}

	const fields = utils.convertStringOfFieldsSeparatedByCommaIntoObjectToFind(request.fields);

	if (has(fields, '$textScore')) {
		fields.$textScore = { $meta: 'textScore' };
	}

	const metaObject = Meta[request.document];

	let query = {};

	// Define init filter
	const filter = {
		match: 'and',
		filters: [],
	};

	// If filter is not given, apply meta default filters
	if (!isObject(request.filter) && request.displayName && request.displayType) {
		const displayMeta = DisplayMeta[`${request.document}:${request.displayType}:${request.displayName}`];
		if (has(displayMeta, 'filter')) {
			filter.filters.push(displayMeta.filter);
		}
	}

	if (isObject(this.access.readFilter)) {
		filter.filters.push(this.access.readFilter);
	}

	if (isObject(request.filter)) {
		filter.filters.push(request.filter);
	}

	// Parse filters
	const readFilter = filterUtils.parseFilterObject(filter, metaObject, this);
	if (readFilter instanceof Error) {
		logger.error(readFilter, `Find - Filter Error: ${readFilter.message}`);
		return readFilter;
	}

	// If there are filter then init query with this filter
	if (isObject(readFilter) && Object.keys(readFilter).length > 0) {
		query = readFilter;
	}

	if (isObject(request.filter) && isString(request.filter.textSearch)) {
		query.$text = { $search: request.filter.textSearch };
	}

	// Validate if user have permission to view each field
	const emptyFields = Object.keys(fields).length === 0;
	for (var fieldName in metaObject.fields) {
		accessField = getFieldPermissions(this.access, fieldName);
		if (accessField.isReadable !== true) {
			if (emptyFields === true) {
				fields[fieldName] = 0;
			} else {
				delete fields[fieldName];
			}
		}
	}

	let sort = {};
	if (request.sort) {
		if (isString(request.sort)) {
			request.sort = JSON.parse(request.sort);
		}

		sort = sortUtils.parseSortArray(request.sort);
		if (sort instanceof Error) {
			logger.error(sort, `Find - Sort Error: ${sort.message}`);
			return sort;
		}
	}

	// Force money to filter with .value
	for (let key in sort) {
		if (get(metaObject, `fields.${key}.type`) === 'money') {
			sort[`${key}.value`] = sort[key];
			delete sort[key];
		}

		if (get(metaObject, `fields.${key}.type`) === 'personName') {
			sort[`${key}.full`] = sort[key];
			delete sort[key];
		}

		if (key === '$textScore') {
			if (fields.$textScore) {
				sort.$textScore = { $meta: 'textScore' };
			} else {
				delete sort.$textScore;
			}
		}
	}

	const accessConditions = [];

	for (fieldName in metaObject.fields) {
		accessField = getFieldPermissions(this.access, fieldName);
		if (accessField.isReadable === true) {
			const accessFieldConditions = getFieldConditions(this.access, fieldName);
			if (accessFieldConditions.READ) {
				condition = filterUtils.parseFilterCondition(accessFieldConditions.READ, metaObject, this, true);
				if (condition instanceof Error) {
					logger.error(condition, `Find - Access Filter Error: ${condition.message}`);
					return condition;
				}

				accessConditions.push({
					fieldName,
					condition,
				});

				if ((emptyFields === true && !fields[fieldName]) || (emptyFields !== true && fields[fieldName] === 1)) {
					const conditionFields = Object.keys(condition);
					for (let conditionField of conditionFields) {
						if (emptyFields === true) {
							delete fields[conditionField];
						} else {
							fields[conditionField] = 1;
						}
					}
				}
			}
		}
	}

	var options = {
		limit: parseInt(request.limit),
		skip: request.start != null ? parseInt(request.start) : 0,
		fields,
		sort,
	};

	if (_isNaN(options.limit) || !options.limit) {
		options.limit = 50;
	}

	if (options.limit > 1000) {
		options.sort = { _id: 1 };
	}

	let records;
	try {
		const startTime = process.hrtime();

		records = model.find(query, options).fetch();

		const totalTime = process.hrtime(startTime);
		const log = `${totalTime[0]}s ${totalTime[1] / 1000000}ms => Find ${request.document}, filter: ${JSON.stringify(query)}, options: ${JSON.stringify(options)}`.brightCyan;
		logger.trace(log);
	} catch (error) {
		logger.error(error, `Error executing query: ${error.message}`);

		return {
			success: false,
			errors: [
				{
					message: 'Oops something went wrong, please try again later... if this message persisits, please contact our support',
				},
			],
			data: [],
		};
	}

	const local = {
		collection: new Meteor.Collection(null),
	};

	for (var record of records) {
		try {
			local.collection.insert(utils.mapDateValue(record));
		} catch (error) {
			logger.error(error, `Error inserting record into local collection ${request.document}: ${error.message}`);
		}
	}

	for (let accessCondition of accessConditions) {
		const update = { $unset: {} };
		update.$unset[accessCondition.fieldName] = 1;
		options = { multi: true };

		const affected = local.collection.update(accessCondition.condition, update, options);
		logger.trace(affected, 'records affected by access condition', accessCondition.condition, update, options);
	}

	records = local.collection.find().fetch();

	delete local.collection;

	const data = {
		success: true,
		data: records,
	};

	if (request.getTotal === true) {
		data.total = model.find(query).count();
	}

	if (request.withDetailFields === 'true') {
		for (let index = 0; index < records.length; index++) {
			record = records[index];
			const populatedRecord = Meteor.call('data:populate:detailFieldsInRecord', {
				record,
				document: request.document,
				__scope__: {
					user: this.user,
					access: this.access,
				},
			});

			if (populatedRecord) {
				records[index] = populatedRecord;
			}
		}
	}

	return data;
});

/* Get distinct field values from records
	@param authTokenId
	@param document
	@param field
*/
Meteor.registerMethod('data:find:distinct', 'withUser', 'withAccessForDocument', function (request) {
	// Verify if user have permission to read records
	if (this.access.isReadable !== true) {
		return new Meteor.Error('internal-error', `[${request.document}] You don't have permission to read records`);
	}

	const model = Models[request.document];
	if (!model) {
		return new Meteor.Error('internal-error', `[${request.document}] Document does not exists`);
	}

	if (!isString(request.field)) {
		return new Meteor.Error('internal-error', `[${request.document}] field must be string`);
	}

	const metaObject = Meta[request.document];

	let query = {};

	// Define init filter
	const filter = {
		match: 'and',
		filters: [],
	};

	if (isObject(this.access.readFilter)) {
		filter.filters.push(this.access.readFilter);
	}

	// Parse filters
	const readFilter = filterUtils.parseFilterObject(filter, metaObject, this);
	if (readFilter instanceof Error) {
		logger.error(readFilter, `Find - Filter Error: ${readFilter.message}`);
		return readFilter;
	}

	// If there are filter then init query with this filter
	if (isObject(readFilter) && Object.keys(readFilter).length > 0) {
		query = readFilter;
	}

	// Validate if user have permission to view field

	const accessField = getFieldPermissions(this.access, request.field);
	if (accessField.isReadable !== true) {
		return new Meteor.Error('internal-error', `[${request.document}] You don't have permission to read field`);
	}

	let options = {
		fields: utils.convertStringOfFieldsSeparatedByCommaIntoObjectToFind(request.field),
	};

	const records = model.find(query, options).fetch();

	const values = [];
	each(records, function (item) {
		const value = utils.getObjectPathAgg(item, request.field);
		if (isArray(value)) {
			each(value, _value => values.push(_value));
		} else {
			values.push(value);
		}
	});

	const uniques = uniq(compact(values));

	const data = {
		success: true,
		data: uniques,
	};

	return data;
});

/* Get a record by id
	@param authTokenId
	@param document
	@param fields
	@param dataId
*/
Meteor.registerMethod('data:find:byId', 'withUser', 'withAccessForDocument', function (request) {
	let accessField, condition;

	// Verify if user have permission to read records
	if (this.access.isReadable !== true) {
		return new Meteor.Error('internal-error', `[${request.document}] You don't have permission to read records`);
	}

	const model = Models[request.document];
	if (!model) {
		return new Meteor.Error('internal-error', `[${request.document}] Document does not exists`);
	}

	if (!isString(request.dataId)) {
		return new Meteor.Error('internal-error', `[${request.document}] DataId must be string`);
	}

	const metaObject = Meta[request.document];

	let query = {};

	// Define init filter
	const filter = {
		match: 'and',
		filters: [],
	};

	if (isObject(this.access.readFilter)) {
		filter.filters.push(this.access.readFilter);
	}

	// Parse filters
	const readFilter = filterUtils.parseFilterObject(filter, metaObject, this);
	if (readFilter instanceof Error) {
		logger.error(readFilter, `Find - Filter Error: ${readFilter.message}`);
		return readFilter;
	}

	// If there are filter then init query with this filter
	if (isObject(readFilter) && Object.keys(readFilter).length > 0) {
		query = readFilter;
	}

	const fields = utils.convertStringOfFieldsSeparatedByCommaIntoObjectToFind(request.fields);

	// Validate if user have permission to view each field
	const emptyFields = Object.keys(fields).length === 0;
	for (var fieldName in metaObject.fields) {
		accessField = getFieldPermissions(this.access, fieldName);
		if (accessField.isReadable !== true) {
			if (emptyFields === true) {
				fields[fieldName] = 0;
			} else {
				delete fields[fieldName];
			}
		}
	}

	query._id = request.dataId;

	const accessConditions = [];

	for (fieldName in metaObject.fields) {
		accessField = getFieldPermissions(this.access, fieldName);
		if (accessField.isReadable === true) {
			const accessFieldConditions = getFieldConditions(this.access, fieldName);
			if (accessFieldConditions.READ) {
				condition = filterUtils.parseFilterCondition(accessFieldConditions.READ, metaObject, this, true);
				if (condition instanceof Error) {
					logger.error(condition, `FindOne - Access Filter Error: ${condition.message}`);
					return condition;
				}

				accessConditions.push({
					fieldName,
					condition,
				});

				if ((emptyFields === true && !fields[fieldName]) || (emptyFields !== true && fields[fieldName] === 1)) {
					const conditionFields = Object.keys(condition);
					for (let conditionField of conditionFields) {
						if (emptyFields === true) {
							delete fields[conditionField];
						} else {
							fields[conditionField] = 1;
						}
					}
				}
			}
		}
	}

	let options = { fields };

	let data = model.findOne(query, options);

	if (data) {
		const local = {
			collection: new Meteor.Collection(null),
		};

		local.collection.insert(utils.mapDateValue(data));

		for (let accessCondition of accessConditions) {
			const update = { $unset: {} };
			update.$unset[accessCondition.fieldName] = 1;
			options = { multi: true };

			const affected = local.collection.update(accessCondition.condition, update, options);
			logger.trace(affected, 'affected records');
		}

		data = local.collection.find({}).fetch();

		delete local.collection;

		if (data && request.withDetailFields === 'true') {
			for (let index = 0; index < data.length; index++) {
				const record = data[index];
				const populatedRecord = Meteor.call('data:populate:detailFieldsInRecord', {
					record,
					document: request.document,
					__scope__: {
						user: this.user,
						access: this.access,
					},
				});

				if (populatedRecord) {
					data[index] = populatedRecord;
				}
			}
		}
	} else {
		data = [];
	}

	return { success: true, data, total: data.length };
});

/* Get a list of records from a lookup
	@param authTokenId
	@param document
	@param field
	@param search
	@param start
	@param limit
	@param useChangeUserFilter
*/
Meteor.registerMethod('data:find:byLookup', 'withUser', 'withAccessForDocument', function (request) {
	const meta = Meta[request.document];

	if (!meta) {
		return new Meteor.Error('internal-error', `[${request.document}] Document does not exists`);
	}

	const field = meta.fields[request.field];
	if (!field) {
		return new Meteor.Error('internal-error', `[${request.document}] Field ${request.field} does not exists`);
	}

	const model = Models[field.document];

	const lookupMeta = Meta[field.document];

	if (!model) {
		return new Meteor.Error('internal-error', `[${request.document}] Document ${field.document} does not exists`);
	}

	let query = {};
	const fields = { _updatedAt: 1 };

	const sort = {};

	if (isArray(field.descriptionFields)) {
		const conditions = [];
		let { descriptionFields } = field;

		if (isArray(field.searchableFields)) {
			descriptionFields = descriptionFields.concat(field.searchableFields);
		}

		let sortArrayField = false;

		for (let descriptionField of descriptionFields) {
			const lookupField = lookupMeta.fields[descriptionField.split('.')[0]];

			if (lookupField) {
				if (lookupField.type === 'picklist' || lookupField.isList === true) {
					if (!sortArrayField) {
						sort[descriptionField] = 1;
						sortArrayField = true;
					}
				} else {
					sort[descriptionField] = 1;
				}

				fields[descriptionField] = 1;

				if (isString(request.search) && request.search.length > 0) {
					const condition = {};

					const searchAsInt = String(parseInt(request.search)) === request.search;

					if (['number', 'autoNumber', 'money'].includes(lookupField.type)) {
						const floatValue = parseFloat(request.search);
						if (floatValue && !isNaN(floatValue)) {
							condition[descriptionField] = floatValue;
						}
					} else if (lookupField.type === 'address' && descriptionField === lookupField.name) {
						for (let addressField of ['country', 'state', 'city', 'place', 'number', 'postalCode', 'district', 'placeType', 'complement']) {
							const c = {};
							c[`${descriptionField}.${addressField}`] = {
								$regex: request.search,
								$options: 'i',
							};
							conditions.push(c);
						}
					} else {
						if (searchAsInt === false) {
							if (['date', 'dateTime'].includes(lookupField.type)) {
								condition[descriptionField] = new Date(request.search);
							} else if (lookupField.type !== 'boolean') {
								condition[descriptionField] = {
									$regex: request.search,
									$options: 'i',
								};
							}
						}
					}

					if (Object.keys(condition).length > 0) {
						conditions.push(condition);
					}
				}
			} else {
				logger.error(`Inconsistent metadata, field [${lookupField}] does not exists in [${field.document}]`);
			}
		}

		if (conditions.length > 0) {
			query.$or = conditions;
		}
	}

	if (isArray(field.inheritedFields)) {
		for (let inheritedField of field.inheritedFields) {
			fields[inheritedField.fieldName] = 1;
		}
	}

	// if field have access
	if (field.access) {
		// set base for access if doesn't exists
		if (!this.user.access) {
			this.user.access = {};
		}

		// If no access for field document, set empty array
		if (!this.user.access[field.document]) {
			this.user.access[field.document] = [];
			// Else, if value isn't array, convert to array
		} else if (!isArray(this.user.access[field.document])) {
			this.user.access[field.document] = [this.user.access[field.document]];
		}

		// And finally add field access as first access value
		this.user.access[field.document].unshift(field.access);
	}

	// Find access for lookup list data
	const access = getAccessFor(field.document, this.user);

	// Define init filter
	const filter = {
		match: 'and',
		filters: [],
	};

	if (request.useChangeUserFilter === true && isObject(access.changeUserFilter)) {
		filter.filters.push(access.changeUserFilter);
	} else if (isObject(access.readFilter)) {
		filter.filters.push(access.readFilter);
	}

	if (isObject(request.filter) && !isArray(request.filter)) {
		filter.filters.push(request.filter);
	}

	// Parse filters
	const readFilter = filterUtils.parseFilterObject(filter, lookupMeta, this);
	if (readFilter instanceof Error) {
		logger.error(readFilter, `Lookup - Access Filter Error: ${readFilter.message}`);
		return readFilter;
	}

	// If there are filter then add to query
	if (isObject(readFilter) && Object.keys(readFilter).length > 0) {
		if (Object.keys(query).length === 0) {
			query = readFilter;
		} else {
			query = { $and: [query, readFilter] };
		}
	}

	// Validate if user have permission to view each field
	for (let fieldName in fields) {
		const accessField = getFieldPermissions(access, fieldName.split('.')[0]);
		if (accessField.isReadable !== true) {
			delete fields[fieldName];
		}
	}

	let options = {
		limit: parseInt(request.limit),
		skip: request.start != null ? parseInt(request.start) : 0,
		fields,
		sort,
	};

	if (_isNaN(options.limit) || !options.limit) {
		options.limit = 100;
	}

	const data = model.find(query, options).fetch();
	const total = model.find(query).count();

	return {
		success: true,
		data: map(data, utils.mapDateValue),
		total,
	};
});

/* Receive a record and populate with detail fields
	@param authTokenId
	@param document
	@param record
*/
Meteor.registerMethod('data:populate:detailFieldsInRecord', 'withUser', 'withAccessForDocument', function (request) {
	if (!request.record) {
		return;
	}

	const populateDetailFields = function (field, value, parent) {
		if (!has(value, '_id')) {
			logger.error({ field, document: request.document, parent }, 'populateDetailFields: value without _id');
		}

		const record = Meteor.call('data:find:byId', {
			document: field.document,
			fields: field.detailFields.join(','),
			dataId: value._id,
			__scope__: {
				user: this.user,
			},
		});

		if (has(record, 'data.0')) {
			for (let recordKey in record.data[0]) {
				const recordValue = record.data[0][recordKey];
				value[recordKey] = recordValue;
			}
		}
	};

	const metaObject = Meta[request.document];

	for (let fieldName in request.record) {
		const value = request.record[fieldName];
		const field = metaObject.fields[fieldName];
		if (value && field && field.type === 'lookup' && size(field.detailFields) > 0) {
			if (field.isList === true) {
				for (let item of isArray(value) ? value : [value]) {
					populateDetailFields(field, item, value);
				}
			} else {
				populateDetailFields(field, value);
			}
		}
	}

	return request.record;
});

/* Create a new record
	@param authTokenId
	@param document
	@param data
*/
Meteor.registerMethod(
	'data:create',
	'withUser',
	'withAccessForDocument',
	'ifAccessIsCreateable',
	'withMetaForDocument',
	'withModelForDocument',
	'ifCreateIsValid',
	'processCollectionLogin',
	function (request) {
		let field, k, resultOfValidation, value;
		const { meta } = this;
		const { model } = this;

		if (get(request, 'data._user', undefined)) {
			let onlyMe = true;

			for (let newUser of request.data._user) {
				if (newUser._id !== this.user._id) {
					onlyMe = false;
				}
			}

			if (!onlyMe && this.access.changeUser !== true) {
				delete request.data._user;
			}
		}

		// Define response object to be populated later
		const response = {
			errors: [],
			success: true,
		};

		// Remove null values and empty strings
		for (var key in request.data) {
			value = request.data[key];
			if (value === null || value === '') {
				delete request.data[key];
			}
		}

		// Validate if user have permission to create each field that he are trying
		for (let fieldName in request.data) {
			const accessField = getFieldPermissions(this.access, fieldName);
			if (accessField.isCreatable !== true) {
				return new Meteor.Error('internal-error', `[${request.document}] You don't have permission to create field ${fieldName}`);
			}
		}

		// After all validations
		// Init newRecord object
		const newRecord = {};

		// If no user was defined
		if (!request.data._user) {
			// Get user id from session
			let userOid = this.user._id;

			// Test if was passed one queue
			const { queue } = request.data;
			// TODO: Remove
			// Workaround to don't process queue for saves on QueueUser whiout user
			if (meta.name !== 'QueueUser') {
				if (isObject(queue) && isString(queue._id)) {
					// If yes, get next user from queue and override user of session
					const userQueue = metaUtils.getNextUserFromQueue(queue._id, this.user);
					if (isObject(userQueue)) {
						userOid = userQueue.user._id.valueOf();
					}
				}
			}

			// Define user of session or queue in correctly format
			request.data._user = { _id: userOid };

			// If user field is isList change format to array
			if (get(meta, 'fields._user.isList') === true) {
				request.data._user = [request.data._user];
			}
		}

		// Validate and process lookups first to inherit data before validation
		for (key in meta.fields) {
			field = meta.fields[key];
			if (field.type === 'lookup') {
				if (newRecord[key] === undefined) {
					value = request.data[field.name];

					resultOfValidation = metaUtils.validateAndProcessValueFor(meta, key, value, 'insert', model, request.data, newRecord);
					if (resultOfValidation instanceof Error) {
						response.errors.push(resultOfValidation);
					}

					if (resultOfValidation !== undefined) {
						newRecord[key] = resultOfValidation;
					}
				}
			}
		}

		// If meta includes scriptBeforeValidation, run it in a sandboxed environment and extend request.data with its results
		if (meta.scriptBeforeValidation) {
			const extraData = {
				original: {},
				request: request.data,
				validated: newRecord,
			};
			request.data = extend(request.data, utils.runScriptBeforeValidation(meta.scriptBeforeValidation, extend(request.data, newRecord), this, extraData));
		}

		// Iterate over all fields, except autoNumbers, of meta to validate values and insert default values
		for (key in meta.fields) {
			field = meta.fields[key];
			if (!['autoNumber'].includes(field.type)) {
				if (newRecord[key] === undefined) {
					// Remove empty strings
					if (request.data[field.name] === '') {
						delete request.data[field.name];
					}

					// If don't exists data for field and exists one default value into metadata, set default value
					if (!request.data[field.name] && field.defaultValue) {
						request.data[field.name] = field.defaultValue;
					}

					// If don't exists data for field and exists default values into metadata, set default values
					if (!request.data[field.name] && size(get(field, 'defaultValues')) > 0) {
						// Work around to fix picklist behavior
						if (field.type === 'picklist') {
							let v = get(field, 'defaultValues.0.pt_BR');
							if (!v) {
								k = Object.keys(field.defaultValues[0]);
								v = field.defaultValues[0][k[0]];
							}
							request.data[field.name] = v;
						} else {
							request.data[field.name] = field.defaultValues;
						}
					}

					value = request.data[field.name];
					resultOfValidation = metaUtils.validateAndProcessValueFor(meta, key, value, 'insert', model, request.data, newRecord);
					if (resultOfValidation instanceof Error) {
						logger.error(resultOfValidation, `Create - Validation Error - ${resultOfValidation.message}`);
						response.errors.push(resultOfValidation);
					}

					if (resultOfValidation !== undefined) {
						newRecord[key] = resultOfValidation;
					}
				}
			}
		}

		// If meta includes validationScript, run it in a sandboxed environment
		if (meta.validationScript) {
			const validation = processValidationScript(meta.validationScript, meta.validationData, extend({}, request.data, newRecord), this);
			if (get(validation, 'success') !== true) {
				const error = new Meteor.Error(validation.reason);
				logger.error(error, `Create - Script Validation Error - ${error.message}`);
				response.errors.push(error);
			}
		}

		// If no errors util now, iterate over autoNumber fields to generate codes
		if (response.errors.length === 0) {
			for (key in meta.fields) {
				field = meta.fields[key];
				if (field.type === 'autoNumber') {
					value = request.data[field.name];

					// Ignore autonumbers if requested
					if (request.ignoreAutoNumber !== true || !value) {
						resultOfValidation = metaUtils.validateAndProcessValueFor(meta, key, value, 'insert', model, request.data, newRecord);
						if (resultOfValidation instanceof Error) {
							logger.error(resultOfValidation, `Create - Validation Error - ${resultOfValidation.message}`);
							response.errors.push(resultOfValidation);
						}

						newRecord[key] = resultOfValidation;
					} else {
						newRecord[key] = value;
					}
				}
			}
		}

		for (k of Object.keys(newRecord)) {
			// Don't save null and undefiend values
			if (newRecord[k] === null || newRecord[k] === undefined) {
				delete newRecord[k];
			}
		}

		// If record has data, then execute
		if (Object.keys(newRecord).length > 0 && response.errors.length === 0) {
			// Define _createdAt to current date and time and _createdBy to current user
			let insertResult;
			newRecord._createdAt = request.data._createdAt || new Date();
			newRecord._createdBy = request.data._createdBy || {
				_id: this.user._id,
				name: this.user.name,
				group: this.user.group,
			};

			// Set _updatedAt and _updatedBy with same values of _createdAt _createdBy
			newRecord._updatedAt = request.data._updatedAt || newRecord._createdAt;
			newRecord._updatedBy = request.data._updatedBy || newRecord._createdBy;

			// If an id was passed, use it
			if (request.data._id && isString(request.data._id)) {
				newRecord._id = request.data._id;
			}

			// Execute insert
			try {
				if (isObject(request.upsert)) {
					const updateOperation = {
						$setOnInsert: {},
						$set: {},
					};
					if (isObject(request.updateOnUpsert)) {
						for (key in newRecord) {
							value = newRecord[key];
							if (newRecord.hasOwnProperty(key)) {
								if (request.updateOnUpsert[key]) {
									updateOperation['$set'][key] = newRecord[key];
								} else {
									updateOperation['$setOnInsert'][key] = newRecord[key];
								}
							}
						}
					} else {
						updateOperation['$setOnInsert'] = newRecord;
					}

					if (isEmpty(updateOperation['$set'])) {
						delete updateOperation['$set'];
					}

					if (isEmpty(updateOperation['$setOnInsert'])) {
						delete updateOperation['$setOnInsert'];
					}

					insertResult = model.upsert(utils.processDate(request.upsert), utils.processDate(updateOperation));
					if (insertResult.insertedId) {
						insertResult = insertResult.insertedId;
					} else if (insertResult.numberAffected > 0) {
						insertResult = get(model.findOne(request.upsert), '_id');
					}
				} else {
					insertResult = model.insert(utils.processDate(newRecord));
				}
			} catch (e) {
				logger.error(e, `Error on insert ${Namespace.ns}.${request.document}: ${e.message}`);
				if (e.code === 11000) {
					e = new Meteor.Error('internal-error', 'Erro ao inserir: registro já existe');
				}
				return e;
			}

			let query = { _id: insertResult };

			// Call hooks
			if (!isEmpty(Namespace.onCreate)) {
				// Find record before apply access filter to query
				const hookData = {
					action: 'create',
					ns: Namespace.ns,
					documentName: request.document,
					user: pick(this.user, ['_id', 'code', 'name', 'active', 'username', 'nickname', 'group', 'emails', 'locale']),
					data: [model.findOne(query)], // Find records before apply access filter to query
				};

				const urls = [].concat(Namespace.onCreate);
				for (var url of urls) {
					if (!isEmpty(url)) {
						url = url.replace('${dataId}', insertResult.valueOf());
						url = url.replace('${documentId}', `${Namespace.ns}:${request.document}`);

						post({ url, json: hookData }, function (err, response) {
							if (err) {
								logger.error(err, `CREATE ERROR ${url}: ${err.message}`);
								return;
							}

							if (response.statusCode === 200) {
								logger.info(`📠 ${response.statusCode} CREATE ${url}`);
							} else {
								logger.error(`📠 ${response.statusCode} CREATE ${url}`);
							}
						});
					}
				}
			}

			// Apply read access filter
			if (isObject(this.access.readFilter)) {
				const readFilter = filterUtils.parseFilterObject(this.access.readFilter, meta, this);
				if (readFilter instanceof Error) {
					logger.error(`Create - Read Filter Error: ${readFilter.message}`);
					response.errors.push(readFilter);
				} else {
					query = { $and: [query, readFilter] };
				}
			}

			// Find insertedRecord
			let insertedRecord = model.findOne(query);

			if (meta.scriptAfterSave) {
				utils.runScriptAfterSave(meta.scriptAfterSave, [insertedRecord], this);
			}

			// Set update reords to response object
			if (isObject(insertedRecord)) {
				insertedRecord = removeUnauthorizedDataForRead(this.access, insertedRecord);
				response.data = [utils.mapDateValue(insertedRecord)];
			}
		}

		// If there are errors then set success of response as false, else delete the key errors
		if (response.errors.length > 0) {
			response.success = false;
		} else {
			delete response.errors;
		}

		// And finally, send the response
		return response;
	},
);

/* Update records
	@param authTokenId
	@param document
	@param data

	@TODO Faltam código de erros
*/
Meteor.registerMethod(
	'data:update',
	'withUser',
	'withAccessForDocument',
	'ifAccessIsUpdatable',
	'withMetaForDocument',
	'withModelForDocument',
	'ifUpdateIsValid',
	'processCollectionLogin',
	function (request) {
		let idMapItem, validateResult;
		let id;
		const { meta } = this;
		const { model } = this;
		if (this.access.changeUser !== true && has(request, 'data.data._user')) {
			delete request.data.data._user;
		}

		// Define response object to be populated later
		const response = {
			errors: [],
			success: true,
		};

		// Define array to get all conditions of changed fields
		const fieldFilterConditions = [];

		// Validate if user have permission to update each field that he are trying
		for (var fieldName in request.data.data) {
			const accessField = getFieldPermissions(this.access, fieldName);
			if (accessField.isUpdatable !== true) {
				return new Meteor.Error('internal-error', `[${request.document}] You don't have permission to update field ${fieldName}`);
			}

			// If there are condition in access for this field then add to array
			const accessFieldConditions = getFieldConditions(this.access, fieldName);
			if (accessFieldConditions.UPDATE) {
				fieldFilterConditions.push(accessFieldConditions.UPDATE);
			}
		}

		// Find records that we are trying to update
		// Map all passed ids to facilitate later access

		let query = {};

		// Define init filter
		const filter = {
			match: 'and',
			filters: [],
		};

		// Add access update filter as sub filter
		if (isObject(this.access.updateFilter)) {
			filter.filters.push(this.access.updateFilter);
		}

		// Add field conditions as condition of filter
		if (fieldFilterConditions.length > 0) {
			filter.conditions = fieldFilterConditions;
		}

		// Parse filters
		const updateFilter = filterUtils.parseFilterObject(filter, meta, this);
		if (updateFilter instanceof Error) {
			logger.error(updateFilter, `Update - Update Filter Error: ${updateFilter.message}`);
			return updateFilter;
		}

		// If there are filter then init query with this filter
		if (isObject(updateFilter) && Object.keys(updateFilter).length > 0) {
			query = updateFilter;
		}

		if (!query._id) {
			query._id = { $in: [] };
		}

		const idMap = {};

		// Add ids to filter
		for (var item of request.data.ids) {
			if (has(query, '_id.$in') && isArray(query._id.$in)) {
				query._id.$in.push(item._id);
			}
			idMap[item._id] = item;
		}

		let options = {};

		if (!meta.scriptBeforeValidation && !meta.validationScript && !meta.scriptAfterSave) {
			options = {
				fields: {
					_updatedAt: 1,
				},
			};
		}

		const records = model.find(query, options).fetch();

		// Make a query with only _ids to verify if record does not exists or user does not have permission to view the record
		const existsQuery = { _id: query._id };

		const existsOptions = {
			fields: {
				_id: 1,
			},
		};

		const existsRecords = model.find(existsQuery, existsOptions).fetch();
		const existsMap = {};

		for (let existsRecord of existsRecords) {
			existsMap[existsRecord._id] = existsRecord;
		}

		// Mark ids that exist on database and mark all out of date ids to later use
		for (var record of records) {
			idMapItem = idMap[record._id];
			if (idMapItem) {
				idMapItem.exists = true;
				idMapItem.record = record;

				if (meta.ignoreUpdatedAt !== true) {
					if (record._updatedAt.getTime() !== new Date(idMapItem._updatedAt.$date).getTime()) {
						idMapItem.outOfDate = true;
					}
				}
			}
		}

		// Verify if records that was marked as unexistent was only anaccessible by user
		for (id in idMap) {
			idMapItem = idMap[id];
			if (idMapItem.exists !== true) {
				idMapItem.userDontHasPermission = existsMap[id] != null;
			}
		}

		// Create query to get history of out-of-date records that was updated after passed date and has at least one of passed fields
		const outOfDateQuery = [];

		const mapOfFieldsToUpdateForHistoryQuery = [];

		for (fieldName in request.data.data) {
			item = {};
			item[`diffs.${fieldName}`] = { $exists: 1 };
			mapOfFieldsToUpdateForHistoryQuery.push(item);
		}

		// If id doesn't exists return an error and remove id from ids map
		// If id is out-of-date add to history query
		for (id in idMap) {
			idMapItem = idMap[id];
			if (idMapItem.exists !== true) {
				if (idMapItem.userDontHasPermission === true) {
					response.errors.push(new Meteor.Error('internal-error', `Sem premissão para atualizar o dado ${id}`));
				} else {
					response.errors.push(new Meteor.Error('internal-error', `Id [${id}] de dado inválido. Não existe dado em [${request.document}] para o id passado: ${id}`));
				}

				delete idMap[id];
			} else if (idMapItem.outOfDate === true) {
				outOfDateQuery.push({
					dataId: id,
					createdAt: {
						$gt: new Date(idMapItem._updatedAt.$date),
					},
					$or: mapOfFieldsToUpdateForHistoryQuery,
				});
			}
		}

		// If there are out-of-date ids execute query
		if (outOfDateQuery.length > 0) {
			const outOfDateRecords = Models[`${request.document}.History`].find({ $or: outOfDateQuery }).fetch();

			// If there are history process them
			if (outOfDateRecords.length > 0) {
				// Get firs of each record by id
				const outOfDateRecordsByDataId = {};
				for (let outOfDateRecord of outOfDateRecords) {
					if (!outOfDateRecordsByDataId[outOfDateRecord.dataId]) {
						outOfDateRecordsByDataId[outOfDateRecord.dataId] = outOfDateRecord;
					}
				}

				// Iterate over ids map and verify if there are history results for each id
				for (id in idMap) {
					idMapItem = idMap[id];
					if (outOfDateRecordsByDataId[id]) {
						// Iterate over passed data to verify the first field that has been updated, return an error and remove id from id map
						for (fieldName in request.data.data) {
							if (outOfDateRecordsByDataId[id].diffs[fieldName]) {
								response.errors.push(
									new Meteor.Error(
										'internal-error',
										`O Campo ${fieldName} do dado com id ${id} que está tentando salvar está desatualizado. A Modificação foi feita por [${
											outOfDateRecordsByDataId[id].createdBy.name
										}] at [${outOfDateRecordsByDataId[id].createdAt.toISOString()}]`,
									),
								);
								delete idMap[id];
							}
						}
					}
				}
			}
		}

		// Iterate over id map to create an array with ObjectIds to execute update query
		const idsToUpdate = [];
		const recordsToUpdate = [];
		for (id in idMap) {
			idMapItem = idMap[id];
			if (idMapItem.exists === true) {
				idsToUpdate.push(id);
				recordsToUpdate.push(idMapItem.record);
			}
		}

		let updatedIds = [];

		const validateAndUpdateRecords = records => {
			// After all validations
			// Init update object
			let bodyData, resultOfValidation, value;
			const update = {
				$set: {},
				$unset: {},
			};

			// Ignore history by default. If any field have ignoreHistory different from true then set as false
			let ignoreHistory = true;

			const validatedData = {};
			// Validate and process lookups first to inherit data before validation
			for (var key in request.data.data) {
				value = request.data.data[key];
				if (validatedData[key] === undefined) {
					if (get(meta, `fields.${key}.type`) === 'lookup') {
						resultOfValidation = metaUtils.validateAndProcessValueFor(meta, key, value, 'update', model, request.data.data, validatedData, idsToUpdate);
						if (resultOfValidation instanceof Error) {
							return resultOfValidation;
						}
						if (resultOfValidation !== undefined) {
							validatedData[key] = resultOfValidation;
							if (meta.fields[key].ignoreHistory !== true) {
								ignoreHistory = false;
							}
						}
					}
				}
			}

			// If meta includes scriptBeforeValidation, run it in a sandboxed environment and extend body with its results
			if (meta.scriptBeforeValidation) {
				const extraData = {
					original: records[0],
					request: request.data.data,
					validated: validatedData,
				};
				bodyData = extend(
					{},
					request.data.data,
					utils.runScriptBeforeValidation(meta.scriptBeforeValidation, extend({}, records[0], request.data.data, validatedData), this, extraData),
				);
			} else {
				bodyData = extend({}, request.data.data);
			}

			// Iterate over passed data and decide to set or unset each field
			for (key in bodyData) {
				value = bodyData[key];
				if (validatedData[key] === undefined) {
					resultOfValidation = metaUtils.validateAndProcessValueFor(meta, key, value, 'update', model, bodyData, validatedData, idsToUpdate);
					if (resultOfValidation instanceof Error) {
						logger.error(resultOfValidation, `Update - Validation Error: ${resultOfValidation.message}`);
						return resultOfValidation;
					}
					if (resultOfValidation !== undefined) {
						validatedData[key] = resultOfValidation;
						if (meta.fields[key].ignoreHistory !== true) {
							ignoreHistory = false;
						}
					}
				}
			}

			// If meta includes validationScript, run it in a sandboxed environment
			if (meta.validationScript) {
				const validation = processValidationScript(meta.validationScript, meta.validationData, extend({}, records[0], validatedData), this);
				if (get(validation, 'success') !== true) {
					const error = new Meteor.Error(validation.reason);
					logger.error(error, `Update - Script Validation Error: ${error.message}`);
					return error;
				}
			}

			for (key in validatedData) {
				value = validatedData[key];
				if (value !== undefined) {
					if (value === null) {
						update.$unset[key] = 1;
					} else {
						update.$set[key] = value;
					}
				}
			}

			// If there are no data to set remove the $set item
			if (Object.keys(update.$set).length === 0) {
				delete update.$set;
			}

			// If there are no data to unset remove the $unset item
			if (Object.keys(update.$unset).length === 0) {
				delete update.$unset;
			}

			// If there are ids to execute the update and if update has data, then execute
			if (records.length > 0 && Object.keys(update).length > 0) {
				// Define _updatedAt to current date and time and _updatedBy to current user
				if (ignoreHistory !== true) {
					if (!update.$set) {
						update.$set = {};
					}
					update.$set._updatedAt = new Date();
					update.$set._updatedBy = {
						_id: this.user._id,
						name: this.user.name,
						group: this.user.group,
						ts: update.$set._updatedAt,
					};
				}

				// Define update query
				query = {
					_id: {
						$in: [],
					},
				};

				for (record of records) {
					query._id.$in.push(record._id);
				}

				// Execute update
				options = { multi: true };

				try {
					model.update(query, utils.processDate(update), options);
					return (updatedIds = updatedIds.concat(query._id.$in));
				} catch (e) {
					logger.error(e, `Update - Data Update Error: ${e.message}`);
					return e;
				}
			}
		};

		if (meta.scriptBeforeValidation || meta.validationScript) {
			for (let recordToUpdate of recordsToUpdate) {
				validateResult = validateAndUpdateRecords([recordToUpdate]);
				if (validateResult instanceof Error) {
					logger.error(validateResult, `Update - Validation Error: ${validateResult.message}`);
					return validateResult;
				}
			}
		} else {
			validateResult = validateAndUpdateRecords(recordsToUpdate);
			if (validateResult instanceof Error) {
				logger.error(validateResult, `Update - Validation Error: ${validateResult.message}`);
				return validateResult;
			}
		}

		if (updatedIds.length > 0) {
			// Call hooks
			if (!isEmpty(Namespace.onUpdate)) {
				const ids = map(idsToUpdate, id => id.valueOf());

				const hookData = {
					action: 'update',
					ns: Namespace.ns,
					documentName: request.document,
					user: pick(this.user, ['_id', 'code', 'name', 'active', 'username', 'nickname', 'group', 'emails', 'locale']),
					data: model.find(query).fetch(), // Find records before apply access filter to query
				};

				const urls = [].concat(Namespace.onUpdate);
				for (var url of urls) {
					if (!isEmpty(url)) {
						url = url.replace('${dataId}', ids.join(','));
						url = url.replace('${documentId}', `${Namespace.ns}:${request.document}`);

						post({ url, json: hookData }, function (err, response) {
							if (err) {
								logger.error(`UPDATE ERROR ${url}`, err);
								return;
							}

							if (response.statusCode === 200) {
								logger.info(`📠  ${response.statusCode} UPDATE ${url}`);
							} else {
								logger.error(`📠  ${response.statusCode} UPDATE ${url}`);
							}
						});
					}
				}
			}

			// Apply read access filter
			if (isObject(this.access.readFilter)) {
				const readFilter = filterUtils.parseFilterObject(this.access.readFilter, meta, this);
				if (readFilter instanceof Error) {
					logger.error(readFilter, `Update - Validation Error: ${readFilter.message}`);
					response.errors.push(readFilter);
				} else {
					query = { $and: [query, readFilter] };
				}
			}

			// Find all update records
			const updatedRecords = model.find(query).fetch();

			if (meta.scriptAfterSave) {
				const extraData = { original: records };
				utils.runScriptAfterSave(meta.scriptAfterSave, updatedRecords, this, extraData);
			}

			// Set update reords to response object
			response.data = [];
			for (let updatedRecord of updatedRecords) {
				response.data.push(utils.mapDateValue(removeUnauthorizedDataForRead(this.access, updatedRecord)));
			}
		}

		// If there are errors then set success of response as false, else delete the key errors
		if (response.errors.length > 0) {
			response.success = false;
		} else {
			delete response.errors;
		}

		// And finally, send the response
		return response;
	},
);

/* Delete records
	@param authTokenId
	@param document
	@param data
*/
Meteor.registerMethod('data:delete', 'withUser', 'withAccessForDocument', 'ifAccessIsDeletable', 'withMetaForDocument', 'withModelForDocument', function (request) {
	let idMapItem;
	let id;

	// Define response object to be populated later
	const response = {
		errors: [],
		success: true,
	};

	// Some validations of payload
	if (!isObject(request.data)) {
		return new Meteor.Error('internal-error', `[${request.document}] Invalid payload`);
	}

	if (!isArray(request.data.ids) || request.data.ids.length === 0) {
		return new Meteor.Error('internal-error', `[${request.document}] Payload must contain an array of ids with at least one item`);
	}

	const { meta } = this;

	for (var item of request.data.ids) {
		if (!isObject(item) || !isString(item._id)) {
			return new Meteor.Error('internal-error', `[${request.document}] Each id must contain an valid _id`);
		}

		if (meta.ignoreUpdatedAt !== true) {
			if (!isObject(item) || !isObject(item._updatedAt) || !isString(item._updatedAt.$date)) {
				return new Meteor.Error('internal-error', `[${request.document}] Each id must contain an date field named _updatedAt`);
			}
		}
	}

	const { model } = this;

	// Try to get trash model of document
	const trashModel = Models[`${request.document}.Trash`];
	if (!trashModel) {
		return new Meteor.Error('internal-error', `[${request.document}] Document ${request.document}.Trash does not exists`);
	}

	// Find records that we are trying to update
	// Map all passed ids to facilitate later access

	let query = {};

	if (isObject(this.access.deleteFilter)) {
		const deleteFilter = filterUtils.parseFilterObject(this.access.deleteFilter, meta, this);
		if (deleteFilter instanceof Error) {
			logger.error(deleteFilter, `Delete - Validation Error: ${deleteFilter.message}`);
			return deleteFilter;
		}

		query = deleteFilter;
	}

	if (!query._id) {
		query._id = { $in: [] };
	}

	const idMap = {};

	for (item of request.data.ids) {
		if (has(query, '_id.$in') && isArray(query._id.$in)) {
			query._id.$in.push(item._id);
		}
		idMap[item._id] = item;
	}

	let options = {};
	// fields:
	// 	_updatedAt: 1

	const records = model.find(query, options).fetch();

	// Make a query with only _ids to verify if record does not exists or user does not have permission to view the record
	const existsQuery = { _id: query._id };

	const existsOptions = {
		fields: {
			_id: 1,
		},
	};

	const existsRecords = model.find(existsQuery, existsOptions).fetch();
	const existsMap = {};

	for (let existsRecord of existsRecords) {
		existsMap[existsRecord._id] = existsRecord;
	}

	// Mark ids that exists on database and mark all out of date ids to later use
	for (var record of records) {
		idMapItem = idMap[record._id];
		if (idMapItem) {
			idMapItem.exists = true;

			if (meta.ignoreUpdatedAt !== true) {
				if (record._updatedAt.getTime() !== new Date(idMapItem._updatedAt.$date).getTime()) {
					idMapItem.outOfDate = true;
				}
			}
		}
	}

	// Verify if records that was marked as unexistent was only anaccessible by user
	for (id in idMap) {
		idMapItem = idMap[id];
		if (idMapItem.exists !== true) {
			idMapItem.userDontHasPermission = existsMap[id];
		}
	}

	// If id doesn't exists return an error and remove id from ids map
	for (id in idMap) {
		idMapItem = idMap[id];
		if (idMapItem.exists !== true) {
			if (idMapItem.userDontHasPermission === true) {
				response.errors.push(new Meteor.Error('internal-error', `Sem premissão para ver o dado ${id}`));
			} else {
				response.errors.push(new Meteor.Error('internal-error', `Id [${id}] de dado inválido. Não existe dado em [${request.document}] para o id passado: ${id}`));
			}

			delete idMap[id];
		} else if (idMapItem.outOfDate === true) {
			response.errors.push(
				new Meteor.Error('internal-error', `Existe uma versão mais nova do dado que a que está tentando apagar [${id}]. Tente atualizar a tela e tente apagar novamente.`),
			);

			delete idMap[id];
		}
	}

	// Iterate over id map to create an array with ObjectIds to verify relations
	const idsToVerifyRelations = [];
	for (id in idMap) {
		idMapItem = idMap[id];
		if (idMapItem.exists === true) {
			idsToVerifyRelations.push(id);
		}
	}

	// Get references of document
	const references = References[request.document];

	// If exist references
	if (isObject(references) && isObject(references.from)) {
		for (let referenceMetaName in references.from) {
			// Get model
			const referenceMeta = references.from[referenceMetaName];
			const referenceModel = Models[referenceMetaName];

			if (referenceModel) {
				// Define an array to multiple conditions
				const referenceConditions = [];
				// Get all fields that reference this meta and create one condition with all ids
				for (let referenceFieldName in referenceMeta) {
					const condition = {};

					const ref = referenceFieldName;

					condition[`${ref}._id`] = {
						$in: idsToVerifyRelations,
					};

					referenceConditions.push(condition);
				}

				// If there are references of this meta
				if (referenceConditions.length > 0) {
					// Set up a query with all conditions using operator "or"
					let referenceQuery = {
						$or: referenceConditions,
					};

					let referenceQueryOptions = {
						fields: {
							_id: 1,
						},
					};

					// Get first result
					let referenceResult = referenceModel.findOne(referenceQuery, referenceQueryOptions);

					// If there are result got ahead and find problems for each record
					if (referenceResult) {
						// For each id
						for (id of idsToVerifyRelations) {
							// Change all conditions
							for (let referenceCondition of referenceConditions) {
								// To set the unique property as one id condition
								referenceCondition[Object.keys(referenceCondition)[0]] = id;
							}

							// Define query to all field references of this id
							referenceQuery = {
								$or: referenceConditions,
							};

							referenceQueryOptions = {
								fields: {
									_id: 1,
								},
							};

							// Execute query
							referenceResult = referenceModel.findOne(referenceQuery, referenceQueryOptions);

							// If there are results
							if (referenceResult) {
								// Add error to response
								response.errors.push(
									new Meteor.Error(
										'internal-error',
										`Não é possivel apagar o dado com id:[${request.document}] pois existem dados referenciando o mesmo do modulo [${referenceMetaName}].`,
									),
								);

								// And delete data from idMap
								delete idMap[id];
							}
						}
					}
				}
			}
		}
	}

	// Iterate over records to get only records that was valid to delete to save them into trash
	const recordsToSaveInTrash = [];
	for (record of records) {
		if (get(idMap, `${record._id}.exists`) === true) {
			recordsToSaveInTrash.push(record);
		}
	}

	// Iterate over id map to create an array with ObjectIds to execute delete query
	const idsToDelete = [];
	for (id in idMap) {
		idMapItem = idMap[id];
		if (idMapItem.exists === true) {
			idsToDelete.push(id);
		}
	}

	// If there are ids to execute the delete, then execute
	if (idsToDelete.length > 0) {
		// Define delete query
		let e;
		query = {
			_id: {
				$in: idsToDelete,
			},
		};

		// Save every record into trash
		for (record of recordsToSaveInTrash) {
			// Add information about how and when record was sent to trash
			record._deletedAt = new Date();
			record._deletedBy = {
				_id: this.user._id,
				name: this.user.name,
				group: this.user.group,
			};

			try {
				trashModel.insert(record);
			} catch (error) {
				e = error;
				logger.error(e, `Error on insert record into trash ${e.message}`);
			}
		}

		// Execute delete
		try {
			model.remove(query);
		} catch (error1) {
			e = error1;
			logger.error(e, `Error on delete record ${e.message}`);
			return e;
		}

		// Call hooks
		if (!isEmpty(Namespace.onDelete)) {
			const ids = map(idsToDelete, id => id.valueOf());

			const hookData = {
				action: 'delete',
				ns: Namespace.ns,
				documentName: request.document,
				user: pick(this.user, ['_id', 'code', 'name', 'active', 'username', 'nickname', 'group', 'emails', 'locale']),
				data: recordsToSaveInTrash,
			};

			const urls = [].concat(Namespace.onDelete);
			for (var url of urls) {
				if (!isEmpty(url)) {
					url = url.replace('${dataId}', ids.join(','));
					url = url.replace('${documentId}', `${Namespace.ns}:${request.document}`);

					post({ url, json: hookData }, function (err, response) {
						if (err) {
							logger.error(err, `DELETE ERROR ${url}: ${err.message}`);
							return;
						}

						if (response.statusCode === 200) {
							logger.info(`${response.statusCode} DELETE ${url}`);
						} else {
							logger.warn(`📠 ${response.statusCode} DELETE ${url}`);
						}
					});
				}
			}
		}

		// Set ids to response object
		response.data = idsToDelete;
	}

	// If there are errors then set success of response as false, else delete the key errors
	if (response.errors.length > 0) {
		response.success = false;
	} else {
		delete response.errors;
	}

	// And finally, send the response
	return response;
});

/* Create relation
	@param authTokenId
	@param document
	@param fieldName
	@param data
*/
Meteor.registerMethod('data:relation:create', 'withUser', 'withAccessForDocument', function (request) {
	let data, reverseLookupModel;

	// Try to get metadata
	const meta = Meta[request.document];
	if (!meta) {
		return new Meteor.Error('internal-error', `[${request.document}] Document does not exists`);
	}

	// Try to get field of relation
	const field = meta.fields[request.fieldName];
	if (!field) {
		return new Meteor.Error('internal-error', `[${request.document}] Field ${request.fieldName} does not exists`);
	}

	// Verify if type of field is filter
	if (field.type !== 'filter') {
		return new Meteor.Error('internal-error', `[${request.document}] Field ${request.fieldName} must be of type filter`);
	}

	// Verofy if field has relations
	if (!isArray(field.relations) || field.relations.length === 0) {
		return new Meteor.Error('internal-error', `[${request.document}] Field ${request.fieldName} must contains a property [relations] as array with at least one item`);
	}

	// Some validations of payload
	if (!isObject(request.data)) {
		return new Meteor.Error('internal-error', `[${request.document}] Invalid payload`);
	}

	if (!isObject(request.data) || !isArray(request.data.lookups) || !isArray(request.data.reverseLookups)) {
		return new Meteor.Error('internal-error', `[${request.document}] Payload must contain an object with properties [lookup] and [reverseLookups] as arrays`);
	}

	/*
	 * @TODO Get relation from request
	 */
	let relation = field.relations[0];

	for (let metaRelation of field.relations) {
		if (metaRelation.email) {
			relation = metaRelation;
			break;
		}
	}

	// Define response
	const response = {
		success: true,
		data: [],
		errors: [],
	};

	if (!request.data.data) {
		request.data.data = {};
	}

	const sendEmail = get(request, 'data.email', false) === true;
	const emailData = {};

	if (sendEmail) {
		reverseLookupModel = Models[Meta[relation.document].fields[relation.reverseLookup].document];
	}

	// Do a N x N loop to create all records of relation
	for (let lookup of request.data.lookups) {
		for (let reverseLookup of request.data.reverseLookups) {
			// Clone extra data
			var newData, populateFields;
			data = JSON.parse(JSON.stringify(request.data.data));

			if (relation.lookupField) {
				const lookupData = Models[field.document].findOne(lookup);
				lookup = utils.getObjectPathAgg(lookupData, relation.lookupField);
			}

			// Define lookups of relation
			data[relation.lookup] = { _id: lookup };

			data[relation.reverseLookup] = {
				_id: reverseLookup,
			};

			if (sendEmail) {
				if (!emailData[Meta[relation.document].fields[relation.reverseLookup].document]) {
					emailData[Meta[relation.document].fields[relation.reverseLookup].document] = [];
				}
				if (reverseLookupModel && !find(emailData[Meta[relation.document].fields[relation.reverseLookup].document], { _id: reverseLookup })) {
					const reverseLookupData = reverseLookupModel.findOne({ _id: reverseLookup });
					metaUtils.populateLookupsData(Meta[relation.document].fields[relation.reverseLookup].document, reverseLookupData, {
						_user: 1,
						contact: 1,
					});

					emailData[Meta[relation.document].fields[relation.reverseLookup].document].push(reverseLookupData);
				}
			}

			let upsert = {};
			upsert[`${relation.lookup}._id`] = lookup;
			upsert[`${relation.reverseLookup}._id`] = reverseLookup;
			upsert = { $and: [upsert] };

			// generates fake new data and fetch relation data to preview
			if (sendEmail && request.preview) {
				if (!emailData[relation.document]) {
					emailData[relation.document] = [];
				}

				populateFields = {};
				populateFields[relation.lookup] = 1;

				newData = clone(data);
				newData['_id'] = Random.id();

				metaUtils.populateLookupsData(relation.document, newData, populateFields);

				emailData[relation.document].push(newData);
			} else {
				// Create record
				const result = Meteor.call('data:create', {
					authTokenId: request.authTokenId,
					document: relation.document,
					data,
					upsert,
				});

				if (isNumber(result)) {
					return result;
				}

				// If result is an error return
				if (result instanceof Error) {
					logger.error(result, `Relations - Lookup Error: ${result.message}}`);
					return result;
				}

				// If there are data than concat with existent data
				if (isArray(result.data)) {
					response.data = response.data.concat(result.data);

					if (sendEmail) {
						if (!emailData[relation.document]) {
							emailData[relation.document] = [];
						}

						populateFields = {};
						populateFields[relation.lookup] = 1;
						result.data.forEach(function (resultData) {
							newData = JSON.parse(JSON.stringify(resultData));

							metaUtils.populateLookupsData(relation.document, newData, populateFields);

							return emailData[relation.document].push(newData);
						});
					}
				}

				// If there are erros than concat with existent errors
				if (isArray(result.errors)) {
					response.errors = response.errors.concat(result.errors);
				}

				// If success is false define response success as false
				if (result.success === false) {
					response.success = false;
				}
			}
		}
	}

	if (sendEmail && size(get(emailData, relation.document)) > 0) {
		const objectByString = function (o, s) {
			s = s.replace(/\[(\w+)\]/g, '.$1'); // convert indexes to properties
			s = s.replace(/^\./, ''); // strip a leading dot
			const a = s.split('.');
			let i = 0;
			const n = a.length;
			while (i < n) {
				const k = a[i];
				if (k in o) {
					o = o[k];
				} else {
					return;
				}
				++i;
			}
			return o;
		};

		if (has(relation, 'emailConf.extraData')) {
			for (let fieldEmail in relation.emailConf.extraData) {
				const findEmailData = relation.emailConf.extraData[fieldEmail];
				const record = Meteor.call('data:find:all', findEmailData);

				if (record.success === true) {
					emailData[fieldEmail] = record.data;
				}
			}
		}

		emailData['request'] = request.data.data;

		const createdByUser = {};
		utils.copyObjectFieldsByPathsIncludingIds(this.user, createdByUser, Meta['Message'].fields['_createdBy'].descriptionFields);

		const updatedByUser = {};
		utils.copyObjectFieldsByPathsIncludingIds(this.user, updatedByUser, Meta['Message'].fields['_updatedBy'].descriptionFields);

		const userOwner = {};
		utils.copyObjectFieldsByPathsIncludingIds(this.user, userOwner, Meta['Message'].fields['_user'].descriptionFields);

		const messageData = {
			data: emailData,
			type: 'Email',
			status: 'Send',
			_createdAt: new Date(),
			_updatedAt: new Date(),
			_createdBy: createdByUser,
			_updatedBy: updatedByUser,
			_user: [userOwner],
		};

		if (has(relation, 'emailConf.template')) {
			messageData.template = relation.emailConf.template;
		}

		if (has(relation, 'emailConf.server')) {
			messageData.server = relation.emailConf.server;
		}

		// find a contact on source data of relation
		if (has(Meta, 'Message.fields.contact.descriptionFields') && has(relation, 'emailConf.contact')) {
			const emailContactData = {};
			const contactData = objectByString(emailData, relation.emailConf.contact);

			if (contactData) {
				if (size(get(contactData, 'email')) > 0 && (!messageData.to || isEmpty(messageData.to))) {
					messageData.to = contactData.email[0].address;
				}

				utils.copyObjectFieldsByPathsIncludingIds(contactData, emailContactData, Meta['Message'].fields['contact'].descriptionFields);

				messageData.contact = [emailContactData];
			}
		}

		if (has(Meta, 'Message.fields.opportunity.descriptionFields') && has(relation, 'emailConf.opportunity')) {
			const emailOpportunityData = {};

			utils.copyObjectFieldsByPathsIncludingIds(
				objectByString(emailData, relation.emailConf.opportunity),
				emailOpportunityData,
				Meta['Message'].fields['opportunity'].descriptionFields,
			);

			messageData.opportunity = emailOpportunityData;
		}

		// simulates a render by konsistent.mailConsumer
		if (request.preview) {
			return renderTemplate(messageData.template, extend({ message: { _id: Random.id() } }, emailData));
		}

		Models['Message'].insert(messageData);
	}

	// Remove array of data if it's empty
	if (response.data.length === 0) {
		delete response.data;
	}

	// Remove array of errors if it's empty
	if (response.errors.length === 0) {
		delete response.errors;
	}

	// Send response
	return response;
});

/* Save lead
	@param authTokenId
	@param data
	@param lead


KONDATA.call 'data:lead:save',
	lead:
		name: 'john doe'
		email: 'john.doe@konecty.com' (optional, but required if not phone)
		phone: '5130303030' ou [ '5130303030', '5133303030' ] (optional, but required if not email)
		broker: 'username' (optional)
		campaign: '_id' (optional)
		queue: '_id' (optional)
		extraFields: object (optional) -> other fields to be inserted, updated
	save: [
		document: 'Activity'
		data:
			subject: 'okokok'
	]

- Para salvar a lead eu recebo os seguintes dados:
	- Nome
	- Email
	- Telefone
	- Roleta
	- Campanha
	- Usuário responsável pelo contato (corretor)
- Com os dados informados, verifica se já existe um contato:
	- Primeiro busca um contato com o e-mail informado;
	- Se não achou com e-mail, busca um contato que possua o primeiro nome informado + telefone;
- Se achou um contato:
	- Atualiza o nome se o nome informado é maior que o existente;
	- Adiciona um possível novo e-mail;
	- Adiciona um possível novo telefone;
	- Atualiza a roleta;
	- Atualiza a campanha;
	- Se foi informado usuário responsável:
		- Adiciona o usuário informado como responsável do contato;
	- Se não informado usuário responsável:
		- Verifica se o contato possui uma oportunidade ativa:
			- Adiciona como responsável do contato o responsável ativo pela oportunidade atualizada mais recentemente.
		- Se não, se o contato possui uma atividade criada nos últimos 10 dias:
			- Adiciona como responsável do contato o responsável ativo pela atividade criada mais recentemente.
		- Se não, se foi informada uma roleta:
			- Adiciona como responsável do contato o próximo usuário da roleta informada.
		- Se não, verifica se a campanha informada possui uma roleta alvo:
			- Adiciona como responsável do contato o próximo usuário da roleta alvo da campanha.
*/
Meteor.registerMethod('data:lead:save', 'withUser', function (request) {
	let createRequest, record, result;

	// Some validations of payload
	if (!isObject(request.lead)) {
		return new Meteor.Error('internal-error', `[${request.document}] Invalid payload`);
	}

	// Define response
	const response = {
		success: true,
		data: [],
		errors: [],
	};

	let phoneSent = [];
	if (request.lead.phone && !isEmpty(request.lead.phone)) {
		phoneSent = phoneSent.concat(request.lead.phone);
	}

	// validate if phone or email was passed
	if (!has(request, 'lead.email') && phoneSent.length === 0) {
		response.success = false;
		response.errors = [new Meteor.Error('data-lead-save-validation', 'É obrigatório o preenchimento de ao menos um dos seguintes campos: email e telefone.')];
		delete response.data;
		return response;
	}

	let contactUser = null;

	if (!request.lead) {
		request.lead = {};
	}

	let contact = null;

	// try to find a contact with given email
	if (request.lead.email) {
		// request.lead.email.some (email) ->
		record = Meteor.call('data:find:all', {
			document: 'Contact',
			filter: {
				conditions: [
					{
						term: 'email.address',
						operator: 'equals',
						value: request.lead.email,
					},
				],
			},
			limit: 1,
		});

		if (has(record, 'data.0')) {
			contact = get(record, 'data.0');
		}
	}

	// If contact not found try to find with name and phone
	if (!contact && request.lead.name && phoneSent.length > 0) {
		const regexName = _first(words(request.lead.name));

		record = Meteor.call('data:find:all', {
			document: 'Contact',
			filter: {
				conditions: [
					{
						term: 'phone.phoneNumber',
						operator: 'equals',
						value: phoneSent[0],
					},
					{
						term: 'name.full',
						operator: 'contains',
						value: regexName,
					},
				],
			},
			limit: 1,
		});

		if (has(record, 'data.0')) {
			contact = get(record, 'data.0');
		}
	}

	let contactData = {};

	if (request.lead.name) {
		let setName = true;
		if (has(contact, 'name.full')) {
			if (request.lead.name.length < contact.name.full.length) {
				setName = false;
			}
		}

		if (setName) {
			const nameParts = words(request.lead.name);
			contactData.name = {
				first: _first(nameParts),
				last: tail(nameParts).join(' '),
			};
		}
	}

	if (request.lead.email) {
		if (size(get(contact, 'email')) > 0) {
			if (
				!find(compact(contact.email), {
					address: request.lead.email,
				})
			) {
				contactData.email = contact.email;
				contactData.email.push({
					address: request.lead.email,
				});
			}
		} else if (!isEmpty(request.lead.email)) {
			contactData.email = [{ address: request.lead.email }];
		}
	}

	if (phoneSent.length > 0) {
		if (size(get(contact, 'phone.length')) > 0) {
			let firstPhoneNotFound = true;
			phoneSent.forEach(function (leadPhone) {
				if (
					!find(compact(contact.phone), {
						phoneNumber: leadPhone,
					})
				) {
					if (firstPhoneNotFound) {
						contactData.phone = contact.phone;
						firstPhoneNotFound = false;
					}

					contactData.phone.push({
						countryCode: '55',
						phoneNumber: leadPhone,
					});
				}
			});
		} else if (phoneSent.length > 0) {
			contactData.phone = [];

			phoneSent.forEach(leadPhone =>
				contactData.phone.push({
					countryCode: 55,
					phoneNumber: leadPhone,
				}),
			);
		}
	}

	// if no _user sent, _user will be set from users in queue
	if (request.lead.queue) {
		contactData.queue = { _id: request.lead.queue };
	}

	if (request.lead.campaign) {
		contactData.campaign = { _id: request.lead.campaign };
	}

	// Add extra fields to contactData
	if (request.lead.extraFields) {
		contactData = extend(contactData, request.lead.extraFields);
	}

	// controls if field _user was set to contact
	let addedUser = false;

	// sets _user based on the data sent
	if (request.lead.broker) {
		addedUser = true;

		record = Meteor.call('data:find:all', {
			document: 'User',
			filter: {
				conditions: [
					{
						term: 'username',
						operator: 'equals',
						value: request.lead.broker,
					},
				],
			},
			fields: '_id',
			limit: 1,
		});

		if (size(get(record, 'data')) > 0) {
			if (has(contact, '_user')) {
				if (
					!find(compact(contact._user), {
						_id: record.data[0]._id,
					})
				) {
					contactData._user = clone(contact._user);
					contactData._user.push({
						_id: record.data[0]._id,
					});
				}
			} else {
				contactData._user = [record.data[0]];
			}

			// @TODO testar passando _user!!! array e não array
			contactUser = { _id: record.data[0]._id };
		}
	} else {
		// if a contact has been found try to set _user based on his opportunities and activities
		let userQueue;
		if (contact) {
			if (!addedUser && contact.activeOpportunities && get(contact, 'activeOpportunities', 0) > 0) {
				record = Meteor.call('data:find:all', {
					document: 'Opportunity',
					filter: {
						conditions: [
							{
								term: 'contact._id',
								operator: 'equals',
								value: contact._id,
							},
							{
								term: 'status',
								operator: 'in',
								value: ['Nova', 'Ofertando Imóveis', 'Em Visitação', 'Proposta', 'Contrato', 'Pré-Reserva de Lançamentos'],
							},
							{
								term: '_user.active',
								operator: 'equals',
								value: true,
							},
						],
					},
					limit: 1,
					sort: [
						{
							property: '_updatedAt',
							direction: 'DESC',
						},
					],
					fields: '_id, _user',
				});

				if (has(record, 'data.0._user')) {
					addedUser = true;

					contactUser = record.data[0]._user[0];

					// @TODO talvez seja necessário testar se `record.data[0]._user` é realmente um array
					if (
						!find(compact(contact._user), {
							_id: record.data[0]._user[0]._id,
						})
					) {
						contactData._user = clone(contact._user);
						contactData._user.push(record.data[0]._user[0]);
					}
				}
			}

			// get recent activities from contact to find an _user
			if (!addedUser) {
				record = Meteor.call('data:find:all', {
					document: 'Activity',
					filter: {
						conditions: [
							{
								term: 'contact._id',
								operator: 'equals',
								value: contact._id,
							},
							{
								term: '_createdAt',
								operator: 'greater_or_equals',
								value: moment().subtract(10, 'days').toDate(),
							},
							{
								term: '_user.active',
								operator: 'equals',
								value: true,
							},
						],
					},
					limit: 1,
					sort: [
						{
							property: '_createdAt',
							direction: 'DESC',
						},
					],
					fields: '_id, _user',
				});

				if (has(record, 'data.0._user')) {
					addedUser = true;

					contactUser = record.data[0]._user[0];

					// @TODO talvez seja necessário testar se `record.data[0]._user` é realmente um array
					if (
						!find(compact(contact._user), {
							_id: record.data[0]._user[0]._id,
						})
					) {
						contactData._user = clone(contact._user);
						contactData._user.push(record.data[0]._user[0]);
					}
				}
			}
		}

		// if queue is set, set _user getting next user from queue sent
		if (!addedUser && request.lead.queue) {
			if (isString(request.lead.queue)) {
				userQueue = metaUtils.getNextUserFromQueue(request.lead.queue, this.user);

				addedUser = true;

				contactUser = userQueue.user;

				if (has(userQueue, 'user._id')) {
					if (contact) {
						if (
							!find(compact(contact._user), {
								_id: userQueue.user._id,
							})
						) {
							contactData._user = clone(contact._user);
							contactData._user.push(userQueue.user);
						}
					} else {
						contactData._user = [userQueue.user];
					}
				}
			}
		}

		// if _user not set yet and campaign is set, try to find a queue set in campaign
		if (!addedUser && request.lead.campaign) {
			record = Meteor.call('data:find:all', {
				document: 'Campaign',
				filter: {
					conditions: [
						{
							term: '_id',
							operator: 'equals',
							value: request.lead.campaign,
						},
					],
				},
				fields: '_id,targetQueue',
			});

			if (has(record, 'data.0.targetQueue')) {
				// set targetQueue from campaign to contact if not set
				if (!contactData.queue) {
					contactData.queue = {
						_id: record.data[0].targetQueue._id,
					};
				}

				userQueue = metaUtils.getNextUserFromQueue(record.data[0].targetQueue._id, this.user);

				addedUser = true;

				contactUser = userQueue.user;

				if (has(userQueue, 'user._id')) {
					if (contact) {
						if (
							!find(compact(contact._user), {
								_id: userQueue.user._id,
							})
						) {
							contactData._user = clone(contact._user);
							contactData._user.push(userQueue.user);
						}
					} else {
						contactData._user = [userQueue.user];
					}
				}
			}
		}
	}

	// sets _user with original data from contact if queue is set. prevents default behavior overwriting _user with next user from queue
	if (!addedUser && contact) {
		// some contacts doesn't have _user set, so set it to current request user
		if (!has(contact, '_user.0._id')) {
			contactData._user = [{ _id: this.user._id }];
		} else if (contactData.queue) {
			contactData._user = clone(contact._user);
		}
	}

	// creates a contact if not found one
	if (!contact) {
		createRequest = {
			document: 'Contact',
			data: contactData,
		};

		// default data
		if (!contactData.status) {
			createRequest.data.status = 'Lead';
		}
		if (!contactData.type) {
			createRequest.data.type = ['Cliente'];
		}

		result = Meteor.call('data:create', createRequest);
	} else if (!isEmpty(contactData)) {
		const updateRequest = {
			document: 'Contact',
			data: {
				ids: [
					{
						_id: contact._id,
						_updatedAt: {
							$date: moment(contact._updatedAt).toISOString(),
						},
					},
				],
				data: contactData,
			},
		};

		result = Meteor.call('data:update', updateRequest);
	} else {
		result = {
			success: true,
			data: [contact],
		};
	}

	if (isArray(result.errors)) {
		response.errors = response.errors.concat(result.errors);
	}

	if (result.success === false) {
		response.success = false;
	} else {
		response.data = result.data;

		const contactId = result.data[0]._id;

		// save other data sent
		if (request.save) {
			// set _user from created contact
			if (!addedUser) {
				contactUser = response.data[0]._user[0];
			}

			var saveRelations = (relations, contactId, parentObj) =>
				relations.some(function (saveObj) {
					createRequest = {
						document: saveObj.document,
						data: saveObj.data,
					};

					if (has(Meta[saveObj.document], 'fields.contact.isList')) {
						createRequest.data.contact = [{ _id: contactId }];
					} else {
						createRequest.data.contact = {
							_id: contactId,
						};
					}

					if (parentObj) {
						createRequest.data = extend(createRequest.data, parentObj);
					}

					// @TODO verificar no metodo do documento se o lookup de contato é isList para botar o array ou nao
					createRequest.data._user = [contactUser];

					const saveResult = Meteor.call('data:create', createRequest);

					// @TODO tratar os retornos
					if (saveResult.success === true) {
						response.data = response.data.concat(saveResult.data);

						if (saveObj.relations) {
							const relationMap = {};
							relationMap[saveObj.name] = {
								_id: saveResult.data[0]._id,
							};

							saveRelations(saveObj.relations, contactId, relationMap);
						}
					} else {
						response.errors = response.errors.concat(saveResult.errors);
					}
				});

			if (request.save) {
				saveRelations([].concat(request.save), contactId);
			}
		}
	}

	// Remove array of data if it's empty
	if (response.data.length === 0) {
		delete response.data;
	}

	// Remove array of errors if it's empty
	if (response.errors.length === 0) {
		delete response.errors;
	}

	// @TODO retornar apenas o campo _user que foi adicionado, e não todos caso o contato já exista e possua outro _user setado
	// if newUser? and response.data?.length > 0
	// 	response.data[0]._user = newUser

	// Send response
	return response;
});

var processValidationScript = function (validationScript, validationData, fullData, context) {
	const extraData = {};

	if (validationData) {
		for (let validationField in validationData) {
			const validationFilter = validationData[validationField];

			const validationDataFilter = filterUtils.parseDynamicData(validationFilter, '$this', fullData);

			const record = Meteor.call('data:find:all', validationDataFilter);

			if (record.success === true) {
				extraData[validationField] = record.data;
			}
		}
	}

	return utils.runValidationScript(validationScript, fullData, context, extraData);
};
