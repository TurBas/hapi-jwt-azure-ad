var cache = require('./cache');
var restler = require('restler');

function requestOpenIdConfig(tenantId, cacheDuration, callback) {
        // we need to load the tenant specific open id config
        var tenantOpenIdconfig = 'https://login.windows.net/' + tenantId + '/v2.0/.well-known/openid-configuration';

        var cachedValue = cache.get(tenantOpenIdconfig);
        if (cachedValue) {
            return callback(null, cachedValue);
        }

        restler.get(tenantOpenIdconfig).on('complete', function(result) {
            if (result instanceof Error) {
                callback(result);
            } else {
                cache.put(tenantOpenIdconfig, result, cacheDuration);
                callback(null, result);
            }
        });
    }

function requestSigningCertificates(tenantId, jwtSigningKeysLocation, cacheDuration, callback) {
        var cachedValue = cache.get(jwtSigningKeysLocation);
        if (cachedValue) {
            return callback(null, cachedValue);
        }

        restler.get(jwtSigningKeysLocation).on('complete', function(result) {
            if (result instanceof Error) {
                callback(result);
            } else {
                var certificates = [];

                // visit the keys collection and extract the delivered certificates
                result.keys.forEach(function(publicKeys) {
                    publicKeys.x5c.forEach(function(certificate) {
                        certificates.push({
                            issuer: publicKeys.issuer.replace(/\{tenantid\}/, tenantId),
                            cert: convertCertificateToBeOpenSSLCompatible(certificate)
                        });
                    })
                });

                // good to go
                cache.put(jwtSigningKeysLocation, certificates, cacheDuration);
                callback(null, certificates);
            }
        });
    }

function convertCertificateToBeOpenSSLCompatible(cert) {
        //Certificate must be in this specific format or else the function won't accept it
        var beginCert = "-----BEGIN CERTIFICATE-----";
        var endCert = "-----END CERTIFICATE-----";

        cert = cert.replace("\n", "");
        cert = cert.replace(beginCert, "");
        cert = cert.replace(endCert, "");

        var result = beginCert;
        while (cert.length > 0) {

            if (cert.length > 64) {
                result += "\n" + cert.substring(0, 64);
                cert = cert.substring(64, cert.length);
            }
            else {
                result += "\n" + cert;
                cert = "";
            }
        }

        if (result[result.length ] != "\n")
            result += "\n";
        result += endCert + "\n";
        return result;
    }

module.exports.retrieveAzureCertificates = function (decoded, cacheDuration, callback) {
    var tenantId =  decoded.tid;

    // check if it looks like a valid AAD token
    if (!tenantId) {
        return callback(new Error('Not a valid AAD token'), null)
    }

    requestOpenIdConfig(tenantId, cacheDuration, function(err, openIdConfig) {
        if(err) {
            return callback(err, null);
        }
        // download the signing certificates from Microsoft for this specific tenant
        requestSigningCertificates(tenantId, openIdConfig.jwks_uri, cacheDuration, function(err, certificates) {
            if (err) {
                return callback(err, null);
            }

            return callback(null, certificates);
        })
    });
};
