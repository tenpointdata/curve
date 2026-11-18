# Curve web applications

Curve runs checked request handlers on Bun's router and TLS implementation.
It can also compile declarative React JSX and TSX to a typed Curve view.
An ordinary React app can import the generated views and own browser
state, effects, events, and mounting.

## Run an HTTP or HTTPS server

```sh
curve web serve demos/web_http/server.curve --port 3000
curl http://127.0.0.1:3000/api/hello/Ada
curl http://127.0.0.1:3000/api/echo -d 'Hello'
```

Use `bun curve2/main.ts` in place of `curve` directly from a checkout.
To enable HTTPS supply the certificate chain and private key as PEM files.

```sh
curve web serve demos/web_http/server.curve \
  --port 8443 --cert server-chain.pem --key server-key.pem
```

`--host` defaults to `127.0.0.1`. `--max-body` defaults to 1 MiB.
Use `--public DIRECTORY` to serve a bundled frontend on the same listener.
The public directory exposes regular non-dot files, with `index.html` mapped
to the containing directory URL. Symbolic links are excluded.

An application imports the built-in `Web` module and exports a route table
plus a handler.

```python
import Base
import Web

def routes() -> List<&2, Web.Route>:
  [Web.route(Web.Get{}, "/health", 0)]

def handle(route: U32, request: Web.Request) -> Web.Response:
  Web.json(200, "{\"status\":\"ok\"}")
```

Register methods and literal paths or paths with named segments such as
`/users/:id`. A request carries the method, path, decoded parameters, query
pairs, headers and a UTF-8 body. `Web.param`, `Web.query_param` and
`Web.header` read the first matching value. Header lookup uses a lowercase
name. A response carries an HTTP status, headers and a text body.
`Web.json` labels an already encoded JSON body.

Bun handles networking, TLS, HTTP parsing, body limits and URL matching.
Use `handle` for a pure response or `handle_action` for outbound HTTPS.
Streaming application bodies, middleware and WebSockets are separate extensions.

## Make outbound HTTPS requests

An effectful app exports `handle_action(U32, Web.Request) -> Web.Action`
in place of `handle`. Return `Web.send(response)` to complete the request.
Return `Web.get(url, next)` or `Web.https(request, next)` to ask the Bun host
to fetch a URL and resume the Curve continuation. A general HTTPS request
carries the method, URL, headers and text body.

```python
def handle_action(route: U32, request: Web.Request) -> Web.Action:
  Web.get("https://example.com/", show_result)

def show_result(result: Web.FetchResult) -> Web.Action:
  match result:
    case Web.Received{status, headers, body}:
      Web.send(Web.text(status, body))
    case Web.FetchFailed{reason}:
      Web.send(Web.text(502, "Upstream unavailable"))
```

```sh
curve web serve demos/web_http/client.curve --allow-origin https://example.com
curl --get --data-urlencode 'url=https://example.com/' http://127.0.0.1:3000/api/fetch
```

Repeat `--allow-origin` to permit additional HTTPS origins by scheme, host,
and port. Origin access is empty by default. Certificate and hostname
verification use Bun's TLS stack. Use `--ca CA.pem` to set the trust roots
for an upstream with a private CA. Each inbound request can run up to four
outbound actions. Each action uses a 15-second timeout and a 1 MiB decoded
response byte limit by default. Override them with `--fetch-timeout` (ms)
and `--max-fetch-bytes`. Redirect responses are delivered to the continuation
with their status and headers. Following one requires a new action that
passes the same origin check.

Curve continuations receive either the upstream status, headers and decoded
text, or a typed failure for an invalid request, disallowed origin, timeout,
cancellation, oversized response, or transport error.

## Compile a React component

Install the pinned JSX parser once in the checkout. A source installation
copies the web package manifest and lockfile. For an installed command, run
the same install against the installation's `web` directory.

```sh
bun install --cwd web --frozen-lockfile
bun install --cwd demos/web_react --frozen-lockfile
curve web jsx demos/web_react/App.tsx -o demos/web_react/Generated.curve
curve demos/web_react/web/index.html -o /tmp/curve-react-public
curve web serve demos/web_http/server.curve --public /tmp/curve-react-public
```

The compiler checks the generated Curve module before writing it. Each entry
component keeps its `Component.*` export, such as `views["Component.App"]`.
Required destructured props become positional parameters in declaration order.
A TypeScript `string`, `boolean` or `number` lowers to Curve `String`, `Bool`
or `U32` respectively. Pass integers in the unsigned 32-bit range for number
props. Unannotated props retain their string behavior.

Use relative imports to compose supported local JSX/TSX modules. Named and
default component imports are supported, including aliases. Supply a
`.jsx` or `.tsx` extension, or omit it when exactly one matching file
exists. Imported components are linked into the same checked Curve module.
Boolean `?:`, `&&` and `!` can select or omit rendered views.

Use synchronous function or arrow components with a single JSX return.
Hooks, effects, package components, arbitrary JavaScript expressions, prop
spreads and event bindings inside lowered JSX produce source-located
diagnostics. Keep interactive state and events in the React host and pass
their values as props to the Curve view functions.

```jsx
import { createElement, Fragment } from "react";
import { createRoot } from "react-dom/client";
import views from "./Generated.curve";
import { renderReact } from "./react.ts";

const node = views["Component.App"]("Curve");
createRoot(document.getElementById("root"))
  .render(renderReact(node, createElement, Fragment));
```

`renderReact` maps typed Curve view constructors to React elements. The
adapter lives in [react.ts](react.ts). The demo uses a React click handler to
change a string prop and render the generated view again.

## Verify

```sh
bun test --preload ./curve2/main.ts web/
bun curve2/main.ts demos/web_http/server.curve --check-only
```

HTTPS tests use OpenSSL to generate a temporary certificate and verify both
untrusted and trusted client connections over loopback.
