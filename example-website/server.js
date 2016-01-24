#!/usr/bin/env node

"use strict";

const path = require('path');

const app = require('koa')();
const serve = require('koa-static');
const router = require('koa-router')();
const bodyparser = require('koa-bodyparser');
const redis = require('co-redis')(require('fakeredis').createClient());
const isemail = require('isemail');

const server = {
  origin: 'http://localhost:8080', // Port is also hardcoded at end of file
  letsauth: 'http://localhost:4430'
}

router.post('/authback', function* (next) {
  // Verification is hard to get right.
  // Maybe the LA server contract should be expanded to include a verification
  // endpoint, where you can just POST an assertion and get back an OK / NOT OK.
  let assertion = JSON.parse(this.request.body.assertion);
  let signature = assertion.signature;
  let given = assertion.data;

  let now = Date.now();

  if (given.issuer !== server.letsauth) { this.throw(400, 'Certificate from unrecognized authority'); }

  if (signature !== 'FIXME') { this.throw(400, 'Assertion signature is invalid'); }

  if (isemail.validate(given.email, { errorLevel: true }) !== 0) { this.throw(400, 'Email is not valid'); }

  if (given.origin !== server.origin) { this.throw(400, 'Certificate not for this website'); }

  let skew = 5 * 60 * 1000; // Allow LA and RP clocks to differ by 5 minutes.
  let notYetValid = now < given.issued - skew;
  let expired = now > given.expires + skew;

  if (given.issued >= given.expires) { this.throw(400, 'Certificate set to expire before it was issued'); }
  if (notYetValid) { this.throw(400, 'Certificate issued in the future'); }
  if (expired) { this.throw(400, 'Certificate expired'); }

  let added = yield redis.sadd(given.email, given.nonce);

  if (added === 0) { this.throw(400, 'Certificate already used'); }

  yield redis.pexpire(given.email, given.expires + skew * 2);

  this.body = `Congratulations! You've proven your identity as ${given.email}!`
});

app.use(bodyparser());
app.use(router.routes());
app.use(router.allowedMethods());
app.use(serve(path.join(__dirname, 'static')));

app.listen(8080);

console.log(`Example website running at ${server.origin}`)
