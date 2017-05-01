# Hapi Auth using AzureAD JSON Web Tokens

Authentication scheme/plugin for
[**Hapi.js**](http://hapijs.com/) apps using **AzureAD JSON Web Tokens**

This node.js module (Hapi plugin) works with JSON Web Tokens (JWTs) provided
by Azure AD (including Office365) for authentication in your [Hapi.js](http://hapijs.com/)
web application.

This project is a combination of [hapi-auth-jwt2](https://github.com/dwyl/hapi-auth-jwt2) and [node-azure-ad-jwt](https://github.com/dei79/node-azure-ad-jwt). The first is a great project for working with Json Web Tokens in your Hapi application. But AzureAD tokens are signed with rotating keys and the _hapi-auth-jwt2_ project doesn't support it. You can accomplish this by creating your own verifyFunc and validating the token but it is a daunting task. 

The (somewhat outdated) _node-azure-ad-jwt_ project is created to retrieve the certificates and verify your token with it. So if you combine these two projects you can accomplish securing your Hapi application with AzureAD Json Web Tokens. And that's what this project is all about.

### Install from NPM

```sh
npm install hapi-jwt-azure-ad --save
```

### Example

This basic usage example should help you get started:

```javascript
var Hapi = require('hapi');

var people = { // our "users database"
    "JenJones@yourcompany.com" : {
      id: 1,
      name: 'Jen Jones'
    }
};

// bring your own validation function
var validate = function (decoded, request, callback) {
    // do your checks to see if the person is valid
    if (!people[decoded.unique_name]) {
      return callback(null, false);
    }
    else {
      return callback(null, true);
    }
};

var server = new Hapi.Server();
server.connection({ port: 8000 });
        // include our module here ↓↓
server.register(require('hapi-jwt-azure-ad'), function (err) {

    if(err){
      console.log(err);
    }

    server.auth.strategy('jwt-azure-ad', 'jwt-azure-ad',
    { audience: 'ebb5ce9c-1084-4876-9073-62554540e2c6',  // Your appId which you can find in your manifest
      validateFunc: validate,                            // Validate function defined above
      nonce: '6531265312653'                             // The nonce to verify against
    });

    server.auth.default('jwt-azure-ad');

    server.route([
      {
        method: "GET", path: "/", config: { auth: false },
        handler: function(request, reply) {
          reply({text: 'Token not required'});
        }
      },
      {
        method: 'GET', path: '/restricted', config: { auth: 'jwt' },
        handler: function(request, reply) {
          reply({text: 'You used a Token!'})
          .header("Authorization", request.headers.authorization);
        }
      }
    ]);
});

server.start(function () {
  console.log('Server running at:', server.info.uri);
});
```

That's it.

Now when validating the token we reach out to the well known openid-configuration service for the tenant of the token. In the response is the URI where to get the certificates. We request the certificatess on that URI, cache them, and use them to validate the token.
We then verify the `audience`, the `nonce` and the `issuer`. 
The issuer of the token is verified against the issuer stated on the retrieved certificates. If needed you can provide a fixed issuer to override the issuer of the certificate.

## Documentation

- `audience` - (***required***) Your appId which you van find in the manifest of your application.
- `validateFunc` - (***required***) the function which is run once the Token has been decoded with
 signature `function(decoded, request, callback)` where:
    - `decoded` - (***required***) is the decoded and verified JWT-AAD received in the request
    - `request` - (***required***) is the original ***request*** received from the client
    - `callback` - (***required***) a callback function with the signature `function(err, isValid, credentials)` where:
        - `err` - an internal error.
        - `valid` - `true` if the JWT was valid, otherwise `false`.
        - `credentials` - (***optional***) alternative credentials to be set instead of `decoded`.
- `nonce` - (***required*** - *unless you set ignoreNonce tot `true`*)

### *Optional* Parameters

- `verifyOptions` - (***optional*** *defaults to none*) settings to define how tokens are verified by the
[jsonwebtoken](https://github.com/auth0/node-jsonwebtoken#jwtverifytoken-secretorpublickey-options-callback) library
    - `ignoreExpiration` - ignore expired tokens
    - `audience` - do not enforce token [*audience*](http://self-issued.info/docs/draft-ietf-oauth-json-web-token.html#audDef)
    - `issuer` - do not require the issuer to be valid
    - `algorithms` - list of allowed algorithms
- `responseFunc` - (***optional***) function called to decorate the response with authentication headers before the response headers or payload is written where:
    - `request` - the request object.
    - `reply(err, response)`- is called if an error occurred
- `errorFunc` - (***optional*** *defaults to raising the error requested*) function called when an error has been raised. It provides an extension point to allow the host the ability to customise the error messages returned. Passed in object follows the following schema:
    - `errorContext.errorType` - ***required*** the `Boom` method to call (eg. unauthorized)
    - `errorContext.message` - ***required*** the `message` passed into the `Boom` method call
    - `errorContext.schema` - the `schema` passed into the `Boom` method call
    - `errorContext.attributes` - the `attributes` passed into the `Boom` method call
    - The function is expected to return the modified `errorContext` with all above fields defined.
- `issuer` - (***optional***) check the token against this fixed issuer instead of the issuer supplied by the certificate. In some cases the certificate and the expected issuer do not match. Par example, set the issuer to 'https://sts.windows.net/{tenantId}/'.
- `ignoreNonce` - (***optional*** - unless no nonce is supplied). Normally when we send a login request to the OAuth service we send a long a nonce. This nonce will come back in the certificate and we should verify if these values match. If you would like to skip the validation of the nonce set this value to `true`.
- `cacheDuration` - (***optional*** *defaults to 43,200,000 miliseconds (12 hours)*). We cache the certificates we retrieve from the server to minimize traffic. Microsoft documentation state that a cache of 24h should be proficient. We default this to 12 \* 60 \* 60 \* 1000 (12 hours) just to be sure. If you want a different cache duration set this value which accepts a value in milliseconds.  

### Works for me

I started this project to help me validate the bearer token I received from the Azure AD service from my Office 365 account and it suits my needs. While developing this plugin I tried to keep in mind that other developers (you) should be able to reuse my code. If anything doesn't work please repport an issue at https://github.com/turbas/hapi-jwt-azure-ad/issues.

If this plugin helped you by your project and your boss is now super proud of you I would like to hear from you as well.  