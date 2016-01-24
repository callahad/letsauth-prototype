#!/usr/bin/env node

'use strict';

const Crypto = require('crypto');
const Path = require('path');
const Url = require('url');
const Querystring = require('querystring');

const Boom = require('boom');
const Good = require('good');
const Hapi = require('hapi');
const Inert = require('inert');
const Joi = require('joi');
const Vision = require('vision');
const Redis = require('fakeredis').createClient();

const server = new Hapi.Server({
  connections: {
    routes: {
      files: { relativeTo: Path.join(__dirname, 'static') }
    }
  }
});

server.connection({ host: 'localhost', port: 4430 });

// Console logging
server.register({
  register: Good,
  options: {
    reporters: [{
      reporter: require('good-console'),
      events: { response: '*', log: '*' }
    }]
  }
});

// Static files
server.register(Inert, (err) => {
  if (err) { throw err; }

  server.route({
    method: 'GET',
    path: '/static/{param*}',
    handler: {
      directory: {
        path: '.',
        redirectToSlash: true,
        index: false
      }
    }
  });
});

// Templating
server.register(Vision, (err) => {
  if (err) { throw err; }

  server.views({
    engines: { html: require('handlebars') },
    path: 'templates',
    layout: true,
    relativeTo: __dirname
  });
});

// Routes
server.route([
  { method: 'GET', path: '/',
    handler: function(request, reply) {
      reply.view('index')
    }
  },

  { method: 'POST', path: '/auth',
    config: {
      validate: {
        payload: {
          email: Joi.string().email({ errorLevel: 0 }).required(),
          endpoint: Joi.string().uri({ scheme: [ 'http', 'https' ] }).required()
        }
      }
    },
    handler: function(request, reply) {
      let origin = asOrigin(request.payload.endpoint);
      let token = Crypto.randomBytes(4).toString('hex');
      let link = `${server.info.uri}/confirm?${Querystring.stringify({email: request.payload.email, origin: origin, token: token})}`;
      let dbKey = `${request.payload.email}:${origin}`;

      Redis.multi()
      .hmset(dbKey, ['token', token, 'endpoint', request.payload.endpoint])
      .expire(dbKey, 15 * 60)
      .exec(function (err, val) {
        reply.view('auth', {
          where: Url.parse(origin).hostname,
          email: request.payload.email,
          link: link
        });
      });
    }
  },

  { method: 'GET', path: '/confirm',
    config: {
      validate: {
        query: {
          email: Joi.string().email({ errorLevel: 0 }).required(),
          origin: Joi.string().uri({ scheme: [ 'http', 'https' ] }).required(),
          token: Joi.string().hex().length(8).required(),
        }
      }
    },
    handler: function(request, reply) {
      let origin = asOrigin(request.query.origin);
      let dbKey = `${request.query.email}:${origin}`;

      Redis.hgetall(dbKey, function (err, vals) {
        if (err || !vals) {
          reply(Boom.badRequest('invalid credentials'));
        } else {
          Redis.del(dbKey, function (err, val) {
            reply.view('confirm-success', {
              where: Url.parse(origin).hostname,
              endpoint: vals.endpoint,
              assertion: genAssertion(request.query.email, origin)
            });
          });
        }
      });
    }
  }
]);

function asOrigin(uri) {
  let defaultPort = { 'http:' : 80, 'https:' : 443 };
  let parsed = Url.parse(uri);

  let origin;
  if (parsed.port && parsed.port !== defaultPort[parsed.protocol]) {
    origin = `${parsed.protocol}//${parsed.hostname}:${parsed.port}`;
  } else {
    origin = `${parsed.protocol}//${parsed.hostname}`;
  }

  return origin;
}

function genAssertion(email, origin) {
  // FIXME: This should be a signed JWT.

  // FIXME: The origin should always be HTTPS, so we can just report the
  // hostname in the future. Temporarily including the entire origin for ease
  // during development.

  let now = Date.now();

  let response = {
    data: {
      email: email,
      origin: origin,
      issuer: asOrigin(server.info.uri),
      issued: now,
      expires: now + 10 * 60 * 1000,
      nonce: Crypto.randomBytes(16).toString('hex')
    },
    signature: 'FIXME'
  }

  return JSON.stringify(response);
}

server.start(() => {
  console.log("Let's Auth server running at", server.info.uri);
});
