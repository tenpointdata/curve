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
Use `handle` for a pure response, `handle_action` for outbound HTTPS, or
`handle_stream` for binary request and response bodies.

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

## Stream binary request and response bodies

A streaming application exports `handle_stream(U32, Web.RequestHead) ->
Web.StreamAction`. The request head carries the method, path, parameters,
query and headers. Export one kind of handler per application.

- `Web.read_stream(next)` reads a chunk before selecting the response status
  and headers. `next` receives a `Web.BodyChunk`, `Web.BodyEnd`,
  `Web.BodyTooLarge` or `Web.BodyFailed`.
- `Web.stream_reply(status, headers, body)` starts a response.
  A `Web.BodyWrite{bytes, next}` writes a binary chunk. The host calls
  `next` on the next pull. `Web.BodyRead{next}` can read more input as part
  of the response stream. `Web.BodyStop{}` completes it and
  `Web.BodyAbort{}` reports a failed transfer.

Byte lists use `U32` values from 0 to 255. The host delivers chunks of at most
16 KiB and expects each write to contain 1 to 16,384 bytes. Choose response
headers before writing. A failure after headers have been sent can end the
stream, so clients should handle incomplete transfers. The request body
limit still comes from `--max-body`. Bun may return HTTP 413 at the
transport layer before the application sees an oversized body. A handler
that is already reading receives `Web.BodyTooLarge` when the request
cursor detects the overflow. Disconnects cancel further input and output
work.

```sh
curve web serve demos/web_http/stream.curve
curl -sS --data-binary @input.bin http://127.0.0.1:3000/binary/echo -o output.bin
cmp input.bin output.bin
```

The echo demo uses 1,048,577 chunks of proof fuel to bound its recursion.
That covers the default 1 MiB body limit even with one byte per chunk.

Bun 1.4.0 was verified to deliver a response chunk while the upload was
still open. The Bun 1.3.12 test handled complete binary transfers but
buffered the small upload used in the duplex probe. Outbound HTTPS actions
still deliver bounded text bodies.

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

## Render keyed lists

List props use `string[]`, `number[]`, or arrays of records with required
string, Boolean, or U32 fields. Readonly array forms work too. A `.map()`
callback takes one item and returns one JSX element with an explicit key.
For scalar lists the key is the item. For records it is a string or U32
field on the item. Keys must be distinct among siblings.

```tsx
type Item = { id: string; label: string };

export const Items = ({ items }: { items: Item[] }) => (
  <ul>{items.map(item => <li key={item.id}>{item.label}</li>)}</ul>
);
```

Pass ordinary JavaScript values through `viewWithProps`. The generated
module supplies the layout that validates the props and encodes the Curve
lists.

```jsx
import { createElement, Fragment } from "react";
import { createRoot } from "react-dom/client";
import views from "./Generated.curve";
import { renderReact, viewWithProps } from "./react.ts";

const root = createRoot(document.getElementById("root"));
const view = viewWithProps(views, "Component.Items", {
  items: [{ id: "curve", label: "Curve" }, { id: "react", label: "React" }],
});
root.render(renderReact(view, createElement, Fragment));
```

The renderer uses a keyed React fragment per item. Reordering the input
preserves the corresponding DOM nodes. Try the **Reverse items** button in
the demo.

## Verify

```sh
bun test --preload ./curve2/main.ts web/
bun curve2/main.ts demos/web_http/server.curve --check-only
```

HTTPS tests use OpenSSL to verify trusted and untrusted TLS connections over
loopback. The streaming suite runs duplex and disconnect tests on Bun 1.4
or later.
