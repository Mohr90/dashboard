# Security policy

## Reporting a vulnerability

Please don't open a public issue for security problems. Use GitHub's
"Report a vulnerability" button in the Security tab of this repository, or
contact the maintainer directly.

## Notes for users

- Your OpenRouter API key stays in the browser. It is kept in `sessionStorage`
  by default and in `localStorage` only if you tick "remember on this device".
  It is sent only to `openrouter.ai`. It is never part of the repository.
- Per-model spend needs a **management key**. OpenRouter's management keys can
  do more than read usage. Use one only if you trust the browser and the host
  serving the page.
- The page has no backend. The Content-Security-Policy meta tag blocks foreign
  scripts and network targets. Clickjacking protection in the page is a
  JavaScript guard only; a real defence needs a `frame-ancestors` header from
  the host.
