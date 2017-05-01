var CACHE_LIFETIME = 12 * 60 * 60 * 1000; // half a day
var _cache = {};

exports.get = function(key) {
    var item = _cache[key];
    if (!item) return null;
    if (Date.now() > item.expires) {
        return null;
    }
    return item.value;
};

exports.put = function(key, value, lifetime) {
    if (typeof lifetime !== 'number') {
        lifetime = CACHE_LIFETIME;
    }
    _cache[key] = {
        expires: Date.now() + lifetime,
        value: value
    };
};