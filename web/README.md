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

This first server adapter runs pure Curve handlers. Native networking,
cryptography, HTTP parsing, body limits and URL matching belong to Bun.
Streaming bodies, middleware, WebSockets, outbound HTTPS and effectful
request handlers are separate extensions.

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

The command parses JSX or TSX and checks the generated Curve module before
writing it. The module imports the built-in `View` library. For an input
component named `App`, the generated JavaScript module exports
`views["Component.App"]`. String props become positional parameters in
destructuring order.

The initial subset supports synchronous function and arrow components with a
single JSX return, local component composition, required destructured string
props, fragments, intrinsic elements, and literal attributes and children.
Hooks, effects, runtime imports of components, data-dependent JavaScript
expressions, prop spreads and event bindings inside lowered JSX produce
source-located diagnostics. Put browser state and events in the React host and
pass the resulting string props to the Curve view functions.

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
