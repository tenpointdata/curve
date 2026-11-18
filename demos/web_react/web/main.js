import { createElement, Fragment, useState } from "react";
import { createRoot } from "react-dom/client";
import views from "../Generated.curve";
import { renderReact } from "../../../web/react.ts";

function App() {
  const [name, setName] = useState("Curve");
  const changed = name === "React";
  return createElement(
    Fragment,
    null,
    renderReact(views["Component.App"](name, changed, changed ? 1 : 0), createElement, Fragment),
    createElement("button", { id: "rename", onClick: () => setName("React") }, "Change greeting"),
  );
}

createRoot(document.getElementById("root")).render(createElement(App));
