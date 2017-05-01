'use strict';

var Boom = require('boom');           // error handling https://github.com/hapijs/boom
var assert = require('assert');       // use assert to check if options are set
var JWT = require('jsonwebtoken');    // https://github.com/docdis/learn-json-web-tokens
var azure = require('./azure');       // retrieve certificates from azure id for token
var extract = require('./extract');   // extract token from Auth Header, URL or Coookie
var pkg = require('../package.json'); // use package name and version rom package.json
var internals = {};                   // see: http://hapijs.com/styleguide#module-globals

/**
 * register registers the name and exposes the implementation of the plugin
 * see: http://hapijs.com/api#serverplugins for plugin format
 * @param {Object} server - the hapi server to which we are attaching the plugin
 * @param {Object} options - any options set during plugin registration
 * in this case we are not using the options during register but we do later.
 * @param {Function} next - the callback called once registration succeeds
 * @returns {Function} next - returns (calls) the callback when complete.
 */
exports.register = function (server, options, next) {
  server.auth.scheme('jwt-azure-ad', internals.implementation); // hapijs.com/api#serverauthapi
  return next();
};

/**
 * attributes merely aliases the package.json (re-uses package name & version)
 * simple example: github.com/hapijs/hapi/blob/master/API.md#serverplugins
 */
exports.register.attributes = { // hapi requires attributes for a plugin.
  pkg: pkg                      // also see: http://hapijs.com/tutorials/plugins
};

/**
 * isFunction checks if a given value is a function.
 * @param {Object} functionToCheck - the object we want to confirm is a function
 * @returns {Boolean} - true if the functionToCheck is a function. :-)
 */
internals.isFunction = function (functionToCheck) {
  var getType = {};

  return functionToCheck
    && getType.toString.call(functionToCheck) === '[object Function]';
};

/**
 * isArray checks if a given variable is an Array.
 * @param {Object} variable - the value we want to confirm is an Array
 * @returns {Boolean} - true if the variable is an Array.
 */
internals.isArray = function (variable) {
  var getType = {};

  return variable
    && getType.toString.call(variable) === '[object Array]';
};

/**
 * implementation is the "main" interface to the plugin and contains all the
 * "implementation details" (methods) such as authenicate, response & raiseError
 * @param {Object} server - the Hapi.js server object we are attaching the
 * the hapi-jwt-azure-ad plugin to.
 * @param {Object} options - any configuration options passed in.
 * @returns {Function} authenicate - we return the authenticate method after
 * registering the plugin as that's the method that gets called for each route.
 */
internals.implementation = function (server, options) {
  assert(options, 'options are required for jwt auth scheme'); // pre-auth checks
  assert(options.audience, 'audience is required!');
  assert(options.validateFunc && internals.isFunction(options.validateFunc), 'A validateFunc is required!' );
  assert(options.nonce || options.ignoreNonce, 'nonce is required or should be explicitly set ignored!');

  // allow custom error raising or default to Boom if no errorFunc is defined
  function raiseError (errorType, message, scheme, attributes) {
    var errorContext = {
      errorType: errorType,
      message: message,
      scheme: scheme,
      attributes: attributes
    };
    var _errorType = errorType;   // copies of params
    var _message = message;       // so we can over-write them below
    var _scheme = scheme;         // without a linter warning
    var _attributes = attributes; // if you know a better way please PR!

    if (options.errorFunc && internals.isFunction(options.errorFunc)) {
      errorContext = options.errorFunc(errorContext);

      if (errorContext) {
        _errorType = errorContext.errorType;
        _message = errorContext.message;
        _scheme = errorContext.scheme;
        _attributes = errorContext.attributes;
      }
    }

    return Boom[_errorType](_message, _scheme, _attributes);
  }

  return {
    /**
     * authenticate is the "work horse" of the plugin. it's the method that gets
     * called every time a route is requested and needs to validate/verify a JWT
     * @param {Object} request - the standard route handler request object
     * @param {Object} reply - the standard hapi reply interface
     * @returns {Boolean} if the Azure AD JWT is valid we return a credentials object
     * otherwise throw an error to inform the app & client of unauthorized req.
     */
    authenticate: function (request, reply) {
      var token = extract(request, options); // extract token Header/Cookie/Query
      var tokenType = 'Bearer';
      var decoded;

      if (!token) {
        return reply(raiseError('unauthorized', null, tokenType));
      }

      // quick check for validity of token format
      // verification is done later, but we want to avoid decoding if malformed
      if (!extract.isValid(token)) {
        return reply(raiseError('unauthorized', 'Invalid token format', tokenType));
      }
      request.auth.token = token; // keep encoded JWT available in the request
      // otherwise use the same key (String) to validate all JWTs

      try {
        decoded = JWT.decode(token, { complete: false });
      } catch (e) { // request should still FAIL if the token does not decode.
        return reply(raiseError('unauthorized', 'Invalid token format', tokenType));
      }

      azure.retrieveAzureCertificates(decoded, options.cacheDuration, function (err, certificates, extraInfo) {
          var verifyOptions = options.verifyOptions || {};
          verifyOptions.audience = options.audience;

          var keysTried = 0;

          if (err) {
            return reply(raiseError('wrap', err));
          }
          if (extraInfo) {
            request.plugins[pkg.name] = { extraInfo: extraInfo };
          }

          certificates.some(function (certificate) { // itterate through one or more certificates
            var key = certificate.cert;
            verifyOptions.issuer = options.issuer || certificate.issuer;
            JWT.verify(token, key, verifyOptions,
              function (verify_err, verify_decoded) {
                if (verify_err) {
                  keysTried++;
                  if (keysTried >= certificates.length) {
                    return reply(raiseError('unauthorized',
                      'Invalid token', tokenType), null, { credentials: null });
                  }
                } else {
                  if (!options.ignoreNonce && options.nonce !== decoded.nonce) {
                    return reply(raiseError('unauthorized',
                      'Invalid token', tokenType), null, { credentials: null });
                  }
                  // see: http://hapijs.com/tutorials/auth for validateFunc signature
                  return options.validateFunc(verify_decoded, request,
                    function (validate_err, valid, credentials) { // bring your own checks
                      if (validate_err) {
                        return reply(raiseError('wrap', validate_err));
                      }
                      if (!valid) {
                        reply(raiseError('unauthorized',
                          'Invalid credentials', tokenType), null,
                          { credentials: credentials || verify_decoded });
                      } else {
                        reply.continue({
                          credentials: credentials || verify_decoded,
                          artifacts: token
                        });
                      }
                      return false;
                    });
                }
                return false;
              });
            return false;
          });
          return true;
        });
      return true;
    },
    /**
     * response is an Optional method called if an options.responseFunc is set.
     * @param {Object} request - the standard route handler request object
     * @param {Object} reply - the standard hapi reply interface ...
     * after we run the custom options.responseFunc we reply.continue to execute
     * the next plugin in the list.
     * @returns {Boolean} true. always return true (unless there's an error...)
     */
    response: function (request, reply) {
      if (options.responseFunc && typeof options.responseFunc === 'function') {
        options.responseFunc(request, reply, function (err) {
          if (err) {
            reply(raiseError('wrap', err));
          } else {
            reply.continue();
          }
        });
      } else {
        reply.continue();
      }
      return true;
    }
  };
};
