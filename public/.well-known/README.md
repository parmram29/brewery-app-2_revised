# .well-known

Served as static content from the site root.

If you enable **Apple Pay** on the gateway's hosted checkout, Apple will issue a
domain-verification file. Save it here, unchanged and with no extension:

    public/.well-known/apple-developer-merchantid-domain-association

It must then be reachable at:

    https://<your-domain>/.well-known/apple-developer-merchantid-domain-association

No code change is needed — Express already serves this directory. Apple Pay also
requires HTTPS; it will not appear over plain HTTP.
