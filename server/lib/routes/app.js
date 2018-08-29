/*
 * @TODO analize Meteor.Error(500, 'Internal server error')
 */
import cookieParser from 'cookie-parser';
import { json, urlencoded } from 'body-parser';
import { compileFile } from 'swig';
import { resolve, join } from 'path';
import { register } from 'bugsnag';
import { parse } from 'mongodb-uri';
import { isArray, isObject, each, isString, isNumber, get } from 'lodash';
import cors from 'cors';

REQ_TIMEOUT = 1000 * 300;
RES_TIMEOUT = 1000 * 300;

const uriObject = parse(process.env.MONGO_URL);
process.env.dbName = uriObject.database;
console.log(`[kondata] === ${process.env.dbName} ===`.green);

register('3aff690ae2254498bb9a88dcf8bbb211');

const basePath = resolve('.').split('.meteor')[0];
let tplPath = 'assets/app/templates';
if (basePath.indexOf('bundle/programs/server') > 0) {
  tplPath = '../../programs/server/assets/app/templates';
}

global.logAllRequests = false;

process.on('SIGUSR2', function() {
  global.logAllRequests = !global.logAllRequests;
  if (global.logAllRequests === true) {
    console.log('Log all requests ENABLED'.green);
  } else {
    console.log('Log all requests DISABLED'.red);
  }
});

Picker.middleware(function(req, res, next) {
  let data = '';
  req.on('data', chunk => (data += chunk));
  req.on('end', () => (req.rawBody = data));
  next();
});

Picker.middleware(cookieParser());

var convertObjectIdsToOid = function(values) {
  if (isArray(values)) {
    values.forEach((item, index) => (values[index] = convertObjectIdsToOid(item)));
    return values;
  }

  if (isObject(values)) {
    if (values instanceof Date) {
      return { $date: values.toISOString(), pog: undefined };
    }

    each(values, (value, key) => (values[key] = convertObjectIdsToOid(value)));
    return values;
  }

  return values;
};

// WebApp.httpServer.setTimeout REQ_TIMEOUT

// ### Helpers
// Add res.send method and res.headers object to be sent on res.send
// Add res.set and res.get to handle response headers
Picker.middleware(function(req, res, next) {
  req.notifyError = function(type, message, options) {
    options = options || {};
    options.url = req.url;
    options.req = req;

    if (isString(req.rawBody)) {
      options.rawBody = JSON.parse(req.rawBody);
    }

    options.user = {
      _id: get(req, 'user._id', { valueOf: () => undefined }).valueOf(),
      name: req.user != null ? req.user.name : undefined,
      login: req.user != null ? req.user.username : undefined,
      email: req.user != null ? req.user.emails : undefined,
      access: req.user != null ? req.user.access : undefined,
      lastLogin: req.user != null ? req.user.lastLogin : undefined
    };
    options.session = {
      _id: get(req, 'session._id', { valueOf: () => undefined }).valueOf(),
      _createdAt: req.session != null ? req.session._createdAt : undefined,
      ip: req.session != null ? req.session.ip : undefined,
      geolocation: req.session != null ? req.session.geolocation : undefined,
      expireAt: req.session != null ? req.session.expireAt : undefined
    };

    return NotifyErrors.notify(type, message, options);
  };

  req.set = (header, value) => (req.headers[header.toLowerCase()] = value);

  req.get = header => req.headers[header.toLowerCase()];

  res.set = (header, value) => res.setHeader(header, value);

  res.get = header => res.getHeader(header);

  res.location = function(url) {
    // "back" is an alias for the referrer
    if ('back' === url) {
      url = req.get('Referrer') || '/';
    }

    // Respond
    res.set('Location', url);
  };

  res.redirect = function(url) {
    // Set location header
    res.location(url);
    res.statusCode = 302;
    res.end();
  };

  res.send = function(status, response) {
    // req.setTimeout REQ_TIMEOUT
    // res.removeAllListeners 'finish'
    // res.setTimeout RES_TIMEOUT
    // res.on 'finish', ->
    // 	res.setTimeout RES_TIMEOUT

    res.hasErrors = false;

    if (!isNumber(status)) {
      response = status;
      status = 200;
    }

    if (response instanceof Error) {
      console.log(`Error: ${response.message}`.red);
      console.log(response);

      response = {
        success: false,
        errors: [
          {
            message: response.message,
            bugsnag: false
          }
        ]
      };

      status = 200;
    }

    if (isObject(response) || isArray(response)) {
      res.set('Content-Type', 'application/json');

      if (response.errors != null) {
        res.hasErrors = true;
        if (isArray(response.errors)) {
          for (let index = 0; index < response.errors.length; index++) {
            const error = response.errors[index];
            response.errors[index] = { message: error.message };
          }
        }
      }

      if (response.time != null) {
        req.time = response.time;
      }

      response = EJSON.stringify(convertObjectIdsToOid(response));
    }

    if (status !== 200 || res.hasErrors === true) {
      console.log(status, response);
    }

    res.statusCode = status;

    if (response == null) {
      res.end();
    }

    res.end(response);
  };

  res.render = function(templateName, data) {
    const tmpl = compileFile(join(tplPath, templateName));

    const renderedHtml = tmpl(data);

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(renderedHtml);
  };

  const resEnd = res.end;

  res.end = function() {
    resEnd.apply(res, arguments);

    if (res.statusCode == null) {
      res.statusCode = 200;
    }

    // Log API Calls
    let log = `-> ${res.statusCode} ${utils.rpad(req.method, 4).bold} ${req.url} (${req.time}) ${
      req.headers.host != null ? req.headers.host.grey : undefined
    } ${req.headers.referer != null ? req.headers.referer.grey : undefined}`;

    if (res.statusCode === 401 && req.user != null) {
      log += ` ${req.user._id}`;
    }

    if (res.statusCode === 200 && res.hasErrors !== true) {
      log = log.cyan;
    } else if (res.statusCode === 500) {
      log = log.red;
    } else {
      log = log.yellow;
    }

    if (global.logAllRequests === true || res.statusCode !== 200 || res.hasErrors === true) {
      console.log(log);
      console.log(JSON.stringify(req.headers));
    }
  };

  next();
});

// register Picker filters based on HTTP methods
const pickerGet = Picker.filter((req, res) => req.method === 'GET');
const pickerPost = Picker.filter((req, res) => req.method === 'POST');
const pickerPut = Picker.filter((req, res) => req.method === 'PUT');
const pickerDel = Picker.filter((req, res) => req.method === 'DELETE' || req.method === 'DEL');

Picker.middleware(json());
Picker.middleware(urlencoded({ extended: true }));

// Add CORS allowing any origin
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split('|');
const corsOptions = {
  origin: function(origin, callback) {
    if (ALLOWED_ORIGINS.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  optionsSuccessStatus: 200 // some legacy browsers (IE11, various SmartTVs) choke on 204
};

Picker.middleware(cors(corsOptions));

// Picker.middleware(function(req, res, next) {

//   if (ALLOWED_ORIGINS.includes(req.headers.origin)) {
//     res.setHeader('Access-Control-Allow-Credentials', true);
//     res.setHeader('Access-Control-Allow-Origin', req.headers.origin);

//   }

//   next();
// });

// global helper to register REST endpoints
global.app = {
  get(path, cb) {
    pickerGet.route(path, function(params, req, res, next) {
      for (let k in params) {
        const v = params[k];
        params[k] = isString(v) ? decodeURI(v) : v;
      }
      if (req.query == null) {
        req.query = params.query;
      }
      req.params = params;
      cb(req, res, next);
    });
  },
  post(path, cb) {
    pickerPost.route(path, function(params, req, res, next) {
      if (req.query == null) {
        req.query = params.query;
      }
      req.params = params;
      cb(req, res, next);
    });
  },
  put(path, cb) {
    pickerPut.route(path, function(params, req, res, next) {
      if (req.query == null) {
        req.query = params.query;
      }
      req.params = params;
      cb(req, res, next);
    });
  },
  del(path, cb) {
    pickerDel.route(path, function(params, req, res, next) {
      if (req.query == null) {
        req.query = params.query;
      }
      req.params = params;
      cb(req, res, next);
    });
  }
};