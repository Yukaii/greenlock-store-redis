'use strict';
const { createClient } = require('redis')

// IMPORTANT
// IMPORTANT
// IMPORTANT
//
// Ready? DON'T OVERTHINK IT!!! (Seriously, this is a huge problem)
//
// If you get confused, you're probably smart and thinking too deep.
//
// Want an explanation of how and why? Okay...
// https://coolaj86.com/articles/lets-encrypt-v2-step-by-step/
//
// But really, you probably don't want to know how and why (because then you'd be implementing your own from scratch)
//
// IMPORTANT
// IMPORTANT
// IMPORTANT
//
// If you want to create a storage strategy quick-and-easy, treat everything as either dumb strings or JSON blobs
// (just as is done here), don't try to do clever optimizations, 5th normal form, etc (you ain't gonna need it),
// but DO use the simple test provided by `greenlock-store-test`.
//
// IMPORTANT
// IMPORTANT
// IMPORTANT
//
// Don't get fancy. Don't overthink it.
// If you want to be fancy and clever, do that after you can pass `greenlock-store-test` the dumb way shown here.
//
// Also: please do contribute clarifying comments.


function safeJsonParse(str) {
  try {
    return JSON.parse(str);
  } catch (e) {
    return null;
  }
}

module.exports.create = function (opts) {
  // pass in database url, connection string, filepath,
  // or whatever it is you need to get your job done well

  const redisUrl = opts.redisUrl || process.env.REDIS_URL;

  if (!redisUrl) {
    throw new Error('You must provide a redisUrl');
  }

  let redisPrefix = opts.redisPrefix || 'greenlock:';

  const client = createClient({
    url: opts.redisUrl,
  });


  client.on('error', (err) => {
    console.error('Redis error:', err);
  });

  async function saveToRedis(key, value) {
    if (!client.isOpen) {
      await client.connect();
    }

    await client.set(key, JSON.stringify(value))

    return null
  }

  async function getFromRedis(key) {
    if (!client.isOpen) {
      await client.connect();
    }

    return safeJsonParse(await client.get(key))
  }

  const accountStoreKey = (id) => `${redisPrefix}accounts:${id}`;
  const certificateStoreKey = (id) => `${redisPrefix}certificates:${id}`;
  const keypairStoreKey = (id) => `${redisPrefix}keypairs:${id}`;

  function saveCertificate(id, blob) { 
    return saveToRedis(certificateStoreKey(id), blob);
  }
  function getCertificate(id) {
    return getFromRedis(certificateStoreKey(id));
  }

  function saveKeypair(id, blob) {
    return saveToRedis(keypairStoreKey(id), blob);
  }
  function getKeypair(id) { return getFromRedis(keypairStoreKey(id)); }


  var store = {};
  store.options = {};
  store.accounts = {};
  store.certificates = {};

  // Whenever a new keypair is used to successfully create an account, we need to save its keypair
  store.accounts.setKeypair = function (opts) {
    console.log('accounts.setKeypair:', opts.account, opts.email);
    console.log(opts.keypair);

    var id = opts.account.id || opts.email || 'default';
    var keypair = opts.keypair;

    return saveKeypair(id, JSON.stringify({
      privateKeyPem: keypair.privateKeyPem // string PEM
    , privateKeyJwk: keypair.privateKeyJwk // object JWK
    })); // Must return or Promise `null` instead of `undefined`
  };



  // We need a way to retrieve a prior account's keypair for renewals and additional ACME certificate "orders"
  store.accounts.checkKeypair = async function (opts) {
    console.log('accounts.checkKeypair:', opts.account, opts.email);

    var id = opts.account.id || opts.email || 'default';
    var keyblob = await getKeypair(id);

    if (!keyblob) { return null; }

    return safeJsonParse(keyblob);
  };



  // We can optionally implement ACME account storage and retrieval
  // (to reduce API calls), but it's really not necessary.
  /*
    store.accounts.set = function (opts) {
      console.log('accounts.set:', opts);
      return null;
    };
    store.accounts.check = function (opts) {
      var id = opts.account.id || opts.email || 'default';
      console.log('accounts.check:', opts);
      return null;
    };
  */



  // The certificate keypairs (properly named privkey.pem, though sometimes sutpidly called cert.key)
  // https://community.letsencrypt.org/t/what-are-those-pem-files/18402
  // Certificate Keypairs must not be used for Accounts and vice-versamust not be the same as any account keypair
  //
  store.certificates.setKeypair = function (opts) {
    console.log('certificates.setKeypair:', opts.certificate, opts.subject);
    console.log(opts.keypair);

    // The ID is a string that doesn't clash between accounts and certificates.
    // That's all you need to know... unless you're doing something special (in which case you're on your own).
    var id = opts.certificate.kid || opts.certificate.id || opts.subject;
    var keypair = opts.keypair;

    return saveKeypair(id, JSON.stringify({
      privateKeyPem: keypair.privateKeyPem // string PEM
    , privateKeyJwk: keypair.privateKeyJwk // object JWK
    })); // Must return or Promise `null` instead of `undefined`
    // Side Note: you can use the "keypairs" package to convert between
    // public and private for jwk and pem, as well as convert JWK <-> PEM
  };



  // You won't be able to use a certificate without it's private key, gotta save it
  store.certificates.checkKeypair = async function (opts) {
    console.log('certificates.checkKeypair:', opts.certificate, opts.subject);

    var id = opts.certificate.kid || opts.certificate.id || opts.subject;
    var keyblob = await getKeypair(id);

    if (!keyblob) { return null; }

    return safeJsonParse(keyblob);
  };



  // And you'll also need to save certificates. You may find the metadata useful to save
  // (perhaps to delete expired keys), but the same information can also be redireved from
  // the key using the "cert-info" package.
  store.certificates.set = function (opts) {
    console.log('certificates.set:', opts.certificate, opts.subject);
    console.log(opts.pems);

    var id = opts.certificate.id || opts.subject;
    var pems = opts.pems;
    return saveCertificate(id, JSON.stringify({
      cert: pems.cert           // string PEM
    , chain: pems.chain         // string PEM
    , subject: pems.subject     // string name 'example.com
    , altnames: pems.altnames   // Array of string names [ 'example.com', '*.example.com', 'foo.bar.example.com' ]
    , issuedAt: pems.issuedAt   // date number in ms (a.k.a. NotBefore)
    , expiresAt: pems.expiresAt // date number in ms (a.k.a. NotAfter)
    })); // Must return or Promise `null` instead of `undefined`
  };



  // This is actually the first thing to be called after approveDomins(),
  // but it's easiest to implement last since it's not useful until there
  // are certs that can actually be loaded from storage.
  store.certificates.check = async function (opts) {
    console.log('certificates.check:', opts.certificate, opts.subject);

    var id = opts.certificate.id || opts.subject;
    var certblob = await getCertificate(id);

    if (!certblob) { return null; }

    return safeJsonParse(certblob);
  };

  store.redis = client;

  return store;
};
