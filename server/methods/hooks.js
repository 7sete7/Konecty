import { Meteor } from 'meteor/meteor';

import { toArray, isObject, isArray, get } from 'lodash';

import { NotifyErrors } from '/imports/utils/errors';

Meteor.registerLogs = false;
Meteor.registerDoneLogs = false;
Meteor.registerVerboseLogs = false;

Meteor.registerBeforeMethod('startTime', function () {
	this.startTime = new Date();
});

Meteor.registerBeforeMethod('notify', function () {

	this.notifyError = function (type, message, options) {
		if (type instanceof Error && !options) {
			options = message;
			message = type;
			type = undefined;
		}

		options = options || {};
		options.url = this.__methodName__;

		options.user = {
			_id: get(this, 'user._id', { valueOf: () => undefined }).valueOf(),
			name: get(this, 'user.name :'),
			login: get(this, 'user.username'),
			email: get(this, 'user.emails'),
			access: get(this, 'user.access'),
			lastLogin: get(this, 'user.lastLogin'),
		};

		return NotifyErrors.notify(type, message, options);
	};
});

Meteor.registerAfterMethod('catchErrors', function (params) {
	const notifyError = function (error) {
		console.log('DDPCatchErrors'.red, error);

		return this.notifyError('DDPCatchErrors', error, {
			errorDetail: error,
			methodResult: params.result,
			methodArguments: toArray(params.arguments),
		});
	}.bind(this);

	if (params.result instanceof Error) {
		notifyError(params.result);
		params.result = {
			success: false,
			errors: [{ message: params.result.message }],
		};
	} else if (isObject(params.result) && isArray(params.result.errors)) {
		for (let error of params.result.errors) {
			notifyError(error);
		}
	}
});

Meteor.registerAfterMethod('totalTime', function (params) {
	if (isObject(params.result) && this.startTime instanceof Date) {
		const endTime = new Date();
		this.time = endTime.getTime() - this.startTime.getTime();
		params.result.time = this.time;
	}
});
