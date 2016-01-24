## Callahad's Let's Auth Prototype

### Getting Started

Install Node >= 4.2, clone the repo, then:

1. `npm install`
2. `npm start`
3. Visit http://localhost:8080

Neither cryptographic signing nor actual email-sending are implemented yet.
There should still be enough here for discussion.

### RP / LA Protocol Design

This implementation presumes full browser redirects. It works without
JavaScript, does not rely on the client's clock, and can be extended to not rely
on the RP's clock.

Let's walk through the sequence.

1. The website's login form is configured to POST to `/auth` on a Let's Auth
   service. The form contains two elements:

   - The email address to verify
   - A callback URL which accepts identity assertions

2. The Let's Auth service verifies the address, either through a confirmation
   email, OpenID Connect loop, or some other protocol. This step is an
   implementation detail potentially specific to each Let's Auth daemon.

3. If successful, the user ends up back on the Let's Auth service's domain, on a
   page with a form preconfigured to POST a signed identity assertion to the
   website's callback URL.

4. When the user POSTs the assertion to the website's callback URL, the
   website's back end verifies that the information in the assertion is valid,
   and that it was signed by one of the keys listed in the Let's Auth server's
   `/.well-known/letsauth` JSON document.

5. If everything checks out, the website knows the user's verified email
   address, and can respond to by setting a session cookie. Login complete!

Bam! Login system with just three explicit endpoints:

- `POST /auth` on the LA daemon, which begins the email verification flow.
- `GET /.well-known/letsauth` on the LA daemon, which lists the public parts of
   its signing keys.
- Some `POST` endpoint on the RP, which accepts an assertion from the Let's Auth
   server.

There's also an implicit `GET` endpoint on the LA daemon which the confirmation
link points to, but that doesn't have to be part of the protocol's contract.

### What's in an Assertion?

Our payloads must contain:

1. The user's email address.
2. The target website's origin. (Prevents cross-site replay)
3. A nonce. (Prevents same-site replay)
4. A creation timestamp.
5. An expiration timestamp. (2 minutes? 5 minutes?)
6. The issuer's origin.
7. A string identifying the issuer's signing key. (Makes key rotation possible)
8. A cryptographic signature protecting the above data.

We should probably use JWTs as the serialization format.

### Thoughts

1.  __Minimum State for a Let's Auth Relying Party.__

    Technically none, but some state is necessary to prevent replay attacks.
    Namely, relying websites should be able to cache user/nonce pairs for the
    entire duration of an assertion's validity, plus any allowances for clock
    skew.

    We probably want to cap assertion validity, so folks can't generate
    assertions that are good until the heat death of the universe. Your email
    provider will probably go away before then.

2.  __Minimum State for a Let's Auth server.__

    Potentially none, if all of the verification and RP endpoint information is
    stored in an encrypted blob that the client is responsible for passing back
    to Let's Auth along with the confirmation token.

    Practically, the server will need to store the user's email address, the
    website's callback URL, and a secret token. It must do this for each unique
    email/website pair. The data only needs to persist long enough for the user
    to complete the verification loop, up to a server-defined maximum timeout.

3.  __Cross-device / Cross-browser Verification.__

    We have to support scenarios where the browser completing the verification
    has *no* common state with the browser that initiated login. For instance, a
    user might start in Firefox, but click the confirmation link in Mail.app,
    which opens up Safari. Or they might start on their desktop and follow the
    link on their phone.

    This means that the Let's Auth server must temporarily remember the target
    website's callback URL, the user's email address, and secret token that
    confirms receipt of the confirmation email.

    Anything less and we wouldn't be able to complete authentication across
    browser or device boundaries.

4.  __Using Smartphones to Reduce Friction.__

    If the secret token is short enough, we could allow the user to type it
    directly into the Let's Auth "please check your email" page, as an
    alternative to following a link.

    This means most people could start the sign-in process on their computer,
    glance at their phone's notifications, then type in the code on their
    computer. Done.

    This might even be preferable to systems like OpenID Connect on Gmail, since
    it avoids having to log into your email account on the current computer.

5.  __Native Browser Support.__

    It's too early to start thinking seriously about this, but as long as the
    assertion format is well-specified and the callback URL is discoverable
    (say, in a `<meta>` tag), then the browser could stand in for the Let's Auth
    service.

    Sites would also have to somehow opt-in to trusting each browser's issuer
    and publish that information in a discoverable manner. Could get messy.
    Maybe the browser could somehow interact directly with the LA service
    instead? Again, too early. Not worth burning many cycles on right now.

6.  __Let's Auth Service Protocols.__

    This prototype focuses on email because we *have* to do email. It's the
    universal option. Beyond that, Let's Auth daemons should be configurable to
    support arbitrary protocols, and which ones are enabled should be the
    service operator's choice.

    Though OpenID Connect will be really important for Gmail users, so we
    probably need to do that, too.

    Until we have good stories around email and OpenID Connect, we can punt on
    creating our own protocol for self-hosting your identity. We'll get there
    eventually, but for now, you can set up your own email domain.
